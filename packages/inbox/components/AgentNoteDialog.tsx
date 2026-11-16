import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { InboxAgentRow, InboxAgentsModel, InboxNoteAgentId } from '@plannotator/core/inbox-types';
import { INBOX_AGENT_LABELS } from '@plannotator/core/inbox-types';
import { inboxApi, type InboxNoteResult } from '../api';
import { CURSOR_RULES_PLACE, defaultPicks, joinNames, noteCopiedByHand, notePrimaryAction, noteResultLabel, noteWithoutMarkers, sentence, splitPath, tidyReason, whoLabel } from '../agents';
import { HostMark, Icon } from '../icons';
import { Modal } from './Updates';
import { isTextCut, Tip } from './Tip';

export interface AgentNoteDialogProps {
  /** The agents asked about (fixed when the dialog opens): the candidates not asked yet. */
  rows: InboxAgentRow[];
  /** The exact block a note writes (Show the note). */
  noteText: string;
  onModel: (next: InboxAgentsModel) => void;
  onClosed: () => void;
}

type RowStatus = { kind: 'busy' } | { kind: 'done'; result: InboxNoteResult };

/**
 * The note in each agent's instructions, asked once per agent in a one-time
 * dialog (the approved "inbox-agent-note-dialog" design, Checklist). Since
 * "inbox-agent-note-auto" the Inbox writes the note by itself for the agents
 * proven to load it, so this asks only about the others (Qwen Code, Cursor's
 * copy by hand); its "Connected …" band moved to the line above the list
 * (ConnectLine). One row per agent, all ticked; with one
 * agent no checkbox. The primary names who it adds to ("Don't add a note"
 * with nothing ticked: never disabled, never an error). Results show in the
 * same rows. Not now, Escape and the backdrop answer for these agents only;
 * nothing is written without the person's yes. On the sound dialog's shell,
 * no entrance motion.
 */
