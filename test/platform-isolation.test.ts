import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `src/runtime/platform/` is the seam: everything the runtime needs from h3
// and Nitro lives there, so an h3 or Nitro major is absorbed by editing that
// directory and nothing else. The claim only stays true while imports cannot
// creep back out — which nothing type-checks, since importing h3 elsewhere is
// perfectly valid TypeScript. This pins it instead.
const runtimeDirectory = fileURLToPath(new URL('../src/runtime', import.meta.url))

// The Nitro plugin wrapper is the one documented exception: server-plugin.ts
// is 195 lines of startup logic whose only platform touch is `defineNitroPlugin`,
// and moving the whole file into the seam would bury the seam in bootstrapping.
const nitroExceptions = new Set(['server-plugin.ts'])

function sourceFiles(directory: string, prefix = ''): { name: string; content: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return sourceFiles(join(directory, entry.name), `${prefix}${entry.name}/`)
    }
    if (!entry.name.endsWith('.ts')) {
      return []
    }
    return [
      {
        name: `${prefix}${entry.name}`,
        content: readFileSync(join(directory, entry.name), 'utf8'),
      },
    ]
  })
}

describe('the platform seam', () => {
  const files = sourceFiles(runtimeDirectory)

  it('is the only place that imports h3', () => {
    const offenders = files
      .filter(({ name }) => !name.startsWith('platform/'))
      .filter(({ content }) => /from 'h3'/.test(content))
      .map(({ name }) => name)

    expect(offenders, 'h3 imports outside src/runtime/platform/').toEqual([])
  })

  it('is the only place that imports nitropack, except the plugin wrapper', () => {
    const offenders = files
      .filter(({ name }) => !name.startsWith('platform/') && !nitroExceptions.has(name))
      .filter(({ content }) => /from 'nitropack/.test(content))
      .map(({ name }) => name)

    expect(offenders, 'nitropack imports outside src/runtime/platform/').toEqual([])
  })
})
