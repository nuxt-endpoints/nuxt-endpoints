import type { TypedFetch, UseFetch } from 'nuxt/app'
import { expectTypeOf } from 'vitest'
import { useInfiniteQuery, useMutation, useQuery } from '@pinia/colada'
import { infiniteQueryOptions, mutationOptions, queryOptions } from '#endpoints/colada'
import { $fetch as importedFetch, useFetch as importedUseFetch } from '#imports'

const options = {
  method: 'POST',
  body: { slotId: 'slot' },
  query: { view: 'compact' },
  headers: { 'x-api-version': 'v1' },
} as const

const booking = await $fetch('/api/bookings', options)
const _id: string = booking.bookingId
// @ts-expect-error the contract requires a string slotId
await $fetch('/api/bookings', { ...options, body: { slotId: 1 } })
// @ts-expect-error the contract constrains the query
await $fetch('/api/bookings', { ...options, query: { view: 'invalid' } })
// @ts-expect-error the contract constrains the header
await $fetch('/api/bookings', { ...options, headers: { 'x-api-version': 'v2' } })

const response = await $fetch.raw('/api/bookings', { ...options, ignoreResponseError: true })
if (response.status === 409) {
  const _reason: 'slot_taken' | undefined = response._data?.reason
  // @ts-expect-error the success body belongs to another status
  void response._data?.bookingId
}
if (response.status === 201) {
  const _bookingId: string | undefined = response._data?.bookingId
  // @ts-expect-error the conflict body belongs to another status
  void response._data?.reason
}
if (response.status === 503) {
  // @ts-expect-error an undeclared status has an unknown body
  void response._data?.reason
}

const importedResponse = await importedFetch.raw('/api/bookings', {
  ...options,
  ignoreResponseError: true,
})
if (importedResponse.status === 409) {
  const _reason: 'slot_taken' | undefined = importedResponse._data?.reason
}

const { data } = await useFetch('/api/bookings', {
  ...options,
  onResponse({ response }) {
    if (response.status === 409) {
      const _reason: 'slot_taken' | undefined = response._data?.reason
      // @ts-expect-error the success body belongs to another status
      void response._data?.bookingId
    }
  },
})
const _maybeId: string | undefined = data.value?.bookingId

const { error: bookingError } = await useFetch('/api/bookings', options)
if (bookingError.value?.status === 409) {
  const _reason: 'slot_taken' | undefined = bookingError.value.data?.reason
  // @ts-expect-error the conflict body has no booking ID
  void bookingError.value.data?.bookingId
}
if (bookingError.value?.status === 503) {
  // @ts-expect-error an undeclared error status has an unknown body
  void bookingError.value.data?.reason
}
// @ts-expect-error the typed error overload still requires the POST body
await useFetch('/api/bookings', {
  method: 'POST',
  query: options.query,
  headers: options.headers,
})

const { error: availabilityError } = await useFetch('/api/bookings')
if (availabilityError.value?.status === 404) {
  const _reason: 'not_found' | undefined = availabilityError.value.data?.reason
}
if (availabilityError.value?.status === 500) {
  // @ts-expect-error Nuxt can also report a failure without an HTTP response as 500
  void availabilityError.value.data?.incidentId
}

await importedUseFetch('/api/bookings', {
  ...options,
  onResponse({ response }) {
    if (response.status === 409) {
      const _reason: 'slot_taken' | undefined = response._data?.reason
      // @ts-expect-error the success body belongs to another status
      void response._data?.bookingId
    }
  },
})

const availability = await $fetch.raw('/api/bookings', { ignoreResponseError: true })
if (availability.status === 404) {
  const _reason: 'not_found' | undefined = availability._data?.reason
  // @ts-expect-error the GET response has its own contract
  void availability._data?.bookingId
}

const ordinary = await $fetch('/api/ordinary')
const _value: boolean = ordinary.ordinary
// @ts-expect-error ordinary routes still infer from Nuxt
void ordinary.bookingId

