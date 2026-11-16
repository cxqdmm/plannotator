import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  INBOX_PROMPT_HOSTS,
  type InboxPromptHost,
  type InboxPromptItem,
  type InboxPromptsChange,
  type InboxPromptsSettings,
} from '@plannotator/core/inbox-types';
import { inboxApi } from '../api';
import { tildePath } from '../format';
import { HostMark, Icon } from '../icons';
import { AgentRulesSection } from './AgentRules';
import { Tip } from './Tip';

/**
 * Settings → Prompts (design of record `.product/approved/inbox-prompts-page/`,
 * issue #2194): what Plannotator tells agents.
 *
 * The Inbox reminder first: the text in effect, always in full, marked
 * Default or Custom. Edit turns it into a field (Save, Cancel); once custom,
 * Reset to default and a "Show default" disclosure. Below it, in the same
 * card, each agent: the shared text, or its own (which wins). The page writes
 * only config.json `prompts.inbox` (Reset and Use shared delete the key);
 * whether the reminder is sent stays `inboxReminder`, in Settings → Agents.
 *
 * Then Guided reviews: the person's standing instructions for every guide
 * (`guide-instructions.md`, the same file the review UI's guide launch and
 * VS Code edit), Default (none) or Custom, the same Edit and Reset.
 *
 * Then the plan, review and annotate prompts, read-only, folded into one row.
 */

const AGENT_NAME: Record<InboxPromptHost, string> = { 'claude-code': 'Claude Code', pi: 'Pi', opencode: 'OpenCode' };

/** The count shows from here; past `max` Save is refused. */
export const PROMPT_COUNT_FROM = 8000;
/** The guide instructions' count shows this close to their cap (12,000): from 11,000, as on the review page's guide launch. */
const GUIDE_COUNT_WITHIN = 1000;

type ReminderSlot = 'shared' | InboxPromptHost;
type Slot = ReminderSlot | 'guide';

/** The phone's list of sections: Default, or Custom once any reminder text or guide instructions are the person's own. */
export function promptsSummary(prompts: InboxPromptsSettings): string {
  const rules = prompts.rules;
  const ruled = rules ? rules.shared !== null || INBOX_PROMPT_HOSTS.some((host) => rules.runtimes[host] !== null) : false;
  return reminderCustom(prompts) || ruled || Boolean(prompts.guide?.text) ? '自定义' : '默认';
}

function reminderCustom(prompts: InboxPromptsSettings): boolean {
  const { shared, runtimes } = prompts.reminder;
  return shared !== null || INBOX_PROMPT_HOSTS.some((host) => runtimes[host] !== null);
}

function Chip({ custom }: { custom: boolean }) {
  return <span className={`ib-chip${custom ? ' pm-custom' : ''}`}>{custom ? '自定义' : '默认'}</span>;
}

function Chevron() {
  return <Icon name="chevR" />;
}

