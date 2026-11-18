window.__ModuleLoader__.load({
	id: "dsh-cloudcode-link",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/brand-icons.ts
		const BRAND_PATHS = {
			gemini: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
			claude: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
			openai: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
		};
		const BRAND_COLORS = {
			gemini: "#8E75B2",
			claude: "#D97757",
			openai: "#10a37f"
		};
		const UI_PATHS = {
			trash: "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
			plus: "M12 5v14M5 12h14",
			refresh: "M21.5 2v6h-6M2.5 22v-6h6M2.5 11.5a10 10 0 0 1 17.5-4.5l1.5 2M21.5 12.5a10 10 0 0 1-17.5 4.5l-1.5-2",
			star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
			mail: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6",
			globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
			zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
			chevronDown: "M6 9l6 6 6-6",
			chevronUp: "M18 15l-6-6-6 6",
			check: "M20 6L9 17l-5-5",
			x: "M18 6L6 18M6 6l12 12",
			externalLink: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
			alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
			activity: "M22 12h-4l-3 9L9 3l-3 9H2",
			search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
			layers: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
		};
		//#endregion
		//#region src/client/theme.ts
		const THEME_CSS = `
/* agy-tokens:start */
:root, body {
	/* --- brand artwork (Antigravity orb gradient) --- */
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
		const S = {
			container: {
				display: "flex",
				flexDirection: "column",
				gap: "var(--agy-space-3)",
				padding: "var(--agy-space-2) var(--agy-space-1)",
				fontFamily: "var(--agy-font-family)",
				color: "var(--agy-text-primary)",
				fontSize: "var(--agy-font-md)",
				maxWidth: "1080px"
			},
			headerCard: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				flexWrap: "wrap",
				gap: "var(--agy-space-2)",
				padding: "var(--agy-space-3) var(--agy-space-4)",
				background: "var(--agy-bg-header)",
				border: "1px solid var(--agy-border-card)",
				borderRadius: "var(--agy-radius-lg)",
				boxShadow: "var(--agy-shadow-1)"
			},
			navBar: {
				display: "inline-flex",
				alignItems: "center",
				gap: "2px",
				padding: "3px",
				background: "var(--agy-bg-nav)",
				border: "1px solid var(--agy-border-divider)",
				borderRadius: "var(--agy-radius-md)",
				flexWrap: "wrap"
			},
			tab: {
				padding: "6px 13px",
				borderRadius: "var(--agy-radius-sm)",
				border: "none",
				background: "transparent",
				color: "var(--agy-seg-btn-text)",
				cursor: "pointer",
				fontSize: "var(--agy-font-sm)",
				fontWeight: 650,
				lineHeight: 1.35
			},
			panelTitle: {
				fontSize: "var(--agy-font-lg)",
				fontWeight: 750,
				letterSpacing: "0.01em",
				color: "var(--agy-text-primary)"
			},
			panelCaption: {
				fontSize: "var(--agy-font-xs)",
				fontWeight: 600,
				letterSpacing: "0.06em",
				color: "var(--agy-text-tertiary)",
				textTransform: "uppercase"
			},
			badgeBase: {
				display: "inline-flex",
				alignItems: "center",
				padding: "2px 8px",
				borderRadius: "var(--agy-radius-pill)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 650,
				lineHeight: 1.5
			},
			badgePrimary: {
				display: "inline-flex",
				alignItems: "center",
				padding: "2px 8px",
				borderRadius: "var(--agy-radius-pill)",
				background: "var(--agy-badge-primary-bg)",
				color: "var(--agy-badge-primary-text)",
				border: "1px solid var(--agy-badge-primary-border)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 650,
				lineHeight: 1.5
			},
			badgeTag: {
				display: "inline-flex",
				alignItems: "center",
				padding: "2px 8px",
				borderRadius: "var(--agy-radius-pill)",
				background: "var(--agy-badge-tag-bg)",
				color: "var(--agy-badge-tag-text)",
				border: "1px solid var(--agy-badge-tag-border)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 550,
				lineHeight: 1.5
			},
			badgeReady: {
				display: "inline-flex",
				alignItems: "center",
				padding: "2px 8px",
				borderRadius: "var(--agy-radius-pill)",
				background: "var(--agy-badge-ready-bg)",
				color: "var(--agy-badge-ready-text)",
				border: "1px solid var(--agy-badge-ready-border)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 650
			},
			badgeUnready: {
				display: "inline-flex",
				alignItems: "center",
				padding: "2px 8px",
				borderRadius: "var(--agy-radius-pill)",
				background: "var(--agy-badge-unready-bg)",
				color: "var(--agy-badge-unready-text)",
				border: "1px solid var(--agy-badge-unready-border)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 650
			},
			statBox: {
				padding: "var(--agy-space-3)",
				background: "var(--agy-bg-box)",
				border: "1px solid var(--agy-border-box)",
				borderRadius: "var(--agy-radius-md)"
			},
			statLabel: {
				fontSize: "var(--agy-font-xs)",
				fontWeight: 650,
				letterSpacing: "0.05em",
				color: "var(--agy-text-tertiary)",
				textTransform: "uppercase",
				marginBottom: "6px"
			},
			statValue: {
				fontFamily: "var(--agy-font-mono)",
				fontVariantNumeric: "tabular-nums",
				fontSize: "var(--agy-font-xl)",
				fontWeight: 750,
				color: "var(--agy-text-primary)",
				lineHeight: 1.2
			},
			statSub: {
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-text-tertiary)",
				marginTop: "5px",
				fontFamily: "var(--agy-font-mono)",
				fontVariantNumeric: "tabular-nums"
			},
			card: {
				padding: "var(--agy-space-3) var(--agy-space-4)",
				background: "var(--agy-bg-card)",
				border: "1px solid var(--agy-border-card)",
				borderRadius: "var(--agy-radius-lg)",
				boxShadow: "var(--agy-shadow-1)",
				marginBottom: "var(--agy-space-3)"
			},
			cardPrimary: {
				padding: "var(--agy-space-3) var(--agy-space-4)",
				background: "var(--agy-bg-card-primary)",
				border: "1px solid var(--agy-border-card-primary)",
				borderRadius: "var(--agy-radius-lg)",
				boxShadow: "var(--agy-shadow-card-primary)",
				marginBottom: "var(--agy-space-3)"
			},
			quotaBox: { marginTop: "var(--agy-space-2)" },
			progressBarBg: {
				flex: 1,
				minWidth: "64px",
				height: "7px",
				background: "var(--agy-bg-progress-track)",
				borderRadius: "var(--agy-radius-pill)",
				overflow: "hidden"
			},
			btn: {
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				padding: "6px 12px",
				borderRadius: "var(--agy-radius-sm)",
				border: "1px solid var(--agy-border-btn)",
				background: "var(--agy-bg-btn)",
				color: "var(--agy-text-btn)",
				fontSize: "var(--agy-font-sm)",
				fontWeight: 650,
				cursor: "pointer",
				lineHeight: 1.35
			},
			btnPrimary: {
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				padding: "6px 12px",
				borderRadius: "var(--agy-radius-sm)",
				border: "1px solid var(--agy-border-btn-primary)",
				background: "var(--agy-accent)",
				color: "var(--agy-on-accent)",
				fontSize: "var(--agy-font-sm)",
				fontWeight: 700,
				cursor: "pointer",
				lineHeight: 1.35,
				boxShadow: "var(--agy-shadow-1)"
			},
			btnDanger: {
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				padding: "6px 12px",
				borderRadius: "var(--agy-radius-sm)",
				border: "1px solid var(--agy-danger-border)",
				background: "transparent",
				color: "var(--agy-danger-text)",
				fontSize: "var(--agy-font-sm)",
				fontWeight: 650,
				cursor: "pointer",
				lineHeight: 1.35
			},
			btnSm: {
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				padding: "4px 9px",
				borderRadius: "var(--agy-radius-sm)",
				border: "1px solid var(--agy-border-btn)",
				background: "var(--agy-bg-btn)",
				color: "var(--agy-text-btn)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 600,
				cursor: "pointer",
				lineHeight: 1.35
			},
			btnSmPrimary: {
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				padding: "4px 9px",
				borderRadius: "var(--agy-radius-sm)",
				border: "1px solid var(--agy-border-btn-primary)",
				background: "var(--agy-accent)",
				color: "var(--agy-on-accent)",
				fontSize: "var(--agy-font-xs)",
				fontWeight: 650,
				cursor: "pointer",
				lineHeight: 1.35
			},
			segGroup: {
				display: "inline-flex",
				gap: "3px",
				padding: "3px",
				background: "var(--agy-seg-group-bg)",
				border: "1px solid var(--agy-seg-group-border)",
				borderRadius: "var(--agy-radius-md)"
			},
			segBtn: {
				padding: "5px 12px",
				borderRadius: "var(--agy-radius-sm)",
				border: "none",
				background: "transparent",
				color: "var(--agy-seg-btn-text)",
				cursor: "pointer",
				fontSize: "var(--agy-font-sm)",
				fontWeight: 600
			},
			segBtnActive: {
				padding: "5px 12px",
				borderRadius: "var(--agy-radius-sm)",
				border: "none",
				background: "var(--agy-seg-btn-active-bg)",
				color: "var(--agy-seg-btn-active-text)",
				cursor: "pointer",
				fontSize: "var(--agy-font-sm)",
				fontWeight: 700,
				boxShadow: "var(--agy-shadow-1)"
			},
			input: {
				flex: 1,
				minWidth: "0",
				padding: "7px 10px",
				borderRadius: "var(--agy-radius-sm)",
				border: "1px solid var(--agy-border-input)",
				background: "var(--agy-bg-input)",
				color: "var(--agy-text-primary)",
				fontSize: "var(--agy-font-sm)",
				fontFamily: "var(--agy-font-family)"
			},
			muted: {
				color: "var(--agy-text-muted)",
				fontSize: "var(--agy-font-sm)"
			},
			noticeBanner: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "var(--agy-space-2)",
				padding: "9px var(--agy-space-3)",
				borderRadius: "var(--agy-radius-md)",
				fontSize: "var(--agy-font-sm)",
				marginBottom: "var(--agy-space-2)"
			},
			authModal: {
				padding: "var(--agy-space-4)",
				background: "var(--agy-auth-box-bg)",
				border: "1px solid var(--agy-auth-box-border)",
				borderRadius: "var(--agy-radius-lg)",
				marginBottom: "var(--agy-space-3)"
			}
		};
		//#endregion
		//#region src/client/account-models.ts
		const EMPTY_PANEL = {
			status: "idle",
			payload: null,
			source: "quota-fallback",
			error: null,
			refreshError: null,
			fetchedAt: null
		};
		const QUOTA_FAMILY_ORDER = [
			"google",
			"anthropic",
			"openai"
		];
		function parsePayload(raw) {
			if (!raw || typeof raw !== "object") return null;
			const data = raw;
			const familyModels = Array.isArray(data.familyModels) ? data.familyModels : [];
			return {
				ok: typeof data.ok === "boolean" ? data.ok : true,
				id: typeof data.id === "string" ? data.id : void 0,
				alias: typeof data.alias === "string" ? data.alias : void 0,
				email: typeof data.email === "string" ? data.email : void 0,
				known: data.known === true,
				total: typeof data.total === "number" ? data.total : familyModels.reduce((n, g) => n + g.models.length, 0),
				refreshedAt: typeof data.refreshedAt === "number" ? data.refreshedAt : null,
				familyModels,
				refreshError: typeof data.refreshError === "string" ? data.refreshError : void 0
			};
		}
		async function readResult(res) {
			if (!res) return {
				payload: null,
				error: "network_unreachable",
				status: null
			};
			if (res.status === 404) return {
				payload: null,
				error: "account_not_found",
				status: 404
			};
			let body = null;
			try {
				body = await res.json();
			} catch {
				return {
					payload: null,
					error: "bad_json",
					status: res.status
				};
			}
			if (!res.ok) return {
				payload: null,
				error: body && typeof body === "object" && typeof body.error === "string" ? body.error : `http_${res.status}`,
				status: res.status
			};
			const payload = parsePayload(body);
			if (!payload) return {
				payload: null,
				error: "bad_payload",
				status: res.status
			};
			return {
				payload,
				error: null,
				status: res.status
			};
		}
		/** GET the discovered model list for one account. */
		async function fetchAccountModels(fetchJson, apiPrefix, id) {
			return readResult(await fetchJson(`${apiPrefix}/pool/account-models?id=${encodeURIComponent(id)}`));
		}
		/** POST a forced rediscovery for one account; on failure callers keep the previous panel data. */
		async function postAccountModelsRefresh(fetchJson, apiPrefix, id) {
			return readResult(await fetchJson(`${apiPrefix}/pool/account-models`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id,
					refresh: true
				})
			}));
		}
		/**
		* Build the same payload shape from the quota data embedded in status.pool, so the panel
		* can degrade gracefully when /pool/account-models is unavailable. The UI always labels
		* this source as a fallback.
		*/
		function buildQuotaFallbackPayload(acc) {
			const familyModels = [];
			for (const family of QUOTA_FAMILY_ORDER) {
				const quota = acc.quotas[family];
				if (!quota || !Array.isArray(quota.models) || quota.models.length === 0) continue;
				const models = quota.models.filter((m) => typeof m.modelId === "string" && m.modelId.trim() !== "").map((m) => ({
					id: m.modelId,
					name: m.displayName || m.modelId,
					family,
					remainingFraction: m.remainingFraction,
					resetTime: m.resetTime
				}));
				if (models.length === 0) continue;
				familyModels.push({
					family,
					known: true,
					models
				});
			}
			return {
				ok: true,
				id: acc.id,
				alias: acc.alias,
				email: acc.email,
				known: familyModels.length > 0,
				total: familyModels.reduce((n, g) => n + g.models.length, 0),
				refreshedAt: null,
				familyModels
			};
		}
		function selectPanelPayload(panel, acc) {
			if (panel?.payload) return {
				payload: panel.payload,
				usingFallback: panel.source !== "api"
			};
			return {
				payload: buildQuotaFallbackPayload(acc),
				usingFallback: true
			};
		}
		/** Discovered model ids for one account (last payload if any, quota fallback otherwise). */
		function accountModelIds(acc, panel) {
			const { payload } = selectPanelPayload(panel, acc);
			const ids = [];
			for (const group of payload.familyModels) for (const model of group.models) ids.push(model.id);
			return ids;
		}
		/**
		* Panel state after a failed initial GET: the previous payload and its source are kept
		* (an empty panel stays an empty panel); the error is recorded for the visible strip.
		*/
		function markPanelLoadFailure(prev, error, now) {
			return {
				...prev,
				status: "error",
				payload: prev.payload,
				source: prev.source,
				error,
				refreshError: null,
				fetchedAt: now
			};
		}
		/** Panel state after a failed POST refresh: same payload preservation plus the refreshError marker. */
		function markPanelRefreshFailure(prev, error, now) {
			return {
				...prev,
				status: "error",
				payload: prev.payload,
				source: prev.source,
				error,
				refreshError: error,
				fetchedAt: now
			};
		}
		/** Panel state after a successful fetch (GET or refresh): the fresh payload becomes the panel's truth. */
		function markPanelSuccess(prev, payload, refreshError, now) {
			return {
				...prev,
				status: "ok",
				payload,
				source: "api",
				error: null,
				refreshError,
				fetchedAt: now
			};
		}
		/** A loaded panel is considered fresh for this long before on-demand rediscovery re-triggers. */
		const PANEL_TTL_MS = 6e4;
		/**
		* Which accounts the auto-load effect should (re)load right now:
		* - panels never loaded (missing / idle), and
		* - healthy panels whose data exceeded the TTL.
		* 'loading' and 'error' panels are deliberately excluded: a broken endpoint is retried
		* only by an explicit user action, never implicitly on every status-poll reference change.
		*/
		function collectStalePanelAccounts(panels, accounts, now, ttlMs = PANEL_TTL_MS) {
			return accounts.filter((acc) => {
				const panel = panels[acc.id];
				if (!panel || panel.status === "idle") return true;
				if (panel.status === "loading" || panel.status === "error") return false;
				return panel.fetchedAt !== null && now - panel.fetchedAt > ttlMs;
			});
		}
		/** Single source of truth for the expandable model panel's DOM id (aria-controls wiring). */
		function modelsPanelDomId(accId) {
			return `models-panel-${accId}`;
		}
		/** Human-readable reset window: absolute clock + remaining countdown, weekly vs 5h aware. */
		function formatQuotaWindow(resetTimeStr, nowMs = Date.now()) {
			if (!resetTimeStr) return { resetText: "" };
			try {
				const d = new Date(resetTimeStr);
				const diffMs = d.getTime() - nowMs;
				if (!Number.isFinite(diffMs) || diffMs <= 0) return { resetText: "" };
				const totalMins = Math.ceil(diffMs / 6e4);
				const days = Math.floor(totalMins / 1440);
				const hours = Math.floor(totalMins % 1440 / 60);
				const mins = totalMins % 60;
				const isWeekly = days >= 1;
				const countdown = days > 0 ? `${days}d${hours}h` : hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
				const hh = d.getHours().toString().padStart(2, "0");
				const mm = d.getMinutes().toString().padStart(2, "0");
				return { resetText: isWeekly ? `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm} (${countdown})` : `${hh}:${mm} (${countdown})` };
			} catch {
				return { resetText: "" };
			}
		}
		/** Size of the discovered-model union across all accounts (the denominator of coverage). */
		function computeModelUnion(panels, accounts) {
			const union = /* @__PURE__ */ new Set();
			for (const acc of accounts) for (const id of accountModelIds(acc, panels[acc.id])) union.add(id);
			return union.size;
		}
		/** Model ids that at least one *other* account also supports. */
		function computeOtherAccountModelIds(panels, accounts, accId) {
			const others = /* @__PURE__ */ new Set();
			for (const acc of accounts) {
				if (acc.id === accId) continue;
				for (const id of accountModelIds(acc, panels[acc.id])) others.add(id);
			}
			return others;
		}
		//#endregion
		//#region src/client/poll-state.ts
		/**
		* Fold one poll outcome into the poll UI state.
		* - A failed poll only flips `pollOk` (the shown data stays, stamped with the last good time).
		* - Any successful poll restores `pollOk = true` — even when the status JSON is unchanged,
		*   so the page can never stay stuck on 「轮询中断」 after connectivity recovers.
		* - `lastUpdatedAt` is re-stamped on recovery and on data change; a healthy poll of unchanged
		*   data keeps the previous timestamp so React bails out instead of re-rendering the tree.
		*/
		function applyPollOutcome(prev, outcome, nowMs) {
			if (!outcome.ok) return {
				pollOk: false,
				lastUpdatedAt: prev.lastUpdatedAt
			};
			if (!prev.pollOk || outcome.statusChanged) return {
				pollOk: true,
				lastUpdatedAt: nowMs
			};
			return {
				pollOk: true,
				lastUpdatedAt: prev.lastUpdatedAt
			};
		}
		/**
		* Seed the config input drafts from the backend status.
		* - `undefined` means "the user has never touched this field" and gets seeded from status.
		* - Any string (including one the user cleared to '') is a user edit and is preserved.
		* - A null status (not loaded yet) must not freeze the drafts to '' — that is exactly what
		*   used to make the fields never backfill, because '' is not "unedited".
		*/
		function seedConfigDrafts(prev, status) {
			if (!status) return prev;
			const next = { ...prev };
			if (next.defaultModel === void 0 && typeof status.defaultModel === "string") next.defaultModel = status.defaultModel;
			if (next.defaultEffort === void 0 && typeof status.defaultEffort === "string") next.defaultEffort = status.defaultEffort;
			return next;
		}
		function accountAddFlowView(addingAccount, poolAuthPhase) {
			const flowActive = addingAccount && (poolAuthPhase === "waiting" || poolAuthPhase === "exchanging");
			return {
				flowActive,
				showBrowserStart: !flowActive
			};
		}
		//#endregion
		//#region src/client/index.ts
		const { createElement: h, useState, useEffect, useRef } = require("react");
		const reactDom = require("react-dom");
		const win = globalThis;
		const bodyEl = win.document?.body ?? null;
		const portalToBody = (node) => {
			if (bodyEl && reactDom && typeof reactDom.createPortal === "function") return reactDom.createPortal(node, bodyEl);
			return node;
		};
		const name = "dsh-cloudcode-link-client";
		const inject = ["slots"];
		const base = win.location?.origin ?? "";
		const API_PREFIX = "/plugins/cloudcode-link";
		const LEGACY_API_PREFIX = "/plugins/agy-link";
		/**
		* Primary prefix, then a 404-only fallback to the legacy prefix (older host builds).
		* Failure is visible: null means "no usable response" and every caller surfaces it in the UI.
		*/
		async function fetchWithFallback(urlPath, options) {
			if (!win.fetch) return null;
			const fullUrl = `${base}${urlPath}`;
			try {
				const res = await win.fetch(fullUrl, options);
				if (res && res.status === 404 && urlPath.startsWith(API_PREFIX)) {
					const legacy = `${base}${LEGACY_API_PREFIX}${urlPath.slice(23)}`;
					const res2 = await win.fetch(legacy, options);
					if (res2) return {
						ok: res2.ok,
						status: res2.status,
						json: () => res2.json()
					};
					return null;
				}
				if (res) return {
					ok: res.ok,
					status: res.status,
					json: () => res.json()
				};
				return null;
			} catch {
				return null;
			}
		}
		let statusCache = null;
		async function getStatus() {
			try {
				const res = await fetchWithFallback(`${API_PREFIX}/status`);
				if (!res || !res.ok) return null;
				const payload = await res.json();
				statusCache = payload;
				return payload;
			} catch {
				return null;
			}
		}
		async function postJson(path, body) {
			try {
				const res = await fetchWithFallback(path, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body)
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
		function maskEmail(email) {
			if (!email || typeof email !== "string") return "";
			const atIdx = email.indexOf("@");
			if (atIdx <= 0) return email;
			const user = email.slice(0, atIdx);
			const domain = email.slice(atIdx);
			if (user.length <= 2) return `${user[0]}***${domain}`;
			return `${user.slice(0, 2)}***${domain}`;
		}
		function formatNumber(n) {
			return Number(n || 0).toLocaleString();
		}
		function formatCompactTokens(n) {
			if (!n) return "0";
			if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
			return String(n);
		}
		function formatClock(ms) {
			if (!ms) return "—";
			try {
				return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
			} catch {
				return new Date(ms).toISOString().slice(11, 19);
			}
		}
		/** Inline brand logo (Gemini / Claude / OpenAI) as a crisp SVG mark. */
		function brandIcon(key, size = 13) {
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				"aria-hidden": true,
				style: {
					display: "inline-block",
					verticalAlign: "-2px",
					flexShrink: 0
				}
			}, h("path", {
				d: BRAND_PATHS[key],
				fill: BRAND_COLORS[key]
			}));
		}
		/** Clean outline/filled SVG icon (Lucide-style), zero emoji dependency. */
		function uiIcon(key, size = 12, color = "currentColor") {
			const p = UI_PATHS[key];
			const isFilled = key === "star";
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				"aria-hidden": true,
				style: {
					display: "inline-block",
					verticalAlign: "-1.5px",
					flexShrink: 0
				}
			}, h("path", {
				d: p,
				fill: isFilled ? color : "none",
				stroke: isFilled ? "none" : color,
				"stroke-width": isFilled ? void 0 : 2,
				"stroke-linecap": isFilled ? void 0 : "round",
				"stroke-linejoin": isFilled ? void 0 : "round"
			}));
		}
		const FAMILY_BRAND = {
			google: "gemini",
			anthropic: "claude",
			openai: "openai"
		};
		const FAMILY_LABEL = {
			google: "Gemini",
			anthropic: "Claude",
			openai: "GPT-OSS",
			unknown: "其他"
		};
		const agyIconGradientIds = /* @__PURE__ */ new Map();
		/** Antigravity mark: gradient orb with an orbit ring (product has no public simple-icon). */
		function agyIcon(size = 14) {
			let gid = agyIconGradientIds.get(size);
			if (!gid) {
				gid = `agy-g-${size}`;
				agyIconGradientIds.set(size, gid);
			}
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				"aria-hidden": true,
				style: {
					display: "inline-block",
					verticalAlign: "-2px",
					flexShrink: 0
				}
			}, h("defs", null, h("linearGradient", {
				id: gid,
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "1"
			}, h("stop", {
				offset: "0",
				"stop-color": "var(--agy-brand-a)"
			}), h("stop", {
				offset: "1",
				"stop-color": "var(--agy-brand-b)"
			}))), h("circle", {
				cx: 12,
				cy: 12,
				r: 6,
				fill: `url(#${gid})`
			}), h("ellipse", {
				cx: 12,
				cy: 12,
				rx: 10.4,
				ry: 3.9,
				fill: "none",
				stroke: `url(#${gid})`,
				"stroke-width": 1.4,
				transform: "rotate(-18 12 12)"
			}));
		}
		/**
		* Self-ticking reset countdown. This leaf is the only node that re-renders once per
		* second; the page tree around it stays put. Renders `↻ HH:MM (XhYm)` while a reset
		* window is pending, or the empty marker (default `—`) once it is gone.
		*/
		function ResetCountdown(props) {
			const [tick, setTick] = useState(0);
			useEffect(() => {
				const timer = setInterval(() => setTick((n) => n + 1), 1e3);
				return () => clearInterval(timer);
			}, []);
			const { resetText } = formatQuotaWindow(props.resetTime);
			const body = resetText ? `${props.prefix ?? "↻ "}${resetText}` : `${props.emptyPrefix ?? "—"}${props.emptyText ?? ""}`;
			return h("span", {
				className: props.className,
				style: props.style
			}, `${body}${props.suffix ?? ""}`);
		}
		function apply(ctx) {
			const AgySettingsSection = (props) => {
				const [status, setStatus] = useState(statusCache);
				const [pollOk, setPollOk] = useState(statusCache !== null);
				const [lastUpdatedAt, setLastUpdatedAt] = useState(statusCache ? Date.now() : null);
				const [activeSection, setActiveSection] = useState("overview");
				const [aliasInput, setAliasInput] = useState("");
				const [proxyInputs, setProxyInputs] = useState({});
				const [editingProxyId, setEditingProxyId] = useState(null);
				const [addingAccount, setAddingAccount] = useState(false);
				const [authCodeInput, setAuthCodeInput] = useState("");
				const [loadingAction, setLoadingAction] = useState(null);
				const [toast, setToast] = useState(null);
				const [expandedModels, setExpandedModels] = useState({});
				const [modelPanels, setModelPanels] = useState({});
				const [modelQueries, setModelQueries] = useState({});
				const [familyFilters, setFamilyFilters] = useState({});
				const [statsOverview, setStatsOverview] = useState(null);
				const [statsError, setStatsError] = useState(null);
				const [showAuditDrawer, setShowAuditDrawer] = useState(false);
				const [auditTab, setAuditTab] = useState("requests");
				const [auditRequests, setAuditRequests] = useState([]);
				const [auditTotal, setAuditTotal] = useState(0);
				const [auditPage, setAuditPage] = useState(0);
				const [auditLoading, setAuditLoading] = useState(false);
				const [auditSessions, setAuditSessions] = useState([]);
				const [auditSessionsTotal, setAuditSessionsTotal] = useState(0);
				const [auditSessionsPage, setAuditSessionsPage] = useState(0);
				const [auditSessionsLoading, setAuditSessionsLoading] = useState(false);
				const [auditError, setAuditError] = useState(null);
				const [cfgDrafts, setCfgDrafts] = useState({});
				const flowStartedRef = useRef(false);
				const pollOkRef = useRef(statusCache !== null);
				const lastUpdatedRef = useRef(statusCache ? Date.now() : null);
				const toastTimerRef = useRef(null);
				const tabRefs = useRef({});
				const showToast = (text, type) => {
					setToast({
						text,
						type
					});
					if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
					toastTimerRef.current = setTimeout(() => setToast(null), 6e3);
				};
				const fetchStatsOverview = async () => {
					try {
						const res = await fetchWithFallback(`${API_PREFIX}/stats/overview`);
						if (!res || !res.ok) {
							setStatsError("用量统计加载失败（后端未返回可用数据）");
							return;
						}
						const data = await res.json();
						if (!data.overview) {
							setStatsError("用量统计加载失败（响应缺少 overview 字段）");
							return;
						}
						setStatsOverview(data.overview);
						setStatsError(null);
					} catch {
						setStatsError("用量统计加载失败（网络异常）");
					}
				};
				const fetchAuditRequests = async (limit, offset) => {
					setAuditLoading(true);
					try {
						const res = await fetchWithFallback(`${API_PREFIX}/stats/requests?limit=${limit}&offset=${offset}`);
						if (!res || !res.ok) {
							setAuditError("请求明细加载失败（后端未返回可用数据）");
							return;
						}
						const data = await res.json();
						setAuditRequests(data.requests ?? []);
						setAuditTotal(typeof data.total === "number" ? data.total : data.requests?.length ?? 0);
						setAuditError(null);
					} catch {
						setAuditError("请求明细加载失败（网络异常）");
					} finally {
						setAuditLoading(false);
					}
				};
				const fetchAuditSessions = async (limit, offset) => {
					setAuditSessionsLoading(true);
					try {
						const res = await fetchWithFallback(`${API_PREFIX}/stats/sessions?limit=${limit}&offset=${offset}`);
						if (!res || !res.ok) {
							setAuditError("会话统计加载失败（后端未返回可用数据）");
							return;
						}
						const data = await res.json();
						setAuditSessions(data.sessions ?? []);
						setAuditSessionsTotal(typeof data.total === "number" ? data.total : data.sessions?.length ?? 0);
						setAuditError(null);
					} catch {
						setAuditError("会话统计加载失败（网络异常）");
					} finally {
						setAuditSessionsLoading(false);
					}
				};
				useEffect(() => {
					let alive = true;
					let lastJson = status ? JSON.stringify(status) : "";
					const tick = async () => {
						const st = await getStatus();
						if (!alive) return;
						if (!st) {
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
						const next = applyPollOutcome({
							pollOk: pollOkRef.current,
							lastUpdatedAt: lastUpdatedRef.current
						}, {
							ok: true,
							statusChanged: changed
						}, Date.now());
						pollOkRef.current = next.pollOk;
						lastUpdatedRef.current = next.lastUpdatedAt;
						setPollOk(next.pollOk);
						setLastUpdatedAt(next.lastUpdatedAt);
					};
					tick();
					const timer = setInterval(() => {
						tick();
					}, 3e3);
					fetchStatsOverview();
					const statsTimer = setInterval(() => {
						fetchStatsOverview();
					}, 1e4);
					return () => {
						alive = false;
						clearInterval(timer);
						clearInterval(statsTimer);
					};
				}, []);
				useEffect(() => () => {
					if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
				}, []);
				useEffect(() => {
					if (!showAuditDrawer) return;
					const onKey = (ev) => {
						if (ev.key === "Escape") setShowAuditDrawer(false);
					};
					win.addEventListener?.("keydown", onKey, true);
					return () => {
						win.removeEventListener?.("keydown", onKey, true);
					};
				}, [showAuditDrawer]);
				useEffect(() => {
					if (!showAuditDrawer) return;
					fetchAuditRequests(20, auditPage * 20);
				}, [showAuditDrawer, auditPage]);
				useEffect(() => {
					if (!showAuditDrawer || auditTab !== "sessions") return;
					fetchAuditSessions(20, auditSessionsPage * 20);
				}, [
					showAuditDrawer,
					auditTab,
					auditSessionsPage
				]);
				useEffect(() => {
					const phase = status?.poolAuth?.phase;
					if (phase === "waiting" || phase === "exchanging") flowStartedRef.current = true;
					if (phase === "done" && flowStartedRef.current) {
						flowStartedRef.current = false;
						setAddingAccount(false);
						setAuthCodeInput("");
						showToast("账号已激活入池", "success");
					} else if (phase === "failed" && flowStartedRef.current) {
						flowStartedRef.current = false;
						showToast(status?.poolAuth?.message || "账号激活失败，请重试或手动粘贴授权码", "error");
					}
				}, [status?.poolAuth?.phase]);
				useEffect(() => {
					if (!status) return;
					setCfgDrafts((prev) => seedConfigDrafts(prev, status));
				}, [status?.defaultModel, status?.defaultEffort]);
				const accounts = status?.pool?.accounts ?? [];
				const isAuthed = status?.auth?.phase === "ok" || accounts.length > 0;
				const isBusy = typeof loadingAction === "string";
				const modelUnionTotal = computeModelUnion(modelPanels, accounts);
				const accountModelIdsOf = (acc) => accountModelIds(acc, modelPanels[acc.id]);
				const loadModelsPanel = async (accId) => {
					setModelPanels((prev) => ({
						...prev,
						[accId]: {
							...prev[accId] ?? EMPTY_PANEL,
							status: "loading"
						}
					}));
					const result = await fetchAccountModels(fetchWithFallback, API_PREFIX, accId);
					const payload = result.payload;
					if (payload && payload.ok !== false) {
						setModelPanels((prev) => ({
							...prev,
							[accId]: markPanelSuccess(prev[accId] ?? EMPTY_PANEL, payload, payload.refreshError ?? null, Date.now())
						}));
						return;
					}
					setModelPanels((prev) => ({
						...prev,
						[accId]: markPanelLoadFailure(prev[accId] ?? EMPTY_PANEL, result.error ?? "models_endpoint_failed", Date.now())
					}));
				};
				const refreshModelsPanel = async (acc) => {
					setModelPanels((prev) => ({
						...prev,
						[acc.id]: {
							...prev[acc.id] ?? EMPTY_PANEL,
							status: "loading"
						}
					}));
					const result = await postAccountModelsRefresh(fetchWithFallback, API_PREFIX, acc.id);
					const payload = result.payload;
					if (payload && payload.ok !== false) {
						setModelPanels((prev) => ({
							...prev,
							[acc.id]: markPanelSuccess(prev[acc.id] ?? EMPTY_PANEL, payload, payload.refreshError ?? null, Date.now())
						}));
						if (payload.refreshError) showToast(`刷新未完成：${payload.refreshError}（旧清单已保留）`, "warn");
						else showToast("模型清单已刷新", "success");
						return;
					}
					setModelPanels((prev) => ({
						...prev,
						[acc.id]: markPanelRefreshFailure(prev[acc.id] ?? EMPTY_PANEL, result.error ?? "models_refresh_failed", Date.now())
					}));
					showToast("模型刷新失败，已保留上一次发现的模型数据", "error");
				};
				const ensureModelsLoaded = (accId) => {
					const panel = modelPanels[accId];
					if (!panel || panel.status === "idle") loadModelsPanel(accId);
				};
				const accountIdsFingerprint = accounts.map((acc) => acc.id).join("|");
				useEffect(() => {
					if (activeSection !== "models") return;
					const stale = collectStalePanelAccounts(modelPanels, accounts, Date.now());
					if (stale.length === 0) return;
					(async () => {
						for (const acc of stale) await loadModelsPanel(acc.id);
					})();
				}, [activeSection, accountIdsFingerprint]);
				const refresh = async () => {
					setLoadingAction("status");
					try {
						const st = await getStatus();
						if (!st) {
							pollOkRef.current = false;
							setPollOk(false);
							showToast("状态刷新失败：暂时联系不上后端，页面保留的是上次成功拉取的数据", "error");
							return;
						}
						pollOkRef.current = true;
						lastUpdatedRef.current = Date.now();
						setPollOk(true);
						setLastUpdatedAt(lastUpdatedRef.current);
						setStatus(st);
						showToast("状态已刷新", "success");
					} finally {
						setLoadingAction(null);
					}
				};
				const runPoolAction = async (label, path, payload, okText) => {
					setLoadingAction(label);
					try {
						const res = await postJson(`${API_PREFIX}${path}`, payload);
						if (!res || res.ok === false) {
							const reason = res && typeof res.error === "string" ? res.error : "后端未响应";
							showToast(`${okText}失败：${reason}`, "error");
							return null;
						}
						showToast(okText, "success");
						return res;
					} finally {
						setLoadingAction(null);
					}
				};
				const handleBeginAddAccount = async () => {
					setLoadingAction("begin-add");
					try {
						const trimmed = aliasInput.trim();
						const res = await postJson(`${API_PREFIX}/pool/begin-add`, trimmed ? { alias: trimmed } : {});
						if (!res) {
							showToast("无法联系后端，添加流程未启动", "error");
							return;
						}
						if (res.ok === false) {
							showToast(`添加流程启动失败：${typeof res.error === "string" ? res.error : "未知原因"}`, "error");
							return;
						}
						setAddingAccount(true);
						if (res.browserOpened === false) showToast("未自动打开浏览器，请在添加面板中使用手动授权链接", "warn");
						else showToast("已发起浏览器授权，请在打开的 Google 登录页完成授权", "info");
					} finally {
						setLoadingAction(null);
					}
				};
				const handleCompleteAddAccount = async () => {
					const code = authCodeInput.trim();
					if (!code) {
						showToast("请先粘贴授权码或回调链接", "warn");
						return;
					}
					if (await runPoolAction("complete-add", "/pool/complete-add", { code }, "手动激活请求已提交")) setAuthCodeInput("");
				};
				const handleCancelAddAccount = async () => {
					flowStartedRef.current = false;
					setAddingAccount(false);
					setAuthCodeInput("");
					await runPoolAction("cancel-add", "/pool/cancel-add", {}, "添加流程已取消");
				};
				const setCfg = async (key, value) => {
					if (await runPoolAction(`config:${key}`, "/config", {
						key,
						value
					}, `${key} 已保存`)) setStatus((prev) => prev ? {
						...prev,
						[key]: value
					} : prev);
				};
				const setPrimary = async (id) => {
					await runPoolAction("primary", "/pool/primary", { id }, "已设为主用账号");
				};
				const removeAccount = async (id) => {
					await runPoolAction("remove", "/pool/remove", { id }, "账号已移除");
				};
				const refreshQuota = async (id) => {
					await runPoolAction("quota", "/pool/refresh-quota", id ? { id } : {}, "额度已刷新");
				};
				const saveProxy = async (id) => {
					const proxyUrl = (proxyInputs[id] ?? "").trim();
					if (await runPoolAction("proxy", "/pool/proxy", {
						id,
						proxyUrl
					}, proxyUrl ? "代理已保存" : "已改用全局代理")) setEditingProxyId(null);
				};
				const clearCooldown = async (id) => {
					await runPoolAction("cooldown", "/pool/clear-cooldown", id ? { id } : {}, "本地冷却已清除");
				};
				const toggleExpand = (accId) => {
					const next = !expandedModels[accId];
					setExpandedModels((prev) => ({
						...prev,
						[accId]: next
					}));
					if (next) ensureModelsLoaded(accId);
				};
				const renderSkeletonRow = (widthPct, heightPx = 14) => h("div", {
					className: "agy-skeleton",
					"aria-hidden": true,
					style: {
						width: `${widthPct}%`,
						height: `${heightPx}px`,
						marginBottom: "var(--agy-space-2)"
					}
				});
				const renderSkeletonCard = () => h("div", { style: S.card }, renderSkeletonRow(35, 18), renderSkeletonRow(80), renderSkeletonRow(60), h("span", { className: "agy-sr-only" }, "正在加载"));
				const renderEmptyState = (text, action) => h("div", { style: {
					padding: "var(--agy-space-5)",
					textAlign: "center",
					border: "1px dashed var(--agy-border-divider)",
					borderRadius: "var(--agy-radius-lg)",
					background: "var(--agy-bg-subbox)"
				} }, h("div", { style: {
					color: "var(--agy-text-secondary)",
					fontSize: "var(--agy-font-md)",
					lineHeight: 1.6
				} }, text), action ? h("div", { style: { marginTop: "var(--agy-space-3)" } }, action) : null);
				const renderStrip = (kind, text, retry) => h("div", {
					role: "alert",
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "var(--agy-space-2)",
						padding: "9px var(--agy-space-3)",
						borderRadius: "var(--agy-radius-md)",
						background: kind === "error" ? "var(--agy-danger-bg)" : kind === "warn" ? "var(--agy-warn-bg)" : "var(--agy-info-bg)",
						border: `1px solid ${kind === "error" ? "var(--agy-danger-border)" : kind === "warn" ? "var(--agy-warn-border)" : "var(--agy-info-border)"}`,
						color: kind === "error" ? "var(--agy-danger-text)" : kind === "warn" ? "var(--agy-warn-text)" : "var(--agy-info-text)",
						fontSize: "var(--agy-font-sm)",
						marginBottom: "var(--agy-space-2)"
					}
				}, h("span", null, text), retry ? h("button", {
					className: "agy-btn",
					style: S.btnSm,
					onClick: retry,
					"aria-label": "重试加载"
				}, uiIcon("refresh", 12), "重试") : null);
				const numOf = (obj, key) => {
					const v = obj ? obj[key] : void 0;
					return typeof v === "number" && Number.isFinite(v) ? v : null;
				};
				const renderStatCard = (label, value, sub, valueColor) => h("div", {
					className: "agy-card-hover",
					style: {
						...S.statBox,
						flex: "1 1 150px"
					}
				}, h("div", { style: S.statLabel }, label), h("div", { style: {
					...S.statValue,
					color: valueColor ?? "var(--agy-text-primary)"
				} }, value), sub ? h("div", { style: S.statSub }, sub) : null);
				const renderToastBanner = () => {
					if (!toast) return null;
					const tone = {
						success: {
							bg: "var(--agy-toast-success-bg)",
							border: "var(--agy-toast-success-border)",
							text: "var(--agy-toast-success-text)"
						},
						info: {
							bg: "var(--agy-toast-info-bg)",
							border: "var(--agy-toast-info-border)",
							text: "var(--agy-toast-info-text)"
						},
						warn: {
							bg: "var(--agy-toast-warn-bg)",
							border: "var(--agy-toast-warn-border)",
							text: "var(--agy-toast-warn-text)"
						},
						error: {
							bg: "var(--agy-toast-error-bg)",
							border: "var(--agy-toast-error-border)",
							text: "var(--agy-toast-error-text)"
						}
					}[toast.type];
					return h("div", {
						role: "status",
						"aria-live": "polite",
						className: "agy-rise",
						style: {
							...S.noticeBanner,
							background: tone.bg,
							border: `1px solid ${tone.border}`,
							color: tone.text
						}
					}, h("span", null, toast.text), h("button", {
						className: "agy-btn",
						style: {
							...S.btnSm,
							background: "transparent",
							border: "none"
						},
						onClick: () => setToast(null),
						"aria-label": "关闭提示"
					}, uiIcon("x", 12)));
				};
				const quotaGradientFor = (pct, cooling) => {
					if (cooling) return "var(--agy-quota-cool-grad)";
					if (pct < 10) return "var(--agy-quota-low-grad)";
					if (pct <= 30) return "var(--agy-quota-med-grad)";
					return "var(--agy-quota-high-grad)";
				};
				const quotaTextFor = (pct, cooling) => {
					if (cooling) return "var(--agy-quota-none-text)";
					if (pct < 10) return "var(--agy-quota-low-text)";
					if (pct <= 30) return "var(--agy-quota-med-text)";
					return "var(--agy-quota-high-text)";
				};
				const renderQuotaBar = (label, familyKey, acc) => {
					const info = acc.quotas[familyKey];
					const cd = acc.cooldowns[familyKey];
					const cooling = !!(cd && cd.cooldownUntil > Date.now());
					const pct5h = typeof info?.remainingFraction === "number" ? Math.max(0, Math.min(100, Math.round(info.remainingFraction * 100))) : -1;
					const pctWeekly = typeof info?.weeklyFraction === "number" ? Math.max(0, Math.min(100, Math.round(info.weeklyFraction * 100))) : -1;
					const cdNote = cooling ? " · 本地冷却中" : "";
					const line = (windowLabel, pct, resetTime) => {
						if (pct < 0) return h("div", { style: {
							display: "flex",
							alignItems: "center",
							gap: "var(--agy-space-2)",
							marginBottom: "5px"
						} }, h("span", { style: {
							width: "56px",
							color: "var(--agy-text-tertiary)",
							fontSize: "var(--agy-font-xs)"
						} }, windowLabel), h("span", {
							className: "agy-num",
							style: {
								...S.muted,
								fontSize: "var(--agy-font-xs)"
							}
						}, `未同步${cdNote}`));
						return h("div", { style: {
							display: "flex",
							alignItems: "center",
							gap: "var(--agy-space-2)",
							marginBottom: "5px"
						} }, h("span", { style: {
							width: "56px",
							color: "var(--agy-text-tertiary)",
							fontSize: "var(--agy-font-xs)"
						} }, windowLabel), h("div", {
							style: S.progressBarBg,
							"aria-hidden": true
						}, h("div", {
							className: "agy-progress-fill",
							style: {
								width: `${pct}%`,
								height: "100%",
								borderRadius: "var(--agy-radius-pill)",
								background: quotaGradientFor(pct, cooling)
							}
						})), h("span", {
							className: "agy-num",
							style: {
								fontSize: "var(--agy-font-xs)",
								fontWeight: 700,
								color: quotaTextFor(pct, cooling),
								minWidth: "38px",
								textAlign: "right"
							}
						}, `${pct}%`), h(ResetCountdown, {
							resetTime,
							suffix: cdNote,
							className: "agy-num",
							style: {
								fontSize: "var(--agy-font-xs)",
								color: "var(--agy-text-tertiary)",
								minWidth: "128px"
							}
						}));
					};
					return h("div", { style: S.quotaBox }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "6px",
						marginBottom: "5px"
					} }, brandIcon(FAMILY_BRAND[familyKey], 13), h("span", { style: {
						fontSize: "var(--agy-font-sm)",
						fontWeight: 700,
						color: "var(--agy-text-primary)"
					} }, label)), line("5h 额度", pct5h, info?.resetTime), line("周额度", pctWeekly, info?.weeklyResetTime));
				};
				const renderedAccountCards = accounts.map((acc, idx) => {
					const isPrimary = acc.id === status?.pool?.primaryAccountId;
					const hasCooldown = Object.values(acc.cooldowns ?? {}).some((cd) => cd && cd.cooldownUntil > Date.now());
					const isAuthRequired = acc.authRequired === true;
					const dotColor = !acc.enabled ? "var(--agy-strong-neutral)" : isAuthRequired ? "var(--agy-strong-danger)" : hasCooldown ? "var(--agy-strong-warn)" : "var(--agy-strong-ok)";
					const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
					const displayName = acc.email ? isAutoAlias ? acc.email : acc.alias : acc.alias || acc.id;
					const showEmailBadge = acc.email && !isAutoAlias;
					const modelCount = accountModelIdsOf(acc).length;
					const expanded = !!expandedModels[acc.id];
					return h("div", {
						key: acc.id,
						className: "agy-card-hover agy-rise",
						style: {
							...isPrimary ? S.cardPrimary : S.card,
							"--i": Math.min(idx, 8)
						}
					}, h("div", { style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						flexWrap: "wrap",
						gap: "var(--agy-space-2)"
					} }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						minWidth: 0
					} }, h("span", {
						className: "agy-pulse-dot",
						"aria-hidden": true,
						style: { background: dotColor }
					}), h("span", { style: {
						fontSize: "var(--agy-font-lg)",
						fontWeight: 750,
						color: "var(--agy-text-primary)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						maxWidth: "340px"
					} }, displayName), isPrimary ? h("span", { style: S.badgePrimary }, uiIcon("star", 11), " 主用") : null, acc.proxyUrl ? h("span", {
						style: S.badgeTag,
						title: `专属代理：${acc.proxyUrl}`
					}, uiIcon("globe", 11), " 代理") : null, showEmailBadge ? h("span", {
						style: S.badgeTag,
						title: acc.email
					}, uiIcon("mail", 11), ` ${maskEmail(acc.email)}`) : null, isAuthRequired ? h("span", { style: S.badgeUnready }, "需重新登录") : null, h("span", {
						style: S.badgeTag,
						title: "已发现的模型数"
					}, uiIcon("layers", 11), ` 模型 ${modelCount}`)), h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "5px",
						flexWrap: "wrap"
					} }, h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => toggleExpand(acc.id),
						"aria-expanded": expanded,
						"aria-controls": modelsPanelDomId(acc.id),
						title: "查看该账号支持的模型与额度"
					}, uiIcon(expanded ? "chevronUp" : "chevronDown", 11), expanded ? " 收起" : " 明细"), h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => void refreshQuota(acc.id),
						disabled: isBusy,
						title: "刷新此账号（换号后点这里立即同步 email / 额度 / 模型）",
						"aria-label": `同步账号 ${displayName}`
					}, uiIcon("refresh", 11), " 同步"), !isPrimary ? h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => void setPrimary(acc.id),
						disabled: isBusy,
						title: "切换调度主用账号"
					}, "设为主用") : null, h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => {
							if (editingProxyId === acc.id) setEditingProxyId(null);
							else {
								setEditingProxyId(acc.id);
								setProxyInputs((prev) => ({
									...prev,
									[acc.id]: acc.proxyUrl ?? ""
								}));
							}
						},
						"aria-expanded": editingProxyId === acc.id,
						title: "配置该账号的专属代理"
					}, uiIcon("globe", 11), " 代理"), accounts.length > 1 ? h("button", {
						className: "agy-btn",
						style: S.btnDanger,
						onClick: () => void removeAccount(acc.id),
						disabled: isBusy,
						"aria-label": `移除此账号 ${displayName}`,
						title: "从账号池移除（不会吊销 Google 侧授权）"
					}, uiIcon("trash", 11), " 移除此") : null)), h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-4)",
						flexWrap: "wrap",
						marginTop: "var(--agy-space-2)"
					} }, renderQuotaBar("Gemini", "google", acc), renderQuotaBar("Claude", "anthropic", acc), renderQuotaBar("GPT-OSS", "openai", acc)), hasCooldown ? h("div", {
						className: "agy-cooldown-breathe",
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: "var(--agy-space-2)",
							marginTop: "var(--agy-space-2)",
							padding: "8px var(--agy-space-3)",
							borderRadius: "var(--agy-radius-md)",
							background: "var(--agy-warn-bg)",
							border: "1px solid var(--agy-warn-border)",
							color: "var(--agy-warn-text)",
							fontSize: "var(--agy-font-sm)"
						}
					}, h("span", { style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "6px"
					} }, uiIcon("zap", 12), "部分模型限流中，已自动切换账号"), h("button", {
						className: "agy-btn",
						style: {
							...S.btnSm,
							background: "var(--agy-warn-btn-bg)",
							color: "var(--agy-warn-btn-text)",
							border: "1px solid var(--agy-warn-btn-border)"
						},
						onClick: () => void clearCooldown(acc.id),
						disabled: isBusy
					}, "清除冷却")) : null, editingProxyId === acc.id ? h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						marginTop: "var(--agy-space-2)",
						flexWrap: "wrap"
					} }, h("input", {
						className: "agy-input",
						style: S.input,
						value: proxyInputs[acc.id] ?? "",
						placeholder: "专属代理 URL (如: http://127.0.0.1:7890，留空则使用全局)",
						"aria-label": `账号 ${displayName} 的专属代理 URL`,
						onChange: (e) => setProxyInputs((prev) => ({
							...prev,
							[acc.id]: e.target.value
						}))
					}), h("button", {
						className: "agy-btn",
						style: S.btnSmPrimary,
						onClick: () => void saveProxy(acc.id),
						disabled: isBusy
					}, "保存"), h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => setEditingProxyId(null)
					}, "取消")) : null, expanded ? (() => {
						const detail = selectPanelPayload(modelPanels[acc.id], acc);
						const entries = detail.payload.familyModels.flatMap((g) => g.models.map((m) => ({
							id: m.id,
							name: m.name,
							family: g.family
						})));
						return h("div", {
							id: modelsPanelDomId(acc.id),
							role: "region",
							"aria-label": `${displayName} 的模型明细`,
							style: {
								display: "flex",
								flexWrap: "wrap",
								alignItems: "center",
								gap: "5px",
								marginTop: "var(--agy-space-2)"
							}
						}, entries.length === 0 ? h("span", { style: {
							...S.muted,
							fontSize: "var(--agy-font-xs)"
						} }, "尚未发现该账号的模型，可点「同步」或稍后自动加载。") : entries.map((m) => h("span", {
							key: `${m.family}:${m.id}`,
							style: S.badgeTag,
							title: m.id
						}, brandIcon(FAMILY_BRAND[m.family] ?? "gemini", 11), " ", m.name)), h("span", { style: {
							...S.muted,
							fontSize: "var(--agy-font-xs)",
							width: "100%"
						} }, detail.usingFallback ? "来源：最近一次额度同步（模型端点未返回数据时的兜底展示）" : "来源：最近一次模型端点成功发现"));
					})() : null);
				});
				const poolAuthPhase = status?.poolAuth?.phase ?? "idle";
				const addFlow = accountAddFlowView(addingAccount, poolAuthPhase);
				const flowActive = addFlow.flowActive;
				const addAccountSection = addingAccount ? h("div", { style: S.authModal }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "var(--agy-space-2)"
				} }, h("div", { style: S.panelTitle }, "添加账号"), h("button", {
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => void handleCancelAddAccount(),
					"aria-label": "关闭添加流程"
				}, uiIcon("x", 12))), addFlow.showBrowserStart ? h("div", { style: {
					display: "flex",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap",
					alignItems: "center"
				} }, h("input", {
					className: "agy-input",
					style: {
						...S.input,
						maxWidth: "280px"
					},
					value: aliasInput,
					placeholder: "可选别名 (留空直接使用 Google 账号名称)",
					"aria-label": "新账号别名",
					onChange: (e) => setAliasInput(e.target.value)
				}), h("button", {
					className: "agy-btn",
					style: S.btnPrimary,
					onClick: () => void handleBeginAddAccount(),
					disabled: isBusy
				}, uiIcon("externalLink", 12), " 打开浏览器登录")) : null, flowActive ? h("div", { style: {
					...S.muted,
					lineHeight: 1.7
				} }, poolAuthPhase === "waiting" ? "等待浏览器中完成 Google 授权，成功后将自动激活。" : "正在验证授权并激活账号，请稍候...", h("div", { style: { marginTop: "var(--agy-space-2)" } }, status?.poolAuth?.url ? h("button", {
					className: "agy-btn",
					style: {
						...S.btnSm,
						color: "var(--agy-accent)",
						border: "1px solid var(--agy-accent-soft-border)",
						background: "var(--agy-accent-soft-bg)"
					},
					onClick: () => win.open?.(status?.poolAuth?.url ?? "", "_blank")
				}, uiIcon("externalLink", 12), " 若浏览器未打开，请点击此处手动打开 Google 登录页") : null)) : null, poolAuthPhase === "failed" ? h("div", { style: {
					...S.noticeBanner,
					background: "var(--agy-danger-bg)",
					border: "1px solid var(--agy-danger-border)",
					color: "var(--agy-danger-text)",
					marginBottom: "var(--agy-space-2)"
				} }, status?.poolAuth?.message || "自动激活失败，可手动粘贴授权码完成激活。") : null, h("div", { style: {
					display: "flex",
					gap: "var(--agy-space-2)",
					marginTop: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, h("input", {
					className: "agy-input",
					style: S.input,
					value: authCodeInput,
					placeholder: "授权码 或 http://localhost:51121/oauth-callback?code=... 完整链接",
					"aria-label": "手动授权码或回调链接",
					onChange: (e) => setAuthCodeInput(e.target.value)
				}), h("button", {
					className: "agy-btn",
					style: S.btnSmPrimary,
					onClick: () => void handleCompleteAddAccount(),
					disabled: isBusy
				}, "手动激活"), h("button", {
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => void handleCancelAddAccount(),
					disabled: isBusy
				}, "取消"))) : h("div", { style: S.authModal }, h("div", { style: {
					display: "flex",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap",
					alignItems: "center"
				} }, h("input", {
					className: "agy-input",
					style: {
						...S.input,
						maxWidth: "280px"
					},
					value: aliasInput,
					placeholder: "可选别名 (留空直接使用 Google 账号名称)",
					"aria-label": "新账号别名",
					onChange: (e) => setAliasInput(e.target.value)
				}), h("button", {
					className: "agy-btn",
					style: S.btnPrimary,
					onClick: () => void handleBeginAddAccount(),
					disabled: isBusy
				}, uiIcon("plus", 12), " 打开浏览器登录")));
				const renderModelPanel = (acc, idx) => {
					const panel = modelPanels[acc.id] ?? EMPTY_PANEL;
					const expanded = !!expandedModels[acc.id];
					const { payload, usingFallback } = selectPanelPayload(panel, acc);
					const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
					const displayName = acc.email ? isAutoAlias ? acc.email : acc.alias : acc.alias || acc.id;
					const ids = payload.familyModels.flatMap((g) => g.models.map((m) => m.id));
					const ownIdSet = new Set(ids);
					const others = computeOtherAccountModelIds(modelPanels, accounts, acc.id);
					const query = (modelQueries[acc.id] ?? "").trim().toLowerCase();
					const famFilter = familyFilters[acc.id];
					const groups = payload.familyModels.filter((g) => !famFilter || famFilter.length === 0 || famFilter.includes(g.family)).map((g) => ({
						...g,
						models: g.models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query))
					})).filter((g) => g.models.length > 0);
					const filteredCount = groups.reduce((n, g) => n + g.models.length, 0);
					const presentFamilies = [
						"google",
						"anthropic",
						"openai",
						"unknown"
					].filter((f) => payload.familyModels.some((g) => g.family === f && g.models.length > 0));
					const coverageBadge = h("span", {
						style: { ...S.badgeTag },
						title: `该账号已发现 ${ownIdSet.size} 个模型 · 全部账号共发现 ${modelUnionTotal} 个`
					}, uiIcon("layers", 11), ` 覆盖 ${ownIdSet.size}/${modelUnionTotal}`);
					const headRow = h("div", { style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						flexWrap: "wrap",
						gap: "var(--agy-space-2)"
					} }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						minWidth: 0
					} }, h("span", { style: {
						fontSize: "var(--agy-font-lg)",
						fontWeight: 750,
						color: "var(--agy-text-primary)"
					} }, displayName), coverageBadge, typeof panel.fetchedAt === "number" ? h("span", {
						className: "agy-num",
						style: {
							fontSize: "var(--agy-font-xs)",
							color: "var(--agy-text-tertiary)"
						}
					}, `同步于 ${formatClock(panel.fetchedAt)}`) : null), h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "5px"
					} }, panel.status === "loading" ? h("span", { style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "6px",
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)"
					} }, h("span", {
						className: "agy-spinner",
						"aria-hidden": true
					}), "正在加载模型清单…") : null, h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => void refreshModelsPanel(acc),
						disabled: panel.status === "loading",
						"aria-label": `刷新 ${displayName} 的模型清单`,
						title: "重新发现该账号可用的模型与额度（POST refresh）"
					}, uiIcon("refresh", 11), " 刷新模型清单"), h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => toggleExpand(acc.id),
						"aria-expanded": expanded,
						"aria-controls": modelsPanelDomId(acc.id)
					}, uiIcon(expanded ? "chevronUp" : "chevronDown", 11), expanded ? " 收起" : " 展开")));
					const statusStrips = [];
					if (panel.status === "error" && panel.error) statusStrips.push(renderStrip("error", `模型端点不可用：${panel.error}（${panel.payload ? "下方为最近一次成功发现的模型数据，失败不会清空" : "下方为最近一次额度同步的兜底模型数据"}）`, () => void loadModelsPanel(acc.id)));
					if (panel.refreshError) statusStrips.push(renderStrip("warn", `刷新失败：${panel.refreshError} · 已保留旧模型数据`));
					const controls = expanded ? h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						alignItems: "center",
						margin: "var(--agy-space-2) 0"
					} }, h("span", { style: {
						...S.input,
						display: "inline-flex",
						alignItems: "center",
						gap: "6px",
						flex: "1 1 220px",
						maxWidth: "320px",
						padding: 0
					} }, uiIcon("search", 12, "var(--agy-text-tertiary)"), h("input", {
						className: "agy-input",
						style: {
							border: "none",
							background: "transparent",
							color: "var(--agy-text-primary)",
							fontSize: "var(--agy-font-sm)",
							padding: "7px 4px",
							width: "100%",
							outline: "none"
						},
						value: modelQueries[acc.id] ?? "",
						placeholder: "搜索模型名 / modelId",
						"aria-label": `在 ${displayName} 的模型清单中搜索`,
						onChange: (e) => setModelQueries((prev) => ({
							...prev,
							[acc.id]: e.target.value
						}))
					})), h("div", {
						style: {
							display: "flex",
							gap: "4px",
							flexWrap: "wrap"
						},
						role: "group",
						"aria-label": "模型厂商筛选"
					}, h("button", {
						className: "agy-chip",
						style: {
							...S.badgeTag,
							cursor: "pointer",
							border: "1px solid var(--agy-badge-tag-border)"
						},
						"aria-pressed": !famFilter || famFilter.length === 0,
						onClick: () => setFamilyFilters((prev) => ({
							...prev,
							[acc.id]: []
						}))
					}, "全部"), presentFamilies.map((f) => h("button", {
						key: f,
						className: "agy-chip",
						style: {
							...S.badgeTag,
							cursor: "pointer",
							border: "1px solid var(--agy-badge-tag-border)"
						},
						"aria-pressed": !!famFilter && famFilter.includes(f),
						onClick: () => setFamilyFilters((prev) => ({
							...prev,
							[acc.id]: famFilter && famFilter.includes(f) ? famFilter.filter((x) => x !== f) : [...famFilter ?? [], f]
						}))
					}, FAMILY_LABEL[f] ?? f)))) : null;
					const body = !expanded ? null : panel.status === "loading" && !panel.payload ? h("div", {
						id: modelsPanelDomId(acc.id),
						role: "region",
						"aria-label": `${displayName} 的模型清单`,
						style: { paddingTop: "var(--agy-space-1)" }
					}, renderSkeletonRow(70, 16), renderSkeletonRow(85), renderSkeletonRow(55), h("span", { className: "agy-sr-only" }, "正在加载模型清单")) : ownIdSet.size === 0 && !query ? h("div", {
						id: modelsPanelDomId(acc.id),
						role: "region",
						"aria-label": `${displayName} 的模型清单`
					}, renderEmptyState("尚未发现该账号的模型清单。", h("button", {
						className: "agy-btn",
						style: S.btnSmPrimary,
						onClick: () => void refreshModelsPanel(acc),
						disabled: panel.status === "loading"
					}, uiIcon("refresh", 11), " 点击刷新发现模型"))) : filteredCount === 0 ? h("div", {
						id: modelsPanelDomId(acc.id),
						role: "region",
						"aria-label": `${displayName} 的模型清单`
					}, renderEmptyState("没有匹配当前搜索 / 筛选的模型。", h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => {
							setModelQueries((prev) => ({
								...prev,
								[acc.id]: ""
							}));
							setFamilyFilters((prev) => ({
								...prev,
								[acc.id]: []
							}));
						}
					}, "清空搜索与筛选"))) : h("div", {
						id: modelsPanelDomId(acc.id),
						role: "region",
						"aria-label": `${displayName} 的模型清单`
					}, usingFallback && ids.length > 0 ? h("div", { style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)",
						marginBottom: "var(--agy-space-2)"
					} }, "来源：最近一次额度同步（模型端点未返回数据时的兜底展示）") : null, h("div", { style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)",
						marginBottom: "var(--agy-space-2)"
					} }, `${filteredCount} / ${ownIdSet.size} 个模型 · 独有 ${ids.filter((id) => !others.has(id)).length} · 共用 ${ids.filter((id) => others.has(id)).length}`), groups.map((g) => h("div", {
						key: g.family,
						style: { marginBottom: "var(--agy-space-3)" }
					}, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "6px",
						marginBottom: "6px"
					} }, brandIcon(FAMILY_BRAND[g.family] ?? "gemini", 12), h("span", { style: S.panelCaption }, FAMILY_LABEL[g.family] ?? g.family)), g.models.map((m, rowIdx) => {
						const pct = typeof m.remainingFraction === "number" ? Math.max(0, Math.min(100, Math.round(m.remainingFraction * 100))) : -1;
						const isExclusive = !others.has(m.id);
						return h("div", {
							key: `${g.family}:${m.id}`,
							className: "agy-model-row",
							style: {
								"--i": Math.min(rowIdx, 12),
								display: "flex",
								alignItems: "center",
								gap: "var(--agy-space-2)",
								padding: "5px 0",
								flexWrap: "wrap"
							}
						}, h("span", {
							title: m.id,
							style: {
								flex: "1 1 240px",
								minWidth: "160px",
								fontSize: "var(--agy-font-sm)",
								color: "var(--agy-text-primary)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							}
						}, m.name), isExclusive ? h("span", {
							style: {
								...S.badgePrimary,
								opacity: .9
							},
							title: "其它账号目前尚未发现此模型"
						}, "本账号独有") : h("span", {
							style: S.badgeTag,
							title: "账号池中至少一个其它账号也支持此模型"
						}, "其它账号也支持"), h("div", {
							style: {
								...S.progressBarBg,
								maxWidth: "180px",
								minWidth: "90px"
							},
							"aria-hidden": true
						}, h("div", {
							className: "agy-progress-fill",
							style: {
								width: `${pct < 0 ? 0 : pct}%`,
								height: "100%",
								borderRadius: "var(--agy-radius-pill)",
								background: quotaGradientFor(pct, false)
							}
						})), h("span", {
							className: "agy-num",
							style: {
								fontSize: "var(--agy-font-xs)",
								fontWeight: 700,
								minWidth: "38px",
								textAlign: "right",
								color: quotaTextFor(pct, false)
							}
						}, pct < 0 ? "—" : `${pct}%`), h(ResetCountdown, {
							resetTime: m.resetTime,
							emptyPrefix: "↻ ",
							emptyText: "未提供",
							className: "agy-num",
							style: {
								fontSize: "var(--agy-font-xs)",
								color: "var(--agy-text-tertiary)",
								minWidth: "132px",
								padding: "2px 6px",
								borderRadius: "var(--agy-radius-sm)"
							}
						}));
					}))));
					return h("div", {
						key: acc.id,
						className: "agy-card-hover agy-rise",
						style: {
							...S.card,
							"--i": Math.min(idx, 8)
						}
					}, headRow, statusStrips.length > 0 ? h("div", null, ...statusStrips) : null, controls, body);
				};
				const renderModelsSection = () => {
					if (accounts.length === 0) return renderEmptyState("还没有账号。添加账号后，这里会展示每个账号支持的模型、剩余额度与跨账号覆盖差异。", h("button", {
						className: "agy-btn",
						style: S.btnPrimary,
						onClick: () => setActiveSection("accounts")
					}, uiIcon("plus", 12), " 前往添加账号"));
					return h("div", null, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "var(--agy-space-2)",
						marginBottom: "var(--agy-space-2)",
						flexWrap: "wrap"
					} }, h("span", { style: S.panelCaption }, "账号 × 模型覆盖"), h("span", {
						className: "agy-num",
						style: {
							fontSize: "var(--agy-font-xs)",
							color: "var(--agy-text-tertiary)"
						}
					}, `已发现模型并集 ${modelUnionTotal} 个 · 灰度差异以并集为基准`)), ...accounts.map((acc, idx) => renderModelPanel(acc, idx)));
				};
				const renderAuditDrawer = () => {
					if (!showAuditDrawer) return null;
					const o = statsOverview;
					const totalRequests = numOf(o, "totalRequests");
					const totalSuccess = numOf(o, "totalSuccess");
					const totalFailed = numOf(o, "totalFailed");
					const cacheHitRate = numOf(o, "cacheHitRate");
					const cacheColor = cacheHitRate === null ? "var(--agy-text-primary)" : cacheHitRate > .3 ? "var(--agy-strong-ok)" : cacheHitRate >= .1 ? "var(--agy-strong-warn)" : "var(--agy-strong-neutral)";
					const summaryCards = o ? h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						padding: "var(--agy-space-3) var(--agy-space-4) 0"
					} }, renderStatCard("请求总数", totalRequests === null ? "—" : formatNumber(totalRequests), `成功 ${totalSuccess === null ? "—" : formatNumber(totalSuccess)} · 失败 ${totalFailed === null ? "—" : formatNumber(totalFailed)}`), renderStatCard("缓存命中率 (Cache Hit %)", cacheHitRate === null ? "—" : `${(cacheHitRate * 100).toFixed(1)}%`, `命中 Token ${numOf(o, "totalCachedTokens") === null ? "—" : formatCompactTokens(numOf(o, "totalCachedTokens") ?? 0)}`, cacheColor), renderStatCard("Token 汇总 (P / C / O)", formatCompactTokens(numOf(o, "totalTokens") ?? 0), `P ${formatCompactTokens(numOf(o, "totalPromptTokens") ?? 0)} / C ${formatCompactTokens(numOf(o, "totalCachedTokens") ?? 0)} / O ${formatCompactTokens(numOf(o, "totalOutputTokens") ?? 0)}`), renderStatCard("平均耗时 / TTFT", numOf(o, "avgLatencyMs") === null ? "—" : `${Math.round(numOf(o, "avgLatencyMs") ?? 0)}ms`, `TTFT ${numOf(o, "avgTtftMs") === null ? "—" : `${Math.round(numOf(o, "avgTtftMs") ?? 0)}ms`} · P90 ${numOf(o, "p90LatencyMs") === null ? "—" : `${Math.round(numOf(o, "p90LatencyMs") ?? 0)}ms`}`)) : h("div", { style: {
						padding: "var(--agy-space-3) var(--agy-space-4) 0",
						display: "flex",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap"
					} }, [
						0,
						1,
						2,
						3
					].map((i) => h("div", {
						key: i,
						style: { flex: "1 1 150px" }
					}, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22))));
					const requestsView = auditLoading && auditRequests.length === 0 ? h("div", { style: { padding: "0 var(--agy-space-4)" } }, renderSkeletonRow(95, 20), renderSkeletonRow(95, 20), renderSkeletonRow(95, 20)) : auditError ? renderStrip("error", auditError, () => void fetchAuditRequests(20, auditPage * 20)) : auditRequests.length === 0 ? h("div", { style: { padding: "var(--agy-space-4)" } }, renderEmptyState("暂无请求审计记录。")) : h("table", { className: "agy-table" }, h("thead", null, h("tr", null, h("th", null, "时间"), h("th", null, "模型"), h("th", null, "账号"), h("th", null, "Token (P / C / O)"), h("th", null, "耗时 / TTFT"), h("th", null, "状态"))), h("tbody", null, auditRequests.map((r, i) => {
						const account = accounts.find((a) => a.id === r.accountId);
						const statusOk = typeof r.status === "string" && !/fail|error|4\d\d|5\d\d/i.test(r.status);
						return h("tr", { key: r.requestId ?? i }, h("td", { className: "agy-num" }, r.timestamp ?? "—"), h("td", null, r.model ?? "—"), h("td", null, account ? maskEmail(account.email) || account.alias : r.accountId ?? "未知"), h("td", { className: "agy-num" }, `${formatCompactTokens(r.promptTokens ?? 0)} / ${formatCompactTokens(r.cachedTokens ?? 0)} / ${formatCompactTokens(r.outputTokens ?? 0)}`), h("td", { className: "agy-num" }, `${r.latencyMs === void 0 ? "—" : `${Math.round(r.latencyMs)}ms`} · ${r.ttftMs === void 0 ? "—" : `${Math.round(r.ttftMs)}ms`}`), h("td", { style: { color: statusOk ? "var(--agy-strong-ok)" : "var(--agy-strong-danger)" } }, r.status ?? "—"));
					})));
					const sessionsView = auditSessionsLoading && auditSessions.length === 0 ? h("div", { style: { padding: "0 var(--agy-space-4)" } }, renderSkeletonRow(95, 20), renderSkeletonRow(95, 20), renderSkeletonRow(95, 20)) : auditError ? renderStrip("error", auditError, () => void fetchAuditSessions(20, auditSessionsPage * 20)) : auditSessions.length === 0 ? h("div", { style: { padding: "var(--agy-space-4)" } }, renderEmptyState("暂无会话审计记录。")) : h("table", { className: "agy-table" }, h("thead", null, h("tr", null, h("th", null, "更新时间"), h("th", null, "会话 ID"), h("th", null, "账号"), h("th", null, "请求数 (总数 / 成功 / 失败)"), h("th", null, "Token (Prompt / 命中缓存 / 命中率)"), h("th", null, "状态/详情"))), h("tbody", null, auditSessions.map((s, i) => {
						const account = accounts.find((a) => a.id === s.accountId);
						const shortId = s.sessionId ? `${s.sessionId.slice(0, 8)}…${s.sessionId.slice(-4)}` : "—";
						return h("tr", { key: s.sessionId ?? i }, h("td", { className: "agy-num" }, s.updatedAt ?? "—"), h("td", { title: s.sessionId }, shortId), h("td", null, account ? maskEmail(account.email) || account.alias : s.accountId ?? "未知"), h("td", { className: "agy-num" }, `${formatNumber(s.totalRequests ?? 0)} / ${formatNumber(s.totalSuccess ?? 0)} / ${formatNumber(s.totalFailed ?? 0)}`), h("td", { className: "agy-num" }, `${formatCompactTokens(s.totalPromptTokens ?? 0)} / ${formatCompactTokens(s.totalCachedTokens ?? 0)} / ${typeof s.cacheHitRate === "number" ? `${(s.cacheHitRate * 100).toFixed(1)}%` : "—"}`), h("td", {
							title: s.lastError ?? void 0,
							style: { color: (s.totalFailed ?? 0) > 0 ? "var(--agy-strong-warn)" : "var(--agy-strong-ok)" }
						}, s.status ?? s.lastError ?? "—"));
					})));
					const totalForTab = auditTab === "requests" ? auditTotal : auditSessionsTotal;
					const pageForTab = auditTab === "requests" ? auditPage : auditSessionsPage;
					const setPageForTab = (next) => {
						if (auditTab === "requests") setAuditPage(next);
						else setAuditSessionsPage(next);
					};
					const canPrev = pageForTab > 0;
					const canNext = (pageForTab + 1) * 20 < totalForTab;
					return portalToBody(h("div", {
						className: "agy-drawer-backdrop",
						onClick: (e) => {
							if (e.target === e.currentTarget) setShowAuditDrawer(false);
						}
					}, h("div", {
						className: "agy-drawer",
						role: "dialog",
						"aria-modal": true,
						"aria-label": "请求审计与会话统计"
					}, h("div", { style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "var(--agy-space-2)",
						padding: "var(--agy-space-3) var(--agy-space-4)",
						borderBottom: "1px solid var(--agy-drawer-border)"
					} }, h("div", { style: S.panelTitle }, "请求审计与会话统计 (Audit Log)"), h("div", { style: {
						display: "flex",
						gap: "5px"
					} }, h("button", {
						className: "agy-btn",
						style: {
							...S.btnSm,
							background: "var(--agy-drawer-btn-bg)",
							color: "var(--agy-drawer-btn-text)",
							border: "1px solid var(--agy-drawer-btn-border)"
						},
						onClick: () => {
							if (auditTab === "requests") fetchAuditRequests(20, auditPage * 20);
							else fetchAuditSessions(20, auditSessionsPage * 20);
						},
						"aria-label": "刷新审计数据"
					}, uiIcon("refresh", 12), " 刷新"), h("button", {
						className: "agy-btn",
						style: {
							...S.btnSm,
							background: "var(--agy-drawer-btn-bg)",
							color: "var(--agy-drawer-btn-text)",
							border: "1px solid var(--agy-drawer-btn-border)"
						},
						onClick: () => setShowAuditDrawer(false),
						"aria-label": "关闭审计抽屉"
					}, uiIcon("x", 12)))), summaryCards, h("div", { style: {
						padding: "var(--agy-space-3) var(--agy-space-4) 0",
						display: "flex",
						gap: "var(--agy-space-2)",
						alignItems: "center",
						flexWrap: "wrap"
					} }, h("div", {
						style: S.segGroup,
						role: "tablist",
						"aria-label": "审计视图切换"
					}, h("button", {
						role: "tab",
						"aria-selected": auditTab === "requests",
						style: auditTab === "requests" ? S.segBtnActive : S.segBtn,
						onClick: () => setAuditTab("requests")
					}, "按请求明细 (Requests)"), h("button", {
						role: "tab",
						"aria-selected": auditTab === "sessions",
						style: auditTab === "sessions" ? S.segBtnActive : S.segBtn,
						onClick: () => setAuditTab("sessions")
					}, "按会话统计 (Sessions)")), auditLoading || auditSessionsLoading ? h("span", { style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "6px",
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-table-faint)"
					} }, h("span", {
						className: "agy-spinner",
						"aria-hidden": true
					}), "加载中…") : null), h("div", { style: {
						flex: 1,
						overflow: "auto",
						padding: "var(--agy-space-2) 0"
					} }, auditTab === "requests" ? requestsView : sessionsView), h("div", { style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "flex-end",
						gap: "var(--agy-space-2)",
						padding: "var(--agy-space-3) var(--agy-space-4)",
						borderTop: "1px solid var(--agy-drawer-border)"
					} }, h("span", {
						className: "agy-num",
						style: {
							fontSize: "var(--agy-font-xs)",
							color: "var(--agy-table-faint)",
							marginRight: "auto"
						}
					}, `共 ${formatNumber(totalForTab)} 条 · 每页 20 条`), h("button", {
						className: "agy-btn",
						style: {
							...S.btnSm,
							background: "var(--agy-drawer-btn-bg)",
							color: "var(--agy-drawer-btn-text)",
							border: "1px solid var(--agy-drawer-btn-border)"
						},
						disabled: !canPrev,
						onClick: () => setPageForTab(pageForTab - 1)
					}, "上一页"), h("span", {
						className: "agy-num",
						style: {
							fontSize: "var(--agy-font-xs)",
							color: "var(--agy-table-soft)"
						}
					}, `第 ${pageForTab + 1} 页`), h("button", {
						className: "agy-btn",
						style: {
							...S.btnSm,
							background: "var(--agy-drawer-btn-bg)",
							color: "var(--agy-drawer-btn-text)",
							border: "1px solid var(--agy-drawer-btn-border)"
						},
						disabled: !canNext,
						onClick: () => setPageForTab(pageForTab + 1)
					}, "下一页")))));
				};
				const renderOverviewSection = () => {
					if (accounts.length === 0 && !status) return renderEmptyState("插件状态还在加载中。", void 0);
					if (accounts.length === 0) return renderEmptyState("账号池为空：还没有可调度的账号。添加账号后，这里会显示额度快照与运行状态。", h("button", {
						className: "agy-btn",
						style: S.btnPrimary,
						onClick: () => setActiveSection("accounts")
					}, uiIcon("plus", 12), " 添加账号"));
					const readyAccounts = accounts.filter((a) => a.enabled && !a.authRequired).length;
					const lastRun = status?.lastRun;
					const dormant = status?.dormantReason;
					return h("div", null, dormant ? renderStrip("warn", `插件处于休眠状态：${dormant}`) : null, !pollOk ? renderStrip("warn", `轮询中断：页面展示的是 ${formatClock(lastUpdatedAt)} 拉取的最后一次数据`) : null, h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						marginBottom: "var(--agy-space-3)"
					} }, renderStatCard("可调度账号", `${readyAccounts} / ${accounts.length}`, `主用：${status?.pool?.primaryAccountId ?? "自动"}`), renderStatCard("授权状态", isAuthed ? "正常" : "待认证", `auth: ${status?.auth?.phase ?? "—"} · poolAuth: ${poolAuthPhase}`), renderStatCard("默认模型", status?.defaultModel ?? "—", `Effort：${status?.defaultEffort ?? "—"}`), renderStatCard("上游目录模型数", formatNumber(status?.catalog?.count ?? 0), `来源：${status?.catalog?.source ?? "—"}`), renderStatCard("最近一次请求", lastRun?.ok === false ? `失败 ${lastRun?.code ?? ""}` : "成功", lastRun?.model ? `${lastRun.model} · ${lastRun.durationMs ?? "—"}ms` : "—")), h("div", { style: S.panelCaption }, "额度快照"), ...accounts.map((acc, idx) => h("div", {
						key: acc.id,
						className: "agy-card-hover agy-rise",
						style: {
							...S.card,
							marginBottom: "var(--agy-space-2)",
							"--i": Math.min(idx, 8)
						}
					}, h("div", { style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap"
					} }, h("span", { style: {
						fontWeight: 700,
						color: "var(--agy-text-primary)"
					} }, acc.email ? acc.alias && !/^备用.*账号/i.test(acc.alias) && !/^主账号/i.test(acc.alias) ? acc.alias : maskEmail(acc.email) : acc.alias || acc.id), h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => {
							setActiveSection("models");
							ensureModelsLoaded(acc.id);
						}
					}, uiIcon("layers", 11), " 查看模型")), h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-4)",
						flexWrap: "wrap",
						marginTop: "var(--agy-space-1)"
					} }, renderQuotaBar("Gemini", "google", acc), renderQuotaBar("Claude", "anthropic", acc), renderQuotaBar("GPT-OSS", "openai", acc)))));
				};
				const renderUsageSection = () => {
					return h("div", null, statsError ? renderStrip("error", statsError, () => void fetchStatsOverview()) : null, h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						marginBottom: "var(--agy-space-3)"
					} }, statsOverview ? renderStatCard("请求总数", formatNumber(numOf(statsOverview, "totalRequests") ?? 0), `成功 ${formatNumber(numOf(statsOverview, "totalSuccess") ?? 0)} · 失败 ${formatNumber(numOf(statsOverview, "totalFailed") ?? 0)}`) : h("div", { style: {
						...S.statBox,
						flex: "1 1 150px"
					} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)), statsOverview ? renderStatCard("Token 汇总", formatCompactTokens(numOf(statsOverview, "totalTokens") ?? 0), `Prompt ${formatCompactTokens(numOf(statsOverview, "totalPromptTokens") ?? 0)} · 输出 ${formatCompactTokens(numOf(statsOverview, "totalOutputTokens") ?? 0)}`) : h("div", { style: {
						...S.statBox,
						flex: "1 1 150px"
					} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)), statsOverview ? renderStatCard("缓存命中率", `${((numOf(statsOverview, "cacheHitRate") ?? 0) * 100).toFixed(1)}%`, `命中 Token ${formatCompactTokens(numOf(statsOverview, "totalCachedTokens") ?? 0)}`, (numOf(statsOverview, "cacheHitRate") ?? 0) > .3 ? "var(--agy-strong-ok)" : (numOf(statsOverview, "cacheHitRate") ?? 0) >= .1 ? "var(--agy-strong-warn)" : "var(--agy-strong-neutral)") : h("div", { style: {
						...S.statBox,
						flex: "1 1 150px"
					} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)), statsOverview ? renderStatCard("平均耗时 / TTFT", `${Math.round(numOf(statsOverview, "avgLatencyMs") ?? 0)}ms`, `TTFT ${Math.round(numOf(statsOverview, "avgTtftMs") ?? 0)}ms · P90 ${Math.round(numOf(statsOverview, "p90LatencyMs") ?? 0)}ms`) : h("div", { style: {
						...S.statBox,
						flex: "1 1 150px"
					} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22))), h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap"
					} }, h("button", {
						className: "agy-btn",
						style: S.btnPrimary,
						onClick: () => setShowAuditDrawer(true)
					}, uiIcon("activity", 12), " 打开请求明细与会话统计"), h("button", {
						className: "agy-btn",
						style: S.btnSm,
						onClick: () => void fetchStatsOverview(),
						"aria-label": "重新加载用量统计"
					}, uiIcon("refresh", 12), " 重新加载")));
				};
				const renderDiagRow = (label, value, mono = true) => h("div", { style: {
					display: "flex",
					gap: "var(--agy-space-3)",
					padding: "8px 0",
					borderBottom: "1px solid var(--agy-border-divider)",
					flexWrap: "wrap"
				} }, h("span", { style: {
					width: "170px",
					color: "var(--agy-text-tertiary)",
					fontSize: "var(--agy-font-sm)",
					flexShrink: 0
				} }, label), h("span", {
					className: mono ? "agy-num" : void 0,
					style: {
						color: "var(--agy-text-primary)",
						fontSize: "var(--agy-font-sm)",
						wordBreak: "break-all",
						flex: 1
					}
				}, value));
				const renderDiagnosticsSection = () => {
					const catalog = status?.catalog ?? {};
					const lastRun = status?.lastRun ?? {};
					const endpointErrors = Array.isArray(catalog.endpointErrors) ? catalog.endpointErrors.length : 0;
					return h("div", null, !pollOk ? renderStrip("warn", `轮询中断：以下为 ${formatClock(lastUpdatedAt)} 的最后一次成功拉取`) : null, h("div", {
						className: "agy-rise",
						style: S.card
					}, renderDiagRow("插件状态", status ? status.enabled === false ? "已停用" : "运行中" : "未加载", false), renderDiagRow("休眠原因", status?.dormantReason ?? "无", false), renderDiagRow("版本 / 构建校验", status?.distSha256 ? `${String(status.distSha256).slice(0, 16)}…` : status?.version ?? "未上报"), renderDiagRow("上游目录", `${catalog.source ?? "—"} · ${formatNumber(catalog.count ?? 0)} 个模型${endpointErrors > 0 ? ` · ${endpointErrors} 条端点错误` : ""}`, false), renderDiagRow("目录最近错误", catalog.lastError ?? "无", false), renderDiagRow("最近一次运行", lastRun.ok === void 0 ? "无记录" : `${lastRun.ok ? "成功" : `失败 (code ${lastRun.code ?? "—"})`} · ${lastRun.durationMs ?? "—"}ms · ${lastRun.model ?? "—"}`, false), renderDiagRow("授权阶段", `auth: ${status?.auth?.phase ?? "—"} · poolAuth: ${poolAuthPhase}`, false), renderDiagRow("工作区", status?.workspaceRoot ?? "未上报"), renderDiagRow("数据通道", `${base || "同源"}${API_PREFIX} · 3s 状态轮询 / 10s 统计轮询`)), h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)"
					} }, h("button", {
						className: "agy-btn",
						style: S.btnSmPrimary,
						onClick: () => void refresh(),
						disabled: isBusy
					}, uiIcon("refresh", 12), " 立即刷新状态")));
				};
				const renderConfigRow = (key, label, hint) => {
					const draft = cfgDrafts[key] ?? "";
					return h("div", {
						key,
						style: {
							display: "flex",
							gap: "var(--agy-space-2)",
							alignItems: "center",
							padding: "10px 0",
							borderBottom: "1px solid var(--agy-border-divider)",
							flexWrap: "wrap"
						}
					}, h("div", { style: {
						width: "210px",
						flexShrink: 0
					} }, h("div", { style: {
						fontSize: "var(--agy-font-sm)",
						fontWeight: 700,
						color: "var(--agy-text-primary)"
					} }, label), h("div", { style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)",
						marginTop: "2px"
					} }, hint)), h("input", {
						className: "agy-input",
						style: {
							...S.input,
							maxWidth: "380px"
						},
						value: draft,
						placeholder: key === "baseUrl" ? "留空则不修改（后端不回显该值）" : hint,
						"aria-label": label,
						onChange: (e) => setCfgDrafts((prev) => ({
							...prev,
							[key]: e.target.value
						}))
					}), h("button", {
						className: "agy-btn",
						style: S.btnSmPrimary,
						disabled: isBusy || key !== "baseUrl" && draft.trim() === "",
						onClick: () => void setCfg(key, draft.trim())
					}, "保存"));
				};
				const renderConfigSection = () => {
					return h("div", null, h("div", {
						className: "agy-rise",
						style: S.card
					}, h("div", {
						style: S.panelCaption,
						marginBottom: "var(--agy-space-1)"
					}, "可写配置（POST /config）"), renderConfigRow("defaultModel", "默认模型 (defaultModel)", status?.defaultModel ?? "当前值将在状态轮询后回填"), renderConfigRow("defaultEffort", "默认 Effort (defaultEffort)", status?.defaultEffort ?? "例如 low / medium / high"), renderConfigRow("baseUrl", "上游地址 (baseUrl)", "高级：仅在你明确需要切换上游时填写"), h("div", { style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						alignItems: "center",
						padding: "10px 0",
						flexWrap: "wrap"
					} }, h("div", { style: {
						width: "210px",
						flexShrink: 0
					} }, h("div", { style: {
						fontSize: "var(--agy-font-sm)",
						fontWeight: 700,
						color: "var(--agy-text-primary)"
					} }, "Ask 工具注册 (askTool)"), h("div", { style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)",
						marginTop: "2px"
					} }, "在 DSH 中注册 agy ask 工具开关")), h("button", {
						className: "agy-btn",
						role: "switch",
						"aria-checked": status?.askTool === true,
						"aria-label": "切换 Ask 工具注册",
						style: {
							...S.btnSm,
							background: status?.askTool === true ? "var(--agy-accent)" : "var(--agy-bg-btn)",
							color: status?.askTool === true ? "var(--agy-on-accent)" : "var(--agy-text-btn)",
							border: `1px solid ${status?.askTool === true ? "var(--agy-border-btn-primary)" : "var(--agy-border-btn)"}`
						},
						disabled: isBusy,
						onClick: () => void setCfg("askTool", !(status?.askTool === true))
					}, status?.askTool === true ? "已注册" : "未注册"))));
				};
				const SECTIONS = [
					{
						key: "overview",
						label: "总览"
					},
					{
						key: "accounts",
						label: "账号"
					},
					{
						key: "models",
						label: "模型"
					},
					{
						key: "usage",
						label: "用量统计"
					},
					{
						key: "diagnostics",
						label: "诊断"
					},
					{
						key: "config",
						label: "配置"
					}
				];
				const onNavKeyDown = (ev) => {
					const idx = SECTIONS.findIndex((s) => s.key === activeSection);
					let next = -1;
					if (ev.key === "ArrowRight") next = (idx + 1) % SECTIONS.length;
					else if (ev.key === "ArrowLeft") next = (idx - 1 + SECTIONS.length) % SECTIONS.length;
					else if (ev.key === "Home") next = 0;
					else if (ev.key === "End") next = SECTIONS.length - 1;
					if (next < 0) return;
					ev.preventDefault?.();
					const key = SECTIONS[next].key;
					setActiveSection(key);
					tabRefs.current[key]?.focus?.();
				};
				const navBar = h("nav", {
					style: S.navBar,
					role: "tablist",
					"aria-label": "Antigravity 设置分区",
					onKeyDown: onNavKeyDown
				}, ...SECTIONS.map((s) => h("button", {
					key: s.key,
					ref: (node) => {
						tabRefs.current[s.key] = node;
					},
					className: "agy-tab",
					role: "tab",
					id: `agy-tab-${s.key}`,
					"aria-selected": activeSection === s.key,
					"aria-controls": `agy-panel-${s.key}`,
					tabIndex: activeSection === s.key ? 0 : -1,
					style: S.tab,
					onClick: () => setActiveSection(s.key)
				}, s.label)));
				const sectionBody = () => {
					switch (activeSection) {
						case "overview": return renderOverviewSection();
						case "accounts": return h("div", null, addAccountSection, ...renderedAccountCards);
						case "models": return renderModelsSection();
						case "usage": return renderUsageSection();
						case "diagnostics": return renderDiagnosticsSection();
						case "config": return renderConfigSection();
					}
				};
				if (status === null) return h("div", {
					className: "agy-root",
					style: S.container
				}, h("style", null, THEME_CSS), h("div", { style: S.headerCard }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)"
				} }, agyIcon(18), h("span", { style: S.panelTitle }, "Antigravity")), h("span", { style: {
					display: "inline-flex",
					alignItems: "center",
					gap: "6px",
					...S.muted
				} }, h("span", {
					className: "agy-spinner",
					"aria-hidden": true
				}), "正在加载状态")), renderToastBanner(), navBar, renderSkeletonCard(), renderSkeletonCard());
				const headerCard = h("div", { style: S.headerCard }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap",
					minWidth: 0
				} }, agyIcon(18), h("span", { style: S.panelTitle }, "Antigravity"), h("span", { style: isAuthed ? S.badgeReady : S.badgeUnready }, isAuthed ? "就绪" : "待认证"), h("span", {
					className: "agy-num",
					title: pollOk ? "状态轮询正常（3 秒间隔）" : "轮询中断，展示的是最后一次成功拉取的数据",
					style: {
						fontSize: "var(--agy-font-xs)",
						padding: "2px 8px",
						borderRadius: "var(--agy-radius-pill)",
						background: pollOk ? "var(--agy-neutral-bg)" : "var(--agy-warn-bg)",
						border: `1px solid ${pollOk ? "var(--agy-neutral-border)" : "var(--agy-warn-border)"}`,
						color: pollOk ? "var(--agy-neutral-text)" : "var(--agy-warn-text)"
					}
				}, pollOk ? `更新于 ${formatClock(lastUpdatedAt)}` : `轮询中断 · 上次成功 ${formatClock(lastUpdatedAt)}`)), h("div", { style: {
					display: "flex",
					gap: "5px",
					flexWrap: "wrap"
				} }, h("button", {
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => setShowAuditDrawer(true)
				}, uiIcon("activity", 12), " 审计明细"), h("button", {
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => void refreshQuota(),
					disabled: isBusy
				}, uiIcon("zap", 12), " 刷新额度"), h("button", {
					className: "agy-btn",
					style: S.btnSmPrimary,
					onClick: () => {
						setActiveSection("accounts");
						setAddingAccount(true);
					},
					disabled: isBusy
				}, uiIcon("plus", 12), " 添加账号"), h("button", {
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => void refresh(),
					disabled: isBusy,
					"aria-label": "刷新插件状态"
				}, uiIcon("refresh", 12))));
				return h("div", {
					className: "agy-root",
					style: S.container
				}, h("style", null, THEME_CSS), headerCard, renderToastBanner(), navBar, h("div", {
					key: activeSection,
					id: `agy-panel-${activeSection}`,
					role: "tabpanel",
					"aria-labelledby": `agy-tab-${activeSection}`,
					tabIndex: 0
				}, sectionBody()), renderAuditDrawer());
			};
			ctx.slots.inject("settings.section", () => {
				return ctx.slots.register({
					name: "settings.section",
					id: "agy-link",
					order: 20,
					label: "Antigravity"
				}, AgySettingsSection);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
