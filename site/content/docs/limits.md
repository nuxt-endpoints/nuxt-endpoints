---
title: Limits
description: Supported platform versions, current constraints, and upstream integration plans.
---

The core endpoint flow is usable, but OpenAPI metadata, discovery, and release polish are intentionally conservative.

## Supported platform line

See [Compatibility](/docs/getting-started#compatibility) for the currently supported Nuxt, Nitro, and H3 versions and what that support statement does and does not claim.

## Known constraints

### Endpoint discovery evaluates contract-defining modules

On the Nuxt 4 line, each canonical endpoint route module is evaluated with Jiti
during type generation so its contract metadata can be read. Keep route
top-level code and its imported dependency graph deterministic; do not open
database connections or start other runtime infrastructure there. Put
request-time wiring in `server/endpoints/runtime.ts`. Routes that do not use
the canonical endpoint authoring form are skipped.

### Endpoint discovery fails closed

On the Nitro 2 compatibility line, canonical `defineRouteHandler` modules are evaluated with Jiti. If evaluation fails or the default export does not expose route metadata, generation stops with an actionable error. Partial contracts are not reconstructed from source parsing because that could make client types, runtime metadata, and OpenAPI disagree. Ordinary Nitro routes remain unaffected.

### Catch-all and optional-parameter routes cannot declare endpoints

A route whose template contains a catch-all (`[...slug]`) or optional parameter cannot export an endpoint definition: the generated client cannot build those URLs correctly and OpenAPI has no honest representation for them, so the build fails with an explanation instead of producing silently broken output. Keep such routes as plain `defineEventHandler` handlers. Catch-all support is a designed-but-deferred candidate in the roadmap; optional path parameters are rejected permanently because OpenAPI cannot express them.

### Response bodies are JSON-first

Request bodies accept [media-type maps](/docs/endpoints#request-media-types) — JSON, URL-encoded forms, multipart uploads, and raw text. Validated response bodies are JSON: a validated status may be labelled with a `+json` profile such as `application/problem+json`, and nothing else.

Everything non-JSON goes through the single [media response](/docs/endpoints#media-responses) door. It carries its own media type, reaches OpenAPI, and can offer several representations negotiated from `Accept` — but nothing about its payload is validated, and its chunks are not typed. Use [Low-level HTTP](/docs/low-level-http) for redirects, proxies, and native Web Responses that should not be modelled as a status at all.

Contracted JSON responses use the supported Nitro line's wire-type mapping. Native `Response`, files, and custom response parsers are outside the generated JSON body type.

### Schema conversion depends on converter support

Unsupported Zod or Valibot constructs fail according to their converter libraries.

## Planned work

- Work with H3, Nitro, and Nuxt on stable build-time route contracts and event metadata.
- Add first-class endpoint metadata for OpenAPI-specific fields.
- Add better component and reference controls for shared schemas.
- Add Nuxt 5 coverage to the published support matrix when its integration APIs stabilize.
