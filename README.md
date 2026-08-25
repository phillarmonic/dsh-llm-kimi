# @phillarmonic/dsh-llm-kimi

A Kimi K3 connector plugin for the [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh-llm) `llm` capability seam.

It registers a direct-fetch `LlmAdapter` for the `kimi-code` provider route, streaming Kimi Code chat completions (an OpenAI-compatible dialect) as harness `StreamChunk`s. Connection facts resolve per request, so a changed base URL, catalog, or key reaches the next request without a restart.

## Install

```sh
pnpm add @phillarmonic/dsh-llm-kimi
```

The harness packages are peer dependencies; install them alongside the plugin if they are not already present:

```sh
pnpm add @deepseek-ai/cordis @deepseek-ai/dsh-llm @deepseek-ai/dsh-credentials \
  @deepseek-ai/dsh-settings @deepseek-ai/dsh-launch-environment @deepseek-ai/dsh-timeout \
  @deepseek-ai/schemastery
```

## Configure

Add the plugin to your `cordis.yml`. Every field is optional; the defaults target the public Kimi Code endpoint.

```yaml
plugins:
  llm: {}
  '@phillarmonic/dsh-llm-kimi':
    apiKeyEnv: KIMI_CODE_API_KEY
    reasoningEffort: low
```

Then export your key (from the Kimi Code console at `api.kimi.com`) or store it through the harness credentials service:

```sh
export KIMI_CODE_API_KEY=sk-...
```

Select the provider and a model when you run a task, for example provider `kimi-code` with model `k3`.

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `apiKeyEnv` | `KIMI_CODE_API_KEY` | Credential reference (environment-variable name) resolved per request. |
| `baseURL` | `https://api.kimi.com/coding/v1` | Endpoint base; `/chat/completions` is appended. Falls back to `$KIMI_BASE_URL` from a trusted environment layer. |
| `reasoningEffort` | `low` | Default thinking effort for the K3 family (`low`, `high`, `max`). |
| `sendTemperature` | `false` | Whether to forward an explicit sampling temperature. Kimi enforces fixed sampling, so this stays off by default. |
| `maxTokens` | `131072` | Default per-request output cap; a model's own cap and explicit request values win. |
| `defaultContextWindow` | `1048576` | Context capacity used when the selected model has no exact value. |
| `models` | four Kimi Code models | Advisory catalog shown by discovery consumers. |
| `streamIdleTimeoutMs` | `300000` | Maximum provider idle time while one stream read is outstanding. |
| `retryPolicy` | normal, five retries | Provider-owned model-request retry policy. |

## Models

| Model id | Context | Reasoning effort |
| --- | --- | --- |
| `k3` | 1,048,576 | low / high / max |
| `k3-256k` | 262,144 | low / high / max |
| `kimi-for-coding` | 262,144 | always on (no effort levels) |
| `kimi-for-coding-highspeed` | 262,144 | always on (no effort levels) |

## Behavior notes

- This connector is text-only. Image content is rejected rather than silently dropped.
- Kimi enforces fixed sampling. The adapter does not send `temperature`, `top_p`, or `n` unless `sendTemperature` is enabled.
- While thinking is enabled, an assistant message with tool calls must carry its `reasoning_content`. The adapter replays the harness reasoning block onto that field so multi-turn tool sessions stay valid.
- Kimi cannot disable thinking without routing to a weaker model, so the adapter never sends an `off` or `none` effort. The K3 family exposes `low`, `high`, and `max`; the coding models keep thinking on with no effort selector.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## License

MIT. See [LICENSE](LICENSE).
