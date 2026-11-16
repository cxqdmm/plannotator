/**
 * Combine… (approval "inbox-multi-select", 4A "One agent writes a new thread"): the person picks who writes it, may
 * say what it should be about, and presses Combine. Nothing is archived now: the picked threads go to the archive once
 * the new thread arrives (inbox-combine.ts), and the toast's Undo stops it until then (useCombines.ts).
 *
 * Who can be asked: a running session that wrote in a picked thread, on the machine that holds them, since an agent
 * reads only its own machine's threads. Threads on two machines, or on a machine that cannot be asked now, are said so
 * and nobody is offered.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { InboxCombineAgent, InboxCombineRecord, InboxListRow } from '@plannotator/core/inbox-types';
import { INBOX_COMBINE_WORDS_MAX, inboxCombineAgentApart, inboxCombineAgentLabel, inboxTidyWords } from '@plannotator/core/inbox-types';
import { formatCount, whenTime } from '@plannotator/core/inbox-format';
import { combineApi } from '../combineApi';
import { PressKeys } from '../pressKeys';
import { HostMark } from '../icons';
import { isAway, rowMachine, type MachinesModel } from '../machines';
import { Modal } from './Updates';

/** Agents listed before "Show N more": the top writers, and room for the field and buttons on a phone. */
const FIRST = 4;
const NO_MACHINES: MachinesModel = { self: null, all: [], linked: [], names: new Map(), away: new Set() };

/** Why nobody can be asked about these threads, or null when their machine can be. */
export function combineBlocked(rows: readonly InboxListRow[], machines: MachinesModel): string | null {
  const held = [...new Set(rows.map((row) => rowMachine(row, machines)))];
  const nameOf = (id: string | null) => (id === null ? (machines.all.find((m) => m.self)?.name ?? '这台计算机') : (machines.names.get(id) ?? '另一台计算机'));
  if (held.length > 1) {
    const names = held.map(nameOf);
    return `这些会话位于 ${names.length} 台计算机上：${names.slice(0, -1).join('、')} 和 ${names[names.length - 1]}。agent 只能读取自己所在计算机上的会话：请选择同一台计算机上的会话再合并。`;
  }
  const machine = held[0] ?? null;
  const view = machine ? machines.linked.find((m) => m.id === machine) : null;
  if (machine && (!view || isAway(view))) return `${nameOf(machine)} 现在无法响应：它已离线。`;
  if (machine && !(view!.marks ?? []).includes('combine')) return `${nameOf(machine)} 运行的是较旧版本的 Plannotator：请更新后再合并它的会话。`;
  return null;
}

