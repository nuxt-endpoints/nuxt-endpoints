import type { RuntimeEvent } from './platform'
import type { InferInput, InferOutput, ValidatorSchema } from './validator'
import type { ResponseOptions, StatusCode, StatusResponse } from './response'

export type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'
  | 'connect'
  | 'trace'

/**
 * Media-type keyed request-body contract. Keys must be lowercase.
 *
 * A member is either a validator schema, which requires a media type the
 * runtime can parse into a value to check (see `isSupportedBodyMediaType` in
 * body-media-type.ts), or `true` for "accept this media type and hand the
 * handler the bytes" - the request-side counterpart of declaring a response by
 * media type, and the door for anything the runtime has no business parsing.
 * `true` accepts any well-formed media type.
 */
export type EndpointBodyMediaTypeMap = {
  readonly [mediaType: string]: ValidatorSchema | true
}

export type EndpointRequestContract = {
  params?: ValidatorSchema
  query?: ValidatorSchema
  headers?: ValidatorSchema
  body?: ValidatorSchema | EndpointBodyMediaTypeMap
}

// Discriminates a `body` contract between a single validator schema and a
// media-type map. The schema branch is checked first: `ValidatorSchema`'s
// members each carry a structural marker (`~standard`, the Effect
// `Type`/`Encoded`/`Context`/`ast` shape, or Zod's `parse`/`safeParse`
// family), and TypeScript's "weak type" detection means a map whose keys are
// media-type strings (which never collide with those markers) fails the
// schema check outright — so checking the map shape second is unambiguous.
// Exported so the client-side task can reuse the same discrimination.
export type IsEndpointBodyMediaTypeMap<BODY> = [BODY] extends [ValidatorSchema]
  ? false
  : [BODY] extends [EndpointBodyMediaTypeMap]
    ? true
    : false

/**
 * What a handler may return for a status declared by media type. These are the
 * values the underlying HTTP layer forwards to the socket untouched, rather
 * than serializing: a web `ReadableStream`, a Node readable, a native
 * `Response`, a `Blob`, raw bytes, or an already-encoded string.
 */
export type EndpointMediaResponseBody =
  | ReadableStream
  | Response
  | Blob
  | ArrayBufferView
  | ArrayBuffer
  | string
  | NodeReadableStream

// Values the deep type mappers below must leave completely alone. Mapping a
// `ReadableStream` or a `Response` property-by-property produces a structural
// look-alike that no longer satisfies the real interface, and there is nothing
// to make readonly, mutable, or wider about a stream anyway.
type OpaqueValue = ReadableStream | Response | Blob | ArrayBuffer | ArrayBufferView

// Structural stand-in for a Node `Readable`, matching what the HTTP layer
// sniffs for. Declared structurally rather than imported from `node:stream`
// so this module stays usable from a browser-only type environment - it is
// imported by the client-side types as well as the server runtime.
type NodeReadableStream = {
  pipe: (destination: never) => unknown
  on: (event: string, listener: never) => unknown
}

/**
 * The one door out of JSON. A status declared by media type instead of by
 * schema keeps its place in the contract - its status, its media type, and its
 * OpenAPI entry - while handing the payload entirely to the handler: XML, CSV,
 * a file, an event stream, arbitrary bytes.
 *
 * Nothing here is validated, and that is the whole distinction from the
 * `{ body }` form. Declaring the media type rather than defaulting it is
 * deliberate: taking this door means knowing what you are sending.
 */
export type MediaResponseContract = {
  /**
   * Media type sent for this status, e.g. `'text/csv'`. Required.
   *
   * An array offers several representations of the same status and turns on
   * `Accept` negotiation: the runtime picks one, tells the handler which
   * through `responseMediaType`, and answers 406 when the request accepts
   * none. Declaration order is the endpoint's preference - it breaks ties and
   * answers a request that expresses none.
   */
  media: string | readonly string[]
  description?: string
  headers?: Record<string, ValidatorSchema>
  /**
   * Documentation only: describes the payload, or one chunk of it, in the
   * generated OpenAPI document. Deliberately not named `body` - a `body` is
   * validated, and this never is.
   *
   * With several declared media types, give a map keyed by media type: one
   * schema cannot honestly describe a CSV and a JSON object at once, so a bare
   * schema alongside several media types is rejected rather than copied onto
   * each of them. Types the map omits stay described as opaque bytes.
   */
  schema?: ValidatorSchema | EndpointMediaSchemaMap
}

