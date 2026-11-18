// Behaviour tests for the client model-panel data layer (src/client/account-models.ts).
// These exercise the exported decision functions directly — payload priority, retention
// across failed (re)loads, fallback labelling consistency, cross-account coverage math,
// and quota-fallback adaptation. They fail if the implementation is sabotaged; no source
// string auditing here.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	EMPTY_PANEL,
	accountModelIds,
	buildQuotaFallbackPayload,
	collectStalePanelAccounts,
	computeModelUnion,
	computeOtherAccountModelIds,
	formatQuotaWindow,
	markPanelLoadFailure,
	markPanelRefreshFailure,
	markPanelSuccess,
	modelsPanelDomId,
	selectPanelPayload,
	type AccountModelsPayload,
	type ModelPanelState,
} from '../src/client/account-models.ts';
import type { ManagedAccount, ModelFamily } from '../src/common/pool-types.ts';

const NOW = 1_763_000_000_000; // fixed epoch so TTL/countdown math is deterministic

function makeAccount(id: string, quotas: Partial<Record<ModelFamily, { models?: { modelId: string; displayName?: string; remainingFraction?: number; resetTime?: string }[] }>> = {}): ManagedAccount {
	return {
		id,
		alias: `acc-${id}`,
		dir: `/tmp/accounts/${id}`,
		enabled: true,
		createdAt: NOW - 10_000,
		cooldowns: {},
		quotas: quotas as ManagedAccount['quotas'],
	};
}

function makePayload(families: { family: ModelFamily; models: { id: string; name?: string }[] }[]): AccountModelsPayload {
	return {
		ok: true,
		id: 'any',
		known: true,
		total: families.reduce((n, f) => n + f.models.length, 0),
		refreshedAt: NOW - 5_000,
		familyModels: families.map((f) => ({
			family: f.family,
			known: true,
			models: f.models.map((m) => ({ id: m.id, name: m.name ?? m.id, family: f.family })),
		})),
	};
}

function apiPanel(payload: AccountModelsPayload, overrides: Partial<ModelPanelState> = {}): ModelPanelState {
	return { status: 'ok', payload, source: 'api', error: null, refreshError: null, fetchedAt: NOW - 2_000, ...overrides };
}

test('1. panel payload wins over quota fallback regardless of panel status (ok / loading / error)', () => {
	const acc = makeAccount('a1', { google: { models: [{ modelId: 'quota-only-model' }] } });
	const payload = makePayload([{ family: 'google', models: [{ id: 'api-model', name: 'API Model' }] }]);

	for (const status of ['ok', 'loading', 'error'] as const) {
		const sel = selectPanelPayload(apiPanel(payload, { status }), acc);
		assert.equal(sel.payload, payload, `status=${status}: the panel payload must be the rendered data`);
		assert.equal(sel.usingFallback, false, `status=${status}: API-sourced payload must not be labelled fallback`);
	}

	// A retained quota-fallback payload (source from the data, not the last attempt).
	const kept = apiPanel(payload, { status: 'error', source: 'quota-fallback' });
	const keptSel = selectPanelPayload(kept, acc);
	assert.equal(keptSel.payload, payload);
	assert.equal(keptSel.usingFallback, true, 'quota-sourced payload must be labelled as fallback even when status is error');
});

test('2. payload == null panels fall back to the quota list; usingFallback says so', () => {
	const acc = makeAccount('a2', { anthropic: { models: [{ modelId: 'claude-x', displayName: 'Claude X' }] } });
	const sel = selectPanelPayload(EMPTY_PANEL, acc);
	assert.equal(sel.usingFallback, true);
	assert.deepEqual(sel.payload.familyModels.map((g) => g.models.map((m) => m.id)), [['claude-x']]);

	const missingSel = selectPanelPayload(undefined, acc);
	assert.equal(missingSel.usingFallback, true);
	assert.deepEqual(missingSel.payload.familyModels[0]?.models[0]?.name, 'Claude X');
});

