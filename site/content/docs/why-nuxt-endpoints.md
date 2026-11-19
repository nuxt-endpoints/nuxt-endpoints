---
title: Why Nuxt Endpoints?
description: The drift problem in plain Nuxt apps, and the single-contract idea behind the module.
---

## The problem

A booking endpoint can return a booking ID with `201` or a conflict reason with `409`. Nuxt 4.6’s route-typed fetch can check the submitted body and infer the successful result. To display the conflict reason, the component also needs to know which JSON shape belongs to `409`.

## The idea

Define the HTTP contract once, next to the handler, with the schema library you already use. Everything else — runtime validation, the typed client, the OpenAPI document — is derived from that single definition.

Because every surface is generated from the same source, they cannot disagree:

- The handler only runs after the request matched the contract, and its return values are type-checked against the declared responses.
- The client types are computed from the contract at build time, including error branches and the JSON wire representation.
- The OpenAPI document is regenerated from the contract, so it is always as current as the code.

## What this deliberately is not

The contract wraps plain HTTP routes instead of replacing them. Endpoints stay ordinary files under `server/api`, callable by mobile apps, other services, or `curl` — there is no custom protocol and no lock-in on the wire. Adoption is per-route, and removing a definition returns the route to a plain Nuxt handler.

For a detailed positioning against plain `$fetch` typing, tRPC, and spec-first codegen, see [Comparison](/docs/comparison). For how the pieces fit together, see the [Mental Model](/docs/mental-model).
