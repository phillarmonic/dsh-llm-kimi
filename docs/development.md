---
title: Development
description: >-
  Build, type-check, and test the @phillarmonic/dsh-llm-kimi connector plugin
  with pnpm, and run the bundled drun automation tasks with xdrun.
icon: lucide/wrench
---

# Development

## Manual installation

The [`dsh plugin`](installation.md) flow is the supported way to install the connector. When you build your own composition and manage `cordis.yml` directly, install the package and its peers by hand instead.

Add the package with your package manager:

```sh
pnpm add @phillarmonic/dsh-llm-kimi
```

The harness packages are peer dependencies. Install them alongside the plugin if they are not already present:

```sh
pnpm add @deepseek-ai/cordis @deepseek-ai/dsh-llm @deepseek-ai/dsh-credentials \
  @deepseek-ai/dsh-settings @deepseek-ai/dsh-launch-environment @deepseek-ai/dsh-timeout \
  @deepseek-ai/dsh-attachment @deepseek-ai/schemastery
```

Then register the plugin next to the `llm` capability in your `cordis.yml`. The `dsh plugin` path does this for you through the bundle's patch layer. Every field is optional; the defaults target the public Kimi Code endpoint.

```yaml
plugins:
  llm: {}
  '@phillarmonic/dsh-llm-kimi':
    apiKeyEnv: KIMI_CODE_API_KEY
    reasoningEffort: low
```

Provide the API key as described in [Installation](installation.md#provide-the-api-key).

## Setup

```sh
pnpm install
```

## Common tasks

```sh
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest run
pnpm run test:watch  # vitest in watch mode
pnpm run build       # tsdown bundle to lib/
```

The build emits `lib/index.js` and `lib/index.d.ts`.

## Automation with drun

The repository ships a [drun](https://github.com/phillarmonic/drun) spec at `.drun/spec.drun`. List the tasks:

```sh
xdrun --list
```

| Task | Description |
| --- | --- |
| `default` | Show available automation. |
| `install` | Install dependencies. |
| `typecheck` | Type-check the sources without emitting. |
| `test` | Run the unit test suite. |
| `watch` | Run the tests in watch mode. |
| `build` | Bundle the plugin into `lib/`. |
| `clean` | Remove build output. |
| `check` | Type-check, test, and build (CI mode). |

Run the full gate before pushing:

```sh
xdrun check
```

## Documentation

The documentation site is built with [Zensical](https://zensical.org/). Preview and build it from the repository root:

```sh
uv run zensical serve   # live preview
uv run zensical build   # static build into site/
```

## Project layout

- `src/` connector sources: `index.ts` (plugin), `adapter.ts` (LlmAdapter), `serialize.ts` (wire request), `types.ts` (wire message shapes).
- `tests/` vitest suites mirroring each source module.
- `docs/` this documentation.
- `lib/` build output (generated).