test('3. failed initial load keeps the previous payload AND its source (no silent wipe)', () => {
	const acc = makeAccount('a3');
	const oldPayload = makePayload([{ family: 'google', models: [{ id: 'gemini-kept' }] }]);
	const prev = apiPanel(oldPayload, { fetchedAt: NOW - 60_000 });

	const failed = markPanelLoadFailure(prev, 'network_unreachable', NOW);
	assert.equal(failed.status, 'error');
	assert.equal(failed.payload, oldPayload, 'a failed GET must not discard discovered models');
	assert.equal(failed.source, 'api', 'the source label follows the data, not the failed fetch attempt');
	assert.equal(failed.error, 'network_unreachable');
	assert.equal(failed.refreshError, null);

	// And the UI selection really renders the retained data instead of quota fallback.
	const sel = selectPanelPayload(failed, acc);
	assert.equal(sel.payload, oldPayload);
	assert.equal(sel.usingFallback, false);
	assert.deepEqual(accountModelIds(acc, failed), ['gemini-kept']);
});

test('4. failed refresh keeps prior data visible and records refreshError; success replaces it', () => {
	const acc = makeAccount('a4', { google: { models: [{ modelId: 'quota-fallback-model' }] } });
	const oldPayload = makePayload([{ family: 'openai', models: [{ id: 'gpt-kept' }] }]);
	const prev = apiPanel(oldPayload);

	const failed = markPanelRefreshFailure(prev, 'models_refresh_failed', NOW);
	assert.equal(failed.status, 'error');
	assert.equal(failed.payload, oldPayload);
	assert.equal(failed.source, 'api');
	assert.equal(failed.refreshError, 'models_refresh_failed');

	// Failure on top of an older quota-fallback payload keeps that source too.
	const fallbackPanel: ModelPanelState = { ...EMPTY_PANEL, payload: buildQuotaFallbackPayload(acc), source: 'quota-fallback', status: 'error' };
	const failedAgain = markPanelRefreshFailure(fallbackPanel, 'http_500', NOW);
	assert.equal(failedAgain.source, 'quota-fallback', 'retained fallback data must keep its fallback source label');
	assert.deepEqual(accountModelIds(acc, failedAgain), ['quota-fallback-model']);

	// A successful fetch replaces everything and re-labels the source honestly.
	const newPayload = makePayload([{ family: 'google', models: [{ id: 'gemini-new' }] }]);
	const ok = markPanelSuccess(failed, newPayload, null, NOW);
	assert.equal(ok.status, 'ok');
	assert.equal(ok.payload, newPayload);
	assert.equal(ok.source, 'api');
	assert.equal(ok.error, null);
	assert.equal(ok.refreshError, null);
});

test('5. usingFallback always matches the data actually rendered (selection/label consistency)', () => {
	const acc = makeAccount('a5', { google: { models: [{ modelId: 'quota-model' }] } });
	const apiData = makePayload([{ family: 'google', models: [{ id: 'api-model' }] }]);

	const cases: ModelPanelState[] = [
		apiPanel(apiData),
		apiPanel(apiData, { status: 'error' }),
		{ ...EMPTY_PANEL, status: 'error', payload: apiData, source: 'api' },
		{ ...EMPTY_PANEL, status: 'error', payload: buildQuotaFallbackPayload(acc), source: 'quota-fallback' },
		EMPTY_PANEL,
	];
	for (const [i, panel] of cases.entries()) {
		const sel = selectPanelPayload(panel, acc);
		// The label must exactly describe whether the returned payload is the panel's own data.
		const renderedPanelData = sel.payload === panel.payload;
		assert.equal(
			sel.usingFallback,
			renderedPanelData ? panel.source !== 'api' : true,
			`case ${i}: usingFallback must describe the payload actually returned`,
		);
		// ids rendered by the card/badge must be the ids of the selected payload — never diverge.
		const idsFromSelection = sel.payload.familyModels.flatMap((g) => g.models.map((m) => m.id));
		assert.deepEqual(accountModelIds(acc, panel), idsFromSelection, `case ${i}: badge ids must match panel ids`);
	}
});