export function PromptsSection({
  prompts,
  onPrompts,
  configFile = '~/.plannotator/config.json',
  home = null,
}: {
  prompts: InboxPromptsSettings;
  onPrompts?: (next: InboxPromptsSettings) => void;
  /** Where config.json is, in full. */
  configFile?: string;
  /** The home folder, shown as `~` in the config.json path (the full path in a tooltip). */
  home?: string | null;
}) {
  const { reminder } = prompts;
  const id = useId();
  const [editing, setEditing] = useState<Slot | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ slot: Slot; text: string } | null>(null);
  const [showDefault, setShowDefault] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(() => prompts.reminder.over?.shared != null || INBOX_PROMPT_HOSTS.some((host) => prompts.reminder.over?.runtimes[host] != null));
  const field = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** After Save, Cancel, Reset or Use shared: the control focus goes back to. */
  const focusAfter = useRef<string | null>(null);

  const defaultText = reminder.defaults.wake;
  const sharedText = reminder.shared ?? defaultText;
  /** An agent's default: the no-wake line where its reply does not come back by itself (OpenCode 1). */
  const wakes = (host: InboxPromptHost) => reminder.wakes?.[host] !== false;
  const agentDefault = (host: InboxPromptHost) => (wakes(host) ? defaultText : reminder.defaults.no_wake);
  /** What an agent gets now: its own text, else the shared text, else its own default. */
  const effectiveOf = (host: InboxPromptHost) => reminder.runtimes[host] ?? reminder.shared ?? agentDefault(host);
  const guide = prompts.guide;
  const currentOf = (slot: Slot) => (slot === 'guide' ? (guide?.text ?? '') : slot === 'shared' ? sharedText : effectiveOf(slot));
  const overShared = reminder.over?.shared ?? null;
  /** A calm line for text config.json holds over the limit (ignored, so the next text in line goes). */
  const overNote = (length: number, slot: ReminderSlot) => (
    <p className="pm-over" data-prompt-over={slot}>
      config.json 中的文本有 {length.toLocaleString('zh-CN')} 个字符，超过了 {reminder.max.toLocaleString('zh-CN')} 的上限，因此已被忽略。
    </p>
  );

  // A field that opens takes focus with the caret at its end, sized to its text.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [editing, draft]);
  useEffect(() => {
    const el = field.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  useEffect(() => {
    if (!focusAfter.current) return;
    const target = root.current?.querySelector<HTMLElement>(focusAfter.current);
    focusAfter.current = null;
    target?.focus();
  });

  const save = async (slot: Slot, text: string | null, refocus: string) => {
    setSaving(true);
    setError(null);
    const change: InboxPromptsChange =
      slot === 'guide' ? { guide: text } : slot === 'shared' ? { inbox: { reminder: text } } : { inbox: { runtimes: { [slot]: { reminder: text } } } };
    try {
      const saved = await inboxApi.savePrompts(change);
      onPrompts?.(saved.prompts);
      setEditing(null);
      focusAfter.current = refocus;
    } catch (cause) {
      setError({ slot, text: cause instanceof Error ? cause.message : slot === 'guide' ? '指令未保存。' : '提醒未保存。' });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (slot: Slot) => {
    setError(null);
    setDraft(currentOf(slot));
    setEditing(slot);
  };
  const cancel = (slot: Slot) => {
    setEditing(null);
    setError(null);
    focusAfter.current = `[data-prompt-edit="${slot}"]`;
  };

  const errorLine = (slot: Slot): ReactNode =>
    error?.slot === slot ? (
      <p className="pm-err" role="alert" data-prompt-error={slot}>
        {error.text}
      </p>
    ) : null;

  const editor = (slot: Slot) => {
    const length = draft.length;
    const max = slot === 'guide' ? (guide?.max ?? reminder.max) : reminder.max;
    const countFrom = slot === 'guide' ? max - GUIDE_COUNT_WITHIN : PROMPT_COUNT_FROM;
    const over = length > max;
    const own = slot === 'guide' ? guide?.text : slot === 'shared' ? reminder.shared : reminder.runtimes[slot];
    const changed = draft !== currentOf(slot) || (slot !== 'shared' && slot !== 'guide' && own === null);
    const can = draft.trim() !== '' && !over && changed && !saving;
    const countId = `${id}-count-${slot}`;
    const submit = () => {
      if (!can) return;
      const text = draft.trim() ? draft : null;
      // Saving Plannotator's own text as the shared text is the default again: the key goes.
      void save(slot, slot === 'shared' && text === defaultText ? null : text, `[data-prompt-edit="${slot}"]`);
    };
    return (
      <>
        <textarea
          ref={field}
          className="pm-area"
          value={draft}
          aria-label={slot === 'guide' ? '引导评审指令' : slot === 'shared' ? '收件箱提醒' : `${AGENT_NAME[slot]} 的收件箱提醒`}
          placeholder={slot === 'guide' ? '例如：从风险最高的改动开始。把 tenant 称为 workspace。' : undefined}
          aria-describedby={length >= countFrom ? countId : undefined}
          aria-invalid={over || undefined}
          data-prompt-field={slot}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="pm-acts">
          <button type="button" className="ib-btn ib-sm ib-pri" disabled={!can} onClick={submit} data-prompt-save={slot}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="ib-btn ib-sm ib-ghost pm-ghost" onClick={() => cancel(slot)} data-prompt-cancel={slot}>
            取消
          </button>
          <span className="pm-sp" />
          {length >= countFrom && (
            <span className="pm-count" id={countId} data-over={over || undefined} data-prompt-count="">
              {length.toLocaleString('zh-CN')} / {max.toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        {errorLine(slot)}
      </>
    );
  };

  const sharedCustom = reminder.shared !== null;
  const sharedEditing = editing === 'shared';
  const defaultId = `${id}-default`;

  const shared = (
    <div className="pm-shared" data-prompt-slot="shared">
      <div className="pm-head">
        <Chip custom={sharedCustom} />
        <span className="pm-sp" />
        {!sharedEditing && (
          <>
            {(sharedCustom || overShared !== null) && (
              <Tip content="删除 prompts.inbox.reminder：每个 agent 都会重新收到 Plannotator 的文本">
                <button
                  type="button"
                  className="ib-btn ib-sm ib-ghost pm-ghost"
                  disabled={saving}
                  onClick={() => {
                    setShowDefault(false);
                    void save('shared', null, '[data-prompt-edit="shared"]');
                  }}
                  data-prompt-reset=""
                >
                  恢复默认
                </button>
              </Tip>
            )}
            <button type="button" className="ib-btn ib-sm" onClick={() => startEdit('shared')} data-prompt-edit="shared" aria-label="编辑收件箱提醒">
              编辑
            </button>
          </>
        )}
      </div>
      {sharedEditing ? (
        editor('shared')
      ) : (
        <>
          <p className="pm-text" data-prompt-text="shared">
            {sharedText}
          </p>
          {!sharedCustom && overShared !== null && overNote(overShared, 'shared')}
          {sharedCustom && (
            <>
              <button type="button" className="pm-disc" aria-expanded={showDefault} aria-controls={defaultId} onClick={() => setShowDefault((open) => !open)} data-prompt-show-default="">
                <Chevron />
                显示默认文本
              </button>
              {showDefault && (
                <p className="pm-text pm-faint" id={defaultId} aria-label="默认文本" data-prompt-default="">
                  {defaultText}
                </p>
              )}
            </>
          )}
          {errorLine('shared')}
        </>
      )}
    </div>
  );

  const agent = (host: InboxPromptHost) => {
    const own = reminder.runtimes[host];
    const isEditing = editing === host;
    const name = AGENT_NAME[host];
    const over = own === null ? (reminder.over?.runtimes[host] ?? null) : null;
    // OpenCode 1 with nothing custom: its own default (the no-wake line), shown, since it differs from the one above.
    const ownDefault = own === null && reminder.shared === null && !wakes(host);
    const status = own !== null ? '自己的文本' : ownDefault ? '使用 OpenCode 1 的默认文本' : '使用共享文本';
    return (
      <div className="pm-ag" data-agent={host} data-prompt-slot={host} key={host}>
        <div className="ib-prow">
          <HostMark host={host} big />
          <span className="ib-txt">
            <span className="ib-l">{name}</span>
            <span className="ib-desc" data-prompt-status={host}>
              {status}
              {!reminder.on[host] && (
                <>
                  {' · 提醒已在 '}
                  <a href="#settings/agents" data-prompt-agents-link="">
                    agent
                  </a>
                  {' 中关闭'}
                </>
              )}
            </span>
          </span>
          <span className="ib-ctl">
            {!isEditing && (
              <>
                {(own !== null || over !== null) && (
                  <Tip content={`删除 ${name} 自己的文本：它将重新使用共享文本`}>
                    <button
                      type="button"
                      className="ib-btn ib-sm ib-ghost pm-ghost"
                      disabled={saving}
                      onClick={() => void save(host, null, `[data-prompt-edit="${host}"]`)}
                      data-prompt-use-shared={host}
                    >
                      使用共享
                    </button>
                  </Tip>
                )}
                <button
                  type="button"
                  className={`ib-btn ib-sm${own !== null ? '' : ' ib-ghost pm-ghost'}`}
                  onClick={() => startEdit(host)}
                  data-prompt-edit={host}
                  aria-label={`编辑 ${name} 的收件箱提醒`}
                >
                  编辑
                </button>
              </>
            )}
          </span>
        </div>
        {isEditing ? (
          <div className="pm-ag-body">{editor(host)}</div>
        ) : own !== null || ownDefault ? (
          <div className="pm-ag-body">
            <p className={`pm-text${ownDefault ? ' pm-faint' : ''}`} data-prompt-text={host}>
              {own ?? agentDefault(host)}
            </p>
            {over !== null && overNote(over, host)}
            {errorLine(host)}
          </div>
        ) : over !== null || error?.slot === host ? (
          <div className="pm-ag-body">
            {over !== null && overNote(over, host)}
            {errorLine(host)}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div ref={root} data-prompts-page="">
      {prompts.rules && <AgentRulesSection rules={prompts.rules} onPrompts={onPrompts} />}
      <section className={prompts.rules ? 'ib-sgroup' : 'ib-sgroup ib-sgroup-first'} aria-labelledby={`${id}-rem`}>
        <h2 id={`${id}-rem`}>收件箱提醒</h2>
        <p>在会话开始时发送一次。</p>
        <div className="ib-card">
          <button type="button" className="pm-fold" aria-expanded={reminderOpen} aria-controls={`${id}-rem-body`} onClick={() => setReminderOpen((open) => !open)} data-prompts-reminder-fold="">
            <Chevron />
            提醒文本
            <span className="ib-mut">· {reminderCustom(prompts) ? '自定义' : '默认'}</span>
          </button>
          {reminderOpen && (
            <div id={`${id}-rem-body`} className="pm-rem-body" data-prompts-reminder="">
              {shared}
              {INBOX_PROMPT_HOSTS.map(agent)}
            </div>
          )}
        </div>
      </section>
      {guide && (
        <section className="ib-sgroup" aria-labelledby={`${id}-guide`}>
          <h2 id={`${id}-guide`}>引导评审</h2>
          <p>会添加到每次引导评审中，来自收件箱、评审页面或 VS Code。</p>
          <div className="ib-card">
            <div className="pm-shared" data-prompt-slot="guide">
              <div className="pm-head">
                <Chip custom={guide.text !== null} />
                <span className="pm-sp" />
                {editing !== 'guide' && (
                  <>
                    {guide.text !== null && (
                      <Tip content="删除你的指令：引导将仅遵循 Plannotator 的方法">
                        <button type="button" className="ib-btn ib-sm ib-ghost pm-ghost" disabled={saving} onClick={() => void save('guide', null, '[data-prompt-edit="guide"]')} data-prompt-reset="guide">
                          恢复默认
                        </button>
                      </Tip>
                    )}
                    <button type="button" className="ib-btn ib-sm" onClick={() => startEdit('guide')} data-prompt-edit="guide" aria-label="编辑引导评审指令">
                      编辑
                    </button>
                  </>
                )}
              </div>
              {editing === 'guide' ? (
                editor('guide')
              ) : (
                <>
                  {guide.text !== null && (
                    <p className="pm-text" data-prompt-text="guide">
                      {guide.text}
                    </p>
                  )}
                  {errorLine('guide')}
                </>
              )}
            </div>
          </div>
        </section>
      )}
      <OtherPrompts others={prompts.others} open={otherOpen} onToggle={() => setOtherOpen((open) => !open)} configFile={configFile} home={home} />
    </div>
  );
}

function OtherPrompts({ others, open, onToggle, configFile, home }: { others: InboxPromptItem[]; open: boolean; onToggle: () => void; configFile: string; home: string | null }) {
  const shown = tildePath(configFile, home);
  const id = useId();
  const customs = others.filter((item) => item.custom).length;
  const groups: { label: string; items: InboxPromptItem[] }[] = [];
  for (const item of others) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group_label) last.items.push(item);
    else groups.push({ label: item.group_label, items: [item] });
  }
  const agents = (runtimes: string[]) =>
    runtimes.map((runtime) => AGENT_NAME[runtime as InboxPromptHost] ?? runtime).join(', ');
  return (
    <section className="ib-sgroup" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>计划、评审与批注</h2>
      <p>
        此处只读。请在{' '}
        {shown === configFile ? (
          <code className="pm-path" data-prompts-config-path="">{shown}</code>
        ) : (
          <Tip content={configFile}>
            <code className="pm-path" data-prompts-config-path="">{shown}</code>
          </Tip>
        )}
        {' 中设置。'}
      </p>
      <div className="ib-card">
        <button type="button" className="pm-fold" aria-expanded={open} aria-controls={`${id}-list`} onClick={onToggle} data-prompts-fold="">
          <Chevron />
          {others.length} 条提示词
          <span className="ib-mut">{customs ? `· ${customs} 条自定义` : '· 全部为默认'}</span>
        </button>
        {open && (
          <div id={`${id}-list`} data-prompts-list="">
            {groups.map((group) => (
              <div className="pm-osec" key={group.label}>
                <h3>{group.label}</h3>
                {group.items.map((item) => (
                  <div className="pm-oitem" key={item.key} data-prompt-key={item.key}>
                    <div className="pm-ohead">
                      <b>{item.label}</b>
                      <Chip custom={item.custom} />
                      <code>{item.key}</code>
                    </div>
                    <pre className="pm-otext">{item.text}</pre>
                    {item.runtimes.length > 0 && <p className="pm-onote">{agents(item.runtimes)}：在 config.json 中使用自己的文本。</p>}
                    {item.note && !item.custom && <p className="pm-onote">{item.note}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
