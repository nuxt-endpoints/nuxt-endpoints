<template>
  <div class="ne-endpoints-page">
    <header class="header">
      <p class="text -eyebrow">Core client</p>
      <h1 class="title">Typed endpoints</h1>
      <p class="text -lede">
        Call path-and-method <code class="code">$endpoint</code> requests, compare a Valibot-backed
        route, and verify that legacy Nitro handlers keep working through plain
        <code class="code">$fetch</code>.
      </p>
    </header>

    <section class="section -inspector" aria-labelledby="contract-inspector-title">
      <header class="header">
        <div class="unit">
          <p class="text -eyebrow">Guided scenarios</p>
          <h2 id="contract-inspector-title" class="title">HTTP contract inspector</h2>
          <p class="text -explanation">
            Pick an endpoint scenario, then follow its definition through the generated client, the
            request on the wire, and the status-aware response.
          </p>
        </div>
        <span class="status" role="status" :data-kind="inspectorStatusKind">
          {{ inspectorStatusLabel }}
        </span>
      </header>

      <div class="actions -scenarios" aria-label="HTTP contract scenarios">
        <button
          v-for="scenario in inspectorScenarios"
          :key="scenario.id"
          class="button -scenario"
          type="button"
          :aria-label="`Run ${scenario.status} scenario`"
          :aria-pressed="scenario.id === selectedScenarioId"
          :disabled="inspectorRunning"
          @click="runInspectorScenario(scenario.id)"
        >
          <span class="unit">
            <span class="value">{{ scenario.status }}</span>
            <code class="code">$endpoint(path)</code>
          </span>
          <strong class="strong">{{ scenario.title }}</strong>
          <span class="text">{{ scenario.description }}</span>
        </button>
      </div>

      <div class="comparisons">
        <section class="comparison">
          <header class="header">
            <div class="unit">
              <p class="text -eyebrow">Type-level API</p>
              <h3 class="title">Server <span aria-hidden="true">↔</span> Client</h3>
            </div>
            <p class="text -explanation">
              The exported server contract becomes the generated client signature.
            </p>
          </header>

          <div class="pair">
            <article class="article -stage">
              <header class="header">
                <span class="value">Server contract</span>
                <code class="code">defineRouteHandler</code>
              </header>
              <pre class="pre"><code>{{ selectedScenario.contract }}</code></pre>
            </article>

            <span class="connector" aria-hidden="true">↔</span>

            <article class="article -stage">
              <header class="header">
                <span class="value">Generated client</span>
                <code class="code">await / .raw()</code>
              </header>
              <pre class="pre"><code>{{ selectedScenario.client }}</code></pre>
            </article>
          </div>
        </section>

        <section class="comparison">
          <header class="header">
            <div class="unit">
              <p class="text -eyebrow">Runtime exchange</p>
              <h3 class="title">Request <span aria-hidden="true">→</span> Response</h3>
            </div>
            <p class="text -explanation">
              Run the scenario to see the actual HTTP input and status-aware output.
            </p>
          </header>

          <div class="pair">
            <article class="article -stage">
              <header class="header">
                <span class="value">HTTP request</span>
                <code class="code">{{ selectedScenario.method }} {{ selectedScenario.path }}</code>
              </header>
              <pre class="pre"><code>{{ formattedInspectorRequest }}</code></pre>
            </article>

            <span class="connector" aria-hidden="true">→</span>

            <article class="article -stage">
              <header class="header">
                <span class="value">HTTP response</span>
                <code class="code">{{ inspectorResponseSummary }}</code>
              </header>
              <pre class="pre"><code>{{ formattedInspectorResponse }}</code></pre>
            </article>
          </div>
        </section>
      </div>

      <p class="text -note">{{ selectedScenario.takeaway }}</p>
    </section>

    <section class="section -try" aria-labelledby="try-it-yourself-title">
      <header class="header">
        <div class="unit">
          <p class="text -eyebrow">Try it yourself</p>
          <h2 id="try-it-yourself-title" class="title">Choose what you want to verify</h2>
          <p class="text -explanation">
            Select one request, read its check points, then change the input and compare the result
            beside it.
          </p>
        </div>
      </header>

      <div class="actions -operations" aria-label="Choose a request">
        <button
          v-for="operation in tryOperations"
          :key="operation.id"
          class="button -operation"
          type="button"
          :aria-pressed="operation.id === selectedTryOperationId"
          @click="selectTryOperation(operation.id)"
        >
          <code class="code">{{ operation.label }}</code>
          <span class="text">{{ operation.summary }}</span>
        </button>
      </div>

      <div class="workspace">
        <article class="article -exercise" aria-label="Request form">
          <header class="header">
            <div class="unit">
              <p class="text -eyebrow">Selected request</p>
              <h3 class="title">{{ selectedTryOperation.label }}</h3>
            </div>
            <code class="code">{{ selectedTryOperation.route }}</code>
          </header>

          <div class="guide">
            <strong class="strong">What to confirm</strong>
            <ul class="list">
              <li v-for="point in selectedTryOperation.confirmations" :key="point" class="item">
                {{ point }}
              </li>
            </ul>
          </div>

          <form
            v-if="selectedTryOperationId === 'get-user'"
            class="form"
            @submit.prevent="loadUser"
          >
            <label class="label">
              User ID
              <input v-model="userId" class="input" inputmode="numeric" autocomplete="off" />
            </label>
            <button class="button" type="submit">Fetch user</button>
          </form>

          <form
            v-else-if="selectedTryOperationId === 'create-user'"
            class="form"
            @submit.prevent="createUser"
          >
            <label class="label">
              Name
              <input v-model="newUserName" class="input" autocomplete="off" />
            </label>
            <label class="label">
              Age
              <input v-model.number="newUserAge" class="input" type="number" />
            </label>
            <button class="button" type="submit">Create user</button>
          </form>

          <form
            v-else-if="selectedTryOperationId === 'search-users'"
            class="form"
            @submit.prevent="searchUsers"
          >
            <label class="label">
              Query
              <input v-model="searchQuery" class="input" autocomplete="off" />
            </label>
            <label class="label">
              Limit (1-10)
              <input v-model="searchLimit" class="input" inputmode="numeric" autocomplete="off" />
            </label>
            <button class="button" type="submit">Search users</button>
          </form>

          <form v-else class="form" @submit.prevent="loadLegacyStats">
            <p class="text -explanation">
              This Nitro route has no endpoint export. It stays outside
              <code class="code">$endpoint</code> and OpenAPI while plain
              <code class="code">$fetch</code> continues to work.
            </p>
            <button class="button" type="submit">Fetch legacy stats</button>
          </form>
        </article>

        <article class="article -result" aria-label="Request result" aria-live="polite">
          <header class="header">
            <div class="unit">
              <p class="text -eyebrow">Output</p>
              <h3 class="title">Result</h3>
            </div>
            <span class="status" role="status" :data-kind="resultKind">{{ resultKind }}</span>
          </header>
          <pre class="pre">{{ formattedResult }}</pre>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { $endpoint } from '#imports'

