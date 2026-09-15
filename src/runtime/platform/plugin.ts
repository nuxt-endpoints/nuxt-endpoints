import { definePlugin } from 'nitro'

export function defineRuntimePlugin(plugin: () => void | Promise<void>): unknown {
  return definePlugin(plugin as never)
}