const { data: transformed } = await useFetch('/api/ordinary', {
  transform: (result) => Number(result.ordinary),
})
const _transformedValue: number | undefined = transformed.value

// A broadly typed parameter still resolves if there is no competing route.
declare const memberId: string
const { data: member, error: memberError } = await useFetch(`/api/members/${memberId}`)
const _memberName: string | undefined = member.value?.name
if (memberError.value?.status === 404) {
  const _reason: 'member_not_found' | undefined = memberError.value.data?.reason
}

const checkedPath = buildPath('/api/users/:id', { params: { id: memberId } })
const checkedUser = await useFetch(checkedPath)
expectTypeOf(checkedUser.data.value?.name).toEqualTypeOf<string | undefined>()
if (checkedUser.error.value?.status === 404) {
  expectTypeOf(checkedUser.error.value.data?.reason).toEqualTypeOf<'user_not_found' | undefined>()
}
const checkedRaw = await $fetch.raw(checkedPath, { ignoreResponseError: true })
if (checkedRaw.status === 404) {
  expectTypeOf(checkedRaw._data?.reason).toEqualTypeOf<'user_not_found' | undefined>()
}
expectTypeOf((await $fetch(checkedPath)).name).toEqualTypeOf<string>()
// @ts-expect-error the route declares a string ID
buildPath('/api/users/:id', { params: { id: 1 } })
// @ts-expect-error a concrete URL is not a dynamic route template
buildPath('/api/users/me', { params: {} })

declare const userId: number
const userResponse = await $fetch.raw(`/api/users/${userId}`, { ignoreResponseError: true })
if (userResponse.status === 404) {
  const _reason: 'user_not_found' | undefined = userResponse._data?.reason
}
const { error: meError } = await useFetch('/api/users/me')
if (meError.value?.status === 404) {
  // @ts-expect-error the static route takes precedence and has no contract
  void meError.value.data?.reason
}
const { error: ambiguousUser } = await useFetch(`/api/users/${memberId}`)
if (ambiguousUser.value?.status === 404) {
  // @ts-expect-error a string parameter could resolve to the ordinary static route
  void ambiguousUser.value.data?.reason
}

const user = useQuery(
  queryOptions(`/api/users/${userId}`, {
    query: { includePosts: true },
  }),
)
if (user.data.value?.status === 404) {
  const _reason: 'user_not_found' = user.data.value.body.reason
  // @ts-expect-error this property belongs to the success response
  void user.data.value.body.name
}
if (user.data.value?.status === 200) {
  const _name: string = user.data.value.body.name
}
if (user.data.value?.status === 503) {
  // @ts-expect-error the contract doesn't declare 503
  void user.data.value.body.reason
}
// @ts-expect-error query input must match the endpoint contract
queryOptions(`/api/users/${userId}`, { query: { extra: true } })
// @ts-expect-error a plain static route is outside the endpoint adapter
queryOptions('/api/users/me')

useQuery(queryOptions($endpoint('/api/bookings', { method: 'get' })))

const grouped = await $fetch('/api/multi', { query: { limit: '1' } })
const _count: number = grouped.count
// @ts-expect-error GET returns its own successful response
void grouped.updated
// @ts-expect-error PUT requires its declared body
await $fetch('/api/multi', { method: 'PUT' })
// @ts-expect-error GET validates limit
await $fetch('/api/multi', { query: { limit: 'one' } })
const put = await useFetch('/api/multi', { method: 'PUT', body: { name: 'Ada' } })
const _updated: boolean | undefined = put.data.value?.updated
if (put.error.value?.status === 409) {
  const _duplicate: 'duplicate' | undefined = put.error.value.data?.reason
}