type InspectorScenarioId = 'success' | 'not-found' | 'created' | 'invalid-query'
type InspectorScenario = {
  id: InspectorScenarioId
  status: string
  title: string
  description: string
  takeaway: string
  method: 'GET' | 'POST'
  path: string
  contract: string
  client: string
  request: Record<string, unknown>
}
type InspectorResponse = {
  status: number
  statusText: string
  ok: boolean
  headers: Record<string, string>
  body: unknown
}
type TryOperationId = 'get-user' | 'create-user' | 'search-users' | 'legacy-fetch'
type TryOperation = {
  id: TryOperationId
  label: string
  route: string
  summary: string
  confirmations: string[]
}

const getUserContract = `export default defineRouteHandler({
  params: z.object({ id: z.string() }),
  validate: {
    query: z.object({ includeAge: z.coerce.boolean().optional() }),
    headers: z.object({ 'x-client-version': z.string().min(1) }),
    response: { 200: User, 404: ErrorResponse },
  },
  handler: (event) => findUser(event.validated.params.id),
})`

const createUserContract = `export default defineRouteHandler({
  validate: {
    body: z.object({
      name: z.string().min(1),
      age: z.number().int().nonnegative().optional(),
    }),
    response: { 201: User },
  },
  handler: (event) => event.respond(201, createUser(event.validated.body)),
})`

