// Model-panel data layer for the CloudCode Link settings UI.
//
// Data flow (kept honest, never silently synthetic):
//   1. GET  {api}/pool/account-models?id=<id>  -> AccountModelsPayload (source: 'api')
//   2. POST {api}/pool/account-models {id, refresh: true} -> refreshed payload; a failed
//      refresh still answers 200 with the previous data + `refreshError` (we surface it and
//      keep rendering the old list).
//   3. When the endpoint answers 404 / network-fails, the panel falls back to the model
//      list embedded in status.pool.accounts[].quotas (source: 'quota-fallback') and the
//      UI labels the source explicitly. Panel data is never cleared on a failed refresh
//      OR a failed initial load: whatever payload a panel carries keeps rendering (any
//      status) until a successful fetch replaces it, and its `source` label follows the
//      payload, never the last fetch attempt.
//
// Cross-account diff (灰度差异) is computed from the discovered-model union:
// models present only in this account are marked 「独有」, models another account also
// has are marked 「其它账号也支持」, and each account shows a coverage count n/union.

import type { ManagedAccount } from '../common/pool-types.ts';

export type ModelFamilyKey = 'google' | 'anthropic' | 'openai' | 'unknown';

export interface AccountModelEntry {
	id: string;
	name: string;
	family: ModelFamilyKey;
	remainingFraction?: number;
	resetTime?: string;
}

export interface AccountFamilyGroup {
	family: ModelFamilyKey;
	known: boolean;
	models: AccountModelEntry[];
}

export interface AccountModelsPayload {
	ok?: boolean;
	id?: string;
	alias?: string;
	email?: string;
	known: boolean;
	total: number;
	refreshedAt: number | null;
	familyModels: AccountFamilyGroup[];
	refreshError?: string;
}

export interface ModelPanelState {
	status: 'idle' | 'loading' | 'ok' | 'error';
	/** Last good payload. A failed (re)load never clears it. */
	payload: AccountModelsPayload | null;
	source: 'api' | 'quota-fallback';
	error: string | null;
	refreshError: string | null;
	fetchedAt: number | null;
}

export const EMPTY_PANEL: ModelPanelState = {
	status: 'idle',
	payload: null,
	source: 'quota-fallback',
	error: null,
	refreshError: null,
	fetchedAt: null,
};

export interface AccountModelsResult {
	payload: AccountModelsPayload | null;
	error: string | null;
	status: number | null;
}

export type JsonFetcher = (
	urlPath: string,
	options?: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> } | null>;

const QUOTA_FAMILY_ORDER = ['google', 'anthropic', 'openai'] as const;

function parsePayload(raw: unknown): AccountModelsPayload | null {
	if (!raw || typeof raw !== 'object') return null;
	const data = raw as Record<string, unknown>;
	const familyModels = Array.isArray(data.familyModels) ? (data.familyModels as AccountFamilyGroup[]) : [];
	return {
		ok: typeof data.ok === 'boolean' ? data.ok : true,
		id: typeof data.id === 'string' ? data.id : undefined,
		alias: typeof data.alias === 'string' ? data.alias : undefined,
		email: typeof data.email === 'string' ? data.email : undefined,
		known: data.known === true,
		total: typeof data.total === 'number' ? data.total : familyModels.reduce((n, g) => n + g.models.length, 0),
		refreshedAt: typeof data.refreshedAt === 'number' ? data.refreshedAt : null,
		familyModels,
		refreshError: typeof data.refreshError === 'string' ? data.refreshError : undefined,
	};
}

async function readResult(res: { ok: boolean; status: number; json(): Promise<unknown> } | null): Promise<AccountModelsResult> {
	if (!res) return { payload: null, error: 'network_unreachable', status: null };
	if (res.status === 404) return { payload: null, error: 'account_not_found', status: 404 };
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		return { payload: null, error: 'bad_json', status: res.status };
	}
	if (!res.ok) {
		const msg = body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string'
			? (body as Record<string, unknown>).error as string
			: `http_${res.status}`;
		return { payload: null, error: msg, status: res.status };
	}
	const payload = parsePayload(body);
	if (!payload) return { payload: null, error: 'bad_payload', status: res.status };
	return { payload, error: null, status: res.status };
}