/** Per-media-type documentation for a response with several representations. */
export type EndpointMediaSchemaMap = {
  readonly [mediaType: string]: ValidatorSchema
}

export type ResponseContract =
  | ValidatorSchema
  | {
      body: ValidatorSchema
      description?: string
      /**
       * Media type for this validated JSON body. Restricted to JSON media
       * types (`application/json` and any `+json` profile such as
       * `application/problem+json`), because a validated body is always
       * serialized as JSON - anything else is `media` instead. Applied to the
       * response, not just to the OpenAPI document.
       */
      contentType?: string
      headers?: Record<string, ValidatorSchema>
    }
  | MediaResponseContract

export type EndpointResponsesContract = Record<number | string, ResponseContract>

/**
 * What the client hands back for a route with a media response. The fetcher is
 * told not to parse it, so this is the live body rather than a decoded copy of
 * it once it has all arrived.
 */
export type EndpointMediaResponseStream = ReadableStream<Uint8Array>

/**
 * Whether any declared status is a media response. This is a property of the
 * whole route, not of one status: a client that must not parse the response
 * cannot parse *part* of it, so one media declaration decides how every status
 * of that route is delivered.
 */
export type HasMediaResponseContract<RESPONSES extends EndpointResponsesContract> = true extends {
  [STATUS in keyof RESPONSES]: RESPONSES[STATUS] extends DeclaredMediaResponse ? true : false
}[keyof RESPONSES]
  ? true
  : false

// Matches both shapes `MediaResponseContract.media` accepts. Written once and
// reused so the single and the negotiated form can never drift apart at the
// type level the way they did when each predicate spelled out `{ media: string }`.
type DeclaredMediaResponse = { media: string | readonly string[] }

export type EndpointIdempotencyMetadata<
  HEADER_NAME extends string = string,
  REQUIRED extends boolean = boolean,
> = {
  enabled: true
  headerName: HEADER_NAME
  required: REQUIRED
}

/**
 * Declares that this endpoint can also be reached by a native `<form>`.
 *
 * Deliberately static, so the whole thing survives the build-time contract
 * extraction and reaches both the client and the server bridge. A callback
 * would have to live in a runtime slot instead, and then the client could not
 * see it - the macro strips runtime-only properties from the contract.
 *
 * See docs/progressive-enhancement.md.
 */
export type EndpointFormContract = {
  /**
   * The page URL the form posts to. A browser navigation to this path is
   * translated into a call to this endpoint, and its response is translated
   * back into what a browser can act on.
   */
  from: string
  /**
   * Where the browser goes after a successful submission, as a template over
   * the response body: `'/todos/{id}'`. A `303` is sent to it, so the history
   * entry the user lands on is a `GET`.
   */
  redirect?: string
}

export type EndpointDefinition = EndpointRequestContract & {
  responses?: EndpointResponsesContract
  summary?: string
  description?: string
  tags?: string[]
  idempotency?: EndpointIdempotencyMetadata
  form?: EndpointFormContract
}

export type EndpointContext<DEFINITION extends EndpointDefinition> = {
  event: RuntimeEvent
  request: Request
  params: InferOutputOrUndefined<DEFINITION['params']>
  query: InferOutputOrUndefined<DEFINITION['query']>
  headers: InferOutputOrUndefined<DEFINITION['headers']>
  body: InferBodyOutputOrUndefined<DEFINITION['body']>
  /**
   * The media type whose schema matched the request when `body` is a
   * media-type map (e.g. `'application/json'`). `undefined` for a single
   * schema `body` contract or when there is no `body` contract at all.
   */
  bodyMediaType: InferBodyMediaType<DEFINITION['body']>
  /**
   * The media type negotiated from the request's `Accept` header, when this
   * endpoint declares any `media` response. Narrowed to the declared union, so
   * a handler offering several representations can branch on it exhaustively.
   * `undefined` when no status declares a media type.
   */
  responseMediaType: InferResponseMediaType<DEFINITION>
  respond: EndpointResponder<DEFINITION>
}

/**
 * The media types this endpoint can be asked for: the representations of its
 * *successful* statuses.
 *
 * Deliberately not every status. A media-typed error - a `problem+json` 404,
 * an HTML error page - is not an alternative the caller chooses between; it is
 * what happens instead. Including those would let a request negotiate its way
 * into a 406 by asking for an error's media type, and would make adding one to
 * a single-representation endpoint silently start refusing clients.
 */
