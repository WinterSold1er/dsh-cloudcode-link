// Client UI redesign test suite (v2 — behavior-first).
//
// Why the rewrite: the previous revision of this file was 100% static string auditing, and
// the adversarial review proved that bypassable — assertions like "source contains
// `payload: prevPanel?.payload`" stayed green while the initial-load path silently cleared
// panel data. This suite splits into two explicitly labeled layers:
//
//   BEHAVIOUR   — decision logic imported from the react-free layers (poll-state.ts and,
//                 in test/client-account-models.test.ts, account-models.ts) and exercised
//                 through real state transitions. Sabotaging the logic fails these.
//   STRUCTURAL  — wiring audits that can only be checked at the source level. They are
//                 written count-/shape-based so sabotage (a dangling aria-controls id, a
//                 literal `payload: null` write, the 2.2s breathe re-added to model rows,
//                 a re-introduced top-level 1s setState) flips them red. The underlying
//                 behavior risks are covered by test/client-account-models.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { accountAddFlowView, applyPollOutcome, seedConfigDrafts } from '../src/client/poll-state.ts';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

const clientSource = read('../src/client/index.ts');
const themeSource = read('../src/client/theme.ts');
const modelsSource = read('../src/client/account-models.ts');

const count = (src: string, re: RegExp): number => (src.match(new RegExp(re.source, 'g')) ?? []).length;

const T0 = 1_763_000_000_000; // "last known good" epoch
const T1 = T0 + 3_000; // next poll tick

// ============ BEHAVIOUR: poll recovery (defect: 轮询中断 stuck) ============

test('B1. any successful poll clears the 轮询中断 state, even when the status JSON is unchanged', () => {
	const recovered = applyPollOutcome({ pollOk: false, lastUpdatedAt: T0 }, { ok: true, statusChanged: false }, T1);
	assert.equal(recovered.pollOk, true, 'a healthy response after an outage must restore pollOk — it used to be skipped by the unchanged-JSON shortcut');
	assert.equal(recovered.lastUpdatedAt, T1, 'recovery must re-stamp the last successful update time');

	const changed = applyPollOutcome({ pollOk: true, lastUpdatedAt: T0 }, { ok: true, statusChanged: true }, T1);
	assert.equal(changed.pollOk, true);
	assert.equal(changed.lastUpdatedAt, T1, 'new data must advance the freshness stamp');

	const steady = applyPollOutcome({ pollOk: true, lastUpdatedAt: T0 }, { ok: true, statusChanged: false }, T1);
	assert.equal(steady.pollOk, true);
	assert.equal(steady.lastUpdatedAt, T0, 'unchanged healthy data keeps the old stamp so React skips the re-render');

	const down = applyPollOutcome({ pollOk: true, lastUpdatedAt: T0 }, { ok: false, statusChanged: false }, T1);
	assert.equal(down.pollOk, false, 'a failed poll must mark the page stale');
	assert.equal(down.lastUpdatedAt, T0, 'a failed poll must never erase the last known good time');
});

// ============ BEHAVIOUR: config backfill (defect: form never backfills) ============

test('B2. config drafts backfill only untouched fields; a null status must not freeze drafts to empty', () => {
	const status = { defaultModel: 'gemini-3-flash', defaultEffort: 'high' };

	// Status not loaded yet: drafts stay untouched ('' would masquerade as a user edit).
	assert.deepEqual(seedConfigDrafts({}, null), {}, 'a null status must not seed empty strings');

	// First real status seeds both fields.
	assert.deepEqual(seedConfigDrafts({}, status), { defaultModel: 'gemini-3-flash', defaultEffort: 'high' });

	// A user-typed value (including a deliberately cleared '') is never overwritten.
	assert.deepEqual(seedConfigDrafts({ defaultModel: '' }, status), { defaultModel: '', defaultEffort: 'high' });
	assert.deepEqual(seedConfigDrafts({ defaultModel: 'user-choice', defaultEffort: 'low' }, status), { defaultModel: 'user-choice', defaultEffort: 'low' });

	// A status without a value leaves the field undefined ("unedited"), so a later status CAN still backfill it.
	const seeded = seedConfigDrafts({}, {});
	assert.deepEqual(seeded, {}, 'no backend value must not be recorded as an edit');
	assert.deepEqual(seedConfigDrafts(seeded, status), { defaultModel: 'gemini-3-flash', defaultEffort: 'high' }, 'backfill still works after the first status had no values');
});

