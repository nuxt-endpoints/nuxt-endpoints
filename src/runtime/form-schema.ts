// Derives the form-encoded member of a body contract from the member that
// describes the same input as JSON.
//
// A form can only send strings, so a contract that accepts
// `application/x-www-form-urlencoded` or `multipart/form-data` needs a schema
// whose input is strings but whose *output* is identical to the JSON member's -
// otherwise the handler sees a union and the two encodings drift apart.
//
// This does not rewrite the schema. It wraps it: the wrapper coerces the raw
// field values using the JSON Schema this module already derives for OpenAPI,
// then delegates to the original schema. That keeps three properties that a
// per-library schema transform could not:
//
// - the output type is the original's by construction, not by discipline;
// - it works for every supported schema library, because the only introspection
//   used is the JSON Schema conversion that is already library-agnostic;
// - the coercion rules live in one place, applied when the contract is defined,
//   and visible in the generated document.
//
// See docs/progressive-enhancement.md for why the bridge does not do this at
// request time instead.
import {
  createJsonSchemaContext,
  getJsonSchemaComponents,
  parseValidator,
  toJsonSchema,
} from './validator'
import type { JsonSchema } from './validator'
import type {
  InferInput,
  InferOutput,
  StandardSchemaLike,
  ValidatorSchema,
} from './validators/common'

/** What a form actually delivers for one field. */
export type FormSchemaInput = Record<string, string | string[] | File>

/**
 * Carries the wrapped schema's input type past the wrapper, which otherwise
 * erases it: what a form delivers is untyped strings, but what its *fields*
 * are named is the declaration's own input. Phantom - never present at
 * runtime, and optional so a schema that is not a `formOf()` result simply
 * does not match.
 */
declare const formInputType: unique symbol

export type FormSchema<SCHEMA extends ValidatorSchema> = StandardSchemaLike<
  FormSchemaInput,
  InferOutput<SCHEMA>
> & {
  readonly [formInputType]?: InferInput<SCHEMA>
  /**
   * Read by `toJsonSchema()` through its existing provider hook, so the
   * generated document describes this member with the declared field types
   * rather than as an opaque schema.
   */
  readonly jsonSchema?: JsonSchema
}

/**
 * The fields a schema declares, whether it was wrapped by `formOf()` or
 * declared as a `multipart/form-data` member directly. An absent phantom
 * infers as `unknown`, which is what distinguishes the two.
 */
export type FormInputOf<SCHEMA> = SCHEMA extends { readonly [formInputType]?: infer INPUT }
  ? unknown extends INPUT
    ? InferInput<SCHEMA>
    : INPUT
  : InferInput<SCHEMA>

type FormFieldKind = 'number' | 'boolean' | 'array' | 'passthrough'

const falseFormValues = new Set(['', '0', 'false', 'off', 'no'])

/**
 * Wraps a schema so it accepts the string fields a form sends.
 *
 * ```ts
 * validate: {
 *   body: {
 *     'application/json': User,
 *     'application/x-www-form-urlencoded': formOf(User),
 *   },
 * }
 * ```
 *
 * Applied rules, in the one place they exist:
 *
 * - a declared number receives `Number(value)`, and an empty input counts as
 *   absent rather than `NaN`, so an optional field stays optional;
 * - a declared boolean is `false` for `''`, `'0'`, `'false'`, `'off'`, `'no'`
 *   and true otherwise - and **`false` when the field is missing entirely**,
 *   which is what an unticked checkbox sends;
 * - a declared array receives a single value wrapped, since a form sends one
 *   entry per value;
 * - everything else is passed through untouched, including `File` values and
 *   date strings. A schema that wants a `Date` therefore has to coerce it
 *   itself, because a `date-time` string is indistinguishable from a plain
 *   string that happens to be declared with that format.
 *
 * Two shapes are rejected when the contract is defined rather than handled
 * silently at request time: a root schema that is not an object, and a field
 * that is itself an object or an array of objects. Expressing a nested field in
 * a form needs a name-mangling convention, and inventing one would put a
 * private encoding into a public contract.
 */
export function formOf<const SCHEMA extends ValidatorSchema>(schema: SCHEMA): FormSchema<SCHEMA> {
  const { fields, jsonSchema } = planFormSchema(schema)

  const validator: FormSchema<SCHEMA> = {
    '~standard': {
      version: 1,
      vendor: 'nuxt-endpoints',
      validate: async (input: unknown) => {
        const result = await parseValidator(schema, coerceFormInput(input, fields))
        return result.success ? { value: result.value } : { issues: result.issues }
      },
    },
  }

  return jsonSchema ? Object.assign(validator, { jsonSchema }) : validator
}

