/**
 * Kimi Code chat-completions wire format (OpenAI-compatible). Types only.
 *
 * Source of truth: the official Kimi Code docs (www.kimi.com/code/docs/en),
 * covering `/coding/v1/chat/completions`, streaming, reasoning effort, and the
 * tool-call format. Kimi speaks the OpenAI chat-completions dialect, so the
 * wire shapes mirror it. User and tool messages carry either a plain string or
 * an ordered array of text and inline `image_url` parts when the request
 * includes image content.
 *
 * @module @phillarmonic/dsh-llm-kimi/types
 */

/** Request body for `POST {baseURL}/chat/completions`. */
export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  /**
   * Thinking effort for reasoning-capable models (K3 family). Kimi's server
   * default is `high`; `none` disables thinking and downgrades the request to
   * a weaker model, so this adapter never sends it.
   */
  reasoning_effort?: 'low' | 'high' | 'max'
  tools?: WireTool[]
  /**
   * Sampling temperature. Kimi enforces fixed sampling and rejects overrides,
   * so this is sent only when the plugin is explicitly configured to forward
   * it.
   */
  temperature?: number
  max_tokens?: number
  /**
   * Stop sequences (OpenAI `stop`): generation halts as soon as the model
   * produces any one of these strings. Mapped from `GenerateOptions.stop`.
   */
  stop?: string[]
}

/** System-role message: a single string of instructions. */
export interface WireSystemMessage {
  role: 'system'
  content: string
}

/** A plain-text segment of a multimodal message. */
export interface WireTextContentPart {
  type: 'text'
  text: string
}

/** An inline base64 data-URL image segment of a multimodal message. */
export interface WireImageContentPart {
  type: 'image_url'
  image_url: { url: string }
}

/** One ordered segment of a multimodal user or tool message. */
export type WireContentPart = WireTextContentPart | WireImageContentPart

/** User-role message: a single string, or ordered text and inline image parts. */
export interface WireUserMessage {
  role: 'user'
  content: string | WireContentPart[]
}

/** Tool-role message: the result of one tool call, keyed by its call id; a string, or ordered parts when it carries images. */
export interface WireToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string | WireContentPart[]
}

/**
 * Assistant-role history message. The harness replays `content: ""` (never
 * null) on tool-call-only turns — some gateways reject null — and sends null
 * only when the turn carried neither text nor tool calls.
 */
export interface WireAssistantMessage {
  role: 'assistant'
  content: string | null
  /**
   * CoT passback. REQUIRED on tool-call turns while thinking is enabled: Kimi
   * rejects a tool-call assistant message with missing `reasoning_content`
   * (HTTP 400). Present on every turn whose assistant content carried
   * reasoning; ignored elsewhere.
   */
  reasoning_content?: string
  tool_calls?: WireToolCall[]
}

/** One entry of the request `messages` array, discriminated on `role`. */
export type WireMessage =
  | WireSystemMessage
  | WireUserMessage
  | WireAssistantMessage
  | WireToolMessage

/** A completed tool call replayed on an assistant history message; `arguments` is the raw JSON string. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One entry of the request `tools` array; `parameters` is a JSON Schema object. */
export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** One parsed SSE `data:` payload (a chat.completion.chunk). */
export interface WireChunk {
  choices?: WireChoice[]
  /** Arrives attached to the finish chunk and/or as a trailing usage-only chunk. */
  usage?: WireUsage | null
}

/** One streamed choice (requests always ask for a single one); `finish_reason` is non-null only on its terminal chunk. */
export interface WireChoice {
  delta?: WireDelta
  finish_reason?: string | null
}

/** The incremental content of one streamed choice; any subset of fields may be present per chunk. */
export interface WireDelta {
  role?: string
  /** Visible text. Null/empty on reasoning/tool-call chunks. */
  content?: string | null
  /**
   * Thinking-mode CoT. The first chunk may carry an empty string (which must
   * not open a reasoning block); absent entirely in non-thinking mode.
   */
  reasoning_content?: string | null
  tool_calls?: WireToolCallDelta[]
}

/** A streamed fragment of one tool call; fragments sharing an `index` concatenate into one call. */
export interface WireToolCallDelta {
  /** Disambiguates parallel tool calls; stable across a call's deltas. */
  index: number
  /** Present on the first delta of each call only. */
  id?: string
  type?: 'function'
  function?: {
    /** Present on the first delta of each call only. */
    name?: string
    /** Argument JSON fragment (concatenate across deltas). */
    arguments?: string
  }
}

/**
 * Wire token accounting. When present, `prompt_tokens` INCLUDES cache hits;
 * `mapUsage` subtracts them to keep the harness convention of disjoint counts.
 * `prompt_tokens_details.cached_tokens` is the OpenAI-compat spelling of the
 * hit count.
 */
export interface WireUsage {
  prompt_tokens: number
  completion_tokens: number
  prompt_cache_hit_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** Non-2xx error body. */
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}
