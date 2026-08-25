import { afterEach, describe, expect, it } from 'vitest'
import { CallId, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { KimiAdapter } from '../src/adapter.ts'
import { resolveAdapterOptions } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import type { Behavior } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
})

/** Direct adapter over the plugin's real resolve step, with a static key. */
function adapterOf(
  baseURL: string,
  config: Partial<Config> & { apiKey?: string, attachments?: AttachmentStore } = {},
): KimiAdapter {
  const { apiKey, attachments, ...rest } = config
  return new KimiAdapter({
    options: () => resolveAdapterOptions({ ...rest, baseURL }),
    resolveApiKey: () => Promise.resolve(apiKey ?? 'test-key'),
    ...attachments === undefined ? {} : { resolveAttachments: () => attachments },
  })
}

/** Durable image reference; the adapter reads only id, media type, byte count, and dimensions. */
function imageRef(id: string, extra: Partial<ImageAttachmentRef> = {}): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(id),
    mediaType: 'image/png',
    bytes: 100,
    width: 10,
    height: 10,
    ...extra,
  }
}

function imageMessage(ref: ImageAttachmentRef): Message {
  return message('user', [{ type: 'image', attachment: ref } as unknown as ContentBlock])
}

/** Attachment store whose only exercised method returns the given bytes for any reference. */
function fakeAttachments(bytes: Uint8Array = new Uint8Array([1, 2, 3])): AttachmentStore {
  return {
    readImage: (ref: ImageAttachmentRef) => Promise.resolve({ ref, data: bytes }),
  } as unknown as AttachmentStore
}

function message(role: Message['role'], content: ContentBlock[]): Message {
  return { id: 'test', role, content, source: { kind: 'user' } } as unknown as Message
}

function request(messages: Message[], extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'kimi-code', model: 'k3', messages, ...extra }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

const userHi = [message('user', [{ type: 'text', text: 'hi' }])]

