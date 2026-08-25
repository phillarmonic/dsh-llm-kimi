import { describe, expect, it } from 'vitest'
import * as Kimi from '../src/index.ts'
import { resolveAdapterOptions } from '../src/index.ts'

describe('plugin metadata', () => {
  it('registers the llm-kimi plugin on the llm seam', () => {
    expect(Kimi.name).toBe('llm-kimi')
    expect(Kimi.inject).toEqual(['llm'])
    expect(typeof Kimi.apply).toBe('function')
  })
})

describe('resolveAdapterOptions defaults', () => {
  const resolved = resolveAdapterOptions({})

  it('points at the public Kimi Code endpoint with the documented key reference', () => {
    expect(resolved.baseURL).toBe('https://api.kimi.com/coding/v1')
    expect(String(resolved.apiKeyEnv)).toBe('KIMI_CODE_API_KEY')
  })

  it('defaults to the low reasoning tier and fixed sampling', () => {
    expect(resolved.defaults.reasoningEffort).toBe('low')
    expect(resolved.sendTemperature).toBe(false)
  })

  it('ships the four Kimi Code models with reasoning only on the K3 family', () => {
    expect(resolved.models.map(model => model.id)).toEqual([
      'k3',
      'k3-256k',
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ])
    const reasoningIds = resolved.models.filter(model => model.supportsReasoning).map(model => model.id)
    expect(reasoningIds).toEqual(['k3', 'k3-256k'])
  })

  it('rejects an out-of-range idle timeout', () => {
    expect(() => resolveAdapterOptions({ streamIdleTimeoutMs: -1 })).toThrow(/streamIdleTimeoutMs/)
  })

  it('honours a trusted base-url environment override', () => {
    const resolvedWithEnv = resolveAdapterOptions({}, {
      get: (key: string) => key === 'KIMI_BASE_URL' ? { value: 'https://example.test/v1' } : undefined,
    } as never)
    expect(resolvedWithEnv.baseURL).toBe('https://example.test/v1')
  })
})
