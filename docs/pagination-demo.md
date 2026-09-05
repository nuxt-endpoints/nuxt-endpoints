# See the contract: cursor pagination

This walkthrough uses the source implementation of cursor pagination on both
Nuxt 4 and Nuxt 5. It requires the function-based `#endpoints/colada` adapters;
the earlier npm 0.8.0 release does not include this API. Nuxt 5 additionally
requires the pinned prototype setup in the repository README.

## Run the existing demo

After installing dependencies and preparing the selected checkout as described
in its README, run from the repository root:

```bash
vp exec nuxi dev test/fixtures/query-auto --port 3000
```

Open http://localhost:3000/infinite-articles. The first page contains One and
Two. Click **Load next page** to append Three; the button then becomes disabled.

The runnable source is
[`articles.get.ts`](../test/fixtures/basic/server/api/articles.get.ts) and
[`infinite-articles.vue`](../test/fixtures/query-auto/app/pages/infinite-articles.vue).
The fixture scans the basic fixture's server routes, so both refer to the same
HTTP endpoint. This is a small local demonstration, not a production database
pagination implementation.

## One declaration, visible HTTP fields

The route declares:

```ts
pagination: { kind: 'cursor', item: Article }
```

NE expands it into these fields:

| HTTP field           | Contract                                            |
| -------------------- | --------------------------------------------------- |
| Method               | GET                                                 |
| Query cursor         | Optional string                                     |
| Query limit          | Optional integer, 1–100, default 20                 |
| Status 200 JSON body | Required items array, each item conforms to Article |
| Body nextCursor      | Optional string; absent means no next page          |

Additional filters and non-200 responses may be declared normally. The generated
cursor, limit, and 200 response cannot be declared a second time.

The browser Network panel shows the second page request. The same exchange can
be inspected without the NE client:

```bash
curl -i 'http://localhost:3000/api/articles?limit=2'
curl -i 'http://localhost:3000/api/articles?limit=2&cursor=2'
curl -i 'http://localhost:3000/api/articles?limit=0'
curl 'http://localhost:3000/_endpoints/schema'
```

The first two requests return 200 with two items and then one item respectively.
The invalid limit is rejected before the handler. In OpenAPI, inspect
`paths["/api/articles"].get`: it contains the query parameters and the page
response schema, not just an opaque pagination flag.

## The server has obligations

Inside a route with an Article item schema, returning this is a type error:

```ts
handler: () => ({ nextCursor: '2' }) // items is missing
```

These failures are covered by
[server type tests](../test/types/route-handler.test-d.ts).
Do not paste the intentionally invalid handler into the runnable example.

TypeScript checks the handler's response shape. Runtime checks parse the input,
and response schema validation runs according to NE's configured policy
(development by default). Neither the type nor the OpenAPI document proves
database ordering, cursor validity against database state, or the absence of
skipped/duplicated rows during concurrent writes. Those remain server logic.

## The client capability comes from that contract

```ts
import { useInfiniteQuery } from '@pinia/colada'
import { infiniteQueryOptions } from '#endpoints/colada'

const articles = useInfiniteQuery(
  infiniteQueryOptions($endpoint('/api/articles', { method: 'get', query: { limit: 2 } })),
)

await articles.loadNextPage()
```

Colada owns pages, reactive state, and cache lifetime. NE supplies the request
function and the mapping from nextCursor to the next request's cursor.

An ordinary GET has no pagination capability:

```ts
const user = $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
})

infiniteQueryOptions(user) // type error: no pagination capability
```

See [client type tests](../test/types/client.test-d.ts). Raw `$endpoint` calls
remain available. A non-200 page rejects with `EndpointPaginationError`; its
optional result carries the typed HTTP response, while transport failures may
have no result.

## Verification

[HTTP/OpenAPI integration tests](../test/integration/basic.test.ts) verify the
generated wire shape. [Colada integration tests](../test/integration/query-auto.test.ts)
verify SSR, and the browser-enabled path verifies loading the final page over
HTTP. Unit success alone does not establish browser behavior.

To rerun the browser demonstration test:

```bash
NUXT_ENDPOINTS_E2E=1 NUXT_ENDPOINTS_BROWSER_E2E=1 vp exec vitest run test/integration/query-auto.test.ts
```

Use the repository's browser-install command first if Chromium is not installed.
