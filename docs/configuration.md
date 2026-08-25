---
title: Configuration
description: >-
  Full configuration reference for the @phillarmonic/dsh-llm-kimi connector:
  apiKeyEnv, baseURL, reasoningEffort, sendTemperature, maxTokens, image
  budgets, model catalog, idle timeout, and retry policy.
icon: lucide/settings
---

# Configuration

Every field lives under the plugin entry in `cordis.yml` and is optional. Defaults target the public Kimi Code endpoint with fixed sampling. Settings reload live: a changed value reaches the next request without a restart.

```yaml
plugins:
  llm: {}
  '@phillarmonic/dsh-llm-kimi':
    apiKeyEnv: KIMI_CODE_API_KEY
    reasoningEffort: low
    sendTemperature: false
```

## Reference

| Field | Default | Description |
| --- | --- | --- |
| `apiKeyEnv` | `KIMI_CODE_API_KEY` | Credential reference (environment-variable name) resolved per request. |
| `baseURL` | `https://api.kimi.com/coding/v1` | Endpoint base; `/chat/completions` is appended. Falls back to `$KIMI_BASE_URL` from a trusted environment layer. |
| `reasoningEffort` | `low` | Default thinking effort for the K3 family (`low`, `high`, `max`). |
| `sendTemperature` | `false` | Whether to forward an explicit sampling temperature. Kimi enforces fixed sampling, so this stays off by default. |
| `maxTokens` | `131072` | Default per-request output cap; a model's own cap and explicit request values win. |
| `defaultContextWindow` | `1048576` | Context capacity used when the selected model has no exact value. |
| `imagePixelBudget` | `8294400` | Reject a request image whose intrinsic pixel count exceeds this budget. Default is Kimi's 4K ceiling (3840x2160). |
| `imageMaxBytes` | `1048576` | Reject a request image whose encoded byte length exceeds this budget. Keeps inline base64 within Kimi's per-message size limit. |
| `models` | four Kimi Code models | Advisory catalog shown by discovery consumers. See [Models](models.md). |
| `streamIdleTimeoutMs` | `300000` | Maximum provider idle time while one stream read is outstanding. |
| `retryPolicy` | normal, five retries | Provider-owned model-request retry policy. |

## Reasoning effort

The K3 family (`k3`, `k3-256k`) accepts `low`, `high`, and `max`. An explicit per-request effort wins over the default. The always-thinking coding models (`kimi-for-coding`, `kimi-for-coding-highspeed`) have no effort selector, and the adapter never sends the field to them.

Kimi cannot disable thinking without routing to a weaker model, so the adapter never sends an `off` or `none` effort.

## Endpoint override

For a private or proxied endpoint, set `baseURL` directly, or export `KIMI_BASE_URL` from a trusted environment layer. An explicit `baseURL` in `cordis.yml` wins over the environment.

## Image budgets

`imagePixelBudget` and `imageMaxBytes` are enforced inside the plugin from the durable attachment metadata, before any bytes are read. See [Image input](image-input.md) for the full flow.

## Custom model catalog

Override `models` to advertise a different catalog to discovery consumers. Each entry keeps its `supportsReasoning` and `supportsImage` flags; requests to the endpoint remain unrestricted regardless of the advisory catalog. See [Models](models.md).
