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

Each endpoint route is generated onto `$endpoint('/path', { method })` style calls with typed request options, a default success-body call, typed result helpers, raw Web Response helpers, and optional Effect calls. Add `operation` only when a named call target such as `$endpoint.getUser(...)` is useful.

## 4. Response handling is explicit

Use the default call when app code only needs the success body. Use `.result()` for typed status and body handling, `.raw()` only when code needs a low-level Web `Response`, and `.effect()` when typed status results should compose with Effect retry and interruption.

## 5. OpenAPI is generated from the same source

The module can serve an OpenAPI 3.1 document without maintaining a separate route registry.

## 6. Server-state adapters remain optional

Named endpoint contracts can generate ordinary query, mutation, and infinite-query options for Vue Query. Vue Query owns cache behavior while Nuxt Endpoints keeps request and response types aligned with the server contract.