export type ResponseMediaTypes<DEFINITION extends EndpointDefinition> = {
  [STATUS in keyof NormalizeResponses<DEFINITION>]: IsSuccessStatus<
    StatusNumber<STATUS>
  > extends true
    ? NormalizeResponses<DEFINITION>[STATUS] extends { media: infer MEDIA }
      ? MEDIA extends readonly (infer ITEM extends string)[]
        ? ITEM
        : MEDIA extends string
          ? MEDIA
          : never
      : never
    : never
}[keyof NormalizeResponses<DEFINITION>]

type InferResponseMediaType<DEFINITION extends EndpointDefinition> = [
  ResponseMediaTypes<DEFINITION>,
] extends [never]
  ? undefined
  : ResponseMediaTypes<DEFINITION>

// Branches on `IsEndpointBodyMediaTypeMap` up front (rather than composing a
// shared `body` field type into one object, the way `params`/`query`/
// `headers` are handled) so the single-schema-or-no-body branch stays the
// exact single `RemoveNever<{ params; query; headers; body }>` call it
// always was - not-a-map endpoints keep byte-identical option types to
// before media-type maps existed. Splitting that merged object across two
// separate `RemoveNever` calls (one for params/query/headers, one for body)
// was tried and rejected: the two calls no longer type-check as *equal* to
// the merged form under `expect-type`'s `toEqualTypeOf`, even though both
// are mutually assignable, which would have been a silent breaking change
// for every existing non-map endpoint's generated option type.
export type EndpointClientOptions<DEFINITION extends EndpointDefinition> =
  IsEndpointBodyMediaTypeMap<DEFINITION['body']> extends true
    ? EndpointMediaTypeBodyClientOptions<DEFINITION>
    : EndpointSingleBodyClientOptions<DEFINITION>

type EndpointSingleBodyClientOptions<DEFINITION extends EndpointDefinition> = OptionalIfEmpty<
  RemoveNever<{
    params: InferInputOrNever<DEFINITION['params']>
    query: InferInputOrNever<DEFINITION['query']>
    headers: InferInputOrNever<DEFINITION['headers']>
    body: InferInputOrNever<DEFINITION['body']>
  }> &
    EndpointIdempotencyClientOptions<DEFINITION> &
    EndpointAcceptClientOptions<DEFINITION>
>

type EndpointMediaTypeBodyClientOptions<DEFINITION extends EndpointDefinition> =
  DEFINITION extends {
    body: infer BODY extends EndpointBodyMediaTypeMap
  }
    ? OptionalIfEmpty<
        RemoveNever<{
          params: InferInputOrNever<DEFINITION['params']>
          query: InferInputOrNever<DEFINITION['query']>
          headers: InferInputOrNever<DEFINITION['headers']>
        }> &
          EndpointBodyMediaTypeClientOptions<BODY> &
          EndpointIdempotencyClientOptions<DEFINITION> &
          EndpointAcceptClientOptions<DEFINITION>
      >
    : never

export type EndpointClientOptionsAreOptional<DEFINITION extends EndpointDefinition> = [
  EndpointClientOptions<DEFINITION>,
] extends [void]
  ? true
  : {} extends EndpointClientOptions<DEFINITION>
    ? true
    : false

export type EndpointSuccessBody<DEFINITION extends EndpointDefinition> = SuccessResponseBody<
  NormalizeResponses<DEFINITION>
>

export type HandlerReturn<DEFINITION extends EndpointDefinition> = [
  keyof NormalizeResponses<DEFINITION>,
] extends [never]
  ? unknown
  : DirectSuccessReturn<DEFINITION> | StatusResponseReturn<DEFINITION> | void

export type HasEndpointResponses<DEFINITION extends EndpointDefinition> = [
  keyof NormalizeResponses<DEFINITION>,
] extends [never]
  ? false
  : true

export type EndpointHandler<DEFINITION extends EndpointDefinition, ACTUAL_RETURN> = (
  context: EndpointContext<DEFINITION>,
) => ACTUAL_RETURN & Check<Awaited<ACTUAL_RETURN>, HandlerReturn<DEFINITION>>

