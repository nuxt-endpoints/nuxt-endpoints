import { defineNitroPlugin } from 'nitropack/runtime/plugin'

export function defineRuntimePlugin(plugin: () => void | Promise<void>): unknown {
  return defineNitroPlugin(plugin)
}
