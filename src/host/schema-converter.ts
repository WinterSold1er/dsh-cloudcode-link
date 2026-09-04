import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { GeminiFunctionDeclaration } from './client.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function dereferenceSchema(
  schema: unknown,
  rootDefs: Record<string, unknown> = {},
  visited = new Set<unknown>(),
): unknown {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) {
    return schema.map((item) => dereferenceSchema(item, rootDefs, visited))
  }

  const s = schema as Record<string, unknown>
  if (visited.has(s)) return s
  visited.add(s)

  const defs: Record<string, unknown> = { ...rootDefs }
  if (isRecord(s.$defs)) Object.assign(defs, s.$defs)
  if (isRecord(s.definitions)) Object.assign(defs, s.definitions)

  if (typeof s.$ref === 'string') {
    const ref = s.$ref
    const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (match && match[1] && defs[match[1]] !== undefined) {
      const resolved = dereferenceSchema(defs[match[1]], defs, visited)
      if (isRecord(resolved)) {
        const { $ref: _, ...rest } = s
        const restCleaned = dereferenceSchema(rest, defs, visited)
        return isRecord(restCleaned) ? { ...resolved, ...restCleaned } : resolved
      }
      return resolved
    }
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(s)) {
    out[key] = dereferenceSchema(value, defs, visited)
  }
  return out
}

export function ensureRootObjectSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return { type: 'object', properties: {} }
  }
  if (!schema.type) {
    return { ...schema, type: 'object', properties: schema.properties || {} }
  }
  return schema
}

export function stripMetaSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const omit = new Set([
    '$schema',
    '$id',
    '$anchor',
    '$dynamicAnchor',
    '$vocabulary',
    '$comment',
    '$defs',
    'definitions',
  ])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!omit.has(key)) out[key] = stripMetaSchema(value)
  }
  return out
}

const CUSTOM_TOOL_SCHEMA_ALLOW = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
])

function normalizeCustomToolType(value: unknown): unknown {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const entries = value as unknown[]
  const scalar = entries.find(
    (entry): entry is string => typeof entry === 'string' && entry !== 'null',
  )
  return scalar
}

export function normalizeCustomToolSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(normalizeCustomToolSchema)

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!CUSTOM_TOOL_SCHEMA_ALLOW.has(key)) continue
    if (key === 'type') {
      const normalizedType = normalizeCustomToolType(value)
      if (normalizedType !== undefined) out.type = normalizedType
      continue
    }
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propName] = normalizeCustomToolSchema(propSchema)
      }
      out.properties = props
      continue
    }
    if (
      key === 'enum' &&
      Array.isArray(value) &&
      !value.every((entry) => typeof entry === 'string')
    ) {
      continue
    }
    out[key] = normalizeCustomToolSchema(value)
  }
  return out
}

/**
 * Convert DSH ToolSchema to Gemini functionDeclarations.
 * Gemini models accept JSON Schema through parametersJsonSchema.
 * Claude and GPT-OSS use parameters with allowlist.
 */
export function convertTools(
  tools: ToolSchema[] | undefined,
  useLegacyParameters = false,
): { functionDeclarations: GeminiFunctionDeclaration[] }[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return [
    {
      functionDeclarations: tools.map((tool) => {
        const dereferenced = dereferenceSchema(tool.parameters)
        const rootObject = ensureRootObjectSchema(dereferenced)
        const schema = stripMetaSchema(rootObject) as Record<string, unknown>
        return {
          name: tool.name,
          description: tool.description,
          ...(useLegacyParameters
            ? { parameters: normalizeCustomToolSchema(schema) as Record<string, unknown> }
            : { parametersJsonSchema: schema }),
        }
      }),
    },
  ]
}
