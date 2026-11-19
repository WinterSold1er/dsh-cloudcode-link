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
import { existsSync, readFileSync } from 'node:fs';

import { accountAddFlowView, applyPollOutcome, seedConfigDrafts } from '../src/client/poll-state.ts';
import { settingsNavPaint, settingsNavProps, settingsNavShapes } from '../src/client/brand-icons.ts';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

const clientSource = read('../src/client/index.ts');
const themeSource = read('../src/client/theme.ts');
const brandSource = read('../src/client/brand-icons.ts');
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

// ============ BEHAVIOUR: settings nav glyph (defect: settings row had no own icon) ============

test('B4. nav-glyph props normalize whatever the shell passes; anything unusable falls back to 16px inactive', () => {
	assert.deepEqual(settingsNavProps({ size: 16, active: true }), { size: 16, active: true });
	// The shell owns the button and may mount the contribution with no props at all.
	assert.deepEqual(settingsNavProps(undefined), { size: 16, active: false }, 'a props-less mount must still render a glyph');
	assert.deepEqual(settingsNavProps(null), { size: 16, active: false });
	assert.deepEqual(settingsNavProps({}), { size: 16, active: false });
	assert.deepEqual(settingsNavProps('nonsense'), { size: 16, active: false }, 'a non-object must not be indexed for props');
	// A size that cannot produce a visible box must fall back rather than draw nothing.
	for (const size of [0, -4, Number.NaN, Number.POSITIVE_INFINITY, '16']) {
		assert.deepEqual(settingsNavProps({ size }), { size: 16, active: false }, `size=${String(size)} must fall back to the shell default`);
	}
	assert.deepEqual(settingsNavProps({ size: 20, active: 'true' }), { size: 20, active: false }, 'only a real true marks the row active');
});

