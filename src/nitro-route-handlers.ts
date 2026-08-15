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

export function collectNitroRouteHandlers(
  nitro: NitroRouteHandlerSource,
): NitroRouteHandlerDescriptor[] {
  return [...nitro.scannedHandlers, ...nitro.options.handlers]
}