function planFormSchema(schema: ValidatorSchema): {
  fields: Map<string, FormFieldKind>
  jsonSchema?: JsonSchema
} {
  // The input direction, not the output one: a schema that transforms its input
  // (a confirmation field dropped before the handler sees it, say) describes the
  // fields a form actually sends only on the way in. The output direction is
  // unrepresentable for such a schema and answers `{}`, which would leave the
  // coercion plan empty.
  const context = createJsonSchemaContext()
  const converted = toJsonSchema(schema, context, { mode: 'input' })
  const properties = objectProperties(converted)
  if (!properties) {
    throw new TypeError(
      'formOf() expects a schema describing an object of form fields. A form sends named fields, so a non-object body cannot be form-encoded.',
    )
  }

  const fields = new Map<string, FormFieldKind>()
  for (const [name, property] of Object.entries(properties)) {
    fields.set(name, classifyFormField(property, name))
  }

  // A provided JSON Schema is handed to the document as-is, with no chance to
  // contribute components alongside it, so a schema that needed them would
  // leave dangling `$ref`s. Measured: the supported libraries inline everything
  // for the shapes a form can express, so this should be unreachable.
  //
  // It fails rather than dropping the documentation, because a contract that is
  // declared and then silently not described is exactly the degradation this
  // module refuses everywhere else.
  const components = getJsonSchemaComponents(context)
  if (components?.schemas && Object.keys(components.schemas).length > 0) {
    throw new TypeError(
      "formOf(): this schema converts into shared components, which cannot be carried alongside a derived member. Declare this media type's member by hand so the generated document keeps its references.",
    )
  }

  return { fields, jsonSchema: converted }
}

function classifyFormField(property: JsonSchema, name: string): FormFieldKind {
  const type = jsonSchemaType(property)
  if (type === 'object') {
    throw new TypeError(
      `formOf(): field "${name}" is an object. A form has no way to express a nested field without a name-mangling convention, which would put a private encoding into a public contract. Flatten the field, or declare this media type's member by hand.`,
    )
  }
  if (type === 'array') {
    const items = isJsonSchemaObject(property) ? property.items : undefined
    if (jsonSchemaType(items) === 'object') {
      throw new TypeError(
        `formOf(): field "${name}" is an array of objects, which a form cannot express. Flatten the field, or declare this media type's member by hand.`,
      )
    }
    return 'array'
  }
  if (type === 'number' || type === 'integer') {
    return 'number'
  }
  if (type === 'boolean') {
    return 'boolean'
  }
  return 'passthrough'
}

function coerceFormInput(input: unknown, fields: Map<string, FormFieldKind>): unknown {
  const source = toFieldRecord(input)
  if (!source) {
    // Not a field record at all - let the wrapped schema report it, so the
    // failure reads the same as any other contract failure.
    return input
  }

  const output: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(source)) {
    const coerced = coerceFormField(fields.get(name), value)
    if (coerced !== undefined) {
      output[name] = coerced
    }
  }

  for (const [name, kind] of fields) {
    if (kind === 'boolean' && !(name in output)) {
      output[name] = false
    }
  }

  return output
}

function coerceFormField(kind: FormFieldKind | undefined, value: unknown): unknown {
  if (kind === 'array') {
    return Array.isArray(value) ? value : [value]
  }
  if (typeof value !== 'string') {
    // A `File`, or a repeated field the runtime already collected into an
    // array. Neither is ours to reinterpret.
    return value
  }
  if (kind === 'number') {
    return value === '' ? undefined : Number(value)
  }
  if (kind === 'boolean') {
    return !falseFormValues.has(value)
  }
  return value
}

function toFieldRecord(input: unknown): Record<string, unknown> | undefined {
  if (typeof URLSearchParams !== 'undefined' && input instanceof URLSearchParams) {
    return collectEntries(input.entries())
  }
  if (typeof FormData !== 'undefined' && input instanceof FormData) {
    return collectEntries(input.entries())
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return { ...(input as Record<string, unknown>) }
  }
  return undefined
}

/** Repeated names become arrays, matching how the runtime reads a form body. */
function collectEntries(entries: IterableIterator<[string, unknown]>): Record<string, unknown> {
  const collected: Record<string, unknown> = {}
  for (const [name, value] of entries) {
    const existing = collected[name]
    if (existing === undefined) {
      collected[name] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      collected[name] = [existing, value]
    }
  }
  return collected
}

function isJsonSchemaObject(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema)
}

function objectProperties(schema: JsonSchema): Record<string, JsonSchema> | undefined {
  if (!isJsonSchemaObject(schema)) {
    return undefined
  }
  const properties = schema.properties
  if (!isJsonSchemaObject(properties)) {
    return undefined
  }
  return properties as Record<string, JsonSchema>
}

function jsonSchemaType(schema: unknown): string | undefined {
  if (!isJsonSchemaObject(schema)) {
    return undefined
  }
  const type = schema.type
  if (typeof type === 'string') {
    return type
  }
  if (Array.isArray(type)) {
    return type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null')
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schema[key]
    if (!Array.isArray(branches)) {
      continue
    }
    for (const branch of branches) {
      const branchType = jsonSchemaType(branch)
      if (branchType && branchType !== 'null') {
        return branchType
      }
    }
  }
  return undefined
}

/**
 * The HTML attributes a declared field carries, derived from the same JSON
 * Schema `formOf()` plans from.
 *
 * This is the first of the three validation layers: it costs nothing, it works
 * with no JavaScript, and the browser localizes the message itself.
 */
