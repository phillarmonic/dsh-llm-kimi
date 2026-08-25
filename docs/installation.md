---
title: Installation
description: >-
  Install the @phillarmonic/dsh-llm-kimi connector plugin into a DeepSeek
  Harness profile with dsh plugin, then provide a Kimi Code API key.
icon: lucide/download
---

# Installation

## Install with `dsh plugin`

The package is a DeepSeek Harness **bundle**: its manifest declares `dsh.bundle`, so `dsh plugin` installs it and activates its `cordis.patch.yml` layer automatically. From any directory, add it to a profile:

```sh
dsh plugin --profile <name> add @phillarmonic/dsh-llm-kimi
```

`dsh plugin` forwards to pnpm in the profile directory, then appends the package to `dsh.profile.bundles`. The bundle set is read at profile start, so restart the profile after installing:

```sh
dsh --profile <name>
```

Verify the layer before booting, or remove the bundle later:

```sh
dsh --profile <name> --dump-config                       # shows a "@phillarmonic/dsh-llm-kimi" layer
dsh plugin --profile <name> remove @phillarmonic/dsh-llm-kimi
```

The bundle's patch layer registers the plugin next to the `llm` capability for you, so no `cordis.yml` edit is needed. Every config field is optional and the defaults target the public Kimi Code endpoint; see [Configuration](configuration.md) to tune them.

!!! note "Attachment service is optional at runtime"

    Image support uses `@deepseek-ai/dsh-attachment`, the durable image store.
    Text-only requests never touch it. A request that carries images fails
    loudly when the service is not mounted. See [Image input](image-input.md).

## Requirements

- Node `^22.19 || >=24`
- ESM project (`"type": "module"`)
- A Kimi Code API key from the Kimi console at `api.kimi.com`

## Provide the API key

Export the key in the launching environment:

```sh
export KIMI_CODE_API_KEY=sk-...
```

Or store it through the harness credentials service (the web Models page writes it there). The plugin resolves the key per request: the credentials service wins when present, otherwise the environment variable named by `apiKeyEnv` is the whole credential plane.

## Verify

Select provider `kimi-code` with model `k3` and run any task. The adapter streams the response and reports usage before the finish chunk.

## Composing `cordis.yml` directly

Building your own composition instead of using a profile? See [manual installation](development.md#manual-installation) for the raw `pnpm add`, peer-dependency, and `cordis.yml` registration steps.
