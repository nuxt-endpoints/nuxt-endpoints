import { findStaticImports, parseStaticImport } from 'mlly'
import type { StaticImport } from 'mlly'

export type EndpointContractAnalysis =
  | { kind: 'none' }
  | { kind: 'co-located' }
  | { kind: 'unresolved' }
  | { kind: 'imported'; specifier: string; importedName: string }

export type ContractModuleLoaders = {
  loadModule: (path: string) => Promise<{ module?: unknown; error?: unknown }>
  resolveImport: (specifier: string, parentPath: string) => string | undefined
}

export type EndpointCarrierSource =
  | { kind: 'skip' }
  | { kind: 'route-module' }
  | { kind: 'contract'; carrier: unknown }

export function analyzeEndpointContractSource(fileContent: string): EndpointContractAnalysis {
  if (hasEndpointDefinition(fileContent)) {
    return { kind: 'co-located' }
  }

  const handlerArgument = findEndpointHandlerArgument(fileContent)
  if (handlerArgument.kind === 'none') {
    return { kind: 'none' }
  }
  if (handlerArgument.kind === 'unresolved') {
    return { kind: 'unresolved' }
  }

  const imported = buildLocalImportMap(fileContent).get(handlerArgument.name)
  if (!imported) {
    return { kind: 'unresolved' }
  }

  return { kind: 'imported', specifier: imported.specifier, importedName: imported.importedName }
}

export async function resolveEndpointCarrierSource(
  fileContent: string,
  routePath: string,
  loaders: ContractModuleLoaders,
): Promise<EndpointCarrierSource> {
  const analysis = analyzeEndpointContractSource(fileContent)

  if (analysis.kind === 'none') {
    return { kind: 'skip' }
  }
  if (analysis.kind === 'co-located' || analysis.kind === 'unresolved') {
    return { kind: 'route-module' }
  }

  const { specifier, importedName } = analysis
  const contractPath = loaders.resolveImport(specifier, routePath)
  if (!contractPath) {
    throw new Error(
      `[nuxt-endpoints] Route ${routePath} imports its endpoint from "${specifier}", which could not be resolved during Nuxt type generation.`,
    )
  }

  const loadResult = await loaders.loadModule(contractPath)
  if (loadResult.error) {
    throw new Error(
      `[nuxt-endpoints] Could not evaluate endpoint contract module ${contractPath} (imported by ${routePath}). Keep contract-module top-level code side-effect free and ensure its imports resolve during Nuxt type generation.`,
      { cause: loadResult.error },
    )
  }

  const carrier = readExportedMember(loadResult.module, importedName)
  if (!isEndpointCarrierCandidate(carrier)) {
    throw new Error(
      `[nuxt-endpoints] Route ${routePath} passes "${importedName}" imported from "${specifier}" to defineEndpointHandler(), but it does not expose endpoint metadata. Export the result of defineEndpoint() from the contract module.`,
    )
  }

  return { kind: 'contract', carrier }
}

export function hasEndpointDefinition(fileContent: string): boolean {
  let index = 0
  while (index < fileContent.length) {
    const character = fileContent[index]
    const next = fileContent[index + 1]

    if (character === '/' && next === '/') {
      index = skipLineComment(fileContent, index + 2)
      continue
    }
    if (character === '/' && next === '*') {
      index = skipBlockComment(fileContent, index + 2)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedValue(fileContent, index + 1, character)
      continue
    }
    if (!isIdentifierStart(character)) {
      index += 1
      continue
    }

    const identifierStart = index
    index += 1
    while (index < fileContent.length && isIdentifierPart(fileContent[index])) {
      index += 1
    }
    const identifier = fileContent.slice(identifierStart, index)
    // `defineEndpointMethods(` is included alongside `defineEndpoint(` so an
    // inline method group (`defineEndpointMethods({...})` declared in the
    // same route file as its `defineEndpointMethodHandlers()` call) is
    // detected as co-located, exactly like a single inline `defineEndpoint()`.
    // The identifier scan above always consumes a full token before this
    // comparison runs, so `defineEndpointMethodHandlers` (which contains
    // `defineEndpointMethods` as a prefix) never matches here by accident —
    // covered by a dedicated regression test.
    if (identifier !== 'defineEndpoint' && identifier !== 'defineEndpointMethods') {
      continue
    }

    const previous = previousCodeCharacter(fileContent, identifierStart - 1)
    // A preceding identifier still disqualifies the match (it is
    // how this library's own `export function defineEndpoint(...)` declaration
    // is excluded), with one exception - `export default defineEndpoint({...})`,
    // which is the single-define form's route shape. Without this exception the
    // merged form is silently classified `{ kind: 'none' }` and every merged
    // route is dropped from codegen with no error at all.
    if (
      previous === '.' ||
      (isIdentifierPart(previous) &&
        previousCodeWord(fileContent, identifierStart - 1) !== 'default')
    ) {
      continue
    }

    index = skipTrivia(fileContent, index)
    if (fileContent[index] === '(') {
      return true
    }
  }

  return false
}

export function assertEndpointModuleEvaluated(
  fileContent: string,
  handlerPath: string,
  evaluationError?: unknown,
): void {
  if (!hasEndpointDefinition(fileContent)) {
    return
  }

  if (evaluationError) {
    throw new Error(
      `[nuxt-endpoints] Could not evaluate endpoint route ${handlerPath}. Endpoint metadata cannot be recovered safely from source. Keep route-module top-level code lightweight and ensure its imports resolve during Nuxt type generation.`,
      { cause: evaluationError },
    )
  }

  throw new Error(
    `[nuxt-endpoints] Route ${handlerPath} calls defineEndpoint(), but its evaluated exports did not expose endpoint metadata. Export the endpoint definition and pass it to defineEndpointHandler().`,
  )
}

