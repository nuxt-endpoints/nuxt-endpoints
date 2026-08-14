import { isJsonSchema, type JsonSchema } from './common'

type JsonSchemaProvider = {
  readonly jsonSchema?: JsonSchema
  toJSONSchema?: () => JsonSchema
  toJsonSchema?: () => JsonSchema
}

export function getProvidedJsonSchema(schema: unknown): JsonSchema | undefined {
  const provider = schema as JsonSchemaProvider
  if (isJsonSchema(provider.jsonSchema)) {
    return provider.jsonSchema
  }
  if (provider.toJSONSchema) {
    return provider.toJSONSchema()
  }
  if (provider.toJsonSchema) {
    return provider.toJsonSchema()
  }
  return undefined
}