export type FormFieldAttributes = {
  name: string
  /** Only where the format *is* the control: an email, a URL, or a file. */
  type?: 'email' | 'url' | 'file'
  required?: true
  minlength?: number
  maxlength?: number
  min?: number
  max?: number
  step?: number
  pattern?: string
  accept?: string
}

/**
 * Derives one attribute set per declared field.
 *
 * Read in the input direction, because a schema that transforms its input no
 * longer mentions the fields a form sends on the way out.
 *
 * Four decisions the conversion forces, each measured against Zod's output:
 *
 * - **Safe-integer bounds are dropped.** A plain `z.number().int()` reports
 *   `minimum: -9007199254740991`, which carries no authoring intent.
 * - **`required` is never emitted for a boolean.** On a checkbox it would mean
 *   "must be ticked", but a declared `z.boolean()` only means the field is
 *   present - and `formOf()` supplies `false` when an unticked box sends
 *   nothing.
 * - **`type` is emitted only where the format is the control**: `email`, `url`,
 *   and `file`. Whether a string field is `text`, `password`, or `search` is a
 *   presentation choice that belongs to the template. Where `type` is emitted,
 *   an explicit `type` placed after `v-bind` still wins.
 * - **An exclusive bound becomes an inclusive one only for integers**, where
 *   `exclusiveMinimum: 0` is exactly `min="1"`. HTML cannot express an
 *   exclusive bound on a fractional field, so it is left off rather than
 *   widened into something false.
 */
export function formFieldAttributes(schema: ValidatorSchema): Record<string, FormFieldAttributes> {
  const context = createJsonSchemaContext()
  const converted = toJsonSchema(schema, context, { mode: 'input' })
  const properties = objectProperties(converted)
  if (!properties) {
    throw new TypeError(
      'formFieldAttributes() expects a schema describing an object of form fields.',
    )
  }

  const required = new Set(requiredPropertyNames(converted))
  const attributes: Record<string, FormFieldAttributes> = {}
  for (const [name, property] of Object.entries(properties)) {
    attributes[name] = fieldAttributes(name, property, required.has(name))
  }
  return attributes
}

function fieldAttributes(
  name: string,
  property: JsonSchema,
  isRequired: boolean,
): FormFieldAttributes {
  const attributes: FormFieldAttributes = { name }
  if (!isJsonSchemaObject(property)) {
    return attributes
  }

  const type = jsonSchemaType(property)
  const format = typeof property.format === 'string' ? property.format : undefined

  if (format === 'email') {
    attributes.type = 'email'
  } else if (format === 'uri') {
    attributes.type = 'url'
  } else if (format === 'binary') {
    attributes.type = 'file'
    if (typeof property.contentMediaType === 'string') {
      attributes.accept = property.contentMediaType
    }
  }

  // A checkbox's `required` means "must be ticked", which a declared boolean
  // does not ask for.
  if (isRequired && type !== 'boolean') {
    attributes.required = true
  }

  if (type === 'string' && attributes.type !== 'file') {
    assignNumber(attributes, 'minlength', property.minLength)
    assignNumber(attributes, 'maxlength', property.maxLength)
    // `format` already carries the rule for an email or a URL, and Zod's own
    // pattern for those is long enough to bury the markup.
    if (!attributes.type && typeof property.pattern === 'string') {
      attributes.pattern = property.pattern
    }
  }

  if (type === 'number' || type === 'integer') {
    const isInteger = type === 'integer'
    assignBound(attributes, 'min', property.minimum, property.exclusiveMinimum, isInteger, 1)
    assignBound(attributes, 'max', property.maximum, property.exclusiveMaximum, isInteger, -1)
    if (typeof property.multipleOf === 'number') {
      attributes.step = property.multipleOf
    } else if (isInteger) {
      attributes.step = 1
    }
  }

  return attributes
}

function assignNumber(
  attributes: FormFieldAttributes,
  key: 'minlength' | 'maxlength',
  value: unknown,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    attributes[key] = value
  }
}

function assignBound(
  attributes: FormFieldAttributes,
  key: 'min' | 'max',
  inclusive: unknown,
  exclusive: unknown,
  isInteger: boolean,
  step: 1 | -1,
): void {
  if (typeof inclusive === 'number' && !isSafeIntegerBound(inclusive)) {
    attributes[key] = inclusive
    return
  }
  // An exclusive bound is only expressible for an integer.
  if (isInteger && typeof exclusive === 'number' && !isSafeIntegerBound(exclusive)) {
    attributes[key] = exclusive + step
  }
}

/** A bound at the safe-integer limit is Zod's own, not the author's. */
function isSafeIntegerBound(value: number): boolean {
  return value === Number.MAX_SAFE_INTEGER || value === Number.MIN_SAFE_INTEGER
}

function requiredPropertyNames(schema: JsonSchema): string[] {
  if (!isJsonSchemaObject(schema) || !Array.isArray(schema.required)) {
    return []
  }
  return schema.required.filter((name): name is string => typeof name === 'string')
}