type HandlerArgumentAnalysis =
  | { kind: 'none' }
  | { kind: 'unresolved' }
  | { kind: 'identifier'; name: string }

function findEndpointHandlerArgument(fileContent: string): HandlerArgumentAnalysis {
  let index = 0
  while (index < fileContent.length) {
    const character = fileContent[index]
    const next = fileContent[index + 1]

    if (character === '/' && next === '/') {
      index = skipLineComment(fileContent, index + 2)
      continue
    }
    if (character === '/' && next === '*') {
      index = skipBlockComment(fileContent, index + 2)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuotedValue(fileContent, index + 1, character)
      continue
    }
    if (!isIdentifierStart(character)) {
      index += 1
      continue
    }

    const identifierStart = index
    index += 1
    while (index < fileContent.length && isIdentifierPart(fileContent[index])) {
      index += 1
    }
    const identifier = fileContent.slice(identifierStart, index)
    // `defineEndpointMethodHandlers(` is included alongside
    // `defineEndpointHandler(` so a method group's handler map — its first
    // argument, the `defineEndpointMethods()` return value — is discovered
    // the same way a single endpoint's contract argument is.
    if (identifier !== 'defineEndpointHandler' && identifier !== 'defineEndpointMethodHandlers') {
      continue
    }

    // Unlike `defineEndpoint(`, `defineEndpointHandler(` is almost always
    // preceded by the `export default` keyword pair, so only a preceding
    // `.` (member access, e.g. `factory.defineEndpointHandler(`) disqualifies
    // the match here; a preceding identifier is just an unrelated token.
    const previous = previousCodeCharacter(fileContent, identifierStart - 1)
    if (previous === '.') {
      continue
    }

    index = skipTrivia(fileContent, index)
    if (fileContent[index] !== '(') {
      continue
    }
    index = skipTrivia(fileContent, index + 1)

    if (!isIdentifierStart(fileContent[index])) {
      return { kind: 'unresolved' }
    }
    const argumentStart = index
    index += 1
    while (index < fileContent.length && isIdentifierPart(fileContent[index])) {
      index += 1
    }
    const argumentName = fileContent.slice(argumentStart, index)

    const afterArgument = skipTrivia(fileContent, index)
    if (fileContent[afterArgument] !== ',') {
      return { kind: 'unresolved' }
    }

    return { kind: 'identifier', name: argumentName }
  }

  return { kind: 'none' }
}

type LocalImportBinding = { specifier: string; importedName: string }

function buildLocalImportMap(fileContent: string): Map<string, LocalImportBinding> {
  const bindings = new Map<string, LocalImportBinding>()

  for (const staticImport of findStaticImports(fileContent)) {
    if (isTypeOnlyImportStatement(staticImport)) {
      continue
    }

    const parsed = parseStaticImport(staticImport)
    if (parsed.defaultImport) {
      bindings.set(parsed.defaultImport, { specifier: parsed.specifier, importedName: 'default' })
    }
    for (const [importedName, localName] of Object.entries(parsed.namedImports || {})) {
      bindings.set(localName, { specifier: parsed.specifier, importedName })
    }
  }

  return bindings
}

// mlly's `findStaticImports` matches `import type { ... }` as an ordinary
// static import (its default/named-import parsing is unaware of the
// statement-level `type` keyword), so whole-statement type-only imports have
// to be filtered out here. Per-specifier `{ type A, endpoint }` markers are
// already excluded by `parseStaticImport` itself.
function isTypeOnlyImportStatement(staticImport: StaticImport): boolean {
  return /^\s*type\s/.test(staticImport.imports)
}

function readExportedMember(module: unknown, importedName: string): unknown {
  if (typeof module !== 'object' || module === null) {
    return undefined
  }
  const exports = module as Record<string, unknown>
  return importedName === 'default' ? exports.default : exports[importedName]
}

// Accepts both carrier shapes an imported contract module can export: a
// single `defineEndpoint()` result (`definition`) and a
// `defineEndpointMethods()` group (`__endpoint_methods__: true`, `methods`).
function isEndpointCarrierCandidate(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('definition' in value ||
      (value as { __endpoint_methods__?: unknown }).__endpoint_methods__ === true)
  )
}

export function skipTrivia(source: string, start: number): number {
  let index = start
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index + 2)
      continue
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index + 2)
      continue
    }
    break
  }
  return index
}

export function skipLineComment(source: string, start: number): number {
  const end = source.indexOf('\n', start)
  return end === -1 ? source.length : end + 1
}

export function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf('*/', start)
  return end === -1 ? source.length : end + 2
}

export function skipQuotedValue(source: string, start: number, quote: string): number {
  let index = start
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) {
      return index + 1
    }
    index += 1
  }
  return source.length
}

export function previousCodeCharacter(source: string, start: number): string | undefined {
  let index = start
  while (index >= 0 && /\s/.test(source[index])) {
    index -= 1
  }
  return source[index]
}

// The whole identifier token immediately before `start`, skipping whitespace.
// `undefined` when the preceding code character is not part of an identifier.
export function previousCodeWord(source: string, start: number): string | undefined {
  let index = start
  while (index >= 0 && /\s/.test(source[index])) {
    index -= 1
  }
  if (!isIdentifierPart(source[index])) {
    return undefined
  }
  const end = index
  while (index >= 0 && isIdentifierPart(source[index])) {
    index -= 1
  }
  return source.slice(index + 1, end + 1)
}

export function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Z_a-z$]/.test(character)
}

export function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[\w$]/.test(character)
}
