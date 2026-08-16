# Changelog

## 0.2.0 - 2026-08-16

### Added

- Endpoint contracts can live in separate modules, including sibling
  `*.endpoint-contract.ts` files that are automatically excluded from Nitro
  route scanning.
- Central idempotency runtime policies can provide shared storage, scope,
  authorization, and TTL defaults from `server/endpoints/idempotency.ts` or a
  configured policy path.

### Changed

- Build-time discovery now evaluates only modules that define endpoint
  contracts, skips non-endpoint routes, and fails closed when an imported
  contract cannot be resolved safely.
- Catch-all and optional-parameter endpoint routes now fail during generation
  instead of producing invalid client and OpenAPI paths.
- The README and documentation site now follow a benefits-first introduction
  with dedicated mental-model and adoption guidance.

## 0.1.1 - 2026-08-15

### Fixed

- Client response types now follow Nitro's JSON wire serialization, including
  boundaries such as `Date` to `string`, across the default, result, raw,
  Effect, and TanStack Query clients.
- Generated endpoint success responses are checked against Nitro's generated
  `InternalApi` for every integration fixture route.
- Endpoint discovery now fails closed when route evaluation cannot expose the
  complete contract instead of reconstructing partial metadata from source.
- Built-in server values such as `Date`, `Map`, and `Set` retain their semantic
  types during handler return validation.

### Documentation

- Documented the current Nitro 2 type-generation boundary and the planned Nuxt
  5 and `fetchdts` migration path.

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
