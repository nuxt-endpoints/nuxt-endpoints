---
title: Nuxt 5 prototype
description: Background on experimental H3, Nitro, and fetchdts integration branches.
---

These notes describe a September 2026 prototype. For the Nuxt 4.6 setup and status-aware fetch examples, see [Calling endpoints](/docs/client#nuxt-fetch-types).

## Working branches

| Project        | Branch                                                                                                   | Role in the prototype                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Nuxt Endpoints | [`nuxt5`](https://github.com/nuxt-endpoints/nuxt-endpoints/tree/nuxt5)                                   | Nuxt integration, `$endpoint`, `useEndpoint`, OpenAPI, and idempotency UX     |
| H3             | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/h3/tree/prototype/route-contracts)       | Typed route contracts, validation, and the active contract on the event       |
| Nitro          | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/nitro/tree/prototype/route-contracts)    | Build-time contract extraction, metadata, generated types, and runtime wiring |
| fetchdts       | [`prototype/route-contracts`](https://github.com/nuxt-endpoints/fetchdts/tree/prototype/route-contracts) | Extensible route metadata carried into generated client types                 |