test('6. cross-account coverage: empty pool, single account, all-empty, exclusive models', () => {
	// Empty pool.
	assert.equal(computeModelUnion({}, []), 0);

	// Single account driven purely by quota fallback (no panels at all).
	const solo = makeAccount('solo', { google: { models: [{ modelId: 'm1' }, { modelId: 'm2' }] } });
	assert.equal(computeModelUnion({}, [solo]), 2);
	assert.equal(computeOtherAccountModelIds({}, [solo], 'solo').size, 0);

	// All accounts with empty model lists.
	const emptyA = makeAccount('eA', { google: { models: [] } });
	const emptyB = makeAccount('eB');
	assert.equal(computeModelUnion({}, [emptyA, emptyB]), 0);

	// Exclusive vs shared models: shared id is in others, exclusive id is not.
	const accA = makeAccount('A');
	const accB = makeAccount('B', { anthropic: { models: [{ modelId: 'shared-model' }] } });
	const panels = { A: apiPanel(makePayload([{ family: 'google', models: [{ id: 'A-only' }] }, { family: 'anthropic', models: [{ id: 'shared-model' }] }])) };
	assert.equal(computeModelUnion(panels, [accA, accB]), 2);
	const othersForA = computeOtherAccountModelIds(panels, [accA, accB], 'A');
	assert.ok(othersForA.has('shared-model'), 'model also in B must count as shared');
	assert.ok(!othersForA.has('A-only'), 'model only in A must stay exclusive');

	// A panel in ERROR state with retained payload still counts toward the union —
	// coverage must not collapse to the quota fallback on a transient endpoint failure.
	const accC = makeAccount('C', { google: { models: [{ modelId: 'quota-noise' }] } });
	const errPanels = { ...panels, C: apiPanel(makePayload([{ family: 'openai', models: [{ id: 'C-kept' }] }]), { status: 'error' }) as ModelPanelState };
	assert.equal(computeModelUnion(errPanels, [accA, accB, accC]), 3, 'retained error data must keep its contribution');
	assert.equal(accountModelIds(accC, errPanels['C']).includes('quota-noise'), false, 'retained API data must not be mixed with quota noise');
});

test('7. coverage math is payload-only: family grouping and duplicate ids never distort it', () => {
	const acc = makeAccount('dup', { google: { models: [{ modelId: 'dup' }] } });
	// Same id discovered under two families -> union counts it once, badge ids list occurrences.
	const p = makePayload([
		{ family: 'google', models: [{ id: 'dup' }] },
		{ family: 'openai', models: [{ id: 'dup' }, { id: 'uniq' }] },
	]);
	assert.equal(computeModelUnion({ dup: apiPanel(p) }, [acc]), 2, 'union must deduplicate ids across families');
	assert.deepEqual(accountModelIds(acc, apiPanel(p)), ['dup', 'dup', 'uniq']);
});

test('8. quota fallback adaptation: legacy modelId/displayName mapping, empty-id rows dropped, family attribution', () => {
	const acc = makeAccount('q', {
		google: { models: [
			{ modelId: 'gemini-3', displayName: 'Gemini 3', remainingFraction: 0.5, resetTime: '2026-11-18T12:00:00Z' },
			{ modelId: '', displayName: 'Ghost Row' },
			{ modelId: '   ' },
			{ modelId: 'gpt-oss-120b' },
		] },
		anthropic: { models: [] },
		openai: { models: [{ modelId: 'o-model', displayName: '' }] },
	});
	const payload = buildQuotaFallbackPayload(acc);
	const ids = payload.familyModels.flatMap((g) => g.models.map((m) => m.id));
	assert.deepEqual(ids, ['gemini-3', 'gpt-oss-120b', 'o-model'], 'empty/whitespace modelIds must be dropped');
	assert.deepEqual(
		payload.familyModels.map((g) => g.family),
		['google', 'openai'],
		'families without usable models must not produce empty groups',
	);
	const gemini = payload.familyModels[0]?.models[0];
	assert.equal(gemini?.name, 'Gemini 3', 'displayName wins');
	assert.equal(gemini?.family, 'google', 'each entry carries its own family attribution');
	assert.equal(gemini?.remainingFraction, 0.5);
	assert.equal(gemini?.resetTime, '2026-11-18T12:00:00Z');
	const gptOss = payload.familyModels[0]?.models[1];
	assert.equal(gptOss?.name, 'gpt-oss-120b', 'missing displayName degrades to modelId, never empty string');
	assert.equal(payload.known, true);
});