describe('KimiAdapter', () => {
  it('streams text and reports usage before finish', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const adapter = adapterOf(server.url)
    const chunks = await collect(adapter.stream(request(userHi)))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.some(chunk => chunk.type === 'usage')).toBe(true)
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'hello' })
  })

  it('sends the default reasoning effort and no temperature for a K3 request', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const adapter = adapterOf(server.url)
    await collect(adapter.stream(request(userHi, { temperature: 0.9 })))
    const body = server.requests[0] as Record<string, unknown>
    expect(body.model).toBe('k3')
    expect(body.reasoning_effort).toBe('low')
    expect(body.temperature).toBeUndefined()
    expect(body.stream).toBe(true)
  })

  it('omits reasoning_effort for the always-thinking coding model', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const adapter = adapterOf(server.url)
    await collect(adapter.stream(request(userHi, { model: 'kimi-for-coding' })))
    const body = server.requests[0] as Record<string, unknown>
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('forwards temperature only when the plugin enables it', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const adapter = adapterOf(server.url, { sendTemperature: true })
    await collect(adapter.stream(request(userHi, { temperature: 0.3 })))
    expect((server.requests[0] as Record<string, unknown>).temperature).toBe(0.3)
  })

  it('replays assistant reasoning_content on a tool-call history turn', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const adapter = adapterOf(server.url)
    const history = [
      message('assistant', [
        { type: 'reasoning', text: 'plan' },
        { type: 'tool-call', id: CallId('c1'), name: 'ls', arguments: '{}' },
      ]),
    ]
    await collect(adapter.stream(request(history)))
    const body = server.requests[0] as { messages: Array<Record<string, unknown>> }
    expect(body.messages[0]).toMatchObject({ role: 'assistant', reasoning_content: 'plan' })
  })

  it('carries genuine attribution and bearer auth on the request', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const adapter = adapterOf(server.url, { apiKey: 'secret-key' })
    await collect(adapter.stream(request(userHi)))
    const headers = server.headers[0]
    expect(headers?.authorization).toBe('Bearer secret-key')
    expect(headers?.['user-agent']).toBeTruthy()
  })

  it('advertises reasoning efforts only for the K3 family', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(server.url)
    const k3 = await adapter.resolveModel('kimi-code', 'k3')
    const coding = await adapter.resolveModel('kimi-code', 'kimi-for-coding')
    expect(k3.reasoning?.efforts.map(effort => String(effort.id))).toEqual(['low', 'high', 'max'])
    expect(coding.reasoning).toBeUndefined()
  })

  it.each<[number, string, string]>([
    [401, '{"error":{"message":"invalid api key"}}', 'AUTH'],
    [429, '{"error":{"message":"too many requests"}}', 'RATE_LIMIT'],
    [429, '{"error":{"message":"monthly usage limit reached"}}', 'QUOTA'],
    [400, '{"error":{"message":"exceeded model token limit: 262144"}}', 'CONTEXT_WINDOW_EXCEEDED'],
    [400, '{"error":{"message":"duplicate tool name"}}', 'INVALID_REQUEST'],
    [503, '{"error":{"message":"engine overloaded"}}', 'SERVER'],
  ])('maps HTTP %i to %s', async (status, body, code) => {
    const server = await mockServer([{ kind: 'http-error', status, body }])
    const adapter = adapterOf(server.url)
    await expect(collect(adapter.stream(request(userHi)))).rejects.toMatchObject({ constructor: LlmError, code })
  })

  it('maps caller abort to an ABORTED error', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents, delayMs: 50 }])
    const adapter = adapterOf(server.url)
    const controller = new AbortController()
    const stream = adapter.stream(request(userHi, { signal: controller.signal }))
    const pump = collect(stream)
    controller.abort()
    await expect(pump).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('times out a stalled stream', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents, delayMs: 200 }])
    const adapter = adapterOf(server.url, { streamIdleTimeoutMs: 40 })
    await expect(collect(adapter.stream(request(userHi)))).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('advertises image input for the default models', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(server.url)
    const k3 = await adapter.resolveModel('kimi-code', 'k3')
    expect(k3.inputModalities).toContain('image')
  })

  it('reads a request image and sends it as an inline image_url part', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const bytes = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF])
    const adapter = adapterOf(server.url, { attachments: fakeAttachments(bytes) })
    await collect(adapter.stream(request([imageMessage(imageRef('sha256:a'))])))
    const body = server.requests[0] as { messages: Array<{ content: unknown }> }
    expect(body.messages[0]?.content).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` } },
    ])
  })

  it('rejects image input for a model without image support', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(server.url, {
      models: [{ id: 'k3', supportsImage: false }],
      attachments: fakeAttachments(),
    })
    await expect(collect(adapter.stream(request([imageMessage(imageRef('sha256:a'))]))))
      .rejects.toMatchObject({ constructor: LlmError, code: 'UNSUPPORTED_CONTENT' })
  })

  it('rejects image input without a mounted attachment service', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(server.url)
    await expect(collect(adapter.stream(request([imageMessage(imageRef('sha256:a'))]))))
      .rejects.toMatchObject({ constructor: LlmError, code: 'INVALID_REQUEST' })
  })

  it('rejects a request image over the byte budget', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(server.url, { imageMaxBytes: 50, attachments: fakeAttachments() })
    await expect(collect(adapter.stream(request([imageMessage(imageRef('sha256:a', { bytes: 1000 }))]))))
      .rejects.toMatchObject({ constructor: LlmError, code: 'INVALID_REQUEST' })
  })

  it('rejects a request image over the pixel budget', async () => {
    const server = await mockServer([])
    const adapter = adapterOf(server.url, { imagePixelBudget: 100, attachments: fakeAttachments() })
    await expect(collect(adapter.stream(request([imageMessage(imageRef('sha256:a', { width: 50, height: 50 }))]))))
      .rejects.toMatchObject({ constructor: LlmError, code: 'INVALID_REQUEST' })
  })
})