const inspectorScenarios: InspectorScenario[] = [
  {
    id: 'success',
    status: '200 OK',
    title: 'Typed success',
    description: 'Params, query, and a required header reach the handler as validated values.',
    takeaway:
      'The client input is generated from params, query, and headers. The 200 body is checked against the declared User schema.',
    method: 'GET',
    path: '/api/users/1?includeAge=true',
    contract: getUserContract,
    client: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
  query: { includeAge: true },
  headers: { 'x-client-version': 'playground/1.0' },
})

if (result.status === 200) result.body.name`,
    request: {
      method: 'GET',
      url: '/api/users/1?includeAge=true',
      headers: { 'x-client-version': 'playground/1.0' },
    },
  },
  {
    id: 'not-found',
    status: '404 Not Found',
    title: 'Declared response',
    description: 'A non-2xx status stays typed data instead of becoming an unknown error body.',
    takeaway:
      'Because 404 is declared, awaiting the request returns it as a typed branch. TypeScript narrows result.body to ErrorResponse.',
    method: 'GET',
    path: '/api/users/999?includeAge=true',
    contract: getUserContract,
    client: `const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '999' },
  query: { includeAge: true },
  headers: { 'x-client-version': 'playground/1.0' },
})

if (result.status === 404) result.body.message`,
    request: {
      method: 'GET',
      url: '/api/users/999?includeAge=true',
      headers: { 'x-client-version': 'playground/1.0' },
    },
  },
  {
    id: 'created',
    status: '201 Created',
    title: 'Typed mutation',
    description: 'A validated request body produces the response declared for a successful POST.',
    takeaway:
      'The generated client requires the body defined by the contract. The 201 branch carries the declared User response type.',
    method: 'POST',
    path: '/api/users',
    contract: createUserContract,
    client: `const result = await $endpoint('/api/users', {
  method: 'post',
  body: { name: 'Sid', age: 30 },
})

if (result.status === 201) result.body.id`,
    request: {
      method: 'POST',
      url: '/api/users',
      body: { name: 'Sid', age: 30 },
    },
  },
  {
    id: 'invalid-query',
    status: '400 Validation Error',
    title: 'Runtime guard',
    description: 'Valibot transforms the query string, then rejects a value outside 1–10.',
    takeaway:
      'Static types know that query input is a string. Runtime validation still protects the HTTP boundary from an out-of-range value.',
    method: 'GET',
    path: '/api/users/search?q=ja&limit=99',
    contract: `export default defineRouteHandler({
  validate: {
    query: v.object({
      q: v.pipe(v.string(), v.minLength(1)),
      limit: v.optional(v.pipe(
        v.string(), v.transform(Number), v.number(),
        v.integer(), v.minValue(1), v.maxValue(10),
      )),
    }),
    response: { 200: SearchResult },
  },
  handler: (event) => searchUsers(event.validated.query),
})`,
    client: `const response = await $endpoint('/api/users/search', {
  method: 'get',
  query: { q: 'ja', limit: '99' },
}).raw()

response.status // 400`,
    request: {
      method: 'GET',
      url: '/api/users/search?q=ja&limit=99',
    },
  },
]

