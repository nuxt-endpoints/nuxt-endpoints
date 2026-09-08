import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFormRoute: vi.fn(),
  getRuntimePathname: vi.fn(() => '/todos/new'),
  getRuntimeRequestHeaders: vi.fn(() => ({ accept: 'text/html' })),
  readRuntimeFormData: vi.fn(),
  runtimeRedirect: vi.fn(),
  runtimeServerFetch: vi.fn(),
  continueRuntimeRendering: vi.fn(),
}))

vi.mock('../src/runtime/form-routes-state', () => ({ getFormRoute: mocks.getFormRoute }))
vi.mock('../src/runtime/platform', () => ({
  defineRuntimeMiddleware: (handler: unknown) => handler,
  getRuntimePathname: mocks.getRuntimePathname,
  getRuntimeRequestHeaders: mocks.getRuntimeRequestHeaders,
  readRuntimeFormData: mocks.readRuntimeFormData,
  runtimeRedirect: mocks.runtimeRedirect,
  runtimeServerFetch: mocks.runtimeServerFetch,
  continueRuntimeRendering: mocks.continueRuntimeRendering,
}))

const bridge = (await import('../src/runtime/form-bridge')).default as unknown as (
  event: { req: { method: string }; context: Record<string, unknown> },
  next: () => Promise<unknown>,
) => Promise<unknown>

describe('progressive form bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFormRoute.mockReturnValue({
      target: '/api/todos',
      method: 'post',
      enctype: 'application/x-www-form-urlencoded',
    })
  })

  it('preserves repeated URL-encoded fields during internal dispatch', async () => {
    const form = new FormData()
    form.append('tag', 'one')
    form.append('tag', 'two')
    mocks.readRuntimeFormData.mockResolvedValue(form)
    mocks.runtimeServerFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const event = { req: { method: 'POST' }, context: {} }
    await bridge(event, async () => undefined)

    expect(mocks.runtimeServerFetch).toHaveBeenCalledWith(
      event,
      '/api/todos',
      expect.objectContaining({ body: 'tag=one&tag=two' }),
    )
    expect(mocks.runtimeRedirect).toHaveBeenCalledWith(event, '/todos/new', 303)
  })

  it('hands a failed endpoint status to the platform continuation', async () => {
    const form = new FormData()
    form.set('title', '')
    mocks.readRuntimeFormData.mockResolvedValue(form)
    mocks.runtimeServerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { body: [{ path: ['title'], message: 'Required', code: 'required' }] },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )
    const continued = { rendered: true }
    mocks.continueRuntimeRendering.mockResolvedValue(continued)
    const next = vi.fn(async () => continued)
    const event = { req: { method: 'POST' }, context: {} }

    await expect(bridge(event, next)).resolves.toBe(continued)
    expect(mocks.continueRuntimeRendering).toHaveBeenCalledWith(event, next, 400)
    expect(event.context).toMatchObject({
      __nuxtEndpointsForm: {
        route: { method: 'post', path: '/api/todos' },
        status: 400,
        values: { title: '' },
      },
    })
  })
})
