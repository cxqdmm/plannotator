import { useEffect, useId, useRef, useState } from 'react';
import { INBOX_PROMPT_HOSTS, type InboxPromptHost, type InboxPromptsChange, type InboxPromptsSettings } from '@plannotator/core/inbox-types';
import { inboxApi } from '../api';
import { RULES_COUNT_WITHIN, takeRulesEditorWish } from '../agentRules';
import { HostMark, Icon } from '../icons';
import { usePhone } from '../phone';
import { Modal } from './Updates';

type Rules = NonNullable<InboxPromptsSettings['rules']>;
type Slot = 'shared' | InboxPromptHost;

const AGENT_NAME: Record<InboxPromptHost, string> = { 'claude-code': 'Claude Code', pi: 'Pi', opencode: 'OpenCode' };
const SLOTS: Slot[] = ['shared', ...INBOX_PROMPT_HOSTS];
const slotName = (slot: Slot) => (slot === 'shared' ? '所有 agent' : AGENT_NAME[slot]);

export function AgentRulesSection({
  rules,
  onPrompts,
}: {
  rules: Rules;
  onPrompts?: (next: InboxPromptsSettings) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState<Slot | null>(null);
  const textOf = (slot: Slot) => (slot === 'shared' ? rules.shared : rules.runtimes[slot]);
  const set = SLOTS.filter((slot) => textOf(slot) !== null);
  useEffect(() => {
    if (takeRulesEditorWish()) setEditing('shared');
  }, []);

  return (
    <section className="ib-sgroup ib-sgroup-first" aria-labelledby={`${id}-h`} data-rules-section="">
      <h2 id={`${id}-h`}>给你的 agent 的规则</h2>
      <p>你写的话会附加在 agent 被告知的内容里。Plannotator 的原文保持不变。</p>
      <div className="ib-card">
        {set.length === 0 ? (
          <div className="ar-empty">
            <span className="ar-ic" aria-hidden="true">
              <Icon name="prompt" size={17} />
            </span>
            <span className="ar-t">
              <span className="ar-l">还没有规则</span>
            </span>
            <button type="button" className="ib-btn ib-sm ib-pri" onClick={() => setEditing('shared')} data-rules-add="">
              添加规则
            </button>
          </div>
        ) : (
          set.map((slot) => (
            <div className="pm-shared ar-slot" key={slot} data-rules-slot={slot}>
              <div className="pm-head">
                {slot === 'shared' ? <span className="ib-chip pm-custom">所有 agent</span> : <span className="ar-who"><HostMark host={slot} />{AGENT_NAME[slot]}</span>}
                <span className="pm-sp" />
                <button type="button" className="ib-btn ib-sm" onClick={() => setEditing(slot)} data-rules-edit={slot} aria-label={`编辑 ${slotName(slot)} 的规则`}>
                  编辑
                </button>
              </div>
              <p className="pm-text" data-rules-text={slot}>
                {textOf(slot)}
              </p>
              {slot !== 'shared' && rules.dropped.includes(slot) && <DroppedNote hosts={[slot]} />}
              {slot === 'shared' && <DroppedNote hosts={rules.dropped.filter((host) => rules.runtimes[host] === null)} />}
            </div>
          ))
        )}
      </div>
      {editing && <RulesEditor rules={rules} first={editing} onClose={() => setEditing(null)} onPrompts={onPrompts} />}
    </section>
  );
}

function DroppedNote({ hosts }: { hosts: InboxPromptHost[] }) {
  if (hosts.length === 0) return null;
  return (
    <p className="pm-over" data-rules-dropped="">
      未发送给 {hosts.map((host) => AGENT_NAME[host]).join('、')}：加上提醒后太长了。请缩短一条。
    </p>
  );
}

function RulesEditor({ rules, first, onClose, onPrompts }: { rules: Rules; first: Slot; onClose: () => void; onPrompts?: (next: InboxPromptsSettings) => void }) {
  const phone = usePhone();
  const [slot, setSlot] = useState<Slot>(first);
  const saved = (which: Slot) => (which === 'shared' ? rules.shared : rules.runtimes[which]) ?? '';
  const [draft, setDraft] = useState(saved(first));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const room = slot === 'shared' ? rules.room.shared : rules.room.runtimes[slot];
  const length = draft.trim().length;
  const over = length > room;
  const own = saved(slot) !== '';
  const can = !saving && !over && draft.trim() !== saved(slot).trim() && draft.trim() !== '';

  const write = async (text: string | null) => {
    setSaving(true);
    setError(null);
    const change: InboxPromptsChange = slot === 'shared' ? { inbox: { rules: text } } : { inbox: { runtimes: { [slot]: { rules: text } } } };
    try {
      const next = await inboxApi.savePrompts(change);
      onPrompts?.(next.prompts);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则未能保存。');
      setSaving(false);
    }
  };
  const pick = (next: Slot) => {
    setSlot(next);
    setDraft(saved(next));
    setError(null);
  };

  return (
    <Modal labelledBy="ar-ed-title" describedBy="ar-ed-desc" testId="rules-editor" onClose={onClose} ownKeys initialFocus=".pm-area" className={`ib-bi ar-ed${phone ? ' ib-bi-phone' : ''}`}>
      <div className="ib-bi-text">
        <h2 id="ar-ed-title">给你的 agent 的规则</h2>
        <p id="ar-ed-desc">附加在 agent 被告知的收件箱说明里。Plannotator 的原文保持不变。</p>
        <textarea
          ref={field}
          className="pm-area ar-area"
          value={draft}
          rows={4}
          placeholder="写下你的规则，每行一条"
          aria-label={`${slotName(slot)} 的规则`}
          aria-invalid={over || undefined}
          onChange={(event) => setDraft(event.target.value)}
          data-rules-field=""
        />
        <div className="ar-lbl" id="ar-for">适用于</div>
        <div className="ar-seg" role="group" aria-labelledby="ar-for">
          {SLOTS.map((which) => (
            <button type="button" key={which} aria-pressed={which === slot} onClick={() => pick(which)} data-rules-for={which}>
              {slotName(which)}
            </button>
          ))}
        </div>
        <p className="ar-quiet">
          {slot === 'shared' ? '每个 agent 会在下一次会话中获得这些规则。' : `${AGENT_NAME[slot]} 会从下一次会话起使用这些规则，而不再使用所有 agent 的规则。`}
          {length >= room - RULES_COUNT_WITHIN && (
            <span className="pm-count" data-over={over || undefined} data-rules-count="">
              {' '}
              {length.toLocaleString('zh-CN')} / {room.toLocaleString('zh-CN')}
            </span>
          )}
        </p>
        {error && (
          <p className="pm-err" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ib-bi-acts">
        {own && (
          <button type="button" className="ib-btn ib-ghost" disabled={saving} onClick={() => void write(null)} data-rules-reset="">
            恢复默认
          </button>
        )}
        <span className="ib-bsp" />
        <button type="button" className="ib-btn ib-ghost" onClick={onClose} data-rules-cancel="">
          取消
        </button>
        <button type="button" className="ib-btn ib-pri" disabled={!can} onClick={() => void write(draft.trim())} data-rules-save="">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </Modal>
  );
}
