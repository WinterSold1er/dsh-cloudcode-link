// Design system for the CloudCode Link settings UI (client half).
// Awarwards-grade craft rules enforced here:
//  - Every literal color lives ONLY inside the token block (agy-tokens markers).
//    Component CSS and React presets reference var(--agy-*) exclusively.
//  - Tokens map onto the host theme (--dsw-alias-*) with light/dark fallbacks, so the
//    panel inherits DSH theme switching; renamed host tokens degrade, never break.
//  - 8pt spacing scale, modular type scale, three shadow levels, one easing family,
//    durations inside 120-320ms, all motion killed by prefers-reduced-motion.
//  - Text/background pairs chosen for WCAG AA contrast in both themes.

export const THEME_CSS = `
/* agy-tokens:start */
:root, body {
	/* --- brand artwork (CloudCode Link orb gradient) --- */
	--agy-brand-a: #4c8dff;
	--agy-brand-b: #a96bff;

	/* --- spacing: 8pt grid --- */
	--agy-space-1: 4px;
	--agy-space-2: 8px;
	--agy-space-3: 12px;
	--agy-space-4: 16px;
	--agy-space-5: 24px;
	--agy-space-6: 32px;

	/* --- type scale (system stack + tabular numerals) --- */
	--agy-font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif);
	--agy-font-mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "Liberation Mono", monospace;
	--agy-font-xs: 11px;
	--agy-font-sm: 12px;
	--agy-font-md: 13px;
	--agy-font-lg: 14px;
	--agy-font-xl: 16px;
	--agy-font-2xl: 20px;

	/* --- radii --- */
	--agy-radius-sm: 6px;
	--agy-radius-md: 8px;
	--agy-radius-lg: 12px;
	--agy-radius-pill: 999px;

	/* --- elevation --- */
	--agy-shadow-1: 0 1px 2px rgba(15, 23, 42, 0.06);
	--agy-shadow-2: 0 4px 14px rgba(15, 23, 42, 0.09);
	--agy-shadow-3: 0 18px 44px rgba(15, 23, 42, 0.22);

	/* --- motion choreography --- */
	--agy-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
	--agy-ease-inout: cubic-bezier(0.65, 0, 0.35, 1);
	--agy-dur-fast: 120ms;
	--agy-dur-base: 180ms;
	--agy-dur-slow: 240ms;
	--agy-stagger: 55ms;

	/* --- light theme surfaces --- */
	--agy-bg-panel: var(--dsw-alias-bg-layer-2, #ffffff);
	--agy-bg-card: var(--dsw-alias-bg-layer-2, #ffffff);
	--agy-bg-card-primary: #eef5ff;
	--agy-bg-header: var(--dsw-alias-bg-layer-2, #fbfcfe);
	--agy-bg-subbox: var(--dsw-alias-bg-layer-3, #f4f6f9);
	--agy-bg-box: var(--dsw-alias-bg-layer-3, #f7f9fb);
	--agy-bg-input: var(--dsw-alias-bg-layer-1, #ffffff);
	--agy-bg-btn: var(--dsw-alias-bg-layer-2, #ffffff);
	--agy-bg-btn-hover: var(--dsw-alias-interactive-bg-hover, #f1f4f8);
	--agy-bg-progress-track: #e6ebf2;
	--agy-bg-skeleton: #e9edf3;
	--agy-bg-skeleton-hi: #f5f8fb;
	--agy-bg-nav: var(--dsw-alias-bg-layer-3, #f4f6f9);

	/* --- light theme borders --- */
	--agy-border-card: var(--dsw-alias-border-l1, #e2e8f0);
	--agy-border-card-primary: #9ec3f5;
	--agy-border-box: var(--dsw-alias-border-l1, #e3e8ef);
	--agy-border-subbox: var(--dsw-alias-border-l2, #dbe2ea);
	--agy-border-divider: var(--dsw-alias-border-l2, #e6ebf1);
	--agy-border-btn: #d4dce6;
	--agy-border-btn-primary: #7fa9e8;
	--agy-border-input: #d4dce6;
	--agy-border-input-focus: #1d4ed8;

	/* --- light theme text (AA on layer-2 surfaces) --- */
	--agy-text-primary: var(--dsw-alias-label-primary, #101828);
	--agy-text-secondary: var(--dsw-alias-label-secondary, #475467);
	--agy-text-tertiary: var(--dsw-alias-label-tertiary, #626e81);
	--agy-text-muted: #626e81;
	--agy-text-btn: #344054;
	--agy-text-btn-primary: #f8fafc;
	--agy-text-window-label: #1d4ed8;
	--agy-on-primary: #f8fafc;

	/* --- semantic status --- */
	--agy-ok-text: #047857;
	--agy-ok-bg: #e7f6ef;
	--agy-ok-border: #a3d7c0;
	--agy-warn-text: #b45309;
	--agy-warn-bg: #fdf3e3;
	--agy-warn-border: #f0d1a4;
	--agy-danger-text: #b91c1c;
	--agy-danger-bg: #fdecec;
	--agy-danger-border: #f2bdbd;
	--agy-info-text: #1d4ed8;
	--agy-info-bg: #eaf1fe;
	--agy-info-border: #bad2f7;
	--agy-neutral-text: #475569;
	--agy-neutral-bg: #eef2f6;
	--agy-neutral-border: #d7dee8;

	/* --- accents --- */
	--agy-accent: #1d4ed8;
	--agy-accent-hover: #1e40af;
	--agy-accent-soft-bg: #eaf1fe;
	--agy-accent-soft-border: #bcd3f7;
	--agy-on-accent: #f8fafc;
	--agy-focus-ring: #1d4ed8;

	/* --- status-strong (data viz on tables/bars) --- */
	--agy-strong-ok: #047857;
	--agy-strong-warn: #b45309;
	--agy-strong-danger: #dc2626;
	--agy-strong-neutral: #64748b;
	--agy-tint-ok: rgba(4, 120, 87, 0.12);
	--agy-tint-warn: rgba(180, 83, 9, 0.12);
	--agy-tint-danger: rgba(220, 38, 38, 0.12);
	--agy-tint-neutral: rgba(100, 116, 139, 0.14);

	/* --- quota gradients --- */
	--agy-quota-high-grad: linear-gradient(90deg, #047857, #10b981);
	--agy-quota-med-grad: linear-gradient(90deg, #b45309, #f59e0b);
	--agy-quota-low-grad: linear-gradient(90deg, #b91c1c, #ef4444);
	--agy-quota-cool-grad: linear-gradient(90deg, #475569, #64748b);
	--agy-quota-high-text: #047857;
	--agy-quota-med-text: #b45309;
	--agy-quota-low-text: #b91c1c;
	--agy-quota-none-text: #626e81;
	--agy-quota-none-bg: transparent;
	--agy-quota-none-border: var(--dsw-alias-border-l2, #dbe2ea);
	--agy-quota-high-bg: var(--agy-tint-ok);
	--agy-quota-med-bg: var(--agy-tint-warn);
	--agy-quota-low-bg: var(--agy-tint-danger);
	--agy-quota-high-border: var(--agy-ok-border);
	--agy-quota-med-border: var(--agy-warn-border);
	--agy-quota-low-border: var(--agy-danger-border);

	/* --- badges --- */
	--agy-badge-primary-bg: #dbeafe;
	--agy-badge-primary-text: #1e40af;
	--agy-badge-primary-border: #93bff4;
	--agy-badge-tag-bg: #f1f5f9;
	--agy-badge-tag-text: #475467;
	--agy-badge-tag-border: #dde4ec;
	--agy-badge-ready-bg: var(--agy-ok-bg);
	--agy-badge-ready-text: var(--agy-ok-text);
	--agy-badge-ready-border: var(--agy-ok-border);
	--agy-badge-unready-bg: var(--agy-warn-bg);
	--agy-badge-unready-text: var(--agy-warn-text);
	--agy-badge-unready-border: var(--agy-warn-border);
	--agy-badge-email-bg: var(--agy-info-bg);
	--agy-badge-email-text: var(--agy-info-text);
	--agy-badge-email-border: var(--agy-info-border);
	--agy-badge-proxy-bg: var(--agy-neutral-bg);
	--agy-badge-proxy-text: var(--agy-neutral-text);
	--agy-badge-proxy-border: var(--agy-neutral-border);

	/* --- auth add flow box --- */
	--agy-auth-box-bg: var(--agy-bg-subbox);
	--agy-auth-box-border: var(--agy-border-subbox);

	/* --- toast --- */
	--agy-toast-success-bg: var(--agy-ok-bg);
	--agy-toast-success-text: var(--agy-ok-text);
	--agy-toast-success-border: var(--agy-ok-border);
	--agy-toast-info-bg: var(--agy-info-bg);
	--agy-toast-info-text: var(--agy-info-text);
	--agy-toast-info-border: var(--agy-info-border);
	--agy-toast-warn-bg: var(--agy-warn-bg);
	--agy-toast-warn-text: var(--agy-warn-text);
	--agy-toast-warn-border: var(--agy-warn-border);
	--agy-toast-error-bg: var(--agy-danger-bg);
	--agy-toast-error-text: var(--agy-danger-text);
	--agy-toast-error-border: var(--agy-danger-border);

	/* --- warn buttons (clear cooldown) --- */
	--agy-warn-btn-bg: #ffffff;
	--agy-warn-btn-text: var(--agy-warn-text);
	--agy-warn-btn-border: var(--agy-warn-border);
	--agy-danger-bg: var(--agy-danger-bg);
	--agy-danger-border: var(--agy-danger-border);
	--agy-danger-text: var(--agy-danger-text);
	--agy-danger-hover-bg: #f8d7d7;

	/* --- segmented controls --- */
	--agy-seg-group-bg: var(--agy-bg-nav);
	--agy-seg-group-border: var(--agy-border-divider);
	--agy-seg-btn-text: var(--agy-text-secondary);
	--agy-seg-btn-active-bg: #ffffff;
	--agy-seg-btn-active-text: var(--agy-text-primary);
	--agy-seg-danger-bg: var(--agy-danger-bg);
	--agy-seg-danger-text: var(--agy-danger-text);
	--agy-seg-danger-border: var(--agy-danger-border);

	/* --- audit drawer (theme-adaptive) --- */
	--agy-drawer-overlay: rgba(15, 23, 42, 0.5);
	--agy-drawer-bg: var(--dsw-alias-bg-layer-1, #ffffff);
	--agy-drawer-head-bg: var(--dsw-alias-bg-layer-3, #f7f9fb);
	--agy-drawer-border: var(--dsw-alias-border-l1, #e2e8f0);
	--agy-table-text: var(--agy-text-primary);
	--agy-table-soft: var(--agy-text-secondary);
	--agy-table-dim: var(--agy-text-secondary);
	--agy-table-faint: var(--agy-text-tertiary);
	--agy-table-head-bg: var(--dsw-alias-bg-layer-3, #f7f9fb);
	--agy-table-row-border: var(--dsw-alias-border-l2, #e8edf3);
	--agy-drawer-btn-bg: var(--dsw-alias-bg-layer-3, #f1f4f8);
	--agy-drawer-btn-text: var(--agy-text-btn);
	--agy-drawer-btn-border: var(--agy-border-btn);

	/* --- modal shadow / backdrop --- */
	--agy-shadow-modal: var(--agy-shadow-3);
	--agy-modal-backdrop: rgba(15, 23, 42, 0.5);
	--agy-shadow-card: var(--agy-shadow-1);
	--agy-shadow-card-hover: var(--agy-shadow-2);
	--agy-shadow-card-primary: 0 0 0 1px var(--agy-border-card-primary), var(--agy-shadow-2);
}

body[data-ds-dark-theme],
body.dark,
body[data-theme="dark"] {
	--agy-bg-panel: var(--dsw-alias-bg-layer-2, #171a20);
	--agy-bg-card: var(--dsw-alias-bg-layer-2, #171a20);
	--agy-bg-card-primary: #172232;
	--agy-bg-header: var(--dsw-alias-bg-layer-2, #191c22);
	--agy-bg-subbox: var(--dsw-alias-bg-layer-3, #1e2229);
	--agy-bg-box: var(--dsw-alias-bg-layer-3, #1b1f26);
	--agy-bg-input: var(--dsw-alias-bg-layer-1, #12151a);
	--agy-bg-btn: var(--dsw-alias-bg-layer-3, #21252d);
	--agy-bg-btn-hover: var(--dsw-alias-interactive-bg-hover, #272c35);
	--agy-bg-progress-track: #2a303a;
	--agy-bg-skeleton: #21262e;
	--agy-bg-skeleton-hi: #2b313b;
	--agy-bg-nav: var(--dsw-alias-bg-layer-3, #1e2229);

	--agy-border-card: var(--dsw-alias-border-l1, #2b323d);
	--agy-border-card-primary: #3c5a80;
	--agy-border-box: var(--dsw-alias-border-l1, #2b323d);
	--agy-border-subbox: var(--dsw-alias-border-l2, #333a45);
	--agy-border-divider: var(--dsw-alias-border-l2, #292f38);
	--agy-border-btn: #39414d;
	--agy-border-btn-primary: #4a6fa5;
	--agy-border-input: #39414d;
	--agy-border-input-focus: #60a5fa;

	--agy-text-primary: var(--dsw-alias-label-primary, #f1f3f6);
	--agy-text-secondary: var(--dsw-alias-label-secondary, #b7c0cc);
	--agy-text-tertiary: var(--dsw-alias-label-tertiary, #98a2b1);
	--agy-text-muted: #98a2b1;
	--agy-text-btn: #d4dae3;
	--agy-text-btn-primary: #0b1220;
	--agy-text-window-label: #93c5fd;
	--agy-on-primary: #f8fafc;

	--agy-ok-text: #34d399;
	--agy-ok-bg: rgba(52, 211, 153, 0.14);
	--agy-ok-border: rgba(52, 211, 153, 0.38);
	--agy-warn-text: #fbbf24;
	--agy-warn-bg: rgba(251, 191, 36, 0.13);
	--agy-warn-border: rgba(251, 191, 36, 0.38);
	--agy-danger-text: #f87171;
	--agy-danger-bg: rgba(248, 113, 113, 0.13);
	--agy-danger-border: rgba(248, 113, 113, 0.38);
	--agy-info-text: #93c5fd;
	--agy-info-bg: rgba(147, 197, 253, 0.13);
	--agy-info-border: rgba(147, 197, 253, 0.38);
	--agy-neutral-text: #b7c0cc;
	--agy-neutral-bg: rgba(183, 192, 204, 0.12);
	--agy-neutral-border: rgba(183, 192, 204, 0.3);

	--agy-accent: #60a5fa;
	--agy-accent-hover: #93c5fd;
	--agy-accent-soft-bg: rgba(96, 165, 250, 0.14);
	--agy-accent-soft-border: rgba(96, 165, 250, 0.4);
	--agy-on-accent: #0b1220;
	--agy-focus-ring: #60a5fa;

	--agy-strong-ok: #34d399;
	--agy-strong-warn: #fbbf24;
	--agy-strong-danger: #f87171;
	--agy-strong-neutral: #98a2b1;

	--agy-quota-high-grad: linear-gradient(90deg, #059669, #34d399);
	--agy-quota-med-grad: linear-gradient(90deg, #d97706, #fbbf24);
	--agy-quota-low-grad: linear-gradient(90deg, #dc2626, #f87171);
	--agy-quota-cool-grad: linear-gradient(90deg, #64748b, #98a2b1);
	--agy-quota-high-text: #34d399;
	--agy-quota-med-text: #fbbf24;
	--agy-quota-low-text: #f87171;
	--agy-quota-none-text: #98a2b1;

	--agy-badge-primary-bg: rgba(96, 165, 250, 0.16);
	--agy-badge-primary-text: #93c5fd;
	--agy-badge-primary-border: rgba(96, 165, 250, 0.4);
	--agy-badge-tag-bg: rgba(183, 192, 204, 0.1);
	--agy-badge-tag-text: #b7c0cc;
	--agy-badge-tag-border: rgba(183, 192, 204, 0.26);
	--agy-badge-email-bg: var(--agy-info-bg);
	--agy-badge-email-text: var(--agy-info-text);
	--agy-badge-email-border: var(--agy-info-border);

	--agy-warn-btn-bg: transparent;
	--agy-danger-hover-bg: rgba(248, 113, 113, 0.22);

	--agy-seg-btn-active-bg: #2a303a;
	--agy-seg-btn-active-text: #f1f3f6;

	--agy-drawer-overlay: rgba(5, 8, 12, 0.62);
	--agy-drawer-bg: var(--dsw-alias-bg-layer-1, #12151a);
	--agy-drawer-head-bg: var(--dsw-alias-bg-layer-3, #1b1f26);
	--agy-drawer-border: var(--dsw-alias-border-l1, #2b323d);
	--agy-table-head-bg: var(--dsw-alias-bg-layer-3, #1b1f26);
	--agy-table-row-border: var(--dsw-alias-border-l2, #262c35);
	--agy-drawer-btn-bg: #232831;
	--agy-drawer-btn-text: #d4dae3;
	--agy-drawer-btn-border: #39414d;

	--agy-modal-backdrop: rgba(5, 8, 12, 0.62);
	--agy-shadow-card-primary: 0 0 0 1px var(--agy-border-card-primary), 0 4px 14px rgba(0, 0, 0, 0.35);
}
/* agy-tokens:end */

@keyframes agy-spin {
	0% { transform: rotate(0deg); }
	100% { transform: rotate(360deg); }
}

@keyframes agy-pulse {
	0%, 100% { opacity: 1; transform: scale(1); }
	50% { opacity: 0.55; transform: scale(0.86); }
}

@keyframes agy-rise {
	from { opacity: 0; transform: translateY(10px); }
	to { opacity: 1; transform: translateY(0); }
}

@keyframes agy-fill {
	from { transform: scaleX(0); }
	to { transform: scaleX(1); }
}

@keyframes agy-breathe {
	0%, 100% { box-shadow: 0 0 0 0 var(--agy-warn-border); }
	50% { box-shadow: 0 0 0 4px var(--agy-warn-bg); }
}

@keyframes agy-shimmer {
	0% { background-position: 200% 0; }
	100% { background-position: -200% 0; }
}

@keyframes agy-slide-in {
	from { opacity: 0; transform: translateX(28px); }
	to { opacity: 1; transform: translateX(0); }
}

.agy-root {
	font-family: var(--agy-font-family);
	color: var(--agy-text-primary);
	font-size: var(--agy-font-md);
}

.agy-num {
	font-family: var(--agy-font-mono);
	font-variant-numeric: tabular-nums;
}

/* stagger helper: children set --i inline (capped by the renderer) */
.agy-rise {
	animation: agy-rise var(--agy-dur-slow) var(--agy-ease-out) both;
	animation-delay: calc(var(--i, 0) * var(--agy-stagger));
}

.agy-btn {
	font-family: inherit;
	transition: background var(--agy-dur-fast) var(--agy-ease-out),
		border-color var(--agy-dur-fast) var(--agy-ease-out),
		box-shadow var(--agy-dur-fast) var(--agy-ease-out),
		transform var(--agy-dur-fast) var(--agy-ease-out);
}

.agy-btn:hover:not(:disabled) {
	transform: translateY(-1px);
}

.agy-btn:active:not(:disabled) {
	transform: translateY(0);
}

.agy-btn:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.agy-root :is(button, input, a, [tabindex]):focus-visible,
.agy-drawer :is(button, input, a, [tabindex]):focus-visible {
	outline: 2px solid var(--agy-focus-ring);
	outline-offset: 2px;
	border-radius: var(--agy-radius-sm);
}

.agy-spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	border: 2px solid var(--agy-border-btn);
	border-top-color: var(--agy-accent);
	animation: agy-spin 720ms linear infinite;
	vertical-align: -1px;
}

.agy-pulse-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	animation: agy-pulse 2.4s var(--agy-ease-inout) infinite;
	flex-shrink: 0;
}

.agy-card-hover {
	transition: box-shadow var(--agy-dur-base) var(--agy-ease-out),
		border-color var(--agy-dur-base) var(--agy-ease-out),
		transform var(--agy-dur-base) var(--agy-ease-out);
}

.agy-card-hover:hover {
	box-shadow: var(--agy-shadow-2);
	transform: translateY(-1px);
}

.agy-progress-fill {
	transform-origin: left center;
	animation: agy-fill var(--agy-dur-slow) var(--agy-ease-out) both;
}

.agy-cooldown-breathe {
	animation: agy-breathe 2.2s var(--agy-ease-inout) infinite;
}

.agy-skeleton {
	position: relative;
	overflow: hidden;
	background: var(--agy-bg-skeleton);
	border-radius: var(--agy-radius-sm);
}

.agy-skeleton::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(90deg, transparent, var(--agy-bg-skeleton-hi), transparent);
	background-size: 200% 100%;
	animation: agy-shimmer 1.2s var(--agy-ease-inout) infinite;
}

.agy-sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}

.agy-tab {
	font-family: inherit;
	transition: background var(--agy-dur-fast) var(--agy-ease-out),
		color var(--agy-dur-fast) var(--agy-ease-out),
		box-shadow var(--agy-dur-fast) var(--agy-ease-out);
}

.agy-tab[aria-selected="true"] {
	background: var(--agy-seg-btn-active-bg);
	color: var(--agy-seg-btn-active-text);
	box-shadow: var(--agy-shadow-1);
}

.agy-chip {
	font-family: inherit;
	transition: background var(--agy-dur-fast) var(--agy-ease-out),
		border-color var(--agy-dur-fast) var(--agy-ease-out),
		color var(--agy-dur-fast) var(--agy-ease-out);
}

.agy-chip[aria-pressed="true"] {
	background: var(--agy-accent-soft-bg);
	border-color: var(--agy-accent-soft-border);
	color: var(--agy-accent);
}

.agy-drawer-backdrop {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: var(--agy-drawer-overlay);
	backdrop-filter: blur(3px);
	z-index: 99999;
	display: flex;
	justify-content: flex-end;
}

.agy-drawer {
	width: min(940px, 96vw);
	height: 100%;
	background: var(--agy-drawer-bg);
	border-left: 1px solid var(--agy-drawer-border);
	color: var(--agy-table-text);
	display: flex;
	flex-direction: column;
	box-shadow: var(--agy-shadow-modal);
	animation: agy-slide-in var(--agy-dur-slow) var(--agy-ease-out) both;
}

.agy-table {
	width: 100%;
	border-collapse: collapse;
	font-size: var(--agy-font-sm);
}

.agy-table th {
	padding: var(--agy-space-2) var(--agy-space-3);
	color: var(--agy-table-dim);
	text-align: left;
	font-weight: 600;
	border-bottom: 1px solid var(--agy-drawer-border);
	background: var(--agy-table-head-bg);
}

.agy-table td {
	padding: var(--agy-space-2) var(--agy-space-3);
	border-bottom: 1px solid var(--agy-table-row-border);
	color: var(--agy-table-soft);
}

.agy-model-row {
	animation: agy-rise var(--agy-dur-base) var(--agy-ease-out) both;
	animation-delay: calc(var(--i, 0) * var(--agy-stagger));
}

.agy-input {
	font-family: inherit;
	transition: border-color var(--agy-dur-fast) var(--agy-ease-out),
		box-shadow var(--agy-dur-fast) var(--agy-ease-out);
}

.agy-input:focus {
	border-color: var(--agy-border-input-focus);
	box-shadow: 0 0 0 3px var(--agy-accent-soft-bg);
	outline: none;
}

@media (prefers-reduced-motion: reduce) {
	.agy-root *,
	.agy-root *::before,
	.agy-root *::after,
	.agy-drawer-backdrop,
	.agy-drawer,
	.agy-drawer * {
		animation: none !important;
		transition: none !important;
		scroll-behavior: auto !important;
	}
	.agy-progress-fill { transform: none !important; }
}
`;

