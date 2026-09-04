import { describe, expect, it } from 'vitest'
import { generateEndpointFormRoutes } from '../../src/codegen'
import type { EndpointRouteHandler } from '../../src/codegen'

// The bridge middleware runs on every request, so what it reads has to be a
// plain map resolved at build time - no handler is loaded to answer "does this
// page URL back an endpoint?". See docs/progressive-enhancement.md.
const handler = (overrides: Partial<EndpointRouteHandler>): EndpointRouteHandler =>
  ({
    handler: '/server/api/users.post.ts',
    route: '/api/users',
    method: 'post',
    ...overrides,
  }) as EndpointRouteHandler

describe('generateEndpointFormRoutes', () => {
  it('maps each declared page URL to the endpoint behind it', () => {
    const content = generateEndpointFormRoutes([
      handler({
        form: {
          from: '/form-pe',
          method: 'post',
          redirect: '/form-pe?created={id}',
          enctype: 'application/x-www-form-urlencoded',
          fields: { name: { name: 'name', required: true } },
        },
      }),
    ])

    expect(JSON.parse(content.replace('export const formRoutes = ', ''))).toEqual({
      '/form-pe': {
        target: '/api/users',
        enctype: 'application/x-www-form-urlencoded',
        redirect: '/form-pe?created={id}',
      },
    })
  })

  it('does not generate a method override for the POST-only bridge', () => {
    const content = generateEndpointFormRoutes([
      handler({
        form: {
          from: '/users/new',
          method: 'post',
          enctype: 'application/x-www-form-urlencoded',
          fields: {},
        },
      }),
    ])

    expect(content).not.toContain('method')
    // Nothing to redirect to was declared, so nothing is emitted for it.
    expect(content).not.toContain('redirect')
  })

  it('omits the field attributes the client needs but the bridge does not', () => {
    const content = generateEndpointFormRoutes([
      handler({
        form: {
          from: '/form-pe',
          method: 'post',
          enctype: 'application/x-www-form-urlencoded',
          fields: { name: { name: 'name', required: true, minlength: 1 } },
        },
      }),
    ])

    expect(content).not.toContain('minlength')
  })

  it('refuses two endpoints behind one page URL', () => {
    expect(
      () =>
        generateEndpointFormRoutes([
          handler({
            form: {
              from: '/form-pe',
              method: 'post',
              enctype: 'application/x-www-form-urlencoded',
              fields: {},
            },
          }),
          handler({
            route: '/api/comments',
            form: {
              from: '/form-pe',
              method: 'post',
              enctype: 'application/x-www-form-urlencoded',
              fields: {},
            },
          }),
        ]),
      // A native submission carries nothing that would say which one it meant,
      // so silently picking one would send the browser to the wrong endpoint.
    ).toThrow(/\/api\/users and \/api\/comments/)
  })

  it('emits an empty map when no route declares a form', () => {
    expect(generateEndpointFormRoutes([handler({})])).toBe('export const formRoutes = {}\n')
  })

  it('omits GET forms because normal page navigation owns them', () => {
    const content = generateEndpointFormRoutes([
      handler({
        route: '/api/search',
        method: 'get',
        form: {
          from: '/search',
          method: 'get',
          enctype: 'application/x-www-form-urlencoded',
          fields: { q: { name: 'q' } },
        },
      }),
    ])

    expect(content).toBe('export const formRoutes = {}\n')
  })
})
