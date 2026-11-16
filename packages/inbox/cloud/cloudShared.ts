import type { KeyboardEvent } from 'react';
import type { InboxCloudPreset, InboxCloudSetup } from '@plannotator/core/inbox-cloud';
import { InboxApiError } from '../api';

export type Fresh = { setup: InboxCloudSetup | null };

export type WakeHint = { url: string; key: string; where: string };

const OTHER_HINT: WakeHint = {
  url: 'https://…',
  key: '以 Authorization: Bearer 发送',
  where: '任何接受携带 Bearer 密钥和 JSON 正文的 POST 请求的地址。',
};

const WAKE_HINTS: Partial<Record<InboxCloudPreset, WakeHint>> = {
  'claude-routine': {
    url: 'https://api.anthropic.com/v1/claude_code/routines/trig_…/fire',
    key: 'sk-ant-oat01-…',
    where: '在 claude.ai/code 的例行任务中：编辑 → 添加 API 触发器 → 生成令牌。复制 Fire URL 和令牌。',
  },
  'grok-bot': {
    url: '例行任务的“POST to”地址',
    key: '例行任务的密钥',
    where: '在桌面应用中打开例行任务的 Webhook 部分：复制“POST to”和密钥。',
  },
};

export const wakeHintOf = (preset: InboxCloudPreset): WakeHint => WAKE_HINTS[preset] ?? OTHER_HINT;

export const errorText = (cause: unknown) => (cause instanceof InboxApiError ? cause.message : '收件箱没有响应。请重试。');

export const noEnter = (event: KeyboardEvent) => {
  if (event.key === 'Enter') event.preventDefault();
};
