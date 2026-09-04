// Translates a native form submission - a browser navigation POST to a page
// URL - into an ordinary call to the endpoint that declared `form.from` for
// that page, then answers the browser the way a browser needs to be answered:
// `303` on success, and on failure the page itself, rendered inside the same
// request with the issues the endpoint reported.
//
// The endpoint is never modified and never learns any of this happened. It
// stays callable with `curl -d 'name=Ada'`, and the OpenAPI document still
// describes exactly one URL for it. See docs/progressive-enhancement.md.
//
// Nitro registers its renderer at `/**` with no method restriction, which is
// what makes the failure path work - see pi0's closing comment on
// nitrojs/nitro#1286.
import { endpointNativeSubmissionKey } from './client'
import type { EndpointFormIssue, EndpointNativeSubmission } from './client'
import { getFormRoute } from './form-routes-state'
import {
  defineRuntimeMiddleware,
  getRuntimePathname,
  getRuntimeRequestHeaders,
  readRuntimeFormData,
  runtimeRedirect,
  runtimeServerFetch,
} from './platform'
import type { RuntimeEvent } from './platform'

type IncomingHeaders = Readonly<Record<string, string | undefined>>

/**
 * A browser navigation, not a `fetch`. `Sec-Fetch-Mode: navigate` is set by
 * the browser itself and cannot be forged by page scripts; the `Accept` check
 * covers agents that send no Fetch Metadata. `$fetch` sends neither, so the
 * enhanced path never reaches the bridge.
 */
function isNavigationPost(event: RuntimeEvent, headers: IncomingHeaders): boolean {
  if (event.req.method !== 'POST') {
    return false
  }
  if (headers['sec-fetch-mode'] === 'navigate') {
    return true
  }
  return (headers.accept ?? '').includes('text/html')
}

/**
 * Credentials do not ride along on their own: the internal call is a separate
 * request with its own headers. Only what the endpoint legitimately needs is
 * copied. `accept` is deliberately replaced so the endpoint answers JSON, and
 * `content-length` is dropped because the runtime recomputes it.
 */
function forwardedHeaders(incoming: IncomingHeaders, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  for (const name of ['cookie', 'authorization']) {
    const value = incoming[name]
    if (value) {
      headers[name] = value
    }
  }
  if (contentType) {
    headers['content-type'] = contentType
  }
  return headers
}

/**
 * The plain string fields of a submission, so a rejected page can redisplay
 * what was typed. A file is skipped: a browser refuses to let a page set the
 * value of `<input type="file">`, so there is nothing to redisplay.
 */
function submittedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      values[key] = value
    }
  }
  return values
}

function extractIssues(payload: Record<string, unknown>): EndpointFormIssue[] {
  const data = payload.data
  if (!data || typeof data !== 'object') {
    return []
  }
  const issues: EndpointFormIssue[] = []
  for (const group of Object.values(data as Record<string, unknown>)) {
    if (!Array.isArray(group)) {
      continue
    }
    for (const issue of group as Record<string, unknown>[]) {
      issues.push({
        ...issue,
        message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
      } as EndpointFormIssue)
    }
  }
  return issues
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function resolveRedirect(template: string, body: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (whole, key: string) => {
    const value = body[key]
    // Only a scalar can stand in for a path segment; anything else would
    // stringify into `[object Object]` and produce a broken URL.
    return typeof value === 'string' || typeof value === 'number'
      ? encodeURIComponent(String(value))
      : whole
  })
}

export default defineRuntimeMiddleware(async (event, next) => {
  const pathname = getRuntimePathname(event)
  const route = getFormRoute(pathname)
  if (!route) {
    return
  }
  const incoming = getRuntimeRequestHeaders(event)
  if (!isNavigationPost(event, incoming)) {
    return
  }

  // The body is read rather than streamed through, because a rejected
  // submission has to come back with what was typed still in it. That costs a
  // re-encode; a multipart body goes back out as `FormData` so the runtime
  // generates its own boundary, and a urlencoded one is rebuilt as urlencoded.
  // Either way the encoding is the one the contract declares, so the endpoint
  // sees a request it would have accepted from anyone.
  const form = await readRuntimeFormData(event)
  const values = submittedValues(form)
  const isMultipart = route.enctype.includes('multipart/form-data')

  const response = await runtimeServerFetch(route.target, {
    method: 'POST',
    body: isMultipart ? form : new URLSearchParams(values).toString(),
    headers: forwardedHeaders(incoming, isMultipart ? undefined : route.enctype),
  })

  const payload = await readPayload(response)

  if (response.status < 300) {
    return runtimeRedirect(
      route.redirect ? resolveRedirect(route.redirect, payload) : pathname,
      303,
    )
  }

  // Failure: let the renderer produce this page inside the same event, then
  // restate the status on the way out.
  //
  // Measured: setting `event.res.status` before the renderer runs does not
  // survive, because the renderer builds its own response. Awaiting `next()`
  // and rewrapping is what puts the status back under this middleware's
  // control - and unlike rendering through a second internal request, the
  // middleware stack still runs exactly once for the browser's one request.
  const submission: EndpointNativeSubmission = {
    route: { method: 'post', path: route.target },
    status: response.status,
    issues: extractIssues(payload),
    values,
  }
  ;(event.context as Record<string, unknown>)[endpointNativeSubmissionKey] = submission

  const rendered = await next()
  if (!(rendered instanceof Response)) {
    // Nothing to restate; hand back whatever the renderer produced.
    return rendered
  }
  return new Response(rendered.body, {
    status: response.status,
    statusText: rendered.statusText,
    headers: rendered.headers,
  })
})