test('B5. nav-glyph geometry: ring behind core, token paint only, and legible inside the 24-unit canvas at 16px', () => {
	const shapes = settingsNavShapes(false);
	assert.equal(shapes.length, 2, 'the mark is one orbit ring plus one solid core');
	assert.deepEqual(shapes.map((s) => s.tag), ['ellipse', 'circle'], 'the ring is drawn first so the core covers it — the orbit reads as passing behind the core');
	const [ring, core] = [shapes[0]!, shapes[1]!];
	assert.equal(ring.attrs.fill, 'none', 'the ring is a stroke, not a filled blob');
	assert.equal(ring.attrs.stroke, settingsNavPaint(false));
	assert.equal(core.attrs.fill, settingsNavPaint(false), 'core and ring share one paint so the mark stays one color');
	// Token-driven, no literals: the glyph inherits the shell's nav text color.
	const paints = shapes.flatMap((s) => Object.values(s.attrs)).filter((v) => typeof v === 'string') as string[];
	assert.deepEqual(paints.filter((v) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(v)), [], 'the glyph must not carry literal colors');
	assert.equal(settingsNavPaint(false), 'currentColor', 'inactive inherits the shell nav text color');
	assert.equal(settingsNavPaint(true), 'var(--agy-accent, currentColor)', 'active uses the panel accent token, with currentColor as the fallback before the panel stylesheet mounts');
	assert.equal(settingsNavShapes(true)[1]!.attrs.fill, settingsNavPaint(true), 'active paint reaches the core');
	assert.equal(settingsNavShapes(true)[0]!.attrs.stroke, settingsNavPaint(true), 'active paint reaches the ring');

	const num = (v: string | number | undefined): number => Number(v);
	const stroke = num(ring.attrs['stroke-width']);
	const rx = num(ring.attrs.rx), ry = num(ring.attrs.ry), coreR = num(core.attrs.r);
	const rotate = num(/rotate\((-?[\d.]+)/.exec(String(ring.attrs.transform))?.[1]);
	assert.ok(stroke > 0 && rx > 0 && ry > 0 && coreR > 0, 'all geometry must be positive');
	// Derived half-extents of the rotated ring, stroke included, must stay inside the 24-unit canvas.
	const halfX = Math.hypot(rx * Math.cos(rotate * Math.PI / 180), ry * Math.sin(rotate * Math.PI / 180)) + stroke / 2;
	const halfY = Math.hypot(rx * Math.sin(rotate * Math.PI / 180), ry * Math.cos(rotate * Math.PI / 180)) + stroke / 2;
	assert.ok(halfX <= 12 && halfY <= 12, `ring half-extents ${halfX.toFixed(2)}x${halfY.toFixed(2)} must fit the 24-unit viewBox`);
	assert.ok(ry >= coreR, 'the ring line must not cut through the middle of the core');
	assert.ok(coreR + stroke <= rx, 'the ring must clear the core along its major axis');

	// Legibility at the shell's 16px: stroke and core must survive the 24→16 scale-down.
	const scale = 16 / 24;
	assert.ok(stroke * scale >= 1, `ring stroke renders ${stroke * scale}px at 16px — it must stay at least 1px`);
	assert.ok(2 * coreR * scale >= 4, `core diameter renders ${2 * coreR * scale}px at 16px — it must stay a visible dot`);
	assert.ok(2 * halfX * scale >= 10, 'the mark must still fill most of the 16px seat');
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

test('S7. STRUCTURAL AUDIT — chat-header injection is gone; the settings page and its nav-icon seat are the only entries', () => {
	assert.equal(clientSource.includes('conversation.session.header.actions'), false, 'chat header slot must not be referenced anywhere');
	assert.equal(clientSource.includes('AgySessionStatus'), false, 'badge component must be deleted');
	assert.equal(clientSource.includes('AgyModalDialog'), false, 'badge modal component must be deleted');
	assert.equal(clientSource.includes('agyModalStore'), false, 'badge-only store must be deleted');
	assert.equal(count(clientSource, /ctx\.slots\.inject\(/), 2, 'exactly two injections: the settings page and its nav-icon seat — no other UI seat may creep back');
	assert.equal(clientSource.includes("ctx.slots.inject('settings.section',"), true, 'settings.section injection must exist');
	assert.equal(clientSource.includes("ctx.slots.inject('settings.section.icon',"), true, 'the optional nav-icon seat must be injected by the same apply() so it shares the page lifecycle');
	assert.equal(count(clientSource, /ctx\.slots\.register\(/), 2, 'each injection registers exactly once (no duplicate registration on re-apply)');
	assert.equal(count(clientSource, /name: 'settings.section',/), 1, 'exactly one settings.section registration');
	assert.equal(count(clientSource, /name: 'settings\.section\.icon',/), 1, 'exactly one nav-icon registration');
	assert.equal(clientSource.includes("name: 'settings.section'"), true, 'register must target the settings.section slot');
	// The shell addresses the icon seat by the target section's id: both registrations must
	// read one constant, otherwise the two ids drift and the glyph silently never renders.
	assert.equal(clientSource.includes("const SETTINGS_SECTION_ID = 'agy-link'"), true, 'settings entry id preserved in a single constant');
	assert.equal(count(clientSource, /id:\s*SETTINGS_SECTION_ID/), 2, 'section id and icon id must come from the same constant');
	assert.equal(count(clientSource, /id: 'agy-link'/), 0, 'no loose entry-id literal may survive beside the constant');
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

test('S10. STRUCTURAL AUDIT — the nav glyph is on the render path (not a declared-but-unused component) and the product name is CloudCode Link', () => {
	// Declared once, consumed exactly once: an icon component nobody registers is dead code
	// and the row silently keeps the shell's default gear.
	assert.equal(count(clientSource, /function AgySettingsNavIcon\(/), 1, 'the nav-icon component must be declared exactly once');
	assert.equal(count(clientSource, /AgySettingsNavIcon/g), 2, 'declaration + the settings.section.icon registration consume it');
	const start = clientSource.indexOf('function AgySettingsNavIcon(');
	const end = clientSource.indexOf('\n}', start);
	assert.ok(start >= 0 && end > start, 'the nav-icon body must be locatable for the render-path audit');
	const body = clientSource.slice(start, end);
	assert.equal(body.includes('settingsNavProps(props)'), true, 'the render path must normalize the shell props through the tested helper');
	assert.equal(body.includes('settingsNavShapes(active)'), true, 'the render path must draw the tested shape set');
	assert.equal(body.includes("'aria-hidden': true"), true, 'the mark must not add a second accessible name to the shell-owned row');
	assert.equal(body.includes("viewBox: '0 0 24 24'"), true, 'the glyph is drawn on the same 24-unit canvas the shape helper measures');
	assert.equal(body.includes('width: size') && body.includes('height: size'), true, 'the shell-passed size must drive the glyph box');
	assert.equal(body.includes('url(#'), false, 'the 16px glyph must not carry gradient defs (they smear at that size and force SVG repaint)');
	// The registration must hand the shell that component, not some other node.
	const iconRegister = clientSource.slice(clientSource.indexOf("name: 'settings.section.icon'"), clientSource.indexOf('AgySettingsNavIcon,', clientSource.indexOf("name: 'settings.section.icon'")));
	assert.ok(iconRegister.includes('SETTINGS_SECTION_ID'), 'the icon seat is addressed by the section id constant');
	assert.ok(clientSource.slice(clientSource.indexOf("name: 'settings.section'")).includes('AgySettingsSection,'), 'the section registration still mounts the settings page');

	// One label constant drives every user-visible product name in the client half.
	assert.equal(clientSource.includes("const SETTINGS_SECTION_LABEL = 'CloudCode Link'"), true, 'the settings entry is named CloudCode Link');
	assert.equal(count(clientSource, /SETTINGS_SECTION_LABEL/g), 5, 'nav row label, both panel titles and the tablist aria-label all read the constant');
	// Rename audit: no leftover product name anywhere in the client half (agy-* tokens and
	// agy-* ids stay on purpose — they are style/wiring names, not the product name).
	for (const [file, src] of [
		['src/client/index.ts', clientSource],
		['src/client/theme.ts', themeSource],
		['src/client/brand-icons.ts', brandSource],
		['src/client/account-models.ts', modelsSource],
		['src/client/poll-state.ts', read('../src/client/poll-state.ts')],
	] as const) {
		assert.deepEqual((src.match(/antigravity/gi) ?? []) as string[], [], `${file} must not spell the product name Antigravity`);
	}
});

test('S11. STRUCTURAL AUDIT — package metadata publishes the plugin artwork the Plugins page renders', () => {
	const pkg = JSON.parse(read('../package.json')) as { exports?: Record<string, unknown>; files?: string[]; icon?: string };
	const icon = pkg.exports?.['./icon'];
	assert.equal(typeof icon, 'string', 'exports["./icon"] must exist so the Host resolves plugin artwork without evaluating plugin code');
	const iconPath = String(icon);
	assert.ok(iconPath.startsWith('./'), 'the icon export must be a package-relative path');
	assert.ok(!iconPath.includes('..'), 'the icon must stay inside the package');
	assert.equal(pkg.exports?.['./package.json'], './package.json', 'the manifest export is what the Host reads for the fallback title/description');
	const iconUrl = new URL(iconPath.slice(2), new URL('../', import.meta.url));
	assert.ok(existsSync(iconUrl), `${iconPath} must exist in the package`);
	const svg = read(`../${iconPath.slice(2)}`);
	assert.ok(svg.includes('<svg'), `${iconPath} must be an SVG document`);
	assert.equal(/<script|<style|href="/.test(svg), false, 'plugin artwork must be self-contained: no scripts, stylesheets or external references');
	assert.ok(svg.includes('viewBox='), 'the artwork must declare its canvas');
	assert.ok(Buffer.byteLength(svg, 'utf8') <= 256 * 1024, 'the Host rejects plugin icons above 256 KiB');
	const openTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
	const dims = [...openTag.matchAll(/\s(width|height)="(\d+)"/g)].map((m) => Number(m[2]));
	assert.equal(dims.length, 2, 'the artwork must declare both width and height');
	assert.equal(dims[0]!, dims[1]!, 'plugin artwork is drawn on a square card seat');
	assert.ok(dims[0]! >= 24, 'the declared artwork box must be large enough to stay sharp on the plugin card');
	assert.ok(svg.includes('<circle') && svg.includes('<ellipse') && svg.includes('rotate('), 'the plugin icon uses the same ring-behind-core mark as the nav glyph');
	// npm only ships what files[] lists; the export is useless in an installed package otherwise.
	const shipped = (pkg.files ?? []).map((f) => f.replace(/^\.\//, ''));
	assert.equal(shipped.includes(iconPath.replace(/^\.\//, '')), true, `${iconPath} must be listed in files so installed packages actually carry it`);
	// The Host prefers a manifest-declared icon and only falls back to the ./icon export;
	// both must name the same artwork or the plugin card changes depending on the path taken.
	assert.equal(pkg.icon, iconPath, 'the manifest icon field must name the same artwork as the ./icon export');
});