const groupedRaw = await $fetch.raw('/api/multi', {
  method: 'PUT',
  body: { name: 'Ada' },
  ignoreResponseError: true,
})
if (groupedRaw.status === 409) {
  const _conflict: 'duplicate' | undefined = groupedRaw._data?.reason
  // @ts-expect-error the PUT failure has no GET count
  void groupedRaw._data?.count
}
// @ts-expect-error this dispatcher only implements GET and PUT
await $fetch('/api/multi', { method: 'POST' })

const update = useMutation(mutationOptions('/api/multi', { method: 'PUT', body: { name: 'Ada' } }))
if (update.state.value.data?.status === 409) {
  const _duplicate: 'duplicate' = update.state.value.data.body.reason
}
// @ts-expect-error PUT validates its body
mutationOptions('/api/multi', { method: 'PUT', body: { name: 2 } })
// @ts-expect-error GET is not a mutation
mutationOptions('/api/multi', { method: 'GET' })
const articles = useInfiniteQuery(infiniteQueryOptions('/api/articles', { query: { limit: 2 } }))
const _title: string | undefined = articles.data.value?.pages[0]?.items[0]?.title
if (articles.error.value?.result?.status === 429) {
  const _delay: number = articles.error.value.result.body.retryAfter
  // @ts-expect-error a failed page has no items
  void articles.error.value.result.body.items
}
// @ts-expect-error this GET has no pagination contract
infiniteQueryOptions('/api/multi')
// @ts-expect-error page size must be numeric
infiniteQueryOptions('/api/articles', { query: { limit: 'two' } })

// The original signatures remain callable for Nuxt features outside status narrowing.
declare const nuxtFetch: TypedFetch
declare const nuxtUseFetch: UseFetch
expectTypeOf(importedFetch).toMatchTypeOf<TypedFetch>()
expectTypeOf(importedUseFetch).toMatchTypeOf<UseFetch>()

const stockBody = await nuxtFetch('/api/bookings', options)
expectTypeOf(booking).toEqualTypeOf<typeof stockBody>()
const stockState = await nuxtUseFetch('/api/bookings', options)
expectTypeOf(data.value).toEqualTypeOf<typeof stockState.data.value>()
const stockPick = await nuxtUseFetch('/api/bookings', { pick: ['available'] })
const nativePick = await useFetch('/api/bookings', { pick: ['available'] })
expectTypeOf(nativePick).toEqualTypeOf<typeof stockPick>()
const stockTransform = await nuxtUseFetch('/api/ordinary', { transform: (v) => Number(v.ordinary) })
expectTypeOf(transformed.value).toEqualTypeOf<typeof stockTransform.data.value>()
const stockExternal = await nuxtFetch<{ ok: boolean }>('https://example.com')
const nativeExternal = await $fetch<{ ok: boolean }>('https://example.com')
expectTypeOf(nativeExternal).toEqualTypeOf<typeof stockExternal>()

// Nuxt checks a supplied query but permits omitting it, even for a required field.
await nuxtUseFetch('/api/multi')
await useFetch('/api/multi')
await nuxtFetch('/api/multi')
await $fetch('/api/multi')
// @ts-expect-error Colada options must supply the contract's required query.
queryOptions('/api/multi')
// @ts-expect-error an empty options object also omits the required query.
queryOptions('/api/multi', {})
queryOptions('/api/multi', { query: { limit: '1' } })

const stockRaw = await nuxtFetch.raw('/api/bookings')
const defaultRaw = await $fetch.raw('/api/bookings')
expectTypeOf(defaultRaw).toEqualTypeOf<typeof stockRaw>()
const stockDefault = await nuxtUseFetch('/api/bookings', { default: () => ({ available: false }) })
const nativeDefault = await useFetch('/api/bookings', { default: () => ({ available: false }) })
expectTypeOf(nativeDefault).toEqualTypeOf<typeof stockDefault>()
const stockScoped = await nuxtFetch.create({ baseURL: '/api' })('/bookings')
const nativeScoped = await $fetch.create({ baseURL: '/api' })('/bookings')
expectTypeOf(nativeScoped).toEqualTypeOf<typeof stockScoped>()
