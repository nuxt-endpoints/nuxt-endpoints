/** Shared, framework-free mechanics used by both native and enhanced forms. */

export type FormValidationIssue = {
  path?: (string | number)[]
  message: string
  code?: string
  [key: string]: unknown
}

export const endpointNativeSubmissionKey = '__nuxtEndpointsForm'

/** Extracts every validator issue from an endpoint validation problem body. */
export function extractFormIssues(payload: unknown): FormValidationIssue[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') {
    return []
  }
  const issues: FormValidationIssue[] = []
  for (const group of Object.values(data as Record<string, unknown>)) {
    if (!Array.isArray(group)) {
      continue
    }
    for (const issue of group as Record<string, unknown>[]) {
      issues.push({
        ...issue,
        message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
      } as FormValidationIssue)
    }
  }
  return issues
}

/** Expands response-body placeholders as URL-encoded path values. */
export function resolveFormRedirectTemplate(
  template: string,
  body: Record<string, unknown>,
): string {
  return template.replace(/\{([^}]+)\}/g, (whole, key: string) => {
    const value = body[key]
    // Only a scalar can stand in for a path segment; anything else would
    // stringify into `[object Object]` and produce a broken URL.
    return typeof value === 'string' || typeof value === 'number'
      ? encodeURIComponent(String(value))
      : whole
  })
}

/** Repeated names become arrays, matching URL and form parsing semantics. */
export function collectRepeatedEntries(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  const collected: Record<string, unknown> = {}
  for (const [name, value] of entries) {
    const existing = collected[name]
    if (existing === undefined) {
      collected[name] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      collected[name] = [existing, value]
    }
  }
  return collected
}