const tryOperations: TryOperation[] = [
  {
    id: 'get-user',
    label: "$endpoint('/api/users/:id')",
    route: 'GET /api/users/:id',
    summary: 'Params, query, headers, and declared errors',
    confirmations: [
      'The generated client accepts the inputs declared by the server contract.',
      'IDs 1 and 2 exist. Any other ID returns the declared 404 response.',
    ],
  },
  {
    id: 'create-user',
    label: "$endpoint('/api/users')",
    route: 'POST /api/users',
    summary: 'Validated request body and a 201 response',
    confirmations: [
      'A non-empty name and an optional non-negative integer age return the declared 201 response.',
      'Try an empty name or negative age to see body validation return 400.',
      'This small demo echoes the validated body with ID 101; it does not persist the user.',
    ],
  },
  {
    id: 'search-users',
    label: "$endpoint('/api/users/search')",
    route: 'GET /api/users/search',
    summary: 'Valibot transformation and runtime validation',
    confirmations: [
      'Use query “ja” and limit 1: one item is returned while total remains 2.',
      'A limit above 10 returns 400 after Valibot transforms the query string into a number.',
    ],
  },
  {
    id: 'legacy-fetch',
    label: 'plain $fetch',
    route: 'GET /api/legacy-stats',
    summary: 'Incremental adoption without an endpoint export',
    confirmations: [
      'The 200 result confirms that a legacy Nitro route still works through plain $fetch.',
      'Unlike opted-in routes, /api/legacy-stats is not a known $endpoint path and is absent from OpenAPI.',
    ],
  },
]

const userId = ref('1')
const newUserName = ref('Sid')
const newUserAge = ref(30)
const searchQuery = ref('ja')
const searchLimit = ref('10')
const result = ref<unknown>()
const resultKind = ref<'idle' | 'success' | 'error'>('idle')
const selectedScenarioId = ref<InspectorScenarioId>('success')
const selectedTryOperationId = ref<TryOperationId>('get-user')
const inspectorResponse = ref<InspectorResponse>()
const inspectorRunning = ref(false)

const formattedResult = computed(() =>
  result.value === undefined
    ? '// Run the selected request to see its result here.'
    : JSON.stringify(result.value, null, 2),
)
const selectedTryOperation = computed(
  () =>
    tryOperations.find((operation) => operation.id === selectedTryOperationId.value) ??
    tryOperations[0]!,
)
const selectedScenario = computed(
  () =>
    inspectorScenarios.find((scenario) => scenario.id === selectedScenarioId.value) ??
    inspectorScenarios[0]!,
)
const formattedInspectorRequest = computed(() =>
  JSON.stringify(selectedScenario.value.request, null, 2),
)
const formattedInspectorResponse = computed(() =>
  inspectorResponse.value
    ? JSON.stringify(inspectorResponse.value, null, 2)
    : '// Pick a scenario above to send the request.',
)
const inspectorResponseSummary = computed(() => {
  if (inspectorRunning.value) return 'Sending…'
  if (!inspectorResponse.value) return 'Not sent'
  return `${inspectorResponse.value.status} ${inspectorResponse.value.statusText}`
})
const inspectorStatusKind = computed(() => {
  if (!inspectorResponse.value) return 'idle'
  return inspectorResponse.value.ok ? 'success' : 'error'
})
const inspectorStatusLabel = computed(() => {
  if (inspectorRunning.value) return 'sending'
  if (!inspectorResponse.value) return 'ready'
  return inspectorResponseSummary.value
})

function selectTryOperation(id: TryOperationId) {
  selectedTryOperationId.value = id
  result.value = undefined
  resultKind.value = 'idle'
}