export function CombineDialog({ rows, machines = NO_MACHINES, onClose, onStarted }: { rows: readonly InboxListRow[]; machines?: MachinesModel; onClose: () => void; onStarted: (record: InboxCombineRecord, machine: string | null) => void }) {
  const id = useId();
  const n = rows.length;
  const blocked = combineBlocked(rows, machines);
  const machine = rows[0] ? rowMachine(rows[0], machines) : null;
  const machineName = machine ? machines.names.get(machine) : null;
  const [agents, setAgents] = useState<InboxCombineAgent[] | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A double press or a retry after a lost answer starts one Combine; a refusal frees the key for a changed pick.
  const [keys] = useState(() => new PressKeys('combine'));
  // Two presses before the button greys out read the same `sending`: this one is set at once.
  const pressed = useRef(false);
  const ids = rows.map((row) => row.thread_id).join(',');
  useEffect(() => {
    if (blocked) return;
    let live = true;
    combineApi
      .plan(ids.split(','), machine)
      .then((plan) => {
        if (!live) return;
        setAgents(plan.agents ?? []);
        setWho((current) => current ?? plan.agents?.[0]?.session ?? null);
      })
      .catch((cause) => live && (setAgents([]), setError(cause instanceof Error ? cause.message : '无法读取可以响应的 agent。')));
    return () => {
      live = false;
    };
  }, [ids, machine, blocked]);
  const [shown, setShown] = useState(FIRST);
  const chosen = agents?.find((a) => a.session === who) ?? null;
  // Down from the last row shown shows them all and moves on, so the arrows reach every agent.
  const focusAgent = (session: string) => requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-combine-agent="${CSS.escape(session)}"] input`)?.focus());
  const onArrow = (event: KeyboardEvent) => {
    if (!agents || shown >= agents.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowRight')) return;
    if (agents.findIndex((a) => a.session === who) !== shown - 1) return;
    event.preventDefault();
    const next = agents[shown]!.session;
    setShown(agents.length);
    setWho(next);
    focusAgent(next);
  };
  const nameOf = (agent: InboxCombineAgent) => inboxCombineAgentLabel(agent, agents ?? []);
  const combine = async () => {
    if (!chosen || pressed.current) return;
    pressed.current = true;
    setSending(true);
    setError(null);
    try {
      const words1 = inboxTidyWords(words);
      const { combine: record } = await combineApi.start({ thread_ids: rows.map((row) => row.thread_id), session: chosen.session, idempotency_key: keys.for(), ...(words1 ? { words: words1 } : {}) }, machine);
      onStarted(record, machine);
      onClose();
    } catch (cause) {
      keys.failed(null, cause);
      pressed.current = false;
      setSending(false);
      setError(cause instanceof Error ? cause.message : '合并未能启动。');
    }
  };
  // Cancel takes the focus: Combine is greyed until the agents are read, and a focused field would open a phone's keyboard.
  return (
    <Modal labelledBy={`${id}-title`} describedBy={`${id}-lede`} testId="combine" onClose={onClose} ownKeys className="ib-cmb" initialFocus=".ib-btn">
      <div className="ib-dlg-in">
        <h2 id={`${id}-title`}>合并 {n} 个会话</h2>
        <p className="ib-sub" id={`${id}-lede`}>
          一个 agent 会读取这些会话，并新建一个会话来汇总当前进展。新会话到达后，这些会话将归档。
        </p>
        {blocked ? (
          <p className="ib-cmb-why" role="note">
            {blocked}
          </p>
        ) : (
          <>
            <fieldset className="ib-cmb-who">
              <legend>由谁撰写</legend>
              {agents === null && <p className="ib-cmb-why">正在查找这些会话的 agent…</p>}
              {agents?.length === 0 && !error && <p className="ib-cmb-why">在这些会话中写过的 agent 都没有在运行。合并需要一个 agent 来读取它们并撰写新会话。</p>}
              <div className="ib-cmb-list" data-all={shown === agents?.length && (agents?.length ?? 0) > FIRST ? '' : undefined} onKeyDown={onArrow}>
              {agents?.slice(0, shown).map((agent) => (
                <label key={agent.session} className="ib-cmb-opt" data-on={agent.session === who ? '' : undefined} data-combine-agent={agent.session}>
                  <input type="radio" name={`${id}-who`} checked={agent.session === who} onChange={() => setWho(agent.session)} />
                  <HostMark host={agent.host} agent={agent.session} />
                  <span className="ib-cmb-nm">
                    <b dir="auto">{nameOf(agent)}</b>
                    <small>
                      其中 {agent.threads} 个
                      {inboxCombineAgentApart(agent, agents, (iso) => whenTime(iso)).map((part) => ` · ${part}`).join('')}
                      {machineName ? ` · ${machineName}` : ''}
                    </small>
                  </span>
                </label>
              ))}
              </div>
              {agents && shown < agents.length && (
                <button type="button" className="ib-cmb-more" onClick={() => {
                    // The button goes: the focus moves to the first agent it showed.
                    focusAgent(agents[shown]!.session);
                    setShown(agents.length);
                  }} data-combine-more="">
                  再显示 {formatCount(agents.length - shown)} 个
                </button>
              )}
            </fieldset>
            <label className="ib-cmb-lbl" htmlFor={`${id}-words`}>
              想让它聚焦什么？（可选）
            </label>
            <textarea id={`${id}-words`} className="ib-cmb-words" rows={3} maxLength={INBOX_COMBINE_WORDS_MAX} placeholder="例如：只要计费发布相关的工作，去掉 CSV 的细节" value={words} onChange={(event) => setWords(event.target.value)} data-combine-words="" />
            {chosen && (
              <p className="ib-cmb-what">
                <b dir="auto">{nameOf(chosen)}</b> 会收到一个包含 {n} 个会话的提示词。未解决的问题会在新会话中再次提出。撤销可以恢复这 {formatCount(n)} 个会话。
              </p>
            )}
          </>
        )}
        {error && (
          <p className="ib-cmb-err" role="alert">
            {error}
          </p>
        )}
        <div className="ib-cmb-btns">
          <button type="button" className="ib-btn" onClick={onClose} data-combine-cancel="">
            取消
          </button>
          <button type="button" className="ib-btn ib-pri" disabled={!chosen || sending || !!blocked} onClick={() => void combine()} data-combine-go="">
            合并
          </button>
        </div>
      </div>
    </Modal>
  );
}
