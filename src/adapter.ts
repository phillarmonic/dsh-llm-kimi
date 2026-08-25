/**
 * `KimiAdapter`: fetch + SSE against a Kimi Code (OpenAI-compatible)
 * chat-completions endpoint, emitting harness StreamChunks. The adapter is
 * transport-only: connection facts arrive through a thunk resolved once per
 * operation and the bearer token through a per-request resolver, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * @module @phillarmonic/dsh-llm-kimi/adapter
 */

import {
  attributionHeaders,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { serializeRequest } from './serialize.ts'
import type { RequestDefaults } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import type { WireError, WireRequest } from './types.ts'

/** One optional model entry advertised by the direct-fetch adapter. */
export interface KimiCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail. */
  description?: string
  /** Known combined request/response context capacity; omission uses the profile default. */
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link KimiConnectionOptions.maxTokens}. */
  maxTokens?: number
  /**
   * Whether this model accepts a `reasoning_effort` field. The K3 family
   * exposes effort levels; the always-thinking coding models do not, and this
   * adapter never sends the field to them.
   */
  supportsReasoning?: boolean
}

/**
 * Validated connection facts for one operation. The plugin's
 * `resolveAdapterOptions` is the one explicit resolve step producing this
 * shape; the adapter trusts it and re-reads it per operation, which is what
 * makes a configuration change reach the next request without re-registration.
 */
export interface KimiConnectionOptions {
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL: string
  /**
   * Credential reference of this same resolution, resolved per request. It
   * travels with the endpoint so a request can never pair one generation's URL
   * with another generation's secret.
   */
  apiKeyEnv: CredentialRef
  /** Request defaults applied to every reasoning-capable call. */
  defaults: { reasoningEffort?: 'low' | 'high' | 'max' }
  /** Whether to forward an explicit sampling temperature; Kimi rejects it unless enabled. */
  sendTemperature: boolean
  /** Default per-request output cap; explicit request values win. */
  maxTokens: number
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow: number
  /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
  models: readonly KimiCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned model-request retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
}

/** Constructor options for {@link KimiAdapter}: the operation-local resolution hooks the plugin owns. */
export interface KimiAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => KimiConnectionOptions
  /**
   * Resolve the bearer token for the connection facts of one request. The
   * snapshot is passed in — never re-read — so the key can only ever come from
   * the same resolution as the endpoint it is sent to. Throws `LlmError`
   * `MISSING_CREDENTIAL` when no key is available anywhere.
   */
  resolveApiKey: (connection: KimiConnectionOptions) => Promise<string>
}

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Default combined request/response context capacity (K3 large-context tier). */
export const DEFAULT_CONTEXT_WINDOW = 1_048_576
/** Default per-request output-token cap; stays below the 262144 request-token limit. */
export const DEFAULT_MAX_TOKENS = 131_072
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')
const REASONING_EFFORTS = [
  { id: LOW_REASONING_EFFORT, name: 'Low' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
  { id: MAX_REASONING_EFFORT, name: 'Max' },
] as const

function modelInfo(provider: string, model: KimiCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: ['text'],
  }
}

function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/** Kimi context-overflow wording not covered by the shared OpenAI-compat classifier. */
const KIMI_CONTEXT_OVERFLOW = /exceeded model token limit|total message size .*exceeds|message size .*exceeds limit/i

/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status: number, error?: WireError['error']): string {
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 401) return 'AUTH'
  // 403 spans terminated access (auth) and exhausted quota; quota wording wins.
  if (status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 413) return 'INVALID_REQUEST'
  if (status === 400) {
    if (isContextWindowExceededError(detail) || KIMI_CONTEXT_OVERFLOW.test(detail)) {
      return CONTEXT_WINDOW_EXCEEDED_CODE
    }
    return 'INVALID_REQUEST'
  }
  if (status === 404) return 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * The Kimi Code `LlmAdapter`. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export class KimiAdapter extends LlmAdapter {
  constructor(private readonly config: KimiAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Kimi Code' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)))
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.modelInfoFor(this.config.options(), provider, model))
  }

  private modelInfoFor(
    connection: KimiConnectionOptions,
    provider: string,
    model: string,
  ): LlmResolvedModelInfo {
    const configured = connection.models.find(entry => entry.id === model)
    const contextWindow = configured?.contextWindow ?? connection.defaultContextWindow
    const base: LlmResolvedModelInfo = {
      // An uncatalogued endpoint is treated as text-only.
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
    }
    // Reasoning is per-model: the K3 family exposes effort levels; the
    // always-thinking coding models (and an unknown endpoint) advertise none.
    if (configured?.supportsReasoning !== true) return base
    return {
      ...base,
      reasoning: {
        efforts: REASONING_EFFORTS,
        defaultEffort: connection.defaults.reasoningEffort === 'max'
          ? MAX_REASONING_EFFORT
          : connection.defaults.reasoningEffort === 'high'
            ? HIGH_REASONING_EFFORT
            : LOW_REASONING_EFFORT,
      },
    }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithConnection(options, this.config.options())
  }

  private async * streamWithConnection(
    options: GenerateOptions,
    connection: KimiConnectionOptions,
  ): AsyncIterable<StreamChunk> {
    // One resolution per stream call: connection facts and the credential
    // freeze here and hold for this whole request, so an in-flight stream
    // never observes a configuration change and the next call re-resolves.
    const apiKey = await this.config.resolveApiKey(connection)
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(
      options,
      watchdog.signal,
      connection,
      apiKey,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(
          `Kimi stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      if (options.signal?.aborted) {
        throw new LlmError('Kimi request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError(`Kimi API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('Kimi stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch (_abortedTransportTeardown) {
          // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
        }
      }
    }
  }

  private async * request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: KimiConnectionOptions,
    apiKey: string,
    onActivity: () => void,
  ): AsyncIterable<StreamChunk> {
    const model = connection.models.find(entry => entry.id === options.model)
    const defaults: RequestDefaults = {
      ...connection.defaults.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: connection.defaults.reasoningEffort },
      supportsReasoning: model?.supportsReasoning ?? false,
      sendTemperature: connection.sendTemperature,
    }
    const body: WireRequest = serializeRequest(options, defaults)
    const headers = {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      ...attributionHeaders(),
    }
    const payload = JSON.stringify(body)

    let response: Response
    try {
      response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: payload,
        signal,
      })
    } catch (error: unknown) {
      if (signal.aborted) throw error
      throw new LlmError(
        `Kimi API request to ${connection.baseURL} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `Kimi API error (HTTP ${response.status})`
      let providerError: WireError['error']
      const rawResponse = await response.text()
      try {
        const parsed = JSON.parse(rawResponse) as WireError
        providerError = parsed.error
        if (providerError?.message) message = providerError.message
      } catch {
        // The HTTP status remains authoritative when a gateway returns malformed JSON.
      }
      const delay = providerRetryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        cause: new Error(rawResponse.length > 0 ? rawResponse : `Kimi HTTP ${response.status}`),
        status: response.status,
        ...delay === undefined ? {} : { providerRetryAfterMs: delay },
        ...id === undefined ? {} : { requestId: id },
      })
    }
    if (!response.body) {
      throw new LlmError('Kimi API returned no response body', 'EMPTY_RESPONSE')
    }

    yield* translate(parseSse(response.body, onActivity))
  }
}
