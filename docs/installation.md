---
title: Installation
description: >-
  Install the @phillarmonic/dsh-llm-kimi connector plugin and its DeepSeek
  Harness peer dependencies, then register it in cordis.yml and provide a Kimi
  Code API key.
icon: lucide/download
---

# Installation

## Install the package

```sh
pnpm add @phillarmonic/dsh-llm-kimi
```

## Peer dependencies

The harness packages are peer dependencies. Install them alongside the plugin if they are not already present:

```sh
pnpm add @deepseek-ai/cordis @deepseek-ai/dsh-llm @deepseek-ai/dsh-credentials \
  @deepseek-ai/dsh-settings @deepseek-ai/dsh-launch-environment @deepseek-ai/dsh-timeout \
  @deepseek-ai/dsh-attachment @deepseek-ai/schemastery
```

!!! note "Attachment service is optional at runtime"

    `@deepseek-ai/dsh-attachment` supplies the durable image store. Text-only
    requests never touch it. A request that carries images fails loudly when the
    service is not mounted. See [Image input](image-input.md).

## Requirements

- Node `^22.19 || >=24`
- ESM project (`"type": "module"`)
- A Kimi Code API key from the Kimi console at `api.kimi.com`

## Register the plugin

Add the plugin next to the `llm` capability in your `cordis.yml`. Every field is optional; the defaults target the public Kimi Code endpoint.

```yaml
plugins:
  llm: {}
  '@phillarmonic/dsh-llm-kimi':
    apiKeyEnv: KIMI_CODE_API_KEY
    reasoningEffort: low
```

## Provide the API key

Export the key in the launching environment:

```sh
export KIMI_CODE_API_KEY=sk-...
```

Or store it through the harness credentials service (the web Models page writes it there). The plugin resolves the key per request: the credentials service wins when present, otherwise the environment variable named by `apiKeyEnv` is the whole credential plane.

## Verify

Select provider `kimi-code` with model `k3` and run any task. The adapter streams the response and reports usage before the finish chunk.
