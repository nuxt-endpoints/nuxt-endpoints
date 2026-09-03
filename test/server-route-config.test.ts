import { describe, expect, it } from 'vitest'
import {
  defineServerRouteConfig,
  resolveServerRouteResponseMaps,
  serverRoutePatternMatches,
} from '../src/runtime/server-route-config'

const response = {} as never

describe('server route response configuration', () => {
  it('matches exact paths and trailing prefix patterns only', () => {
    expect(serverRoutePatternMatches('/api/users/:id', '/api/users/:id')).toBe(true)
    expect(serverRoutePatternMatches('/api/admin/**', '/api/admin')).toBe(true)
    expect(serverRoutePatternMatches('/api/admin/**', '/api/admin/users/:id')).toBe(true)
    expect(serverRoutePatternMatches('/api/admin/**', '/api/administrator')).toBe(false)
  })

  it('resolves global, path, and method maps without collapsing duplicate statuses', () => {
    const globalResponses = { 401: response }
    const pathResponses = { 401: response, 403: response }
    const methodResponses = { 429: response }
    const config = defineServerRouteConfig({
      responses: globalResponses,
      routes: {
        '/api/admin/**': {
          responses: pathResponses,
          methods: { post: { responses: methodResponses } },
        },
      },
    })

    expect(resolveServerRouteResponseMaps(config, '/api/admin/users', 'POST')).toEqual([
      globalResponses,
      pathResponses,
      methodResponses,
    ])
    expect(resolveServerRouteResponseMaps(config, '/api/public', 'get')).toEqual([globalResponses])
  })

  it('rejects unsupported patterns, methods, and status keys in JavaScript', () => {
    expect(() => defineServerRouteConfig({ routes: { 'api/users': { responses: {} } } })).toThrow(
      /must start with/,
    )
    expect(() =>
      defineServerRouteConfig({ routes: { '/api/*/users': { responses: {} } } }),
    ).toThrow(/trailing "\/\*\*"/)
    expect(() =>
      defineServerRouteConfig({
        routes: { '/api/users': { methods: { POST: { responses: {} } } } },
      } as never),
    ).toThrow(/lowercase HTTP method/)
    expect(() => defineServerRouteConfig({ responses: { nope: response } })).toThrow(
      /HTTP status integer/,
    )
  })
})
