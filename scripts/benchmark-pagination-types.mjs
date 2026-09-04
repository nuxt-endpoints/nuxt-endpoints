import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const counts = process.argv.slice(2).map(Number)
const routeCounts = counts.length > 0 ? counts : [100, 500]

for (const count of routeCounts) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError(`Route count must be a positive integer, received: ${count}`)
  }
}

const directory = mkdtempSync(join(tmpdir(), 'nuxt-endpoints-pagination-types-'))

try {
  for (const profile of ['call', 'adapter', 'colada', 'mapped-colada']) {
    for (const count of routeCounts) {
      const fixtureDirectory = join(directory, `${profile}-${count}`)
      const config = join(directory, `tsconfig-${profile}-${count}.json`)
      mkdirSync(fixtureDirectory)
      writeFileSync(
        join(fixtureDirectory, 'routes.ts'),
        profile === 'mapped-colada' ? createMappedRoutesFixture(count) : createRoutesFixture(count),
      )
      for (let index = 0; index < count; index++) {
        writeFileSync(
          join(fixtureDirectory, `usage-${index}.ts`),
          createUsageFixture(index, profile),
        )
      }
      writeConfig(config, fixtureDirectory)
      runBenchmark(profile, count, config)
    }
  }

  for (const count of routeCounts) {
    const fixtureDirectory = join(directory, `authoring-${count}`)
    const config = join(directory, `tsconfig-authoring-${count}.json`)
    mkdirSync(fixtureDirectory)
    writeFileSync(join(fixtureDirectory, 'support.ts'), createAuthoringSupport())
    for (let index = 0; index < count; index++) {
      writeFileSync(join(fixtureDirectory, `route-${index}.ts`), createAuthoringFixture(index))
    }
    writeConfig(config, fixtureDirectory)
    runBenchmark('authoring', count, config)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}

function writeConfig(config, fixtureDirectory) {
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        paths: {
          '#ne-runtime': [resolve(root, 'src/runtime/index.ts')],
          '#ne-colada': [resolve(root, 'src/runtime/colada.ts')],
          '@pinia/colada': [resolve(root, 'node_modules/@pinia/colada/dist/index.d.mts')],
        },
      },
      include: [join(fixtureDirectory, '*.ts')],
    }),
  )
}

function runBenchmark(suite, count, config) {
  const output = execFileSync(
    resolve(root, 'node_modules/.bin/tsc'),
    ['--project', config, '--extendedDiagnostics', '--pretty', 'false'],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  process.stdout.write(`suite=${suite} routes=${count}\n${selectMetrics(output)}\n`)
}

function createRoutesFixture(count) {
  const routes = []

  for (let index = 0; index < count; index++) {
    routes.push(`
  | {
      path: '/api/articles/${index}'
      method: 'get'
      definition: {
        pagination: { kind: 'cursor'; item: Schema<Article${index}> }
        query: Schema<{ cursor?: string; limit?: number }, { cursor?: string; limit: number }>
        responses: {
          200: Schema<{ items: Article${index}[]; nextCursor?: string }>
          404: Schema<{ message: string; route: ${index} }>
        }
      }
    }`)
  }

  const articles = Array.from(
    { length: count },
    (_, index) => `type Article${index} = { id: number; field${index}: string }`,
  ).join('\n')

  return `
import type { EndpointClient, StandardSchemaLike } from '#ne-runtime'

type Schema<Input, Output = Input> = StandardSchemaLike<Input, Output>
${articles}

export type Routes =${routes.join('')}

export declare const $endpoint: EndpointClient<Routes>
`
}

function createMappedRoutesFixture(count) {
  const entries = Array.from(
    { length: count },
    (_, index) => `
  '/api/articles/${index}': {
    get: {
      path: '/api/articles/${index}'
      method: 'get'
      definition: {
        pagination: { kind: 'cursor'; item: Schema<Article${index}> }
        query: Schema<{ cursor?: string; limit?: number }, { cursor?: string; limit: number }>
        responses: {
          200: Schema<{ items: Article${index}[]; nextCursor?: string }>
          404: Schema<{ message: string; route: ${index} }>
        }
      }
    }
  }`,
  ).join('\n')

  const articles = Array.from(
    { length: count },
    (_, index) => `type Article${index} = { id: number; field${index}: string }`,
  ).join('\n')

  return `
import type { EndpointMappedClient, StandardSchemaLike } from '#ne-runtime'

type Schema<Input, Output = Input> = StandardSchemaLike<Input, Output>
${articles}

type RouteMap = {
${entries}
}
export declare const $endpointMapped: EndpointMappedClient<RouteMap>
`
}

function createUsageFixture(index, profile) {
  const call = `$endpoint('/api/articles/${index}', { method: 'get', query: {} })`
  const mappedCall = `$endpointMapped('/api/articles/${index}', { method: 'get', query: {} })`

  if (profile === 'call') {
    return `
import { $endpoint } from './routes.js'

const request = ${call}
request.then((result) => {
  if (result.status === 200) result.body.items[0]?.field${index}
  if (result.status === 404) result.body.route satisfies ${index}
})
`
  }

  if (profile === 'adapter') {
    return `
import { infiniteQueryOptions } from '#ne-colada'
import { $endpoint } from './routes.js'

const options = infiniteQueryOptions(${call})
options.query({ signal: new AbortController().signal, pageParam: undefined }).then(
  (page) => page.items[0]?.field${index},
)
`
  }

  return `
import { useInfiniteQuery } from '@pinia/colada'
import { infiniteQueryOptions } from '#ne-colada'
import { ${profile === 'mapped-colada' ? '$endpointMapped' : '$endpoint'} } from './routes.js'

const query = useInfiniteQuery(
  infiniteQueryOptions(${profile === 'mapped-colada' ? mappedCall : call}),
)
query.data.value?.pages[0]?.items[0]?.field${index}
if (query.error.value?.result?.status === 404) {
  query.error.value.result.body.route satisfies ${index}
}
`
}

function createAuthoringSupport() {
  return `
import type { StandardSchemaLike } from '#ne-runtime'

export { defineRouteHandler } from '#ne-runtime'

export function schema<Input, Output = Input>(): StandardSchemaLike<Input, Output> {
  return null as never
}
`
}

function createAuthoringFixture(index) {
  return `
import { defineRouteHandler, schema } from './support.js'

const Article = schema<{ id: number; field${index}: string }>()

export default defineRouteHandler({
  pagination: { kind: 'cursor', item: Article },
  validate: {
    query: schema<{ category?: string }>(),
    response: { 404: schema<{ message: string; route: ${index} }>() },
  },
  handler: (event) => {
    event.validated.query.limit satisfies number
    return {
      items: [{ id: ${index}, field${index}: 'value' }],
      nextCursor: 'next',
    }
  },
})
`
}

function selectMetrics(output) {
  const wanted = new Set([
    'Files',
    'Lines',
    'Lines of TypeScript',
    'Types',
    'Instantiations',
    'Memory used',
    'Check time',
    'Total time',
  ])
  return output
    .split(/\r?\n/u)
    .filter((line) => wanted.has(line.slice(0, line.indexOf(':'))))
    .join('\n')
}
