import type { AppConfig } from './config.js';
import type { ModelMode, ModelRoute } from './types.js';

const PRO_KEYWORDS = [
  '认真',
  '深聊',
  '分析',
  '怎么办',
  '难过',
  '崩溃',
  '焦虑',
  '失眠',
  '分手',
  '人生',
  '工作',
  '选择',
  '决定',
  '困惑',
  '压力',
];

export function chooseModelRoute(
  text: string,
  configuredMode: ModelMode,
  config: Pick<AppConfig, 'deepseek'>,
  forcePro = false,
): ModelRoute {
  if (forcePro) {
    return { mode: 'pro', model: config.deepseek.proModel, reason: 'forced' };
  }

  if (configuredMode === 'fast') {
    return { mode: 'fast', model: config.deepseek.fastModel, reason: 'mode-fast' };
  }

  if (configuredMode === 'pro') {
    return { mode: 'pro', model: config.deepseek.proModel, reason: 'mode-pro' };
  }

  const normalized = text.trim();
  const shouldUsePro =
    normalized.length >= 500 ||
    PRO_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (shouldUsePro) {
    return { mode: 'pro', model: config.deepseek.proModel, reason: 'auto-pro' };
  }

  return { mode: 'fast', model: config.deepseek.fastModel, reason: 'auto-fast' };
}
