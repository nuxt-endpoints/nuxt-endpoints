# Progressive enhancement for endpoint contracts

Status: implemented on the Nuxt 5 line.

Last verified: 2026-09-04.

This document records how a Nuxt Endpoints route answers a native `<form>`
submission without giving up its identity as a contract-first HTTP endpoint: the
ecosystem research that justified building it, the HTTP constraint that
determined the shape, what was measured while implementing it, and what is still
open.

The roadmap previously deferred this with "only with a concrete native-form
requirement". That gate is what the [ecosystem findings](#ecosystem-findings)
section replaces: the mechanism is one Nitro deliberately provides, and the Nuxt
5 line currently has no working option at all.

## The problem

One endpoint has three kinds of caller:

| Caller                 | Sends                                                         | Can consume          |
| ---------------------- | ------------------------------------------------------------- | -------------------- |
| `$fetch` / `$endpoint` | `Accept: application/json`, `Sec-Fetch-Mode: cors`            | A JSON status union  |
| A browser POST form    | `Accept: text/html`, `Sec-Fetch-Mode: navigate`, form-encoded | HTML or a redirect   |
| A browser GET form     | URL query parameters                                          | The destination page |

For POST, everything before the response is identical: body parsing, schema
validation, and the handler. Only the encoding of the answer differs. GET is
simpler: it is ordinary URL navigation, and the destination page reads the same
typed query endpoint during SSR or after client navigation.

The request side already exists in this module: media-type request bodies
(`application/x-www-form-urlencoded`, `multipart/form-data`), `415` on mismatch,
and per-member OpenAPI content are implemented and covered by
`test/media-type-body.test.ts` and the `test/fixtures/basic/server/api/upload.post.ts`
fixture. POST enhancement therefore adds response translation rather than a
second request model; GET reuses the route's existing query model unchanged.

## Ecosystem findings

Verified on 2026-09-03 against GitHub and the npm registry.

