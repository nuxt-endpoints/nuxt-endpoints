import type { OpenApiDocument } from './openapi'

let openApiDocument: OpenApiDocument | undefined

export function setOpenApiDocument(document: OpenApiDocument): void {
  openApiDocument = document
}

export function getOpenApiDocument(): OpenApiDocument {
  if (!openApiDocument) {
    throw new Error('[nuxt-endpoints] OpenAPI document is not initialized.')
  }
  return openApiDocument
}
