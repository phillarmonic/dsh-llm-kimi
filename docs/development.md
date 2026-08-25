---
title: Development
description: >-
  Build, type-check, and test the @phillarmonic/dsh-llm-kimi connector plugin
  with pnpm, and run the bundled drun automation tasks with xdrun.
icon: lucide/wrench
---

# Development

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
