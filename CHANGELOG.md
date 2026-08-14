# Changelog

## 0.1.0 - 2026-08-14

Initial public release.

### Added

- Typed Nuxt server endpoint contracts with runtime validation for Zod,
  Valibot, and Effect Schema.
- Generated endpoint clients, Nuxt async-data composables, and OpenAPI 3.1
  output.
- Optional TanStack Vue Query factories, request-scoped SSR integration, and
  infinite-query helpers.
- Optional `Idempotency-Key` response replay with an application-owned durable
  storage contract and a development-only memory adapter.
- Direct access to the H3 event from endpoint handler context.

### Compatibility

- Nuxt `^4.5.0`.
- Node.js `^22.19.0 || ^24.11.0 || >=26.0.0`.
- TypeScript 7 for project type checking, with the official TypeScript 6
  compatibility package for build tools that still require the Compiler API.
