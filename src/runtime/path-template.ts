// Single source of truth for the `:name` path parameter syntax used by both
// endpoint route templates (client-side substitution) and the generated
// OpenAPI document (`{name}` substitution and parameter extraction).

export function replacePathParams(path: string, replace: (name: string) => string): string {
  return path.replace(/:([^/]+)/g, (_, name: string) => replace(name))
}

export function pathParamNames(path: string): string[] {
  const names: string[] = []
  const pattern = /:([^/]+)/g
  let match = pattern.exec(path)
  while (match) {
    names.push(match[1])
    match = pattern.exec(path)
  }
  return names
}

export function isPathParamSegment(segment: string): boolean {
  return segment.startsWith(':')
}
