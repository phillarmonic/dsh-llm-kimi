---
title: Behavior and limits
description: >-
  Runtime behavior of the @phillarmonic/dsh-llm-kimi connector: fixed sampling,
  reasoning_content replay on tool-call turns, streaming idle timeout, and
  HTTP error mapping to harness LlmError codes.
icon: lucide/info
---

# Behavior and limits

## Fixed sampling

Kimi enforces fixed sampling. The adapter does not send `temperature`, `top_p`, or `n` unless `sendTemperature` is enabled in [Configuration](configuration.md). Even then, only an explicit request temperature is forwarded.

## Reasoning replay on tool calls

While thinking is enabled, an assistant message with tool calls must carry its `reasoning_content`. The adapter replays the harness reasoning block onto that field so multi-turn tool sessions stay valid and Kimi does not reject the turn.

## Streaming

Responses stream as harness `StreamChunk`s: text deltas, reasoning deltas, a usage chunk, and a final finish chunk. Reported usage subtracts cache reads so the input-token count reflects billed tokens.

An idle-timeout watchdog guards every stream. If the provider stalls longer than `streamIdleTimeoutMs` (default 300000 ms) while a read is outstanding, the stream fails with a `TIMEOUT` error.

## Error mapping

The adapter maps HTTP failures onto harness `LlmError` codes:

| HTTP status | Condition | `LlmError` code |
| --- | --- | --- |
| 401, 403 | Authentication rejected | `AUTH` |
| 429 | Rate limited | `RATE_LIMIT` |
| 429 | Quota or usage limit wording | `QUOTA` |
| 400 | Context window exceeded | `CONTEXT_WINDOW_EXCEEDED` |
| 400, 404, 413 | Invalid request | `INVALID_REQUEST` |
| 5xx | Server error | `SERVER` |

A caller abort surfaces as `ABORTED`. A missing API key surfaces as `MISSING_CREDENTIAL`.

## Token limits

- Per-request token limit: 262,144.
- Total message byte size limit: 2,097,152 (2 MiB). The image byte budget keeps inline base64 within this bound. See [Image input](image-input.md).

## Transient server errors

The Kimi endpoint can occasionally return a `500` `server_error`. These map to `SERVER` and are covered by the provider retry policy (`retryPolicy`, normal with five retries by default).
