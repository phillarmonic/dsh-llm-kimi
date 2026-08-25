---
title: Models
description: >-
  The four Kimi Code models exposed by @phillarmonic/dsh-llm-kimi: k3, k3-256k,
  kimi-for-coding, and kimi-for-coding-highspeed, with context windows,
  reasoning effort, and image support.
icon: lucide/boxes
---

# Models

The plugin ships an advisory catalog of the four Kimi Code models. The catalog drives model discovery; requests to the endpoint are not restricted by it, so you can call any model id the endpoint accepts.

| Model id | Context | Reasoning effort | Image input |
| --- | --- | --- | --- |
| `k3` | 1,048,576 | low / high / max | yes |
| `k3-256k` | 262,144 | low / high / max | yes |
| `kimi-for-coding` | 262,144 | always on (no effort levels) | yes |
| `kimi-for-coding-highspeed` | 262,144 | always on (no effort levels) | yes |

## Reasoning

- **K3 family** (`k3`, `k3-256k`): exposes `low`, `high`, and `max` reasoning effort. The default is `low`; override per request or with the `reasoningEffort` config field.
- **Coding models** (`kimi-for-coding`, `kimi-for-coding-highspeed`): thinking is always on with no effort selector. The adapter never sends a `reasoning_effort` field to them.

## Image input

All four models accept image content. The adapter advertises `text` and `image` input modalities for a model whose catalog entry sets `supportsImage`. See [Image input](image-input.md).

## Selecting a model

Select provider `kimi-code` and the model id when you run a task. For the largest context window, use `k3`.

## Overriding the catalog

Set the `models` field in `cordis.yml` to change the advertised catalog. Each entry may set `contextWindow`, `maxTokens`, `supportsReasoning`, and `supportsImage`. A model marked without image support rejects image content rather than silently dropping it.
