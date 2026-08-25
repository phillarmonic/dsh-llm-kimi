import { describe, expect, it } from 'vitest'
import { LlmError, CallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { serializeRequest } from '../src/serialize.ts'
import type { RequestDefaults } from '../src/serialize.ts'

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

  it('rejects image content instead of dropping it', () => {
    const withImage = message('user', [{ type: 'image' } as unknown as ContentBlock])
    expect(() => serializeRequest(options([withImage]))).toThrow(/does not support image content/)
  })
})
