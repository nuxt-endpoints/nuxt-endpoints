---
title: Limits
description: Beta, with the important constraints documented.
---

The core endpoint flow is usable, but OpenAPI metadata, discovery, and release polish are intentionally conservative.

## Supported platform line

See [Compatibility](/docs/getting-started#compatibility) for the currently supported Nuxt, Nitro, and H3 versions and what that support statement does and does not claim.

## Known constraints

### Endpoint discovery reads a compiled contract, not the route module

Contracts come from Nitro's build-time contract macro and its `getRouteContracts()` provider. The macro keeps the contract expression and only the imports and immutable bindings that expression reaches, so handler-only code and its imports are never run during the build. What the contract expression itself references — schema modules, shared metadata — is evaluated, so keep those side-effect free.

### Endpoint discovery fails closed

The macro accepts only a direct default-exported `defineRouteHandler({...})` call with an object literal. Spreads, computed properties, and mutable bindings at that boundary fail with a source diagnostic instead of yielding a partial contract, because a partial contract could make client types, runtime metadata, and OpenAPI disagree. Ordinary Nitro routes are ignored rather than rejected.

### Catch-all and optional-parameter routes cannot declare endpoints

A route whose template contains a catch-all (`[...slug]`) or optional parameter cannot export an endpoint definition: the generated client cannot build those URLs correctly and OpenAPI has no honest representation for them, so the build fails with an explanation instead of producing silently broken output. Keep such routes as plain `defineEventHandler` handlers. Catch-all support is a designed-but-deferred candidate in the roadmap; optional path parameters are rejected permanently because OpenAPI cannot express them.

### Response bodies are JSON-first

Request bodies accept [media-type maps](/docs/endpoints#media-type-request-bodies) — JSON, URL-encoded forms, multipart uploads, and raw text. Validated response bodies are JSON: a validated status may be labelled with a `+json` profile such as `application/problem+json`, and nothing else.

Everything non-JSON goes through the single [media response](/docs/endpoints#non-json-responses) door. It carries its own media type, reaches OpenAPI, and can offer [several representations negotiated from `Accept`](/docs/endpoints#several-representations-of-one-status) — but nothing about its payload is validated, and its chunks are not typed. Use [Low-level HTTP](/docs/low-level-http) for redirects, proxies, and native Web Responses that should not be modelled as a status at all.

Contracted JSON responses use Nitro's wire-type mapping. Native `Response`, files, and custom response parsers are outside the generated JSON body type.

### Schema conversion depends on converter support

Unsupported Zod or Valibot constructs fail according to their converter libraries.

## Planned work

- Land the route-contract work and generic metadata transport in h3, Nitro,
  Nuxt, and fetchdts upstream.
- Add first-class endpoint metadata for OpenAPI-specific fields.
- Add better component and reference controls for shared schemas.
- Claim released-package support once those integration APIs ship and the test matrix covers them.
