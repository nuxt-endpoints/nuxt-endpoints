import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUseEndpointForm } from '../src/runtime/client'
import type { EndpointFormBindings } from '../src/runtime/client'

// `useEndpointForm` projects a request into what a `<form>` needs. The
// reactivity it uses is injected, so these tests supply the smallest possible
// stand-ins rather than pulling Vue into the client runtime. See
// docs/progressive-enhancement.md.

const bindings = (
  overrides: Partial<EndpointFormBindings> = {},
): EndpointFormBindings & { navigated: string[] } => {
  const navigated: string[] = []
  return {
    ref: <VALUE>(value: VALUE) => ({ value }),
    computed: <VALUE>(getter: () => VALUE) => ({
      get value() {
        return getter()
      },
    }),
    navigateTo: (to: string) => navigated.push(to),
    navigated,
    ...overrides,
  } as EndpointFormBindings & { navigated: string[] }
}

const route = {
  path: '/api/todos',
  method: 'post' as const,
  form: {
    action: '/todos/new',
    method: 'post' as const,
    redirect: '/todos/{id}',
    enctype: 'application/x-www-form-urlencoded',
    fields: {
      title: { name: 'title', required: true, minlength: 1 },
      done: { name: 'done' },
    },
  },
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchRawMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  fetchRawMock = vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
    const { ignoreResponseError: _ignore, ...rest } = options
    return { status: 201, ok: true, headers: new Headers(), _data: await fetchMock(path, rest) }
  })
  vi.stubGlobal('$fetch', Object.assign(fetchMock, { raw: fetchRawMock }))
  // Stands in for reading a real `<form>` element, which needs a DOM.
  vi.stubGlobal(
    'FormData',
    class {
      entries() {
        return [['title', 'Ada']][Symbol.iterator]()
      }
    },
  )
})

// `FormData` is stubbed below to stand in for a real `<form>` element, and it
// is a global other suites genuinely use.
afterEach(() => {
  vi.unstubAllGlobals()
})

const client = (binding: EndpointFormBindings) =>
  createUseEndpointForm([route], binding) as unknown as (
    path: string,
    options: Record<string, unknown>,
  ) => any

