// Config section for CloudCode Link settings UI.
// defaultModel & defaultEffort have been consolidated into ModelsSection;
// this section manages base connection, askTool, and Gemini App (Robin) dual-track offload.
import type { StatusPayload } from '../types.ts';
import { uiIcon } from '../components/ui.ts';
import { S } from '../theme.ts';

type ReactApi = {
	createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
	useState: <S0>(initial: S0) => [S0, (next: S0 | ((prev: S0) => S0)) => void];
	useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]) => T;
};
const R = require('react') as ReactApi;
const { createElement: h, useState, useCallback } = R;

export interface ConfigSectionProps {
	status: StatusPayload | null;
	isBusy: boolean;
	onSaveConfig: (key: string, value: unknown) => Promise<boolean>;
	onNavigateModels?: () => void;
}

export function ConfigSection(props: ConfigSectionProps): unknown {
	const { status, isBusy, onSaveConfig, onNavigateModels } = props;

	const [cfgDrafts, setCfgDrafts] = useState<Record<string, string>>({});
	const [geminiAppTokenInput, setGeminiAppTokenInput] = useState('');

	const hasToken = status?.hasGeminiAppToken === true;

	const handleSaveDraft = useCallback((key: string) => {
		const val = (cfgDrafts[key] ?? '').trim();
		void onSaveConfig(key, val);
	}, [cfgDrafts, onSaveConfig]);

	const renderConfigRow = (key: string, label: string, hint: string, isLast = false): unknown => {
		const draft = cfgDrafts[key] ?? '';
		return h('div', {
			key,
			style: {
				display: 'flex',
				gap: 'var(--agy-space-2)',
				alignItems: 'center',
				padding: '10px 0',
				borderBottom: isLast ? 'none' : '1px solid var(--agy-border-divider)',
				flexWrap: 'wrap',
			},
		},
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
				onClick: () => handleSaveDraft(key),
			}, '保存'),
		);
	};

	const renderSwitchRow = (
		key: keyof StatusPayload,
		title: string,
		subtitle: string,
		ariaLabel: string,
		onLabel = '已开启',
		offLabel = '已关闭',
		isLast = false,
	): unknown => {
		const checked = status?.[key] === true;
		return h('div', {
			key: String(key),
			style: {
				display: 'flex',
				gap: 'var(--agy-space-2)',
				alignItems: 'center',
				padding: '10px 0',
				borderBottom: isLast ? 'none' : '1px solid var(--agy-border-subtle)',
				flexWrap: 'wrap',
			},
		},
			h('div', { style: { width: '210px', flexShrink: 0 } },
				h('div', { style: { fontSize: 'var(--agy-font-sm)', fontWeight: 700, color: 'var(--agy-text-primary)' } }, title),
				h('div', { style: { fontSize: 'var(--agy-font-xs)', color: 'var(--agy-text-tertiary)', marginTop: '2px' } }, subtitle),
			),
			h('button', {
				className: 'agy-btn',
				role: 'switch',
				'aria-checked': checked,
				'aria-label': ariaLabel,
				style: {
					...S.btnSm,
					background: checked ? 'var(--agy-accent)' : 'var(--agy-bg-btn)',
					color: checked ? 'var(--agy-on-accent)' : 'var(--agy-text-btn)',
					border: `1px solid ${checked ? 'var(--agy-border-btn-primary)' : 'var(--agy-border-btn)'}`,
					transition: 'background 160ms ease, color 160ms ease, border-color 160ms ease',
				},
				disabled: isBusy,
				onClick: () => void onSaveConfig(String(key), !checked),
			}, checked ? onLabel : offLabel),
		);
	};

	return h('div', null,
		h('div', {
			className: 'agy-rise',
			role: 'note',
			style: {
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 'var(--agy-space-2)',
				padding: '10px var(--agy-space-3)',
				borderRadius: 'var(--agy-radius-md)',
				background: 'var(--agy-info-bg)',
				border: '1px solid var(--agy-info-border)',
				color: 'var(--agy-info-text)',
				fontSize: 'var(--agy-font-sm)',
				marginBottom: 'var(--agy-space-3)',
				flexWrap: 'wrap',
			},
		},
			h('span', null, '默认模型与推理强度已整合至「模型」页，可直接在模型目录中一键切换。'),
			onNavigateModels
				? h('button', {
					className: 'agy-btn',
					style: S.btnSm,
					onClick: onNavigateModels,
					'aria-label': '前往模型页设置默认模型与推理强度',
				}, uiIcon('layers', 12), ' 前往「模型」页')
				: null,
		),
		h('div', { className: 'agy-rise', style: S.card },
			h('div', { style: { ...S.panelCaption, marginBottom: 'var(--agy-space-1)' } }, '基础连接与工具（POST /config）'),
			renderConfigRow('baseUrl', '上游地址 (baseUrl)', '高级：仅在你明确需要切换上游时填写'),
			renderSwitchRow('askTool', 'Ask 工具注册 (askTool)', '在 DSH 中注册 agy ask 工具开关', '切换 Ask 工具注册', '已注册', '未注册', true),
		),
		h('div', { className: 'agy-rise', style: { ...S.card, marginTop: 'var(--agy-space-3)' } },
			h('div', { style: { ...S.panelCaption, marginBottom: 'var(--agy-space-1)' } }, 'Gemini App (Robin) 双轨分流'),
			renderSwitchRow(
				'geminiAppOffloadEnabled',
				'无关工具任务分流至 Gemini App',
				'启用后将无工具调用请求自动分流至 Gemini App API（并同步启用 geminiAppEnabled）',
				'切换无关工具任务分流至 Gemini App',
			),
			renderSwitchRow(
				'geminiAppAskToolEnabled',
				'专家委派工具 (expert_ask)',
				'在主 Agent 会话中注册 expert_ask 工具并启用“脑手分离”委派规则，将思考、编码、审查、写作与推理任务交给 Robin API',
				'切换专家委派工具 expert_ask',
			),
			renderSwitchRow(
				'geminiAppFreshSessionSingleTurn',
				'小上下文单轮裁剪',
				'开启后在上下文较小时仅保留 system 与最后一条 user 消息起新会话',
				'切换小上下文单轮裁剪',
			),
			renderSwitchRow(
				'geminiAppOffloadFallbackToAgy',
				'失败自动回退 AGY',
				'Gemini App 首包前失败时自动无缝回退至 AGY 账号池',
				'切换失败自动回退 AGY',
			),
			h('div', { style: { display: 'flex', gap: 'var(--agy-space-2)', alignItems: 'center', padding: '10px 0', flexWrap: 'wrap' } },
				h('div', { style: { width: '210px', flexShrink: 0 } },
					h('div', { style: { fontSize: 'var(--agy-font-sm)', fontWeight: 700, color: 'var(--agy-text-primary)' } }, 'Gemini App Token'),
					h('div', {
						style: {
							fontSize: 'var(--agy-font-xs)',
							color: hasToken ? 'var(--agy-strong-ok)' : 'var(--agy-text-tertiary)',
							marginTop: '2px',
						},
					}, hasToken ? '状态：已配置（已脱敏）' : '状态：未配置'),
				),
				h('input', {
					type: 'password',
					className: 'agy-input',
					value: geminiAppTokenInput,
					placeholder: hasToken ? '已配置（输入新 Token 可覆盖）' : '粘贴 ya29.m.* Assistant OAuth Token',
					'aria-label': 'Gemini App Token',
					style: { ...S.input, flex: '1 1 240px', minWidth: '200px' },
					onChange: (e: { target: { value: string } }) => setGeminiAppTokenInput(e.target.value),
				}),
				h('button', {
					className: 'agy-btn',
					style: S.btnSmPrimary,
					disabled: isBusy || geminiAppTokenInput.trim() === '',
					onClick: () => {
						const val = geminiAppTokenInput.trim();
						void onSaveConfig('geminiAppToken', val).then((ok) => {
							if (ok === true) setGeminiAppTokenInput('');
						});
					},
				}, hasToken ? '更新' : '保存'),
				hasToken
					? h('button', {
						className: 'agy-btn',
						style: S.btnSm,
						disabled: isBusy,
						'aria-label': '清除 Gemini App Token',
						onClick: () => {
							void onSaveConfig('geminiAppToken', '').then((ok) => {
								if (ok === true) setGeminiAppTokenInput('');
							});
						},
					}, '清除')
					: null,
			),
		),
	);
}
