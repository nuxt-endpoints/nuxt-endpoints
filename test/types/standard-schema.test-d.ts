import { describe, expectTypeOf, it } from 'vitest'
import type {
  InferInput,
  InferOutput,
  StandardSchemaLike,
  ValidationIssue,
} from '../../src/runtime'

type Input = { id: string }
type Output = { id: number }
type Schema = StandardSchemaLike<Input, Output>

describe('Standard Schema support', () => {
  it('infers input and output types from Standard Schema-like validators', () => {
    expectTypeOf<InferInput<Schema>>().toEqualTypeOf<Input>()
    expectTypeOf<InferOutput<Schema>>().toEqualTypeOf<Output>()
  })

  it('accepts readonly issue paths compatible with Standard Schema validators', () => {
    expectTypeOf<{
      message: string
      path?: readonly [{ readonly key: 'id' }]
    }>().toMatchTypeOf<ValidationIssue>()
  })
})
