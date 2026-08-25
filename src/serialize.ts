/**
 * Serialize harness messages into Kimi chat completions. Kimi speaks the
 * OpenAI chat-completions dialect. Image content is emitted as inline
 * `image_url` base64 data-URL parts, resolved ahead of serialization into the
 * {@link PreparedImages} map keyed by attachment id. Assistant turns replay
 * their reasoning as `reasoning_content` — Kimi requires it on tool-call turns
 * while thinking is enabled.
 *
 * @module @phillarmonic/dsh-llm-kimi/serialize
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { WireContentPart, WireMessage, WireRequest, WireTool } from './types.ts'

/**
 * Inline image data URLs resolved before serialization, keyed by attachment
 * id. The adapter reads each referenced image through the durable attachment
 * service and encodes it as a `data:<mediaType>;base64,<bytes>` URL; serialize
 * only looks the URL up, so it stays synchronous and pure.
 */
export type PreparedImages = ReadonlyMap<AttachmentId, string>

/** Adapter-level request defaults derived from plugin config and the selected model. */
export interface RequestDefaults {
  /** Global default effort applied to reasoning-capable models. */
  reasoningEffort?: 'low' | 'high' | 'max'
  /** Whether the selected model accepts a `reasoning_effort` field (K3 family). */
  supportsReasoning?: boolean
  /** Whether to forward an explicit sampling temperature; Kimi rejects it unless enabled. */
  sendTemperature?: boolean
}

/** Validate an adapter-owned effort against Kimi's accepted levels. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'low' | 'high' | 'max' {
  if (effort === 'low' || effort === 'high' || effort === 'max') return effort as 'low' | 'high' | 'max'
  throw new LlmError(
    `Kimi does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Resolve the `reasoning_effort` to send, or `undefined` to omit it. Models
 * without reasoning support never carry the field, and an explicit effort on
 * such a model is rejected rather than downgraded. Kimi cannot disable
 * thinking without routing to a weaker model, so this adapter never emits an
 * `off`/`none` effort.
 */
function resolveEffort(
  options: GenerateOptions,
  defaults: RequestDefaults,
): 'low' | 'high' | 'max' | undefined {
  const explicit = options.reasoningEffort === undefined
    ? undefined
    : reasoningEffort(options.reasoningEffort)
  if (defaults.supportsReasoning !== true) {
    if (explicit !== undefined) {
      throw new LlmError(
        `Kimi model "${options.model}" does not accept a reasoning effort`,
        'UNSUPPORTED_REASONING_EFFORT',
      )
    }
    return undefined
  }
  // Session titles want the cheapest thinking tier; Kimi keeps thinking on.
  if (options.purpose === 'session-title') return explicit ?? 'low'
  return explicit ?? defaults.reasoningEffort
}

/** Join the text blocks of a message (used for system/user/tool-result content). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Resolve one durable image block into its inline `image_url` part. */
function imagePart(
  block: Extract<ContentBlock, { type: 'image' }>,
  images: PreparedImages,
): WireContentPart {
  const url = images.get(block.attachment.attachmentId)
  if (url === undefined) {
    throw new LlmError(
      `Kimi request image ${block.attachment.attachmentId} was not prepared.`,
      'INVALID_REQUEST',
    )
  }
  return { type: 'image_url', image_url: { url } }
}

/**
 * Convert a block list into ordered text and image parts. Nested tool-result
 * blocks are flattened so a tool result that returns an image still reaches the
 * model; empty text blocks are dropped.
 */
function contentParts(blocks: readonly ContentBlock[], images: PreparedImages): WireContentPart[] {
  const parts: WireContentPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
        break
      case 'image':
        parts.push(imagePart(block, images))
        break
      case 'tool-result':
        parts.push(...contentParts(block.content, images))
        break
      default:
        break
    }
  }
  return parts
}

/** True when any part is an inline image. */
function hasImagePart(parts: readonly WireContentPart[]): boolean {
  return parts.some(part => part.type === 'image_url')
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — never null. Pure tool-call turns replay the
    // (empty) message content, and a null-content/no-tool_calls assistant
    // message is rejected; since the message sits durably in the session log,
    // a null here would brick every later turn of that session.
    content: text,
    // CoT passback on every reasoning-carrying turn. Kimi REQUIRES it on
    // tool-call turns while thinking is enabled (a missing value there is an
    // HTTP 400) and ignores it elsewhere.
    ...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text and images
 * first and its tool results as separate wire messages after. A user or tool
 * message carrying image content is emitted as an ordered parts array;
 * text-only messages keep the compact string form.
 * @param messages - the harness conversation, in order.
 * @param images - inline image data URLs resolved by attachment id.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(
  messages: readonly Message[],
  images: PreparedImages = new Map(),
): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but Kimi wants them as role:'tool' messages.
    const toolResults = message.content.filter(
      (block): block is Extract<ContentBlock, { type: 'tool-result' }> => block.type === 'tool-result',
    )
    const nonToolBlocks = message.content.filter(block => block.type !== 'tool-result')
    const parts = contentParts(nonToolBlocks, images)
    if (hasImagePart(parts)) {
      wire.push({ role: 'user', content: parts })
    } else {
      const text = flattenText(message.content)
      if (text.length > 0 || toolResults.length === 0) {
        wire.push({ role: 'user', content: text })
      }
    }
    for (const result of toolResults) {
      const resultParts = contentParts(result.content, images)
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs some content on the wire; images ride
        // as parts, text-only results keep the compact string form.
        content: hasImagePart(resultParts)
          ? resultParts
          : flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply. `temperature` is sent only when the plugin enables
 * it, since Kimi enforces fixed sampling.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level defaults; undefined fields put nothing on the wire.
 * @param images - inline image data URLs resolved by attachment id.
 * @returns the chat-completions request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
  images: PreparedImages = new Map(),
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages, images))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const effort = resolveEffort(options, defaults)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...effort !== undefined ? { reasoning_effort: effort } : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...defaults.sendTemperature === true && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}
