// Checks the Type Playground's miniature type declarations.
//
// The playground runs a real TypeScript compiler in the browser, and it cannot
// load this package's actual `.d.ts` graph — that would drag in Nuxt, Nitro, h3
// and the schema libraries, none of which resolve in the virtual filesystem.
// So `endpointTypeSource` inside `TypePlayground.vue` is a hand-written model of
// the real types, and a model drifts silently when the real API moves: the
// single-define form shipped while the model still only knew the two-call form,
// and nothing failed.
//
// This runs the same compiler over the same presets and asserts each one still
// produces the diagnostics its UI copy promises. It cannot prove the model
// agrees with the real types — only that the model still behaves as documented,
// which is what silently broke.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const componentPath = join(siteDir, 'app/components/TypePlayground.vue')
const component = readFileSync(componentPath, 'utf8')

// Each preset: the label shown in the UI, the two snippet variables it renders,
// and how many diagnostics that combination is supposed to report.
const presets = [
  { label: 'Valid', server: 'defaultServerCode', client: 'defaultClientCode', expected: 0 },
  {
    label: 'Infer from handler',
    server: 'inferServerCode',
    client: 'inferClientCode',
    expected: 0,
  },
  {
    label: 'Infer from schema',
    server: 'schemaServerCode',
    client: 'inferClientCode',
    expected: 1,
  },
]

function templateLiteral(name) {
  const declaration = component.indexOf(`const ${name} = \``)
  if (declaration === -1) {
    throw new Error(`${name} is no longer declared in TypePlayground.vue`)
  }

  const start = component.indexOf('`', declaration) + 1
  let index = start

  // Walk to the first unescaped backtick. These snippets contain \` inside
  // comments, so searching for the next backtick swallows the rest of the file.
  while (index < component.length) {
    if (component[index] === '\\') {
      index += 2
      continue
    }
    if (component[index] === '`') {
      break
    }
    index += 1
  }

  return component.slice(start, index).replaceAll('\\`', '`').replaceAll('\\$', '$')
}

function diagnose(serverSource, clientSource) {
  const files = {
    '/playground/lib.d.ts': templateLiteral('minimalLibSource'),
    '/playground/types.d.ts': templateLiteral('endpointTypeSource'),
    '/playground/server.ts': serverSource,
    '/playground/client.ts': `${clientSource}\nexport {}`,
  }

  // Kept in step with `collectDiagnostics` in the component.
  const compilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  }

  const host = {
    fileExists: (fileName) => fileName in files,
    readFile: (fileName) => files[fileName],
    getSourceFile: (fileName, languageVersion) =>
      fileName in files
        ? ts.createSourceFile(fileName, files[fileName], languageVersion, true)
        : undefined,
    getDefaultLibFileName: () => '/playground/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/playground',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }

  const program = ts.createProgram(Object.keys(files), compilerOptions, host)

  return ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        diagnostic.file?.fileName === '/playground/server.ts' ||
        diagnostic.file?.fileName === '/playground/client.ts',
    )
}

let failed = false

for (const preset of presets) {
  const diagnostics = diagnose(templateLiteral(preset.server), templateLiteral(preset.client))
  const ok = diagnostics.length === preset.expected

  if (!ok) {
    failed = true
  }

  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${preset.label.padEnd(20)} expected ${preset.expected} diagnostic(s), got ${diagnostics.length}`,
  )

  for (const diagnostic of diagnostics) {
    const where = diagnostic.file.fileName.replace('/playground/', '')
    console.log(`       ${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
  }
}

if (failed) {
  console.error(
    '\nThe playground type model no longer matches its presets. Update `endpointTypeSource` in TypePlayground.vue.',
  )
  process.exitCode = 1
} else {
  console.log(`playground type model checks clean (${presets.length} presets)`)
}