async function runInspectorScenario(id: InspectorScenarioId) {
  selectedScenarioId.value = id
  inspectorResponse.value = undefined
  inspectorRunning.value = true

  try {
    if (id === 'created') {
      const response = await $endpoint('/api/users', {
        method: 'post',
        body: { name: 'Sid', age: 30 },
      })
      inspectorResponse.value = {
        status: response.status,
        statusText: statusText(response.status),
        ok: response.ok,
        headers: visibleHeaders(response.headers),
        body: response.body,
      }
      return
    }

    if (id === 'invalid-query') {
      const response = await $endpoint('/api/users/search', {
        method: 'get',
        query: { q: 'ja', limit: '99' },
      }).raw()
      inspectorResponse.value = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: visibleHeaders(response.headers),
        body: await response.json(),
      }
      return
    }

    const response = await $endpoint('/api/users/:id', {
      method: 'get',
      params: { id: id === 'not-found' ? '999' : '1' },
      query: { includeAge: true },
      headers: { 'x-client-version': 'playground/1.0' },
    })

    inspectorResponse.value = {
      status: response.status,
      statusText: statusText(response.status),
      ok: response.ok,
      headers: visibleHeaders(response.headers),
      body: response.body,
    }
  } catch (error) {
    inspectorResponse.value = {
      status: 0,
      statusText: 'Transport Error',
      ok: false,
      headers: {},
      body: normalizeError(error),
    }
  } finally {
    inspectorRunning.value = false
  }
}

async function loadUser() {
  try {
    const response = await $endpoint('/api/users/:id', {
      method: 'get',
      params: { id: userId.value },
      query: { includeAge: true },
      headers: { 'x-client-version': 'playground/1.0' },
    })
    result.value = {
      status: response.status,
      ok: response.ok,
      body: response.body,
    }
    resultKind.value = response.ok ? 'success' : 'error'
  } catch (error) {
    result.value = normalizeError(error)
    resultKind.value = 'error'
  }
}

async function createUser() {
  try {
    const response = await $endpoint('/api/users', {
      method: 'post',
      body: {
        name: newUserName.value,
        age: Number.isInteger(newUserAge.value) ? newUserAge.value : undefined,
      },
    }).raw()
    result.value = {
      status: response.status,
      ok: response.ok,
      body: await response.json(),
    }
    resultKind.value = response.ok ? 'success' : 'error'
  } catch (error) {
    result.value = normalizeError(error)
    resultKind.value = 'error'
  }
}

async function searchUsers() {
  try {
    const response = await $endpoint('/api/users/search', {
      method: 'get',
      query: {
        q: searchQuery.value,
        limit: searchLimit.value || undefined,
      },
    }).raw()
    result.value = {
      status: response.status,
      ok: response.ok,
      body: await response.json(),
    }
    resultKind.value = response.ok ? 'success' : 'error'
  } catch (error) {
    result.value = normalizeError(error)
    resultKind.value = 'error'
  }
}

async function loadLegacyStats() {
  try {
    const response = await $fetch.raw('/api/legacy-stats')
    result.value = {
      status: response.status,
      ok: response.ok,
      body: response._data,
    }
    resultKind.value = response.ok ? 'success' : 'error'
  } catch (error) {
    result.value = normalizeError(error)
    resultKind.value = 'error'
  }
}

function normalizeError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    return (error as { data?: unknown }).data
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return error
}

function visibleHeaders(headers: Headers) {
  return Object.fromEntries(
    [...headers.entries()].filter(([name]) =>
      ['content-type', 'idempotency-key', 'x-request-id'].includes(name.toLowerCase()),
    ),
  )
}

function statusText(status: number) {
  if (status === 200) return 'OK'
  if (status === 201) return 'Created'
  if (status === 404) return 'Not Found'
  return ''
}
</script>

