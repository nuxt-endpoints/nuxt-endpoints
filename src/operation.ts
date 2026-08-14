export function extractOperation(fileContent: string): string | null {
  if (!hasEndpointDefinition(fileContent)) {
    return null
  }

  return fileContent.match(/\boperation\s*:\s*['"]([^'"]+)['"]/)?.[1] || null
}

export function hasEndpointDefinition(fileContent: string): boolean {
  return /\bdefineEndpoint\s*\(/.test(fileContent)
}

/**
 * Conservatively detects idempotency API usage when route-module evaluation
 * failed. False positives are preferable to silently dropping server policy.
 */
export function hasIdempotencyDeclaration(fileContent: string): boolean {
  return /\bidempotency\b/.test(fileContent)
}

export function assertEndpointSourceFallbackSafe(
  fileContent: string,
  handlerPath: string,
  evaluationError?: unknown,
): void {
  if (!hasIdempotencyDeclaration(fileContent)) {
    return
  }
  throw new Error(
    `[nuxt-endpoints] Could not evaluate idempotent endpoint ${handlerPath}. Idempotency metadata and server callbacks cannot be recovered safely by source parsing.`,
    { cause: evaluationError },
  )
}
