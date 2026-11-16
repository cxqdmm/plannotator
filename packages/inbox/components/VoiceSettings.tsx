/**
 * Settings → Voice. Off shows the switch and the plain line about the route, and starts nothing. On asks the Inbox
 * about this computer (`account/read` through a short-lived Codex: the sign-in type and plan, never a token).
 *
 * A key typed here goes to the Inbox and never comes back: the page holds at most its last 4. The owner sets it on the
 * computer or over the tailnet's HTTPS.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { InboxVoiceEngine, InboxVoiceStatus } from '@plannotator/core/inbox-types';
import { inboxApi } from '../api';
import { Icon } from '../icons';
import { adoptVoiceSettings, checkVoiceStatus, useVoiceSettings, useVoiceStatus, voiceWhere } from '../voice';

function Toggle({ on, labelledBy, onClick }: { on: boolean; labelledBy: string; onClick: () => void }) {
  return <button type="button" role="switch" className="ib-sw" aria-checked={on} aria-labelledby={labelledBy} onClick={onClick} />;
}

const ROUTE_LINE = '你的音频会通过 Codex 中的 ChatGPT 登录发送给 OpenAI。这条通道不是 OpenAI 官方 API，可能随时停止工作。';
const TERMS_LINE = 'OpenAI 针对你 ChatGPT 账户的条款适用。';

function CodexStatus({ where, status, checking }: { where: string; status: InboxVoiceStatus | null; checking: boolean }) {
  const line = (): { label: ReactNode; desc: ReactNode; ok?: boolean } => {
    if (checking || !status) return { label: '正在检查 Codex', desc: `正在询问 ${where} 上的 Codex 谁已登录。` };
    switch (status.state) {
      case 'ready':
        return { ok: true, label: '已使用 ChatGPT 登录', desc: `${where} 上的 Codex 已登录${status.plan ? `，套餐为 ${status.plan.charAt(0).toUpperCase()}${status.plan.slice(1)}` : ''}。` };
      case 'missing':
        return { label: 'Codex 未安装', desc: `请先在 ${where} 上安装 Codex，然后重新检查。也可以使用 OpenAI API 密钥。` };
      case 'signedout':
        return {
          label: 'Codex 未登录',
          desc: (
            <>
              请在 {where} 上运行 <code>codex login</code> 并选择 ChatGPT，然后重新检查。
            </>
          ),
        };
      case 'apikey':
        return {
          label: 'Codex 正在使用 API 密钥',
          desc: (
            <>
              通过 Codex 使用语音需要 ChatGPT 登录。<code>codex login</code> 会更改 Codex 自身使用的登录方式，因此这里可能更适合使用 OpenAI API 密钥。
            </>
          ),
        };
      case 'other':
        return { label: 'Codex 使用了其他登录方式', desc: '通过 Codex 使用语音需要 ChatGPT 登录。也可以使用 OpenAI API 密钥。' };
      default:
        return { label: 'Codex 没有响应', desc: `请重新检查，或确认 Codex 可在 ${where} 上运行。也可以使用 OpenAI API 密钥。` };
    }
  };
  const state = line();
  return (
    <div className="ib-prow" data-voice-status={checking || !status ? 'checking' : status.state}>
      <span className="ib-txt">
        <span className="ib-l">
          {state.ok ? (
            <span className="ib-paired">
              <Icon name="check" size={14} />
              {state.label}
            </span>
          ) : (
            state.label
          )}
        </span>
        <span className="ib-desc">{state.desc}</span>
      </span>
      <span className="ib-ctl">
        {checking ? (
          <span className="ib-spin" />
        ) : (
          <button type="button" className="ib-btn" onClick={() => void checkVoiceStatus(true)} data-voice-check="">
            重新检查
          </button>
        )}
      </span>
    </div>
  );
}

function ApiKey({ onError }: { onError: (message: string | null) => void }) {
  const voice = useVoiceSettings();
  const [replacing, setReplacing] = useState(false);
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const key = voice?.key;
  const save = async (next: string | null) => {
    if (!voice) return;
    setSaving(true);
    onError(null);
    try {
      const saved = await inboxApi.saveVoiceKey(next);
      adoptVoiceSettings({ ...voice, key: saved.key });
      setReplacing(false);
      setTyped('');
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '密钥未保存。');
    } finally {
      setSaving(false);
    }
  };
  if (key?.source === 'env')
    return (
      <div className="ib-prow" data-voice-key="env">
        <span className="ib-txt">
          <span className="ib-l">正在使用 OPENAI_API_KEY</span>
          <span className="ib-desc">它已在此收件箱的环境中设置，因此无需在此粘贴。</span>
        </span>
      </div>
    );
  if (key?.source === 'saved' && !replacing)
    return (
      <div className="ib-prow" data-voice-key="saved">
        <span className="ib-txt">
          <span className="ib-l">
            <span className="ib-paired">
              <Icon name="check" size={14} />
              密钥已保存，结尾为 {key.last4}
            </span>
          </span>
          <span className="ib-desc">保存在 {voiceWhere(voice)} 上。之后不会再显示，也不会发送到任何页面。</span>
        </span>
        <span className="ib-ctl">
          <button type="button" className="ib-btn" onClick={() => setReplacing(true)} data-voice-key-replace="">
            替换
          </button>
          <button type="button" className="ib-btn ib-ghost" disabled={saving} onClick={() => void save(null)} data-voice-key-remove="">
            移除
          </button>
        </span>
      </div>
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim()) void save(typed);
  };
  return (
    <form className="ib-prow ib-vkeyrow" onSubmit={submit} data-voice-key="empty">
      <span className="ib-txt">
        <label className="ib-l" htmlFor="ib-vkey">
          API 密钥
        </label>
        <span className="ib-desc">保存在 {voiceWhere(voice)} 上。之后不会再显示，也不会发送到任何页面。</span>
      </span>
      <span className="ib-ctl ib-vkeyctl">
        <input id="ib-vkey" className="ib-vkey" type="password" autoComplete="new-password" spellCheck={false} placeholder="sk-…" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <button type="submit" className="ib-btn" disabled={saving || !typed.trim()}>
          保存
        </button>
      </span>
    </form>
  );
}

export function VoiceSettings() {
  const voice = useVoiceSettings();
  const { status, checking } = useVoiceStatus();
  const [error, setError] = useState<string | null>(null);
  const on = voice?.on === true;
  const engine = voice?.engine ?? 'codex';
  const where = voiceWhere(voice);
  useEffect(() => {
    if (on && engine === 'codex') void checkVoiceStatus();
  }, [on, engine]);
  if (!voice) return null;
  const save = async (change: { on?: boolean; phones_only?: boolean; engine?: InboxVoiceEngine }) => {
    setError(null);
    adoptVoiceSettings({
      ...voice,
      on: change.on ?? voice.on,
      phones_only: change.phones_only ?? voice.phones_only,
      engine: change.engine ?? voice.engine,
    });
    try {
      adoptVoiceSettings((await inboxApi.saveVoice(change)).voice);
    } catch (cause) {
      adoptVoiceSettings(voice);
      setError(cause instanceof Error ? cause.message : '设置未保存。');
    }
  };
  return (
    <>
      <section className="ib-sgroup ib-sgroup-first" data-settings-voice="" aria-label="语音">
        <div className="ib-card">
          <div className="ib-prow">
            <span className="ib-txt">
              <span className="ib-l" id="ib-voice-label">
                语音
              </span>
              <span className="ib-desc">在回复框中添加麦克风。按住说话，或点按它。你的话会出现在输入框中，然后你按下发送。</span>
            </span>
            <span className="ib-ctl">
              <Toggle on={on} labelledBy="ib-voice-label" onClick={() => void save({ on: !on })} />
            </span>
          </div>
          {on && (
            <div className="ib-prow">
              <span className="ib-txt">
                <span className="ib-l" id="ib-voice-phones-label">
                  仅手机
                </span>
                <span className="ib-desc">在电脑上隐藏麦克风。手机负责录音，由 {where} 将音频转成文字。</span>
              </span>
              <span className="ib-ctl">
                <Toggle on={voice.phones_only} labelledBy="ib-voice-phones-label" onClick={() => void save({ phones_only: !voice.phones_only })} />
              </span>
            </div>
          )}
        </div>
        {!on && (
          <p className="ib-vpage-note">
            {ROUTE_LINE} {TERMS_LINE} 关闭时不会运行任何内容。
          </p>
        )}
      </section>
      {on && (
        <section className="ib-sgroup" aria-labelledby="ib-g-voice-engine">
          <h2 id="ib-g-voice-engine">转写</h2>
          <p>{engine === 'codex' ? `${ROUTE_LINE} ${TERMS_LINE}` : '你的音频会使用你自己的密钥发送到 OpenAI 的公开语音转文字 API。OpenAI 会按音频分钟数向你的 API 账户计费。'}</p>
          <div className="ib-card">
            <div className="ib-prow">
              <span className="ib-txt">
                <span className="ib-l" id="ib-voice-engine-label">
                  转写方式
                </span>
              </span>
              <span className="ib-ctl">
                <span className="ib-seg" role="radiogroup" aria-labelledby="ib-voice-engine-label">
                  {(
                    [
                      ['codex', 'Codex 登录'],
                      ['api', 'OpenAI API 密钥'],
                    ] as const
                  ).map(([id, label]) => (
                    <label key={id} className="ib-seg-o" data-on={engine === id ? '' : undefined}>
                      <input type="radio" name="ib-voice-engine" value={id} checked={engine === id} onChange={() => void save({ engine: id })} />
                      {label}
                    </label>
                  ))}
                </span>
              </span>
            </div>
            {engine === 'codex' ? <CodexStatus where={where} status={status} checking={checking} /> : <ApiKey onError={setError} />}
          </div>
        </section>
      )}
      {error && (
        <div className="ib-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