// Readonly projection of a handler's expected return. Used as the constraint
// on the `const`-captured actual return: `const` capture keeps inline literals
// and tuples narrow, but the captured value is deeply readonly, so a mutable
// expected type would reject it (TS4104). Projecting the expectation instead
// keeps the check exact - including tuple arity - while accepting both plain
// and `as const` returns.
export type DeepReadonly<VALUE> = VALUE extends
  | Date
  | RegExp
  | Error
  | OpaqueValue
  | ((...args: never[]) => unknown)
  ? VALUE
  : VALUE extends ReadonlyMap<infer KEY, infer ITEM>
    ? ReadonlyMap<DeepReadonly<KEY>, DeepReadonly<ITEM>>
    : VALUE extends ReadonlySet<infer ITEM>
      ? ReadonlySet<DeepReadonly<ITEM>>
      : VALUE extends readonly unknown[]
        ? number extends VALUE['length']
          ? readonly DeepReadonly<VALUE[number]>[]
          : { readonly [KEY in keyof VALUE]: DeepReadonly<VALUE[KEY]> }
        : VALUE extends object
          ? { readonly [KEY in keyof VALUE]: DeepReadonly<VALUE[KEY]> }
          : VALUE

// Handler shape for an endpoint with declared responses. The return type is
// the bare captured type: the `const` type parameter at the call site does the
// narrowing and its constraint does the checking, so no `Check` intersection
// is involved. Intersecting here was tried and defeats the capture.
export type CapturedEndpointHandler<DEFINITION extends EndpointDefinition, ACTUAL_RETURN> = (
  context: EndpointContext<DEFINITION>,
) => ACTUAL_RETURN | Promise<ACTUAL_RETURN>

// Undoes a `const` capture for endpoints with no declared responses, where the
// captured literals describe one sample implementation rather than the API.
// Applied in the handler's return type - never in a parameter position, which
// would defeat the capture it exists to reverse.
export type WidenCapturedReturn<VALUE> = VALUE extends
  | Date
  | RegExp
  | Error
  | OpaqueValue
  | ((...args: never[]) => unknown)
  ? VALUE
  : // A `respond()` result keeps its wrapper and its status literal - the
    // status is a deliberate choice, not a sample value - while its body is
    // widened like any other inferred return.
    VALUE extends StatusResponse<infer STATUS, infer BODY, infer HEADERS>
    ? StatusResponse<STATUS, WidenCapturedReturn<BODY>, HEADERS>
    : VALUE extends string
      ? string
      : VALUE extends number
        ? number
        : VALUE extends boolean
          ? boolean
          : VALUE extends bigint
            ? bigint
            : VALUE extends readonly unknown[]
              ? WidenCapturedReturn<VALUE[number]>[]
              : VALUE extends object
                ? { -readonly [KEY in keyof VALUE]: WidenCapturedReturn<VALUE[KEY]> }
                : VALUE

export type EndpointResponder<DEFINITION extends EndpointDefinition> =
  HasEndpointResponses<DEFINITION> extends true
    ? DeclaredEndpointResponder<DEFINITION>
    : InferredEndpointResponder

type DeclaredEndpointResponder<DEFINITION extends EndpointDefinition> = <
  const STATUS extends EndpointResponseStatus<DEFINITION>,
>(
  status: STATUS,
  body: ResponseBodyForStatus<NormalizeResponses<DEFINITION>, STATUS>,
  options?: ResponseOptions,
) => StatusResponse<STATUS, ResponseBodyForStatus<NormalizeResponses<DEFINITION>, STATUS>>

type InferredEndpointResponder = <
  const STATUS extends StatusCode,
  const BODY,
  const HEADERS extends Record<string, string> = Record<string, string>,
>(
  status: STATUS,
  body: BODY,
  options?: ResponseOptions<HEADERS>,
) => StatusResponse<STATUS, BODY, HEADERS>

export type EndpointResponseStatus<DEFINITION extends EndpointDefinition> = StatusNumber<
  keyof NormalizeResponses<DEFINITION>
>

type Check<ACTUAL, EXPECTED> = [DeepMutable<ACTUAL>] extends [EXPECTED] ? unknown : never

