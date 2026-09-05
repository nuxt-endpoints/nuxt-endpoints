---
title: Mental Model
description: One route definition powers the server, client, and documentation.
---

Nuxt Endpoints adds a typed contract around ordinary Nuxt server routes. That contract is the source for runtime validation, generated client calls, and OpenAPI output. Six principles explain how every feature fits together.

## 1. Route files stay Nuxt-native

You still write ordinary files under `server/api` and export an event handler. The endpoint definition wraps the HTTP boundary.

## 2. Schemas describe HTTP input and output

Zod, Valibot, and Effect Schema definitions describe the data that crosses the HTTP boundary. Handler context types use parsed schema output, so coercion and transforms are reflected in application code.

## 3. Route paths become client calls

Each endpoint route is generated onto `$endpoint('/path', { method })` calls with typed request options. A route may also declare a unique `name` for a shorter `$endpoint.getUser({ params })` alias. The alias keeps the same explicit HTTP input slots and returns the same lazy request, which can be awaited, passed to Pinia Colada, or read as a raw Web Response. Path and method remain the canonical HTTP identity.

## 4. Response handling is explicit

Await the request to receive a typed status union. Use `.raw()` only when code needs a low-level Web `Response`. `useEndpoint` and the Pinia Colada options keep the same status-aware data shape while omitting native headers.

## 5. OpenAPI is generated from the same source

The module can serve an OpenAPI 3.1 document without maintaining a separate route registry.

## 6. Server-state adapters remain optional

Endpoint request objects expose ordinary query or mutation options for Pinia Colada. Colada owns cache behavior while Nuxt Endpoints keeps request identity, HTTP idempotency, and response types aligned with the server contract.