export function AgentNoteDialog({ rows, noteText, onModel, onClosed }: AgentNoteDialogProps) {
  const id = useId();
  const doneRef = useRef<HTMLButtonElement>(null);
  const [picks, setPicks] = useState<Record<string, boolean>>(() => defaultPicks(rows));
  const [preview, setPreview] = useState(false);
  const [phase, setPhase] = useState<'ask' | 'busy' | 'done'>('ask');
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [live, setLive] = useState('');
  const closed = useRef(false);
  // The results view takes focus on Done (the live region says what was written), and so does a
  // Try again that worked (its link is gone).
  const [focusDone, setFocusDone] = useState(0);
  useEffect(() => {
    if (phase === 'done') doneRef.current?.focus();
  }, [phase, focusDone]);

  const single = rows.length === 1;
  // Agents whose note is copied by hand (Cursor keeps its rules in the app): nothing is written for them, and
  // their copy never carries the marker lines, which promise a removal that never happens there.
  const handRows = rows.filter(noteCopiedByHand);
  const handOnly = handRows.length === rows.length;
  const handNames = joinNames(handRows.map((row) => row.label));
  const copyText = noteWithoutMarkers(noteText);
  const isManual = (agent: string) => {
    const result = status[agent];
    return result?.kind === 'done' && result.result.ok && result.result.action === 'manual';
  };
  const asked = rows.map((row) => row.id as InboxNoteAgentId);
  const picked = rows.filter((row) => picks[row.id]);
  const pickedWritten = picked.filter((row) => !noteCopiedByHand(row));
  const primary = notePrimaryAction(picked);
  const busy = phase === 'busy';

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    onClosed();
  };
  /** Not now, Don't add a note, Escape, the backdrop: nothing is written; these agents are not asked again. */
  const decline = () => {
    if (busy) return;
    close();
    inboxApi
      .answerNotes([], asked, false)
      .then(onModel)
      .catch(() => {});
  };
  const settle = (results: InboxNoteResult[]) => {
    setStatus((current) => {
      const next = { ...current };
      for (const result of results) next[result.agent] = { kind: 'done', result };
      return next;
    });
    const ok = results.filter((result) => result.ok && result.action !== 'manual').map((result) => INBOX_AGENT_LABELS[result.agent]);
    const manual = results.filter((result) => result.ok && result.action === 'manual').map((result) => INBOX_AGENT_LABELS[result.agent]);
    const bad = results.filter((result) => !result.ok).map((result) => INBOX_AGENT_LABELS[result.agent]);
    setLive(
      [
        ok.length ? `已将说明添加到 ${joinNames(ok)}。` : '',
        manual.length ? `下方显示了给 ${joinNames(manual)} 的说明，请自行复制到 ${CURSOR_RULES_PLACE}。` : '',
        bad.length ? `无法将说明添加到 ${joinNames(bad)}。` : '',
      ]
        .filter(Boolean)
        .join(''),
    );
  };
  const failedAll = (agents: InboxNoteAgentId[], err: unknown): InboxNoteResult[] =>
    agents.map((agent) => ({ ok: false, agent, reason: err instanceof Error ? err.message : String(err), path: null }));
  const add = async () => {
    if (busy) return;
    if (!primary.add) return decline();
    const agents = picked.map((row) => row.id as InboxNoteAgentId);
    setPhase('busy');
    let results: InboxNoteResult[];
    try {
      const next = await inboxApi.answerNotes(agents, asked, false);
      results = next.results;
      onModel(next);
    } catch (err) {
      results = failedAll(agents, err);
    }
    settle(results);
    setPhase('done');
  };
  const retry = async (agent: InboxNoteAgentId) => {
    setStatus((current) => ({ ...current, [agent]: { kind: 'busy' } }));
    let results: InboxNoteResult[];
    try {
      const next = await inboxApi.answerNotes([agent], [agent], false);
      results = next.results;
      onModel(next);
    } catch (err) {
      results = failedAll([agent], err);
    }
    settle(results);
    if (results.every((result) => result.ok)) setFocusDone((n) => n + 1);
  };

  const doneRows = rows.filter((row) => status[row.id]);
  const okRows = doneRows.filter((row) => { const s = status[row.id]; return s?.kind === 'done' && s.result.ok; });
  const anyFailed = doneRows.some((row) => { const s = status[row.id]; return s?.kind === 'done' && !s.result.ok; });
  const done = phase === 'done';

  const writtenOk = okRows.filter((row) => !isManual(row.id));
  const manualRows = okRows.filter((row) => isManual(row.id));
  const hasManual = manualRows.length > 0;
  const manualNames = joinNames(manualRows.map((row) => row.label));
  const title = done
    ? writtenOk.length > 0
      ? `已将说明添加到 ${whoLabel(writtenOk.map((row) => row.label))}`
      : hasManual && !anyFailed
        ? `将说明复制到 ${manualNames}`
        : '未添加说明'
    : single
      ? handOnly
        ? `要将说明复制到 ${rows[0]!.label} 吗？`
        : `要将说明添加到 ${rows[0]!.label} 吗？`
      : '让 agent 了解收件箱';
  const handLine = `${handNames} 的规则保存在应用内，所以需要你自行将说明复制到 ${CURSOR_RULES_PLACE}；Plannotator 无法查看、更新或删除那份副本。`;
  const desc = done
    ? null
    : single && handOnly
      ? `在它的规则中加一段简短说明，它就会在你离开时把需要决策的事项和已完成的工作发送到这里。${handLine}`
      : single
        ? '在它的指令中加一段简短说明，它就会在你离开时把需要决策的事项和已完成的工作发送到这里。纯文本，你可以编辑或删除。'
        : `Plannotator 可以给每个 agent 的指令加一段简短说明，让它们在你离开时把需要决策的事项和已完成的工作发送到这里。纯文本，你可以编辑或删除。${handRows.length > 0 ? ` ${handLine}` : ''}`;

  return (
    <Modal
      labelledBy={`${id}-title`}
      describedBy={desc ? `${id}-desc` : undefined}
      testId="agent-note"
      onClose={() => (done ? close() : decline())}
      ownKeys
      fallbackFocus={pageHeading}
      className="ib-anote"
    >
      <div className="ib-anote-head">
        <h2 id={`${id}-title`} tabIndex={-1} dir="auto">
          {title}
        </h2>
        {desc && (
          <p className="ib-anote-desc" id={`${id}-desc`}>
            {desc}
          </p>
        )}
      </div>
      <div className="ib-anote-body">
        {done ? (
          <>
            <ul className="ib-anote-table" aria-label="写入的内容">
              {doneRows.map((row) => {
                const s = status[row.id]!;
                return (
                  <li key={row.id}>
                    <div className="ib-anote-r ib-anote-nobox" data-agent={row.id}>
                      <HostMark host={row.id} />
                      <RowMain row={row} failure={s.kind === 'done' && !s.result.ok ? s.result.reason : null} onRetry={() => void retry(row.id as InboxNoteAgentId)} />
                      <span className="ib-anote-st">
                        {s.kind === 'busy' ? (
                          <span className="ib-anote-pill">正在添加…</span>
                        ) : (
                          <span className={`ib-anote-res ${!s.result.ok ? 'ib-anote-bad' : s.result.action === 'manual' ? 'ib-anote-hand' : 'ib-anote-good'}`}>
                            <Icon name={!s.result.ok ? 'warn' : s.result.action === 'manual' ? 'copy' : 'check'} />
                            {noteResultLabel(s.result)}
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="ib-anote-doneline">
              {[
                writtenOk.length > 0 ? '每个 agent 会从下一次会话开始读取它。' : '',
                hasManual ? `请将下方的说明复制到 ${manualNames} 中的 ${CURSOR_RULES_PLACE}。Plannotator 无法查看、更新或删除那份副本。` : '',
                anyFailed ? '修复该文件，然后在这里或“设置 → Agents”中重试。' : '',
              ]
                .filter(Boolean)
                .join('')}
            </p>
            {hasManual && (
              <div className="ib-anote-note" data-anote-copy="">
                <pre tabIndex={0} aria-label={`要复制到 ${manualNames} 的说明`}>
                  <NoteText text={copyText} />
                </pre>
              </div>
            )}
          </>
        ) : (
          <>
            <ul className="ib-anote-table" aria-label={single ? '说明将添加到' : 'Agents'}>
              {rows.map((row) =>
                single ? (
                  <li key={row.id}>
                    <div className="ib-anote-r ib-anote-nobox" data-agent={row.id}>
                      <HostMark host={row.id} />
                      <RowMain row={row} />
                      <span className="ib-anote-st">
                        <Pill row={row} />
                      </span>
                    </div>
                  </li>
                ) : (
                  <li key={row.id}>
                    <label className={`ib-anote-r${picks[row.id] ? '' : ' ib-anote-unpicked'}`} data-agent={row.id}>
                      <input
                        type="checkbox"
                        checked={picks[row.id] === true}
                        disabled={busy}
                        onChange={(event) => setPicks((current) => ({ ...current, [row.id]: event.target.checked }))}
                      />
                      <HostMark host={row.id} />
                      <RowMain row={row} />
                      <span className="ib-anote-st">
                        <Pill row={row} />
                      </span>
                    </label>
                  </li>
                ),
              )}
            </ul>
            <button type="button" className="ib-anote-fold" aria-expanded={preview} aria-controls={`${id}-note`} onClick={() => setPreview((open) => !open)}>
              <Icon name="chevR" />
              {preview ? '隐藏说明' : '显示说明'}
            </button>
            {preview && (
              <div className="ib-anote-note" id={`${id}-note`}>
                <pre tabIndex={0} aria-label={handOnly ? '要复制的说明' : 'Plannotator 添加的说明'}>
                  <NoteText text={handOnly ? copyText : noteText} />
                </pre>
              </div>
            )}
          </>
        )}
      </div>
      <div className="ib-anote-foot" data-busy={busy || undefined}>
        {done ? (
          <>
            <span className="ib-anote-later">
              {writtenOk.length === 0 && hasManual
                ? `不再需要时，请自行删除 ${manualNames} 中的副本。`
                : hasManual
                  ? `随时可以在“设置 → Agents”中移除已添加的说明；${manualNames} 中的副本需你自行移除。`
                  : '随时可以在“设置 → Agents”中移除。'}
            </span>
            <button type="button" className="ib-btn ib-pri" data-anote-done="" ref={doneRef} onClick={close}>
              完成
            </button>
          </>
        ) : (
          <>
            <span className="ib-anote-later">稍后可以在“设置 → Agents”中更改。</span>
            {primary.add && (
              <button type="button" className="ib-btn ib-ghost" data-anote-notnow="" aria-disabled={busy || undefined} onClick={decline}>
                暂不
              </button>
            )}
            <button type="button" className="ib-btn ib-pri" data-anote-primary="" aria-disabled={busy || undefined} onClick={() => void add()}>
              {busy ? (pickedWritten.length > 0 ? '正在添加…' : '正在准备…') : primary.label}
            </button>
          </>
        )}
      </div>
      <div className="ib-sr" aria-live="polite">
        {live}
      </div>
    </Modal>
  );
}

function Pill({ row }: { row: InboxAgentRow }) {
  return <span className="ib-anote-pill">{noteCopiedByHand(row) ? '自行复制' : row.note?.create ? '新文件' : '追加到末尾'}</span>;
}

function RowMain({ row, failure, onRetry }: { row: InboxAgentRow; failure?: string | null; onRetry?: () => void }) {
  const note = row.note;
  return (
    <span className="ib-anote-main">
      <Tip content={row.label} cut>
        <span className="ib-anote-name" dir="auto">
          {row.label}
        </span>
      </Tip>
      {note?.path && <NotePath path={note.path} />}
      {!failure && noteCopiedByHand(row) && <span className="ib-anote-sub">这里不会写入任何内容：你需要自行将说明粘贴到 {CURSOR_RULES_PLACE}。</span>}
      {!failure && row.id === 'pi' && <span className="ib-anote-sub">Pi 只读取它的一个指令文件，就是这一个。</span>}
      {!failure && note?.shared_with && note.shared_with.length > 0 && (
        <span className="ib-anote-sub">此文件与 {joinNames(note.shared_with.map((other) => INBOX_AGENT_LABELS[other]))} 共用：一个章节同时服务两者。</span>
      )}
      {!failure && note?.target && (
        <span className="ib-anote-sub">
          此文件是指向 <code dir="ltr">{note.target}</code> 的链接；说明会写入那里。
        </span>
      )}
      {failure && (
        <span className="ib-anote-err">
          <Icon name="warn" />
          <span>
            {sentence(tidyReason(failure))}
            {onRetry && (
              <>
                {' '}
                <button type="button" className="ib-lnk" onClick={onRetry}>
                  重试
                </button>
              </>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

/** A path on one line, cut in the middle; each folder name its own bidi isolate; the whole path in the DOM and in a tooltip while it is cut. */
function NotePath({ path }: { path: string }) {
  const { head, tail } = splitPath(path);
  const segments = (part: string) =>
    part.split('/').map((name, index, all) => (
      <Fragment key={index}>
        {name && <bdi>{name}</bdi>}
        {index < all.length - 1 && (
          <>
            /<wbr />
          </>
        )}
      </Fragment>
    ));
  return (
    <Tip content={path} when={(trigger) => isTextCut(trigger.querySelector('.ib-anote-ph')) || isTextCut(trigger.querySelector('.ib-anote-pt')) || isTextCut(trigger)}>
      <span className="ib-anote-path" dir="ltr">
        <span className="ib-anote-ph">{segments(head)}</span>
        <span className="ib-anote-pt">{segments(tail)}</span>
      </span>
    </Tip>
  );
}

/** The note, its marker lines muted. */
function NoteText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {line.startsWith('<!-- plannotator-inbox:') ? <span className="ib-anote-marker">{line}</span> : line}
          {index < lines.length - 1 ? '\n' : null}
        </Fragment>
      ))}
    </>
  );
}

/** Focus after the dialog when nothing focusable opened it: the page's heading. */
function pageHeading(): HTMLElement | null {
  const heading = document.querySelector<HTMLElement>('.ib-main h1');
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  return heading;
}