test('9. models-panel DOM id is a stable single source for aria-controls wiring', () => {
	assert.equal(modelsPanelDomId('acc-1'), 'models-panel-acc-1');
	assert.equal(modelsPanelDomId('acc-1'), modelsPanelDomId('acc-1'), 'same account must always produce the same id');
	assert.notEqual(modelsPanelDomId('a'), modelsPanelDomId('b'));
});

test('10. auto-load staleness: error panels are never re-hammered; healthy panels expire by TTL', () => {
	const acc = makeAccount('stale-check', { google: { models: [{ modelId: 'm' }] } });
	const panels: Record<string, ModelPanelState> = {};
	const idleAcc = makeAccount('idle-acc');
	const loadingAcc = makeAccount('loading-acc');
	const errorAcc = makeAccount('error-acc');
	const freshAcc = makeAccount('fresh-acc');
	const expiredAcc = makeAccount('expired-acc');
	panels['idle-acc'] = EMPTY_PANEL;
	panels['loading-acc'] = { ...EMPTY_PANEL, status: 'loading' };
	panels['error-acc'] = markPanelLoadFailure(EMPTY_PANEL, 'account_not_found', NOW - 1000);
	panels['fresh-acc'] = apiPanel(makePayload([{ family: 'google', models: [{ id: 'm' }] }]), { fetchedAt: NOW - 30_000 });
	panels['expired-acc'] = apiPanel(makePayload([{ family: 'google', models: [{ id: 'm' }] }]), { fetchedAt: NOW - 61_000 });

	const accounts = [idleAcc, loadingAcc, errorAcc, freshAcc, expiredAcc];
	const stale = collectStalePanelAccounts(panels, accounts, NOW).map((a) => a.id);
	assert.deepEqual(stale, ['idle-acc', 'expired-acc'], 'only never-loaded or TTL-expired healthy panels auto-reload; error/loading must wait for explicit retry');

	// Missing panel (account just added) is stale too.
	const justAdded = makeAccount('just-added');
	assert.deepEqual(collectStalePanelAccounts(panels, [justAdded], NOW).map((a) => a.id), ['just-added']);

	// A shorter TTL pulls the fresh panel into the reload set (TTL is honored, not hardcoded).
	assert.ok(collectStalePanelAccounts(panels, [freshAcc], NOW, 20_000).some((a) => a.id === 'fresh-acc'));
});

test('11. countdown formatting is clock-driven and honest about expired/unknown windows', () => {
	// formatQuotaWindow drives the self-ticking ResetCountdown cells.
	assert.equal(formatQuotaWindow(undefined, NOW).resetText, '', 'no reset time -> no countdown text');
	assert.equal(formatQuotaWindow('not-a-date', NOW).resetText, '', 'unparseable upstream value degrades to empty, never a crash or a fake time');
	const past = new Date(NOW - 10 * 60_000).toISOString();
	assert.equal(formatQuotaWindow(past, NOW).resetText, '', 'expired window must show no countdown');
	const in90 = formatQuotaWindow(new Date(NOW + 90 * 60_000).toISOString(), NOW).resetText;
	assert.match(in90, /\(\d+h\d+m\)/, 'a 90-minute window must render an h/m countdown');
	const inDays = formatQuotaWindow(new Date(NOW + 30 * 3_600_000).toISOString(), NOW).resetText;
	assert.match(inDays, /\d+\/\d+ \d{2}:\d{2} \(\d+d\d+h\)/, 'windows >= 1 day use the weekly date+countdown format');
});
