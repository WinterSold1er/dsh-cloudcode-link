// dsh-cloudcode-link client half (browser).
// Single product entry: the DSH settings page (Gear -> Antigravity). The chat header no
// longer carries any plugin button — status access, account management, model coverage,
// usage stats, diagnostics and config all live behind the settings.section entry.
import type { Context } from '@deepseek-ai/cordis';
import type { AccountPoolData, FamilyQuotaInfo, ManagedAccount } from '../common/pool-types.ts';
import { BRAND_COLORS, BRAND_PATHS, UI_PATHS } from './brand-icons.ts';
import { S, THEME_CSS } from './theme.ts';
import {
	EMPTY_PANEL,
	accountModelIds,
	collectStalePanelAccounts,
	computeModelUnion,
	computeOtherAccountModelIds,
	fetchAccountModels,
	formatQuotaWindow,
	markPanelLoadFailure,
	markPanelRefreshFailure,
	markPanelSuccess,
	modelsPanelDomId,
	postAccountModelsRefresh,
	selectPanelPayload,
	type ModelFamilyKey,
	type ModelPanelState,
} from './account-models.ts';
import { accountAddFlowView, applyPollOutcome, seedConfigDrafts } from './poll-state.ts';

type ReactApi = {
	createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
	useState: <S0>(initial: S0) => [S0, (next: S0 | ((prev: S0) => S0)) => void];
	useEffect: (setup: () => (() => void) | void, deps?: unknown[]) => void;
	useRef: <S0>(initial: S0) => { current: S0 };
};
const R = require('react') as ReactApi;
const { createElement: h, useState, useEffect, useRef } = R;

const reactDom = require('react-dom') as {
	createPortal?: (node: unknown, container: unknown) => unknown;
};

const win = globalThis as unknown as {
	location?: { origin?: string };
	fetch?: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
	open?: (url: string, target?: string) => void;
	document?: { body?: unknown } | null;
	addEventListener?: (type: string, listener: (ev: any) => void, useCapture?: boolean) => void;
	removeEventListener?: (type: string, listener: (ev: any) => void, useCapture?: boolean) => void;
};

const bodyEl = win.document?.body ?? null;
const portalToBody = (node: unknown) => {
	if (bodyEl && reactDom && typeof reactDom.createPortal === 'function') {
		return reactDom.createPortal(node, bodyEl);
	}
	return node;
};

export const name = 'dsh-cloudcode-link-client';
export const inject = ['slots'];

export interface ClientContext extends Context {
	slots: {
		inject(name: string, register: () => () => void): void;
		register(
			opts: { name: string; id: string; order?: number; label?: string },
			Component: (props?: unknown) => unknown,
		): () => void;
	};
}

interface StatusPayload {
	bin?: string | null;
	version?: string | null;
	dormantReason?: string | null;
	enabled?: boolean;
	permissionMode?: string;
	workspaceRoot?: string;
	defaultModel?: string;
	defaultEffort?: string;
	askTool?: boolean;
	distSha256?: string | null;
	auth?: {
		phase: string;
		accountId?: string;
		url?: string;
		qrDataUrl?: string;
		startedAt?: number;
		expiresAt?: number;
		message?: string;
	};
	pool?: AccountPoolData;
	poolAuth?: {
		phase: 'idle' | 'waiting' | 'exchanging' | 'done' | 'failed' | string;
		stagingId?: string;
		alias?: string;
		url?: string;
		mode?: string;
		browserOpened?: boolean;
		message?: string;
	};
	catalog?: {
		source?: string;
		count?: number;
		lastError?: string | null;
		accountFailures?: unknown;
		endpointErrors?: unknown;
		discoveryDiagnostics?: unknown;
	};
	bindings?: unknown;
	lastRun?: {
		ok?: boolean;
		code?: string | number | null;
		durationMs?: number | null;
		model?: string | null;
	};
}

type SectionKey = 'overview' | 'accounts' | 'models' | 'usage' | 'diagnostics' | 'config';

type ToastType = 'success' | 'info' | 'warn' | 'error';

interface AuditRequestRow {
	requestId?: string;
	timestamp?: string;
	model?: string;
	accountId?: string;
	promptTokens?: number;
	cachedTokens?: number;
	outputTokens?: number;
	latencyMs?: number;
	ttftMs?: number;
	status?: string;
}

interface AuditSessionRow {
	sessionId?: string;
	updatedAt?: string;
	accountId?: string;
	totalRequests?: number;
	totalSuccess?: number;
	totalFailed?: number;
	totalPromptTokens?: number;
	totalCachedTokens?: number;
	cacheHitRate?: number;
	status?: string;
	lastError?: string;
}

const base = win.location?.origin ?? '';
const API_PREFIX = '/plugins/cloudcode-link';
const LEGACY_API_PREFIX = '/plugins/agy-link';

/**
 * Primary prefix, then a 404-only fallback to the legacy prefix (older host builds).
 * Failure is visible: null means "no usable response" and every caller surfaces it in the UI.
 */
async function fetchWithFallback(urlPath: string, options?: Record<string, unknown>): Promise<{ ok: boolean; status: number; json(): Promise<unknown> } | null> {
	if (!win.fetch) return null;
	const fullUrl = `${base}${urlPath}`;
	try {
		const res = await win.fetch(fullUrl, options);
		if (res && res.status === 404 && urlPath.startsWith(API_PREFIX)) {
			const legacy = `${base}${LEGACY_API_PREFIX}${urlPath.slice(API_PREFIX.length)}`;
			const res2 = await win.fetch(legacy, options);
			if (res2) return { ok: res2.ok, status: res2.status, json: () => res2.json() };
			return null;
		}
		if (res) return { ok: res.ok, status: res.status, json: () => res.json() };
		return null;
	} catch {
		return null;
	}
}

// Module-level cache for instant remount rendering
let statusCache: StatusPayload | null = null;

async function getStatus(): Promise<StatusPayload | null> {
	try {
		const res = await fetchWithFallback(`${API_PREFIX}/status`);
		if (!res || !res.ok) return null;
		const payload = (await res.json()) as StatusPayload;
		statusCache = payload;
		return payload;
	} catch {
		return null;
	}
}

async function postJson(path: string, body: Record<string, unknown>): Promise<any> {
	try {
		const res = await fetchWithFallback(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res) return null;
		try {
			return await res.json();
		} catch {
			return { ok: res.ok };
		}
	} catch {
		return null;
	}
}



/**
 * Mask email address for privacy display (e.g. user123@gmail.com -> us***@gmail.com).
 */
function maskEmail(email?: string): string {
	if (!email || typeof email !== 'string') return '';
	const atIdx = email.indexOf('@');
	if (atIdx <= 0) return email;
	const user = email.slice(0, atIdx);
	const domain = email.slice(atIdx);
	if (user.length <= 2) {
		return `${user[0]}***${domain}`;
	}
	return `${user.slice(0, 2)}***${domain}`;
}

function formatNumber(n: number): string {
	return Number(n || 0).toLocaleString();
}

function formatCompactTokens(n: number): string {
	if (!n) return '0';
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return String(n);
}

function formatClock(ms: number | null): string {
	if (!ms) return '—';
	try {
		return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
	} catch {
		return new Date(ms).toISOString().slice(11, 19);
	}
}

type BrandKey = keyof typeof BRAND_PATHS;
type UiIconKey = keyof typeof UI_PATHS;

/** Inline brand logo (Gemini / Claude / OpenAI) as a crisp SVG mark. */
function brandIcon(key: BrandKey, size = 13): unknown {
	return h('svg', {
		viewBox: '0 0 24 24',
		width: size,
		height: size,
		'aria-hidden': true,
		style: { display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 },
	}, h('path', { d: BRAND_PATHS[key], fill: BRAND_COLORS[key] }));
}

/** Clean outline/filled SVG icon (Lucide-style), zero emoji dependency. */
function uiIcon(key: UiIconKey, size = 12, color = 'currentColor'): unknown {
	const p = UI_PATHS[key];
	const isFilled = key === 'star';
	return h('svg', {
		viewBox: '0 0 24 24',
		width: size,
		height: size,
		'aria-hidden': true,
		style: { display: 'inline-block', verticalAlign: '-1.5px', flexShrink: 0 },
	}, h('path', {
		d: p,
		fill: isFilled ? color : 'none',
		stroke: isFilled ? 'none' : color,
		'stroke-width': isFilled ? undefined : 2,
		'stroke-linecap': isFilled ? undefined : 'round',
		'stroke-linejoin': isFilled ? undefined : 'round',
	}));
}

const FAMILY_BRAND: Record<'google' | 'anthropic' | 'openai', BrandKey> = {
	google: 'gemini',
	anthropic: 'claude',
	openai: 'openai',
};

const FAMILY_LABEL: Record<ModelFamilyKey, string> = {
	google: 'Gemini',
	anthropic: 'Claude',
	openai: 'GPT-OSS',
	unknown: '其他',
};

// Stable per-size gradient id: identical gradient content, but no id churn across renders
// (a per-render ++ counter forced every SVG subtree to repaint on each re-render).
const agyIconGradientIds = new Map<number, string>();

/** Antigravity mark: gradient orb with an orbit ring (product has no public simple-icon). */
function agyIcon(size = 14): unknown {
	let gid = agyIconGradientIds.get(size);
	if (!gid) {
		gid = `agy-g-${size}`;
		agyIconGradientIds.set(size, gid);
	}
	return h('svg', {
		viewBox: '0 0 24 24',
		width: size,
		height: size,
		'aria-hidden': true,
		style: { display: 'inline-block', verticalAlign: '-2px', flexShrink: 0 },
	},
		h('defs', null,
			h('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '1' },
				h('stop', { offset: '0', 'stop-color': 'var(--agy-brand-a)' }),
				h('stop', { offset: '1', 'stop-color': 'var(--agy-brand-b)' }),
			),
		),
		h('circle', { cx: 12, cy: 12, r: 6, fill: `url(#${gid})` }),
		h('ellipse', {
			cx: 12, cy: 12, rx: 10.4, ry: 3.9,
			fill: 'none', stroke: `url(#${gid})`, 'stroke-width': 1.4,
			transform: 'rotate(-18 12 12)',
		}),
	);
}

/**
 * Self-ticking reset countdown. This leaf is the only node that re-renders once per
 * second; the page tree around it stays put. Renders `↻ HH:MM (XhYm)` while a reset
 * window is pending, or the empty marker (default `—`) once it is gone.
 */
function ResetCountdown(props: {
	resetTime?: string;
	prefix?: string;
	emptyPrefix?: string;
	emptyText?: string;
	suffix?: string;
	className?: string;
	style?: Record<string, unknown>;
}): unknown {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(timer);
	}, []);
	void tick; // recomputed on each self-tick; the text comes from the live clock
	const { resetText } = formatQuotaWindow(props.resetTime);
	const body = resetText
		? `${props.prefix ?? '↻ '}${resetText}`
		: `${props.emptyPrefix ?? '—'}${props.emptyText ?? ''}`;
	return h('span', { className: props.className, style: props.style }, `${body}${props.suffix ?? ''}`);
}

