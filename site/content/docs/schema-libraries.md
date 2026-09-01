---
title: Schema Libraries
description: Zod, Valibot, and Effect Schema are supported without locking the API layer to one vendor.
---

Runtime parsing follows Standard Schema-style contracts where possible. OpenAPI conversion still depends on schema-library-specific adapters.

## Zod v4

Zod schemas are converted through Zod's native `toJSONSchema`. Classic Zod 4.2 or newer is the target; Zod Mini and Zod v3 are intentionally outside the compatibility surface. Native schemas such as `z.file()` retain their JSON Schema constraints in the generated OpenAPI document.

## Valibot

Valibot schemas are converted through `@valibot/to-json-schema`. Request schemas use input mode, while response schemas use output mode.

## Effect Schema

Effect Schema can be passed directly to endpoint definitions. Runtime parsing uses Effect's Standard Schema adapter, while OpenAPI conversion uses Effect's JSON Schema generator.

```ts
import { Schema } from 'effect'

defineRouteHandler({
  params: Schema.Struct({
    id: Schema.NumberFromString,
  }),
  validate: {
    response: {
      200: Schema.Struct({
        id: Schema.Number,
        name: Schema.String,
      }),
    },
  },
  handler: (event) => ({ id: event.validated.params.id, name: 'Tom' }),
})
```

Effect schemas with runtime requirements are outside the supported contract surface. Use schemas whose `Context` is `never`.

## Transforms and OpenAPI direction

For Valibot, request-side OpenAPI schemas use input mode and response-side schemas use output mode so transforms are represented in the right direction. Effect JSON Schema generation follows Effect's own JSON Schema rules.

```ts
import * as v from 'valibot'

const Id = v.pipe(v.string(), v.transform(Number), v.number())

defineRouteHandler({
  validate: {
    body: v.object({ id: Id }), // OpenAPI request schema: string
    response: { 200: v.object({ id: Id }) }, // OpenAPI response schema: number
  },
  handler: (event) => ({ id: event.validated.body.id }),
})
```

Response validation uses the validator output on the server. Generated clients then apply Nitro's JSON wire mapping. A response output containing `Date`, for example, is validated as `Date` but exposed to clients as `string`. Request inputs, server outputs, and client wire values are distinct boundaries.
