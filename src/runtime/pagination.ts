import {
  inspectValidatorInputObject,
  inspectValidatorOutputObject,
  parseValidator,
  toJsonSchema,
} from './validator'
import type {
  InferInput,
  InferOutput,
  StandardSchemaLike,
  ValidationIssue,
  ValidatorSchema,
} from './validator'

export const cursorPaginationDefaults = {
  status: 200,
  cursor: 'cursor',
  limit: 'limit',
  items: 'items',
  next: 'nextCursor',
  defaultLimit: 20,
  maxLimit: 100,
} as const

/**
 * Constructs the complete request/response contract for cursor pagination.
 * The item schema belongs here rather than in `validate.response`, leaving one
 * source of truth for the generated page envelope.
 */
export type EndpointCursorPaginationContract<ITEM extends ValidatorSchema = ValidatorSchema> = {
  kind: 'cursor'
  item: ITEM
}

export type EndpointPaginationContract = EndpointCursorPaginationContract

/** Serializable capability carried by the generated browser client. */
export type EndpointPaginationRouteMetadata = Pick<
  typeof cursorPaginationDefaults,
  'status' | 'cursor' | 'limit' | 'items' | 'next'
> & { kind: 'cursor' }

export function cursorPaginationRouteMetadata(
  pagination: EndpointPaginationContract,
): EndpointPaginationRouteMetadata {
  if (
    typeof pagination !== 'object' ||
    pagination === null ||
    pagination.kind !== 'cursor' ||
    !pagination.item
  ) {
    throw new TypeError("pagination must be { kind: 'cursor', item: <validator schema> }.")
  }
  return {
    kind: 'cursor',
    status: cursorPaginationDefaults.status,
    cursor: cursorPaginationDefaults.cursor,
    limit: cursorPaginationDefaults.limit,
    items: cursorPaginationDefaults.items,
    next: cursorPaginationDefaults.next,
  }
}

type ObjectInput<SCHEMA> = SCHEMA extends ValidatorSchema
  ? InferInput<SCHEMA> extends Record<string, unknown>
    ? InferInput<SCHEMA>
    : Record<never, never>
  : Record<never, never>

type ObjectOutput<SCHEMA> = SCHEMA extends ValidatorSchema
  ? InferOutput<SCHEMA> extends Record<string, unknown>
    ? InferOutput<SCHEMA>
    : Record<never, never>
  : Record<never, never>

export type CursorPaginationQueryInput<QUERY> = ObjectInput<QUERY> & {
  cursor?: string
  limit?: number
}

export type CursorPaginationQueryOutput<QUERY> = ObjectOutput<QUERY> & {
  cursor?: string
  limit: number
}

export type CursorPaginationPage<ITEM extends ValidatorSchema> = {
  items: InferOutput<ITEM>[]
  nextCursor?: string
}

export type CursorPaginationQuerySchema<QUERY> = StandardSchemaLike<
  CursorPaginationQueryInput<QUERY>,
  CursorPaginationQueryOutput<QUERY>
> & { toJSONSchema: () => object }

export type CursorPaginationResponseSchema<ITEM extends ValidatorSchema> = StandardSchemaLike<
  { items: InferInput<ITEM>[]; nextCursor?: string },
  CursorPaginationPage<ITEM>
> & { toJSONSchema: () => object }

export type PaginationQueryCollision<QUERY> = Extract<
  keyof (QUERY extends ValidatorSchema ? InferInput<QUERY> | InferOutput<QUERY> : never),
  'cursor' | 'limit'
>

export type PaginationResponseCollision<RESPONSES> = Extract<keyof RESPONSES, 200 | '200'>

export type PaginationRefusal<REASON extends string> = { readonly [KEY in REASON]: never }

/** Editor feedback for the same ownership rule enforced during build discovery. */
export type PaginationContractConstraint<PAGINATION, QUERY, RESPONSES> =
  PAGINATION extends EndpointCursorPaginationContract
    ? [PaginationQueryCollision<QUERY>] extends [never]
      ? [PaginationResponseCollision<RESPONSES>] extends [never]
        ? unknown
        : PaginationRefusal<'pagination owns response status 200; remove validate.response[200].'>
      : PaginationRefusal<'pagination owns query.cursor and query.limit; remove them from validate.query.'>
    : unknown

export type ApplyPaginationQuery<QUERY, PAGINATION> =
  PAGINATION extends EndpointCursorPaginationContract ? CursorPaginationQuerySchema<QUERY> : QUERY

export type ApplyPaginationResponses<RESPONSES, PAGINATION> =
  PAGINATION extends EndpointCursorPaginationContract<infer ITEM>
    ? (RESPONSES extends Record<PropertyKey, unknown> ? RESPONSES : Record<never, never>) & {
        200: CursorPaginationResponseSchema<ITEM>
      }
    : RESPONSES

export function applyCursorPaginationContract(
  query: ValidatorSchema | undefined,
  responses: Record<number | string, unknown> | undefined,
  pagination: EndpointCursorPaginationContract,
): { query: ValidatorSchema; responses: Record<number | string, unknown> } {
  assertPaginationSourcesDoNotOverlap(query, responses)
  return {
    query: createCursorPaginationQuerySchema(query),
    responses: {
      ...responses,
      [cursorPaginationDefaults.status]: createCursorPaginationResponseSchema(pagination.item),
    },
  }
}