describe('useEndpointForm', () => {
  it('describes the form from the contract, with the request body as its initial value', () => {
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: 'Draft', done: false },
    })

    expect(form.attrs).toEqual({
      action: '/todos/new',
      method: 'post',
      enctype: 'application/x-www-form-urlencoded',
    })
    // The body a request is constructed with is what the inputs render.
    expect(form.fields.title.value).toBe('Draft')
    expect(form.fields.title.name).toBe('title')
    expect(form.fields.title.required).toBe(true)
    expect(form.fields.title.minlength).toBe(1)
    // A checkbox is driven by `checked`, so no value is invented for it - but
    // the binding is still there, holding the empty string.
    expect(form.fields.done.value).toBe('')
    expect(form.values.value).toEqual({ title: 'Draft' })
  })

  it('can disable browser validation so every displayed issue comes from the server', () => {
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
      validation: 'server',
    })

    expect(form.attrs).toEqual({
      action: '/todos/new',
      method: 'post',
      enctype: 'application/x-www-form-urlencoded',
      novalidate: true,
    })
    // Keep the constraints as semantic input metadata; `novalidate` controls
    // whether the browser blocks submission with its own message.
    expect(form.fields.title.required).toBe(true)
  })

  it('rejects invalid presentation options for JavaScript callers', () => {
    expect(() =>
      client(bindings())('/api/todos', {
        method: 'post',
        body: { title: '', done: false },
        validation: 'client',
      }),
    ).toThrow(/validation must be "browser" or "server"/)

    expect(() =>
      client(bindings())('/api/todos', {
        method: 'post',
        body: { title: '', done: false },
        resolveMessage: 'not a function',
      }),
    ).toThrow(/resolveMessage must be a function/)
  })

  it('binds each field in both directions, so a re-render cannot wipe it', () => {
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: 'Draft', done: false },
    })

    form.fields.title.onInput({ target: { value: 'typed' } })

    // `value` is a getter, not a snapshot: Vue force-patches that prop on every
    // full-props update, so a snapshot would overwrite what was typed.
    expect(form.fields.title.value).toBe('typed')
    expect(form.values.value.title).toBe('typed')
  })

  it('leaves a file input alone, because a browser will not let a page set one', () => {
    const upload = createUseEndpointForm(
      [
        {
          path: '/api/uploads',
          method: 'post',
          form: {
            action: '/uploads',
            method: 'post',
            enctype: 'multipart/form-data',
            fields: { attachment: { name: 'attachment', type: 'file', required: true } },
          },
        },
      ],
      bindings(),
    ) as unknown as (path: string, options: Record<string, unknown>) => any

    const form = upload('/api/uploads', {
      method: 'post',
      mediaType: 'multipart/form-data',
      body: new FormData(),
    })

    expect(form.fields.attachment).toEqual({ name: 'attachment', type: 'file', required: true })
    expect(form.fields.attachment.onInput).toBeUndefined()
  })

  it('refuses a route that declares no form, rather than returning a broken one', () => {
    // The type surface already excludes such a path; this is what a cast or a
    // stale generated client would hit.
    const plain = createUseEndpointForm(
      [{ path: '/api/todos', method: 'post' }],
      bindings(),
    ) as unknown as (path: string, options: Record<string, unknown>) => unknown

    expect(() => plain('/api/todos', { method: 'post', body: {} })).toThrow(
      /POST \/api\/todos does not declare `form`/,
    )
  })

  it('sends the declared encoding rather than re-encoding the submission', async () => {
    fetchMock.mockResolvedValue({ id: 7 })
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
    })

    const submitted = new URLSearchParams({ title: 'Ada' })
    await form.submit(submitted)

    expect(fetchRawMock).toHaveBeenCalledTimes(1)
    expect(fetchRawMock.mock.calls[0]![1].body).toBe(submitted)
  })

  it('navigates to the declared target after a successful submission', async () => {
    fetchMock.mockResolvedValue({ id: 7 })
    const binding = bindings()
    const form = client(binding)('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
    })

    await form.enhance({ preventDefault: () => {}, target: {} as HTMLFormElement })

    expect(binding.navigated).toEqual(['/todos/7'])
  })

  it('URL-encodes redirect placeholders the same way as the native bridge', async () => {
    fetchMock.mockResolvedValue({ id: 'Ada Lovelace/42' })
    const binding = bindings()
    const form = client(binding)('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
    })

    await form.enhance({ preventDefault: () => {}, target: {} as HTMLFormElement })

    expect(binding.navigated).toEqual(['/todos/Ada%20Lovelace%2F42'])
  })

  it('hands the result to onSuccess instead, when one is given', async () => {
    fetchMock.mockResolvedValue({ id: 7 })
    const binding = bindings()
    const seen: unknown[] = []
    const form = client(binding)('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
      onSuccess: (result: unknown) => seen.push(result),
    })

    await form.enhance({ preventDefault: () => {}, target: {} as HTMLFormElement })

    expect(seen).toEqual([{ status: 201, ok: true, body: { id: 7 } }])
    expect(binding.navigated).toEqual([])
  })

  it('does not call onSuccess for a failed response', async () => {
    fetchRawMock.mockResolvedValue({
      status: 400,
      ok: false,
      headers: new Headers(),
      _data: { statusCode: 400, statusMessage: 'Validation Error', data: {} },
    })
    const seen: unknown[] = []
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
      onSuccess: (result: unknown) => seen.push(result),
    })

    await form.enhance({ preventDefault: () => {}, target: {} as HTMLFormElement })

    expect(seen).toEqual([])
    expect(form.result.value?.ok).toBe(false)
  })

  it('rejects stale metadata that would hide an endpoint method override', () => {
    const usePutForm = createUseEndpointForm(
      [{ ...route, method: 'put' as const }],
      bindings(),
    ) as unknown as (path: string, options: Record<string, unknown>) => any

    expect(() =>
      usePutForm('/api/todos', {
        method: 'put',
        body: { title: '', done: false },
      }),
    ).toThrow(/POST form cannot invoke PUT/)
  })

  it('projects GET fields from query input and loads the endpoint for this page', () => {
    const useEndpoint = vi.fn(() => ({
      data: { value: { status: 200, ok: true, body: { items: ['Ada'] } } },
      pending: { value: false },
    }))
    const useSearchForm = createUseEndpointForm(
      [
        {
          path: '/api/search',
          method: 'get',
          form: {
            action: '/search',
            method: 'get',
            enctype: 'application/x-www-form-urlencoded',
            fields: { q: { name: 'q', required: true } },
          },
        },
      ],
      bindings({ useEndpoint }),
    ) as unknown as (path: string, options: Record<string, unknown>) => any

    const form = useSearchForm('/api/search', { method: 'get', query: { q: 'Ada' } })

    expect(form.attrs).toEqual({
      action: '/search',
      method: 'get',
      enctype: 'application/x-www-form-urlencoded',
    })
    expect(form.fields.q.value).toBe('Ada')
    expect(form.result.value).toEqual({ status: 200, ok: true, body: { items: ['Ada'] } })
    expect(useEndpoint).toHaveBeenCalledWith('/api/search', {
      method: 'get',
      query: { q: 'Ada' },
    })
  })

  it('enhances GET as URL navigation and sends the same query to the endpoint', async () => {
    vi.stubGlobal(
      'FormData',
      class {
        entries() {
          return [['q', 'Ada Lovelace']][Symbol.iterator]()
        }
      },
    )
    const binding = bindings({
      useEndpoint: () => ({ data: { value: undefined }, pending: { value: false } }) as never,
    })
    const useSearchForm = createUseEndpointForm(
      [
        {
          path: '/api/search',
          method: 'get',
          form: {
            action: '/search',
            method: 'get',
            enctype: 'application/x-www-form-urlencoded',
            fields: { q: { name: 'q' } },
          },
        },
      ],
      binding,
    ) as unknown as (path: string, options: Record<string, unknown>) => any
    fetchMock.mockResolvedValue({ items: ['Ada Lovelace'] })
    const form = useSearchForm('/api/search', { method: 'get', query: { q: '' } })

    await form.enhance({ preventDefault: () => {}, target: {} as HTMLFormElement })

    expect(binding.navigated).toEqual(['/search?q=Ada+Lovelace'])
    expect(fetchRawMock.mock.calls[0]![1]).toMatchObject({
      method: 'get',
      query: { q: 'Ada Lovelace' },
    })
  })

  it('keys the module’s own validation issues by field', async () => {
    fetchRawMock.mockResolvedValue({
      status: 400,
      ok: false,
      headers: new Headers(),
      _data: {
        statusCode: 400,
        statusMessage: 'Validation Error',
        data: {
          body: [
            {
              path: ['title'],
              message: 'Title is required',
              code: 'too_small',
              minimum: 1,
              origin: 'string',
            },
          ],
        },
      },
    })
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
    })

    await form.submit(new URLSearchParams({ title: '' }))

    expect(form.issues.value).toEqual({
      title: [
        {
          path: ['title'],
          message: 'Title is required',
          code: 'too_small',
          minimum: 1,
          origin: 'string',
        },
      ],
    })
    expect(form.allIssues.value).toHaveLength(1)
    expect(form.status.value).toBe(400)
  })

  it('resolves enhanced-path issue messages without changing the status result', async () => {
    const body = {
      statusCode: 400,
      statusMessage: 'Validation Error',
      data: { body: [{ path: ['title'], message: 'required' }] },
    }
    fetchRawMock.mockResolvedValue({
      status: 400,
      ok: false,
      headers: new Headers(),
      _data: body,
    })
    const form = client(bindings())('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
      resolveMessage: (issue: { path?: (string | number)[]; message: string }) =>
        issue.message === 'required' ? `${issue.path?.join('.')}を入力してください` : issue.message,
    })

    await form.submit(new URLSearchParams({ title: '' }))

    expect(form.issues.value.title).toEqual([
      { path: ['title'], message: 'titleを入力してください' },
    ])
    expect(form.result.value?.body).toEqual(body)
  })

  it('restores what a native submission sent, when one produced this render', () => {
    const submission = {
      route: { method: 'post', path: '/api/todos' },
      status: 400,
      issues: [{ path: ['title'], message: 'Title is required' }],
      values: { title: 'typed but rejected' },
    }
    const form = client(
      bindings({
        useRequestEvent: () => ({ context: { __nuxtEndpointsForm: submission } }),
      }),
    )('/api/todos', { method: 'post', body: { title: '', done: false } })

    expect(form.fields.title.value).toBe('typed but rejected')
    expect(form.values.value.title).toBe('typed but rejected')
    expect(form.issues.value).toEqual({
      title: [{ path: ['title'], message: 'Title is required' }],
    })
    // No result exists on this path: the submission never went through `$fetch`.
    expect(form.status.value).toBe(400)
  })

  it('resolves native-path issue messages during page rendering', () => {
    const submission = {
      route: { method: 'post', path: '/api/todos' },
      status: 400,
      issues: [{ path: ['title'], message: 'required' }],
      values: { title: '' },
    }
    const form = client(
      bindings({
        useRequestEvent: () => ({ context: { __nuxtEndpointsForm: submission } }),
      }),
    )('/api/todos', {
      method: 'post',
      body: { title: '', done: false },
      resolveMessage: (issue: { message: string }) =>
        issue.message === 'required' ? 'タイトルは必須です' : issue.message,
    })

    expect(form.issues.value.title).toEqual([{ path: ['title'], message: 'タイトルは必須です' }])
  })

  it('ignores a submission that was posted to a different endpoint', () => {
    const form = client(
      bindings({
        useRequestEvent: () => ({
          context: {
            __nuxtEndpointsForm: {
              route: { method: 'post', path: '/api/comments' },
              status: 400,
              issues: [{ path: ['title'], message: 'Title is required' }],
              values: { title: 'for the other form' },
            },
          },
        }),
      }),
    )('/api/todos', { method: 'post', body: { title: 'Draft', done: false } })

    expect(form.fields.title.value).toBe('Draft')
    expect(form.issues.value).toEqual({})
  })

  it('degrades without a request context rather than failing', () => {
    const form = client(
      bindings({
        useRequestEvent: () => {
          throw new Error('no Nuxt context')
        },
      }),
    )('/api/todos', { method: 'post', body: { title: 'Draft', done: false } })

    // Everything except the restored values still works.
    expect(form.attrs.action).toBe('/todos/new')
    expect(form.fields.title.value).toBe('Draft')
    expect(form.issues.value).toEqual({})
  })
})
