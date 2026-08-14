export type NitroRouteHandlerDescriptor = {
  handler: string
  route?: string
  method?: string
  middleware?: boolean
}

export type NitroRouteHandlerSource = {
  scannedHandlers: NitroRouteHandlerDescriptor[]
  options: {
    handlers: NitroRouteHandlerDescriptor[]
  }
}

export type EndpointHandlerManifestDescriptor = {
  handler: string
  route: string
  method: string
}

export function collectNitroRouteHandlers(
  nitro: NitroRouteHandlerSource,
): NitroRouteHandlerDescriptor[] {
  return [...nitro.scannedHandlers, ...nitro.options.handlers]
}

export function generateEndpointHandlerManifest(
  handlers: readonly EndpointHandlerManifestDescriptor[],
): string {
  if (handlers.length === 0) {
    return 'export const handlers = []\n'
  }

  const entries = handlers.map(
    (handler) => `  {
    route: ${JSON.stringify(handler.route)},
    method: ${JSON.stringify(handler.method)},
    load: () => import(${JSON.stringify(normalizeImportPath(handler.handler))}).then((module) => module.default),
  }`,
  )

  return `export const handlers = [\n${entries.join(',\n')}\n]\n`
}

function normalizeImportPath(path: string): string {
  return path.replace(/\\/g, '/')
}