// ============ BEHAVIOUR: add-account flow view (defect: browser-login entry unreachable) ============

test('B3. add-account modal keeps browser login reachable whenever the flow is not running', () => {
	// Opened from the top bar (idle): alias + browser login row available.
	const idle = accountAddFlowView(true, 'idle');
	assert.equal(idle.flowActive, false);
	assert.equal(idle.showBrowserStart, true, '打开浏览器登录 must render inside the modal when idle');

	// Flow running: status banner instead of start controls (no duplicate entry points).
	for (const phase of ['waiting', 'exchanging']) {
		const running = accountAddFlowView(true, phase);
		assert.equal(running.flowActive, true, `phase=${phase} is a live flow`);
		assert.equal(running.showBrowserStart, false);
	}

	// Failed activation: the browser attempt is offered again as a recovery path.
	const failed = accountAddFlowView(true, 'failed');
	assert.equal(failed.flowActive, false);
	assert.equal(failed.showBrowserStart, true, 'failed 后「打开浏览器登录」入口必须回到弹窗');

	// The view exposes exactly the fields the component consumes. The manual-code box is
	// rendered unconditionally by the modal (deliberately usable while a flow runs — asserted
	// in S5) and the failure banner is gated from poolAuthPhase directly in index.ts; dead
	// gating fields must not creep back into AccountAddFlowView.
	for (const view of [idle, accountAddFlowView(true, 'waiting'), failed]) {
		assert.deepEqual(Object.keys(view).sort(), ['flowActive', 'showBrowserStart'], 'AccountAddFlowView must not carry unconsumed gating fields');
	}
});

// ============ STRUCTURAL: wiring audits (count-/shape-based, sabotage-sensitive) ============

