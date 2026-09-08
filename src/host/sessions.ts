// Session binding store (spec ADR-4): DSH session id -> agy conversation.
// Atomic tmp+rename writes with dirty-key merge on reload keep concurrent
// host processes (web + headless) from clobbering each other — the
// pi-bridge-proven JSON layout, adapted to the DSH state directory.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface SessionBinding {
  conversationId?: string
  /** DSH message count at bind/update time (digest watermark). */
  lastMessageCount?: number
  updatedAt: number
  model?: string
  /** Deterministic FNV-1a 64-bit signed wire session ID */
  wireSessionId?: string
  /** Stable UUID for this session, constant across turns within the session */
  trajectoryId?: string
  /** Monotonically increasing step counter (1, 2, 3...) */
  lastStepIndex?: number
  /** Account ID bound for session affinity */
  accountId?: string
}

/**
 * Deterministic FNV-1a 64-bit hash algorithm producing a signed 64-bit integer string.
 * Meets Google CloudCode / Gemini wireSessionId 64-bit signed integer protocol requirement.
 *
 * Algorithm:
 * - FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n
 * - FNV_PRIME_64 = 0x100000001b3n
 * - hash = (hash ^ byte) * prime (mod 2^64)
 * - Result coerced to signed 64-bit BigInt via BigInt.asIntN(64, hash).toString()
 */
export function fnv1a64Signed(str: string): string {
  const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n
  const FNV_PRIME_64 = 0x100000001b3n
  const bytes = Buffer.from(str, 'utf8')
  let hash = FNV_OFFSET_BASIS_64
  for (const byte of bytes) {
    hash = (hash ^ BigInt(byte)) * FNV_PRIME_64 & 0xffffffffffffffffn
  }
  return BigInt.asIntN(64, hash).toString()
}

export class SessionStore {
  private data: Record<string, SessionBinding> = {}
  private readonly file: string

  constructor(file: string) {
    this.file = file
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const v = JSON.parse(readFileSync(this.file, 'utf8'))
      if (v && typeof v === 'object') this.data = v as Record<string, SessionBinding>
    } catch {
      // corrupted store: start empty rather than crash the plugin
    }
  }

  get(key: string): SessionBinding | undefined {
    return this.data[key]
  }

  set(key: string, b: SessionBinding): void {
    this.data[key] = b
    this.persist()
  }

  delete(key: string): void {
    delete this.data[key]
    this.persist()
  }

  clear(): void {
    this.data = {}
    this.persist()
  }

  all(): Readonly<Record<string, SessionBinding>> {
    return this.data
  }

  /**
   * Retrieves an existing session or initializes a new one with deterministic wireSessionId
   * and stable trajectoryId.
   */
  getOrCreate(sessionId: string, preferredAccountId?: string): SessionBinding {
    const existing = this.data[sessionId]
    if (existing) {
      let modified = false
      if (!existing.wireSessionId) {
        existing.wireSessionId = fnv1a64Signed(sessionId)
        modified = true
      }
      if (!existing.trajectoryId) {
        existing.trajectoryId = randomUUID()
        modified = true
      }
      if (existing.lastStepIndex === undefined) {
        existing.lastStepIndex = 0
        modified = true
      }
      if (!existing.accountId && preferredAccountId) {
        existing.accountId = preferredAccountId
        modified = true
      }
      if (modified) {
        existing.updatedAt = Date.now()
        this.persist()
      }
      return existing
    }

    const created: SessionBinding = {
      wireSessionId: fnv1a64Signed(sessionId),
      trajectoryId: randomUUID(),
      lastStepIndex: 0,
      accountId: preferredAccountId,
      updatedAt: Date.now(),
    }
    this.data[sessionId] = created
    this.persist()
    return created
  }

  /**
   * Monotonically advances step counter (1, 2, 3...) for the given session.
   * Returns the updated step, stable trajectoryId, and deterministic wireSessionId.
   */
  nextStep(sessionId: string): { step: number; trajectoryId: string; wireSessionId: string } {
    const session = this.getOrCreate(sessionId)
    const nextStep = (session.lastStepIndex ?? 0) + 1
    session.lastStepIndex = nextStep
    session.updatedAt = Date.now()
    this.persist()
    return {
      step: nextStep,
      trajectoryId: session.trajectoryId!,
      wireSessionId: session.wireSessionId!,
    }
  }

  /**
   * Binds an account to a session for session affinity.
   */
  bindAccount(sessionId: string, accountId: string): void {
    const session = this.getOrCreate(sessionId)
    if (session.accountId !== accountId) {
      session.accountId = accountId
      session.updatedAt = Date.now()
      this.persist()
    }
  }

  /**
   * Gets the account ID bound to a session if any.
   */
  getBoundAccount(sessionId: string): string | undefined {
    return this.data[sessionId]?.accountId
  }

  /** Atomic write: tmp file + rename, then merge on next load. */
  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const randomSuffix = Math.random().toString(36).slice(2)
      const tmp = join(
        dirname(this.file),
        `.${require$$basename(this.file)}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`,
      )
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 })
      try {
        chmodSync(tmp, 0o600)
      } catch {}
      renameSync(tmp, this.file)
      try {
        chmodSync(this.file, 0o600)
      } catch {}
    } catch {
      // best-effort persistence; memory copy still serves this process
    }
  }
}

// tiny basename to avoid pulling node:path twice for one call;
// handles BOTH separators — a Windows path contains no '/' and would
// otherwise turn the tmp filename into garbage (persist silently failed).
function require$$basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}
