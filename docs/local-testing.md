---
title: Local testing
description: >-
  Test the @phillarmonic/dsh-llm-kimi connector inside a local DeepSeek Harness
  before publishing to npm, using a global pnpm link, a tarball, or a file
  dependency, plus notes on peer resolution and the attachment API.
icon: lucide/flask-conical
---

# Local testing

Try the connector against a real DeepSeek Harness before publishing to npm. Pick the method that matches where you are testing.

## Testing inside the harness monorepo

When the target is the `deepseek-harness` monorepo itself, use a link so the plugin resolves the workspace's own `@deepseek-ai/dsh-*` packages instead of the pinned published versions. This sidesteps peer-version skew.

Build the plugin so `lib/` exists:

```sh
# in the plugin repo
pnpm run build
```

Link the plugin directory into the harness:

```sh
# in the harness monorepo root
pnpm link /absolute/path/to/deepseek-harness-kimi-connector-plugin
```

This creates a symlink at `node_modules/@phillarmonic/dsh-llm-kimi` in the harness pointing at your working tree. pnpm does not install the plugin's peer dependencies through a link. They resolve at runtime from the harness workspace packages, so the plugin runs against the same `ctx.llm` and `ctx.attachments` the harness provides.

!!! tip "Global link alternative"

    A two-step global link also works: `pnpm link --global .` in the plugin repo,
    then `pnpm link --global @phillarmonic/dsh-llm-kimi` in the harness. The
    single-step directory form above avoids pnpm version quirks around the
    global self-link.

!!! note "Unmet-peer warnings are expected"

    The plugin pins its peers to the published release line. A monorepo that is
    ahead of that line prints unmet-peer warnings on link. They are warnings, not
    failures. Loosen the peer ranges in `package.json` to `*` temporarily to
    silence them if you prefer a clean log.

Unlink when finished:

```sh
# in the harness
pnpm unlink @phillarmonic/dsh-llm-kimi
```

## Testing in a consuming project

When the target is a separate application that consumes the published harness packages, install a tarball. It mirrors a real publish and honors the `files` allowlist, catching missing-file mistakes that linking hides.

```sh
# in the plugin repo
pnpm run build
npm pack   # produces phillarmonic-dsh-llm-kimi-<version>.tgz
```

```sh
# in the consuming project
pnpm add /absolute/path/to/phillarmonic-dsh-llm-kimi-<version>.tgz
```

A local path dependency works too, and picks up rebuilds without re-adding:

```sh
pnpm add file:/absolute/path/to/deepseek-harness-kimi-connector-plugin
```

## Wire it into cordis.yml

Register the plugin next to `llm` in whichever `cordis.yml` you run, then provide the key:

```yaml
plugins:
  llm: {}
  '@phillarmonic/dsh-llm-kimi':
    reasoningEffort: low
```

```sh
export KIMI_CODE_API_KEY=sk-...
```

Run a task through the harness. The plugin ships built ESM in `lib/`, so it loads cleanly even when the harness launches from source. Rebuild the plugin (`pnpm run build`, or `pnpm exec tsdown --watch` while iterating) and restart the harness to pick up changes.

## Peer dependencies

The harness packages are peer dependencies, so a single shared copy backs the capability seam. A link resolves them from the target; a tarball or file dependency requires the consuming project to already provide them. If `ctx.llm` or `ctx.attachments` registration does not match, confirm the plugin is resolving the target's harness packages rather than its own dev copies.

## Attachment API and image input

Image input reads through the harness attachment service (`ctx.attachments`). The connector is built against the published attachment package. If you test images against a monorepo whose attachment package is ahead of that line and an image request throws for a missing method or type, that is version skew, not a plugin fault. Text requests never touch the attachment service and are unaffected. See [Image input](image-input.md).