/** GET the discovered model list for one account. */
export async function fetchAccountModels(fetchJson: JsonFetcher, apiPrefix: string, id: string): Promise<AccountModelsResult> {
	const res = await fetchJson(`${apiPrefix}/pool/account-models?id=${encodeURIComponent(id)}`);
	return readResult(res);
}

/** POST a forced rediscovery for one account; on failure callers keep the previous panel data. */
export async function postAccountModelsRefresh(fetchJson: JsonFetcher, apiPrefix: string, id: string): Promise<AccountModelsResult> {
	const res = await fetchJson(`${apiPrefix}/pool/account-models`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ id, refresh: true }),
	});
	return readResult(res);
}

/**
 * Build the same payload shape from the quota data embedded in status.pool, so the panel
 * can degrade gracefully when /pool/account-models is unavailable. The UI always labels
 * this source as a fallback.
 */
export function buildQuotaFallbackPayload(acc: ManagedAccount): AccountModelsPayload {
	const familyModels: AccountFamilyGroup[] = [];
	for (const family of QUOTA_FAMILY_ORDER) {
		const quota = acc.quotas[family];
		if (!quota || !Array.isArray(quota.models) || quota.models.length === 0) continue;
		const models = quota.models
			.filter((m) => typeof m.modelId === 'string' && m.modelId.trim() !== '')
			.map((m) => ({
				id: m.modelId,
				name: m.displayName || m.modelId,
				family,
				remainingFraction: m.remainingFraction,
				resetTime: m.resetTime,
			}));
		if (models.length === 0) continue;
		familyModels.push({ family, known: true, models });
	}
	return {
		ok: true,
		id: acc.id,
		alias: acc.alias,
		email: acc.email,
		known: familyModels.length > 0,
		total: familyModels.reduce((n, g) => n + g.models.length, 0),
		refreshedAt: null,
		familyModels,
	};
}

/**
 * Pick the payload a panel should render. Any panel that carries a payload uses it —
 * regardless of the panel's current status (ok / loading / error): a failed (re)load
 * must never make the UI silently drop models it already discovered. Only a panel with
 * `payload == null` falls back to the quota-embedded list.
 * `usingFallback` always describes the payload actually returned, never the fetch attempt.
 */
export interface PanelPayloadSelection {
	payload: AccountModelsPayload;
	/** True when the returned payload is quota-derived rather than API-discovered. */
	usingFallback: boolean;
}

export function selectPanelPayload(panel: ModelPanelState | undefined, acc: ManagedAccount): PanelPayloadSelection {
	if (panel?.payload) {
		return { payload: panel.payload, usingFallback: panel.source !== 'api' };
	}
	return { payload: buildQuotaFallbackPayload(acc), usingFallback: true };
}

/** Discovered model ids for one account (last payload if any, quota fallback otherwise). */
export function accountModelIds(acc: ManagedAccount, panel: ModelPanelState | undefined): string[] {
	const { payload } = selectPanelPayload(panel, acc);
	const ids: string[] = [];
	for (const group of payload.familyModels) {
		for (const model of group.models) ids.push(model.id);
	}
	return ids;
}

/**
 * Panel state after a failed initial GET: the previous payload and its source are kept
 * (an empty panel stays an empty panel); the error is recorded for the visible strip.
 */
export function markPanelLoadFailure(prev: ModelPanelState, error: string, now: number): ModelPanelState {
	return { ...prev, status: 'error', payload: prev.payload, source: prev.source, error, refreshError: null, fetchedAt: now };
}

