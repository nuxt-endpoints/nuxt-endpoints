import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `defineEndpoint` declares its merged overloads twice: once leading, so
// resolution picks them for a well-formed call, and once trailing, so a failed
// call is elaborated against a merged signature rather than the contract-only
// one. See the ordering note above the first copy in `src/runtime/endpoint.ts`.
//
// A copy that drifts out of step does not fail any type test: both halves still
// type-check, and only the wording of an error a developer sees changes. That
// is what this pins - the duplication is only safe while it stays duplication.
const source = readFileSync(
  fileURLToPath(new URL('../src/runtime/endpoint.ts', import.meta.url)),
  'utf8',
).split('\n')

type Overload = { line: number; kind: string; body: string }

function overloads(): Overload[] {
  const starts = source
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^export function defineEndpoint[(<]/.test(line))
    .map(({ index }) => index)

  return starts.map((start, position) => {
    const end = starts[position + 1] ?? source.length
    const body = source.slice(start, end)

    // Trailing comments introduce the NEXT declaration, so they are not part of
    // this one and must not count as drift.
    while (
      body.length > 0 &&
      (body[body.length - 1]!.startsWith('//') || body[body.length - 1] === '')
    ) {
      body.pop()
    }

    const text = body.join('\n')
    const kind = text.startsWith('export function defineEndpoint(')
      ? 'implementation'
      : text.includes('handler?: never')
        ? 'two-call'
        : text.includes('HEADER_NAME')
          ? 'merged/idempotent'
          : 'merged/plain'

    return { line: start + 1, kind, body: text }
  })
}

describe('defineEndpoint overload declarations', () => {
  it('declares each merged shape exactly twice, leading and trailing', () => {
    const kinds = overloads().map((overload) => overload.kind)

    expect(kinds).toEqual([
      'merged/idempotent',
      'merged/plain',
      'two-call',
      'merged/idempotent',
      'merged/plain',
      'implementation',
    ])
  })

  it('keeps each trailing copy byte-identical to its leading one', () => {
    const declarations = overloads()

    for (const kind of ['merged/idempotent', 'merged/plain'] as const) {
      const [lead, tail] = declarations.filter((overload) => overload.kind === kind)

      expect(lead, `no leading ${kind} overload`).toBeDefined()
      expect(tail, `no trailing ${kind} overload`).toBeDefined()
      expect(
        tail!.body,
        `the ${kind} overload at line ${tail!.line} drifted from its copy at line ${lead!.line}. ` +
          'Both must stay identical, or a failed call is elaborated against the wrong signature.',
      ).toBe(lead!.body)
    }
  })

  it('gives every overload the same arity, which is what lets a trailing copy own the error', () => {
    // TypeScript elaborates a failed call against the last candidate that
    // PASSED the arity check, not the last declaration. A copy taking a
    // different number of parameters is filtered out before that point and
    // silently stops doing its job.
    const shapes = overloads().map((overload) => ({
      line: overload.line,
      parameters: [
        /^ {2}definition: /m.test(overload.body),
        /^ {2}options\?: EndpointRuntimeOptions,$/m.test(overload.body),
      ],
    }))

    for (const { line, parameters } of shapes) {
      expect(
        parameters,
        `the overload at line ${line} does not take (definition, options?)`,
      ).toEqual([true, true])
    }
  })
})