export function apply(ctx: ClientContext): void {
	const AgySettingsSection = (props?: any): unknown => {
		const [status, setStatus] = useState<StatusPayload | null>(statusCache);
		const [pollOk, setPollOk] = useState<boolean>(statusCache !== null);
		const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(statusCache ? Date.now() : null);
		const [activeSection, setActiveSection] = useState<SectionKey>('overview');
		const [aliasInput, setAliasInput] = useState('');
		const [proxyInputs, setProxyInputs] = useState<Record<string, string>>({});
		const [editingProxyId, setEditingProxyId] = useState<string | null>(null);
		const [addingAccount, setAddingAccount] = useState(false);
		const [authCodeInput, setAuthCodeInput] = useState('');
		const [loadingAction, setLoadingAction] = useState<string | null>(null);
		const [toast, setToast] = useState<{ text: string; type: ToastType } | null>(null);
		const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
		const [modelPanels, setModelPanels] = useState<Record<string, ModelPanelState>>({});
		const [modelQueries, setModelQueries] = useState<Record<string, string>>({});
		const [familyFilters, setFamilyFilters] = useState<Record<string, ModelFamilyKey[]>>({});
		const [statsOverview, setStatsOverview] = useState<Record<string, unknown> | null>(null);
		const [statsError, setStatsError] = useState<string | null>(null);
		const [showAuditDrawer, setShowAuditDrawer] = useState(false);
		const [auditTab, setAuditTab] = useState<'requests' | 'sessions'>('requests');
		const [auditRequests, setAuditRequests] = useState<AuditRequestRow[]>([]);
		const [auditTotal, setAuditTotal] = useState(0);
		const [auditPage, setAuditPage] = useState(0);
		const [auditLoading, setAuditLoading] = useState(false);
		const [auditSessions, setAuditSessions] = useState<AuditSessionRow[]>([]);
		const [auditSessionsTotal, setAuditSessionsTotal] = useState(0);
		const [auditSessionsPage, setAuditSessionsPage] = useState(0);
		const [auditSessionsLoading, setAuditSessionsLoading] = useState(false);
		const [auditError, setAuditError] = useState<string | null>(null);
		const [cfgDrafts, setCfgDrafts] = useState<Record<string, string | undefined>>({});
		const flowStartedRef = useRef(false);
		// refs mirror the poll UI state so the 3s tick can fold transitions without reading
		// stale closure state (and without re-rendering when nothing actually changed).
		const pollOkRef = useRef<boolean>(statusCache !== null);
		const lastUpdatedRef = useRef<number | null>(statusCache ? Date.now() : null);
		const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const tabRefs = useRef<Record<string, { focus: () => void } | null>>({});

		const showToast = (text: string, type: ToastType): void => {
			setToast({ text, type });
			if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
			toastTimerRef.current = setTimeout(() => setToast(null), 6000);
		};

		// ---- stats + audit fetchers (failures are surfaced, never swallowed) ----
		const fetchStatsOverview = async (): Promise<void> => {
			try {
				const res = await fetchWithFallback(`${API_PREFIX}/stats/overview`);
				if (!res || !res.ok) {
					setStatsError('用量统计加载失败（后端未返回可用数据）');
					return;
				}
				const data = (await res.json()) as { overview?: Record<string, unknown> };
				if (!data.overview) {
					setStatsError('用量统计加载失败（响应缺少 overview 字段）');
					return;
				}
				setStatsOverview(data.overview);
				setStatsError(null);
			} catch {
				setStatsError('用量统计加载失败（网络异常）');
			}
		};

		const fetchAuditRequests = async (limit: number, offset: number): Promise<void> => {
			setAuditLoading(true);
			try {
				const res = await fetchWithFallback(`${API_PREFIX}/stats/requests?limit=${limit}&offset=${offset}`);
				if (!res || !res.ok) {
					setAuditError('请求明细加载失败（后端未返回可用数据）');
					return;
				}
				const data = (await res.json()) as { requests?: AuditRequestRow[]; total?: number };
				setAuditRequests(data.requests ?? []);
				setAuditTotal(typeof data.total === 'number' ? data.total : (data.requests?.length ?? 0));
				setAuditError(null);
			} catch {
				setAuditError('请求明细加载失败（网络异常）');
			} finally {
				setAuditLoading(false);
			}
		};

		const fetchAuditSessions = async (limit: number, offset: number): Promise<void> => {
			setAuditSessionsLoading(true);
			try {
				const res = await fetchWithFallback(`${API_PREFIX}/stats/sessions?limit=${limit}&offset=${offset}`);
				if (!res || !res.ok) {
					setAuditError('会话统计加载失败（后端未返回可用数据）');
					return;
				}
				const data = (await res.json()) as { sessions?: AuditSessionRow[]; total?: number };
				setAuditSessions(data.sessions ?? []);
				setAuditSessionsTotal(typeof data.total === 'number' ? data.total : (data.sessions?.length ?? 0));
				setAuditError(null);
			} catch {
				setAuditError('会话统计加载失败（网络异常）');
			} finally {
				setAuditSessionsLoading(false);
			}
		};

		// ---- status polling: 3s, JSON-compare debounce; a failed poll never clears shown data ----
		useEffect(() => {
			let alive = true;
			let lastJson = status ? JSON.stringify(status) : '';
			const tick = async () => {
				const st = await getStatus();
				if (!alive) return;
				if (!st) {
					// Keep the last known state on screen and mark it stale instead of blanking the page.
					pollOkRef.current = false;
					setPollOk(false);
					return;
				}
				const json = JSON.stringify(st);
				const changed = json !== lastJson;
				if (changed) {
					lastJson = json;
					setStatus(st);
				}
				// Any successful poll clears the 轮询中断 badge — even when the status JSON is
				// byte-identical. Unchanged healthy polls keep the old timestamp so React bails out.
				const next = applyPollOutcome(
					{ pollOk: pollOkRef.current, lastUpdatedAt: lastUpdatedRef.current },
					{ ok: true, statusChanged: changed },
					Date.now(),
				);
				pollOkRef.current = next.pollOk;
				lastUpdatedRef.current = next.lastUpdatedAt;
				setPollOk(next.pollOk);
				setLastUpdatedAt(next.lastUpdatedAt);
			};
			void tick();
			const timer = setInterval(() => { void tick(); }, 3000);
			void fetchStatsOverview();
			const statsTimer = setInterval(() => { void fetchStatsOverview(); }, 10000);
			return () => {
				alive = false;
				clearInterval(timer);
				clearInterval(statsTimer);
			};
		}, []);

		useEffect(() => () => {
			if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
		}, []);

		// ---- drawer Escape to close (mirrors the host modal primitive) ----
		useEffect(() => {
			if (!showAuditDrawer) return;
			const onKey = (ev: { key?: string }) => {
				if (ev.key === 'Escape') setShowAuditDrawer(false);
			};
			win.addEventListener?.('keydown', onKey, true);
			return () => { win.removeEventListener?.('keydown', onKey, true); };
		}, [showAuditDrawer]);

		useEffect(() => {
			if (!showAuditDrawer) return;
			void fetchAuditRequests(20, auditPage * 20);
		}, [showAuditDrawer, auditPage]);

		useEffect(() => {
			if (!showAuditDrawer || auditTab !== 'sessions') return;
			void fetchAuditSessions(20, auditSessionsPage * 20);
		}, [showAuditDrawer, auditTab, auditSessionsPage]);

		// ---- account add flow: react to poolAuth phase transitions ----
		useEffect(() => {
			const phase = status?.poolAuth?.phase;
			if (phase === 'waiting' || phase === 'exchanging') flowStartedRef.current = true;
			if (phase === 'done' && flowStartedRef.current) {
				flowStartedRef.current = false;
				setAddingAccount(false);
				setAuthCodeInput('');
				showToast('账号已激活入池', 'success');
			} else if (phase === 'failed' && flowStartedRef.current) {
				flowStartedRef.current = false;
				showToast(status?.poolAuth?.message || '账号激活失败，请重试或手动粘贴授权码', 'error');
			}
		}, [status?.poolAuth?.phase]);

		// ---- config drafts are seeded from status (round-trip of POST /config) ----
		// A not-yet-loaded status must not freeze the drafts to '' — '' would masquerade as
		// "user edited it to empty" and the fields would never backfill. Only entries the
		// user has never touched (undefined) get seeded; a user-typed '' is preserved.
		useEffect(() => {
			if (!status) return;
			setCfgDrafts((prev) => seedConfigDrafts(prev, status));
		}, [status?.defaultModel, status?.defaultEffort]);

		// Countdown cells tick themselves (see ResetCountdown): the settings component no
		// longer holds a per-second top-level state, so a ticking clock never re-renders
		// the whole page tree while the models panel or drawer is open.

		// ---- account / model derivations ----
		const accounts: ManagedAccount[] = status?.pool?.accounts ?? [];
		const isAuthed = status?.auth?.phase === 'ok' || accounts.length > 0;
		const isBusy = typeof loadingAction === 'string';
		const modelUnionTotal = computeModelUnion(modelPanels, accounts);

		// Model payloads (payload priority + fallback labeling) live in account-models.ts:
		// a panel keeps rendering its last discovered payload even while re-fetching or after
		// a failed load; only a payload-less account falls back to the quota-embedded list.
		const accountModelIdsOf = (acc: ManagedAccount): string[] => accountModelIds(acc, modelPanels[acc.id]);

		const loadModelsPanel = async (accId: string): Promise<void> => {
			setModelPanels((prev) => ({ ...prev, [accId]: { ...(prev[accId] ?? EMPTY_PANEL), status: 'loading' } }));
			const result = await fetchAccountModels(fetchWithFallback, API_PREFIX, accId);
			const payload = result.payload;
			if (payload && payload.ok !== false) {
				setModelPanels((prev) => ({
					...prev,
					[accId]: markPanelSuccess(prev[accId] ?? EMPTY_PANEL, payload, payload.refreshError ?? null, Date.now()),
				}));
				return;
			}
			// Endpoint unusable. Any payload this panel already carries is kept and keeps
			// its real source label; only a payload-less panel actually relies on the quota
			// fallback. The failed fetch never silently discards discovered models.
			setModelPanels((prev) => ({
				...prev,
				[accId]: markPanelLoadFailure(prev[accId] ?? EMPTY_PANEL, result.error ?? 'models_endpoint_failed', Date.now()),
			}));
		};

		const refreshModelsPanel = async (acc: ManagedAccount): Promise<void> => {
			setModelPanels((prev) => ({ ...prev, [acc.id]: { ...(prev[acc.id] ?? EMPTY_PANEL), status: 'loading' } }));
			const result = await postAccountModelsRefresh(fetchWithFallback, API_PREFIX, acc.id);
			const payload = result.payload;
			if (payload && payload.ok !== false) {
				setModelPanels((prev) => ({
					...prev,
					[acc.id]: markPanelSuccess(prev[acc.id] ?? EMPTY_PANEL, payload, payload.refreshError ?? null, Date.now()),
				}));
				if (payload.refreshError) showToast(`刷新未完成：${payload.refreshError}（旧清单已保留）`, 'warn');
				else showToast('模型清单已刷新', 'success');
				return;
			}
			// Refresh failed: keep the previously loaded list (or quota fallback) visible.
			setModelPanels((prev) => ({
				...prev,
				[acc.id]: markPanelRefreshFailure(prev[acc.id] ?? EMPTY_PANEL, result.error ?? 'models_refresh_failed', Date.now()),
			}));
			showToast('模型刷新失败，已保留上一次发现的模型数据', 'error');
		};

		const ensureModelsLoaded = (accId: string): void => {
			const panel = modelPanels[accId];
			if (!panel || panel.status === 'idle') void loadModelsPanel(accId);
		};

		// Auto-load panels when the models section opens or the account set changes.
		// The effect keys on a stable id fingerprint (not the `accounts` array, which gets a
		// fresh reference on every 3s poll), and collectStalePanelAccounts deliberately skips
		// 'loading'/'error' panels: an unavailable endpoint is retried only by an explicit
		// user action, never re-hammered on every poll.
		const accountIdsFingerprint = accounts.map((acc) => acc.id).join('|');
		useEffect(() => {
			if (activeSection !== 'models') return;
			const stale = collectStalePanelAccounts(modelPanels, accounts, Date.now());
			if (stale.length === 0) return;
			void (async () => {
				for (const acc of stale) await loadModelsPanel(acc.id);
			})();
		}, [activeSection, accountIdsFingerprint]);

		// ---- pool actions (visible failures, preserved data) ----
		const refresh = async (): Promise<void> => {
			setLoadingAction('status');
			try {
				const st = await getStatus();
				if (!st) {
					pollOkRef.current = false;
					setPollOk(false);
					showToast('状态刷新失败：暂时联系不上后端，页面保留的是上次成功拉取的数据', 'error');
					return;
				}
				pollOkRef.current = true;
				lastUpdatedRef.current = Date.now();
				setPollOk(true);
				setLastUpdatedAt(lastUpdatedRef.current);
				setStatus(st);
				showToast('状态已刷新', 'success');
			} finally {
				setLoadingAction(null);
			}
		};

		const runPoolAction = async (
			label: string,
			path: string,
			payload: Record<string, unknown>,
			okText: string,
		): Promise<Record<string, unknown> | null> => {
			setLoadingAction(label);
			try {
				const res = await postJson(`${API_PREFIX}${path}`, payload);
				if (!res || res.ok === false) {
					const reason = res && typeof res.error === 'string' ? res.error : '后端未响应';
					showToast(`${okText}失败：${reason}`, 'error');
					return null;
				}
				showToast(okText, 'success');
				return res as Record<string, unknown>;
			} finally {
				setLoadingAction(null);
			}
		};

		const handleBeginAddAccount = async (): Promise<void> => {
			setLoadingAction('begin-add');
			try {
				const trimmed = aliasInput.trim();
				const res = await postJson(`${API_PREFIX}/pool/begin-add`, trimmed ? { alias: trimmed } : {});
				if (!res) {
					showToast('无法联系后端，添加流程未启动', 'error');
					return;
				}
				if (res.ok === false) {
					showToast(`添加流程启动失败：${typeof res.error === 'string' ? res.error : '未知原因'}`, 'error');
					return;
				}
				setAddingAccount(true);
				if (res.browserOpened === false) {
					showToast('未自动打开浏览器，请在添加面板中使用手动授权链接', 'warn');
				} else {
					showToast('已发起浏览器授权，请在打开的 Google 登录页完成授权', 'info');
				}
			} finally {
				setLoadingAction(null);
			}
		};

		const handleCompleteAddAccount = async (): Promise<void> => {
			const code = authCodeInput.trim();
			if (!code) {
				showToast('请先粘贴授权码或回调链接', 'warn');
				return;
			}
			const res = await runPoolAction('complete-add', '/pool/complete-add', { code }, '手动激活请求已提交');
			if (res) setAuthCodeInput('');
		};

		const handleCancelAddAccount = async (): Promise<void> => {
			flowStartedRef.current = false;
			setAddingAccount(false);
			setAuthCodeInput('');
			await runPoolAction('cancel-add', '/pool/cancel-add', {}, '添加流程已取消');
		};

		const setCfg = async (key: string, value: unknown): Promise<void> => {
			const res = await runPoolAction(`config:${key}`, '/config', { key, value }, `${key} 已保存`);
			if (res) {
				// Optimistic mirror so the row reflects the saved value even before the next poll.
				setStatus((prev) => (prev ? { ...prev, [key]: value } : prev));
			}
		};

		const setPrimary = async (id: string): Promise<void> => {
			await runPoolAction('primary', '/pool/primary', { id }, '已设为主用账号');
		};

		const removeAccount = async (id: string): Promise<void> => {
			await runPoolAction('remove', '/pool/remove', { id }, '账号已移除');
		};

		const refreshQuota = async (id?: string): Promise<void> => {
			await runPoolAction('quota', '/pool/refresh-quota', id ? { id } : {}, '额度已刷新');
		};

		const saveProxy = async (id: string): Promise<void> => {
			const proxyUrl = (proxyInputs[id] ?? '').trim();
			const res = await runPoolAction('proxy', '/pool/proxy', { id, proxyUrl }, proxyUrl ? '代理已保存' : '已改用全局代理');
			if (res) setEditingProxyId(null);
		};

		const clearCooldown = async (id?: string): Promise<void> => {
			await runPoolAction('cooldown', '/pool/clear-cooldown', id ? { id } : {}, '本地冷却已清除');
		};

		const toggleExpand = (accId: string): void => {
			const next = !expandedModels[accId];
			setExpandedModels((prev) => ({ ...prev, [accId]: next }));
			if (next) ensureModelsLoaded(accId);
		};

		// ---- shared render atoms ----
		const renderSkeletonRow = (widthPct: number, heightPx = 14): unknown =>
			h('div', {
				className: 'agy-skeleton',
				'aria-hidden': true,
				style: { width: `${widthPct}%`, height: `${heightPx}px`, marginBottom: 'var(--agy-space-2)' },
			});

		const renderSkeletonCard = (): unknown =>
			h('div', { style: S.card },
				renderSkeletonRow(35, 18),
				renderSkeletonRow(80),
				renderSkeletonRow(60),
				h('span', { className: 'agy-sr-only' }, '正在加载'),
			);

		const renderEmptyState = (text: string, action?: unknown): unknown =>
			h('div', {
				style: {
					padding: 'var(--agy-space-5)',
					textAlign: 'center',
					border: '1px dashed var(--agy-border-divider)',
					borderRadius: 'var(--agy-radius-lg)',
					background: 'var(--agy-bg-subbox)',
				},
			},
				h('div', { style: { color: 'var(--agy-text-secondary)', fontSize: 'var(--agy-font-md)', lineHeight: 1.6 } }, text),
				action ? h('div', { style: { marginTop: 'var(--agy-space-3)' } }, action) : null,
			);

		const renderStrip = (kind: ToastType, text: string, retry?: () => void): unknown =>
			h('div', {
				role: 'alert',
				style: {
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 'var(--agy-space-2)',
					padding: '9px var(--agy-space-3)',
					borderRadius: 'var(--agy-radius-md)',
					background: kind === 'error' ? 'var(--agy-danger-bg)' : kind === 'warn' ? 'var(--agy-warn-bg)' : 'var(--agy-info-bg)',
					border: `1px solid ${kind === 'error' ? 'var(--agy-danger-border)' : kind === 'warn' ? 'var(--agy-warn-border)' : 'var(--agy-info-border)'}`,
					color: kind === 'error' ? 'var(--agy-danger-text)' : kind === 'warn' ? 'var(--agy-warn-text)' : 'var(--agy-info-text)',
					fontSize: 'var(--agy-font-sm)',
					marginBottom: 'var(--agy-space-2)',
				},
			},
				h('span', null, text),
				retry
					? h('button', { className: 'agy-btn', style: S.btnSm, onClick: retry, 'aria-label': '重试加载' }, uiIcon('refresh', 12), '重试')
					: null,
			);

		const numOf = (obj: Record<string, unknown> | null, key: string): number | null => {
			const v = obj ? obj[key] : undefined;
			return typeof v === 'number' && Number.isFinite(v) ? v : null;
		};

		const strOf = (obj: Record<string, unknown> | null, key: string): string | null => {
			const v = obj ? obj[key] : undefined;
			return typeof v === 'string' && v.length > 0 ? v : null;
		};

		const renderStatCard = (label: string, value: unknown, sub?: unknown, valueColor?: string): unknown =>
			h('div', { className: 'agy-card-hover', style: { ...S.statBox, flex: '1 1 150px' } },
				h('div', { style: S.statLabel }, label),
				h('div', { style: { ...S.statValue, color: valueColor ?? 'var(--agy-text-primary)' } }, value),
				sub ? h('div', { style: S.statSub }, sub) : null,
			);

		const renderToastBanner = (): unknown => {
			if (!toast) return null;
			const palette: Record<ToastType, { bg: string; border: string; text: string }> = {
				success: { bg: 'var(--agy-toast-success-bg)', border: 'var(--agy-toast-success-border)', text: 'var(--agy-toast-success-text)' },
				info: { bg: 'var(--agy-toast-info-bg)', border: 'var(--agy-toast-info-border)', text: 'var(--agy-toast-info-text)' },
				warn: { bg: 'var(--agy-toast-warn-bg)', border: 'var(--agy-toast-warn-border)', text: 'var(--agy-toast-warn-text)' },
				error: { bg: 'var(--agy-toast-error-bg)', border: 'var(--agy-toast-error-border)', text: 'var(--agy-toast-error-text)' },
			};
			const tone = palette[toast.type];
			return h('div', {
				role: 'status',
				'aria-live': 'polite',
				className: 'agy-rise',
				style: { ...S.noticeBanner, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text },
			},
				h('span', null, toast.text),
				h('button', {
					className: 'agy-btn',
					style: { ...S.btnSm, background: 'transparent', border: 'none' },
					onClick: () => setToast(null),
					'aria-label': '关闭提示',
				}, uiIcon('x', 12)),
			);
		};

		const quotaGradientFor = (pct: number, cooling: boolean): string => {
			if (cooling) return 'var(--agy-quota-cool-grad)';
			if (pct < 10) return 'var(--agy-quota-low-grad)';
			if (pct <= 30) return 'var(--agy-quota-med-grad)';
			return 'var(--agy-quota-high-grad)';
		};

		const quotaTextFor = (pct: number, cooling: boolean): string => {
			if (cooling) return 'var(--agy-quota-none-text)';
			if (pct < 10) return 'var(--agy-quota-low-text)';
			if (pct <= 30) return 'var(--agy-quota-med-text)';
			return 'var(--agy-quota-high-text)';
		};

		const renderQuotaBar = (label: string, familyKey: 'google' | 'anthropic' | 'openai', acc: ManagedAccount): unknown => {
			const info: FamilyQuotaInfo | undefined = acc.quotas[familyKey];
			const cd = acc.cooldowns[familyKey];
			const cooling = !!(cd && cd.cooldownUntil > Date.now());
			const pct5h = typeof info?.remainingFraction === 'number'
				? Math.max(0, Math.min(100, Math.round(info.remainingFraction * 100)))
				: -1;
			const pctWeekly = typeof info?.weeklyFraction === 'number'
				? Math.max(0, Math.min(100, Math.round(info.weeklyFraction * 100)))
				: -1;
			const cdNote = cooling ? ' · 本地冷却中' : '';

			const line = (windowLabel: string, pct: number, resetTime?: string) => {
				if (pct < 0) {
					return h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', marginBottom: '5px' } },
						h('span', { style: { width: '56px', color: 'var(--agy-text-tertiary)', fontSize: 'var(--agy-font-xs)' } }, windowLabel),
						h('span', { className: 'agy-num', style: { ...S.muted, fontSize: 'var(--agy-font-xs)' } }, `未同步${cdNote}`),
					);
				}
				return h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', marginBottom: '5px' } },
					h('span', { style: { width: '56px', color: 'var(--agy-text-tertiary)', fontSize: 'var(--agy-font-xs)' } }, windowLabel),
					h('div', { style: S.progressBarBg, 'aria-hidden': true },
						h('div', {
							className: 'agy-progress-fill',
							style: { width: `${pct}%`, height: '100%', borderRadius: 'var(--agy-radius-pill)', background: quotaGradientFor(pct, cooling) },
						}),
					),
					h('span', { className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', fontWeight: 700, color: quotaTextFor(pct, cooling), minWidth: '38px', textAlign: 'right' } }, `${pct}%`),
					h(ResetCountdown, { resetTime, suffix: cdNote, className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', minWidth: '128px' } }),
				);
			};

			return h('div', { style: S.quotaBox },
				h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' } },
					brandIcon(FAMILY_BRAND[familyKey], 13),
					h('span', { style: { fontSize: 'var(--agy-font-sm)', fontWeight: 700, color: 'var(--agy-text-primary)' } }, label),
				),
				line('5h 额度', pct5h, info?.resetTime),
				line('周额度', pctWeekly, info?.weeklyResetTime),
			);
		};

		// ---- account cards (all original capabilities preserved) ----
		const renderedAccountCards = accounts.map((acc, idx) => {
			const isPrimary = acc.id === status?.pool?.primaryAccountId;
			const hasCooldown = Object.values(acc.cooldowns ?? {}).some((cd) => cd && cd.cooldownUntil > Date.now());
			const isAuthRequired = acc.authRequired === true;
			const dotColor = !acc.enabled
				? 'var(--agy-strong-neutral)'
				: isAuthRequired
					? 'var(--agy-strong-danger)'
					: hasCooldown
						? 'var(--agy-strong-warn)'
						: 'var(--agy-strong-ok)';
			const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
			const displayName = acc.email ? (isAutoAlias ? acc.email : acc.alias) : (acc.alias || acc.id);
			const showEmailBadge = acc.email && !isAutoAlias;
			const modelCount = accountModelIdsOf(acc).length;
			const expanded = !!expandedModels[acc.id];

			return h('div', {
				key: acc.id,
				className: 'agy-card-hover agy-rise',
				style: { ...(isPrimary ? S.cardPrimary : S.card), '--i': Math.min(idx, 8) },
			},
				h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--agy-space-2)' } },
					h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', flexWrap: 'wrap', minWidth: 0 } },
						h('span', { className: 'agy-pulse-dot', 'aria-hidden': true, style: { background: dotColor } }),
						h('span', { style: { fontSize: 'var(--agy-font-lg)', fontWeight: 750, color: 'var(--agy-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' } }, displayName),
						isPrimary
							? h('span', { style: S.badgePrimary }, uiIcon('star', 11), ' 主用')
							: null,
						acc.proxyUrl
							? h('span', { style: S.badgeTag, title: `专属代理：${acc.proxyUrl}` }, uiIcon('globe', 11), ' 代理')
							: null,
						showEmailBadge
							? h('span', { style: S.badgeTag, title: acc.email }, uiIcon('mail', 11), ` ${maskEmail(acc.email)}`)
							: null,
						isAuthRequired
							? h('span', { style: S.badgeUnready }, '需重新登录')
							: null,
						h('span', { style: S.badgeTag, title: '已发现的模型数' }, uiIcon('layers', 11), ` 模型 ${modelCount}`),
					),
					h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' } },
						h('button', {
							className: 'agy-btn',
							style: S.btnSm,
							onClick: () => toggleExpand(acc.id),
							'aria-expanded': expanded,
							'aria-controls': modelsPanelDomId(acc.id),
							title: '查看该账号支持的模型与额度',
						}, uiIcon(expanded ? 'chevronUp' : 'chevronDown', 11), expanded ? ' 收起' : ' 明细'),
						h('button', {
							className: 'agy-btn',
							style: S.btnSm,
							onClick: () => void refreshQuota(acc.id),
							disabled: isBusy,
							title: '刷新此账号（换号后点这里立即同步 email / 额度 / 模型）',
							'aria-label': `同步账号 ${displayName}`,
						}, uiIcon('refresh', 11), ' 同步'),
						!isPrimary
							? h('button', {
								className: 'agy-btn',
								style: S.btnSm,
								onClick: () => void setPrimary(acc.id),
								disabled: isBusy,
								title: '切换调度主用账号',
							}, '设为主用')
							: null,
						h('button', {
							className: 'agy-btn',
							style: S.btnSm,
							onClick: () => {
								if (editingProxyId === acc.id) {
									setEditingProxyId(null);
								} else {
									setEditingProxyId(acc.id);
									setProxyInputs((prev) => ({ ...prev, [acc.id]: acc.proxyUrl ?? '' }));
								}
							},
							'aria-expanded': editingProxyId === acc.id,
							title: '配置该账号的专属代理',
						}, uiIcon('globe', 11), ' 代理'),
						accounts.length > 1
							? h('button', {
								className: 'agy-btn',
								style: S.btnDanger,
								onClick: () => void removeAccount(acc.id),
								disabled: isBusy,
								'aria-label': `移除此账号 ${displayName}`,
								title: '从账号池移除（不会吊销 Google 侧授权）',
							}, uiIcon('trash', 11), ' 移除此')
							: null,
					),
				),
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-4)', flexWrap: 'wrap', marginTop: 'var(--agy-space-2)' } },
					renderQuotaBar('Gemini', 'google', acc),
					renderQuotaBar('Claude', 'anthropic', acc),
					renderQuotaBar('GPT-OSS', 'openai', acc),
				),
				hasCooldown
					? h('div', {
						className: 'agy-cooldown-breathe',
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: 'var(--agy-space-2)',
							marginTop: 'var(--agy-space-2)',
							padding: '8px var(--agy-space-3)',
							borderRadius: 'var(--agy-radius-md)',
							background: 'var(--agy-warn-bg)',
							border: '1px solid var(--agy-warn-border)',
							color: 'var(--agy-warn-text)',
							fontSize: 'var(--agy-font-sm)',
						},
					},
						h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, uiIcon('zap', 12), '部分模型限流中，已自动切换账号'),
						h('button', {
							className: 'agy-btn',
							style: { ...S.btnSm, background: 'var(--agy-warn-btn-bg)', color: 'var(--agy-warn-btn-text)', border: '1px solid var(--agy-warn-btn-border)' },
							onClick: () => void clearCooldown(acc.id),
							disabled: isBusy,
						}, '清除冷却'),
					)
					: null,
				editingProxyId === acc.id
					? h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', marginTop: 'var(--agy-space-2)', flexWrap: 'wrap' } },
						h('input', {
							className: 'agy-input',
							style: S.input,
							value: proxyInputs[acc.id] ?? '',
							placeholder: '专属代理 URL (如: http://127.0.0.1:7890，留空则使用全局)',
							'aria-label': `账号 ${displayName} 的专属代理 URL`,
							onChange: (e: { target: { value: string } }) => setProxyInputs((prev) => ({ ...prev, [acc.id]: e.target.value })),
						}),
						h('button', { className: 'agy-btn', style: S.btnSmPrimary, onClick: () => void saveProxy(acc.id), disabled: isBusy }, '保存'),
						h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => setEditingProxyId(null) }, '取消'),
					)
					: null,
				// Expanded detail panel: the id above must point at a real DOM region on the
				// accounts tab too — a dangling aria-controls is broken assistive tech.
				expanded
					? (() => {
						const detail = selectPanelPayload(modelPanels[acc.id], acc);
						const entries = detail.payload.familyModels.flatMap((g) => g.models.map((m) => ({ id: m.id, name: m.name, family: g.family })));
						return h('div', {
							id: modelsPanelDomId(acc.id),
							role: 'region',
							'aria-label': `${displayName} 的模型明细`,
							style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', marginTop: 'var(--agy-space-2)' },
						},
							entries.length === 0
								? h('span', { style: { ...S.muted, fontSize: 'var(--agy-font-xs)' } }, '尚未发现该账号的模型，可点「同步」或稍后自动加载。')
								: entries.map((m) => h('span', {
									key: `${m.family}:${m.id}`,
									style: S.badgeTag,
									title: m.id,
								}, brandIcon(FAMILY_BRAND[m.family as 'google' | 'anthropic' | 'openai'] ?? 'gemini', 11), ' ', m.name)),
							h('span', { style: { ...S.muted, fontSize: 'var(--agy-font-xs)', width: '100%' } },
								detail.usingFallback
									? '来源：最近一次额度同步（模型端点未返回数据时的兜底展示）'
									: '来源：最近一次模型端点成功发现',
							),
						);
					})()
					: null,
			);
		});

		// ---- add-account flow ----
		const poolAuthPhase = status?.poolAuth?.phase ?? 'idle';
		const addFlow = accountAddFlowView(addingAccount, poolAuthPhase);
		const flowActive = addFlow.flowActive;
		const addAccountSection = addingAccount
			? h('div', { style: S.authModal },
				h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--agy-space-2)' } },
					h('div', { style: S.panelTitle }, '添加账号'),
					h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => void handleCancelAddAccount(), 'aria-label': '关闭添加流程' }, uiIcon('x', 12)),
				),
				// Browser login stays reachable whenever the flow is not running: users who
				// entered via the top-bar 「添加账号」 must be able to choose it, not only paste a code.
				addFlow.showBrowserStart
					? h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap', alignItems: 'center' } },
						h('input', {
							className: 'agy-input',
							style: { ...S.input, maxWidth: '280px' },
							value: aliasInput,
							placeholder: '可选别名 (留空直接使用 Google 账号名称)',
							'aria-label': '新账号别名',
							onChange: (e: { target: { value: string } }) => setAliasInput(e.target.value),
						}),
						h('button', { className: 'agy-btn', style: S.btnPrimary, onClick: () => void handleBeginAddAccount(), disabled: isBusy }, uiIcon('externalLink', 12), ' 打开浏览器登录'),
					)
					: null,
				flowActive
					? h('div', { style: { ...S.muted, lineHeight: 1.7 } },
						poolAuthPhase === 'waiting'
							? '等待浏览器中完成 Google 授权，成功后将自动激活。'
							: '正在验证授权并激活账号，请稍候...',
						h('div', { style: { marginTop: 'var(--agy-space-2)' } },
							status?.poolAuth?.url
								? h('button', {
									className: 'agy-btn',
									style: { ...S.btnSm, color: 'var(--agy-accent)', border: '1px solid var(--agy-accent-soft-border)', background: 'var(--agy-accent-soft-bg)' },
									onClick: () => win.open?.(status?.poolAuth?.url ?? '', '_blank'),
								}, uiIcon('externalLink', 12), ' 若浏览器未打开，请点击此处手动打开 Google 登录页')
								: null,
						),
					)
					: null,
				poolAuthPhase === 'failed'
					? h('div', { style: { ...S.noticeBanner, background: 'var(--agy-danger-bg)', border: '1px solid var(--agy-danger-border)', color: 'var(--agy-danger-text)', marginBottom: 'var(--agy-space-2)' } },
						status?.poolAuth?.message || '自动激活失败，可手动粘贴授权码完成激活。',
					)
					: null,
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', marginTop: 'var(--agy-space-2)', flexWrap: 'wrap' } },
					h('input', {
						className: 'agy-input',
						style: S.input,
						value: authCodeInput,
						placeholder: '授权码 或 http://localhost:51121/oauth-callback?code=... 完整链接',
						'aria-label': '手动授权码或回调链接',
						onChange: (e: { target: { value: string } }) => setAuthCodeInput(e.target.value),
					}),
					h('button', { className: 'agy-btn', style: S.btnSmPrimary, onClick: () => void handleCompleteAddAccount(), disabled: isBusy }, '手动激活'),
					h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => void handleCancelAddAccount(), disabled: isBusy }, '取消'),
				),
			)
			: h('div', { style: S.authModal },
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap', alignItems: 'center' } },
					h('input', {
						className: 'agy-input',
						style: { ...S.input, maxWidth: '280px' },
						value: aliasInput,
						placeholder: '可选别名 (留空直接使用 Google 账号名称)',
						'aria-label': '新账号别名',
						onChange: (e: { target: { value: string } }) => setAliasInput(e.target.value),
					}),
					h('button', { className: 'agy-btn', style: S.btnPrimary, onClick: () => void handleBeginAddAccount(), disabled: isBusy }, uiIcon('plus', 12), ' 打开浏览器登录'),
				),
			);

		// ---- models section (per-account expandable model panel) ----
		const renderModelPanel = (acc: ManagedAccount, idx: number): unknown => {
			const panel = modelPanels[acc.id] ?? EMPTY_PANEL;
			const expanded = !!expandedModels[acc.id];
			const { payload, usingFallback } = selectPanelPayload(panel, acc);
			const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
			const displayName = acc.email ? (isAutoAlias ? acc.email : acc.alias) : (acc.alias || acc.id);
			const ids = payload.familyModels.flatMap((g) => g.models.map((m) => m.id));
			const ownIdSet = new Set(ids);
			const others = computeOtherAccountModelIds(modelPanels, accounts, acc.id);
			const query = (modelQueries[acc.id] ?? '').trim().toLowerCase();
			const famFilter = familyFilters[acc.id];
			const groups = payload.familyModels
				.filter((g) => !famFilter || famFilter.length === 0 || famFilter.includes(g.family))
				.map((g) => ({
					...g,
					models: g.models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)),
				}))
				.filter((g) => g.models.length > 0);
			const filteredCount = groups.reduce((n, g) => n + g.models.length, 0);
			const allFamilies: ModelFamilyKey[] = ['google', 'anthropic', 'openai', 'unknown'];
			const presentFamilies = allFamilies.filter((f) => payload.familyModels.some((g) => g.family === f && g.models.length > 0));

			const coverageBadge = h('span', {
				style: { ...S.badgeTag },
				title: `该账号已发现 ${ownIdSet.size} 个模型 · 全部账号共发现 ${modelUnionTotal} 个`,
			}, uiIcon('layers', 11), ` 覆盖 ${ownIdSet.size}/${modelUnionTotal}`);

			const headRow = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--agy-space-2)' } },
				h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', flexWrap: 'wrap', minWidth: 0 } },
					h('span', { style: { fontSize: 'var(--agy-font-lg)', fontWeight: 750, color: 'var(--agy-text-primary)' } }, displayName),
					coverageBadge,
					typeof panel.fetchedAt === 'number'
						? h('span', { className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)' } }, `同步于 ${formatClock(panel.fetchedAt)}`)
						: null,
				),
				h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
					panel.status === 'loading'
						? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)' } }, h('span', { className: 'agy-spinner', 'aria-hidden': true }), '正在加载模型清单…')
						: null,
					h('button', {
						className: 'agy-btn',
						style: S.btnSm,
						onClick: () => void refreshModelsPanel(acc),
						disabled: panel.status === 'loading',
						'aria-label': `刷新 ${displayName} 的模型清单`,
						title: '重新发现该账号可用的模型与额度（POST refresh）',
					}, uiIcon('refresh', 11), ' 刷新模型清单'),
					h('button', {
						className: 'agy-btn',
						style: S.btnSm,
						onClick: () => toggleExpand(acc.id),
						'aria-expanded': expanded,
						'aria-controls': modelsPanelDomId(acc.id),
					}, uiIcon(expanded ? 'chevronUp' : 'chevronDown', 11), expanded ? ' 收起' : ' 展开'),
				),
			);

			const statusStrips: unknown[] = [];
			if (panel.status === 'error' && panel.error) {
				// Honest wording: say which data is actually shown below (kept discovery vs quota fallback).
				statusStrips.push(renderStrip('error', `模型端点不可用：${panel.error}（${panel.payload ? '下方为最近一次成功发现的模型数据，失败不会清空' : '下方为最近一次额度同步的兜底模型数据'}）`, () => void loadModelsPanel(acc.id)));
			}
			if (panel.refreshError) {
				statusStrips.push(renderStrip('warn', `刷新失败：${panel.refreshError} · 已保留旧模型数据`));
			}

			const controls = expanded
				? h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap', alignItems: 'center', margin: 'var(--agy-space-2) 0' } },
					h('span', { style: { ...S.input, display: 'inline-flex', alignItems: 'center', gap: '6px', flex: '1 1 220px', maxWidth: '320px', padding: 0 } },
						uiIcon('search', 12, 'var(--agy-text-tertiary)'),
						h('input', {
							className: 'agy-input',
							style: { border: 'none', background: 'transparent', color: 'var(--agy-text-primary)', fontSize: 'var(--agy-font-sm)', padding: '7px 4px', width: '100%', outline: 'none' },
							value: modelQueries[acc.id] ?? '',
							placeholder: '搜索模型名 / modelId',
							'aria-label': `在 ${displayName} 的模型清单中搜索`,
							onChange: (e: { target: { value: string } }) => setModelQueries((prev) => ({ ...prev, [acc.id]: e.target.value })),
						}),
					),
					h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' }, role: 'group', 'aria-label': '模型厂商筛选' },
						h('button', {
							className: 'agy-chip',
							style: { ...S.badgeTag, cursor: 'pointer', border: '1px solid var(--agy-badge-tag-border)' },
							'aria-pressed': !famFilter || famFilter.length === 0,
							onClick: () => setFamilyFilters((prev) => ({ ...prev, [acc.id]: [] })),
						}, '全部'),
						presentFamilies.map((f) => h('button', {
							key: f,
							className: 'agy-chip',
							style: { ...S.badgeTag, cursor: 'pointer', border: '1px solid var(--agy-badge-tag-border)' },
							'aria-pressed': !!famFilter && famFilter.includes(f),
							onClick: () => setFamilyFilters((prev) => ({ ...prev, [acc.id]: famFilter && famFilter.includes(f) ? famFilter.filter((x) => x !== f) : [...(famFilter ?? []), f] })),
						}, FAMILY_LABEL[f] ?? f)),
					),
				)
				: null;

			// Every expanded state (skeleton / empty pool / filtered-empty / normal list) mounts
			// the panel container with the shared modelsPanelDomId id — the head button's
			// aria-controls must never dangle. Tab-exclusivity keeps exactly one such id in the DOM.
			const body = !expanded
				? null
				: panel.status === 'loading' && !panel.payload
					? h('div', { id: modelsPanelDomId(acc.id), role: 'region', 'aria-label': `${displayName} 的模型清单`, style: { paddingTop: 'var(--agy-space-1)' } },
						renderSkeletonRow(70, 16),
						renderSkeletonRow(85),
						renderSkeletonRow(55),
						h('span', { className: 'agy-sr-only' }, '正在加载模型清单'),
					)
					: ownIdSet.size === 0 && !query
						? h('div', { id: modelsPanelDomId(acc.id), role: 'region', 'aria-label': `${displayName} 的模型清单` }, renderEmptyState(
							'尚未发现该账号的模型清单。',
							h('button', { className: 'agy-btn', style: S.btnSmPrimary, onClick: () => void refreshModelsPanel(acc), disabled: panel.status === 'loading' }, uiIcon('refresh', 11), ' 点击刷新发现模型'),
						))
						: filteredCount === 0
							? h('div', { id: modelsPanelDomId(acc.id), role: 'region', 'aria-label': `${displayName} 的模型清单` }, renderEmptyState(
								'没有匹配当前搜索 / 筛选的模型。',
								h('button', {
									className: 'agy-btn',
									style: S.btnSm,
									onClick: () => {
										setModelQueries((prev) => ({ ...prev, [acc.id]: '' }));
										setFamilyFilters((prev) => ({ ...prev, [acc.id]: [] }));
									},
								}, '清空搜索与筛选'),
							))
							: h('div', { id: modelsPanelDomId(acc.id), role: 'region', 'aria-label': `${displayName} 的模型清单` },
								usingFallback && ids.length > 0
									? h('div', { style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', marginBottom: 'var(--agy-space-2)' } },
										'来源：最近一次额度同步（模型端点未返回数据时的兜底展示）',
									)
									: null,
								h('div', { style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', marginBottom: 'var(--agy-space-2)' } },
									`${filteredCount} / ${ownIdSet.size} 个模型 · 独有 ${ids.filter((id) => !others.has(id)).length} · 共用 ${ids.filter((id) => others.has(id)).length}`,
								),
								groups.map((g) => h('div', { key: g.family, style: { marginBottom: 'var(--agy-space-3)' } },
									h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' } },
										brandIcon(FAMILY_BRAND[g.family as 'google' | 'anthropic' | 'openai'] ?? 'gemini', 12),
										h('span', { style: S.panelCaption }, FAMILY_LABEL[g.family] ?? g.family),
									),
									g.models.map((m, rowIdx) => {
										const pct = typeof m.remainingFraction === 'number'
											? Math.max(0, Math.min(100, Math.round(m.remainingFraction * 100)))
											: -1;
										const isExclusive = !others.has(m.id);
										return h('div', {
											key: `${g.family}:${m.id}`,
											className: 'agy-model-row',
											style: { '--i': Math.min(rowIdx, 12), display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', padding: '5px 0', flexWrap: 'wrap' },
										},
											h('span', { title: m.id, style: { flex: '1 1 240px', minWidth: '160px', fontSize: 'var(--agy-font-sm)', color: 'var(--agy-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.name),
											isExclusive
												? h('span', { style: { ...S.badgePrimary, opacity: 0.9 }, title: '其它账号目前尚未发现此模型' }, '本账号独有')
												: h('span', { style: S.badgeTag, title: '账号池中至少一个其它账号也支持此模型' }, '其它账号也支持'),
											h('div', { style: { ...S.progressBarBg, maxWidth: '180px', minWidth: '90px' }, 'aria-hidden': true },
												h('div', {
													className: 'agy-progress-fill',
													style: { width: `${pct < 0 ? 0 : pct}%`, height: '100%', borderRadius: 'var(--agy-radius-pill)', background: quotaGradientFor(pct, false) },
												}),
											),
											h('span', { className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', fontWeight: 700, minWidth: '38px', textAlign: 'right', color: quotaTextFor(pct, false) } }, pct < 0 ? '—' : `${pct}%`),
											h(ResetCountdown, {
											resetTime: m.resetTime,
											emptyPrefix: '↻ ',
											emptyText: '未提供',
											className: 'agy-num',
											style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', minWidth: '132px', padding: '2px 6px', borderRadius: 'var(--agy-radius-sm)' },
										}),
										);
									}),
								)),
							);

			return h('div', {
				key: acc.id,
				className: 'agy-card-hover agy-rise',
				style: { ...S.card, '--i': Math.min(idx, 8) },
			},
				headRow,
				statusStrips.length > 0 ? h('div', null, ...statusStrips) : null,
				controls,
				body,
			);
		};

		const renderModelsSection = (): unknown => {
			if (accounts.length === 0) {
				return renderEmptyState(
					'还没有账号。添加账号后，这里会展示每个账号支持的模型、剩余额度与跨账号覆盖差异。',
					h('button', { className: 'agy-btn', style: S.btnPrimary, onClick: () => setActiveSection('accounts') }, uiIcon('plus', 12), ' 前往添加账号'),
				);
			}
			return h('div', null,
				h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', marginBottom: 'var(--agy-space-2)', flexWrap: 'wrap' } },
					h('span', { style: S.panelCaption }, '账号 × 模型覆盖'),
					h('span', { className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)' } }, `已发现模型并集 ${modelUnionTotal} 个 · 灰度差异以并集为基准`),
				),
				...accounts.map((acc, idx) => renderModelPanel(acc, idx)),
			);
		};

		// ---- audit drawer (requests / sessions tables) ----
		const renderAuditDrawer = (): unknown => {
			if (!showAuditDrawer) return null;
			const o = statsOverview;
			const totalRequests = numOf(o, 'totalRequests');
			const totalSuccess = numOf(o, 'totalSuccess');
			const totalFailed = numOf(o, 'totalFailed');
			const cacheHitRate = numOf(o, 'cacheHitRate');
			const cacheColor = cacheHitRate === null
				? 'var(--agy-text-primary)'
				: cacheHitRate > 0.3
					? 'var(--agy-strong-ok)'
					: cacheHitRate >= 0.1
						? 'var(--agy-strong-warn)'
						: 'var(--agy-strong-neutral)';

			const summaryCards = o
				? h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap', padding: 'var(--agy-space-3) var(--agy-space-4) 0' } },
					renderStatCard('请求总数',
						totalRequests === null ? '—' : formatNumber(totalRequests),
						`成功 ${totalSuccess === null ? '—' : formatNumber(totalSuccess)} · 失败 ${totalFailed === null ? '—' : formatNumber(totalFailed)}`,
					),
					renderStatCard('缓存命中率 (Cache Hit %)',
						cacheHitRate === null ? '—' : `${(cacheHitRate * 100).toFixed(1)}%`,
						`命中 Token ${numOf(o, 'totalCachedTokens') === null ? '—' : formatCompactTokens(numOf(o, 'totalCachedTokens') ?? 0)}`,
						cacheColor,
					),
					renderStatCard('Token 汇总 (P / C / O)',
						formatCompactTokens(numOf(o, 'totalTokens') ?? 0),
						`P ${formatCompactTokens(numOf(o, 'totalPromptTokens') ?? 0)} / C ${formatCompactTokens(numOf(o, 'totalCachedTokens') ?? 0)} / O ${formatCompactTokens(numOf(o, 'totalOutputTokens') ?? 0)}`,
					),
					renderStatCard('平均耗时 / TTFT',
						numOf(o, 'avgLatencyMs') === null ? '—' : `${Math.round(numOf(o, 'avgLatencyMs') ?? 0)}ms`,
						`TTFT ${numOf(o, 'avgTtftMs') === null ? '—' : `${Math.round(numOf(o, 'avgTtftMs') ?? 0)}ms`} · P90 ${numOf(o, 'p90LatencyMs') === null ? '—' : `${Math.round(numOf(o, 'p90LatencyMs') ?? 0)}ms`}`,
					),
				)
				: h('div', { style: { padding: 'var(--agy-space-3) var(--agy-space-4) 0', display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap' } },
					[0, 1, 2, 3].map((i) => h('div', { key: i, style: { flex: '1 1 150px' } },
						renderSkeletonRow(60, 12), renderSkeletonRow(90, 22))),
				);

			const requestsView = auditLoading && auditRequests.length === 0
				? h('div', { style: { padding: '0 var(--agy-space-4)' } }, renderSkeletonRow(95, 20), renderSkeletonRow(95, 20), renderSkeletonRow(95, 20))
				: auditError
					? renderStrip('error', auditError, () => void fetchAuditRequests(20, auditPage * 20))
					: auditRequests.length === 0
						? h('div', { style: { padding: 'var(--agy-space-4)' } }, renderEmptyState('暂无请求审计记录。'))
						: h('table', { className: 'agy-table' },
							h('thead', null, h('tr', null,
								h('th', null, '时间'),
								h('th', null, '模型'),
								h('th', null, '账号'),
								h('th', null, 'Token (P / C / O)'),
								h('th', null, '耗时 / TTFT'),
								h('th', null, '状态'),
							)),
							h('tbody', null, auditRequests.map((r, i) => {
								const account = accounts.find((a) => a.id === r.accountId);
								const statusOk = typeof r.status === 'string' && !/fail|error|4\d\d|5\d\d/i.test(r.status);
								return h('tr', { key: r.requestId ?? i },
									h('td', { className: 'agy-num' }, r.timestamp ?? '—'),
									h('td', null, r.model ?? '—'),
									h('td', null, account ? (maskEmail(account.email) || account.alias) : (r.accountId ?? '未知')),
									h('td', { className: 'agy-num' }, `${formatCompactTokens(r.promptTokens ?? 0)} / ${formatCompactTokens(r.cachedTokens ?? 0)} / ${formatCompactTokens(r.outputTokens ?? 0)}`),
									h('td', { className: 'agy-num' }, `${r.latencyMs === undefined ? '—' : `${Math.round(r.latencyMs)}ms`} · ${r.ttftMs === undefined ? '—' : `${Math.round(r.ttftMs)}ms`}`),
									h('td', { style: { color: statusOk ? 'var(--agy-strong-ok)' : 'var(--agy-strong-danger)' } }, r.status ?? '—'),
								);
							})),
						);

			const sessionsView = auditSessionsLoading && auditSessions.length === 0
				? h('div', { style: { padding: '0 var(--agy-space-4)' } }, renderSkeletonRow(95, 20), renderSkeletonRow(95, 20), renderSkeletonRow(95, 20))
				: auditError
					? renderStrip('error', auditError, () => void fetchAuditSessions(20, auditSessionsPage * 20))
					: auditSessions.length === 0
						? h('div', { style: { padding: 'var(--agy-space-4)' } }, renderEmptyState('暂无会话审计记录。'))
						: h('table', { className: 'agy-table' },
							h('thead', null, h('tr', null,
								h('th', null, '更新时间'),
								h('th', null, '会话 ID'),
								h('th', null, '账号'),
								h('th', null, '请求数 (总数 / 成功 / 失败)'),
								h('th', null, 'Token (Prompt / 命中缓存 / 命中率)'),
								h('th', null, '状态/详情'),
							)),
							h('tbody', null, auditSessions.map((s, i) => {
								const account = accounts.find((a) => a.id === s.accountId);
								const shortId = s.sessionId ? `${s.sessionId.slice(0, 8)}…${s.sessionId.slice(-4)}` : '—';
								return h('tr', { key: s.sessionId ?? i },
									h('td', { className: 'agy-num' }, s.updatedAt ?? '—'),
									h('td', { title: s.sessionId }, shortId),
									h('td', null, account ? (maskEmail(account.email) || account.alias) : (s.accountId ?? '未知')),
									h('td', { className: 'agy-num' }, `${formatNumber(s.totalRequests ?? 0)} / ${formatNumber(s.totalSuccess ?? 0)} / ${formatNumber(s.totalFailed ?? 0)}`),
									h('td', { className: 'agy-num' }, `${formatCompactTokens(s.totalPromptTokens ?? 0)} / ${formatCompactTokens(s.totalCachedTokens ?? 0)} / ${typeof s.cacheHitRate === 'number' ? `${(s.cacheHitRate * 100).toFixed(1)}%` : '—'}`),
									h('td', { title: s.lastError ?? undefined, style: { color: (s.totalFailed ?? 0) > 0 ? 'var(--agy-strong-warn)' : 'var(--agy-strong-ok)' } }, s.status ?? (s.lastError ?? '—')),
								);
							})),
						);

			const totalForTab = auditTab === 'requests' ? auditTotal : auditSessionsTotal;
			const pageForTab = auditTab === 'requests' ? auditPage : auditSessionsPage;
			const setPageForTab = (next: number) => {
				if (auditTab === 'requests') setAuditPage(next);
				else setAuditSessionsPage(next);
			};
			const canPrev = pageForTab > 0;
			const canNext = (pageForTab + 1) * 20 < totalForTab;

			return portalToBody(
				h('div', {
					className: 'agy-drawer-backdrop',
					onClick: (e: { target: unknown; currentTarget: unknown }) => {
						if (e.target === e.currentTarget) setShowAuditDrawer(false);
					},
				},
					h('div', { className: 'agy-drawer', role: 'dialog', 'aria-modal': true, 'aria-label': '请求审计与会话统计' },
						h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--agy-space-2)', padding: 'var(--agy-space-3) var(--agy-space-4)', borderBottom: '1px solid var(--agy-drawer-border)' } },
							h('div', { style: S.panelTitle }, '请求审计与会话统计 (Audit Log)'),
							h('div', { style: { display: 'flex', gap: '5px' } },
								h('button', {
									className: 'agy-btn',
									style: { ...S.btnSm, background: 'var(--agy-drawer-btn-bg)', color: 'var(--agy-drawer-btn-text)', border: '1px solid var(--agy-drawer-btn-border)' },
									onClick: () => {
										if (auditTab === 'requests') void fetchAuditRequests(20, auditPage * 20);
										else void fetchAuditSessions(20, auditSessionsPage * 20);
									},
									'aria-label': '刷新审计数据',
								}, uiIcon('refresh', 12), ' 刷新'),
								h('button', {
									className: 'agy-btn',
									style: { ...S.btnSm, background: 'var(--agy-drawer-btn-bg)', color: 'var(--agy-drawer-btn-text)', border: '1px solid var(--agy-drawer-btn-border)' },
									onClick: () => setShowAuditDrawer(false),
									'aria-label': '关闭审计抽屉',
								}, uiIcon('x', 12)),
							),
						),
						summaryCards,
						h('div', { style: { padding: 'var(--agy-space-3) var(--agy-space-4) 0', display: 'flex', gap: 'var(--agy-space-2)', alignItems: 'center', flexWrap: 'wrap' } },
							h('div', { style: S.segGroup, role: 'tablist', 'aria-label': '审计视图切换' },
								h('button', {
									role: 'tab',
									'aria-selected': auditTab === 'requests',
									style: auditTab === 'requests' ? S.segBtnActive : S.segBtn,
									onClick: () => setAuditTab('requests'),
								}, '按请求明细 (Requests)'),
								h('button', {
									role: 'tab',
									'aria-selected': auditTab === 'sessions',
									style: auditTab === 'sessions' ? S.segBtnActive : S.segBtn,
									onClick: () => setAuditTab('sessions'),
								}, '按会话统计 (Sessions)'),
							),
							auditLoading || auditSessionsLoading
								? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--agy-font-xs)', color: 'var(--agy-table-faint)' } }, h('span', { className: 'agy-spinner', 'aria-hidden': true }), '加载中…')
								: null,
						),
						h('div', { style: { flex: 1, overflow: 'auto', padding: 'var(--agy-space-2) 0' } },
							auditTab === 'requests' ? requestsView : sessionsView,
						),
						h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--agy-space-2)', padding: 'var(--agy-space-3) var(--agy-space-4)', borderTop: '1px solid var(--agy-drawer-border)' } },
							h('span', { className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-table-faint)', marginRight: 'auto' } },
								`共 ${formatNumber(totalForTab)} 条 · 每页 20 条`),
							h('button', {
								className: 'agy-btn',
								style: { ...S.btnSm, background: 'var(--agy-drawer-btn-bg)', color: 'var(--agy-drawer-btn-text)', border: '1px solid var(--agy-drawer-btn-border)' },
								disabled: !canPrev,
								onClick: () => setPageForTab(pageForTab - 1),
							}, '上一页'),
							h('span', { className: 'agy-num', style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-table-soft)' } }, `第 ${pageForTab + 1} 页`),
							h('button', {
								className: 'agy-btn',
								style: { ...S.btnSm, background: 'var(--agy-drawer-btn-bg)', color: 'var(--agy-drawer-btn-text)', border: '1px solid var(--agy-drawer-btn-border)' },
								disabled: !canNext,
								onClick: () => setPageForTab(pageForTab + 1),
							}, '下一页'),
						),
					),
				),
			);
		};

		// ---- overview / usage / diagnostics / config sections ----
		const renderOverviewSection = (): unknown => {
			if (accounts.length === 0 && !status) {
				return renderEmptyState('插件状态还在加载中。', undefined);
			}
			if (accounts.length === 0) {
				return renderEmptyState(
					'账号池为空：还没有可调度的账号。添加账号后，这里会显示额度快照与运行状态。',
					h('button', { className: 'agy-btn', style: S.btnPrimary, onClick: () => setActiveSection('accounts') }, uiIcon('plus', 12), ' 添加账号'),
				);
			}
			const readyAccounts = accounts.filter((a) => a.enabled && !a.authRequired).length;
			const lastRun = status?.lastRun;
			const dormant = status?.dormantReason;
			return h('div', null,
				dormant
					? renderStrip('warn', `插件处于休眠状态：${dormant}`)
					: null,
				!pollOk
					? renderStrip('warn', `轮询中断：页面展示的是 ${formatClock(lastUpdatedAt)} 拉取的最后一次数据`)
					: null,
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap', marginBottom: 'var(--agy-space-3)' } },
					renderStatCard('可调度账号', `${readyAccounts} / ${accounts.length}`, `主用：${status?.pool?.primaryAccountId ?? '自动'}`),
					renderStatCard('授权状态', isAuthed ? '正常' : '待认证', `auth: ${status?.auth?.phase ?? '—'} · poolAuth: ${poolAuthPhase}`),
					renderStatCard('默认模型', status?.defaultModel ?? '—', `Effort：${status?.defaultEffort ?? '—'}`),
					renderStatCard('上游目录模型数', formatNumber(status?.catalog?.count ?? 0), `来源：${status?.catalog?.source ?? '—'}`),
					renderStatCard('最近一次请求', lastRun?.ok === false ? `失败 ${lastRun?.code ?? ''}` : '成功', lastRun?.model ? `${lastRun.model} · ${lastRun.durationMs ?? '—'}ms` : '—'),
				),
				h('div', { style: S.panelCaption }, '额度快照'),
				...accounts.map((acc, idx) => h('div', {
					key: acc.id,
					className: 'agy-card-hover agy-rise',
					style: { ...S.card, marginBottom: 'var(--agy-space-2)', '--i': Math.min(idx, 8) },
				},
					h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--agy-space-2)', flexWrap: 'wrap' } },
						h('span', { style: { fontWeight: 700, color: 'var(--agy-text-primary)' } },
							acc.email ? (acc.alias && !/^备用.*账号/i.test(acc.alias) && !/^主账号/i.test(acc.alias) ? acc.alias : maskEmail(acc.email)) : (acc.alias || acc.id)),
						h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => { setActiveSection('models'); ensureModelsLoaded(acc.id); } }, uiIcon('layers', 11), ' 查看模型'),
					),
					h('div', { style: { display: 'flex', gap: 'var(--agy-space-4)', flexWrap: 'wrap', marginTop: 'var(--agy-space-1)' } },
						renderQuotaBar('Gemini', 'google', acc),
						renderQuotaBar('Claude', 'anthropic', acc),
						renderQuotaBar('GPT-OSS', 'openai', acc),
					),
				)),
			);
		};

		const renderUsageSection = (): unknown => {
			return h('div', null,
				statsError ? renderStrip('error', statsError, () => void fetchStatsOverview()) : null,
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap', marginBottom: 'var(--agy-space-3)' } },
					statsOverview
						? renderStatCard('请求总数',
							formatNumber(numOf(statsOverview, 'totalRequests') ?? 0),
							`成功 ${formatNumber(numOf(statsOverview, 'totalSuccess') ?? 0)} · 失败 ${formatNumber(numOf(statsOverview, 'totalFailed') ?? 0)}`,
						)
						: h('div', { style: { ...S.statBox, flex: '1 1 150px' } }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)),
					statsOverview
						? renderStatCard('Token 汇总',
							formatCompactTokens(numOf(statsOverview, 'totalTokens') ?? 0),
							`Prompt ${formatCompactTokens(numOf(statsOverview, 'totalPromptTokens') ?? 0)} · 输出 ${formatCompactTokens(numOf(statsOverview, 'totalOutputTokens') ?? 0)}`,
						)
						: h('div', { style: { ...S.statBox, flex: '1 1 150px' } }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)),
					statsOverview
						? renderStatCard('缓存命中率',
							`${((numOf(statsOverview, 'cacheHitRate') ?? 0) * 100).toFixed(1)}%`,
							`命中 Token ${formatCompactTokens(numOf(statsOverview, 'totalCachedTokens') ?? 0)}`,
							(numOf(statsOverview, 'cacheHitRate') ?? 0) > 0.3 ? 'var(--agy-strong-ok)' : (numOf(statsOverview, 'cacheHitRate') ?? 0) >= 0.1 ? 'var(--agy-strong-warn)' : 'var(--agy-strong-neutral)',
						)
						: h('div', { style: { ...S.statBox, flex: '1 1 150px' } }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)),
					statsOverview
						? renderStatCard('平均耗时 / TTFT',
							`${Math.round(numOf(statsOverview, 'avgLatencyMs') ?? 0)}ms`,
							`TTFT ${Math.round(numOf(statsOverview, 'avgTtftMs') ?? 0)}ms · P90 ${Math.round(numOf(statsOverview, 'p90LatencyMs') ?? 0)}ms`,
						)
						: h('div', { style: { ...S.statBox, flex: '1 1 150px' } }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)),
				),
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', flexWrap: 'wrap' } },
					h('button', { className: 'agy-btn', style: S.btnPrimary, onClick: () => setShowAuditDrawer(true) }, uiIcon('activity', 12), ' 打开请求明细与会话统计'),
					h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => void fetchStatsOverview(), 'aria-label': '重新加载用量统计' }, uiIcon('refresh', 12), ' 重新加载'),
				),
			);
		};

		const renderDiagRow = (label: string, value: unknown, mono = true): unknown =>
			h('div', { style: { display: 'flex', gap: 'var(--agy-space-3)', padding: '8px 0', borderBottom: '1px solid var(--agy-border-divider)', flexWrap: 'wrap' } },
				h('span', { style: { width: '170px', color: 'var(--agy-text-tertiary)', fontSize: 'var(--agy-font-sm)', flexShrink: 0 } }, label),
				h('span', { className: mono ? 'agy-num' : undefined, style: { color: 'var(--agy-text-primary)', fontSize: 'var(--agy-font-sm)', wordBreak: 'break-all', flex: 1 } }, value),
			);

		const renderDiagnosticsSection = (): unknown => {
			const catalog: NonNullable<StatusPayload['catalog']> = status?.catalog ?? {};
			const lastRun: NonNullable<StatusPayload['lastRun']> = status?.lastRun ?? {};
			const endpointErrors = Array.isArray(catalog.endpointErrors) ? catalog.endpointErrors.length : 0;
			return h('div', null,
				!pollOk ? renderStrip('warn', `轮询中断：以下为 ${formatClock(lastUpdatedAt)} 的最后一次成功拉取`) : null,
				h('div', { className: 'agy-rise', style: S.card },
					renderDiagRow('插件状态', status ? (status.enabled === false ? '已停用' : '运行中') : '未加载', false),
					renderDiagRow('休眠原因', status?.dormantReason ?? '无', false),
					renderDiagRow('版本 / 构建校验', status?.distSha256 ? `${String(status.distSha256).slice(0, 16)}…` : (status?.version ?? '未上报')),
					renderDiagRow('上游目录', `${catalog.source ?? '—'} · ${formatNumber(catalog.count ?? 0)} 个模型${endpointErrors > 0 ? ` · ${endpointErrors} 条端点错误` : ''}`, false),
					renderDiagRow('目录最近错误', catalog.lastError ?? '无', false),
					renderDiagRow('最近一次运行', lastRun.ok === undefined ? '无记录' : `${lastRun.ok ? '成功' : `失败 (code ${lastRun.code ?? '—'})`} · ${lastRun.durationMs ?? '—'}ms · ${lastRun.model ?? '—'}`, false),
					renderDiagRow('授权阶段', `auth: ${status?.auth?.phase ?? '—'} · poolAuth: ${poolAuthPhase}`, false),
					renderDiagRow('工作区', status?.workspaceRoot ?? '未上报'),
					renderDiagRow('数据通道', `${base || '同源'}${API_PREFIX} · 3s 状态轮询 / 10s 统计轮询`),
				),
				h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)' } },
					h('button', { className: 'agy-btn', style: S.btnSmPrimary, onClick: () => void refresh(), disabled: isBusy }, uiIcon('refresh', 12), ' 立即刷新状态'),
				),
			);
		};

		const renderConfigRow = (key: string, label: string, hint: string): unknown => {
			const draft = cfgDrafts[key] ?? '';
			return h('div', { key, style: { display: 'flex', gap: 'var(--agy-space-2)', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--agy-border-divider)', flexWrap: 'wrap' } },
				h('div', { style: { width: '210px', flexShrink: 0 } },
					h('div', { style: { fontSize: 'var(--agy-font-sm)', fontWeight: 700, color: 'var(--agy-text-primary)' } }, label),
					h('div', { style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', marginTop: '2px' } }, hint),
				),
				h('input', {
					className: 'agy-input',
					style: { ...S.input, maxWidth: '380px' },
					value: draft,
					placeholder: key === 'baseUrl' ? '留空则不修改（后端不回显该值）' : hint,
					'aria-label': label,
					onChange: (e: { target: { value: string } }) => setCfgDrafts((prev) => ({ ...prev, [key]: e.target.value })),
				}),
				h('button', {
					className: 'agy-btn',
					style: S.btnSmPrimary,
					disabled: isBusy || (key !== 'baseUrl' && draft.trim() === ''),
					onClick: () => void setCfg(key, draft.trim()),
				}, '保存'),
			);
		};

		const renderConfigSection = (): unknown => {
			return h('div', null,
				h('div', { className: 'agy-rise', style: S.card },
					h('div', { style: S.panelCaption, marginBottom: 'var(--agy-space-1)' }, '可写配置（POST /config）'),
					renderConfigRow('defaultModel', '默认模型 (defaultModel)', status?.defaultModel ?? '当前值将在状态轮询后回填'),
					renderConfigRow('defaultEffort', '默认 Effort (defaultEffort)', status?.defaultEffort ?? '例如 low / medium / high'),
					renderConfigRow('baseUrl', '上游地址 (baseUrl)', '高级：仅在你明确需要切换上游时填写'),
					h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', alignItems: 'center', padding: '10px 0', flexWrap: 'wrap' } },
						h('div', { style: { width: '210px', flexShrink: 0 } },
							h('div', { style: { fontSize: 'var(--agy-font-sm)', fontWeight: 700, color: 'var(--agy-text-primary)' } }, 'Ask 工具注册 (askTool)'),
							h('div', { style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', marginTop: '2px' } }, '在 DSH 中注册 agy ask 工具开关'),
						),
						h('button', {
							className: 'agy-btn',
							role: 'switch',
							'aria-checked': status?.askTool === true,
							'aria-label': '切换 Ask 工具注册',
							style: {
								...S.btnSm,
								background: status?.askTool === true ? 'var(--agy-accent)' : 'var(--agy-bg-btn)',
								color: status?.askTool === true ? 'var(--agy-on-accent)' : 'var(--agy-text-btn)',
								border: `1px solid ${status?.askTool === true ? 'var(--agy-border-btn-primary)' : 'var(--agy-border-btn)'}`,
							},
							disabled: isBusy,
							onClick: () => void setCfg('askTool', !(status?.askTool === true)),
						}, status?.askTool === true ? '已注册' : '未注册'),
					),
				),
			);
		};

		// ---- section navigation (tablist with roving keyboard) ----
		const SECTIONS: Array<{ key: SectionKey; label: string }> = [
			{ key: 'overview', label: '总览' },
			{ key: 'accounts', label: '账号' },
			{ key: 'models', label: '模型' },
			{ key: 'usage', label: '用量统计' },
			{ key: 'diagnostics', label: '诊断' },
			{ key: 'config', label: '配置' },
		];

		const onNavKeyDown = (ev: { key?: string; preventDefault?: () => void }): void => {
			const idx = SECTIONS.findIndex((s) => s.key === activeSection);
			let next = -1;
			if (ev.key === 'ArrowRight') next = (idx + 1) % SECTIONS.length;
			else if (ev.key === 'ArrowLeft') next = (idx - 1 + SECTIONS.length) % SECTIONS.length;
			else if (ev.key === 'Home') next = 0;
			else if (ev.key === 'End') next = SECTIONS.length - 1;
			if (next < 0) return;
			ev.preventDefault?.();
			const key = SECTIONS[next]!.key;
			setActiveSection(key);
			tabRefs.current[key]?.focus?.();
		};

		const navBar = h('nav', { style: S.navBar, role: 'tablist', 'aria-label': 'Antigravity 设置分区', onKeyDown: onNavKeyDown },
			...SECTIONS.map((s) => h('button', {
				key: s.key,
				ref: (node: { focus: () => void } | null) => { tabRefs.current[s.key] = node; },
				className: 'agy-tab',
				role: 'tab',
				id: `agy-tab-${s.key}`,
				'aria-selected': activeSection === s.key,
				'aria-controls': `agy-panel-${s.key}`,
				tabIndex: activeSection === s.key ? 0 : -1,
				style: S.tab,
				onClick: () => setActiveSection(s.key),
			}, s.label)),
		);

		const sectionBody = (): unknown => {
			switch (activeSection) {
				case 'overview': return renderOverviewSection();
				case 'accounts': return h('div', null, addAccountSection, ...renderedAccountCards);
				case 'models': return renderModelsSection();
				case 'usage': return renderUsageSection();
				case 'diagnostics': return renderDiagnosticsSection();
				case 'config': return renderConfigSection();
			}
		};

		if (status === null) {
			return h('div', { className: 'agy-root', style: S.container },
				h('style', null, THEME_CSS),
				h('div', { style: S.headerCard },
					h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)' } }, agyIcon(18), h('span', { style: S.panelTitle }, 'Antigravity')),
					h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', ...S.muted } }, h('span', { className: 'agy-spinner', 'aria-hidden': true }), '正在加载状态'),
				),
				renderToastBanner(),
				navBar,
				renderSkeletonCard(),
				renderSkeletonCard(),
			);
		}

		const headerCard = h('div', { style: S.headerCard },
			h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--agy-space-2)', flexWrap: 'wrap', minWidth: 0 } },
				agyIcon(18),
				h('span', { style: S.panelTitle }, 'Antigravity'),
				h('span', { style: isAuthed ? S.badgeReady : S.badgeUnready }, isAuthed ? '就绪' : '待认证'),
				h('span', {
					className: 'agy-num',
					title: pollOk ? '状态轮询正常（3 秒间隔）' : '轮询中断，展示的是最后一次成功拉取的数据',
					style: {
						fontSize: 'var(--agy-font-xs)',
						padding: '2px 8px',
						borderRadius: 'var(--agy-radius-pill)',
						background: pollOk ? 'var(--agy-neutral-bg)' : 'var(--agy-warn-bg)',
						border: `1px solid ${pollOk ? 'var(--agy-neutral-border)' : 'var(--agy-warn-border)'}`,
						color: pollOk ? 'var(--agy-neutral-text)' : 'var(--agy-warn-text)',
					},
				}, pollOk ? `更新于 ${formatClock(lastUpdatedAt)}` : `轮询中断 · 上次成功 ${formatClock(lastUpdatedAt)}`),
			),
			h('div', { style: { display: 'flex', gap: '5px', flexWrap: 'wrap' } },
				h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => setShowAuditDrawer(true) }, uiIcon('activity', 12), ' 审计明细'),
				h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => void refreshQuota(), disabled: isBusy }, uiIcon('zap', 12), ' 刷新额度'),
				h('button', { className: 'agy-btn', style: S.btnSmPrimary, onClick: () => { setActiveSection('accounts'); setAddingAccount(true); }, disabled: isBusy }, uiIcon('plus', 12), ' 添加账号'),
				h('button', { className: 'agy-btn', style: S.btnSm, onClick: () => void refresh(), disabled: isBusy, 'aria-label': '刷新插件状态' }, uiIcon('refresh', 12)),
			),
		);

		return h('div', { className: 'agy-root', style: S.container },
			h('style', null, THEME_CSS),
			headerCard,
			renderToastBanner(),
			navBar,
			h('div', {
				key: activeSection,
				id: `agy-panel-${activeSection}`,
				role: 'tabpanel',
				'aria-labelledby': `agy-tab-${activeSection}`,
				tabIndex: 0,
			}, sectionBody()),
			renderAuditDrawer(),
		);
	};

	// Single product entry (user rule): the settings page only — no chat-UI injection anymore.
	ctx.slots.inject('settings.section', () => {
		const dispose = ctx.slots.register(
			{
				name: 'settings.section',
				id: 'agy-link',
				order: 20,
				label: 'Antigravity',
			},
			AgySettingsSection,
		);
		return dispose;
	});
}
