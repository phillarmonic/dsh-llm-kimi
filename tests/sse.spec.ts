import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { DONE, parseSse } from '../src/sse.ts'

/** Build an SSE byte stream from raw `data:` payloads. */
function sseStream(payloads: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const payload of parseSse(stream)) out.push(payload)
  return out
}

describe('parseSse', () => {
  it('yields each data payload and stops at [DONE]', async () => {
    const payloads = await collect(sseStream(['{"a":1}', '{"b":2}', DONE]))
    expect(payloads).toEqual(['{"a":1}', '{"b":2}', DONE])
  })

  it('ignores content after the [DONE] sentinel', async () => {
    const payloads = await collect(sseStream(['{"a":1}', DONE, '{"ignored":true}']))
    expect(payloads).toEqual(['{"a":1}', DONE])
  })

  it('raises STREAM_CLOSED when the stream ends without [DONE]', async () => {
    await expect(collect(sseStream(['{"a":1}']))).rejects.toMatchObject({
      constructor: LlmError,
      code: 'STREAM_CLOSED',
    })
  })

  it('reports comments only through the activity callback', async () => {
    const encoder = new TextEncoder()
    const comments: string[] = []
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': keep-alive\n\n'))
        controller.enqueue(encoder.encode(`data: ${DONE}\n\n`))
        controller.close()
      },
    })
    const out: string[] = []
    for await (const payload of parseSse(stream, comment => comments.push(comment))) out.push(payload)
    expect(out).toEqual([DONE])
    expect(comments).toEqual(['keep-alive'])
  })
})
