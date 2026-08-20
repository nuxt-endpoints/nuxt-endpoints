import { describe, expect, it } from 'vitest'
import { negotiateMediaType } from '../src/runtime/accept'

const offered = ['text/csv', 'application/json'] as const

describe('negotiateMediaType', () => {
  it('takes the endpoint preference when the request expresses none', () => {
    expect(negotiateMediaType(undefined, offered)).toBe('text/csv')
    expect(negotiateMediaType(null, offered)).toBe('text/csv')
    expect(negotiateMediaType('', offered)).toBe('text/csv')
    expect(negotiateMediaType('   ', offered)).toBe('text/csv')
    expect(negotiateMediaType('*/*', offered)).toBe('text/csv')
  })

  it('follows declaration order, not alphabetical or header order', () => {
    expect(negotiateMediaType('*/*', ['application/json', 'text/csv'])).toBe('application/json')
    // The header lists json first, but both match at the same quality, so the
    // endpoint's preference decides.
    expect(negotiateMediaType('application/json, text/csv', offered)).toBe('text/csv')
  })

  it('honors an exact request', () => {
    expect(negotiateMediaType('application/json', offered)).toBe('application/json')
    expect(negotiateMediaType('text/csv', offered)).toBe('text/csv')
  })

  it('ranks by quality', () => {
    expect(negotiateMediaType('text/csv;q=0.9, application/json;q=0.5', offered)).toBe('text/csv')
    expect(negotiateMediaType('text/csv;q=0.5, application/json;q=0.9', offered)).toBe(
      'application/json',
    )
    expect(negotiateMediaType('*/*;q=0.1, application/json;q=0.8', offered)).toBe(
      'application/json',
    )
  })

  it('lets a subtype wildcard match', () => {
    expect(negotiateMediaType('text/*', offered)).toBe('text/csv')
    expect(negotiateMediaType('application/*', offered)).toBe('application/json')
  })

  it('lets the most specific range win, even when it refuses', () => {
    // `text/*` would accept the CSV, but the more specific `text/csv;q=0`
    // refuses it - and nothing else matches `text/*`.
    expect(negotiateMediaType('text/*, text/csv;q=0', offered)).toBeUndefined()
    expect(negotiateMediaType('*/*, application/json;q=0', offered)).toBe('text/csv')
  })

  it('treats q=0 as a refusal rather than a weak preference', () => {
    expect(negotiateMediaType('*/*, application/json;q=0', offered)).toBe('text/csv')
    expect(negotiateMediaType('text/csv;q=0, application/json', offered)).toBe('application/json')
    expect(negotiateMediaType('application/json;q=0, text/csv;q=0', offered)).toBeUndefined()
  })

  it('does not make an unlisted media type acceptable by refusing another', () => {
    // `Accept: application/json;q=0` refuses JSON and says nothing about CSV.
    // Only a range the header actually lists can make something acceptable, so
    // there is nothing left to send.
    expect(negotiateMediaType('application/json;q=0', offered)).toBeUndefined()
  })

  it('returns undefined when nothing offered is acceptable', () => {
    expect(negotiateMediaType('application/xml', offered)).toBeUndefined()
    expect(negotiateMediaType('image/png, video/mp4', offered)).toBeUndefined()
  })

  it('compares media types case-insensitively and ignores parameters', () => {
    expect(negotiateMediaType('APPLICATION/JSON', offered)).toBe('application/json')
    expect(negotiateMediaType('application/json; charset=utf-8', offered)).toBe('application/json')
    expect(negotiateMediaType('*/*', ['TEXT/CSV'])).toBe('TEXT/CSV')
  })

  it('ignores a header it cannot parse rather than answering 406', () => {
    expect(negotiateMediaType('garbage', offered)).toBe('text/csv')
    expect(negotiateMediaType(',,,', offered)).toBe('text/csv')
    // A malformed quality is treated as absent, not as a refusal.
    expect(negotiateMediaType('application/json;q=bogus', offered)).toBe('application/json')
    expect(negotiateMediaType('application/json;q=7', offered)).toBe('application/json')
  })

  it('returns undefined when the endpoint offers nothing', () => {
    expect(negotiateMediaType('*/*', [])).toBeUndefined()
    expect(negotiateMediaType('*/*', ['not-a-media-type'])).toBeUndefined()
  })
})
