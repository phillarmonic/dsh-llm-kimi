---
title: Image input
description: >-
  How the @phillarmonic/dsh-llm-kimi connector resolves image content through
  the DeepSeek Harness attachment service, inlines base64 image_url data URLs,
  and budgets images by pixel count and byte size.
icon: lucide/image
---

# Image input

All four Kimi Code models accept images. When a request carries image content, the adapter resolves each image through the harness attachment service (`ctx.attachments`) and inlines it as a base64 `image_url` data URL in the OpenAI-compatible chat-completions body.

## Flow

```mermaid
graph LR
  A[Request with image blocks] --> B{Model supports image?}
  B -->|No| R1[Reject: UNSUPPORTED_CONTENT]
  B -->|Yes| C{Attachment service mounted?}
  C -->|No| R2[Reject: INVALID_REQUEST]
  C -->|Yes| D{Within pixel and byte budgets?}
  D -->|No| R3[Reject: INVALID_REQUEST]
  D -->|Yes| E[Read bytes, encode base64 data URL]
  E --> F[Send image_url part to Kimi]
```

- Text-only requests never touch the attachment service.
- Image references are collected from every message, including nested tool results.
- Each image is budgeted from its durable reference metadata before any bytes are read.

## Budgeting is internal

The plugin enforces its own budget from the durable attachment metadata (`width`, `height`, `bytes`) rather than depending on a request-scoped projection from the attachment service. An image is rejected when:

- its pixel count (`width * height`) exceeds `imagePixelBudget` (default `8294400`, Kimi's 4K ceiling), or
- its encoded byte length exceeds `imageMaxBytes` (default `1048576`, 1 MiB).

The byte budget keeps the base64-expanded payload within Kimi's per-message size limit. Both budgets are configurable in `cordis.yml`. See [Configuration](configuration.md).

## Rejection cases

| Condition | Error code |
| --- | --- |
| Image sent to a model without image support | `UNSUPPORTED_CONTENT` |
| Image present but attachment service not mounted | `INVALID_REQUEST` |
| Image over `imagePixelBudget` or `imageMaxBytes` | `INVALID_REQUEST` |

## Wire format

Each image becomes an ordered content part beside any text:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What single color fills this image?" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

Text-only messages keep the compact string form. Supported media types are PNG, JPEG, WebP, and GIF.
