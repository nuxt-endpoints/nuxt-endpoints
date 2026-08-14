---
title: Limits
description: Early alpha, with the important constraints documented.
---

The core endpoint flow is usable, but OpenAPI metadata, discovery, and release polish are intentionally conservative.

## Supported platform line

The current release line targets Nuxt 4.5+ with Nitro 2 and H3 1. Nuxt 5, Nitro 3, and H3 2 are outside the tested support boundary for now. This is a support statement, not a claim that every future combination is known to fail.

## Known constraints

### Endpoint discovery evaluates route modules

During Nuxt and Nitro type generation, route modules are imported and endpoint metadata is read from the exported handler. Keep route top-level code lightweight.

### Source parsing is only a fallback

If route module evaluation fails, literal `operation` values inside direct `defineEndpoint` calls can be parsed. Variables, spreads, aliases, and factory wrappers are not supported by that fallback.

### JSON is the first-class body format for now

Multiple media types, request encodings, and content negotiation are not first-class endpoint fields yet. Use [Low-level HTTP](/docs/low-level-http) for files, streams, multipart uploads, redirects, proxies, and native Web Responses.

### Schema conversion depends on converter support

Unsupported Zod or Valibot constructs fail according to their converter libraries.

## Planned work

- Work with Nuxt and Nitro on stable build-time route metadata.
- Add first-class endpoint metadata for OpenAPI-specific fields.
- Add better component and reference controls for shared schemas.
- Add Nuxt 5, Nitro 3, and H3 2 coverage after their integration APIs stabilize.