test('S1. STRUCTURAL AUDIT — aria-controls always points at a panel id produced by one helper', () => {
	// Risk behaviorally neutralized only if BOTH sides share modelsPanelDomId (helper itself
	// is behavior-tested in client-account-models.test.ts #9).
	assert.equal(modelsSource.includes('export function modelsPanelDomId'), true, 'panel id must have a single source of truth');
	assert.equal(count(clientSource, /aria-controls':\s*modelsPanelDomId\(/), 2, 'both expand buttons (account card + models tab) must use the helper');
	// renderModelPanel must mount the panel container with the helper id in EVERY expanded
	// state (initial skeleton / empty model pool / filtered-empty / normal list) — a branch
	// without the id leaves the head button's aria-controls dangling in exactly that state.
	const panelStart = clientSource.indexOf('const renderModelPanel = (');
	const panelEnd = clientSource.indexOf('const renderModelsSection = (');
	assert.ok(panelStart >= 0 && panelEnd > panelStart, 'renderModelPanel body region must be locatable for the branch audit');
	const panelSlice = clientSource.slice(panelStart, panelEnd);
	assert.equal(count(panelSlice, /id:\s*modelsPanelDomId\(acc\.id\)/), 4, 'every expanded renderModelPanel branch (skeleton / empty pool / filtered-empty / list) must mount the shared panel id');
	assert.equal(count(panelSlice, /role:\s*'region'/), 4, 'each panel branch keeps its region role + label alongside the id');
	assert.equal(count(clientSource, /id:\s*modelsPanelDomId\(/), 5, 'account-card detail + the four model-panel branches all mount the helper id');
	assert.equal(clientSource.includes('`models-panel-'), false, 'no hand-built panel id literal may float around in the component');
});

test('S2. STRUCTURAL AUDIT — no failed path writes a literal payload-null; retention goes through the tested helpers', () => {
	assert.equal(clientSource.includes('payload: null'), false, 'the component must not hard-clear a panel payload anywhere (behavior asserted in client-account-models #3/#4)');
	assert.equal(count(clientSource, /markPanelLoadFailure\(/), 1, 'initial-load failure must delegate to the retention helper');
	assert.equal(count(clientSource, /markPanelRefreshFailure\(/), 1, 'refresh failure must delegate to the retention helper');
	assert.equal(count(clientSource, /markPanelSuccess\(/), 2, 'both GET and POST success paths must use the shared success transition');
});

test('S3. STRUCTURAL AUDIT — the 2.2s cooldown breathe is reserved for genuine cooldown elements', () => {
	// theme.ts:444 defines agy-breathe as a 2.2s infinite box-shadow animation; applying it to
	// every model-row reset time is visual noise. Exactly one usage: the account cooldown strip.
	assert.equal(count(clientSource, /agy-cooldown-breathe/), 1, 'only the account-level cooldown strip may breathe');
	assert.equal(themeSource.includes('.agy-cooldown-breathe'), true, 'the animation stays defined for that strip');
	// Model rows render the self-ticking ResetCountdown instead.
	assert.equal(count(clientSource, /h\(ResetCountdown,/), 2, 'quota bars and model rows use the countdown component');
});

test('S4. STRUCTURAL AUDIT — no per-second top-level setState; ticking is confined to ResetCountdown with stable SVG gradient ids', () => {
	assert.equal(clientSource.includes('setNowTick'), false, 'the 1s page-wide tick must be gone');
	assert.equal(clientSource.includes('function ResetCountdown'), true, 'a self-ticking leaf component must own the 1s interval');
	assert.equal(count(clientSource, /setInterval\(/), 3, 'exactly three intervals: poll (3s), stats (10s), ResetCountdown (1s)');
	const intervalLines = clientSource.split('\n').filter((line) => line.includes('setInterval('));
	assert.equal(intervalLines.length, 3, 'exactly three intervals: poll (3s), stats (10s), ResetCountdown (1s)');
	assert.equal(intervalLines.filter((line) => /\b1000\)/.test(line)).length, 1, 'exactly one 1s interval');
	assert.equal(intervalLines.filter((line) => /1000\)/.test(line) && line.includes('setTick')).length, 1, 'the 1s interval must belong to ResetCountdown\'s own state');
	assert.equal(clientSource.includes('agyIconGradientIds'), true, 'gradient ids are cached per size');
	assert.equal(clientSource.includes('agyIconSeq'), false, 'the per-render ++ gradient id counter must be gone (SVG churn)');
});

test('S5. STRUCTURAL AUDIT — add-account browser entry and error/retry affordances are wired in the component', () => {
	assert.equal(clientSource.includes('addFlow.showBrowserStart'), true, 'the modal renders the browser-login row from the tested flow view');
	assert.equal(count(clientSource, /打开浏览器登录/), 2, 'idle entry and in-modal entry both exist');
	assert.equal(clientSource.includes('轮询中断'), true, 'poll-stale chip exists (recovery itself is asserted in B1)');
	assert.equal(clientSource.includes('模型端点不可用'), true, 'endpoint errors surface the mapped contract error');
	assert.equal(clientSource.includes('重试'), true, 'error strips offer retry (explicit path; auto-reload is asserted in client-account-models #10)');
	// Honest status wording: the error strip distinguishes retained discovery from quota fallback.
	assert.equal(clientSource.includes('最近一次成功发现的模型数据'), true, 'kept-payload wording for error panels with retained data');
	assert.equal(clientSource.includes('兜底模型数据'), true, 'fallback wording only when the panel truly has no payload');
	// The manual-code box is unconditional inside the modal (deliberately usable while a flow
	// runs) and the failure banner is gated straight from poolAuthPhase — no dead gating field
	// may return as a middleman for either.
	assert.equal(clientSource.includes('showManualCode'), false, 'dead manual-code gate must not return as a UI condition');
	assert.equal(clientSource.includes('showFailedNotice'), false, 'dead failed-notice gate must not return as a UI condition');
	assert.equal(count(clientSource, /'手动激活'\)/), 1, 'the manual-activation row renders regardless of flow phase');
	assert.equal(count(clientSource, /poolAuthPhase === 'failed'/), 1, 'the failure banner keeps its direct phase gate');
});

test('S6. STRUCTURAL AUDIT — coverage diff and fallback source labels are rendered from the tested layer', () => {
	assert.equal(clientSource.includes('computeModelUnion('), true, 'coverage denominator comes from the union helper (#6/#7 behavior-tested)');
	assert.equal(clientSource.includes('computeOtherAccountModelIds('), true, 'shared/exclusive split comes from the union helper');
	assert.equal(clientSource.includes('selectPanelPayload('), true, 'both panel renderers share one payload selection (no private ok-only variant)');
	assert.equal(clientSource.includes('accountModelIds('), true, 'badge counts use the same ids the panel renders');
	assert.equal(count(clientSource, /来源：最近一次额度同步/), 2, 'quota-fallback source is labelled in both panel variants');
});

test('S7. STRUCTURAL AUDIT — chat-header injection is gone; settings.section is the only entry', () => {
	assert.equal(clientSource.includes('conversation.session.header.actions'), false, 'chat header slot must not be referenced anywhere');
	assert.equal(clientSource.includes('AgySessionStatus'), false, 'badge component must be deleted');
	assert.equal(clientSource.includes('AgyModalDialog'), false, 'badge modal component must be deleted');
	assert.equal(clientSource.includes('agyModalStore'), false, 'badge-only store must be deleted');
	assert.equal(count(clientSource, /ctx\.slots\.inject\(/), 1, 'exactly one slot injection must remain');
	assert.equal(clientSource.includes("ctx.slots.inject('settings.section'"), true, 'settings.section injection must exist');
	assert.equal(clientSource.includes("name: 'settings.section'"), true, 'register must target the settings.section slot');
	assert.equal(clientSource.includes("id: 'agy-link'"), true, 'settings entry id preserved');
});

test('S8. STRUCTURAL AUDIT — model panel stays wired to the pool/account-models contract endpoint', () => {
	// Contract-level behavior lives in test/account-models-api.test.ts; this audits the wiring.
	assert.equal(modelsSource.includes('/pool/account-models'), true, 'account-models module must call the contract endpoint');
	assert.equal(modelsSource.includes('id=${encodeURIComponent(id)}'), true, 'GET must pass the account id as a query param');
	assert.equal(/refresh:\s*true/.test(modelsSource), true, 'refresh must be requested via POST body { id, refresh: true }');
	assert.equal(modelsSource.includes('account_not_found'), true, '404 contract error must be mapped for honest UI display');
});

test('S9. STRUCTURAL AUDIT — color literals stay confined to the token-definition block', () => {
	const colorRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g;
	assert.deepEqual(clientSource.match(colorRe) ?? [], [], 'src/client/index.ts must consume tokens, never raw colors');
	assert.deepEqual(modelsSource.match(colorRe) ?? [], [], 'account-models.ts is logic-only and must be color-free');
	const pollStateSource = read('../src/client/poll-state.ts');
	assert.deepEqual(pollStateSource.match(colorRe) ?? [], [], 'poll-state.ts is logic-only and must be color-free');
	const start = themeSource.indexOf('/* agy-tokens:start */');
	const end = themeSource.indexOf('/* agy-tokens:end */');
	assert.ok(start >= 0 && end > start, 'theme.ts must expose explicit token-block markers');
	const outside = themeSource.slice(0, start) + themeSource.slice(end);
	assert.deepEqual(outside.match(colorRe) ?? [], [], 'every literal color must live inside the token block');
	assert.equal(clientSource.includes("h('style', null, THEME_CSS)"), true, 'component must inject the token stylesheet');
	assert.equal(clientSource.includes('var(--agy-'), true, 'component styles must be token-driven');
});
