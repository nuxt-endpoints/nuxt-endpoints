// What a native `<form>` can and cannot do, expressed as a type.
//
// A form projection is only honest if a browser could actually produce the
// request the contract describes. A browser cannot set request headers, cannot
// add a query string to where the bridge forwards the submission, and cannot
// send an `Idempotency-Key`. Declaring `form` on a contract that needs any of
// those would compile and then fail at runtime for reasons the declaration
// never hinted at, so it fails to compile instead.
//
// The check is duplicated in `resolveFormMetadata()` (src/module.ts) rather
// than trusted from here: a cast erases the type but must not erase the rule.
// See docs/progressive-enhancement.md.
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
export type NativeFormProjectionConstraint<QUERY, HEADERS, BODY, IDEMPOTENCY> =
  BrowserSubmittableBody<BODY> extends false
    ? NativeFormRefusal<"A native <form> can only send 'application/x-www-form-urlencoded' or 'multipart/form-data'. Declare one on validate.body - formOf() derives it from the JSON member.">
    : IDEMPOTENCY extends undefined
      ? RequiresNothing<HEADERS> extends false
        ? NativeFormRefusal<'A native <form> cannot send request headers, so validate.headers cannot require any.'>
        : RequiresNothing<QUERY> extends false
          ? NativeFormRefusal<'A native <form> submission reaches the endpoint with no query string, so validate.query cannot require any.'>
          : unknown
      : NativeFormRefusal<'A native <form> cannot send an Idempotency-Key header, so an idempotent route cannot declare form.'>
