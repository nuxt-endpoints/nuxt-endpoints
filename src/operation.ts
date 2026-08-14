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
    if (fileContent.slice(identifierStart, index) !== 'defineEndpoint') {
      continue
    }

    const previous = previousCodeCharacter(fileContent, identifierStart - 1)
    if (previous === '.' || isIdentifierPart(previous)) {
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

function skipTrivia(source: string, start: number): number {
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

function skipLineComment(source: string, start: number): number {
  const end = source.indexOf('\n', start)
  return end === -1 ? source.length : end + 1
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf('*/', start)
  return end === -1 ? source.length : end + 2
}

function skipQuotedValue(source: string, start: number, quote: string): number {
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

function previousCodeCharacter(source: string, start: number): string | undefined {
  let index = start
  while (index >= 0 && /\s/.test(source[index])) {
    index -= 1
  }
  return source[index]
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Z_a-z$]/.test(character)
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[\w$]/.test(character)
}