<style scoped>
.ne-endpoints-page {
  > .header {
    margin-bottom: var(--pg-space-600);

    > .text.-eyebrow {
      margin: 0 0 var(--pg-space-100);
      color: var(--pg-subtle);
      font-size: var(--pg-text-xs);
      font-weight: 800;
      letter-spacing: var(--pg-tracking-label);
      text-transform: uppercase;
    }

    > .title {
      margin: 0;
      font-size: var(--pg-text-title);
      line-height: 1.15;
    }

    > .text.-lede {
      max-width: 760px;
      margin: var(--pg-space-250) 0 0;
      color: var(--pg-muted);
      line-height: 1.65;

      > .code {
        border-radius: var(--pg-radius-xs);
        background: var(--pg-hover-bg);
        padding: var(--pg-space-100) var(--pg-space-150);
      }
    }
  }

  > .section.-inspector {
    border: var(--pg-stroke) solid var(--pg-line);
    border-radius: var(--pg-radius-lg);
    background: var(--pg-surface);
    padding: var(--pg-space-500);

    > .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--pg-space-600);

      > .unit {
        > .text.-eyebrow {
          margin: 0 0 var(--pg-space-100);
          color: var(--pg-subtle);
          font-size: var(--pg-text-xs);
          font-weight: 800;
          letter-spacing: var(--pg-tracking-label);
          text-transform: uppercase;
        }

        > .title {
          margin: 0;
          font-size: var(--pg-text-md);
        }

        > .text.-explanation {
          max-width: 720px;
          margin: var(--pg-space-250) 0 0;
          color: var(--pg-muted);
          font-size: var(--pg-text-sm);
          line-height: 1.55;
        }
      }

      > .status {
        flex: 0 0 auto;
        border-radius: var(--pg-radius-pill);
        background: var(--pg-hover-bg);
        color: var(--pg-muted);
        padding: var(--pg-space-100) var(--pg-space-225);
        font-size: var(--pg-text-xs);
        font-weight: 800;

        &[data-kind='success'] {
          background: var(--pg-success-bg);
          color: var(--pg-success-ink);
        }

        &[data-kind='error'] {
          background: var(--pg-error-bg);
          color: var(--pg-error-ink);
        }
      }
    }

    > .actions.-scenarios {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--pg-space-250);
      margin-top: var(--pg-space-450);

      > .button.-scenario {
        display: grid;
        gap: var(--pg-space-100);
        border: var(--pg-stroke) solid var(--pg-line);
        border-radius: var(--pg-radius-md);
        background: var(--pg-bg);
        color: var(--pg-ink);
        cursor: pointer;
        padding: var(--pg-space-300);
        font: inherit;
        text-align: left;

        &[aria-pressed='true'] {
          border-color: var(--pg-action-bg);
          background: var(--pg-hover-bg);
        }

        &:disabled {
          cursor: wait;
          opacity: 0.72;
        }

        > .unit {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--pg-space-200);

          > .value {
            color: var(--pg-subtle);
            font-size: var(--pg-text-xs);
            font-weight: 800;
            text-transform: uppercase;
          }

          > .code {
            overflow: hidden;
            color: var(--pg-subtle);
            font-size: var(--pg-text-xs);
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }

        > .strong {
          font-size: var(--pg-text-sm);
        }

        > .text {
          color: var(--pg-muted);
          font-size: var(--pg-text-note);
          line-height: 1.45;
        }
      }
    }

    > .comparisons {
      display: grid;
      gap: var(--pg-space-400);
      margin-top: var(--pg-space-400);

      > .comparison {
        border: var(--pg-stroke) solid var(--pg-line-soft);
        border-radius: var(--pg-radius-md);
        background: var(--pg-bg);
        overflow: hidden;

        > .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--pg-space-500);
          border-bottom: var(--pg-stroke) solid var(--pg-line-soft);
          padding: var(--pg-space-300) var(--pg-space-400);

          > .unit {
            > .text.-eyebrow {
              margin: 0 0 var(--pg-space-100);
              color: var(--pg-subtle);
              font-size: var(--pg-text-xs);
              font-weight: 800;
              letter-spacing: var(--pg-tracking-label);
              text-transform: uppercase;
            }

            > .title {
              margin: 0;
              font-size: var(--pg-text-md);
            }
          }

          > .text.-explanation {
            max-width: 440px;
            margin: 0;
            color: var(--pg-muted);
            font-size: var(--pg-text-note);
            line-height: 1.45;
            text-align: right;
          }
        }

        > .pair {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: stretch;

          > .connector {
            align-self: center;
            color: var(--pg-subtle);
            padding: var(--pg-space-150);
            font-size: var(--pg-text-lg);
            font-weight: 800;
          }

          > .article.-stage {
            min-width: 0;
            overflow: hidden;

            > .header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--pg-space-250);
              border-bottom: var(--pg-stroke) solid var(--pg-line-soft);
              padding: var(--pg-space-225) var(--pg-space-300);

              > .value {
                font-size: var(--pg-text-xs);
                font-weight: 800;
                text-transform: uppercase;
              }

              > .code {
                overflow: hidden;
                color: var(--pg-subtle);
                font-size: var(--pg-text-xs);
                text-overflow: ellipsis;
                white-space: nowrap;
              }
            }

            > .pre {
              min-height: 230px;
              max-height: 340px;
              overflow: auto;
              margin: 0;
              background: var(--pg-code-bg);
              color: var(--pg-code-ink);
              padding: var(--pg-space-400);
              font-size: var(--pg-text-note);
              line-height: 1.5;
              white-space: pre-wrap;
            }
          }
        }
      }
    }

    > .text.-note {
      margin: var(--pg-space-300) 0 0;
      border-left: 3px solid var(--pg-action-bg);
      color: var(--pg-muted);
      padding-left: var(--pg-space-300);
      font-size: var(--pg-text-sm);
      line-height: 1.55;
    }
  }

  > .section.-try {
    margin-top: var(--pg-space-600);
    border: var(--pg-stroke) solid var(--pg-line);
    border-radius: var(--pg-radius-lg);
    background: var(--pg-surface);
    padding: var(--pg-space-500);

    > .header {
      > .unit {
        > .text.-eyebrow {
          margin: 0 0 var(--pg-space-100);
          color: var(--pg-subtle);
          font-size: var(--pg-text-xs);
          font-weight: 800;
          letter-spacing: var(--pg-tracking-label);
          text-transform: uppercase;
        }

        > .title {
          margin: 0;
          font-size: var(--pg-text-md);
        }

        > .text.-explanation {
          max-width: 760px;
          margin: var(--pg-space-200) 0 0;
          color: var(--pg-muted);
          font-size: var(--pg-text-sm);
          line-height: 1.55;
        }
      }
    }

    > .actions.-operations {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--pg-space-200);
      margin-top: var(--pg-space-400);

      > .button.-operation {
        display: grid;
        align-content: start;
        gap: var(--pg-space-125);
        border: var(--pg-stroke) solid var(--pg-line);
        border-radius: var(--pg-radius-md);
        background: var(--pg-bg);
        color: var(--pg-ink);
        cursor: pointer;
        padding: var(--pg-space-250);
        font: inherit;
        text-align: left;

        &[aria-pressed='true'] {
          border-color: var(--pg-action-bg);
          background: var(--pg-hover-bg);
        }

        > .code {
          color: var(--pg-ink);
          font-size: var(--pg-text-sm);
          font-weight: 800;
        }

        > .text {
          color: var(--pg-muted);
          font-size: var(--pg-text-note);
          line-height: 1.4;
        }
      }
    }

    > .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: stretch;
      gap: var(--pg-space-300);
      margin-top: var(--pg-space-300);

      > .article {
        min-width: 0;
        border: var(--pg-stroke) solid var(--pg-line);
        border-radius: var(--pg-radius-lg);
        background: var(--pg-bg);
        padding: var(--pg-space-500);
      }

      > .article.-exercise {
        > .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--pg-space-300);

          > .unit {
            > .text.-eyebrow {
              margin: 0 0 var(--pg-space-100);
              color: var(--pg-subtle);
              font-size: var(--pg-text-xs);
              font-weight: 800;
              letter-spacing: var(--pg-tracking-label);
              text-transform: uppercase;
            }

            > .title {
              margin: 0;
              font-size: var(--pg-text-md);
            }
          }

          > .code {
            color: var(--pg-subtle);
            font-size: var(--pg-text-xs);
          }
        }

        > .guide {
          margin-top: var(--pg-space-350);
          border-radius: var(--pg-radius-md);
          background: var(--pg-hover-bg);
          padding: var(--pg-space-300);

          > .strong {
            font-size: var(--pg-text-sm);
          }

          > .list {
            display: grid;
            gap: var(--pg-space-100);
            margin: var(--pg-space-150) 0 0;
            padding-left: var(--pg-space-350);
            color: var(--pg-muted);
            font-size: var(--pg-text-note);
            line-height: 1.5;
          }
        }

        > .form {
          margin-top: var(--pg-space-400);

          > .label {
            display: grid;
            gap: var(--pg-space-150);
            margin-bottom: var(--pg-space-300);
            color: var(--pg-muted);
            font-size: var(--pg-text-sm);
            font-weight: 700;

            > .input {
              width: 100%;
              border: var(--pg-stroke) solid var(--pg-line-strong);
              border-radius: var(--pg-radius-md);
              padding: var(--pg-space-250) var(--pg-space-300);
              color: var(--pg-ink);
              font: inherit;
            }
          }

          > .text.-explanation {
            margin: 0 0 var(--pg-space-350);
            color: var(--pg-muted);
            font-size: var(--pg-text-sm);
            line-height: 1.55;

            > .code {
              border-radius: var(--pg-radius-xs);
              background: var(--pg-hover-bg);
              padding: var(--pg-space-100) var(--pg-space-150);
            }
          }

          > .button {
            width: 100%;
            min-height: 42px;
            border: var(--pg-stroke) solid var(--pg-action-bg);
            border-radius: var(--pg-radius-md);
            background: var(--pg-action-bg);
            color: var(--pg-action-ink);
            cursor: pointer;
            font: inherit;
            font-weight: 700;
          }
        }
      }

      > .article.-result {
        display: grid;
        grid-template-rows: auto 1fr;

        > .header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--pg-space-300);
          margin-bottom: var(--pg-space-300);

          > .unit {
            > .text.-eyebrow {
              margin: 0 0 var(--pg-space-100);
              color: var(--pg-subtle);
              font-size: var(--pg-text-xs);
              font-weight: 800;
              letter-spacing: var(--pg-tracking-label);
              text-transform: uppercase;
            }

            > .title {
              margin: 0;
              font-size: var(--pg-text-md);
            }
          }

          > .status {
            border-radius: var(--pg-radius-pill);
            background: var(--pg-hover-bg);
            color: var(--pg-muted);
            padding: var(--pg-space-100) var(--pg-space-225);
            font-size: var(--pg-text-xs);
            font-weight: 800;

            &[data-kind='success'] {
              background: var(--pg-success-bg);
              color: var(--pg-success-ink);
            }

            &[data-kind='error'] {
              background: var(--pg-error-bg);
              color: var(--pg-error-ink);
            }
          }
        }

        > .pre {
          min-height: 300px;
          overflow: auto;
          margin: 0;
          border-radius: var(--pg-radius-md);
          background: var(--pg-code-bg);
          color: var(--pg-code-ink);
          padding: var(--pg-space-400);
          font-size: var(--pg-text-sm);
          line-height: 1.5;
          white-space: pre-wrap;
        }
      }
    }
  }
}

@media (max-width: 760px) {
  .ne-endpoints-page {
    > .header > .title {
      font-size: var(--pg-text-mobile-title);
    }

    > .section.-try {
      > .actions.-operations,
      > .workspace {
        grid-template-columns: 1fr;
      }
    }

    > .section.-inspector {
      > .header {
        display: grid;
      }

      > .actions.-scenarios {
        grid-template-columns: 1fr;
      }

      > .comparisons > .comparison {
        > .header {
          display: grid;
          align-items: start;

          > .text.-explanation {
            text-align: left;
          }
        }

        > .pair {
          grid-template-columns: 1fr;

          > .connector {
            justify-self: center;
            transform: rotate(90deg);
          }
        }
      }
    }
  }
}
</style>
