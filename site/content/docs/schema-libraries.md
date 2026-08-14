---
title: Schema Libraries
description: Zod, Valibot, and Effect Schema are supported without locking the API layer to one vendor.
---

Runtime parsing follows Standard Schema-style contracts where possible. OpenAPI conversion still depends on schema-library-specific adapters.

## Zod v4

Zod schemas are converted through `@asteasolutions/zod-to-openapi`. Zod v4 is the target; Zod v3 is intentionally outside the compatibility surface.

## Valibot

Valibot schemas are converted through `@valibot/to-json-schema`. Request schemas use input mode, while response schemas use output mode.

## Effect Schema

Effect Schema can be passed directly to endpoint definitions. Runtime parsing uses Effect's Standard Schema adapter, while OpenAPI conversion uses Effect's JSON Schema generator.

```ts
import { Schema } from 'effect'

defineEndpoint({
  params: Schema.Struct({
    id: Schema.NumberFromString,
  }),
  response: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
  }),
})
```

Effect schemas with runtime requirements are outside the supported contract surface. Use schemas whose `Context` is `never`.

## Transforms and OpenAPI direction

For Valibot, request-side OpenAPI schemas use input mode and response-side schemas use output mode so transforms are represented in the right direction. Effect JSON Schema generation follows Effect's own JSON Schema rules.

```ts
import * as v from 'valibot'

const Id = v.pipe(v.string(), v.transform(Number), v.number())

defineEndpoint({
  body: v.object({ id: Id }), // OpenAPI request schema: string
  response: v.object({ id: Id }), // OpenAPI response schema: number
})
```

Response validation uses the validator output on the server. Generated clients then apply the JSON wire mapping used by the supported Nitro line. A response output containing `Date`, for example, is validated as `Date` but exposed to clients as `string`. Request inputs, server outputs, and client wire values are distinct boundaries.
