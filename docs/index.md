---
title: Kimi connector for DeepSeek Harness
description: >-
  @phillarmonic/dsh-llm-kimi is a Kimi K3 (Moonshot) connector plugin for the
  DeepSeek Harness llm capability seam. Stream Kimi Code chat completions with
  reasoning effort and image input, configured entirely from cordis.yml.
icon: lucide/bot
---

# Kimi connector for DeepSeek Harness

`@phillarmonic/dsh-llm-kimi` is a [Kimi K3](https://www.kimi.com/) (Moonshot AI) connector plugin for the [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh-llm) `llm` capability seam.

It registers a direct-fetch `LlmAdapter` for the `kimi-code` provider route and streams Kimi Code chat completions, an OpenAI-compatible dialect, as harness `StreamChunk`s. Connection facts resolve per request, so a changed base URL, model catalog, or API key reaches the next request without a restart.

## Why this plugin

- **Native Kimi Code endpoint.** Talks to `https://api.kimi.com/coding/v1/chat/completions` with bearer auth and genuine attribution headers.
- **Streaming with reasoning.** Streams text and reasoning deltas, replays `reasoning_content` on tool-call turns so multi-turn tool sessions stay valid.
- **Image input.** All four Kimi Code models accept images; the plugin reads them through the harness attachment service and inlines them as base64 `image_url` data URLs.
- **Safe defaults.** Fixed sampling by default (no `temperature`, `top_p`, or `n`), sensible token and context defaults, and an idle-timeout watchdog on every stream.
- **Configured from `cordis.yml`.** Every deployment-varying choice is a validated config field that reloads live.

## Quick start

```sh
pnpm add @phillarmonic/dsh-llm-kimi
```

Add the plugin to your `cordis.yml` and export your Kimi Code key:

```yaml
plugins:
  llm: {}
  '@phillarmonic/dsh-llm-kimi':
    reasoningEffort: low
```

```sh
export KIMI_CODE_API_KEY=sk-...
```

Then select provider `kimi-code` and a model such as `k3` when you run a task.

Continue with [Installation](installation.md), [Configuration](configuration.md), and [Image input](image-input.md).

## At a glance

| | |
| --- | --- |
| Package | [`@phillarmonic/dsh-llm-kimi`](https://www.npmjs.com/package/@phillarmonic/dsh-llm-kimi) |
| Provider route | `kimi-code` |
| Endpoint | `https://api.kimi.com/coding/v1` |
| Models | `k3`, `k3-256k`, `kimi-for-coding`, `kimi-for-coding-highspeed` |
| Image input | Yes, all four models |
| Runtime | Node `^22.19 || >=24`, ESM |
| License | MIT |
| Source | [github.com/phillarmonic/dsh-llm-kimi](https://github.com/phillarmonic/dsh-llm-kimi) |