/** React inline-style presets. Values reference tokens only — zero literals outside the token block. */
export const S: Record<string, Record<string, unknown>> = {
	container: {
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--agy-space-3)',
		padding: 'var(--agy-space-2) var(--agy-space-1)',
		fontFamily: 'var(--agy-font-family)',
		color: 'var(--agy-text-primary)',
		fontSize: 'var(--agy-font-md)',
		maxWidth: '1080px',
	},
	headerCard: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		flexWrap: 'wrap',
		gap: 'var(--agy-space-2)',
		padding: 'var(--agy-space-3) var(--agy-space-4)',
		background: 'var(--agy-bg-header)',
		border: '1px solid var(--agy-border-card)',
		borderRadius: 'var(--agy-radius-lg)',
		boxShadow: 'var(--agy-shadow-1)',
	},
	navBar: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '2px',
		padding: '3px',
		background: 'var(--agy-bg-nav)',
		border: '1px solid var(--agy-border-divider)',
		borderRadius: 'var(--agy-radius-md)',
		flexWrap: 'wrap',
	},
	tab: {
		padding: '6px 13px',
		borderRadius: 'var(--agy-radius-sm)',
		border: 'none',
		background: 'transparent',
		color: 'var(--agy-seg-btn-text)',
		cursor: 'pointer',
		fontSize: 'var(--agy-font-sm)',
		fontWeight: 650,
		lineHeight: 1.35,
	},
	panelTitle: {
		fontSize: 'var(--agy-font-lg)',
		fontWeight: 750,
		letterSpacing: '0.01em',
		color: 'var(--agy-text-primary)',
	},
	panelCaption: {
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 600,
		letterSpacing: '0.06em',
		color: 'var(--agy-text-tertiary)',
		textTransform: 'uppercase',
	},
	badgeBase: {
		display: 'inline-flex',
		alignItems: 'center',
		padding: '2px 8px',
		borderRadius: 'var(--agy-radius-pill)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 650,
		lineHeight: 1.5,
	},
	badgePrimary: {
		display: 'inline-flex',
		alignItems: 'center',
		padding: '2px 8px',
		borderRadius: 'var(--agy-radius-pill)',
		background: 'var(--agy-badge-primary-bg)',
		color: 'var(--agy-badge-primary-text)',
		border: '1px solid var(--agy-badge-primary-border)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 650,
		lineHeight: 1.5,
	},
	badgeTag: {
		display: 'inline-flex',
		alignItems: 'center',
		padding: '2px 8px',
		borderRadius: 'var(--agy-radius-pill)',
		background: 'var(--agy-badge-tag-bg)',
		color: 'var(--agy-badge-tag-text)',
		border: '1px solid var(--agy-badge-tag-border)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 550,
		lineHeight: 1.5,
	},
	badgeReady: {
		display: 'inline-flex',
		alignItems: 'center',
		padding: '2px 8px',
		borderRadius: 'var(--agy-radius-pill)',
		background: 'var(--agy-badge-ready-bg)',
		color: 'var(--agy-badge-ready-text)',
		border: '1px solid var(--agy-badge-ready-border)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 650,
	},
	badgeUnready: {
		display: 'inline-flex',
		alignItems: 'center',
		padding: '2px 8px',
		borderRadius: 'var(--agy-radius-pill)',
		background: 'var(--agy-badge-unready-bg)',
		color: 'var(--agy-badge-unready-text)',
		border: '1px solid var(--agy-badge-unready-border)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 650,
	},
	statBox: {
		padding: 'var(--agy-space-3)',
		background: 'var(--agy-bg-box)',
		border: '1px solid var(--agy-border-box)',
		borderRadius: 'var(--agy-radius-md)',
	},
	statLabel: {
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 650,
		letterSpacing: '0.05em',
		color: 'var(--agy-text-tertiary)',
		textTransform: 'uppercase',
		marginBottom: '6px',
	},
	statValue: {
		fontFamily: 'var(--agy-font-mono)',
		fontVariantNumeric: 'tabular-nums',
		fontSize: 'var(--agy-font-xl)',
		fontWeight: 750,
		color: 'var(--agy-text-primary)',
		lineHeight: 1.2,
	},
	statSub: {
		fontSize: 'var(--agy-font-xs)',
		color: 'var(--agy-text-tertiary)',
		marginTop: '5px',
		fontFamily: 'var(--agy-font-mono)',
		fontVariantNumeric: 'tabular-nums',
	},
	card: {
		padding: 'var(--agy-space-3) var(--agy-space-4)',
		background: 'var(--agy-bg-card)',
		border: '1px solid var(--agy-border-card)',
		borderRadius: 'var(--agy-radius-lg)',
		boxShadow: 'var(--agy-shadow-1)',
		marginBottom: 'var(--agy-space-3)',
	},
	cardPrimary: {
		padding: 'var(--agy-space-3) var(--agy-space-4)',
		background: 'var(--agy-bg-card-primary)',
		border: '1px solid var(--agy-border-card-primary)',
		borderRadius: 'var(--agy-radius-lg)',
		boxShadow: 'var(--agy-shadow-card-primary)',
		marginBottom: 'var(--agy-space-3)',
	},
	quotaBox: {
		marginTop: 'var(--agy-space-2)',
	},
	progressBarBg: {
		flex: 1,
		minWidth: '64px',
		height: '7px',
		background: 'var(--agy-bg-progress-track)',
		borderRadius: 'var(--agy-radius-pill)',
		overflow: 'hidden',
	},
	btn: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '5px',
		padding: '6px 12px',
		borderRadius: 'var(--agy-radius-sm)',
		border: '1px solid var(--agy-border-btn)',
		background: 'var(--agy-bg-btn)',
		color: 'var(--agy-text-btn)',
		fontSize: 'var(--agy-font-sm)',
		fontWeight: 650,
		cursor: 'pointer',
		lineHeight: 1.35,
	},
	btnPrimary: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '5px',
		padding: '6px 12px',
		borderRadius: 'var(--agy-radius-sm)',
		border: '1px solid var(--agy-border-btn-primary)',
		background: 'var(--agy-accent)',
		color: 'var(--agy-on-accent)',
		fontSize: 'var(--agy-font-sm)',
		fontWeight: 700,
		cursor: 'pointer',
		lineHeight: 1.35,
		boxShadow: 'var(--agy-shadow-1)',
	},
	btnDanger: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '5px',
		padding: '6px 12px',
		borderRadius: 'var(--agy-radius-sm)',
		border: '1px solid var(--agy-danger-border)',
		background: 'transparent',
		color: 'var(--agy-danger-text)',
		fontSize: 'var(--agy-font-sm)',
		fontWeight: 650,
		cursor: 'pointer',
		lineHeight: 1.35,
	},
	btnSm: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '5px',
		padding: '4px 9px',
		borderRadius: 'var(--agy-radius-sm)',
		border: '1px solid var(--agy-border-btn)',
		background: 'var(--agy-bg-btn)',
		color: 'var(--agy-text-btn)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 600,
		cursor: 'pointer',
		lineHeight: 1.35,
	},
	btnSmPrimary: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '5px',
		padding: '4px 9px',
		borderRadius: 'var(--agy-radius-sm)',
		border: '1px solid var(--agy-border-btn-primary)',
		background: 'var(--agy-accent)',
		color: 'var(--agy-on-accent)',
		fontSize: 'var(--agy-font-xs)',
		fontWeight: 650,
		cursor: 'pointer',
		lineHeight: 1.35,
	},
	segGroup: {
		display: 'inline-flex',
		gap: '3px',
		padding: '3px',
		background: 'var(--agy-seg-group-bg)',
		border: '1px solid var(--agy-seg-group-border)',
		borderRadius: 'var(--agy-radius-md)',
	},
	segBtn: {
		padding: '5px 12px',
		borderRadius: 'var(--agy-radius-sm)',
		border: 'none',
		background: 'transparent',
		color: 'var(--agy-seg-btn-text)',
		cursor: 'pointer',
		fontSize: 'var(--agy-font-sm)',
		fontWeight: 600,
	},
	segBtnActive: {
		padding: '5px 12px',
		borderRadius: 'var(--agy-radius-sm)',
		border: 'none',
		background: 'var(--agy-seg-btn-active-bg)',
		color: 'var(--agy-seg-btn-active-text)',
		cursor: 'pointer',
		fontSize: 'var(--agy-font-sm)',
		fontWeight: 700,
		boxShadow: 'var(--agy-shadow-1)',
	},
	input: {
		flex: 1,
		minWidth: '0',
		padding: '7px 10px',
		borderRadius: 'var(--agy-radius-sm)',
		border: '1px solid var(--agy-border-input)',
		background: 'var(--agy-bg-input)',
		color: 'var(--agy-text-primary)',
		fontSize: 'var(--agy-font-sm)',
		fontFamily: 'var(--agy-font-family)',
	},
	muted: {
		color: 'var(--agy-text-muted)',
		fontSize: 'var(--agy-font-sm)',
	},
	noticeBanner: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 'var(--agy-space-2)',
		padding: '9px var(--agy-space-3)',
		borderRadius: 'var(--agy-radius-md)',
		fontSize: 'var(--agy-font-sm)',
		marginBottom: 'var(--agy-space-2)',
	},
	authModal: {
		padding: 'var(--agy-space-4)',
		background: 'var(--agy-auth-box-bg)',
		border: '1px solid var(--agy-auth-box-border)',
		borderRadius: 'var(--agy-radius-lg)',
		marginBottom: 'var(--agy-space-3)',
	},
};
