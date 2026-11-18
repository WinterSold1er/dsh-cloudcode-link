// Pure decision layer for the settings page's polling / config / add-account flows.
// Kept react-free on purpose: the component in index.ts is thin glue over these
// functions, and every state transition here is unit-testable with node --test.

/** UI state derived from the 3s status poll. */
export interface PollUiState {
	pollOk: boolean;
	lastUpdatedAt: number | null;
}

/**
 * Fold one poll outcome into the poll UI state.
 * - A failed poll only flips `pollOk` (the shown data stays, stamped with the last good time).
 * - Any successful poll restores `pollOk = true` — even when the status JSON is unchanged,
 *   so the page can never stay stuck on 「轮询中断」 after connectivity recovers.
 * - `lastUpdatedAt` is re-stamped on recovery and on data change; a healthy poll of unchanged
 *   data keeps the previous timestamp so React bails out instead of re-rendering the tree.
 */
export function applyPollOutcome(
	prev: PollUiState,
	outcome: { ok: boolean; statusChanged: boolean },
	nowMs: number,
): PollUiState {
	if (!outcome.ok) {
		return { pollOk: false, lastUpdatedAt: prev.lastUpdatedAt };
	}
	if (!prev.pollOk || outcome.statusChanged) {
		return { pollOk: true, lastUpdatedAt: nowMs };
	}
	return { pollOk: true, lastUpdatedAt: prev.lastUpdatedAt };
}

/**
 * Seed the config input drafts from the backend status.
 * - `undefined` means "the user has never touched this field" and gets seeded from status.
 * - Any string (including one the user cleared to '') is a user edit and is preserved.
 * - A null status (not loaded yet) must not freeze the drafts to '' — that is exactly what
 *   used to make the fields never backfill, because '' is not "unedited".
 */
export function seedConfigDrafts(
	prev: Record<string, string | undefined>,
	status: { defaultModel?: string; defaultEffort?: string } | null,
): Record<string, string | undefined> {
	if (!status) return prev;
	const next: Record<string, string | undefined> = { ...prev };
	// Only seed when the backend actually provides a value; leaving the entry undefined
	// keeps it "unedited", so a later status update can still backfill it.
	if (next.defaultModel === undefined && typeof status.defaultModel === 'string') next.defaultModel = status.defaultModel;
	if (next.defaultEffort === undefined && typeof status.defaultEffort === 'string') next.defaultEffort = status.defaultEffort;
	return next;
}

/**
 * Which blocks the add-account modal shows once `addingAccount` is true.
 * Browser login must stay reachable whenever the flow is not actively running — including
 * after a cancel or a failed activation — so users entering via the top bar can still
 * choose 「打开浏览器登录」, not only manual code pasting.
 * Only fields the component consumes are exposed: the manual-code box is rendered
 * unconditionally by the modal (kept usable while a flow runs on purpose) and the failure
 * banner is gated from `poolAuthPhase === 'failed'` in index.ts, so gating fields for
 * either here would be dead code that invites the UI to lie about its own behavior.
 */
export interface AccountAddFlowView {
	flowActive: boolean;
	showBrowserStart: boolean;
}

export function accountAddFlowView(addingAccount: boolean, poolAuthPhase: string): AccountAddFlowView {
	const flowActive = addingAccount && (poolAuthPhase === 'waiting' || poolAuthPhase === 'exchanging');
	return {
		flowActive,
		showBrowserStart: !flowActive,
	};
}