export type DeepMutable<VALUE> = VALUE extends
  | Date
  | RegExp
  | Error
  | OpaqueValue
  | ((...args: never[]) => unknown)
  ? VALUE
  : VALUE extends ReadonlyMap<infer KEY, infer ITEM>
    ? Map<DeepMutable<KEY>, DeepMutable<ITEM>>
    : VALUE extends ReadonlySet<infer ITEM>
      ? Set<DeepMutable<ITEM>>
      : VALUE extends readonly unknown[]
        ? // A tuple's `length` is a literal, so `number extends length` only
          // holds for unbounded arrays. Tuples are mapped element-wise to keep
          // their arity and per-position types; collapsing them to
          // `DeepMutable<ITEM>[]` would make a tuple response schema
          // unsatisfiable.
          number extends VALUE['length']
          ? DeepMutable<VALUE[number]>[]
          : { -readonly [KEY in keyof VALUE]: DeepMutable<VALUE[KEY]> }
        : VALUE extends object
          ? { -readonly [KEY in keyof VALUE]: DeepMutable<VALUE[KEY]> }
          : VALUE

export type UnknownIfNever<VALUE> = [VALUE] extends [never] ? unknown : VALUE

export type IsSuccessStatus<STATUS extends number> = number extends STATUS
  ? boolean
  : `${STATUS}` extends `2${string}`
    ? true
    : false

type OptionalIfEmpty<T extends Record<string, unknown>> = keyof T extends never ? void : T

type RemoveNever<T extends Record<string, unknown>> = {
  [KEY in keyof T as T[KEY] extends never ? never : KEY]: T[KEY]
}

// Sent as the `Accept` header. Optional even when several representations are
// declared: omitting it takes the endpoint's own first-declared preference,
// which is a better default than making every caller choose.
type EndpointAcceptClientOptions<DEFINITION extends EndpointDefinition> = [
  ResponseMediaTypes<DEFINITION>,
] extends [never]
  ? {}
  : { accept?: ResponseMediaTypes<DEFINITION> }

type EndpointIdempotencyClientOptions<DEFINITION extends EndpointDefinition> = DEFINITION extends {
  idempotency: { required: true }
}
  ? { idempotencyKey?: string | true }
  : DEFINITION extends { idempotency: EndpointIdempotencyMetadata }
    ? { idempotencyKey?: string | true }
    : {}

type InferOutputOrUndefined<SCHEMA> = SCHEMA extends ValidatorSchema
  ? InferOutput<SCHEMA>
  : undefined

// Same as `InferOutputOrUndefined`, but for `body` specifically: a
// media-type map infers to the union of all its members' outputs.
type InferBodyOutputOrUndefined<BODY> = BODY extends ValidatorSchema
  ? InferOutput<BODY>
  : BODY extends Record<string, infer MEMBER>
    ? InferMediaTypeMemberOutput<MEMBER>
    : undefined

// An unparsed member (`true`) reaches the handler as bytes; a schema member
// reaches it as that schema's output.
type InferMediaTypeMemberOutput<MEMBER> = MEMBER extends true
  ? Uint8Array
  : MEMBER extends ValidatorSchema
    ? InferOutput<MEMBER>
    : never

// `keyof BODY` (or an indexed access like `BODY[keyof BODY]`) on a generic
// `BODY` parameter produces a deferred type that breaks `DefinedEndpoint`'s
// structural comparability across its own generic instantiations (see the
// `.idempotency()` overloads below) — so, like `InferBodyOutputOrUndefined`
// above, this infers the media-type keys instead of indexing into `BODY`.
type InferBodyMediaType<BODY> = BODY extends ValidatorSchema
  ? undefined
  : BODY extends Record<infer MEDIA_TYPE extends string, ValidatorSchema | true>
    ? MEDIA_TYPE
    : undefined

// Used for `params`/`query`/`headers` (never a media-type map) and for a
// single-schema `body` contract. A media-type map `body` is handled
// separately by `EndpointMediaTypeBodyClientOptions` above.
type InferInputOrNever<SCHEMA> = SCHEMA extends ValidatorSchema ? InferInput<SCHEMA> : never

// The wire-format value the client accepts once a media-type map member
// other than `application/json` is explicitly selected via `mediaType`.
// Deliberately NOT derived from the member's validator schema: turning an
// arbitrary schema input into `application/x-www-form-urlencoded` or
// `multipart/form-data` wire bytes (nested objects, arrays, where a `File`
// belongs) is a serialization convention this library does not invent, so
// the client is honest about it and asks for the wire value directly - the
// same value the runtime would hand back out of `readBody`/`FormData`/plain
// text parsing. `application/json` is the one exception, handled directly in
// `EndpointBodyMediaTypeClientOptions` below since its member schema *can*
// honestly describe an input shape.
type EndpointBodyMediaTypeWireValue<MEDIA_TYPE extends string> =
  MEDIA_TYPE extends 'application/x-www-form-urlencoded'
    ? URLSearchParams
    : MEDIA_TYPE extends 'multipart/form-data'
      ? FormData
      : MEDIA_TYPE extends `text/${string}`
        ? string
        : never