/** Panel state after a failed POST refresh: same payload preservation plus the refreshError marker. */
export function markPanelRefreshFailure(prev: ModelPanelState, error: string, now: number): ModelPanelState {
	return { ...prev, status: 'error', payload: prev.payload, source: prev.source, error, refreshError: error, fetchedAt: now };
}

/** Panel state after a successful fetch (GET or refresh): the fresh payload becomes the panel's truth. */
export function markPanelSuccess(prev: ModelPanelState, payload: AccountModelsPayload, refreshError: string | null, now: number): ModelPanelState {
	return {
		...prev,
		status: 'ok',
		payload,
		source: 'api',
		error: null,
		refreshError,
		fetchedAt: now,
	};
}

/** A loaded panel is considered fresh for this long before on-demand rediscovery re-triggers. */
export const PANEL_TTL_MS = 60_000;

/**
 * Which accounts the auto-load effect should (re)load right now:
 * - panels never loaded (missing / idle), and
 * - healthy panels whose data exceeded the TTL.
 * 'loading' and 'error' panels are deliberately excluded: a broken endpoint is retried
 * only by an explicit user action, never implicitly on every status-poll reference change.
 */
export function collectStalePanelAccounts(
	panels: Record<string, ModelPanelState>,
	accounts: ManagedAccount[],
	now: number,
	ttlMs: number = PANEL_TTL_MS,
): ManagedAccount[] {
	return accounts.filter((acc) => {
		const panel = panels[acc.id];
		if (!panel || panel.status === 'idle') return true;
		if (panel.status === 'loading' || panel.status === 'error') return false;
		return panel.fetchedAt !== null && now - panel.fetchedAt > ttlMs;
	});
}

/** Single source of truth for the expandable model panel's DOM id (aria-controls wiring). */
export function modelsPanelDomId(accId: string): string {
	return `models-panel-${accId}`;
}

/** Human-readable reset window: absolute clock + remaining countdown, weekly vs 5h aware. */
export function formatQuotaWindow(resetTimeStr: string | undefined, nowMs: number = Date.now()): {
	resetText: string;
} {
	if (!resetTimeStr) return { resetText: '' };
	try {
		const d = new Date(resetTimeStr);
		const diffMs = d.getTime() - nowMs;
		// Invalid upstream timestamps yield NaN: treat them as "unknown", never render NaN:NaN.
		if (!Number.isFinite(diffMs) || diffMs <= 0) return { resetText: '' };

		const totalMins = Math.ceil(diffMs / 60000);
		const days = Math.floor(totalMins / 1440);
		const hours = Math.floor((totalMins % 1440) / 60);
		const mins = totalMins % 60;
		const isWeekly = days >= 1;

		const countdown = days > 0 ? `${days}d${hours}h` : hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
		const hh = d.getHours().toString().padStart(2, '0');
		const mm = d.getMinutes().toString().padStart(2, '0');
		const resetText = isWeekly
			? `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm} (${countdown})`
			: `${hh}:${mm} (${countdown})`;

		return { resetText };
	} catch {
		// Unparseable reset window from upstream: degrade to "unknown", never crash the card.
		return { resetText: '' };
	}
}

/** Size of the discovered-model union across all accounts (the denominator of coverage). */
export function computeModelUnion(panels: Record<string, ModelPanelState>, accounts: ManagedAccount[]): number {
	const union = new Set<string>();
	for (const acc of accounts) {
		for (const id of accountModelIds(acc, panels[acc.id])) union.add(id);
	}
	return union.size;
}

/** Model ids that at least one *other* account also supports. */
export function computeOtherAccountModelIds(panels: Record<string, ModelPanelState>, accounts: ManagedAccount[], accId: string): Set<string> {
	const others = new Set<string>();
	for (const acc of accounts) {
		if (acc.id === accId) continue;
		for (const id of accountModelIds(acc, panels[acc.id])) others.add(id);
	}
	return others;
}
