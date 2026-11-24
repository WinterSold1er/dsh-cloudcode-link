window.__ModuleLoader__.load({
	id: "dsh-cloudcode-link",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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
		//#region src/client/api.ts
		const API_PREFIX = "/plugins/cloudcode-link";
		const LEGACY_API_PREFIX = "/plugins/agy-link";
		function getOrigin() {
			return globalThis.location?.origin ?? "";
		}
		function resolveApiPath(subPath) {
			if (subPath.startsWith("/plugins/cloudcode-link") || subPath.startsWith("/plugins/agy-link")) return subPath;
			const normalized = subPath.startsWith("/") ? subPath : `/${subPath}`;
			return `${API_PREFIX}${normalized}`;
		}
		/**
		* Primary prefix, then a 404-only fallback to the legacy prefix (older host builds).
		* Failure is visible: null means "no usable response" and every caller surfaces it in the UI.
		*/
		async function fetchWithFallback(path, init) {
			const g = globalThis;
			if (typeof g.fetch !== "function") return null;
			const base = getOrigin();
			const fullUrl = `${base}${path}`;
			try {
				const res = await g.fetch(fullUrl, init);
				if (res && res.status === 404 && path.startsWith("/plugins/cloudcode-link")) {
					const legacy = `${base}${LEGACY_API_PREFIX}${path.slice(23)}`;
					return await g.fetch(legacy, init) ?? null;
				}
				return res ?? null;
			} catch {
				return null;
			}
		}
		async function parseJsonResponse(res) {
			if (!res) return {
				ok: false,
				status: 0,
				data: null,
				error: "网络请求失败或服务不可达"
			};
			let data = null;
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			const dataObj = data && typeof data === "object" ? data : null;
			const serverError = typeof dataObj?.error === "string" ? dataObj.error : void 0;
			const ok = res.ok && dataObj?.ok !== false;
			return {
				ok,
				status: res.status,
				data,
				error: ok ? void 0 : serverError ?? `HTTP ${res.status}`
			};
		}
		async function getJson(subPath) {
			return parseJsonResponse(await fetchWithFallback(resolveApiPath(subPath)));
		}
		async function postJson(subPath, body) {
			return parseJsonResponse(await fetchWithFallback(resolveApiPath(subPath), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body ?? {})
			}));
		}
		//#endregion
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
		/**
		* Paint for the settings-nav glyph. `currentColor` inherits the shell's own nav text
		* color, which is what keeps an inactive row readable in both DSH themes; the active
		* row switches to the panel accent token, with `currentColor` as the fallback for the
		* window where the panel stylesheet has not mounted yet.
		*/
		function settingsNavPaint(active) {
			return active ? "var(--agy-accent, currentColor)" : "currentColor";
		}
		/**
		* Settings-nav glyph for the `settings.section.icon` seat, which the shell renders at
		* 16px inside its own nav button. Simplified brand mark: one orbit ring with the solid
		* core drawn on top of it, so the ring reads as passing behind the core. Gradient-free
		* on purpose — an orb gradient smears at 16px and its <defs> force the whole SVG
		* subtree to repaint on every re-render. React-free so the geometry is unit-testable.
		*/
		function settingsNavShapes(active) {
			const paint = settingsNavPaint(active);
			return [{
				tag: "ellipse",
				attrs: {
					cx: 12,
					cy: 12,
					rx: 10,
					ry: 6.2,
					fill: "none",
					stroke: paint,
					"stroke-width": 2,
					transform: "rotate(-20 12 12)"
				}
			}, {
				tag: "circle",
				attrs: {
					cx: 12,
					cy: 12,
					r: 3.2,
					fill: paint
				}
			}];
		}
		/**
		* Normalize the props the settings shell hands an icon contribution
		* (`{ size, active }`). Only a finite positive number is taken as a size — anything
		* else falls back to the shell's 16px default instead of rendering a broken glyph,
		* and only a real boolean `true` counts as active.
		*/
		function settingsNavProps(props) {
			const given = typeof props === "object" && props !== null ? props : {};
			return {
				size: typeof given.size === "number" && Number.isFinite(given.size) && given.size > 0 ? given.size : 16,
				active: given.active === true
			};
		}
		//#endregion
		//#region src/client/theme.ts
		const THEME_CSS = `
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
	--agy-bg-subtle: var(--dsw-alias-bg-layer-3, #f4f6f9);
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
	--agy-border-subtle: var(--dsw-alias-border-l2, #dbe2ea);
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
	--agy-tint-primary: rgba(37, 99, 235, 0.08);
	--agy-accent-border: rgba(37, 99, 235, 0.28);

	/* --- quota gradients --- */
	--agy-quota-high-bar: #16a34a;
	--agy-quota-med-bar: #d97706;
	--agy-quota-low-bar: #dc2626;
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

	/* --- Awwwards-grade layered surfaces & hairline borders --- */
	--agy-surface-elevated: var(--dsw-alias-bg-layer-1, #ffffff);
	--agy-surface-subtle: var(--dsw-alias-bg-layer-3, #f7f9fb);
	--agy-hairline: rgba(15, 23, 42, 0.08);
	--agy-hairline-strong: rgba(15, 23, 42, 0.14);
}

body[data-ds-dark-theme],
body.dark,
body[data-theme="dark"] {
	--agy-bg-panel: var(--dsw-alias-bg-layer-2, #171a20);
	--agy-bg-card: var(--dsw-alias-bg-layer-2, #171a20);
	--agy-bg-card-primary: #172232;
	--agy-bg-header: var(--dsw-alias-bg-layer-2, #191c22);
	--agy-bg-subbox: var(--dsw-alias-bg-layer-3, #1e2229);
	--agy-bg-subtle: var(--dsw-alias-bg-layer-3, #1e2229);
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
	--agy-border-subtle: var(--dsw-alias-border-l2, #333a45);
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
	--agy-tint-primary: rgba(96, 165, 250, 0.12);
	--agy-accent-border: rgba(96, 165, 250, 0.32);
	--agy-on-accent: #0b1220;
	--agy-focus-ring: #60a5fa;

	--agy-strong-ok: #34d399;
	--agy-strong-warn: #fbbf24;
	--agy-strong-danger: #f87171;
	--agy-strong-neutral: #98a2b1;

	--agy-quota-high-bar: #4ade80;
	--agy-quota-med-bar: #fbbf24;
	--agy-quota-low-bar: #f87171;
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

	/* --- Awwwards-grade layered surfaces & hairline borders (dark) --- */
	--agy-surface-elevated: var(--dsw-alias-bg-layer-2, #191c22);
	--agy-surface-subtle: var(--dsw-alias-bg-layer-3, #1e2229);
	--agy-hairline: rgba(255, 255, 255, 0.08);
	--agy-hairline-strong: rgba(255, 255, 255, 0.15);
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

@keyframes agyFadeSlideIn {
	from { opacity: 0; transform: translateY(6px); }
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

.agy-fade-slide-in {
	animation: agyFadeSlideIn var(--agy-dur-base) var(--agy-ease-out) both;
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
	box-shadow: var(--agy-shadow-1);
}

.agy-btn:active:not(:disabled) {
	transform: translateY(0) scale(0.985);
	box-shadow: none;
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
			},
			kpiCard: {
				padding: "var(--agy-space-3) var(--agy-space-4)",
				background: "var(--agy-surface-elevated)",
				border: "1px solid var(--agy-hairline)",
				borderRadius: "var(--agy-radius-lg)",
				boxShadow: "var(--agy-shadow-card)",
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				minWidth: 0
			},
			kpiLabel: {
				fontSize: "var(--agy-font-xs)",
				fontWeight: 600,
				letterSpacing: "0.02em",
				color: "var(--agy-text-tertiary)"
			},
			kpiValue: {
				fontSize: "var(--agy-font-xl)",
				fontWeight: 700,
				lineHeight: 1.2,
				fontVariantNumeric: "tabular-nums",
				color: "var(--agy-text-primary)"
			},
			kpiSub: {
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-text-secondary)",
				fontVariantNumeric: "tabular-nums"
			},
			strip: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "var(--agy-space-2)",
				padding: "9px var(--agy-space-3)",
				borderRadius: "var(--agy-radius-md)",
				fontSize: "var(--agy-font-sm)",
				marginBottom: "var(--agy-space-2)"
			},
			emptyState: {
				padding: "var(--agy-space-5)",
				textAlign: "center",
				border: "1px dashed var(--agy-border-divider)",
				borderRadius: "var(--agy-radius-lg)",
				background: "var(--agy-surface-subtle)"
			},
			badgeOk: {
				background: "var(--agy-ok-bg)",
				color: "var(--agy-ok-text)",
				border: "1px solid var(--agy-ok-border)"
			},
			badgeWarn: {
				background: "var(--agy-warn-bg)",
				color: "var(--agy-warn-text)",
				border: "1px solid var(--agy-warn-border)"
			},
			badgeDanger: {
				background: "var(--agy-danger-bg)",
				color: "var(--agy-danger-text)",
				border: "1px solid var(--agy-danger-border)"
			},
			badgeInfo: {
				background: "var(--agy-info-bg)",
				color: "var(--agy-info-text)",
				border: "1px solid var(--agy-info-border)"
			},
			badgeNeutral: {
				background: "var(--agy-bg-subbox)",
				color: "var(--agy-text-secondary)",
				border: "1px solid var(--agy-border-subbox)"
			}
		};
		//#endregion
		//#region src/client/components/ui.ts
		const { createElement: h$7 } = require("react");
		/** Inline brand logo (Gemini / Claude / OpenAI) as a crisp SVG mark. */
		function brandIcon(key, size = 13) {
			return h$7("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				"aria-hidden": true,
				style: {
					display: "inline-block",
					verticalAlign: "-2px",
					flexShrink: 0
				}
			}, h$7("path", {
				d: BRAND_PATHS[key],
				fill: BRAND_COLORS[key]
			}));
		}
		/** Clean outline/filled SVG icon (Lucide-style), zero emoji dependency. */
		function uiIcon(name, size = 12, color = "currentColor") {
			const p = UI_PATHS[name];
			const isFilled = name === "star";
			return h$7("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				"aria-hidden": true,
				style: {
					display: "inline-block",
					verticalAlign: "-1.5px",
					flexShrink: 0
				}
			}, h$7("path", {
				d: p,
				fill: isFilled ? color : "none",
				stroke: isFilled ? "none" : color,
				"stroke-width": isFilled ? void 0 : 2,
				"stroke-linecap": isFilled ? void 0 : "round",
				"stroke-linejoin": isFilled ? void 0 : "round"
			}));
		}
		function renderStrip(kind, text, onRetry) {
			const isError = kind === "error";
			const isWarn = kind === "warn";
			const isOk = kind === "ok" || kind === "success";
			const bg = isError ? "var(--agy-danger-bg)" : isWarn ? "var(--agy-warn-bg)" : isOk ? "var(--agy-ok-bg)" : "var(--agy-info-bg)";
			const border = isError ? "var(--agy-danger-border)" : isWarn ? "var(--agy-warn-border)" : isOk ? "var(--agy-ok-border)" : "var(--agy-info-border)";
			const color = isError ? "var(--agy-danger-text)" : isWarn ? "var(--agy-warn-text)" : isOk ? "var(--agy-ok-text)" : "var(--agy-info-text)";
			return h$7("div", {
				role: "alert",
				className: "agy-fade-slide-in",
				style: {
					...S.strip,
					background: bg,
					border: `1px solid ${border}`,
					color
				}
			}, h$7("span", null, text), onRetry ? h$7("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSm,
				onClick: onRetry,
				"aria-label": "重试加载"
			}, uiIcon("refresh", 12), " 重试") : null);
		}
		function renderEmptyState(icon, title, desc, action) {
			return h$7("div", {
				className: "agy-fade-slide-in",
				style: S.emptyState
			}, icon ? h$7("div", { style: {
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: "32px",
				height: "32px",
				borderRadius: "var(--agy-radius-md)",
				background: "var(--agy-bg-box)",
				border: "1px solid var(--agy-hairline)",
				color: "var(--agy-text-tertiary)",
				marginBottom: "var(--agy-space-2)"
			} }, uiIcon(icon, 16)) : null, h$7("div", { style: {
				color: "var(--agy-text-primary)",
				fontSize: "var(--agy-font-md)",
				fontWeight: 600,
				lineHeight: 1.5
			} }, title), desc ? h$7("div", { style: {
				color: "var(--agy-text-secondary)",
				fontSize: "var(--agy-font-sm)",
				lineHeight: 1.6,
				marginTop: "4px"
			} }, desc) : null, action ? h$7("div", { style: { marginTop: "var(--agy-space-3)" } }, action) : null);
		}
		function renderKpiCard(label, value, sub, accent) {
			return h$7("div", {
				className: "agy-card-hover",
				style: {
					...S.kpiCard,
					flex: "1 1 150px"
				}
			}, h$7("div", { style: S.kpiLabel }, label), h$7("div", {
				className: "agy-num",
				style: {
					...S.kpiValue,
					color: accent ?? "var(--agy-text-primary)"
				}
			}, String(value)), sub ? h$7("div", {
				className: "agy-num",
				style: S.kpiSub
			}, sub) : null);
		}
		function quotaTone(pct) {
			if (pct < 10) return {
				bar: "var(--agy-quota-low-bar)",
				text: "var(--agy-quota-low-text)"
			};
			if (pct <= 30) return {
				bar: "var(--agy-quota-med-bar)",
				text: "var(--agy-quota-med-text)"
			};
			return {
				bar: "var(--agy-quota-high-bar)",
				text: "var(--agy-quota-high-text)"
			};
		}
		function formatResetLabel(resetTime) {
			if (resetTime === void 0 || resetTime === null || resetTime === "") return "";
			const { resetText } = formatQuotaWindow(typeof resetTime === "number" ? new Date(resetTime).toISOString() : resetTime);
			return resetText ? `↻ ${resetText}` : "";
		}
		function renderQuotaBar(label, fraction, resetTime, weeklyFraction, weeklyResetTime) {
			const pct = typeof fraction === "number" && Number.isFinite(fraction) ? Math.max(0, Math.min(100, Math.round(fraction * 100))) : null;
			const tone = pct !== null ? quotaTone(pct) : null;
			const resetLabel = formatResetLabel(resetTime);
			const weeklyPct = typeof weeklyFraction === "number" && Number.isFinite(weeklyFraction) ? Math.max(0, Math.min(100, Math.round(weeklyFraction * 100))) : null;
			const weeklyTone = weeklyPct !== null ? quotaTone(weeklyPct) : null;
			const weeklyResetLabel = formatResetLabel(weeklyResetTime);
			return h$7("div", { style: S.quotaBox }, h$7("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "var(--agy-space-2)",
				marginBottom: "5px"
			} }, h$7("span", { style: {
				fontSize: "var(--agy-font-sm)",
				fontWeight: 700,
				color: "var(--agy-text-primary)"
			} }, label), h$7("span", {
				className: "agy-num",
				style: {
					fontSize: "var(--agy-font-xs)",
					fontWeight: 600,
					color: tone ? tone.text : "var(--agy-text-tertiary)"
				}
			}, pct !== null ? `${pct}%` : "—")), h$7("div", { style: S.progressBarBg }, pct !== null && tone ? h$7("div", {
				className: "agy-progress-fill",
				style: {
					width: `${pct}%`,
					height: "100%",
					borderRadius: "var(--agy-radius-pill)",
					background: tone.bar
				}
			}) : null), resetLabel ? h$7("div", {
				className: "agy-num",
				style: {
					marginTop: "4px",
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-text-tertiary)"
				}
			}, resetLabel) : null, weeklyPct !== null && weeklyTone ? h$7("div", { style: {
				marginTop: "6px",
				paddingTop: "6px",
				borderTop: "1px solid var(--agy-hairline)",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "var(--agy-space-2)",
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-text-secondary)"
			} }, h$7("span", null, "周配额"), h$7("span", {
				className: "agy-num",
				style: {
					color: weeklyTone.text,
					fontWeight: 600
				}
			}, `${weeklyPct}%${weeklyResetLabel ? ` · ${weeklyResetLabel}` : ""}`)) : null);
		}
		function renderSegmentedControl(options, value, onChange, ariaLabel) {
			const enabledOptions = options.filter((o) => !o.disabled);
			const handleKeyDown = (ev, currentIdx) => {
				if (!enabledOptions.length) return;
				const key = ev.key;
				let nextOpt;
				if (key === "ArrowRight" || key === "ArrowDown") {
					ev.preventDefault?.();
					for (let step = 1; step <= options.length; step++) {
						const cand = options[(currentIdx + step) % options.length];
						if (cand && !cand.disabled) {
							nextOpt = cand;
							break;
						}
					}
				} else if (key === "ArrowLeft" || key === "ArrowUp") {
					ev.preventDefault?.();
					for (let step = 1; step <= options.length; step++) {
						const cand = options[(currentIdx - step + options.length) % options.length];
						if (cand && !cand.disabled) {
							nextOpt = cand;
							break;
						}
					}
				} else if (key === "Home") {
					ev.preventDefault?.();
					nextOpt = enabledOptions[0];
				} else if (key === "End") {
					ev.preventDefault?.();
					nextOpt = enabledOptions[enabledOptions.length - 1];
				}
				if (nextOpt && nextOpt.value !== value) onChange(nextOpt.value);
			};
			return h$7("div", {
				role: "radiogroup",
				"aria-label": ariaLabel,
				style: S.segGroup
			}, ...options.map((opt, idx) => {
				const active = opt.value === value;
				return h$7("button", {
					key: opt.value,
					type: "button",
					role: "radio",
					"aria-checked": active,
					disabled: opt.disabled,
					tabIndex: active ? 0 : -1,
					className: "agy-tab",
					style: active ? {
						...S.segBtn,
						...S.segBtnActive
					} : S.segBtn,
					onClick: () => {
						if (!opt.disabled && opt.value !== value) onChange(opt.value);
					},
					onKeyDown: (ev) => handleKeyDown(ev, idx)
				}, opt.label);
			}));
		}
		function renderBadge(text, tone = "neutral") {
			const toneStyle = tone === "ok" ? S.badgeOk : tone === "warn" ? S.badgeWarn : tone === "danger" ? S.badgeDanger : tone === "info" ? S.badgeInfo : tone === "primary" ? S.badgePrimary : S.badgeNeutral;
			return h$7("span", { style: {
				...S.badgeBase,
				...toneStyle
			} }, text);
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
		function accountAddFlowView(addingAccount, poolAuthPhase) {
			const flowActive = addingAccount && (poolAuthPhase === "waiting" || poolAuthPhase === "exchanging");
			return {
				flowActive,
				showBrowserStart: !flowActive
			};
		}
		//#endregion
		//#region src/client/sections/AccountsSection.ts
		const { createElement: h$6 } = require("react");
		function maskEmail$5(email) {
			if (!email || typeof email !== "string") return "";
			const at = email.indexOf("@");
			if (at <= 2) return email;
			return `${email.slice(0, 2)}***${email.slice(at)}`;
		}
		function accountDisplayName$2(acc, idx) {
			const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
			if (acc.email) return isAutoAlias ? acc.email : acc.alias;
			return acc.alias || `账号 ${idx + 1}`;
		}
		function AccountsSection(props) {
			const { status, accounts, isBusy, addingAccount, aliasInput, manualCodeInput, editingProxyId, proxyInput, geminiAppEmailInput, geminiAppCookieInput, geminiAppBusy, onAliasInputChange, onManualCodeInputChange, onToggleAddingAccount, onBeginAddAccount, onCancelAddAccount, onSubmitManualCode, onSetPrimary, onSyncQuota, onClearCooldown, onRemoveAccount, onStartEditProxy, onCancelEditProxy, onProxyInputChange, onSaveProxy, onViewAccountModels, onGeminiAppEmailChange, onGeminiAppCookieChange, onAddGeminiAppAccount, onRemoveGeminiAppAccount } = props;
			const poolAuth = status?.poolAuth;
			const poolAuthPhase = poolAuth?.phase ?? "idle";
			const addFlow = accountAddFlowView(addingAccount, poolAuthPhase);
			const primaryId = status?.pool?.primaryAccountId;
			const geminiPool = status?.geminiAppPool ?? {
				total: 0,
				accounts: []
			};
			const addAccountSection = addingAccount ? h$6("div", {
				className: "agy-rise",
				style: S.authModal,
				role: "region",
				"aria-label": "添加 Google 账号"
			}, h$6("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: "var(--agy-space-2)",
				marginBottom: "var(--agy-space-2)"
			} }, h$6("span", { style: S.panelTitle }, "添加 Google 账号"), h$6("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSm,
				onClick: () => void onCancelAddAccount(),
				disabled: isBusy
			}, "取消")), poolAuthPhase === "failed" ? renderStrip("error", poolAuth?.message || "授权失败，请重试或手动粘贴授权码") : null, addFlow.flowActive ? h$6("div", { style: { marginBottom: "var(--agy-space-2)" } }, renderStrip("info", poolAuthPhase === "exchanging" ? "正在交换授权令牌，请稍候…" : poolAuth?.message || "请在打开的浏览器窗口中完成 Google 登录授权…"), poolAuth?.url ? h$6("div", { style: {
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-text-tertiary)",
				wordBreak: "break-all",
				marginTop: "4px"
			} }, "授权链接：", h$6("a", {
				href: poolAuth.url,
				target: "_blank",
				rel: "noreferrer",
				style: { color: "var(--agy-accent)" }
			}, poolAuth.url)) : null) : null, addFlow.showBrowserStart ? h$6("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				alignItems: "center",
				marginBottom: "var(--agy-space-2)"
			} }, h$6("input", {
				type: "text",
				style: {
					...S.input,
					flex: "1 1 180px"
				},
				placeholder: "账号别名（可选，如 主力号）",
				value: aliasInput,
				"aria-label": "新账号别名",
				onChange: (e) => onAliasInputChange(e.target.value)
			}), h$6("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnPrimary,
				onClick: () => void onBeginAddAccount(),
				disabled: isBusy
			}, uiIcon("plus", 12), " 打开浏览器登录")) : null, h$6("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				alignItems: "center",
				paddingTop: "var(--agy-space-2)",
				borderTop: "1px solid var(--agy-border-divider)"
			} }, h$6("input", {
				type: "text",
				style: {
					...S.input,
					flex: "1 1 240px"
				},
				placeholder: "或手动粘贴回调 URL / 授权码 (code=...)",
				value: manualCodeInput,
				"aria-label": "手动粘贴授权码",
				onChange: (e) => onManualCodeInputChange(e.target.value)
			}), h$6("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSmPrimary,
				onClick: () => void onSubmitManualCode(),
				disabled: isBusy || !manualCodeInput.trim()
			}, "提交授权码"))) : null;
			const renderedAccountCards = accounts.length === 0 ? [renderEmptyState("globe", "暂无 AGY 账号", "点击右上角「添加账号」完成 Google OAuth 授权即可接入。", !addingAccount ? h$6("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnPrimary,
				onClick: () => onToggleAddingAccount(true)
			}, uiIcon("plus", 12), " 添加账号") : void 0)] : accounts.map((acc, idx) => {
				const isPrimary = acc.id === primaryId;
				const hasCooldown = Object.values(acc.cooldowns ?? {}).some((cd) => {
					const until = cd?.cooldownUntil;
					return typeof until === "number" && until > Date.now();
				});
				const isAuthRequired = acc.authRequired === true;
				const isReady = acc.enabled && !isAuthRequired && !hasCooldown;
				const dotColor = !acc.enabled ? "var(--agy-text-tertiary)" : isAuthRequired ? "var(--agy-strong-danger)" : hasCooldown ? "var(--agy-strong-warn)" : isReady ? "var(--agy-strong-ok)" : "var(--agy-strong-warn)";
				const displayName = accountDisplayName$2(acc, idx);
				const quota = acc.quotas ?? {};
				const isEditingProxy = editingProxyId === acc.id;
				return h$6("div", {
					key: acc.id,
					className: "agy-card-hover agy-rise",
					style: isPrimary ? S.cardPrimary : S.card
				}, h$6("div", { style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap",
					marginBottom: "var(--agy-space-2)"
				} }, h$6("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, h$6("span", {
					"aria-hidden": "true",
					style: {
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						background: dotColor,
						display: "inline-block",
						flexShrink: 0
					}
				}), h$6("span", { style: {
					fontWeight: 600,
					fontSize: "var(--agy-font-md)",
					color: "var(--agy-text-primary)"
				} }, displayName), acc.email && displayName !== acc.email ? h$6("span", { style: S.muted }, maskEmail$5(acc.email)) : null, isPrimary ? renderBadge("主用", "primary") : null, isAuthRequired ? renderBadge("需重新授权", "danger") : !acc.enabled ? renderBadge("已禁用", "neutral") : hasCooldown ? renderBadge("冷却中", "warn") : isReady ? renderBadge("就绪", "ok") : renderBadge("未就绪", "warn"), acc.proxyUrl ? h$6("span", {
					className: "agy-num",
					style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)"
					}
				}, `代理: ${acc.proxyUrl}`) : null), h$6("div", { style: {
					display: "flex",
					gap: "var(--agy-space-1)",
					flexWrap: "wrap"
				} }, !isPrimary ? h$6("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => void onSetPrimary(acc.id),
					disabled: isBusy
				}, "设为主用") : null, h$6("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => void onSyncQuota(acc.id),
					disabled: isBusy
				}, uiIcon("refresh", 12), " 同步额度"), hasCooldown ? h$6("button", {
					type: "button",
					className: "agy-btn",
					style: {
						...S.btnSm,
						background: "var(--agy-warn-btn-bg)",
						color: "var(--agy-warn-btn-text)",
						border: "1px solid var(--agy-warn-btn-border)"
					},
					onClick: () => void onClearCooldown(acc.id),
					disabled: isBusy
				}, "清冷却") : null, h$6("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => isEditingProxy ? onCancelEditProxy() : onStartEditProxy(acc.id, acc.proxyUrl ?? ""),
					disabled: isBusy
				}, isEditingProxy ? "取消代理" : "编辑代理"), h$6("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSmPrimary,
					onClick: () => onViewAccountModels(acc.id),
					"aria-label": `查看 ${displayName} 的模型与配额`
				}, uiIcon("layers", 12), " 查看模型"), h$6("button", {
					type: "button",
					className: "agy-btn",
					style: {
						...S.btnSm,
						color: "var(--agy-danger-text)",
						borderColor: "var(--agy-danger-border)"
					},
					onClick: () => void onRemoveAccount(acc.id),
					disabled: isBusy
				}, "移除"))), isEditingProxy ? h$6("div", { style: {
					display: "flex",
					gap: "var(--agy-space-2)",
					alignItems: "center",
					flexWrap: "wrap",
					padding: "var(--agy-space-2)",
					marginBottom: "var(--agy-space-2)",
					background: "var(--agy-bg-subtle)",
					borderRadius: "var(--agy-radius-md)",
					border: "1px solid var(--agy-border-subtle)"
				} }, h$6("input", {
					type: "text",
					style: {
						...S.input,
						flex: "1 1 220px"
					},
					placeholder: "http://127.0.0.1:7890 或 socks5://...（留空清除）",
					value: proxyInput,
					"aria-label": `${displayName} 代理地址`,
					onChange: (e) => onProxyInputChange(e.target.value)
				}), h$6("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSmPrimary,
					onClick: () => void onSaveProxy(acc.id),
					disabled: isBusy
				}, "保存代理"), h$6("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSm,
					onClick: onCancelEditProxy
				}, "取消")) : null, h$6("div", { style: {
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					gap: "var(--agy-space-2)"
				} }, renderQuotaBar("Gemini", quota.google?.remainingFraction, quota.google?.resetTime), renderQuotaBar("Claude", quota.anthropic?.remainingFraction, quota.anthropic?.resetTime), renderQuotaBar("GPT-OSS", quota.openai?.remainingFraction, quota.openai?.resetTime)));
			});
			const geminiAppAccountsCard = h$6("div", {
				className: "agy-rise",
				style: {
					...S.card,
					marginTop: "var(--agy-space-3)"
				}
			}, h$6("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-2)"
			} }, h$6("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: "var(--agy-space-2)"
			} }, h$6("span", { style: S.panelTitle }, "Gemini App (Robin) 账号池"), h$6("span", {
				className: "agy-num",
				style: S.muted
			}, `已登录 ${geminiPool.total} 个账号`))), h$6("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				alignItems: "center",
				marginBottom: "var(--agy-space-2)"
			} }, h$6("input", {
				type: "text",
				style: {
					...S.input,
					flex: "1 1 180px"
				},
				placeholder: "账号邮箱 / 备注（可选）",
				value: geminiAppEmailInput,
				"aria-label": "Gemini App 账号邮箱",
				onChange: (e) => onGeminiAppEmailChange(e.target.value)
			}), h$6("input", {
				type: "password",
				style: {
					...S.input,
					flex: "2 1 260px"
				},
				placeholder: "粘贴 oauth_token、MasterToken (aas_et/...) 或 Access Token (ya29....)",
				value: geminiAppCookieInput,
				"aria-label": "Gemini App Cookie",
				onChange: (e) => onGeminiAppCookieChange(e.target.value)
			}), h$6("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSmPrimary,
				onClick: () => void onAddGeminiAppAccount(),
				disabled: geminiAppBusy || !geminiAppCookieInput.trim()
			}, uiIcon("plus", 12), " 添加账号")), geminiPool.accounts.length > 0 ? h$6("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: "var(--agy-space-1)"
			} }, ...geminiPool.accounts.map((ga) => h$6("div", {
				key: ga.id,
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					padding: "8px 10px",
					borderRadius: "var(--agy-radius-md)",
					background: "var(--agy-bg-subtle)",
					border: "1px solid var(--agy-border-subtle)"
				}
			}, h$6("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap"
			} }, h$6("span", { style: {
				fontWeight: 500,
				fontSize: "var(--agy-font-sm)",
				color: "var(--agy-text-primary)"
			} }, ga.email || ga.id), renderBadge(ga.status || "ready", ga.status === "ready" ? "ok" : "warn")), h$6("button", {
				type: "button",
				className: "agy-btn",
				style: {
					...S.btnSm,
					color: "var(--agy-danger-text)",
					borderColor: "var(--agy-danger-border)"
				},
				onClick: () => void onRemoveGeminiAppAccount(ga.id),
				disabled: geminiAppBusy
			}, "删除")))) : h$6("div", { style: {
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-text-tertiary)"
			} }, "暂无 Gemini App 账号，添加后可用于无工具任务双轨分流。"));
			return h$6("div", { className: "agy-rise" }, h$6("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-end",
				gap: "var(--agy-space-3)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-3)"
			} }, h$6("div", null, h$6("div", { style: {
				fontSize: "var(--agy-font-xs)",
				fontWeight: 600,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				color: "var(--agy-text-tertiary)",
				marginBottom: "2px"
			} }, "ACCOUNTS"), h$6("div", { style: S.panelTitle }, "账号池管理"), h$6("div", { style: {
				fontSize: "var(--agy-font-sm)",
				color: "var(--agy-text-secondary)",
				marginTop: "2px"
			} }, "管理 Google OAuth 主备账号、代理路由与 Gemini App 账号池")), !addingAccount ? h$6("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnPrimary,
				onClick: () => onToggleAddingAccount(true),
				disabled: isBusy
			}, uiIcon("plus", 12), " 添加账号") : null), addAccountSection, ...renderedAccountCards, geminiAppAccountsCard);
		}
		//#endregion
		//#region src/client/sections/ConfigSection.ts
		const { createElement: h$5, useState: useState$3, useCallback: useCallback$1 } = require("react");
		function ConfigSection(props) {
			const { status, isBusy, onSaveConfig, onNavigateModels } = props;
			const [cfgDrafts, setCfgDrafts] = useState$3({});
			const [geminiAppTokenInput, setGeminiAppTokenInput] = useState$3("");
			const hasToken = status?.hasGeminiAppToken === true;
			const handleSaveDraft = useCallback$1((key) => {
				const val = (cfgDrafts[key] ?? "").trim();
				onSaveConfig(key, val);
			}, [cfgDrafts, onSaveConfig]);
			const renderConfigRow = (key, label, hint, isLast = false) => {
				const draft = cfgDrafts[key] ?? "";
				return h$5("div", {
					key,
					style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						alignItems: "center",
						padding: "10px 0",
						borderBottom: isLast ? "none" : "1px solid var(--agy-border-divider)",
						flexWrap: "wrap"
					}
				}, h$5("div", { style: {
					width: "210px",
					flexShrink: 0
				} }, h$5("div", { style: {
					fontSize: "var(--agy-font-sm)",
					fontWeight: 700,
					color: "var(--agy-text-primary)"
				} }, label), h$5("div", { style: {
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-text-tertiary)",
					marginTop: "2px"
				} }, hint)), h$5("input", {
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
				}), h$5("button", {
					className: "agy-btn",
					style: S.btnSmPrimary,
					disabled: isBusy || key !== "baseUrl" && draft.trim() === "",
					onClick: () => handleSaveDraft(key)
				}, "保存"));
			};
			const renderSwitchRow = (key, title, subtitle, ariaLabel, onLabel = "已开启", offLabel = "已关闭", isLast = false) => {
				const checked = status?.[key] === true;
				return h$5("div", {
					key: String(key),
					style: {
						display: "flex",
						gap: "var(--agy-space-2)",
						alignItems: "center",
						padding: "10px 0",
						borderBottom: isLast ? "none" : "1px solid var(--agy-border-subtle)",
						flexWrap: "wrap"
					}
				}, h$5("div", { style: {
					width: "210px",
					flexShrink: 0
				} }, h$5("div", { style: {
					fontSize: "var(--agy-font-sm)",
					fontWeight: 700,
					color: "var(--agy-text-primary)"
				} }, title), h$5("div", { style: {
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-text-tertiary)",
					marginTop: "2px"
				} }, subtitle)), h$5("button", {
					className: "agy-btn",
					role: "switch",
					"aria-checked": checked,
					"aria-label": ariaLabel,
					style: {
						...S.btnSm,
						background: checked ? "var(--agy-accent)" : "var(--agy-bg-btn)",
						color: checked ? "var(--agy-on-accent)" : "var(--agy-text-btn)",
						border: `1px solid ${checked ? "var(--agy-border-btn-primary)" : "var(--agy-border-btn)"}`,
						transition: "background 160ms ease, color 160ms ease, border-color 160ms ease"
					},
					disabled: isBusy,
					onClick: () => void onSaveConfig(String(key), !checked)
				}, checked ? onLabel : offLabel));
			};
			return h$5("div", null, h$5("div", {
				className: "agy-rise",
				role: "note",
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "var(--agy-space-2)",
					padding: "10px var(--agy-space-3)",
					borderRadius: "var(--agy-radius-md)",
					background: "var(--agy-info-bg)",
					border: "1px solid var(--agy-info-border)",
					color: "var(--agy-info-text)",
					fontSize: "var(--agy-font-sm)",
					marginBottom: "var(--agy-space-3)",
					flexWrap: "wrap"
				}
			}, h$5("span", null, "默认模型与推理强度已整合至「模型」页，可直接在模型目录中一键切换。"), onNavigateModels ? h$5("button", {
				className: "agy-btn",
				style: S.btnSm,
				onClick: onNavigateModels,
				"aria-label": "前往模型页设置默认模型与推理强度"
			}, uiIcon("layers", 12), " 前往「模型」页") : null), h$5("div", {
				className: "agy-rise",
				style: S.card
			}, h$5("div", { style: {
				...S.panelCaption,
				marginBottom: "var(--agy-space-1)"
			} }, "基础连接与工具（POST /config）"), renderConfigRow("baseUrl", "上游地址 (baseUrl)", "高级：仅在你明确需要切换上游时填写"), renderSwitchRow("askTool", "Ask 工具注册 (askTool)", "在 DSH 中注册 agy ask 工具开关", "切换 Ask 工具注册", "已注册", "未注册", true)), h$5("div", {
				className: "agy-rise",
				style: {
					...S.card,
					marginTop: "var(--agy-space-3)"
				}
			}, h$5("div", { style: {
				...S.panelCaption,
				marginBottom: "var(--agy-space-1)"
			} }, "Gemini App (Robin) 双轨分流"), renderSwitchRow("geminiAppOffloadEnabled", "无关工具任务分流至 Gemini App", "启用后将无工具调用请求自动分流至 Gemini App API（并同步启用 geminiAppEnabled）", "切换无关工具任务分流至 Gemini App"), renderSwitchRow("geminiAppAskToolEnabled", "专家委派工具 (expert_ask)", "在主 Agent 会话中注册 expert_ask 工具并启用“脑手分离”委派规则，将思考、编码、审查、写作与推理任务交给 Robin API", "切换专家委派工具 expert_ask"), renderSwitchRow("geminiAppFreshSessionSingleTurn", "小上下文单轮裁剪", "开启后在上下文较小时仅保留 system 与最后一条 user 消息起新会话", "切换小上下文单轮裁剪"), renderSwitchRow("geminiAppOffloadFallbackToAgy", "失败自动回退 AGY", "Gemini App 首包前失败时自动无缝回退至 AGY 账号池", "切换失败自动回退 AGY"), h$5("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				alignItems: "center",
				padding: "10px 0",
				flexWrap: "wrap"
			} }, h$5("div", { style: {
				width: "210px",
				flexShrink: 0
			} }, h$5("div", { style: {
				fontSize: "var(--agy-font-sm)",
				fontWeight: 700,
				color: "var(--agy-text-primary)"
			} }, "Gemini App Token"), h$5("div", { style: {
				fontSize: "var(--agy-font-xs)",
				color: hasToken ? "var(--agy-strong-ok)" : "var(--agy-text-tertiary)",
				marginTop: "2px"
			} }, hasToken ? "状态：已配置（已脱敏）" : "状态：未配置")), h$5("input", {
				type: "password",
				className: "agy-input",
				value: geminiAppTokenInput,
				placeholder: hasToken ? "已配置（输入新 Token 可覆盖）" : "粘贴 ya29.m.* Assistant OAuth Token",
				"aria-label": "Gemini App Token",
				style: {
					...S.input,
					flex: "1 1 240px",
					minWidth: "200px"
				},
				onChange: (e) => setGeminiAppTokenInput(e.target.value)
			}), h$5("button", {
				className: "agy-btn",
				style: S.btnSmPrimary,
				disabled: isBusy || geminiAppTokenInput.trim() === "",
				onClick: () => {
					const val = geminiAppTokenInput.trim();
					onSaveConfig("geminiAppToken", val).then((ok) => {
						if (ok === true) setGeminiAppTokenInput("");
					});
				}
			}, hasToken ? "更新" : "保存"), hasToken ? h$5("button", {
				className: "agy-btn",
				style: S.btnSm,
				disabled: isBusy,
				"aria-label": "清除 Gemini App Token",
				onClick: () => {
					onSaveConfig("geminiAppToken", "").then((ok) => {
						if (ok === true) setGeminiAppTokenInput("");
					});
				}
			}, "清除") : null)));
		}
		//#endregion
		//#region src/client/sections/DiagnosticsSection.ts
		const { createElement: h$4 } = require("react");
		const win$2 = globalThis;
		function formatNumber$1(n) {
			return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
		}
		function formatClock$2(ms) {
			if (!ms) return "—";
			try {
				return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
			} catch {
				return "—";
			}
		}
		function maskEmail$4(email) {
			if (!email) return "";
			const at = email.indexOf("@");
			if (at <= 1) return email;
			const local = email.slice(0, at);
			const domain = email.slice(at + 1);
			return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
		}
		function DiagnosticsSection(props) {
			const { status, pollOk, lastUpdatedAt, poolAuthPhase, isBusy, onRefresh } = props;
			const catalog = status?.catalog ?? {};
			const lastRun = status?.lastRun ?? {};
			const endpointErrors = Array.isArray(catalog.endpointErrors) ? catalog.endpointErrors.length : 0;
			const accounts = status?.pool?.accounts ?? [];
			const primaryId = status?.pool?.primaryAccountId;
			const primaryAcc = accounts.find((a) => a.id === primaryId);
			const primaryLabel = primaryAcc ? maskEmail$4(primaryAcc.email) || primaryAcc.alias || primaryAcc.id : primaryId ?? "未设置";
			const origin = win$2.location?.origin ?? "";
			const renderDiagRow = (label, value, mono = true, isLast = false) => h$4("div", { style: {
				display: "flex",
				gap: "var(--agy-space-3)",
				padding: "8px 0",
				borderBottom: isLast ? "none" : "1px solid var(--agy-border-divider)",
				flexWrap: "wrap"
			} }, h$4("span", { style: {
				width: "170px",
				color: "var(--agy-text-tertiary)",
				fontSize: "var(--agy-font-sm)",
				flexShrink: 0
			} }, label), h$4("span", {
				className: mono ? "agy-num" : void 0,
				style: {
					color: "var(--agy-text-primary)",
					fontSize: "var(--agy-font-sm)",
					wordBreak: "break-all",
					flex: 1,
					fontVariantNumeric: mono ? "tabular-nums" : void 0
				}
			}, value));
			return h$4("div", null, !pollOk ? renderStrip("warn", `轮询中断：以下为 ${formatClock$2(lastUpdatedAt)} 的最后一次成功拉取`) : null, h$4("div", {
				className: "agy-rise",
				style: S.card
			}, renderDiagRow("运行状态", status ? status.enabled === false ? "已停用" : "运行中" : "未加载", false), renderDiagRow("插件版本", status?.version ?? "未上报"), renderDiagRow("休眠原因", status?.dormantReason ?? "无", false), renderDiagRow("主用账号", primaryLabel, false), renderDiagRow("默认模型 / 强度", `${status?.defaultModel ?? "未配置"}${status?.defaultEffort ? ` (${status.defaultEffort})` : ""}`), renderDiagRow("构建校验 (distSha256)", status?.distSha256 ? `${String(status.distSha256).slice(0, 16)}…` : "未上报"), renderDiagRow("上游目录", `${catalog.source ?? "—"} · ${formatNumber$1(catalog.count ?? 0)} 个模型${endpointErrors > 0 ? ` · ${endpointErrors} 条端点错误` : ""}`, false), renderDiagRow("目录最近错误", catalog.lastError ?? "无", false), renderDiagRow("最近一次运行", lastRun.ok === void 0 ? "无记录" : `${lastRun.ok ? "成功" : `失败 (code ${lastRun.code ?? "—"})`} · ${lastRun.durationMs ?? "—"}ms · ${lastRun.model ?? "—"}`, false), renderDiagRow("授权阶段", `auth: ${status?.auth?.phase ?? "—"} · poolAuth: ${poolAuthPhase}`, false), renderDiagRow("工作区", status?.workspaceRoot ?? "未上报"), renderDiagRow("数据通道与轮询周期", `${origin || "同源"}${API_PREFIX} · 3s 状态轮询 / 10s 统计轮询`, true, true)), h$4("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				marginTop: "var(--agy-space-3)"
			} }, h$4("button", {
				className: "agy-btn",
				style: S.btnSmPrimary,
				onClick: () => void onRefresh(),
				disabled: isBusy,
				"aria-label": "立即刷新状态"
			}, uiIcon("refresh", 12), " 立即刷新状态")));
		}
		//#endregion
		//#region src/client/sections/ModelsSection.ts
		const { createElement: h$3, useState: useState$2, useEffect: useEffect$2 } = require("react");
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
		const EFFORT_PRESETS = [
			"low",
			"medium",
			"high",
			"xhigh"
		];
		function maskEmail$3(email) {
			if (!email || typeof email !== "string") return "";
			const at = email.indexOf("@");
			if (at <= 2) return email;
			return `${email.slice(0, 2)}***${email.slice(at)}`;
		}
		function accountDisplayName$1(acc, idx) {
			const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
			if (acc.email) return isAutoAlias ? acc.email : acc.alias;
			return acc.alias || `账号 ${idx + 1}`;
		}
		function collectUnionModels(panels, accounts) {
			const map = /* @__PURE__ */ new Map();
			for (const acc of accounts) {
				const { payload } = selectPanelPayload(panels[acc.id], acc);
				for (const group of payload.familyModels) for (const m of group.models) if (!map.has(m.id)) map.set(m.id, {
					id: m.id,
					name: m.name || m.id,
					family: m.family
				});
			}
			return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
		}
		function renderSkeletonRow$1(widthPct, height = 14) {
			return h$3("div", { style: {
				width: `${widthPct}%`,
				height: `${height}px`,
				borderRadius: "var(--agy-radius-sm)",
				background: "var(--agy-bg-subtle)",
				marginBottom: "8px"
			} });
		}
		function ModelsSection(props) {
			const { status, accounts, modelPanels, expandedModels, modelQueries, familyFilters, isBusy, onToggleExpand, onQueryChange, onFamilyFilterChange, onLoadModelsPanel, onRefreshModelsPanel, onSaveConfig } = props;
			const currentDefaultModel = status?.defaultModel ?? "";
			const currentDefaultEffort = status?.defaultEffort ?? "";
			const [modelDraft, setModelDraft] = useState$2(currentDefaultModel);
			const [effortDraft, setEffortDraft] = useState$2(currentDefaultEffort);
			const [savingModel, setSavingModel] = useState$2(false);
			const [savingEffort, setSavingEffort] = useState$2(false);
			const [modelFeedback, setModelFeedback] = useState$2(null);
			const [effortFeedback, setEffortFeedback] = useState$2(null);
			const [globalQuery, setGlobalQuery] = useState$2("");
			const [globalFamily, setGlobalFamily] = useState$2("all");
			useEffect$2(() => {
				if (currentDefaultModel && !modelDraft) setModelDraft(currentDefaultModel);
			}, [currentDefaultModel]);
			useEffect$2(() => {
				if (currentDefaultEffort && !effortDraft) setEffortDraft(currentDefaultEffort);
			}, [currentDefaultEffort]);
			const unionModels = collectUnionModels(modelPanels, accounts);
			const modelUnionTotal = computeModelUnion(modelPanels, accounts);
			const primaryId = status?.pool?.primaryAccountId;
			const handleSaveModel = async (nextModel) => {
				const trimmed = nextModel.trim();
				if (!trimmed) return;
				setSavingModel(true);
				setModelFeedback(null);
				try {
					if (await onSaveConfig("defaultModel", trimmed)) {
						setModelDraft(trimmed);
						setModelFeedback(`已保存默认模型：${trimmed}`);
					} else setModelFeedback("保存失败，请检查网络或配置");
				} catch (err) {
					setModelFeedback(`保存失败：${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setSavingModel(false);
				}
			};
			const handleSaveEffort = async (nextEffort) => {
				const trimmed = nextEffort.trim();
				if (!trimmed) return;
				setSavingEffort(true);
				setEffortFeedback(null);
				try {
					if (await onSaveConfig("defaultEffort", trimmed)) {
						setEffortDraft(trimmed);
						setEffortFeedback(`已保存推理强度：${trimmed}`);
					} else setEffortFeedback("保存失败，请检查网络或配置");
				} catch (err) {
					setEffortFeedback(`保存失败：${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setSavingEffort(false);
				}
			};
			const isPresetEffort = EFFORT_PRESETS.includes(effortDraft);
			const defaultConfigCard = h$3("div", {
				className: "agy-rise",
				style: {
					...S.card,
					marginBottom: "var(--agy-space-4)"
				},
				role: "region",
				"aria-label": "默认模型与推理配置"
			}, h$3("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-3)"
			} }, h$3("div", null, h$3("div", { style: S.panelCaption }, "默认模型与推理配置"), h$3("div", { style: {
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-text-tertiary)",
				marginTop: "2px"
			} }, "写入插件配置（POST /config），新会话与未显式指定模型的请求将使用此默认值")), h$3("div", { style: {
				display: "flex",
				gap: "var(--agy-space-1)",
				flexWrap: "wrap"
			} }, currentDefaultModel ? renderBadge(`当前模型: ${currentDefaultModel}`, "primary") : renderBadge("未设置默认模型", "warn"), currentDefaultEffort ? renderBadge(`Effort: ${currentDefaultEffort}`, "info") : null)), h$3("div", { style: {
				paddingBottom: "var(--agy-space-3)",
				marginBottom: "var(--agy-space-3)",
				borderBottom: "1px solid var(--agy-border-divider)"
			} }, h$3("div", { style: {
				fontSize: "var(--agy-font-sm)",
				fontWeight: 600,
				color: "var(--agy-text-primary)",
				marginBottom: "6px"
			} }, "默认模型 (defaultModel)"), h$3("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				alignItems: "center"
			} }, unionModels.length > 0 ? h$3("select", {
				style: {
					...S.input,
					flex: "1 1 220px",
					cursor: "pointer"
				},
				value: unionModels.some((m) => m.id === modelDraft) ? modelDraft : "",
				"aria-label": "从已发现模型中选择默认模型",
				onChange: (e) => {
					if (e.target.value) setModelDraft(e.target.value);
				}
			}, h$3("option", { value: "" }, `从已发现并集选择 (${unionModels.length} 个)…`), ...unionModels.map((m) => h$3("option", {
				key: m.id,
				value: m.id
			}, `${m.id}${m.name && m.name !== m.id ? ` (${m.name})` : ""}`))) : null, h$3("input", {
				type: "text",
				style: {
					...S.input,
					flex: "1 1 220px"
				},
				placeholder: currentDefaultModel || "输入任意模型 ID，如 claude-sonnet-4-5",
				value: modelDraft,
				"aria-label": "自定义默认模型 ID",
				onChange: (e) => setModelDraft(e.target.value)
			}), h$3("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnPrimary,
				disabled: isBusy || savingModel || !modelDraft.trim(),
				onClick: () => void handleSaveModel(modelDraft)
			}, savingModel ? "保存中…" : "保存模型")), modelFeedback ? h$3("div", {
				role: "status",
				style: {
					fontSize: "var(--agy-font-xs)",
					color: modelFeedback.startsWith("保存失败") ? "var(--agy-danger-text)" : "var(--agy-ok-text)",
					marginTop: "6px"
				}
			}, modelFeedback) : null), h$3("div", null, h$3("div", { style: {
				fontSize: "var(--agy-font-sm)",
				fontWeight: 600,
				color: "var(--agy-text-primary)",
				marginBottom: "6px"
			} }, "默认推理强度 (defaultEffort)"), h$3("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				alignItems: "center"
			} }, renderSegmentedControl(EFFORT_PRESETS.map((lvl) => ({
				value: lvl,
				label: lvl
			})), isPresetEffort ? effortDraft : "", (next) => {
				setEffortDraft(next);
				handleSaveEffort(next);
			}, "默认推理强度预设"), h$3("input", {
				type: "text",
				style: {
					...S.input,
					flex: "1 1 160px",
					maxWidth: "220px"
				},
				placeholder: currentDefaultEffort || "自定义 effort 值",
				value: effortDraft,
				"aria-label": "自定义推理强度",
				onChange: (e) => setEffortDraft(e.target.value)
			}), h$3("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSm,
				disabled: isBusy || savingEffort || !effortDraft.trim(),
				onClick: () => void handleSaveEffort(effortDraft)
			}, savingEffort ? "保存中…" : "保存")), effortFeedback ? h$3("div", {
				role: "status",
				style: {
					fontSize: "var(--agy-font-xs)",
					color: effortFeedback.startsWith("保存失败") ? "var(--agy-danger-text)" : "var(--agy-ok-text)",
					marginTop: "6px"
				}
			}, effortFeedback) : null));
			const renderModelPanel = (acc, idx) => {
				const panel = modelPanels[acc.id] ?? EMPTY_PANEL;
				const expanded = !!expandedModels[acc.id];
				const { payload, usingFallback } = selectPanelPayload(panel, acc);
				const displayName = accountDisplayName$1(acc, idx);
				const isPrimary = acc.id === primaryId;
				const ids = payload.familyModels.flatMap((g) => g.models.map((m) => m.id));
				const ownIdSet = new Set(ids);
				const others = computeOtherAccountModelIds(modelPanels, accounts, acc.id);
				const uniqueToThisCount = accounts.length > 1 ? ids.filter((id) => !others.has(id)).length : 0;
				const effectiveQuery = (modelQueries[acc.id] ?? globalQuery).trim().toLowerCase();
				const effectiveFamily = familyFilters[acc.id] ?? globalFamily;
				const filteredGroups = payload.familyModels.filter((g) => effectiveFamily === "all" || g.family === effectiveFamily).map((g) => ({
					...g,
					models: g.models.filter((m) => {
						if (!effectiveQuery) return true;
						return m.id.toLowerCase().includes(effectiveQuery) || m.name && m.name.toLowerCase().includes(effectiveQuery);
					})
				})).filter((g) => g.models.length > 0);
				const statusStrips = [];
				if (panel.status === "error" && panel.error) statusStrips.push(renderStrip("error", `模型端点不可用：${panel.error}（${panel.payload ? "下方为最近一次成功发现的模型数据，失败不会清空" : "下方为最近一次额度同步的兜底模型数据"}）`, () => void onLoadModelsPanel(acc.id)));
				if (panel.refreshError) statusStrips.push(renderStrip("warn", `刷新失败：${panel.refreshError} · 已保留旧模型数据`));
				const renderModelRow = (m) => {
					const isUnique = accounts.length > 1 && !others.has(m.id);
					const pct = typeof m.remainingFraction === "number" && Number.isFinite(m.remainingFraction) ? Math.max(0, Math.min(100, Math.round(m.remainingFraction * 100))) : null;
					const win = formatQuotaWindow(m.resetTime);
					const barColor = pct === null ? "var(--agy-text-tertiary)" : pct >= 50 ? "var(--agy-strong-ok)" : pct >= 20 ? "var(--agy-strong-warn)" : "var(--agy-strong-danger)";
					return h$3("div", {
						key: m.id,
						style: {
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							gap: "var(--agy-space-2)",
							flexWrap: "wrap",
							padding: "8px 10px",
							borderRadius: "var(--agy-radius-md)",
							background: isUnique ? "var(--agy-tint-primary)" : "var(--agy-bg-subtle)",
							border: isUnique ? "1px solid var(--agy-accent-border)" : "1px solid var(--agy-border-subtle)"
						}
					}, h$3("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "var(--agy-space-2)",
						flexWrap: "wrap",
						minWidth: "200px",
						flex: "1 1 240px"
					} }, h$3("span", {
						className: "agy-num",
						style: {
							fontWeight: 600,
							fontSize: "var(--agy-font-sm)",
							color: "var(--agy-text-primary)"
						}
					}, m.id), m.name && m.name !== m.id ? h$3("span", { style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)"
					} }, m.name) : null, isUnique ? renderBadge("仅此账号", "primary") : null), h$3("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "var(--agy-space-2)",
						minWidth: "160px"
					} }, pct !== null ? h$3("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						width: "140px"
					} }, h$3("div", { style: {
						...S.progressBarBg,
						flex: 1
					} }, h$3("div", { style: {
						width: `${pct}%`,
						height: "100%",
						background: barColor,
						borderRadius: "inherit",
						transition: "width 240ms ease"
					} })), h$3("span", {
						className: "agy-num",
						style: {
							fontSize: "var(--agy-font-xs)",
							color: "var(--agy-text-secondary)",
							width: "36px",
							textAlign: "right"
						}
					}, `${pct}%`)) : h$3("span", { style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)"
					} }, "无配额数据"), win.resetText ? h$3("span", {
						className: "agy-num",
						style: {
							fontSize: "var(--agy-font-xs)",
							color: "var(--agy-text-tertiary)"
						}
					}, win.resetText) : null));
				};
				const panelBody = !expanded ? null : panel.status === "loading" && !panel.payload ? h$3("div", {
					id: modelsPanelDomId(acc.id),
					role: "region",
					"aria-label": `${displayName} 的模型清单`,
					style: { paddingTop: "var(--agy-space-2)" }
				}, renderSkeletonRow$1(70, 16), renderSkeletonRow$1(85), renderSkeletonRow$1(55)) : h$3("div", {
					id: modelsPanelDomId(acc.id),
					role: "region",
					"aria-label": `${displayName} 的模型清单`,
					style: { paddingTop: "var(--agy-space-2)" }
				}, ...statusStrips, h$3("div", { style: {
					display: "flex",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap",
					alignItems: "center",
					marginBottom: "var(--agy-space-2)"
				} }, h$3("input", {
					type: "text",
					style: {
						...S.input,
						flex: "1 1 180px"
					},
					placeholder: "搜索此账号模型 ID / 名称…",
					value: modelQueries[acc.id] ?? "",
					"aria-label": `搜索 ${displayName} 的模型`,
					onChange: (e) => onQueryChange(acc.id, e.target.value)
				}), h$3("div", { style: {
					display: "flex",
					gap: "4px",
					flexWrap: "wrap"
				} }, [
					"all",
					"google",
					"anthropic",
					"openai",
					"unknown"
				].map((fam) => {
					return h$3("button", {
						key: fam,
						type: "button",
						className: "agy-btn",
						style: effectiveFamily === fam ? S.btnSmPrimary : S.btnSm,
						onClick: () => onFamilyFilterChange(acc.id, fam)
					}, fam === "all" ? "全部" : FAMILY_LABEL[fam]);
				}))), filteredGroups.length === 0 ? h$3("div", { style: {
					fontSize: "var(--agy-font-sm)",
					color: "var(--agy-text-tertiary)",
					padding: "var(--agy-space-2) 0"
				} }, ownIdSet.size === 0 ? "暂无已发现模型，可点击「刷新发现模型」拉取。" : "没有匹配当前筛选条件的模型。") : h$3("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: "var(--agy-space-3)"
				} }, ...filteredGroups.map((group) => h$3("div", { key: group.family }, h$3("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "6px",
					marginBottom: "6px"
				} }, group.family !== "unknown" ? brandIcon(FAMILY_BRAND[group.family], 13) : null, h$3("span", { style: {
					fontSize: "var(--agy-font-xs)",
					fontWeight: 600,
					color: "var(--agy-text-secondary)"
				} }, FAMILY_LABEL[group.family]), h$3("span", {
					className: "agy-num",
					style: {
						fontSize: "var(--agy-font-xs)",
						color: "var(--agy-text-tertiary)"
					}
				}, `(${group.models.length})`)), h$3("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: "6px"
				} }, ...group.models.map(renderModelRow))))));
				return h$3("div", {
					key: acc.id,
					className: "agy-card-hover agy-rise",
					style: isPrimary ? S.cardPrimary : S.card
				}, h$3("div", { style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, h$3("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, h$3("span", { style: {
					fontWeight: 600,
					fontSize: "var(--agy-font-md)",
					color: "var(--agy-text-primary)"
				} }, displayName), acc.email && displayName !== acc.email ? h$3("span", { style: S.muted }, maskEmail$3(acc.email)) : null, isPrimary ? renderBadge("主用", "primary") : null, h$3("span", {
					className: "agy-num",
					style: S.muted
				}, `${ownIdSet.size} 个模型`), usingFallback ? renderBadge("额度兜底", "warn") : renderBadge("API 发现", "ok"), uniqueToThisCount > 0 ? renderBadge(`独有 ${uniqueToThisCount}`, "info") : null), h$3("div", { style: {
					display: "flex",
					gap: "var(--agy-space-1)",
					flexWrap: "wrap"
				} }, h$3("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSm,
					disabled: isBusy || panel.status === "loading",
					onClick: () => void onRefreshModelsPanel(acc.id),
					"aria-label": `刷新 ${displayName} 的发现模型`
				}, uiIcon("refresh", 12), panel.status === "loading" ? " 刷新中…" : " 刷新发现模型"), h$3("button", {
					type: "button",
					className: "agy-btn",
					style: expanded ? S.btnSmPrimary : S.btnSm,
					"aria-expanded": expanded,
					"aria-controls": modelsPanelDomId(acc.id),
					onClick: () => onToggleExpand(acc.id)
				}, expanded ? "收起" : "展开模型"))), panelBody);
			};
			return h$3("div", { className: "agy-rise" }, h$3("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-end",
				gap: "var(--agy-space-3)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-3)"
			} }, h$3("div", null, h$3("div", { style: {
				fontSize: "var(--agy-font-xs)",
				fontWeight: 600,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				color: "var(--agy-text-tertiary)",
				marginBottom: "2px"
			} }, "MODELS & ROUTING"), h$3("div", { style: S.panelTitle }, "模型与默认配置"), h$3("div", { style: {
				fontSize: "var(--agy-font-sm)",
				color: "var(--agy-text-secondary)",
				marginTop: "2px"
			} }, "统一管理默认模型、推理强度与各账号实时发现的模型配额"))), defaultConfigCard, h$3("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-2)"
			} }, h$3("span", { style: S.panelCaption }, "账号模型目录与配额"), h$3("span", {
				className: "agy-num",
				style: {
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-text-tertiary)"
				}
			}, `已发现模型并集 ${modelUnionTotal} 个 · 灰度差异以并集为基准`)), accounts.length > 0 ? h$3("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				alignItems: "center",
				marginBottom: "var(--agy-space-3)"
			} }, h$3("input", {
				type: "text",
				style: {
					...S.input,
					flex: "1 1 220px"
				},
				placeholder: "全局搜索模型 ID / 名称…",
				value: globalQuery,
				"aria-label": "全局搜索模型",
				onChange: (e) => setGlobalQuery(e.target.value)
			}), h$3("div", { style: {
				display: "flex",
				gap: "4px",
				flexWrap: "wrap"
			} }, [
				"all",
				"google",
				"anthropic",
				"openai",
				"unknown"
			].map((fam) => {
				return h$3("button", {
					key: fam,
					type: "button",
					className: "agy-btn",
					style: globalFamily === fam ? S.btnSmPrimary : S.btnSm,
					onClick: () => setGlobalFamily(fam)
				}, fam === "all" ? "全部家族" : FAMILY_LABEL[fam]);
			}))) : null, accounts.length === 0 ? renderEmptyState("layers", "暂无账号模型数据", "请先在「账号」页添加至少一个 Google 账号。") : h$3("div", null, ...accounts.map((acc, idx) => renderModelPanel(acc, idx))));
		}
		//#endregion
		//#region src/client/sections/OverviewSection.ts
		const { createElement: h$2 } = require("react");
		function maskEmail$2(email) {
			if (!email || typeof email !== "string") return "";
			const at = email.indexOf("@");
			if (at <= 2) return email;
			return `${email.slice(0, 2)}***${email.slice(at)}`;
		}
		function formatClock$1(ms) {
			if (!ms) return "—";
			try {
				return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
			} catch {
				return "—";
			}
		}
		function accountDisplayName(acc, idx) {
			const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias);
			if (acc.email) return isAutoAlias ? acc.email : acc.alias;
			return acc.alias || `账号 ${idx + 1}`;
		}
		function OverviewSection(props) {
			const { status, accounts, pollOk, lastUpdatedAt, onNavigate, onBeginAddAccount, onRefreshStatus } = props;
			if (accounts.length === 0 && !status) return renderEmptyState("refresh", "插件状态还在加载中", "正在连接 CloudCode Link 后端服务…");
			if (accounts.length === 0) return renderEmptyState("plus", "还没有添加任何账号", "添加第一个 Google 账号后即可开始使用模型配额与路由。", h$2("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnPrimary,
				onClick: onBeginAddAccount
			}, uiIcon("plus", 12), " 添加第一个账号"));
			const dormant = status?.dormantReason;
			const primaryId = status?.pool?.primaryAccountId;
			const primaryAcc = accounts.find((a) => a.id === primaryId) ?? accounts[0];
			const primaryLabel = primaryAcc ? primaryAcc.email ? maskEmail$2(primaryAcc.email) : primaryAcc.alias || primaryAcc.id : "未指定";
			const readyCount = accounts.filter((a) => {
				const inCooldown = Object.values(a.cooldowns ?? {}).some((cd) => {
					const until = cd?.cooldownUntil;
					return typeof until === "number" && until > Date.now();
				});
				return a.enabled && !a.authRequired && !inCooldown;
			}).length;
			const cooldownCount = accounts.filter((a) => Object.values(a.cooldowns ?? {}).some((cd) => {
				const until = cd?.cooldownUntil;
				return typeof until === "number" && until > Date.now();
			})).length;
			const lastRun = status?.lastRun;
			const lastRunValue = lastRun ? lastRun.ok ? "成功" : "失败" : "暂无";
			const lastRunSub = lastRun?.durationMs != null ? `${lastRun.durationMs} ms${lastRun.model ? ` · ${lastRun.model}` : ""}` : lastRun?.model || "等待首次调用";
			return h$2("div", { className: "agy-rise" }, h$2("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-end",
				gap: "var(--agy-space-3)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-3)"
			} }, h$2("div", null, h$2("div", { style: {
				fontSize: "var(--agy-font-xs)",
				fontWeight: 600,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				color: "var(--agy-text-tertiary)",
				marginBottom: "2px"
			} }, "OVERVIEW"), h$2("div", { style: S.panelTitle }, "运行总览"), h$2("div", { style: {
				fontSize: "var(--agy-font-sm)",
				color: "var(--agy-text-secondary)",
				marginTop: "2px"
			} }, "账号池健康度、配额水位与当前默认路由")), h$2("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap"
			} }, h$2("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSm,
				onClick: () => onNavigate("accounts")
			}, uiIcon("globe", 12), " 管理账号"), h$2("button", {
				type: "button",
				className: "agy-btn",
				style: S.btnSmPrimary,
				onClick: () => onNavigate("models")
			}, uiIcon("layers", 12), " 模型与默认配置"))), dormant ? renderStrip("warn", `插件处于休眠状态：${dormant}`) : null, !pollOk ? renderStrip("warn", `轮询中断：页面展示的是 ${formatClock$1(lastUpdatedAt)} 拉取的最后一次数据`, onRefreshStatus) : null, status?.catalog?.lastError ? renderStrip("warn", `模型目录同步告警：${status.catalog.lastError}`) : null, h$2("div", { style: {
				display: "flex",
				gap: "var(--agy-space-3)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-4)"
			} }, renderKpiCard("可用账号", `${readyCount} / ${accounts.length}`, cooldownCount > 0 ? `主用：${primaryLabel} · ${cooldownCount} 个冷却中` : `主用：${primaryLabel}`, readyCount > 0 ? "var(--agy-strong-ok)" : "var(--agy-strong-warn)"), renderKpiCard("默认模型", status?.defaultModel || "未设置", `推理强度：${status?.defaultEffort || "默认"}`), renderKpiCard("模型目录", `${status?.catalog?.count ?? 0} 个`, `来源：${status?.catalog?.source || "—"}`), renderKpiCard("最近请求", lastRunValue, lastRunSub, lastRun ? lastRun.ok ? "var(--agy-strong-ok)" : "var(--agy-strong-danger)" : void 0)), h$2("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginBottom: "var(--agy-space-2)"
			} }, h$2("span", { style: S.panelCaption }, "账号配额水位"), h$2("span", {
				className: "agy-num",
				style: {
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-text-tertiary)"
				}
			}, `共 ${accounts.length} 个账号 · 更新于 ${formatClock$1(lastUpdatedAt)}`)), ...accounts.map((acc, idx) => {
				const isPrimary = acc.id === primaryId;
				const hasCooldown = Object.values(acc.cooldowns ?? {}).some((cd) => {
					const until = cd?.cooldownUntil;
					return typeof until === "number" && until > Date.now();
				});
				const isAuthRequired = acc.authRequired === true;
				const isReady = acc.enabled && !isAuthRequired && !hasCooldown;
				const displayName = accountDisplayName(acc, idx);
				const quota = acc.quotas ?? {};
				return h$2("div", {
					key: acc.id,
					className: "agy-card-hover",
					style: isPrimary ? S.cardPrimary : S.card
				}, h$2("div", { style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap",
					marginBottom: "var(--agy-space-2)"
				} }, h$2("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, h$2("span", { style: {
					fontWeight: 600,
					fontSize: "var(--agy-font-md)",
					color: "var(--agy-text-primary)"
				} }, displayName), acc.email && displayName !== acc.email ? h$2("span", { style: S.muted }, maskEmail$2(acc.email)) : null, isPrimary ? renderBadge("主用", "primary") : null, isAuthRequired ? renderBadge("需重新授权", "danger") : !acc.enabled ? renderBadge("已禁用", "neutral") : hasCooldown ? renderBadge("冷却中", "warn") : isReady ? renderBadge("就绪", "ok") : renderBadge("未就绪", "warn")), h$2("button", {
					type: "button",
					className: "agy-btn",
					style: S.btnSm,
					onClick: () => onNavigate("models"),
					"aria-label": `查看 ${displayName} 的模型与配额`
				}, uiIcon("layers", 12), " 查看模型")), h$2("div", { style: {
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					gap: "var(--agy-space-2)"
				} }, renderQuotaBar("Gemini", quota.google?.remainingFraction, quota.google?.resetTime), renderQuotaBar("Claude", quota.anthropic?.remainingFraction, quota.anthropic?.resetTime), renderQuotaBar("GPT-OSS", quota.openai?.remainingFraction, quota.openai?.resetTime)));
			}));
		}
		//#endregion
		//#region src/client/sections/UsageSection.ts
		const { createElement: h$1, useState: useState$1, useEffect: useEffect$1, useCallback } = require("react");
		const reactDom = require("react-dom");
		const win$1 = globalThis;
		const bodyEl = win$1.document?.body ?? null;
		const portalToBody = (node) => {
			if (bodyEl && reactDom && typeof reactDom.createPortal === "function") return reactDom.createPortal(node, bodyEl);
			return node;
		};
		const PAGE_SIZE = 20;
		function numOf(obj, key) {
			const v = obj ? obj[key] : void 0;
			return typeof v === "number" && Number.isFinite(v) ? v : null;
		}
		function renderSkeletonRow(widthPct, heightPx = 14) {
			return h$1("div", {
				className: "agy-skeleton",
				"aria-hidden": true,
				style: {
					width: `${widthPct}%`,
					height: `${heightPx}px`,
					marginBottom: "var(--agy-space-2)"
				}
			});
		}
		function renderStatCard(label, value, sub, valueColor) {
			return h$1("div", {
				className: "agy-card-hover",
				style: {
					...S.statBox,
					flex: "1 1 150px"
				}
			}, h$1("div", { style: S.statLabel }, label), h$1("div", { style: {
				...S.statValue,
				color: valueColor ?? "var(--agy-text-primary)"
			} }, value), sub ? h$1("div", { style: S.statSub }, sub) : null);
		}
		function formatNumber(n) {
			return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
		}
		function formatCompactTokens(n) {
			if (!n) return "0";
			if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
			return String(n);
		}
		function maskEmail$1(email) {
			if (!email) return "";
			const at = email.indexOf("@");
			if (at <= 1) return email;
			const local = email.slice(0, at);
			const domain = email.slice(at + 1);
			return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
		}
		function AuditDrawer(props) {
			const { open, onClose, statsOverview, accounts, auditTab, onTabChange, auditRequests, auditTotal, auditPage, onPageChange, auditLoading, auditSessions, auditSessionsTotal, auditSessionsPage, onSessionsPageChange, auditSessionsLoading, auditError, onRefresh } = props;
			useEffect$1(() => {
				if (!open || !win$1.addEventListener || !win$1.removeEventListener) return;
				const onKeyDown = (ev) => {
					if (ev.key === "Escape") onClose();
				};
				win$1.addEventListener("keydown", onKeyDown);
				return () => win$1.removeEventListener?.("keydown", onKeyDown);
			}, [open, onClose]);
			if (!open) return null;
			const o = statsOverview;
			const totalRequests = numOf(o, "totalRequests");
			const totalSuccess = numOf(o, "totalSuccess");
			const totalFailed = numOf(o, "totalFailed");
			const cacheHitRate = numOf(o, "cacheHitRate");
			const cacheColor = cacheHitRate === null ? "var(--agy-text-primary)" : cacheHitRate > .3 ? "var(--agy-strong-ok)" : cacheHitRate >= .1 ? "var(--agy-strong-warn)" : "var(--agy-strong-neutral)";
			const summaryCards = o ? h$1("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				padding: "var(--agy-space-3) var(--agy-space-4) 0"
			} }, renderStatCard("请求总数", totalRequests === null ? "—" : formatNumber(totalRequests), `成功 ${totalSuccess === null ? "—" : formatNumber(totalSuccess)} · 失败 ${totalFailed === null ? "—" : formatNumber(totalFailed)}`), renderStatCard("缓存命中率 (Cache Hit %)", cacheHitRate === null ? "—" : `${(cacheHitRate * 100).toFixed(1)}%`, `命中 Token ${numOf(o, "totalCachedTokens") === null ? "—" : formatCompactTokens(numOf(o, "totalCachedTokens") ?? 0)}`, cacheColor), renderStatCard("Token 汇总 (P / C / O)", formatCompactTokens(numOf(o, "totalTokens") ?? 0), `P ${formatCompactTokens(numOf(o, "totalPromptTokens") ?? 0)} / C ${formatCompactTokens(numOf(o, "totalCachedTokens") ?? 0)} / O ${formatCompactTokens(numOf(o, "totalOutputTokens") ?? 0)}`), renderStatCard("平均耗时 / TTFT", numOf(o, "avgLatencyMs") === null ? "—" : `${Math.round(numOf(o, "avgLatencyMs") ?? 0)}ms`, `TTFT ${numOf(o, "avgTtftMs") === null ? "—" : `${Math.round(numOf(o, "avgTtftMs") ?? 0)}ms`} · P90 ${numOf(o, "p90LatencyMs") === null ? "—" : `${Math.round(numOf(o, "p90LatencyMs") ?? 0)}ms`}`)) : h$1("div", { style: {
				padding: "var(--agy-space-3) var(--agy-space-4) 0",
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap"
			} }, [
				0,
				1,
				2,
				3
			].map((i) => h$1("div", {
				key: i,
				style: { flex: "1 1 150px" }
			}, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22))));
			const requestsView = auditLoading && auditRequests.length === 0 ? h$1("div", { style: { padding: "0 var(--agy-space-4)" } }, renderSkeletonRow(95, 20), renderSkeletonRow(95, 20), renderSkeletonRow(95, 20)) : auditError ? h$1("div", { style: { padding: "0 var(--agy-space-4)" } }, renderStrip("error", auditError, onRefresh)) : auditRequests.length === 0 ? h$1("div", { style: { padding: "var(--agy-space-4)" } }, renderEmptyState("activity", "暂无请求审计记录。")) : h$1("table", { className: "agy-table" }, h$1("thead", null, h$1("tr", null, h$1("th", null, "时间"), h$1("th", null, "模型"), h$1("th", null, "账号"), h$1("th", null, "Token (P / C / O)"), h$1("th", null, "耗时 / TTFT"), h$1("th", null, "状态"))), h$1("tbody", null, auditRequests.map((r, i) => {
				const account = accounts.find((a) => a.id === r.accountId);
				const statusOk = typeof r.status === "string" && !/fail|error|4\d\d|5\d\d/i.test(r.status);
				return h$1("tr", { key: r.requestId ?? i }, h$1("td", {
					className: "agy-num",
					style: { fontVariantNumeric: "tabular-nums" }
				}, r.timestamp ?? "—"), h$1("td", null, r.model ?? "—"), h$1("td", null, account ? maskEmail$1(account.email) || account.alias || account.id : r.accountId ?? "未知"), h$1("td", {
					className: "agy-num",
					style: { fontVariantNumeric: "tabular-nums" }
				}, `${formatCompactTokens(r.promptTokens ?? 0)} / ${formatCompactTokens(r.cachedTokens ?? 0)} / ${formatCompactTokens(r.outputTokens ?? 0)}`), h$1("td", {
					className: "agy-num",
					style: { fontVariantNumeric: "tabular-nums" }
				}, `${r.latencyMs === void 0 ? "—" : `${Math.round(r.latencyMs)}ms`} · ${r.ttftMs === void 0 ? "—" : `${Math.round(r.ttftMs)}ms`}`), h$1("td", { style: { color: statusOk ? "var(--agy-strong-ok)" : "var(--agy-strong-danger)" } }, r.status ?? "—"));
			})));
			const sessionsView = auditSessionsLoading && auditSessions.length === 0 ? h$1("div", { style: { padding: "0 var(--agy-space-4)" } }, renderSkeletonRow(95, 20), renderSkeletonRow(95, 20), renderSkeletonRow(95, 20)) : auditError ? h$1("div", { style: { padding: "0 var(--agy-space-4)" } }, renderStrip("error", auditError, onRefresh)) : auditSessions.length === 0 ? h$1("div", { style: { padding: "var(--agy-space-4)" } }, renderEmptyState("activity", "暂无会话审计记录。")) : h$1("table", { className: "agy-table" }, h$1("thead", null, h$1("tr", null, h$1("th", null, "更新时间"), h$1("th", null, "会话 ID"), h$1("th", null, "账号"), h$1("th", null, "请求数 (总数 / 成功 / 失败)"), h$1("th", null, "Token (Prompt / 命中缓存 / 命中率)"), h$1("th", null, "状态/详情"))), h$1("tbody", null, auditSessions.map((s, i) => {
				const account = accounts.find((a) => a.id === s.accountId);
				const shortId = s.sessionId ? `${s.sessionId.slice(0, 8)}…${s.sessionId.slice(-4)}` : "—";
				return h$1("tr", { key: s.sessionId ?? i }, h$1("td", {
					className: "agy-num",
					style: { fontVariantNumeric: "tabular-nums" }
				}, s.updatedAt ?? "—"), h$1("td", { title: s.sessionId }, shortId), h$1("td", null, account ? maskEmail$1(account.email) || account.alias || account.id : s.accountId ?? "未知"), h$1("td", {
					className: "agy-num",
					style: { fontVariantNumeric: "tabular-nums" }
				}, `${formatNumber(s.totalRequests ?? 0)} / ${formatNumber(s.totalSuccess ?? 0)} / ${formatNumber(s.totalFailed ?? 0)}`), h$1("td", {
					className: "agy-num",
					style: { fontVariantNumeric: "tabular-nums" }
				}, `${formatCompactTokens(s.totalPromptTokens ?? 0)} / ${formatCompactTokens(s.totalCachedTokens ?? 0)} / ${typeof s.cacheHitRate === "number" ? `${(s.cacheHitRate * 100).toFixed(1)}%` : "—"}`), h$1("td", {
					title: s.lastError ?? void 0,
					style: { color: (s.totalFailed ?? 0) > 0 ? "var(--agy-strong-warn)" : "var(--agy-strong-ok)" }
				}, s.status ?? s.lastError ?? "—"));
			})));
			const totalForTab = auditTab === "requests" ? auditTotal : auditSessionsTotal;
			const pageForTab = auditTab === "requests" ? auditPage : auditSessionsPage;
			const setPageForTab = (next) => {
				if (auditTab === "requests") onPageChange(next);
				else onSessionsPageChange(next);
			};
			const canPrev = pageForTab > 0;
			const canNext = (pageForTab + 1) * PAGE_SIZE < totalForTab;
			return portalToBody(h$1("div", {
				className: "agy-drawer-backdrop",
				onClick: (e) => {
					if (e.target === e.currentTarget) onClose();
				}
			}, h$1("div", {
				className: "agy-drawer",
				role: "dialog",
				"aria-modal": true,
				"aria-label": "请求审计与会话统计"
			}, h$1("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "var(--agy-space-2)",
				padding: "var(--agy-space-3) var(--agy-space-4)",
				borderBottom: "1px solid var(--agy-drawer-border)"
			} }, h$1("div", { style: S.panelTitle }, "请求审计与会话统计 (Audit Log)"), h$1("div", { style: {
				display: "flex",
				gap: "5px"
			} }, h$1("button", {
				className: "agy-btn",
				style: {
					...S.btnSm,
					background: "var(--agy-drawer-btn-bg)",
					color: "var(--agy-drawer-btn-text)",
					border: "1px solid var(--agy-drawer-btn-border)"
				},
				onClick: onRefresh,
				"aria-label": "刷新审计数据"
			}, uiIcon("refresh", 12), " 刷新"), h$1("button", {
				className: "agy-btn",
				style: {
					...S.btnSm,
					background: "var(--agy-drawer-btn-bg)",
					color: "var(--agy-drawer-btn-text)",
					border: "1px solid var(--agy-drawer-btn-border)"
				},
				onClick: onClose,
				"aria-label": "关闭审计抽屉"
			}, uiIcon("x", 12)))), summaryCards, h$1("div", { style: {
				padding: "var(--agy-space-3) var(--agy-space-4) 0",
				display: "flex",
				gap: "var(--agy-space-2)",
				alignItems: "center",
				flexWrap: "wrap"
			} }, h$1("div", {
				style: S.segGroup,
				role: "tablist",
				"aria-label": "审计视图切换"
			}, h$1("button", {
				role: "tab",
				"aria-selected": auditTab === "requests",
				style: auditTab === "requests" ? S.segBtnActive : S.segBtn,
				onClick: () => onTabChange("requests")
			}, "按请求明细 (Requests)"), h$1("button", {
				role: "tab",
				"aria-selected": auditTab === "sessions",
				style: auditTab === "sessions" ? S.segBtnActive : S.segBtn,
				onClick: () => onTabChange("sessions")
			}, "按会话统计 (Sessions)")), auditLoading || auditSessionsLoading ? h$1("span", { style: {
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				fontSize: "var(--agy-font-xs)",
				color: "var(--agy-table-faint)"
			} }, h$1("span", {
				className: "agy-spinner",
				"aria-hidden": true
			}), "加载中…") : null), h$1("div", { style: {
				flex: 1,
				overflow: "auto",
				padding: "var(--agy-space-2) 0"
			} }, auditTab === "requests" ? requestsView : sessionsView), h$1("div", { style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-end",
				gap: "var(--agy-space-2)",
				padding: "var(--agy-space-3) var(--agy-space-4)",
				borderTop: "1px solid var(--agy-drawer-border)"
			} }, h$1("span", {
				className: "agy-num",
				style: {
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-table-faint)",
					marginRight: "auto",
					fontVariantNumeric: "tabular-nums"
				}
			}, `共 ${formatNumber(totalForTab)} 条 · 每页 ${PAGE_SIZE} 条`), h$1("button", {
				className: "agy-btn",
				style: {
					...S.btnSm,
					background: "var(--agy-drawer-btn-bg)",
					color: "var(--agy-drawer-btn-text)",
					border: "1px solid var(--agy-drawer-btn-border)"
				},
				disabled: !canPrev,
				onClick: () => setPageForTab(pageForTab - 1)
			}, "上一页"), h$1("span", {
				className: "agy-num",
				style: {
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-table-soft)",
					fontVariantNumeric: "tabular-nums"
				}
			}, `第 ${pageForTab + 1} 页`), h$1("button", {
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
		}
		function UsageSection(props) {
			const { statsOverview, statsError, accounts, onRefreshStats } = props;
			const [showAuditDrawer, setShowAuditDrawer] = useState$1(false);
			const [auditTab, setAuditTab] = useState$1("requests");
			const [auditRequests, setAuditRequests] = useState$1([]);
			const [auditTotal, setAuditTotal] = useState$1(0);
			const [auditPage, setAuditPage] = useState$1(0);
			const [auditLoading, setAuditLoading] = useState$1(false);
			const [auditSessions, setAuditSessions] = useState$1([]);
			const [auditSessionsTotal, setAuditSessionsTotal] = useState$1(0);
			const [auditSessionsPage, setAuditSessionsPage] = useState$1(0);
			const [auditSessionsLoading, setAuditSessionsLoading] = useState$1(false);
			const [auditError, setAuditError] = useState$1(null);
			const fetchAuditRequests = useCallback(async (limit, offset) => {
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
			}, []);
			const fetchAuditSessions = useCallback(async (limit, offset) => {
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
			}, []);
			useEffect$1(() => {
				if (!showAuditDrawer) return;
				if (auditTab === "requests") fetchAuditRequests(PAGE_SIZE, auditPage * PAGE_SIZE);
				else fetchAuditSessions(PAGE_SIZE, auditSessionsPage * PAGE_SIZE);
			}, [
				showAuditDrawer,
				auditTab,
				auditPage,
				auditSessionsPage,
				fetchAuditRequests,
				fetchAuditSessions
			]);
			const handleRefreshAudit = useCallback(() => {
				if (auditTab === "requests") fetchAuditRequests(PAGE_SIZE, auditPage * PAGE_SIZE);
				else fetchAuditSessions(PAGE_SIZE, auditSessionsPage * PAGE_SIZE);
			}, [
				auditTab,
				auditPage,
				auditSessionsPage,
				fetchAuditRequests,
				fetchAuditSessions
			]);
			const cacheHitRate = numOf(statsOverview, "cacheHitRate") ?? 0;
			const cacheColor = cacheHitRate > .3 ? "var(--agy-strong-ok)" : cacheHitRate >= .1 ? "var(--agy-strong-warn)" : "var(--agy-strong-neutral)";
			return h$1("div", null, statsError ? renderStrip("error", statsError, () => void onRefreshStats()) : null, h$1("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap",
				marginBottom: "var(--agy-space-3)"
			} }, statsOverview ? renderStatCard("请求总数", h$1("span", {
				className: "agy-num",
				style: { fontVariantNumeric: "tabular-nums" }
			}, formatNumber(numOf(statsOverview, "totalRequests") ?? 0)), `成功 ${formatNumber(numOf(statsOverview, "totalSuccess") ?? 0)} · 失败 ${formatNumber(numOf(statsOverview, "totalFailed") ?? 0)}`) : h$1("div", { style: {
				...S.statBox,
				flex: "1 1 150px"
			} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)), statsOverview ? renderStatCard("Token 汇总", h$1("span", {
				className: "agy-num",
				style: { fontVariantNumeric: "tabular-nums" }
			}, formatCompactTokens(numOf(statsOverview, "totalTokens") ?? 0)), `Prompt ${formatCompactTokens(numOf(statsOverview, "totalPromptTokens") ?? 0)} · 输出 ${formatCompactTokens(numOf(statsOverview, "totalOutputTokens") ?? 0)}`) : h$1("div", { style: {
				...S.statBox,
				flex: "1 1 150px"
			} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)), statsOverview ? renderStatCard("缓存命中率", h$1("span", {
				className: "agy-num",
				style: { fontVariantNumeric: "tabular-nums" }
			}, `${(cacheHitRate * 100).toFixed(1)}%`), `命中 Token ${formatCompactTokens(numOf(statsOverview, "totalCachedTokens") ?? 0)}`, cacheColor) : h$1("div", { style: {
				...S.statBox,
				flex: "1 1 150px"
			} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22)), statsOverview ? renderStatCard("平均延迟 / TTFT", h$1("span", {
				className: "agy-num",
				style: { fontVariantNumeric: "tabular-nums" }
			}, `${Math.round(numOf(statsOverview, "avgLatencyMs") ?? 0)}ms`), `TTFT ${Math.round(numOf(statsOverview, "avgTtftMs") ?? 0)}ms · P90 ${Math.round(numOf(statsOverview, "p90LatencyMs") ?? 0)}ms`) : h$1("div", { style: {
				...S.statBox,
				flex: "1 1 150px"
			} }, renderSkeletonRow(60, 12), renderSkeletonRow(90, 22))), h$1("div", { style: {
				display: "flex",
				gap: "var(--agy-space-2)",
				flexWrap: "wrap"
			} }, h$1("button", {
				className: "agy-btn",
				style: S.btnPrimary,
				onClick: () => setShowAuditDrawer(true)
			}, uiIcon("activity", 12), " 打开请求明细与会话统计"), h$1("button", {
				className: "agy-btn",
				style: S.btnSm,
				onClick: () => void onRefreshStats(),
				"aria-label": "重新加载用量统计"
			}, uiIcon("refresh", 12), " 重新加载")), h$1(AuditDrawer, {
				open: showAuditDrawer,
				onClose: () => setShowAuditDrawer(false),
				statsOverview,
				accounts,
				auditTab,
				onTabChange: setAuditTab,
				auditRequests,
				auditTotal,
				auditPage,
				onPageChange: setAuditPage,
				auditLoading,
				auditSessions,
				auditSessionsTotal,
				auditSessionsPage,
				onSessionsPageChange: setAuditSessionsPage,
				auditSessionsLoading,
				auditError,
				onRefresh: handleRefreshAudit
			}));
		}
		//#endregion
		//#region src/client/index.ts
		const { createElement: h, useState, useEffect, useRef } = require("react");
		const win = globalThis;
		const name = "dsh-cloudcode-link-client";
		const inject = ["slots"];
		const SETTINGS_SECTION_ID = "agy-link";
		const SETTINGS_SECTION_LABEL = "CloudCode Link";
		const SECTIONS = [
			{
				key: "overview",
				label: "概览"
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
				label: "用量"
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
		function maskEmail(email) {
			if (!email || typeof email !== "string") return "";
			const atIdx = email.indexOf("@");
			if (atIdx <= 0) return email;
			const user = email.slice(0, atIdx);
			const domain = email.slice(atIdx);
			if (user.length <= 2) return `${user[0]}***${domain}`;
			return `${user.slice(0, 2)}***${domain}`;
		}
		function formatClock(ms) {
			if (!ms) return "—";
			try {
				return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
			} catch {
				return "—";
			}
		}
		const agyIconGradientIds = /* @__PURE__ */ new Map();
		/** CloudCode Link orb mark: gradient core with an orbit ring. */
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
		* Settings-nav glyph for the optional `settings.section.icon` seat.
		*/
		function AgySettingsNavIcon(props) {
			const { size, active } = settingsNavProps(props);
			return h("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				"aria-hidden": true,
				focusable: "false",
				style: { display: "block" }
			}, ...settingsNavShapes(active).map((shape) => h(shape.tag, shape.attrs)));
		}
		function apply(ctx) {
			const AgySettingsSection = () => {
				const [status, setStatus] = useState(statusCache);
				const [pollOk, setPollOk] = useState(statusCache !== null);
				const [lastUpdatedAt, setLastUpdatedAt] = useState(statusCache ? Date.now() : null);
				const [activeSection, setActiveSection] = useState("overview");
				const [loadingAction, setLoadingAction] = useState(null);
				const [toast, setToast] = useState(null);
				const [statsOverview, setStatsOverview] = useState(null);
				const [statsError, setStatsError] = useState(null);
				const [modelPanels, setModelPanels] = useState({});
				const [expandedModels, setExpandedModels] = useState({});
				const [modelQueries, setModelQueries] = useState({});
				const [familyFilters, setFamilyFilters] = useState({});
				const [addingAccount, setAddingAccount] = useState(false);
				const [aliasInput, setAliasInput] = useState("");
				const [manualCodeInput, setManualCodeInput] = useState("");
				const [editingProxyId, setEditingProxyId] = useState(null);
				const [proxyInput, setProxyInput] = useState("");
				const [geminiAppEmailInput, setGeminiAppEmailInput] = useState("");
				const [geminiAppCookieInput, setGeminiAppCookieInput] = useState("");
				const [geminiAppBusy, setGeminiAppBusy] = useState(false);
				const toastTimerRef = useRef(null);
				const lastStatusJsonRef = useRef("");
				const pollOkRef = useRef(pollOk);
				const lastUpdatedRef = useRef(lastUpdatedAt);
				pollOkRef.current = pollOk;
				lastUpdatedRef.current = lastUpdatedAt;
				const flowStartedRef = useRef(false);
				const prevPoolPhaseRef = useRef("idle");
				const tabRefs = useRef({});
				const showToast = (text, type = "info") => {
					setToast({
						text,
						type
					});
					if (toastTimerRef.current) win.clearTimeout(toastTimerRef.current);
					toastTimerRef.current = win.setTimeout(() => setToast(null), 4200);
				};
				const fetchStatsOverview = async () => {
					try {
						const res = await fetchWithFallback(`${API_PREFIX}/stats/overview`);
						if (!res || !res.ok) {
							setStatsError("用量统计加载失败（后端未返回可用数据）");
							return;
						}
						const data = await res.json();
						setStatsOverview(data.overview ?? null);
						setStatsError(null);
					} catch {
						setStatsError("用量统计加载失败（网络异常）");
					}
				};
				useEffect(() => {
					fetchStatsOverview();
				}, []);
				useEffect(() => {
					if (activeSection === "usage") fetchStatsOverview();
				}, [activeSection]);
				useEffect(() => {
					let alive = true;
					const poll = async () => {
						const next = await getStatus();
						if (!alive) return;
						const now = Date.now();
						if (!next) {
							const failed = applyPollOutcome({
								pollOk: pollOkRef.current,
								lastUpdatedAt: lastUpdatedRef.current
							}, {
								ok: false,
								statusChanged: false
							}, now);
							pollOkRef.current = failed.pollOk;
							lastUpdatedRef.current = failed.lastUpdatedAt;
							setPollOk(failed.pollOk);
							return;
						}
						const nextJson = JSON.stringify(next);
						const statusChanged = nextJson !== lastStatusJsonRef.current;
						const okState = applyPollOutcome({
							pollOk: pollOkRef.current,
							lastUpdatedAt: lastUpdatedRef.current
						}, {
							ok: true,
							statusChanged
						}, now);
						pollOkRef.current = okState.pollOk;
						lastUpdatedRef.current = okState.lastUpdatedAt;
						setPollOk(okState.pollOk);
						setLastUpdatedAt(okState.lastUpdatedAt);
						if (statusChanged) {
							lastStatusJsonRef.current = nextJson;
							setStatus(next);
						}
					};
					poll();
					const timer = win.setInterval(() => {
						poll();
					}, 3e3);
					return () => {
						alive = false;
						win.clearInterval(timer);
						if (toastTimerRef.current) win.clearTimeout(toastTimerRef.current);
					};
				}, []);
				const poolAuthPhase = status?.poolAuth?.phase ?? "idle";
				useEffect(() => {
					const prev = prevPoolPhaseRef.current;
					prevPoolPhaseRef.current = poolAuthPhase;
					if (prev === poolAuthPhase) return;
					if (poolAuthPhase === "done" && flowStartedRef.current) {
						flowStartedRef.current = false;
						setAddingAccount(false);
						setAliasInput("");
						setManualCodeInput("");
						showToast("账号已激活并加入账号池", "success");
						getStatus().then((next) => {
							if (next) setStatus(next);
						});
					} else if (poolAuthPhase === "failed" && flowStartedRef.current) {
						flowStartedRef.current = false;
						showToast(status?.poolAuth?.message || "账号激活失败，请重试或手动粘贴授权码", "error");
					}
				}, [poolAuthPhase]);
				const loadModelsPanel = async (accId) => {
					setModelPanels((prev) => ({
						...prev,
						[accId]: {
							...prev[accId] ?? EMPTY_PANEL,
							status: "loading",
							error: null
						}
					}));
					const result = await getJson(`/pool/account-models?id=${encodeURIComponent(accId)}`);
					if (result.ok && result.data) {
						const payload = result.data;
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
				const refreshModelsPanel = async (accId) => {
					setModelPanels((prev) => ({
						...prev,
						[accId]: {
							...prev[accId] ?? EMPTY_PANEL,
							status: "loading",
							error: null
						}
					}));
					const result = await postJson(`${API_PREFIX}/pool/account-models`, {
						id: accId,
						refresh: true
					});
					if (result.ok && result.data) {
						const payload = result.data;
						setModelPanels((prev) => ({
							...prev,
							[accId]: markPanelSuccess(prev[accId] ?? EMPTY_PANEL, payload, payload.refreshError ?? null, Date.now())
						}));
						if (payload.refreshError) showToast(`刷新未完成：${payload.refreshError}（旧清单已保留）`, "warn");
						else showToast(`已刷新模型清单（${payload.total} 个）`, "success");
						return;
					}
					setModelPanels((prev) => ({
						...prev,
						[accId]: markPanelRefreshFailure(prev[accId] ?? EMPTY_PANEL, result.error ?? "models_refresh_failed", Date.now())
					}));
					showToast("模型刷新失败，已保留上一次发现的模型数据", "error");
				};
				const ensureModelsLoaded = (accId) => {
					const cur = modelPanels[accId];
					if (!cur || cur.status === "idle") loadModelsPanel(accId);
				};
				const accounts = status?.pool?.accounts ?? [];
				useEffect(() => {
					if (activeSection !== "models") return;
					const stale = collectStalePanelAccounts(modelPanels, accounts, Date.now());
					for (const acc of stale) loadModelsPanel(acc.id);
				}, [activeSection, accounts.map((a) => a.id).join(",")]);
				const refreshStatusNow = async () => {
					setLoadingAction("refresh");
					try {
						const next = await getStatus();
						if (next) {
							setStatus(next);
							setPollOk(true);
							setLastUpdatedAt(Date.now());
							showToast("状态已刷新", "success");
						} else {
							setPollOk(false);
							showToast("状态刷新失败：暂时联系不上后端，页面保留的是上次成功拉取的数据", "error");
						}
					} finally {
						setLoadingAction(null);
					}
				};
				const runPoolAction = async (label, path, payload, okText) => {
					setLoadingAction(label);
					try {
						const res = await postJson(`${API_PREFIX}${path}`, payload);
						if (!res.ok) {
							showToast(`${okText}失败：${res.error ?? "后端未响应"}`, "error");
							return;
						}
						const next = await getStatus();
						if (next) setStatus(next);
						showToast(okText, "success");
					} finally {
						setLoadingAction(null);
					}
				};
				const beginAddAccount = async () => {
					setAddingAccount(true);
					setLoadingAction("add-start");
					flowStartedRef.current = true;
					try {
						const res = await postJson(`${API_PREFIX}/pool/begin-add`, { alias: aliasInput.trim() || void 0 });
						if (!res.ok) {
							flowStartedRef.current = false;
							showToast(`添加流程启动失败：${res.error ?? "无法联系后端"}`, "error");
							return;
						}
						if (res.data?.browserOpened === false) showToast("未自动打开浏览器，请在添加面板中使用手动授权链接", "warn");
						else showToast("已打开浏览器授权，完成后将自动入池", "info");
						const next = await getStatus();
						if (next) setStatus(next);
					} finally {
						setLoadingAction(null);
					}
				};
				const cancelAddAccount = async () => {
					flowStartedRef.current = false;
					setAddingAccount(false);
					setManualCodeInput("");
					await postJson(`${API_PREFIX}/pool/cancel-add`, {});
					const next = await getStatus();
					if (next) setStatus(next);
				};
				const submitManualCode = async () => {
					const code = manualCodeInput.trim();
					if (!code) {
						showToast("请先粘贴授权码或回调链接", "warn");
						return;
					}
					setLoadingAction("add-complete");
					try {
						const res = await postJson(`${API_PREFIX}/pool/complete-add`, { code });
						if (!res.ok) {
							showToast(`手动激活失败：${res.error ?? "授权码无效或已过期"}`, "error");
							return;
						}
						flowStartedRef.current = false;
						setAddingAccount(false);
						setAliasInput("");
						setManualCodeInput("");
						const next = await getStatus();
						if (next) setStatus(next);
						showToast("账号已激活并加入账号池", "success");
					} finally {
						setLoadingAction(null);
					}
				};
				const saveConfig = async (key, value) => {
					setLoadingAction(`cfg-${key}`);
					try {
						const res = await postJson(`${API_PREFIX}/config`, {
							key,
							value
						});
						if (!res.ok) {
							showToast(`保存 ${key} 失败：${res.error ?? "后端未响应"}`, "error");
							return false;
						}
						const next = await getStatus();
						if (next) setStatus(next);
						showToast(`已更新 ${key}`, "success");
						return true;
					} catch (err) {
						showToast(`保存 ${key} 失败：${err instanceof Error ? err.message : "网络异常"}`, "error");
						return false;
					} finally {
						setLoadingAction(null);
					}
				};
				const addGeminiAppAccount = async () => {
					const cred = geminiAppCookieInput.trim();
					if (!cred) {
						showToast("请粘贴 oauth_token、MasterToken 或 Access Token", "error");
						return;
					}
					setGeminiAppBusy(true);
					try {
						const payload = {};
						const email = geminiAppEmailInput.trim();
						if (email) payload.email = email;
						if (cred.startsWith("aas_et/")) payload.masterToken = cred;
						else if (cred.startsWith("ya29.")) payload.accessToken = cred;
						else payload.oauthToken = cred;
						const res = await postJson(`${API_PREFIX}/gemini-app/pool/login`, payload);
						if (!res.ok) {
							showToast(res.error ?? "登录失败", "error");
							return;
						}
						setGeminiAppEmailInput("");
						setGeminiAppCookieInput("");
						const next = await getStatus();
						if (next) setStatus(next);
						showToast("Gemini App 账号已添加", "success");
					} finally {
						setGeminiAppBusy(false);
					}
				};
				const removeGeminiAppAccount = async (id) => {
					setGeminiAppBusy(true);
					try {
						const res = await postJson(`${API_PREFIX}/gemini-app/pool/remove`, { id });
						if (!res.ok) {
							showToast(res.error ?? "删除失败", "error");
							return;
						}
						const next = await getStatus();
						if (next) setStatus(next);
						showToast("已移除 Gemini App 账号", "success");
					} finally {
						setGeminiAppBusy(false);
					}
				};
				const handleViewAccountModels = (accId) => {
					setActiveSection("models");
					setExpandedModels((prev) => ({
						...prev,
						[accId]: true
					}));
					ensureModelsLoaded(accId);
					win.setTimeout(() => {
						(win.document?.getElementById?.(modelsPanelDomId(accId)))?.scrollIntoView?.({
							behavior: "smooth",
							block: "nearest"
						});
					}, 60);
				};
				const onNavKeyDown = (ev) => {
					const idx = SECTIONS.findIndex((s) => s.key === activeSection);
					let next = idx;
					if (ev.key === "ArrowRight") next = (idx + 1) % SECTIONS.length;
					else if (ev.key === "ArrowLeft") next = (idx - 1 + SECTIONS.length) % SECTIONS.length;
					else if (ev.key === "Home") next = 0;
					else if (ev.key === "End") next = SECTIONS.length - 1;
					else return;
					ev.preventDefault?.();
					const key = SECTIONS[next].key;
					setActiveSection(key);
					tabRefs.current[key]?.focus?.();
				};
				const navBar = h("nav", {
					style: S.navBar,
					role: "tablist",
					"aria-label": `${SETTINGS_SECTION_LABEL} 设置分区`,
					onKeyDown: onNavKeyDown
				}, ...SECTIONS.map((s) => h("button", {
					key: s.key,
					id: `agy-tab-${s.key}`,
					ref: (node) => {
						tabRefs.current[s.key] = node;
					},
					className: "agy-tab",
					role: "tab",
					"aria-selected": activeSection === s.key,
					"aria-controls": `agy-panel-${s.key}`,
					tabIndex: activeSection === s.key ? 0 : -1,
					style: activeSection === s.key ? S.navTabActive : S.navTab,
					onClick: () => setActiveSection(s.key)
				}, s.label)));
				const renderToastBanner = () => {
					if (!toast) return null;
					const p = {
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
						style: {
							padding: "9px 14px",
							borderRadius: "var(--agy-radius-md)",
							background: p.bg,
							border: `1px solid ${p.border}`,
							color: p.text,
							fontSize: "var(--agy-font-sm)",
							fontWeight: 600,
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							gap: "var(--agy-space-2)"
						}
					}, h("span", null, toast.text), h("button", {
						className: "agy-btn",
						style: {
							background: "transparent",
							border: "none",
							color: p.text,
							cursor: "pointer",
							padding: "2px 4px"
						},
						onClick: () => setToast(null),
						"aria-label": "关闭提示"
					}, uiIcon("x", 12)));
				};
				if (!status) return h("div", {
					className: "agy-root",
					style: S.container
				}, h("style", null, THEME_CSS), h("div", { style: {
					...S.heroCard,
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center"
				} }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)"
				} }, agyIcon(20), h("span", { style: S.panelTitle }, SETTINGS_SECTION_LABEL)), h("span", { style: {
					display: "inline-flex",
					alignItems: "center",
					gap: "6px",
					...S.muted
				} }, h("span", {
					className: "agy-spinner",
					"aria-hidden": true
				}), "正在加载状态")), renderToastBanner(), navBar, h("div", { style: S.card }, h("div", {
					className: "agy-skeleton",
					style: {
						width: "42%",
						height: "16px",
						marginBottom: "var(--agy-space-3)"
					}
				}), h("div", {
					className: "agy-skeleton",
					style: {
						width: "88%",
						height: "12px",
						marginBottom: "var(--agy-space-2)"
					}
				}), h("div", {
					className: "agy-skeleton",
					style: {
						width: "72%",
						height: "12px"
					}
				})));
				const readyAccounts = accounts.filter((a) => {
					const inCooldown = Object.values(a.cooldowns ?? {}).some((until) => typeof until === "number" && until > Date.now());
					return a.enabled && !a.authRequired && !inCooldown;
				}).length;
				const primaryAcc = accounts.find((a) => a.id === status.pool?.primaryAccountId);
				const primaryLabel = primaryAcc ? maskEmail(primaryAcc.email) || primaryAcc.alias || primaryAcc.id : accounts.length > 0 ? "自动调度" : "未配置";
				const defaultModelLabel = status.defaultModel || "未设置";
				const defaultEffortLabel = status.defaultEffort || "medium";
				const statusTone = !pollOk ? "warn" : readyAccounts > 0 ? "ok" : accounts.length > 0 ? "danger" : "neutral";
				const statusText = !pollOk ? `轮询中断 · ${formatClock(lastUpdatedAt)}` : readyAccounts > 0 ? `运行中 · ${readyAccounts}/${accounts.length} 就绪` : accounts.length > 0 ? "需授权或冷却中" : "待添加账号";
				const heroHeader = h("header", { style: S.heroCard }, h("div", { style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					gap: "var(--agy-space-3)",
					flexWrap: "wrap"
				} }, h("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: "6px"
				} }, h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, agyIcon(20), h("h2", { style: {
					...S.panelTitle,
					margin: 0
				} }, SETTINGS_SECTION_LABEL), renderBadge(statusText, statusTone), status.version ? renderBadge(`v${status.version}`, "neutral") : null), h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-3)",
					flexWrap: "wrap",
					fontSize: "var(--agy-font-xs)",
					color: "var(--agy-text-secondary)"
				} }, h("span", null, "主用账号：", h("strong", { style: { color: "var(--agy-text-primary)" } }, primaryLabel)), h("span", { style: { color: "var(--agy-border-divider)" } }, "·"), h("span", null, "默认模型：", h("strong", {
					className: "agy-num",
					style: { color: "var(--agy-text-primary)" }
				}, defaultModelLabel), ` (${defaultEffortLabel})`))), h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: "var(--agy-space-2)",
					flexWrap: "wrap"
				} }, h("button", {
					className: "agy-btn",
					style: S.btnSm,
					disabled: loadingAction !== null,
					onClick: () => {
						refreshStatusNow();
					}
				}, uiIcon("refresh", 12), loadingAction === "refresh" ? " 刷新中…" : " 刷新状态"), h("button", {
					className: "agy-btn",
					style: S.btnSmPrimary,
					onClick: () => {
						setActiveSection("accounts");
						setAddingAccount(true);
					}
				}, uiIcon("plus", 12), " 添加账号"))));
				const isBusy = loadingAction !== null;
				const sectionBody = () => {
					switch (activeSection) {
						case "overview": return h(OverviewSection, {
							status,
							accounts,
							pollOk,
							lastUpdatedAt,
							onNavigate: setActiveSection,
							onBeginAddAccount: () => {
								setActiveSection("accounts");
								setAddingAccount(true);
							},
							onRefreshStatus: () => {
								refreshStatusNow();
							}
						});
						case "accounts": return h(AccountsSection, {
							status,
							accounts,
							isBusy,
							addingAccount,
							aliasInput,
							manualCodeInput,
							editingProxyId,
							proxyInput,
							geminiAppEmailInput,
							geminiAppCookieInput,
							geminiAppBusy,
							onAliasInputChange: setAliasInput,
							onManualCodeInputChange: setManualCodeInput,
							onToggleAddingAccount: setAddingAccount,
							onBeginAddAccount: beginAddAccount,
							onCancelAddAccount: cancelAddAccount,
							onSubmitManualCode: submitManualCode,
							onSetPrimary: (id) => runPoolAction(`primary-${id}`, "/pool/primary", { id }, "已设为主用账号"),
							onSyncQuota: (id) => runPoolAction(`quota-${id}`, "/pool/refresh-quota", { id }, "已同步配额"),
							onClearCooldown: (id) => runPoolAction(`cooldown-${id}`, "/pool/clear-cooldown", { id }, "已清除冷却"),
							onRemoveAccount: (id) => runPoolAction(`remove-${id}`, "/pool/remove", { id }, "已移除账号"),
							onStartEditProxy: (id, currentProxy) => {
								setEditingProxyId(id);
								setProxyInput(currentProxy);
							},
							onCancelEditProxy: () => {
								setEditingProxyId(null);
								setProxyInput("");
							},
							onProxyInputChange: setProxyInput,
							onSaveProxy: async (id) => {
								await runPoolAction(`proxy-${id}`, "/pool/proxy", {
									id,
									proxyUrl: proxyInput.trim()
								}, "已更新代理设置");
								setEditingProxyId(null);
								setProxyInput("");
							},
							onViewAccountModels: handleViewAccountModels,
							onGeminiAppEmailChange: setGeminiAppEmailInput,
							onGeminiAppCookieChange: setGeminiAppCookieInput,
							onAddGeminiAppAccount: addGeminiAppAccount,
							onRemoveGeminiAppAccount: removeGeminiAppAccount
						});
						case "models": return h(ModelsSection, {
							status,
							accounts,
							modelPanels,
							expandedModels,
							modelQueries,
							familyFilters,
							isBusy,
							onToggleExpand: (accId) => {
								const next = !expandedModels[accId];
								setExpandedModels((prev) => ({
									...prev,
									[accId]: next
								}));
								if (next) ensureModelsLoaded(accId);
							},
							onQueryChange: (accId, query) => {
								setModelQueries((prev) => ({
									...prev,
									[accId]: query
								}));
							},
							onFamilyFilterChange: (accId, family) => {
								setFamilyFilters((prev) => ({
									...prev,
									[accId]: family
								}));
							},
							onLoadModelsPanel: loadModelsPanel,
							onRefreshModelsPanel: refreshModelsPanel,
							onSaveConfig: saveConfig
						});
						case "usage": return h(UsageSection, {
							statsOverview,
							statsError,
							accounts: accounts.map((a) => ({
								id: a.id,
								email: a.email,
								alias: a.alias
							})),
							onRefreshStats: fetchStatsOverview
						});
						case "diagnostics": return h(DiagnosticsSection, {
							status,
							pollOk,
							lastUpdatedAt,
							poolAuthPhase,
							isBusy,
							onRefresh: refreshStatusNow
						});
						case "config": return h(ConfigSection, {
							status,
							isBusy,
							onSaveConfig: saveConfig,
							onNavigateModels: () => setActiveSection("models")
						});
					}
				};
				return h("div", {
					className: "agy-root",
					style: S.container
				}, h("style", null, THEME_CSS), heroHeader, renderToastBanner(), navBar, h("div", {
					key: activeSection,
					id: `agy-panel-${activeSection}`,
					className: "agy-fade-slide-in",
					role: "tabpanel",
					"aria-labelledby": `agy-tab-${activeSection}`,
					tabIndex: 0
				}, sectionBody()));
			};
			ctx.slots.inject("settings.section", () => {
				return ctx.slots.register({
					name: "settings.section",
					id: SETTINGS_SECTION_ID,
					order: 20,
					label: SETTINGS_SECTION_LABEL
				}, AgySettingsSection);
			});
			ctx.slots.inject("settings.section.icon", () => {
				return ctx.slots.register({
					name: "settings.section.icon",
					id: SETTINGS_SECTION_ID
				}, AgySettingsNavIcon);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
