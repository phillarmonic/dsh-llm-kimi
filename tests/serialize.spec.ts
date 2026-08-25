import { describe, expect, it } from 'vitest'
import { LlmError, CallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { serializeRequest } from '../src/serialize.ts'
import type { PreparedImages, RequestDefaults } from '../src/serialize.ts'

/** Minimal image block referencing an attachment id; serialization only reads `attachment.attachmentId`. */
function imageBlock(id: string): ContentBlock {
  return { type: 'image', attachment: { attachmentId: AttachmentId(id) } } as unknown as ContentBlock
}

/** Minimal message factory: serialization only reads `role` and `content`. */
function message(role: Message['role'], content: ContentBlock[]): Message {
  return { id: 'test', role, content, source: { kind: 'user' } } as unknown as Message
}

function options(messages: Message[], extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'kimi-code', model: 'k3', messages, ...extra }
}

describe('serializeRequest', () => {
  it('keeps a text-only user message on the compact string form', () => {
    const body = serializeRequest(options([message('user', [{ type: 'text', text: 'hi' }])]))
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('omits reasoning_effort for models without reasoning support', () => {
    const body = serializeRequest(
      options([message('user', [{ type: 'text', text: 'hi' }])]),
      { supportsReasoning: false, reasoningEffort: 'high' },
    )
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('sends the default effort for reasoning-capable models', () => {
    const defaults: RequestDefaults = { supportsReasoning: true, reasoningEffort: 'high' }
    const body = serializeRequest(options([message('user', [{ type: 'text', text: 'hi' }])]), defaults)
    expect(body.reasoning_effort).toBe('high')
  })

  it('lets an explicit request effort win over the default', () => {
    const body = serializeRequest(
      options([message('user', [{ type: 'text', text: 'hi' }])], { reasoningEffort: ReasoningEffortId('max') }),
      { supportsReasoning: true, reasoningEffort: 'low' },
    )
    expect(body.reasoning_effort).toBe('max')
  })

  it('rejects an explicit effort on a model without reasoning support', () => {
    expect(() => serializeRequest(
      options([message('user', [{ type: 'text', text: 'hi' }])], { reasoningEffort: ReasoningEffortId('low') }),
      { supportsReasoning: false },
    )).toThrow(LlmError)
  })

  it('rejects an effort outside low/high/max', () => {
    expect(() => serializeRequest(
      options([message('user', [{ type: 'text', text: 'hi' }])], { reasoningEffort: ReasoningEffortId('off') }),
      { supportsReasoning: true },
    )).toThrow(/does not support reasoning effort "off"/)
  })

  it('replays assistant reasoning as reasoning_content beside tool_calls', () => {
    const assistant = message('assistant', [
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool-call', id: CallId('call_1'), name: 'read', arguments: '{}' },
    ])
    const body = serializeRequest(options([assistant]), { supportsReasoning: true })
    expect(body.messages[0]).toMatchObject({
      role: 'assistant',
      content: '',
      reasoning_content: 'thinking',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{}' } }],
    })
  })

  it('does not send temperature unless the plugin enables it', () => {
    const withTemp = options([message('user', [{ type: 'text', text: 'hi' }])], { temperature: 0.7 })
    expect(serializeRequest(withTemp).temperature).toBeUndefined()
    expect(serializeRequest(withTemp, { sendTemperature: true }).temperature).toBe(0.7)
  })

  it('expands a tool result into its own role:tool message', () => {
    const toolResult = message('user', [
      {
        type: 'tool-result',
        toolCallId: CallId('call_9'),
        content: [{ type: 'text', text: 'done' }],
      },
    ])
    const body = serializeRequest(options([toolResult]))
    expect(body.messages).toEqual([{ role: 'tool', tool_call_id: 'call_9', content: 'done' }])
  })

  it('rejects image content whose data URL was not prepared', () => {
    const withImage = message('user', [imageBlock('sha256:missing')])
    expect(() => serializeRequest(options([withImage]))).toThrow(/was not prepared/)
  })

  it('emits a prepared image as an inline image_url part beside text', () => {
    const images: PreparedImages = new Map([[AttachmentId('sha256:a'), 'data:image/png;base64,AAAA']])
    const withImage = message('user', [
      { type: 'text', text: 'look' },
      imageBlock('sha256:a'),
    ])
    const body = serializeRequest(options([withImage]), {}, images)
    expect(body.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    }])
  })

  it('carries a prepared image out of a tool result as parts', () => {
    const images: PreparedImages = new Map([[AttachmentId('sha256:b'), 'data:image/jpeg;base64,BBBB']])
    const toolResult = message('user', [
      {
        type: 'tool-result',
        toolCallId: CallId('call_5'),
        content: [{ type: 'text', text: 'shot' }, imageBlock('sha256:b')],
      },
    ])
    const body = serializeRequest(options([toolResult]), {}, images)
    expect(body.messages).toEqual([{
      role: 'tool',
      tool_call_id: 'call_5',
      content: [
        { type: 'text', text: 'shot' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
      ],
    }])
  })
})