| Finding                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuxt core considered framework-level form actions and deferred them to a module                  | [nuxt#20649](https://github.com/nuxt/nuxt/issues/20649) is open with `🍰 p2-nice-to-have`; [nuxt#20852](https://github.com/nuxt/nuxt/pull/20852) was closed unmerged with "Marking as draft until we … have time to test the amazing implementation work done at form-actions-nuxt"                                                                |
| That discussion has been dormant for roughly three years                                         | Last substantive comment on nuxt#20649 is 2023-11-01                                                                                                                                                                                                                                                                                               |
| Core's current direction for server communication is RPC, which cannot be progressively enhanced | On [nuxt#32465](https://github.com/nuxt/nuxt/issues/32465): a core maintainer points to `trpc-nuxt`, and pi0 writes "h3/nitro will also likely have official trpc/orpc integrations soon"                                                                                                                                                          |
| Nitro's own server-functions issue is dormant                                                    | [nitro#20](https://github.com/nitrojs/nitro/issues/20), opened 2022-03-17 by pi0, still `p2-nice-to-have`                                                                                                                                                                                                                                          |
| **The routing mechanism this design needs is one Nitro deliberately provides**                   | pi0 closed [nitro#1286](https://github.com/nitrojs/nitro/pull/1286) (a form-actions implementation) saying that after [h3#461](https://github.com/h3js/h3/pull/461) "we can actually register form action routes with their method and no additional configuration and they are expected to work nicely with the default renderer catch-all route" |
| The renderer accepts every method, so a page URL can answer a `POST`                             | Nitro registers `{ route: "/**", handler: renderer }` and then maps `method: h.method \|\| ""`, i.e. no method restriction                                                                                                                                                                                                                         |
| The only progressive-enhancement module for Nuxt is stale and cannot run on this line            | `@hebilicious/form-actions-nuxt` latest is `0.3.0`, published 2023-11-13, built on h3 v1 `event.node.res`                                                                                                                                                                                                                                          |
| Its failure path loses the user's input entirely                                                 | Non-enhanced validation failure calls `createError`, which renders Nuxt's error page rather than the form                                                                                                                                                                                                                                          |
| The active adjacent module does not do progressive enhancement                                   | Nuxt Actions lists 26 features, none of them native-form or no-JS; its README form example uses `@submit.prevent`                                                                                                                                                                                                                                  |
| h3 has no progressive-enhancement work                                                           | No issue or pull request with "progressive" in the title                                                                                                                                                                                                                                                                                           |
| React Router and Remix treat GET as URL navigation and POST as an action                         | Their [progressive-enhancement guide](https://reactrouter.com/explanation/progressive-enhancement) uses GET search forms as URL state; [Remix Form](https://remix.run/docs/en/main/components/form) warns that PUT/PATCH/DELETE lose native-form PE                                                                                                |
| SvelteKit enhances only POST actions                                                             | [`use:enhance`](https://svelte.dev/docs/kit/form-actions#Progressive-enhancement-use-enhance) rejects GET forms; GET remains ordinary loading/navigation                                                                                                                                                                                           |
| Next.js separates GET search forms from POST Server Actions                                      | A string [`Form` action](https://nextjs.org/docs/app/api-reference/components/form) is a GET navigation; a function action invokes a [Server Action](https://nextjs.org/docs/app/getting-started/mutating-data) over POST                                                                                                                          |

Two conclusions follow. Core is unlikely to make this redundant, and on the
Nuxt 5 line there is currently nothing that works.

The demand signal is nonetheless modest: nuxt#20649 has accumulated 57
reactions over three years and nobody has taken over the stale module. That is
the argument for keeping the implementation thin, not for skipping it.

## The constraint that determines the shape

The address bar is decided by where the request was sent, not by what came back.
Only a redirect changes it, because only a redirect causes a new request.

Returning page HTML from `POST /api/users` therefore breaks: the browser would
display the right markup at `/api/users`, where a reload re-posts, a bookmark
hits an API route, relative URLs resolve against the wrong base, and the client
router finds no page to hydrate.

That leaves exactly two shapes, and no third:

| Shape                       | Form target  | Final URL    | How                          | Failure information rides in                               |
| --------------------------- | ------------ | ------------ | ---------------------------- | ---------------------------------------------------------- |
| Keep the endpoint's own URL | `/api/users` | `/users/new` | `303` sends the browser back | A cookie or server storage, because there are two requests |
| Post to the page's URL      | `/users/new` | `/users/new` | The response _is_ the page   | The response body, because there is one request            |

HTTP offers no way to attach a body to the request a redirect causes, so the
first shape always needs a side channel. The second needs none. This design
takes the second.

Success uses `303` in both shapes regardless, so that the history entry the user
lands on is a `GET` and a reload cannot resubmit.

## Design

### POST uses a bridge; GET remains navigation

A Nitro middleware translates between the two representations. The endpoint is
never modified and never learns that progressive enhancement exists.

```text
POST /users/new                        (native form, no JS)
  ├─ bridge middleware (same H3 event)
  │    ├─ not a navigation POST?  → return, request continues untouched
  │    ├─ convert the form body and call the endpoint internally
  │    ├─ success → 303 Location: <declared target>
  │    └─ failure → event.context holds issues and values, return nothing
  └─ renderer catch-all /** (accepts every method)
       └─ the page reads the context during SSR
       ← 400 with that page's HTML
```

The enhanced path does not go through the bridge at all. `form.enhance`
intercepts the submit and calls `$endpoint` directly, so the client keeps the
declared status union with full type fidelity.

A GET form never enters that middleware:

```text
GET /search?q=ada                    (native form or enhanced navigation)
  └─ page calls GET /api/search?q=ada through useEndpoint
       ← typed status result
```

`form.method: 'get'` projects fields from `validate.query`. During SSR,
`useEndpointForm` uses the request-aware `useEndpoint` path to load the result.
After hydration, `form.enhance` updates the address bar and runs the same GET
endpoint. The URL remains the source of truth, so reload and bookmark reproduce
the search without a private submission marker.

Reading the result during SSR uses `useRequestEvent()`, which Nuxt exports, and
is seeded into the payload with `useState` so hydration keeps it.

**Implemented** as `src/runtime/form-bridge.ts`, registered by the module for
every application. With no route declaring `form` the generated map is empty and
the middleware returns on its first lookup. Everything it needs from h3 and
Nitro goes through `src/runtime/platform/middleware.ts`, so the seam that
`test/platform-isolation.test.ts` pins still holds.

The bridge does not read the generated map itself. It is registered as a server
handler, so Nitro's route-contract extraction bundles it before `nitro:init` has
run and would resolve anything it imports in that pass; the startup plugin reads
the map and hands it over through `form-routes-state.ts`, the way the OpenAPI
document is already shared.

### Where the declaration lives

Per-route form projection belongs next to the contract, not in a separate
registry keyed by route strings. `form.from`, `form.method`, `form.redirect`,
the accepted encoding, and the projected fields are static, serializable facts needed by
build-time validation and client generation. They therefore live on the route
contract:

```ts
defineRouteHandler({
  form: { from: '/todos/new', redirect: '/todos/{id}' },
  validate: { /* ... */ },
  handler: /* ... */,
})
```

POST is the default. GET must be selected explicitly and declares query fields
instead of a form body:

```ts
defineRouteHandler({
  form: { from: '/search', method: 'get' },
  validate: {
    query: SearchQuery,
    response: { 200: SearchResults },
  },
  handler: ({ validated }) => search(validated.query),
})
```

Only execution of the bridge is runtime behavior. `form` is not a runtime
callback or policy and is not configured in `server/endpoints/runtime.ts`.

### Type feedback and build enforcement

`NativeFormProjectionConstraint` reports statically provable incompatibilities
in the editor. It is early feedback, not the enforcement boundary: Nuxt does
not require a full TypeScript check for every build, JavaScript has no type
check, and a cast can erase one.

`resolveFormMetadata()` therefore performs the authoritative build-time check
while it derives the generated form metadata. It also checks facts the local
object type cannot know, such as route parameters and collisions between page
URLs. The type tests and module tests pin the same compatibility rules; where a
schema cannot be inspected, the build is deliberately stricter and refuses to
claim that a native form can satisfy it.

**This feature is Nuxt 5 only, and stays that way.** The bridge cannot port:
it rewrites the failure status by awaiting `next()`, and **h3 1.15 gives a
handler no `next`** - the only `next` there belongs to `NodeMiddleware`.
Progressive enhancement is therefore one of the places where the two lines
deliberately differ. The rule is one-directional: what the Nuxt 4 line has, the
Nuxt 5 line has too; the reverse does not follow.

The conversion fix is a separate matter, and it is a defect rather than a
feature: the Nuxt 4 line asks for `mode: 'input'` in the same three places and
drops it in the same one, so `.transform()` request bodies are documented as
`{}` there too, and `additionalProperties: false` is stated falsely. It is
worth fixing on its own terms, not as part of porting this.

Validation rejects loudly, in keeping with the existing rule that a declared
contract is never silently dropped. These are build-time errors, raised
while the handler manifest is composed:

- a `form.from` that is not an absolute page pathname, or contains a query or
  fragment. GET fields own the destination query and fragments never reach the
  POST bridge, so embedding either would create different native and enhanced
  behavior
- a form projection on a route whose body cannot be form-encoded — the message
  names `formOf()` as the way to derive one from the JSON member
- two POST endpoints claiming the same page URL. A native POST carries nothing
  that would say which endpoint it meant, so this is a collision rather than a
  choice. GET and POST may share a page URL because the method distinguishes
  them; two POST actions on one page still need distinct targets today. An
  intent field (Remix's `_action`) could lift that and is deliberately not
  designed yet

### The bridge does not convert the request

Both paths send the encoding the contract declares. The bridge forwards the
body untouched; it only translates the _response_ representation.

This was reversed once during design, and the reversal is worth recording,
because converting form input to JSON inside the bridge looks like a
simplification and is not.

**Progressive enhancement guarantees that the two paths are the same request.**
Change the encoding on one of them and the guarantee weakens from "identical" to
"equivalent by construction". Every framework that takes native forms seriously
keeps the encoding the same on both paths:

| Framework                  | What the enhanced path sends | Where coercion happens                                   |
| -------------------------- | ---------------------------- | -------------------------------------------------------- |
| SvelteKit form actions     | `FormData`                   | The action reads `request.formData()` itself             |
| SvelteKit remote functions | `FormData`                   | `n:` / `b:` name prefixes, and the schema for checkboxes |
| Remix / React Router       | `FormData`                   | The action reads `request.formData()`                    |
| Next.js server actions     | `FormData`                   | Application code                                         |
| Conform                    | `FormData`                   | Schema helpers over the Constraint Validation API        |

**Converting is interpretation, not re-encoding.** Repeated fields, `""` versus
absent, field order, files mixed with scalars, and nested names all have to be
decided rather than translated - SvelteKit had to invent a `nested.array[0].value`
notation for the last one. Worse, the interpretation would have to exist twice,
in the bridge and in the client's enhanced path, where the two can drift.

**And it would make the endpoint depend on the bridge.** An endpoint that
declares only JSON answers `415` to `curl -d 'name=Ada'` - a perfectly ordinary
HTTP client - and its form works only because a middleware chewed the request
first. That contradicts the reason this module exists: the contract is supposed
to be the whole truth about the endpoint. Declaring the form encoding is the
honest statement, and it appears in the OpenAPI document as one.

So the contract declares what it accepts:

```ts
validate: {
  body: {
    'application/json': Todo,
    'application/x-www-form-urlencoded': formOf(Todo),
  },
}
```

Coercion belongs in the schema, once, where the author can see it. `formOf()` is
**implemented** (`src/runtime/form-schema.ts`, `test/form-schema.test.ts`). It
does not rewrite the schema per library - it wraps it, coercing the raw fields
against the JSON Schema this module already derives for OpenAPI and then
delegating to the original. Three properties follow that a per-library
transform could not give:

- the output type is the original's **by construction**, so the handler reading
  a media-type-map body never sees a divergent union;
- it works for every supported schema library, because the only introspection
  used is the JSON Schema conversion, which is already library-agnostic;
- the rules live in one place, applied when the contract is defined, and the
  member still documents itself - `formOf()` carries a `jsonSchema` that
  `toJsonSchema()` picks up through its existing provider hook, so no change to
  the converter was needed.

Form semantics differ from JSON semantics, and the derivation is where that is
absorbed:

- a declared number receives `Number(value)`, and an empty input counts as
  absent rather than `NaN`, so an optional field stays optional;
- a declared boolean is `false` for `''`, `'0'`, `'false'`, `'off'`, `'no'`, and
  **`false` when the field is missing entirely** - what an unticked checkbox
  sends;
- a declared array receives a single value wrapped;
- everything else passes through, including `File` values and `date-time`
  strings. A `date-time` string is indistinguishable from a plain string
  declared with that format, so converting it would break the second case; a
  schema wanting a `Date` coerces it itself.

SvelteKit pushes the checkbox rule onto the author
(`v.optional(v.boolean(), false)`). The derivation absorbs it instead, so the
JSON member stays `z.boolean()`.

Two shapes are rejected when the contract is defined rather than mishandled at
request time: a root schema that is not an object, and a field that is itself an
object or an array of objects. Expressing a nested field in a form needs a
name-mangling convention, and inventing one would put a private encoding into a
public contract.

Files never travel in JSON, so a form carrying one declares
`multipart/form-data` and both paths send multipart. Nothing special happens on
either path, because nothing is converted on either path.

### When the form is not the request body

The fields a person fills in and the body the handler receives are often not the
same shape: a confirmation field, three selects for one date, a name typed to
pick an id, a terms checkbox that is never stored. This module's type model
already separates three things:

```text
schema input != validated output != HTTP wire output
```

A form adds a fourth relationship, and it collapses into the first: **the form
is the schema's input.**

Other ecosystems split this differently. TanStack Form keeps the form model and
the API payload separate and maps between them in the submit handler. That
option does not exist here, because the no-JavaScript path has no client code at
all - whatever the browser natively sends has to be describable by the contract.
SvelteKit and Conform take the approach this design takes: the schema describes
the form, and a transform maps it to what the handler wants.

So the divergence is declared, in the member for that encoding:

```ts
const SignupJson = z.object({ email: z.string().email(), password: z.string().min(8) })

const SignupForm = SignupJson.extend({ confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  // Naming the discarded key aliases it, which keeps the omit form readable
  // without tripping an unused-parameter lint rule.
  .transform(({ confirmPassword: _confirmPassword, ...rest }) => rest)

validate: {
  body: {
    'application/json': SignupJson,
    'application/x-www-form-urlencoded': formOf(SignupForm),
  },
}
```

`extend` keeps the shared rules written once. The transform makes the member's
output match the JSON member's, which the media-type-map body requires - a
handler reading it sees the union of its members' outputs, so two members that
disagree would hand it a divergent type. `confirmPassword` never reaches the
handler, and the cross-field rule runs on the server, which is the only place it
can run for a native submission.

`formOf()` composes over this: it wraps whatever schema it is given, so a
diverging member is still spared the string coercion by hand.

`.pipe(SignupJson)` looks like a stronger way to pin the output - the type would
be the JSON member's literally, rather than by agreement. **Measured: it does
not type-check.** Zod requires a pipe target's input to accept the source's full
output, and the target here has no `confirmPassword`. It works at runtime and
fails at the type level, so the transform form is the one to document.

#### What this required in the conversion

Planning coercion and deriving field attributes both need the schema's **input**
direction, since a transforming schema's output no longer mentions the fields
the form sends. `toJsonSchema()` already accepted a `mode`, and OpenAPI already
asked for `'input'` on request bodies and `'output'` on responses - but the mode
was never forwarded to the Zod converter, so Zod always answered in its default
output direction.

Forwarding it fixed a pre-existing defect along the way: **a request body
declared with a `transform` or `pipe` documented as an empty schema**, because
that is what Zod answers for an unrepresentable output view. It also removed
`additionalProperties: false` from request-body documentation, which was a false
statement - `z.object` accepts unknown keys and strips them; only
`z.strictObject` rejects, and it reports the constraint in both directions.

### Client surface

`useEndpointForm` takes the same request `$endpoint` takes and returns
everything the page needs. It is a composable rather than a projection off the
request object - `queryOptions(request)` and `mutationOptions(request)` hand
back a plain description that any caller can hold, while a form needs component-scoped
reactivity and the current request's context, and only a composable has those.

The body the request is constructed with becomes the form's initial values, so
nothing has to be declared twice.

Stage one uses no JavaScript at all:

```vue
<script setup lang="ts">
const form = useEndpointForm('/api/todos', {
  method: 'post',
  body: { title: '', done: false },
})
</script>

<template>
  <form v-bind="form.attrs">
    <input v-bind="form.fields.title" />
    <input v-bind="form.fields.done" type="checkbox" />
    <p v-for="issue in form.issues.title" :key="issue.message">{{ issue.message }}</p>
    <button>Add</button>
  </form>
</template>
```

That already works. Rendered, it is an ordinary form whose every attribute came
from the contract:

```html
<form action="/todos/new" method="post" enctype="application/x-www-form-urlencoded">
  <input name="title" required minlength="1" value="" />
  <input name="done" type="checkbox" />
  <button>Add</button>
</form>
```

Stage two adds enhancement with one attribute, and the no-JavaScript path keeps
working exactly as before:

```diff
- <form v-bind="form.attrs">
+ <form v-bind="form.attrs" @submit="form.enhance">
```

Stage three passes options, and only for behaviour that genuinely varies per
form - navigating to the declared target is the default:

```ts
const form = useEndpointForm('/api/todos', {
  method: 'post',
  body: { title: '', done: false },
  onSuccess: (result) => showToast(result.body.title),
})
```

For a URL-backed GET form, the page passes its current query. The composable
loads the typed endpoint result as part of the same call:

```ts
const route = useRoute()
const form = useEndpointForm('/api/search', {
  method: 'get',
  query: { q: String(route.query.q ?? '') },
})
```

| Member          | Derived from                                                             |
| --------------- | ------------------------------------------------------------------------ |
| `attrs`         | the declared page URL and the selected native method                     |
| `fields.<name>` | POST body or GET query JSON Schema: HTML constraints and a two-way value |
| `values`        | the current value of every field the bindings control                    |
| `submit`        | sends a submission without going through a `<form>` element              |
| `enhance`       | preserves native semantics, then exposes the typed endpoint result       |
| `pending`       | in-flight state                                                          |
| `status`        | the endpoint status, from whichever path produced it                     |
| `issues`        | field-keyed, merged from an enhanced `400` and native POST submission    |
| `allIssues`     | every issue, including ones that belong to no field                      |
| `result`        | the declared status union, typed                                         |

Two presentation options keep validation ownership explicit. Server validation
always runs; `validation` controls only whether the browser may stop the submit
first with its own constraint message:

```ts
const form = useEndpointForm('/api/todos', {
  method: 'post',
  body: { title: '', done: false },
  validation: 'server',
  resolveMessage: (issue) => t(`forms.todo.${issue.path?.join('.')}.${issue.code}`),
})
```

`validation: 'browser'` is the default and keeps the generated `required`,
`minlength`, `pattern`, and other constraints active. `validation: 'server'`
adds `novalidate` to `attrs`; the attributes stay on each field as semantic and
accessibility metadata, but the browser no longer replaces the contract's
message with its own. `resolveMessage` transforms only `issues` and
`allIssues`, on both the SSR/native and enhanced paths. The typed `result` keeps
the endpoint's original response unchanged.

Issues are not reduced to a Zod- or Valibot-independent lowest common
denominator. The transport preserves every enumerable detail returned by the
validator (`minimum`, `origin`, `input`, and so on). Standard Schema's object
path segments are normalized to a JSON-safe array on the HTTP response; the
array itself is otherwise preserved. It becomes a dot-separated key only while
grouping `form.issues`. `resolveMessage` therefore receives the complete issue
and can narrow any validator-specific fields it understands.

Field names are typed from the declaration, so `form.fields.titel` is a
compile error rather than an input that silently renders with no `name`. The
names come from the _input_ side of the schema, which is what the form fills
in: a `.transform()` that drops a field still lists it, because the user still
types it.

`fields.<name>` binds the value in both directions, and that is not a
convenience. Vue force-patches the `value` prop on every full-props update, so
a one-way `v-bind` would overwrite what the user had typed the moment anything
else on the page changed — measured, not predicted. A file input is left alone:
a browser refuses to let a page set its value.

For POST, `enhance` sends the encoding the contract declares - the same
`FormData` or URL-encoded body the native form sends. For GET it serializes the
same controls into the destination URL, navigates there, and invokes the GET
endpoint with those query values. PUT, PATCH, and DELETE are not silently
emulated: HTML cannot submit them, and hiding a method override in the bridge
would make the native request say something different from the contract.

`onSuccess` runs only for a successful status. Failed status-aware results stay
in `result` and `issues`; they neither call the callback nor navigate. Redirect
placeholders are URL-encoded identically on both paths. At build time every
placeholder must be a declared property of every successful response body, so
`redirect: '/todos/{id}'` cannot ship alongside a `201` body that only declares
`slug`.

Only routes that declare `form` are offered: `useEndpointForm('/api/health', …)`
does not compile, and a cast past it throws at the call rather than returning a
projection that cannot work.

Outside a request context, `useEndpointForm` loses only the native POST's
restored values and GET's initial SSR load - the same graceful degradation the
client already has for `useRequestFetch()`, which it calls behind a `try`/`catch`
to capture a request-aware fetcher.

**A contract a browser could not satisfy does not compile.** A native `<form>`
cannot set request headers, cannot add a query string to where the bridge
forwards the submission, and cannot send an `Idempotency-Key`. So declaring
`form` alongside any of those is a type error, stated by
`NativeFormProjectionConstraint` (`src/runtime/form-projection.ts`):

| Declared next to `form`                       | Verdict                                       |
| --------------------------------------------- | --------------------------------------------- |
| no `multipart` or urlencoded body member      | refused - a browser cannot encode it          |
| `idempotency`                                 | refused - the key is a header                 |
| `validate.headers` requiring anything         | refused - a browser cannot send it            |
| POST with `validate.query` requiring anything | refused - the forwarded call carries no query |
| POST headers/query requiring nothing          | allowed                                       |
| GET without `validate.query`                  | refused - there are no fields to project      |
| GET with `validate.body` or `redirect`        | refused - GET uses URL query/navigation       |
| a route template with a path parameter        | refused at build time - the path is not typed |
| PUT, PATCH, or DELETE endpoint                | refused - no native method override is hidden |

The reason is the error text, because the refusal makes the reason a required
property name. `defineRouteHandler` is overloaded, though, and TypeScript
reports the last overload when none match - so at the call site the author sees
that `form` is wrong without being told why. Adding a trailing overload to fix
that was measured to move every method-group error off its own line instead, a
worse trade for a more common mistake. The reason is therefore stated by the
build, in `resolveFormMetadata()`, which re-checks every rule: a cast erases
the type, and a rule that only holds when nobody casts is not a rule.

### Validation runs in three layers, and this module owns two

**HTML constraint attributes, from `fields`.** Costs nothing, works with no
JavaScript, and the browser localizes the message. **Implemented** as
`formFieldAttributes()` (`src/runtime/form-schema.ts`), derived mechanically
from the input-direction JSON Schema:

```text
z.string().min(2).max(80)      required minlength="2" maxlength="80"
z.string().regex(/^[a-z-]+$/)  required pattern="^[a-z-]+$"
z.number().int().min(1).max(10) required min="1" max="10" step="1"
z.number().multipleOf(0.5)     required step="0.5"
z.string().email()             required type="email"
z.file().mime('text/plain')    required type="file" accept="text/plain"
z.string().optional()          (name only)
```

Four decisions the conversion forces, each measured against Zod's output:

- **Safe-integer bounds are dropped.** A plain `z.number().int()` reports
  `minimum: -9007199254740991`; rendering it would imply a rule nobody wrote.
- **`required` is never emitted for a boolean.** On a checkbox it would mean
  "must be ticked", but a declared `z.boolean()` only means the field is
  present, and an unticked box sends nothing at all - which `formOf()` reads as
  `false`.
- **`type` is emitted only where the format is the control**: `email`, `url`,
  and `file`, where the format _is_ the rule. Whether a string field is `text`,
  `password`, or `search` is a presentation choice that belongs to the template,
  and where `type` is emitted an explicit one placed after `v-bind` still wins.
  Zod's long pattern for those formats is left off, since the type carries the
  same rule.
- **An exclusive bound becomes inclusive only for integers**, where
  `exclusiveMinimum: 0` is exactly `min="1"`. HTML cannot express an exclusive
  bound on a fractional field, so it is left off rather than widened into
  something false.

Conform is prior art for deriving constraints this way in the React ecosystem.

**Server-side schema validation.** Always runs, is the only complete truth, and
returns the declared `400` body, which becomes `issues` on both paths.

**Client-side schema evaluation before sending.** Not in v1. It needs the schema
at runtime on the client, and this module deliberately keeps schema objects out
of the client payload. When it arrives it will evaluate the emitted JSON Schema,
which needs custom messages carried in a vendor extension because standard JSON
Schema has nowhere to put them.

Layer one therefore cannot express cross-field rules, refinements, conditional
requiredness, or database checks. Those reach the user through layer two, after
a round trip, until layer three exists.

When layer one blocks a submission the user sees the browser's localized
message; when layer two rejects it they see the schema issue after
`resolveMessage` maps it for presentation. A form that needs one message source
uses `validation: 'server'`. That consistency costs a round trip for every
mistake, so browser validation remains the default.

Form libraries keep a clear role: instant per-keystroke validation, cross-field
rules on the client, and field state. `attrs`, `fields`, and `submit` are the
integration surface, so a VeeValidate form ignores `enhance` and `issues` and
uses the rest.

## What stays out

| Out of scope                               | Why                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Rendering HTML                             | Pages are Nuxt's responsibility; the renderer is called, never replaced                       |
| Field state, dirtiness, array manipulation | Already delegated to form libraries; document a VeeValidate recipe instead                    |
| A `touched` state machine                  | `:user-invalid` may cover it in CSS once validation leans on HTML constraints                 |
| Cache, SSR state, retry                    | Pinia Colada owns these, and it stays an optional peer that this composable never imports     |
| An `actions` namespace or RPC surface      | The route stays the source of truth; the adjacent modules that own the word "actions" are RPC |
| CSRF and rate limiting                     | Already delegated to middleware                                                               |

The name matters as much as the scope. Three adjacent modules use "actions" to
mean RPC. Naming this after them invites comparison on feature count and hides
the only thing that is actually different: one contract answering a JSON client,
a native form, and OpenAPI.

## What was measured

The bridge and `useEndpointForm` are implemented and exercised against a real
server by `test/integration/form-pe.test.ts` — thirteen tests on native/SSR
paths, and three browser flows that drive real JavaScript through Chromium.

The native path is driven by sending the two headers a browser sets on a
navigation (`Sec-Fetch-Mode: navigate` and an HTML `Accept`) rather than by
driving a browser, because those headers are exactly what the bridge branches
on.

| #   | Question                                             | Answer                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Forwarding credentials through the internal call     | **Works, but only explicitly.** `serverFetch()` from `nitro/app` routes internally; `cookie` and `authorization` must be copied by hand, `accept` replaced with JSON, and `content-length` dropped. Proven by an endpoint that echoes the session cookie                               |
| 2   | Forwarding `multipart/form-data` without re-encoding | **Settled in favour of reading it.** Streaming `event.req.body` works and needs `duplex: 'half'`, but a rejected submission then comes back with empty fields. The bridge always reads the body and re-encodes; the cost is buffering an upload the runtime would have buffered anyway |
| 3   | How the enhanced path learns the post-success target | **Settled.** The target is part of the declaration, so both paths resolve the same `redirect` template — the bridge into a `Location`, the client into a `navigateTo`. Nothing had to travel in a response header                                                                      |
| 4   | The coercion table                                   | **Moved.** Coercion is no longer the bridge's job — see the encoding section above                                                                                                                                                                                                     |

### What implementing it discovered

**The page does not own the failure status; the bridge does.** Setting
`event.res.status` before the renderer runs has no effect, because the renderer
builds its own response. Awaiting `next()` and rewrapping the rendered response
is what puts the status back under the middleware's control — and unlike
rendering through a second internal request, the middleware stack still runs
exactly once for the browser's one request. The page is therefore _not_ aware of
the mechanism, which is what removed the composable the earlier draft needed.

**The fall-through behaves as documented.** A `POST` to a page URL with no
matching Nitro route reaches the renderer, which serves that page as the response
to the `POST`, in the same request, carrying the context the middleware attached.

**An ordinary call is genuinely untouched.** `POST /api/users` with a JSON
`Accept` behaves exactly as before, and even a `POST` to the _page_ URL is left
alone when it asks for JSON.

**Contract extraction renders the virtual modules early.** Nitro's
route-contract build runs before `nitro:init` and is what _produces_ the handler
manifest, so a template that threw when the manifest was missing was rejecting a
legitimate render. Those templates now emit an empty module for that pass; the
server build runs after `nitro:init`, so what is served is never empty.

### Still to answer

- Whether two POST actions on one page should be reachable through an intent
  field rather than through two page URLs.

## Phasing

1. **Done.** The bridge ships in `src/runtime/form-bridge.ts`, registered by the
   module. Applications write no bridge code.
2. **Done.** `formOf()` and `formFieldAttributes()` are implemented and pinned
   against Zod, Valibot, and Effect Schema.
3. **Done.** `useEndpointForm` is generated alongside `useEndpoint`, typed from
   the contract down to the field names.
4. **Done.** Explicit GET forms project `validate.query`, remain URL-backed,
   and load the same typed endpoint on SSR and enhanced navigation.
5. Add client-side schema evaluation only if the HTML layer measurably falls
   short.

## Positioning

The externally interesting claim is not "no-JS support", which is a narrow
audience. It is that a form keeps working in the window before hydration
finishes — a window every user hits on a slow connection — and that the same
declaration still produces a typed client and an OpenAPI document.

## References

- [Roadmap](./roadmap.md) — cross-feature status
- [Nuxt Actions comparison](./nuxt-actions-comparison.md) — the adopt/delegate/defer ledger this supersedes for form enhancement
- [`$endpoint` responsibility map](./endpoint-responsibilities.md) — layer ownership
- [Upstream tracking](./upstream-tracking.md) — moving issue and pull-request state
