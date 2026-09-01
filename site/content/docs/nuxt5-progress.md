---
title: Nuxt 5 Progress
description: Follow the public Nuxt 5 integration branches and see what is implemented today.
---

Nuxt Endpoints supports **Nuxt 4.5+ today**. In parallel, the Nuxt 5 integration
is being developed in public against matching H3, Nitro, and fetchdts
prototypes. These branches are experimental working branches, not the supported
Nuxt 4 release line.

Last updated: **2026-09-02**

## Working branches

| Project        | Branch                                                                                                   | Role in the prototype                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Nuxt Endpoints | [`nuxt5`](https://github.com/nuxt-endpoints/nuxt-endpoints/tree/nuxt5)                                   | Nuxt integration, `$endpoint`, `useEndpoint`, OpenAPI, and idempotency UX     |
| H3             | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/h3/tree/prototype/route-contracts)       | Typed route contracts, validation, and the active contract on the event       |
| Nitro          | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/nitro/tree/prototype/route-contracts)    | Build-time contract extraction, metadata, generated types, and runtime wiring |
| fetchdts       | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/fetchdts/tree/prototype/route-contracts) | Extensible route metadata carried into generated client types                 |

The branches are kept together because the current prototype crosses project
boundaries. The Nuxt Endpoints branch links these exact forks while the upstream
API shape is being worked out.

## What stays stable

`$endpoint` and `useEndpoint` are useful application-facing APIs independently
of where route-contract discovery and validation live. The Nuxt 5 work therefore
focuses on replacing module-owned lower-level plumbing with upstream primitives,
while preserving that UX and avoiding two permanent implementations of the same
machinery.

Upstream APIs are still evolving, so changes cannot be ruled out. Keeping
application code stable wherever practical is nevertheless a design constraint,
and unavoidable changes will be documented as migrations.

For the supported release line, start with [Getting Started](/docs/getting-started).
