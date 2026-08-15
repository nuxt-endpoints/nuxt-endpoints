import { describe, expect, it } from 'vitest'
import { isPathParamSegment, pathParamNames, replacePathParams } from '../src/runtime/path-template'

describe('replacePathParams', () => {
  it('replaces a single path parameter', () => {
    expect(replacePathParams('/users/:id', (name) => `{${name}}`)).toBe('/users/{id}')
  })

  it('replaces multiple path parameters', () => {
    expect(replacePathParams('/users/:userId/posts/:postId', (name) => `{${name}}`)).toBe(
      '/users/{userId}/posts/{postId}',
    )
  })

  it('leaves a path without parameters unchanged', () => {
    expect(replacePathParams('/users/all', (name) => `{${name}}`)).toBe('/users/all')
  })

  it('replaces consecutive parameter segments', () => {
    expect(replacePathParams('/:a/:b/:c', (name) => name.toUpperCase())).toBe('/A/B/C')
  })

  it('passes the captured parameter name to the replacer', () => {
    const seen: string[] = []
    replacePathParams('/users/:userId/posts/:postId', (name) => {
      seen.push(name)
      return name
    })
    expect(seen).toEqual(['userId', 'postId'])
  })
})

describe('pathParamNames', () => {
  it('returns an empty array for a path without parameters', () => {
    expect(pathParamNames('/users/all')).toEqual([])
  })

  it('returns the name of a single path parameter', () => {
    expect(pathParamNames('/users/:id')).toEqual(['id'])
  })

  it('returns names for multiple path parameters in order', () => {
    expect(pathParamNames('/users/:userId/posts/:postId')).toEqual(['userId', 'postId'])
  })

  it('returns names for consecutive parameter segments', () => {
    expect(pathParamNames('/:a/:b/:c')).toEqual(['a', 'b', 'c'])
  })
})

describe('isPathParamSegment', () => {
  it('recognizes a parameter segment', () => {
    expect(isPathParamSegment(':id')).toBe(true)
  })

  it('rejects a static segment', () => {
    expect(isPathParamSegment('users')).toBe(false)
  })
})
