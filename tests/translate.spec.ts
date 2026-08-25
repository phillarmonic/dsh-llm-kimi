import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { mapFinishReason, mapUsage, translate } from '../src/translate.ts'

async function* payloads(items: string[]): AsyncGenerator<string> {
  for (const item of items) yield item
}

async function run(items: string[]): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of translate(payloads(items))) out.push(chunk)
  return out
}

describe('mapFinishReason', () => {
  it('maps the known wire vocabulary', () => {
    expect(mapFinishReason('stop')).toEqual({ kind: 'stop' })
    expect(mapFinishReason('tool_calls')).toEqual({ kind: 'tool-calls' })
    expect(mapFinishReason('length')).toEqual({ kind: 'max-tokens' })
  })

  it('turns an unknown reason into an error finish', () => {
    expect(mapFinishReason('content_filter')).toMatchObject({ kind: 'error', failure: { code: 'CONTENT_FILTER' } })
  })
})

describe('mapUsage', () => {
  it('subtracts cache reads to keep disjoint input counts', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 6 } }))
      .toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
  })

  it('reports reasoning tokens when present', () => {
    expect(mapUsage({ prompt_tokens: 3, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } }))
      .toEqual({ inputTokens: 3, outputTokens: 5, reasoningTokens: 2 })
  })
})

describe('translate', () => {
  it('emits text deltas, a block-end, usage, then finish', async () => {
    const chunks = await run([
      '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
      '{"choices":[{"delta":{"content":"hel"}}]}',
      '{"choices":[{"delta":{"content":"lo"}}]}',
      '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
      '[DONE]',
    ])
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hel' },
      { type: 'text-delta', index: 0, text: 'lo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('opens a reasoning block only after a non-empty reasoning delta', async () => {
    const chunks = await run([
      '{"choices":[{"delta":{"reasoning_content":""}}]}',
      '{"choices":[{"delta":{"reasoning_content":"why"}}]}',
      '{"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      '[DONE]',
    ])
    expect(chunks.filter(chunk => chunk.type === 'block-start')).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'text' },
    ])
    expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'why' })
  })

  it('assembles a streamed tool call from its fragments', async () => {
    const chunks = await run([
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"p\\":"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
      '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ])
    expect(chunks).toContainEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"p":1}' },
    })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('maps a stop with no content to an EMPTY_RESPONSE error finish', async () => {
    const chunks = await run([
      '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '[DONE]',
    ])
    expect(chunks).toEqual([
      { type: 'finish', reason: { kind: 'error', failure: { message: expect.any(String), code: 'EMPTY_RESPONSE' } } },
    ])
  })

  it('rejects a malformed SSE payload', async () => {
    await expect(run(['not json', '[DONE]'])).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
})
