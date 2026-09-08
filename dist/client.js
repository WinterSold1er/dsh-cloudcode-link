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
			alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"
		};
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
		let statusCache = null;
		async function getStatus() {
			try {
				const res = await win.fetch?.(base + "/plugins/agy-link/status");
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
				const res = await win.fetch?.(base + path, {
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
		/** Global modal state for opening Antigravity console dialog from footer shortcut or header status */
		const agyModalStore = {
			open: false,
			listeners: /* @__PURE__ */ new Set(),
			setOpen(v) {
				agyModalStore.open = v;
				agyModalStore.listeners.forEach((fn) => fn());
			},
			subscribe(fn) {
				agyModalStore.listeners.add(fn);
				return () => {
					agyModalStore.listeners.delete(fn);
				};
			}
		};
		/**
		* Format reset timestamp into readable date/time + relative countdown.
		*/
		function formatQuotaWindow(resetTimeStr) {
			if (!resetTimeStr) return { resetText: "" };
			try {
				const d = new Date(resetTimeStr);
				const diffMs = d.getTime() - Date.now();
				if (diffMs <= 0) return { resetText: "" };
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
		let agyIconSeq = 0;
		/** Antigravity mark: gradient orb with an orbit ring (product has no public simple-icon). */
		function agyIcon(size = 14) {
			const gid = `agy-g${++agyIconSeq}`;
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
				"stop-color": "#4C8DFF"
			}), h("stop", {
				offset: "1",
				"stop-color": "#A96BFF"
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
		const GLOBAL_CSS = `
@keyframes agy-spin {
	0% { transform: rotate(0deg); }
	100% { transform: rotate(360deg); }
}

:root, body {
	--agy-font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif);
	--agy-bg-panel: var(--dsw-alias-bg-layer-2, #ffffff);
	--agy-bg-card: var(--dsw-alias-bg-layer-2, #ffffff);
	--agy-bg-card-primary: #f0f7ff;
	--agy-bg-header: var(--dsw-alias-bg-layer-1, #f8fafc);
	--agy-bg-box: var(--dsw-alias-bg-layer-1, #f8fafc);
	--agy-bg-subbox: var(--dsw-alias-bg-layer-3, #f1f5f9);
	--agy-bg-input: var(--dsw-alias-bg-layer-1, #ffffff);
	--agy-bg-btn: var(--dsw-alias-bg-layer-3, #f1f5f9);
	--agy-bg-btn-hover: var(--dsw-alias-interactive-bg-hover, #e2e8f0);
	--agy-bg-btn-primary: var(--dsw-alias-state-business-primary, #2563eb);
	--agy-bg-progress-track: #e2e8f0;

	--agy-border-card: var(--dsw-alias-border-l2, #e2e8f0);
	--agy-border-card-primary: #3b82f6;
	--agy-border-box: var(--dsw-alias-border-l1, #e2e8f0);
	--agy-border-subbox: var(--dsw-alias-border-l2, #cbd5e1);
	--agy-border-input: var(--dsw-alias-border-l2, #cbd5e1);
	--agy-border-input-focus: var(--dsw-alias-state-business-primary, #2563eb);
	--agy-border-btn: var(--dsw-alias-border-l2, #cbd5e1);
	--agy-border-btn-primary: #2563eb;
	--agy-border-divider: var(--dsw-alias-border-l2, #e2e8f0);

	--agy-text-primary: var(--dsw-alias-label-primary, #0f172a);
	--agy-text-secondary: var(--dsw-alias-label-secondary, #334155);
	--agy-text-tertiary: var(--dsw-alias-label-tertiary, #64748b);
	--agy-text-muted: var(--dsw-alias-label-caption, #94a3b8);
	--agy-text-btn: var(--dsw-alias-label-primary, #0f172a);
	--agy-text-btn-primary: #ffffff;
	--agy-text-window-label: #2563eb;

	--agy-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.05);
	--agy-shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.08);
	--agy-shadow-card-primary: 0 0 0 1px #3b82f6, 0 4px 14px rgba(37, 99, 235, 0.12);
	--agy-shadow-modal: 0 20px 50px rgba(0, 0, 0, 0.18);
	--agy-modal-backdrop: rgba(15, 23, 42, 0.5);

	/* Badges */
	--agy-badge-primary-bg: #dbeafe;
	--agy-badge-primary-text: #1e40af;
	--agy-badge-primary-border: #60a5fa;

	--agy-badge-tag-bg: #f1f5f9;
	--agy-badge-tag-text: #334155;
	--agy-badge-tag-border: #cbd5e1;

	--agy-badge-email-bg: #eff6ff;
	--agy-badge-email-text: #1d4ed8;
	--agy-badge-email-border: #bfdbfe;

	--agy-badge-proxy-bg: #ecfdf5;
	--agy-badge-proxy-text: #047857;
	--agy-badge-proxy-border: #a7f3d0;

	--agy-badge-ready-bg: #ecfdf5;
	--agy-badge-ready-text: #047857;
	--agy-badge-ready-border: #a7f3d0;

	--agy-badge-unready-bg: #eff6ff;
	--agy-badge-unready-text: #1d4ed8;
	--agy-badge-unready-border: #bfdbfe;

	/* Quota status pills */
	--agy-quota-high-bg: #ecfdf5;
	--agy-quota-high-text: #047857;
	--agy-quota-high-border: #a7f3d0;
	--agy-quota-med-bg: #fffbeb;
	--agy-quota-med-text: #b45309;
	--agy-quota-med-border: #fde68a;
	--agy-quota-low-bg: #fef2f2;
	--agy-quota-low-text: #b91c1c;
	--agy-quota-low-border: #fecaca;
	--agy-quota-none-bg: #f1f5f9;
	--agy-quota-none-text: #64748b;
	--agy-quota-none-border: #cbd5e1;

	/* Danger button */
	--agy-danger-bg: #fef2f2;
	--agy-danger-text: #b91c1c;
	--agy-danger-border: #fecaca;
	--agy-danger-hover-bg: #fee2e2;

	/* Warning banner */
	--agy-warn-bg: #fffbeb;
	--agy-warn-text: #92400e;
	--agy-warn-border: #fcd34d;
	--agy-warn-btn-bg: #fef3c7;
	--agy-warn-btn-text: #92400e;
	--agy-warn-btn-border: #f59e0b;

	/* Toast notices */
	--agy-toast-success-bg: #ecfdf5;
	--agy-toast-success-text: #065f46;
	--agy-toast-success-border: #6ee7b7;
	--agy-toast-info-bg: #eff6ff;
	--agy-toast-info-text: #1e40af;
	--agy-toast-info-border: #93c5fd;
	--agy-toast-warn-bg: #fffbeb;
	--agy-toast-warn-text: #92400e;
	--agy-toast-warn-border: #fcd34d;
	--agy-toast-error-bg: #fef2f2;
	--agy-toast-error-text: #991b1b;
	--agy-toast-error-border: #fca5a5;

	/* Auth Modal / Box */
	--agy-auth-box-bg: #f0f7ff;
	--agy-auth-box-border: #3b82f6;

	/* Segment control */
	--agy-seg-group-bg: #e2e8f0;
	--agy-seg-group-border: #cbd5e1;
	--agy-seg-btn-text: #475569;
	--agy-seg-btn-active-bg: var(--dsw-alias-state-business-primary, #2563eb);
	--agy-seg-btn-active-text: #ffffff;
	--agy-seg-danger-bg: #dc2626;
	--agy-seg-danger-text: #ffffff;
	--agy-seg-danger-border: #b91c1c;
}

body[data-ds-dark-theme],
body.dark,
[data-theme="dark"] {
	--agy-bg-panel: var(--dsw-alias-bg-layer-2, #0f172a);
	--agy-bg-card: var(--dsw-alias-bg-layer-2, #1e293b);
	--agy-bg-card-primary: #111d33;
	--agy-bg-header: var(--dsw-alias-bg-layer-1, #1e293b);
	--agy-bg-box: var(--dsw-alias-bg-layer-1, #0f172a);
	--agy-bg-subbox: var(--dsw-alias-bg-layer-3, #090d16);
	--agy-bg-input: var(--dsw-alias-bg-layer-3, #090d16);
	--agy-bg-btn: var(--dsw-alias-bg-layer-3, #334155);
	--agy-bg-btn-hover: var(--dsw-alias-interactive-bg-hover, #475569);
	--agy-bg-btn-primary: var(--dsw-alias-state-business-primary, #2563eb);
	--agy-bg-progress-track: #1e293b;

	--agy-border-card: var(--dsw-alias-border-l2, #334155);
	--agy-border-card-primary: #3b82f6;
	--agy-border-box: var(--dsw-alias-border-l1, #1e293b);
	--agy-border-subbox: var(--dsw-alias-border-l2, #334155);
	--agy-border-input: var(--dsw-alias-border-l2, #334155);
	--agy-border-input-focus: #3b82f6;
	--agy-border-btn: var(--dsw-alias-border-l2, #475569);
	--agy-border-btn-primary: #3b82f6;
	--agy-border-divider: var(--dsw-alias-border-l2, #334155);

	--agy-text-primary: var(--dsw-alias-label-primary, #f8fafc);
	--agy-text-secondary: var(--dsw-alias-label-secondary, #cbd5e1);
	--agy-text-tertiary: var(--dsw-alias-label-tertiary, #94a3b8);
	--agy-text-muted: var(--dsw-alias-label-caption, #64748b);
	--agy-text-btn: var(--dsw-alias-label-primary, #ffffff);
	--agy-text-btn-primary: #ffffff;
	--agy-text-window-label: #93c5fd;

	--agy-shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
	--agy-shadow-card-hover: 0 6px 16px rgba(0, 0, 0, 0.4);
	--agy-shadow-card-primary: 0 0 16px rgba(59, 130, 246, 0.25);
	--agy-shadow-modal: 0 25px 60px rgba(0, 0, 0, 0.8);
	--agy-modal-backdrop: rgba(0, 0, 0, 0.75);

	/* Badges */
	--agy-badge-primary-bg: #1e3a8a;
	--agy-badge-primary-text: #93c5fd;
	--agy-badge-primary-border: #3b82f6;

	--agy-badge-tag-bg: #0f172a;
	--agy-badge-tag-text: #cbd5e1;
	--agy-badge-tag-border: #334155;

	--agy-badge-email-bg: #1e293b;
	--agy-badge-email-text: #93c5fd;
	--agy-badge-email-border: #3b82f6;

	--agy-badge-proxy-bg: #064e3b;
	--agy-badge-proxy-text: #6ee7b7;
	--agy-badge-proxy-border: #059669;

	--agy-badge-ready-bg: rgba(16, 185, 129, 0.15);
	--agy-badge-ready-text: #34d399;
	--agy-badge-ready-border: rgba(16, 185, 129, 0.35);

	--agy-badge-unready-bg: rgba(59, 130, 246, 0.15);
	--agy-badge-unready-text: #93c5fd;
	--agy-badge-unready-border: rgba(59, 130, 246, 0.35);

	/* Quota status pills */
	--agy-quota-high-bg: #064e3b;
	--agy-quota-high-text: #6ee7b7;
	--agy-quota-high-border: #059669;
	--agy-quota-med-bg: #451a03;
	--agy-quota-med-text: #fde68a;
	--agy-quota-med-border: #d97706;
	--agy-quota-low-bg: #450a0a;
	--agy-quota-low-text: #fca5a5;
	--agy-quota-low-border: #dc2626;
	--agy-quota-none-bg: #1e293b;
	--agy-quota-none-text: #94a3b8;
	--agy-quota-none-border: #475569;

	/* Danger button */
	--agy-danger-bg: #450a0a;
	--agy-danger-text: #fca5a5;
	--agy-danger-border: #ef4444;
	--agy-danger-hover-bg: #5f1313;

	/* Warning banner */
	--agy-warn-bg: #451a03;
	--agy-warn-text: #fde68a;
	--agy-warn-border: #d97706;
	--agy-warn-btn-bg: #78350f;
	--agy-warn-btn-text: #fde68a;
	--agy-warn-btn-border: #d97706;

	/* Toast notices */
	--agy-toast-success-bg: #064e3b;
	--agy-toast-success-text: #6ee7b7;
	--agy-toast-success-border: #059669;
	--agy-toast-info-bg: #1e3a8a;
	--agy-toast-info-text: #93c5fd;
	--agy-toast-info-border: #3b82f6;
	--agy-toast-warn-bg: #451a03;
	--agy-toast-warn-text: #fde68a;
	--agy-toast-warn-border: #d97706;
	--agy-toast-error-bg: #450a0a;
	--agy-toast-error-text: #fca5a5;
	--agy-toast-error-border: #dc2626;

	/* Auth Modal / Box */
	--agy-auth-box-bg: #0f223a;
	--agy-auth-box-border: #3b82f6;

	/* Segment control */
	--agy-seg-group-bg: #090d16;
	--agy-seg-group-border: #334155;
	--agy-seg-btn-text: #94a3b8;
	--agy-seg-btn-active-bg: var(--dsw-alias-state-business-primary, #2563eb);
	--agy-seg-btn-active-text: #ffffff;
	--agy-seg-danger-bg: #7f1d1d;
	--agy-seg-danger-text: #fca5a5;
	--agy-seg-danger-border: #ef4444;
}

.agy-spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border: 2px solid currentColor;
	border-top-color: transparent;
	border-radius: 50%;
	animation: agy-spin 0.75s linear infinite;
	vertical-align: -2px;
	margin-right: 5px;
}
.agy-pulse-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
}
.agy-card-hover {
	transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}
.agy-card-hover:hover {
	border-color: var(--agy-border-card-primary, #3b82f6) !important;
	box-shadow: var(--agy-shadow-card-hover) !important;
}
.agy-btn {
	transition: all 0.15s ease;
	user-select: none;
}
.agy-btn:hover:not(:disabled) {
	filter: brightness(1.08);
	transform: translateY(-0.5px);
}
.agy-btn:active:not(:disabled) {
	transform: translateY(0.5px);
}
.agy-progress-fill {
	transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.agy-modal-backdrop {
	position: fixed;
	inset: 0;
	z-index: 9999;
	background: var(--agy-modal-backdrop);
	backdrop-filter: blur(6px);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 16px;
	box-sizing: border-box;
}
.agy-modal-panel {
	position: relative;
	width: 100%;
	max-width: 640px;
	max-height: min(820px, calc(100vh - 48px));
	background: var(--agy-bg-panel);
	border: 1px solid var(--agy-border-card);
	border-radius: 14px;
	box-shadow: var(--agy-shadow-modal);
	display: flex;
	flex-direction: column;
	overflow: hidden;
	color: var(--agy-text-primary);
	font-family: var(--agy-font-family);
}
.agy-submodel-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 7px 10px;
	font-size: 11.5px;
	border-radius: 6px;
	background: var(--agy-bg-subbox);
	border: 1px solid var(--agy-border-box);
	margin: 4px 0;
	color: var(--agy-text-primary);
}
`;
		const S = {
			container: {
				lineHeight: 1.5,
				fontSize: "13px",
				fontFamily: "var(--agy-font-family)",
				color: "var(--agy-text-primary)"
			},
			headerCard: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "12px 16px",
				background: "var(--agy-bg-header)",
				border: "1px solid var(--agy-border-card)",
				borderRadius: "10px",
				marginBottom: "12px",
				color: "var(--agy-text-primary)",
				boxShadow: "var(--agy-shadow-card)"
			},
			badgePrimary: {
				display: "inline-flex",
				alignItems: "center",
				gap: "4px",
				background: "var(--agy-badge-primary-bg)",
				color: "var(--agy-badge-primary-text)",
				border: "1px solid var(--agy-badge-primary-border)",
				padding: "2px 8px",
				borderRadius: "5px",
				fontSize: "11px",
				fontWeight: 700
			},
			badgeTag: {
				display: "inline-flex",
				alignItems: "center",
				gap: "4px",
				background: "var(--agy-badge-tag-bg)",
				color: "var(--agy-badge-tag-text)",
				border: "1px solid var(--agy-badge-tag-border)",
				padding: "2px 7px",
				borderRadius: "5px",
				fontSize: "11px",
				fontWeight: 600
			},
			badgeReady: {
				display: "inline-flex",
				alignItems: "center",
				gap: "4px",
				background: "var(--agy-badge-ready-bg)",
				color: "var(--agy-badge-ready-text)",
				border: "1px solid var(--agy-badge-ready-border)",
				padding: "2px 8px",
				borderRadius: "5px",
				fontSize: "11px",
				fontWeight: 700
			},
			badgeUnready: {
				display: "inline-flex",
				alignItems: "center",
				gap: "4px",
				background: "var(--agy-badge-unready-bg)",
				color: "var(--agy-badge-unready-text)",
				border: "1px solid var(--agy-badge-unready-border)",
				padding: "2px 8px",
				borderRadius: "5px",
				fontSize: "11px",
				fontWeight: 700
			},
			card: {
				background: "var(--agy-bg-card)",
				border: "1px solid var(--agy-border-card)",
				borderRadius: "10px",
				padding: "14px 16px",
				marginBottom: "12px",
				color: "var(--agy-text-primary)",
				boxShadow: "var(--agy-shadow-card)"
			},
			cardPrimary: {
				background: "var(--agy-bg-card-primary)",
				border: "1.5px solid var(--agy-border-card-primary)",
				borderRadius: "10px",
				padding: "14px 16px",
				marginBottom: "12px",
				boxShadow: "var(--agy-shadow-card-primary)",
				color: "var(--agy-text-primary)"
			},
			quotaBox: {
				background: "var(--agy-bg-box)",
				border: "1px solid var(--agy-border-box)",
				borderRadius: "8px",
				padding: "8px 10px",
				marginTop: "10px"
			},
			progressBarBg: {
				flex: "1",
				height: "8px",
				borderRadius: "4px",
				background: "var(--agy-bg-progress-track)",
				border: "1px solid var(--agy-border-box)",
				overflow: "hidden",
				margin: "0 10px"
			},
			btn: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "5px 12px",
				borderRadius: "6px",
				border: "1px solid var(--agy-border-btn)",
				background: "var(--agy-bg-btn)",
				color: "var(--agy-text-btn)",
				cursor: "pointer",
				fontSize: "12px",
				fontWeight: 600
			},
			btnPrimary: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "5px 13px",
				borderRadius: "6px",
				border: "1px solid var(--agy-border-btn-primary)",
				background: "var(--agy-bg-btn-primary)",
				color: "var(--agy-text-btn-primary)",
				cursor: "pointer",
				fontSize: "12px",
				fontWeight: 700,
				boxShadow: "0 2px 6px rgba(37, 99, 235, 0.35)"
			},
			btnDanger: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "4px 9px",
				borderRadius: "6px",
				border: "1px solid var(--agy-danger-border)",
				background: "var(--agy-danger-bg)",
				color: "var(--agy-danger-text)",
				cursor: "pointer",
				fontSize: "11px",
				fontWeight: 600
			},
			btnSm: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "4px 9px",
				borderRadius: "5px",
				border: "1px solid var(--agy-border-btn)",
				background: "var(--agy-bg-btn)",
				color: "var(--agy-text-btn)",
				cursor: "pointer",
				fontSize: "11.5px",
				fontWeight: 600
			},
			btnSmPrimary: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "4px 9px",
				borderRadius: "5px",
				border: "1px solid var(--agy-border-btn-primary)",
				background: "var(--agy-bg-btn-primary)",
				color: "var(--agy-text-btn-primary)",
				cursor: "pointer",
				fontSize: "11.5px",
				fontWeight: 700
			},
			segGroup: {
				display: "inline-flex",
				background: "var(--agy-seg-group-bg)",
				borderRadius: "7px",
				padding: "3px",
				border: "1px solid var(--agy-seg-group-border)"
			},
			segBtn: {
				padding: "4px 10px",
				borderRadius: "4px",
				border: "none",
				background: "transparent",
				color: "var(--agy-seg-btn-text)",
				cursor: "pointer",
				fontSize: "11.5px",
				fontWeight: 600
			},
			segBtnActive: {
				padding: "4px 10px",
				borderRadius: "4px",
				border: "none",
				background: "var(--agy-seg-btn-active-bg)",
				color: "var(--agy-seg-btn-active-text)",
				cursor: "pointer",
				fontSize: "11.5px",
				fontWeight: 700,
				boxShadow: "0 2px 4px rgba(37, 99, 235, 0.4)"
			},
			input: {
				flex: "1",
				padding: "7px 12px",
				borderRadius: "6px",
				border: "1.5px solid var(--agy-border-input)",
				background: "var(--agy-bg-input)",
				color: "var(--agy-text-primary)",
				fontSize: "12.5px",
				outline: "none"
			},
			muted: {
				color: "var(--agy-text-tertiary)",
				fontSize: "11.5px"
			},
			noticeBanner: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "10px 14px",
				borderRadius: "8px",
				marginBottom: "12px",
				fontSize: "12.5px",
				fontWeight: 500
			},
			authModal: {
				background: "var(--agy-auth-box-bg)",
				border: "1.5px solid var(--agy-auth-box-border)",
				borderRadius: "10px",
				padding: "14px 16px",
				marginBottom: "14px",
				color: "var(--agy-text-primary)"
			}
		};
		function apply(ctx) {
			const AgySettingsSection = (props) => {
				const [status, setStatus] = useState(statusCache);
				const [aliasInput, setAliasInput] = useState("");
				const [proxyInputs, setProxyInputs] = useState({});
				const [editingProxyId, setEditingProxyId] = useState(null);
				const [addingAccount, setAddingAccount] = useState(false);
				const [authCodeInput, setAuthCodeInput] = useState("");
				const [loadingAction, setLoadingAction] = useState(null);
				const [toast, setToast] = useState(null);
				const [expandedModels, setExpandedModels] = useState({});
				useEffect(() => {
					let alive = true;
					let lastJson = "";
					const tick = async () => {
						const st = await getStatus();
						if (!alive || !st) return;
						const json = JSON.stringify(st);
						if (json !== lastJson) {
							lastJson = json;
							setStatus(st);
						}
					};
					tick();
					const timer = setInterval(tick, 3e3);
					return () => {
						alive = false;
						clearInterval(timer);
					};
				}, []);
				const flowStartedRef = useRef(false);
				useEffect(() => {
					if (!addingAccount || !flowStartedRef.current) return;
					const pa = status?.poolAuth;
					if (!pa) return;
					if (pa.phase === "done") {
						flowStartedRef.current = false;
						setAddingAccount(false);
						setAuthCodeInput("");
						setAliasInput("");
						showToast(pa.message || "账号已激活入池", "success");
					} else if (pa.phase === "failed") {
						flowStartedRef.current = false;
						showToast(pa.message || "授权失败", "error");
					}
				}, [
					addingAccount,
					status?.poolAuth?.phase,
					status?.poolAuth?.message
				]);
				const showToast = (text, type = "info") => {
					setToast({
						text,
						type,
						id: Date.now()
					});
					setTimeout(() => {
						setToast((prev) => prev?.text === text ? null : prev);
					}, 6e3);
				};
				const refresh = async () => {
					setStatus(await getStatus());
				};
				const handleBeginAddAccount = async () => {
					setLoadingAction("pool:beginAdd");
					const res = await postJson("/plugins/agy-link/pool/begin-add", { alias: aliasInput.trim() || `备用 Google 账号 ${(status?.pool?.accounts?.length ?? 1) + 1}` });
					setLoadingAction(null);
					if (res && res.ok) {
						flowStartedRef.current = true;
						await refresh();
						if (res.browserOpened) showToast("浏览器已打开 Google 授权页，完成授权后将自动同步", "info");
						else showToast("无法自动打开浏览器，请点击下方链接手动完成授权", "warn");
					} else showToast(`启动 Google 授权失败: ${res?.message || "请检查网络或代理配置"}`, "error");
				};
				const handleCompleteAddAccount = async () => {
					if (!authCodeInput.trim()) return;
					setLoadingAction("pool:completeAdd");
					const res = await postJson("/plugins/agy-link/pool/complete-add", { code: authCodeInput.trim() });
					setLoadingAction(null);
					if (res && res.ok) {
						flowStartedRef.current = false;
						setAuthCodeInput("");
						setAliasInput("");
						setAddingAccount(false);
						await refresh();
						showToast(res.message || "成功添加并激活 Google 账号", "success");
					} else showToast(res?.message || res?.error || "授权码验证失败", "error");
				};
				const handleCancelAddAccount = async () => {
					flowStartedRef.current = false;
					await postJson("/plugins/agy-link/pool/cancel-add", {});
					setAuthCodeInput("");
					setAliasInput("");
					setAddingAccount(false);
					await refresh();
				};
				const setCfg = async (key, value) => {
					setLoadingAction(`config:${key}`);
					await postJson("/plugins/agy-link/config", {
						key,
						value
					});
					await refresh();
					setLoadingAction(null);
				};
				const setPrimary = async (id) => {
					setLoadingAction(`primary:${id}`);
					await postJson("/plugins/agy-link/pool/primary", { id });
					await refresh();
					setLoadingAction(null);
					showToast("已设为主用账号", "success");
				};
				const removeAccount = async (id, alias) => {
					setLoadingAction(`remove:${id}`);
					await postJson("/plugins/agy-link/pool/remove", { id });
					await refresh();
					setLoadingAction(null);
					showToast(`已移除账号: ${alias}`, "info");
				};
				const refreshQuota = async (id) => {
					setLoadingAction(id ? `refresh:${id}` : "refresh:all");
					await postJson("/plugins/agy-link/pool/refresh-quota", { id });
					await refresh();
					setLoadingAction(null);
					showToast("额度已刷新", "success");
				};
				const saveProxy = async (id) => {
					setLoadingAction(`proxy:${id}`);
					const proxyUrl = proxyInputs[id];
					await postJson("/plugins/agy-link/pool/proxy", {
						id,
						proxyUrl
					});
					setEditingProxyId(null);
					await refresh();
					setLoadingAction(null);
					showToast("代理已保存", "success");
				};
				const setMode = async (mode) => {
					setLoadingAction(`mode:${mode}`);
					await postJson("/plugins/agy-link/pool/mode", { mode });
					await refresh();
					setLoadingAction(null);
				};
				const clearCooldown = async (id) => {
					setLoadingAction(id ? `clearCooldown:${id}` : "clearCooldown:all");
					await postJson("/plugins/agy-link/pool/clear-cooldown", { id });
					await refresh();
					setLoadingAction(null);
					showToast("已清除冷却", "success");
				};
				const toggleExpand = (accId) => {
					setExpandedModels((prev) => ({
						...prev,
						[accId]: !prev[accId]
					}));
				};
				const authPhase = status?.auth?.phase ?? "unknown";
				const pool = status?.pool;
				const accounts = pool?.accounts ?? [];
				const isAuthed = authPhase === "ok" || accounts.length > 0;
				const isBusy = loadingAction !== null;
				const renderSpinner = () => h("span", { className: "agy-spinner" });
				const renderToastBanner = () => {
					if (!toast) return null;
					const style = {
						success: {
							background: "var(--agy-toast-success-bg)",
							border: "1px solid var(--agy-toast-success-border)",
							color: "var(--agy-toast-success-text)"
						},
						info: {
							background: "var(--agy-toast-info-bg)",
							border: "1px solid var(--agy-toast-info-border)",
							color: "var(--agy-toast-info-text)"
						},
						warn: {
							background: "var(--agy-toast-warn-bg)",
							border: "1px solid var(--agy-toast-warn-border)",
							color: "var(--agy-toast-warn-text)"
						},
						error: {
							background: "var(--agy-toast-error-bg)",
							border: "1px solid var(--agy-toast-error-border)",
							color: "var(--agy-toast-error-text)"
						}
					}[toast.type];
					return h("div", { style: {
						...S.noticeBanner,
						...style
					} }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						fontWeight: 600
					} }, uiIcon(toast.type === "success" ? "check" : toast.type === "error" || toast.type === "warn" ? "alert" : "globe", 14, style.color), h("span", null, toast.text)), h("button", {
						type: "button",
						style: {
							background: "transparent",
							border: "none",
							color: "inherit",
							cursor: "pointer",
							padding: "0 4px",
							opacity: .8,
							display: "inline-flex",
							alignItems: "center"
						},
						onClick: () => setToast(null)
					}, uiIcon("x", 12)));
				};
				const renderQuotaBar = (label, familyKey, acc) => {
					const info = acc.quotas[familyKey];
					const cd = acc.cooldowns[familyKey];
					const inCooldown = cd && cd.cooldownUntil > Date.now();
					const pct5h = typeof info?.remainingFraction === "number" && Number.isFinite(info.remainingFraction) ? Math.max(0, Math.min(100, Math.round(info.remainingFraction * 100))) : -1;
					const cdNote = inCooldown ? " · 本地冷却中" : "";
					const w5h = formatQuotaWindow(info?.resetTime);
					const pctWeekly = typeof info?.weeklyFraction === "number" && Number.isFinite(info.weeklyFraction) ? Math.max(0, Math.min(100, Math.round(info.weeklyFraction * 100))) : -1;
					const wWeekly = formatQuotaWindow(info?.weeklyResetTime);
					const getColors = (pct) => {
						if (pct < 0) return {
							bar: "var(--agy-quota-none-border)",
							text: "var(--agy-quota-none-text)",
							bg: "var(--agy-quota-none-bg)",
							border: "var(--agy-quota-none-border)"
						};
						if (pct <= 20) return {
							bar: "linear-gradient(90deg, #dc2626, #ef4444)",
							text: "var(--agy-quota-low-text)",
							bg: "var(--agy-quota-low-bg)",
							border: "var(--agy-quota-low-border)"
						};
						if (pct <= 50) return {
							bar: "linear-gradient(90deg, #d97706, #f59e0b)",
							text: "var(--agy-quota-med-text)",
							bg: "var(--agy-quota-med-bg)",
							border: "var(--agy-quota-med-border)"
						};
						return {
							bar: "linear-gradient(90deg, #059669, #10b981)",
							text: "var(--agy-quota-high-text)",
							bg: "var(--agy-quota-high-bg)",
							border: "var(--agy-quota-high-border)"
						};
					};
					const c5h = getColors(pct5h);
					const cWeekly = getColors(pctWeekly);
					const renderLine = (windowName, percent, c, resetStr) => {
						return h("div", { style: {
							display: "flex",
							alignItems: "center",
							fontSize: "11.5px",
							margin: "4px 0"
						} }, h("span", { style: {
							width: "52px",
							color: "var(--agy-text-window-label)",
							fontSize: "11px",
							fontWeight: 700,
							flexShrink: 0
						} }, windowName), h("div", { style: S.progressBarBg }, h("div", {
							className: "agy-progress-fill",
							style: {
								width: `${percent < 0 ? 100 : percent}%`,
								height: "100%",
								background: c.bar,
								borderRadius: "3px"
							}
						})), h("div", { style: {
							display: "inline-flex",
							alignItems: "center",
							gap: "8px",
							minWidth: "140px",
							justifyContent: "flex-end",
							flexShrink: 0
						} }, h("span", { style: {
							padding: "2px 7px",
							borderRadius: "4px",
							background: c.bg,
							color: c.text,
							border: `1px solid ${c.border}`,
							fontWeight: 700,
							fontSize: "11.5px",
							lineHeight: 1.2
						} }, percent < 0 ? "—" : `${percent}%`), resetStr ? h("span", { style: {
							color: "var(--agy-text-secondary)",
							fontSize: "11px",
							fontWeight: 500
						} }, `↻ ${resetStr}`) : null));
					};
					return h("div", { style: {
						margin: "6px 0",
						padding: "8px 10px",
						background: "var(--agy-bg-subbox)",
						borderRadius: "7px",
						border: "1px solid var(--agy-border-box)"
					} }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "6px",
						fontWeight: 700,
						fontSize: "12.5px",
						marginBottom: "5px",
						color: "var(--agy-text-primary)"
					} }, brandIcon(FAMILY_BRAND[familyKey], 14), h("span", null, label)), renderLine("5h 额度", pct5h, c5h, w5h.resetText ? w5h.resetText + cdNote : cdNote.replace(/^ · /, "")), renderLine("周额度", pctWeekly, cWeekly, wWeekly.resetText));
				};
				const renderedAccountCards = accounts.map((acc) => {
					const isPrimary = acc.id === pool?.primaryAccountId;
					const hasCooldown = Object.entries(acc.cooldowns).some(([, cd]) => cd && cd.cooldownUntil > Date.now());
					const isAuthRequired = acc.authRequired;
					const dotColor = !acc.enabled ? "#64748b" : isAuthRequired ? "#ef4444" : hasCooldown ? "#f59e0b" : "#10b981";
					const isEditingProxy = editingProxyId === acc.id;
					const isExpanded = expandedModels[acc.id] ?? false;
					const cardStyle = isPrimary ? { ...S.cardPrimary } : { ...S.card };
					const googleModels = acc.quotas.google?.models ?? [];
					const anthropicModels = acc.quotas.anthropic?.models ?? [];
					const openaiModels = acc.quotas.openai?.models ?? [];
					const allChildModels = [
						...googleModels.map((m) => ({
							family: "Google",
							model: m
						})),
						...anthropicModels.map((m) => ({
							family: "Anthropic",
							model: m
						})),
						...openaiModels.map((m) => ({
							family: "OpenAI",
							model: m
						}))
					];
					return h("div", {
						key: acc.id,
						className: "agy-card-hover",
						style: cardStyle
					}, h("div", { style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: "8px"
					} }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						flexWrap: "wrap"
					} }, h("span", {
						className: "agy-pulse-dot",
						style: {
							background: dotColor,
							boxShadow: `0 0 8px ${dotColor}aa`
						}
					}), h("span", { style: {
						fontWeight: 700,
						fontSize: "13.5px",
						color: "var(--agy-text-primary)"
					} }, acc.alias), isAuthRequired ? h("span", { style: {
						...S.badgeTag,
						background: "var(--agy-badge-email-bg)",
						color: "#ef4444",
						borderColor: "#fca5a5",
						gap: "4px",
						fontWeight: 700
					} }, uiIcon("alert", 11, "#ef4444"), "需重新登录") : null, acc.email ? h("span", { style: {
						...S.badgeTag,
						background: "var(--agy-badge-email-bg)",
						color: "var(--agy-badge-email-text)",
						borderColor: "var(--agy-badge-email-border)",
						gap: "5px"
					} }, uiIcon("mail", 11, "var(--agy-badge-email-text)"), acc.email) : null, isPrimary ? h("span", { style: {
						...S.badgePrimary,
						gap: "4px"
					} }, uiIcon("star", 10, "var(--agy-badge-primary-text)"), "主用") : null, acc.proxyUrl ? h("span", { style: {
						...S.badgeTag,
						background: "var(--agy-badge-proxy-bg)",
						color: "var(--agy-badge-proxy-text)",
						borderColor: "var(--agy-badge-proxy-border)",
						gap: "5px"
					} }, uiIcon("globe", 11, "var(--agy-badge-proxy-text)"), "代理") : null), h("div", { style: {
						display: "flex",
						gap: "5px",
						alignItems: "center"
					} }, allChildModels.length > 0 ? h("button", {
						type: "button",
						className: "agy-btn",
						style: isExpanded ? {
							...S.btnSmPrimary,
							gap: "3px"
						} : {
							...S.btnSm,
							gap: "3px"
						},
						onClick: () => toggleExpand(acc.id)
					}, isExpanded ? [uiIcon("chevronUp", 11), " 收起"] : [uiIcon("chevronDown", 11), " 明细"]) : null, h("button", {
						type: "button",
						className: "agy-btn",
						style: {
							...S.btnSm,
							gap: "4px"
						},
						title: "刷新此账号（换号后点这里立即同步 email / 额度 / 模型）",
						disabled: isBusy,
						onClick: () => void refreshQuota(acc.id)
					}, loadingAction === `refresh:${acc.id}` ? [renderSpinner(), "同步中"] : [uiIcon("refresh", 11), " 同步"]), !isPrimary ? h("button", {
						type: "button",
						className: "agy-btn",
						style: {
							...S.btnSm,
							gap: "4px"
						},
						disabled: isBusy,
						onClick: () => void setPrimary(acc.id)
					}, loadingAction === `primary:${acc.id}` ? [renderSpinner(), "设置中"] : [uiIcon("star", 11), " 设为主用"]) : null, h("button", {
						type: "button",
						className: "agy-btn",
						style: isEditingProxy ? {
							...S.btnSmPrimary,
							gap: "4px"
						} : {
							...S.btnSm,
							gap: "4px"
						},
						disabled: isBusy,
						onClick: () => setEditingProxyId(isEditingProxy ? null : acc.id)
					}, [uiIcon("globe", 11), " 代理"]), accounts.length > 1 ? h("button", {
						type: "button",
						className: "agy-btn",
						style: {
							...S.btnDanger,
							padding: "3px 7px"
						},
						title: "移除此账号",
						disabled: isBusy,
						onClick: () => void removeAccount(acc.id, acc.alias)
					}, loadingAction === `remove:${acc.id}` ? renderSpinner() : uiIcon("trash", 12, "var(--agy-danger-text)")) : null)), h("div", { style: S.quotaBox }, renderQuotaBar("Gemini", "google", acc), renderQuotaBar("Claude", "anthropic", acc), renderQuotaBar("GPT-OSS", "openai", acc), isExpanded && allChildModels.length > 0 ? h("div", { style: {
						marginTop: "8px",
						paddingTop: "8px",
						borderTop: "1px solid var(--agy-border-box)"
					} }, h("div", { style: {
						color: "var(--agy-text-secondary)",
						marginBottom: "6px",
						fontWeight: 600,
						fontSize: "11px"
					} }, "单模型明细:"), allChildModels.map(({ family, model }) => {
						const frac = model.remainingFraction ?? 1;
						const pct = Math.round(frac * 100);
						const w = formatQuotaWindow(model.resetTime);
						const pColor = pct <= 20 ? "var(--agy-quota-low-text)" : pct <= 50 ? "var(--agy-quota-med-text)" : "var(--agy-quota-high-text)";
						return h("div", {
							key: model.modelId,
							className: "agy-submodel-row"
						}, h("span", { style: {
							fontWeight: 500,
							color: "var(--agy-text-primary)"
						} }, `[${family}] ${model.displayName || model.modelId}`), h("div", { style: {
							display: "flex",
							alignItems: "center",
							gap: "8px"
						} }, h("span", { style: {
							color: pColor,
							fontWeight: 700
						} }, `${pct}%`), w.resetText ? h("span", { style: {
							color: "var(--agy-text-tertiary)",
							fontSize: "10.5px"
						} }, `↻ ${w.resetText}`) : null));
					})) : null), hasCooldown ? h("div", { style: {
						background: "var(--agy-warn-bg)",
						border: "1px solid var(--agy-warn-border)",
						borderRadius: "7px",
						padding: "6px 10px",
						color: "var(--agy-warn-text)",
						fontSize: "11.5px",
						fontWeight: 600,
						marginTop: "8px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between"
					} }, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "6px"
					} }, uiIcon("alert", 13, "var(--agy-warn-text)"), h("span", null, "部分模型限流中，已自动切换账号")), h("button", {
						type: "button",
						className: "agy-btn",
						style: {
							...S.btnSm,
							color: "var(--agy-warn-btn-text)",
							borderColor: "var(--agy-warn-btn-border)",
							background: "var(--agy-warn-btn-bg)",
							gap: "4px"
						},
						disabled: isBusy,
						onClick: () => void clearCooldown(acc.id)
					}, loadingAction === `clearCooldown:${acc.id}` ? [renderSpinner(), ""] : [uiIcon("zap", 11, "var(--agy-warn-btn-text)"), " 清除冷却"])) : null, isEditingProxy ? h("div", { style: {
						marginTop: "8px",
						padding: "10px 12px",
						background: "var(--agy-bg-subbox)",
						borderRadius: "7px",
						border: "1px solid var(--agy-border-subbox)"
					} }, h("div", { style: {
						display: "flex",
						gap: "8px"
					} }, h("input", {
						style: S.input,
						value: proxyInputs[acc.id] !== void 0 ? proxyInputs[acc.id] : acc.proxyUrl ?? "",
						placeholder: "专属代理 URL (如: http://127.0.0.1:7890，留空则使用全局)",
						onChange: (e) => setProxyInputs({
							...proxyInputs,
							[acc.id]: e.target.value
						})
					}), h("button", {
						type: "button",
						className: "agy-btn",
						style: S.btnPrimary,
						disabled: isBusy,
						onClick: () => void saveProxy(acc.id)
					}, loadingAction === `proxy:${acc.id}` ? [renderSpinner(), "保存"] : "保存"), h("button", {
						type: "button",
						className: "agy-btn",
						style: S.btn,
						onClick: () => setEditingProxyId(null)
					}, "取消"))) : null);
				});
				const poolAuth = status?.poolAuth;
				const flowPhase = poolAuth?.phase ?? "idle";
				const flowActive = flowPhase === "waiting" || flowPhase === "exchanging";
				const addAccountSection = addingAccount ? h("div", { style: S.authModal }, h("div", { style: {
					fontWeight: 700,
					fontSize: "13.5px",
					marginBottom: "10px",
					display: "flex",
					alignItems: "center",
					gap: "6px",
					color: "var(--agy-text-primary)"
				} }, uiIcon("plus", 13, "var(--agy-btn-primary-bg)"), "添加 Google 账号"), !flowActive ? h("div", null, h("div", { style: {
					display: "flex",
					gap: "8px"
				} }, h("input", {
					style: S.input,
					value: aliasInput,
					placeholder: "账号别名 (例如: 备用账号 2)",
					onChange: (e) => setAliasInput(e.target.value)
				}), h("button", {
					type: "button",
					className: "agy-btn",
					style: {
						...S.btnPrimary,
						gap: "4px"
					},
					disabled: isBusy,
					onClick: () => void handleBeginAddAccount()
				}, loadingAction === "pool:beginAdd" ? [renderSpinner(), "正在打开浏览器..."] : [uiIcon("externalLink", 12, "#ffffff"), " 打开浏览器登录"]), h("button", {
					type: "button",
					className: "agy-btn",
					style: S.btn,
					onClick: () => handleCancelAddAccount()
				}, "取消")), flowPhase === "failed" && poolAuth?.message ? h("div", { style: {
					...S.muted,
					color: "var(--agy-danger-text)",
					marginTop: "8px",
					display: "flex",
					alignItems: "center",
					gap: "5px",
					fontWeight: 600
				} }, uiIcon("alert", 12, "var(--agy-danger-text)"), poolAuth.message) : null) : h("div", null, h("div", { style: {
					display: "flex",
					alignItems: "center",
					color: "var(--agy-text-secondary)",
					marginBottom: "8px",
					lineHeight: 1.5,
					fontSize: "12px"
				} }, renderSpinner(), flowPhase === "exchanging" ? "正在验证授权并激活账号，请稍候..." : "等待浏览器中完成 Google 授权，成功后将自动激活。"), poolAuth?.url ? h("div", { style: { marginBottom: "8px" } }, h("a", {
					href: poolAuth.url,
					target: "_blank",
					style: {
						color: "var(--dsw-alias-state-business-primary, #2563eb)",
						textDecoration: "underline",
						fontSize: "12px",
						fontWeight: 600,
						display: "inline-flex",
						alignItems: "center",
						gap: "4px"
					}
				}, uiIcon("externalLink", 12, "currentColor"), "若浏览器未打开，请点击此处手动打开 Google 登录页")) : null, h("div", { style: {
					color: "var(--agy-text-tertiary)",
					marginBottom: "6px",
					fontSize: "11px",
					fontWeight: 500
				} }, "未完成自动回调时，可粘贴授权码或回调 URL："), h("div", { style: {
					display: "flex",
					gap: "8px"
				} }, h("input", {
					style: S.input,
					value: authCodeInput,
					placeholder: "授权码 或 http://localhost:51121/oauth-callback?code=... 完整链接",
					onChange: (e) => setAuthCodeInput(e.target.value)
				}), h("button", {
					type: "button",
					className: "agy-btn",
					style: {
						...S.btnPrimary,
						gap: "4px"
					},
					disabled: isBusy || !authCodeInput.trim(),
					onClick: () => void handleCompleteAddAccount()
				}, loadingAction === "pool:completeAdd" ? [renderSpinner(), "验证激活中..."] : [uiIcon("check", 12, "#ffffff"), " 手动激活"]), h("button", {
					type: "button",
					className: "agy-btn",
					style: S.btn,
					onClick: () => handleCancelAddAccount()
				}, "取消")))) : null;
				if (status === null) return h("div", { style: {
					...S.container,
					minHeight: "120px",
					display: "flex",
					alignItems: "center",
					justifyContent: "center"
				} }, h("style", null, GLOBAL_CSS), h("span", { style: S.muted }, [renderSpinner(), "正在加载 Antigravity 状态..."]));
				return h("div", { style: S.container }, h("style", null, GLOBAL_CSS), h("div", { style: S.headerCard }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "8px"
				} }, agyIcon(16), h("span", { style: {
					fontWeight: 700,
					fontSize: "14px",
					color: "var(--agy-text-primary)"
				} }, "Antigravity"), h("span", { style: isAuthed ? S.badgeReady : S.badgeUnready }, isAuthed ? "就绪" : "待认证")), h("div", { style: {
					display: "flex",
					gap: "6px",
					alignItems: "center"
				} }, !addingAccount ? h("button", {
					type: "button",
					className: "agy-btn",
					style: {
						...S.btnPrimary,
						gap: "4px"
					},
					onClick: () => setAddingAccount(true)
				}, [uiIcon("plus", 12, "#ffffff"), " 添加账号"]) : null, h("button", {
					type: "button",
					className: "agy-btn",
					style: {
						...S.btn,
						gap: "4px"
					},
					disabled: isBusy,
					onClick: () => void refreshQuota()
				}, loadingAction === "refresh:all" ? [renderSpinner(), "刷新中"] : [uiIcon("refresh", 12, "var(--agy-text-btn)"), " 刷新额度"]))), renderToastBanner(), addAccountSection, renderedAccountCards, h("div", { style: {
					marginTop: "16px",
					paddingTop: "12px",
					borderTop: "1px solid var(--agy-border-divider)"
				} }, h("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: "10px"
				} }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between"
				} }, h("span", { style: {
					color: "var(--agy-text-primary)",
					fontWeight: 600,
					fontSize: "12.5px"
				} }, "权限模式:"), h("div", { style: S.segGroup }, h("button", {
					type: "button",
					style: status?.permissionMode === "plan" ? S.segBtnActive : S.segBtn,
					onClick: () => void setCfg("permissionMode", "plan")
				}, "plan (只读)"), h("button", {
					type: "button",
					style: status?.permissionMode === "accept-edits" ? S.segBtnActive : S.segBtn,
					onClick: () => void setCfg("permissionMode", "accept-edits")
				}, "accept-edits (改代码)"), h("button", {
					type: "button",
					style: status?.permissionMode === "skip" ? {
						...S.segBtnActive,
						color: "var(--agy-seg-danger-text)",
						background: "var(--agy-seg-danger-bg)",
						border: "1px solid var(--agy-seg-danger-border)"
					} : S.segBtn,
					onClick: () => void setCfg("permissionMode", "skip")
				}, "skip (全自动免确认)"))), h("div", { style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between"
				} }, h("span", { style: {
					color: "var(--agy-text-primary)",
					fontWeight: 600,
					fontSize: "12.5px"
				} }, "思考强度:"), h("div", { style: S.segGroup }, h("button", {
					type: "button",
					style: status?.defaultEffort === "" ? S.segBtnActive : S.segBtn,
					onClick: () => void setCfg("defaultEffort", "")
				}, "auto"), h("button", {
					type: "button",
					style: status?.defaultEffort === "low" ? S.segBtnActive : S.segBtn,
					onClick: () => void setCfg("defaultEffort", "low")
				}, "low"), h("button", {
					type: "button",
					style: status?.defaultEffort === "medium" ? S.segBtnActive : S.segBtn,
					onClick: () => void setCfg("defaultEffort", "medium")
				}, "medium"), h("button", {
					type: "button",
					style: status?.defaultEffort === "high" ? S.segBtnActive : S.segBtn,
					onClick: () => void setCfg("defaultEffort", "high")
				}, "high"))), h("div", { style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between"
				} }, h("span", { style: {
					color: "var(--agy-text-primary)",
					fontWeight: 600,
					fontSize: "12.5px"
				} }, "号池调度:"), h("div", { style: S.segGroup }, h("button", {
					type: "button",
					style: pool?.mode === "sequential" || !pool?.mode ? S.segBtnActive : S.segBtn,
					onClick: () => void setMode("sequential")
				}, "顺次耗尽"), h("button", {
					type: "button",
					style: pool?.mode === "round-robin" ? S.segBtnActive : S.segBtn,
					onClick: () => void setMode("round-robin")
				}, "轮询均衡"))))));
			};
			/** Modal dialog container rendered into document.body */
			const AgyModalDialog = () => {
				const [isOpen, setIsOpen] = useState(agyModalStore.open);
				useEffect(() => {
					return agyModalStore.subscribe(() => {
						setIsOpen(agyModalStore.open);
					});
				}, []);
				useEffect(() => {
					if (!isOpen) return;
					const onKey = (e) => {
						if (e.key === "Escape") {
							e.stopPropagation();
							agyModalStore.setOpen(false);
						}
					};
					win.addEventListener?.("keydown", onKey, true);
					return () => win.removeEventListener?.("keydown", onKey, true);
				}, [isOpen]);
				if (!isOpen) return null;
				return h("div", {
					className: "agy-modal-backdrop",
					onClick: (e) => {
						if (e.target === e.currentTarget) agyModalStore.setOpen(false);
					}
				}, h("div", {
					className: "agy-modal-panel",
					role: "dialog",
					"aria-modal": true
				}, h("div", { style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "14px 18px",
					borderBottom: "1px solid var(--agy-border-card)",
					background: "var(--agy-bg-header)",
					color: "var(--agy-text-primary)"
				} }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "8px"
				} }, agyIcon(18), h("strong", { style: {
					fontSize: "14.5px",
					fontWeight: 700,
					color: "var(--agy-text-primary)"
				} }, "Antigravity 管理控制台")), h("button", {
					type: "button",
					title: "关闭 (Esc)",
					style: {
						background: "var(--agy-bg-btn)",
						border: "1px solid var(--agy-border-btn)",
						color: "var(--agy-text-btn)",
						cursor: "pointer",
						padding: "4px 8px",
						borderRadius: "6px",
						display: "inline-flex",
						alignItems: "center"
					},
					onClick: () => agyModalStore.setOpen(false)
				}, uiIcon("x", 14, "var(--agy-text-btn)"))), h("div", { style: {
					overflowY: "auto",
					padding: "18px",
					flex: "1",
					background: "var(--agy-bg-panel)"
				} }, h(AgySettingsSection, {
					isModal: true,
					onClose: () => agyModalStore.setOpen(false)
				}))));
			};
			/** Session Header badge in chat toolbar */
			const AgySessionStatus = () => {
				const [status, setStatus] = useState(statusCache);
				useEffect(() => {
					let alive = true;
					let lastJson = "";
					const tick = async () => {
						const st = await getStatus();
						if (!alive || !st) return;
						const json = JSON.stringify(st);
						if (json !== lastJson) {
							lastJson = json;
							setStatus(st);
						}
					};
					tick();
					const timer = setInterval(tick, 3e3);
					return () => {
						alive = false;
						clearInterval(timer);
					};
				}, []);
				const accounts = (status?.pool)?.accounts ?? [];
				const hasCooldown = accounts.some((a) => Object.entries(a.cooldowns).some(([, cd]) => cd && cd.cooldownUntil > Date.now()));
				const isAuthed = status?.auth?.phase === "ok" || accounts.length > 0;
				const color = status === null ? "#64748b" : status.dormantReason ? "#f59e0b" : hasCooldown ? "#f59e0b" : isAuthed ? "#10b981" : "#f59e0b";
				const badge = h("button", {
					type: "button",
					title: `Antigravity: ${accounts.length} accounts ready · 点击打开控制台`,
					className: "agy-btn",
					onClick: () => agyModalStore.setOpen(true),
					style: {
						background: "var(--agy-bg-header)",
						border: "1px solid var(--agy-border-card)",
						borderRadius: "999px",
						cursor: "pointer",
						padding: "3px 10px",
						fontSize: "11.5px",
						fontWeight: 600,
						lineHeight: 1.5,
						color: "var(--agy-text-primary)",
						display: "inline-flex",
						alignItems: "center",
						gap: "6px",
						boxShadow: "var(--agy-shadow-card)"
					}
				}, h("span", { style: {
					display: "inline-block",
					width: "7px",
					height: "7px",
					borderRadius: "50%",
					background: color
				} }), `AGY (${accounts.length})`);
				return h("div", { style: { display: "inline-block" } }, badge, portalToBody(h(AgyModalDialog, null)));
			};
			ctx.slots.inject("conversation.session.header.actions", () => {
				return ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "agy-link-status",
					order: 10,
					label: "Antigravity"
				}, AgySessionStatus);
			});
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