export function assertPaginationSourcesDoNotOverlap(
  query: ValidatorSchema | undefined,
  responses: Record<number | string, unknown> | undefined,
): void {
  if (query) {
    const input = inspectValidatorInputObject(query)
    const output = inspectValidatorOutputObject(query)
    if (!input.inspectable || !output.inspectable) {
      throw new TypeError(
        'Cursor pagination can only be combined with a JSON-Schema-convertible object in validate.query, so ownership of cursor and limit can be checked.',
      )
    }
    const duplicate = ['cursor', 'limit'].find(
      (name) => name in input.properties || name in output.properties,
    )
    if (duplicate) {
      throw new TypeError(
        `Cursor pagination owns validate.query.${duplicate}; remove the duplicate declaration and configure pagination instead.`,
      )
    }
  }

  if (responses && (200 in responses || '200' in responses)) {
    throw new TypeError(
      'Cursor pagination owns validate.response[200]; remove the duplicate response declaration and configure pagination instead.',
    )
  }
}

function createCursorPaginationQuerySchema(
  base: ValidatorSchema | undefined,
): CursorPaginationQuerySchema<ValidatorSchema | undefined> {
  return {
    '~standard': {
      version: 1,
      vendor: 'nuxt-endpoints',
      validate: async (input) => {
        if (!isRecord(input)) {
          return { issues: [issue([], 'Expected a query object', 'invalid_type')] }
        }

        let value: Record<string, unknown> = {}
        if (base) {
          const result = await parseValidator(base, input)
          if (!result.success) return { issues: result.issues }
          if (!isRecord(result.value)) {
            return {
              issues: [issue([], 'validate.query must produce an object', 'invalid_type')],
            }
          }
          value = result.value
        }

        const cursor = input[cursorPaginationDefaults.cursor]
        if (cursor !== undefined && typeof cursor !== 'string') {
          return {
            issues: [issue(['cursor'], 'Cursor must be a string', 'invalid_type')],
          }
        }

        const parsedLimit = parseLimit(input[cursorPaginationDefaults.limit])
        if (!parsedLimit.success) return { issues: [parsedLimit.issue] }

        return {
          value: {
            ...value,
            ...(cursor === undefined ? {} : { cursor }),
            limit: parsedLimit.value,
          },
        }
      },
    },
    toJSONSchema: () => ({
      allOf: [
        ...(base ? [toJsonSchema(base, {}, { mode: 'input' })] : []),
        {
          type: 'object',
          properties: {
            cursor: { type: 'string' },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: cursorPaginationDefaults.maxLimit,
              default: cursorPaginationDefaults.defaultLimit,
            },
          },
        },
      ],
    }),
  }
}

function createCursorPaginationResponseSchema(
  item: ValidatorSchema,
): CursorPaginationResponseSchema<ValidatorSchema> {
  return {
    '~standard': {
      version: 1,
      vendor: 'nuxt-endpoints',
      validate: async (input) => {
        if (!isRecord(input)) {
          return { issues: [issue([], 'Expected a pagination response object', 'invalid_type')] }
        }
        if (!Array.isArray(input.items)) {
          return { issues: [issue(['items'], 'Items must be an array', 'invalid_type')] }
        }

        const items: unknown[] = []
        const issues: ValidationIssue[] = []
        for (const [index, candidate] of input.items.entries()) {
          const result = await parseValidator(item, candidate)
          if (result.success) {
            items.push(result.value)
          } else {
            issues.push(
              ...result.issues.map((entry) => ({
                ...entry,
                path: ['items', index, ...(entry.path ?? [])],
              })),
            )
          }
        }
        if (issues.length > 0) return { issues }

        const nextCursor = input.nextCursor
        if (nextCursor !== undefined && typeof nextCursor !== 'string') {
          return {
            issues: [issue(['nextCursor'], 'Next cursor must be a string', 'invalid_type')],
          }
        }

        return {
          value: {
            items,
            ...(nextCursor === undefined ? {} : { nextCursor }),
          },
        }
      },
    },
    toJSONSchema: () => ({
      type: 'object',
      properties: {
        items: { type: 'array', items: toJsonSchema(item, {}, { mode: 'output' }) },
        nextCursor: { type: 'string' },
      },
      required: ['items'],
    }),
  }
}

function parseLimit(
  value: unknown,
): { success: true; value: number } | { success: false; issue: ValidationIssue } {
  if (value === undefined || value === '') {
    return { success: true, value: cursorPaginationDefaults.defaultLimit }
  }
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > cursorPaginationDefaults.maxLimit) {
    return {
      success: false,
      issue: issue(
        ['limit'],
        `Limit must be an integer between 1 and ${cursorPaginationDefaults.maxLimit}`,
        'invalid_limit',
      ),
    }
  }
  return { success: true, value: parsed }
}

function issue(path: (string | number)[], message: string, code: string): ValidationIssue {
  return { path, message, code }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
