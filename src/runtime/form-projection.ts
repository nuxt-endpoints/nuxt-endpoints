// What a native `<form>` can and cannot do, expressed as a type.
//
// A form projection is only honest if a browser could actually produce the
// request the contract describes. GET forms populate the query string; POST
// forms populate a form-encoded body and reach their endpoint through the
// bridge. Neither can set request headers or send an `Idempotency-Key`.
// Declaring `form` on a contract that needs anything else would compile and
// then fail at runtime for reasons the declaration never hinted at, so it fails
// to compile instead.
//
// This type is early editor feedback, not the enforcement boundary. Nuxt does
// not require a full TypeScript check for every build, JavaScript has no type
// check, and a cast erases the result. `resolveFormMetadata()` (src/module.ts)
// is therefore the authoritative build-time check; the type mirrors the rules
// it can prove statically. See docs/progressive-enhancement.md.
import type { EndpointBodyMediaTypeMap } from './contract'
import type { InferInput } from './validator'

/**
 * Turns a rule into a compile error whose text is the reason.
 *
 * The reason becomes a required property name, so the declaration - which has
 * no such property - is rejected with "Property '<reason>' is missing". That
 * puts the explanation in the error itself rather than in a doc the author has
 * to go find.
 */
export type NativeFormRefusal<REASON extends string> = { readonly [KEY in REASON]: never }

/** A form can only submit these two encodings. */
type BrowserSubmittableBody<BODY> = BODY extends EndpointBodyMediaTypeMap
  ? 'multipart/form-data' extends keyof BODY
    ? true
    : 'application/x-www-form-urlencoded' extends keyof BODY
      ? true
      : false
  : false

/**
 * Whether a schema requires nothing. A declaration a browser cannot satisfy is
 * still fine as long as nothing in it is required.
 */
type RequiresNothing<SCHEMA> = SCHEMA extends undefined
  ? true
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {} extends InferInput<SCHEMA>
    ? true
    : false

/**
 * `unknown` when a browser could produce this request, and a refusal carrying
 * the reason when it could not. Intersected with the declared `form` value, so
 * the error lands on `form` rather than somewhere further away.
 */
export type NativeFormProjectionConstraint<FORM, QUERY, HEADERS, BODY, IDEMPOTENCY> = FORM extends {
  method: 'get'
}
  ? QUERY extends undefined
    ? NativeFormRefusal<'A GET form needs validate.query to declare its fields.'>
    : BODY extends undefined
      ? IDEMPOTENCY extends undefined
        ? RequiresNothing<HEADERS> extends false
          ? NativeFormRefusal<'A native <form> cannot send request headers, so validate.headers cannot require any.'>
          : unknown
        : NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
      : NativeFormRefusal<'A GET form sends fields in the query string, so validate.body must be omitted.'>
  : BrowserSubmittableBody<BODY> extends false
    ? NativeFormRefusal<"A native <form> can only send 'application/x-www-form-urlencoded' or 'multipart/form-data'. Declare one on validate.body - formOf() derives it from the JSON member.">
    : IDEMPOTENCY extends undefined
      ? RequiresNothing<HEADERS> extends false
        ? NativeFormRefusal<'A native <form> cannot send request headers, so validate.headers cannot require any.'>
        : RequiresNothing<QUERY> extends false
          ? NativeFormRefusal<'A POST form reaches the endpoint with no query string, so validate.query cannot require any.'>
          : unknown
      : NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