// Client request option shape for a media-type-map `body` contract: one
// member per declared media type, unioned so a literal `mediaType` value
// narrows `body`'s type at the call site.
//
// - When the map has an `application/json` member, `mediaType` is optional
//   for it: omitting `mediaType` behaves exactly like the pre-existing
//   single-schema `body` contract (`body` typed as that member's
//   `InferInput`), and passing `mediaType: 'application/json'` explicitly
//   types `body` the same way.
// - Every other member requires `mediaType` to be given explicitly, and its
//   `body` is typed as the member's wire value (`EndpointBodyMediaTypeWireValue`),
//   not its schema's input - see the "no magic serialization" reasoning above.
// - If the map has no `application/json` member at all, there is no default
//   to omit `mediaType` for, so it is required outright for every member.
type EndpointBodyMediaTypeClientOptions<MAP extends EndpointBodyMediaTypeMap> = {
  [MEDIA_TYPE in keyof MAP & string]: MAP extends {
    'application/json': infer JSON_SCHEMA extends ValidatorSchema
  }
    ? MEDIA_TYPE extends 'application/json'
      ? { mediaType?: MEDIA_TYPE; body: InferInput<JSON_SCHEMA> }
      : { mediaType: MEDIA_TYPE; body: EndpointBodyMediaTypeMemberWireValue<MAP, MEDIA_TYPE> }
    : { mediaType: MEDIA_TYPE; body: EndpointBodyMediaTypeMemberWireValue<MAP, MEDIA_TYPE> }
}[keyof MAP & string]

// An unparsed member takes bytes on the wire, whatever its media type says;
// a schema member takes the wire value that media type implies.
type EndpointBodyMediaTypeMemberWireValue<
  MAP extends EndpointBodyMediaTypeMap,
  MEDIA_TYPE extends keyof MAP & string,
> = MAP[MEDIA_TYPE] extends true
  ? Uint8Array | ArrayBuffer | Blob
  : EndpointBodyMediaTypeWireValue<MEDIA_TYPE>

export type NormalizeResponses<DEFINITION extends EndpointDefinition> = DEFINITION extends {
  responses: infer RESPONSES extends EndpointResponsesContract
}
  ? RESPONSES
  : {}

type DirectSuccessReturn<DEFINITION extends EndpointDefinition> = ResponseBodyForStatus<
  NormalizeResponses<DEFINITION>,
  200
>

type StatusResponseReturn<DEFINITION extends EndpointDefinition> = {
  [STATUS in keyof NormalizeResponses<DEFINITION>]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends
    StatusCode
    ? StatusResponse<STATUS_NUMBER, ResponseBody<NormalizeResponses<DEFINITION>[STATUS]>>
    : never
}[keyof NormalizeResponses<DEFINITION>]

export type ResponseBodyForStatus<
  RESPONSES extends EndpointResponsesContract,
  STATUS extends StatusCode,
> = {
  [KEY in keyof RESPONSES]: StatusNumber<KEY> extends STATUS ? ResponseBody<RESPONSES[KEY]> : never
}[keyof RESPONSES]

export type SuccessResponseBody<RESPONSES extends EndpointResponsesContract> = {
  [KEY in keyof RESPONSES]: `${StatusNumber<KEY>}` extends `2${string}`
    ? ResponseBody<RESPONSES[KEY]>
    : never
}[keyof RESPONSES]

export type ResponseBody<RESPONSE> = RESPONSE extends DeclaredMediaResponse
  ? EndpointMediaResponseBody
  : RESPONSE extends { body: infer BODY extends ValidatorSchema }
    ? InferOutput<BODY>
    : RESPONSE extends ValidatorSchema
      ? InferOutput<RESPONSE>
      : never

export type StatusNumber<STATUS> = STATUS extends number
  ? STATUS
  : STATUS extends `${infer STATUS_NUMBER extends number}`
    ? STATUS_NUMBER
    : never
