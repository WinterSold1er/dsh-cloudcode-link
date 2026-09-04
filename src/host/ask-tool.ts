// agy_ask — one-shot delegation tool so any DSH model can consult an Antigravity model.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Catalog } from './models.ts'
import { findEntry } from './models.ts'
import type { OneShotDeps } from './oneshot.ts'
import { runAgyOnce } from './oneshot.ts'

const ALIASES: Readonly<Record<string, string>> = {
  flash: 'gemini',
  pro: 'gemini',
  gemini: 'gemini',
  sonnet: 'claude',
  opus: 'claude',
  claude: 'claude',
  'gpt-oss': 'gpt-oss',
  oss: 'gpt-oss',
}

export function resolveAskModel(
  input: string,
  catalog: Catalog,
  defaultModel: string,
): string {
  const q = input.trim().toLowerCase()
  if (q === '') return defaultModel
  const ids = catalog.models.map((m) => m.id)
  if (ids.includes(q)) return q
  const prefix = ALIASES[q] ?? q.replace(/\s+/g, '-')
  let level = ''
  for (const eff of ['high', 'medium', 'low']) {
    if (q.endsWith(' ' + eff) || q.endsWith('-' + eff)) level = eff
  }
  const base = level !== '' ? prefix.replace(/-?(high|medium|low)$/, '') : prefix
  const candidates = ids.filter((id) => id.startsWith(base))
  if (candidates.length === 0) return defaultModel !== '' ? defaultModel : q
  const sorted = candidates.slice().sort(compareNatural)
  const last = sorted[sorted.length - 1] ?? q
  if (level === '') return last
  const exact = sorted.find((id) => id.endsWith('-' + level))
  return exact ?? last
}

function compareNatural(a: string, b: string): number {
  const na = a.split(/(\d+)/)
  const nb = b.split(/(\d+)/)
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const x = na[i] ?? ''
    const y = nb[i] ?? ''
    const xn = Number(x)
    const yn = Number(y)
    if (Number.isFinite(xn) && Number.isFinite(yn) && x !== '' && y !== '') {
      if (xn !== yn) return xn - yn
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export function defineAgyAskTool(deps: OneShotDeps & { catalog: () => Catalog }) {
  return defineTool({
    name: 'agy_ask',
    description: 'Delegate a one-shot task to a Google Antigravity model via direct CloudCode API. Returns the final answer text.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The task or question for the Antigravity model.',
      },
      model: {
        type: 'string',
        description: 'Model to ask: flash, pro, gemini, sonnet, opus, gpt-oss, or an exact slug (default: the bridge default model).',
      },
      effort: {
        type: 'string',
        description: 'Reasoning effort for effort-capable models: low, medium, or high.',
      },
      mode: {
        type: 'string',
        description: 'Execution mode (optional).',
      },
      timeoutMinutes: {
        type: 'number',
        description: 'Optional timeout budget in minutes (default 10).',
      },
      readPaths: {
        type: 'string',
        description: 'Optional space/comma-separated text files to inline into the prompt (workspace-relative or absolute; binaries are skipped with a note).',
      },
      schema: {
        type: 'string',
        description: 'Optional JSON Schema enforcing the final answer.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 15 * 60_000,
    async execute(args, exec) {
      const cfg = deps.cfg()
      const model = resolveAskModel(args.model ?? '', deps.catalog(), cfg.defaultModel)
      let parsedSchema: unknown
      if (typeof args.schema === 'string' && args.schema.trim() !== '') {
        try {
          parsedSchema = JSON.parse(args.schema)
        } catch (e) {
          throw new Error('agy_ask: schema is not valid JSON: ' + String(e))
        }
      }
      const readPaths = typeof args.readPaths === 'string' && args.readPaths.trim() !== ''
        ? args.readPaths.split(/[ ,]+/).filter(Boolean)
        : []

      const effort = args.effort

      const res = await runAgyOnce(deps, {
        prompt: args.prompt,
        model,
        effort,
        mode: args.mode,
        timeoutMs: typeof args.timeoutMinutes === 'number' && args.timeoutMinutes > 0
          ? args.timeoutMinutes * 60_000
          : undefined,
        signal: exec.signal,
        readPaths,
        schema: parsedSchema,
      })

      if (!res.ok) {
        throw new Error(res.error || 'agy_ask failed')
      }
      return res.text
    },
  })
}
