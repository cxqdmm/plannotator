/**
 * A stack on its own page (approval "inbox-pr-dashboard", rounds 6 and 7): the layers top of the stack first and the
 * base branch at the bottom, the way `gt log` reads (q-81634343). Merged layers stay in place, greyed (the default
 * while the owner's answer on q-922175ff is pending). A row opens that layer in the Inbox's PR view.
 *
 * A range of layers as one diff (q-0a2467a4, `stackRange.ts`): a shift-click on a row, or Choose a range then a click
 * or tap, picks one end, the next the other; the bar opens "Layers i–j" in the PR view. A layer whose head moved since
 * the person last opened it is marked, and the header counts them (q-6cf84c0b, `looked.ts`).
 *
 * Left for later (not in this first version): the docked inspector and the merged fold.
 */
import { useId, useState } from 'react';
import { inboxPullIsOpen, inboxPullLabel, inboxPullLandsNext, type InboxPull, type InboxPullStack, type InboxPullsAnswer } from '@plannotator/core/inbox-types';
import { Icon } from '../icons';
import { SidebarTrigger } from '../shell/sidebar';
import { ChecksMark, checksLabel } from './ChecksMark';
import { ageShort, needsYou, stackCounts, statusParts, statusWords, topFirst } from './sheetModel';
import { Named, Person } from '../pulls/Face';
import { facesOnce, person, wordsText, type Words } from '../pulls/words';
import type { PullViewScope } from '../pulls/viewScope';
import { changedSince, useLooked } from './looked';
import { pickNext, rangeOf, rangeOpens } from './stackRange';
import { StackRangeBar } from './StackRangeBar';

export interface StackPageProps {
  stack: InboxPullStack | null;
  /** The list is still being read: nothing to say yet. */
  loading: boolean;
  /** The board the stack is read from: where each layer's look is kept. */
  board?: Pick<InboxPullsAnswer, 'pulls' | 'machines'> | null;
  repoLabel: string | null;
  phone: boolean;
  onBack: () => void;
  /** A row, or a range (its top layer and the view of it). */
  onOpenLayer: (pull: InboxPull, scope?: PullViewScope) => void;
  now?: number;
}

export function StackPage(props: StackPageProps) {
  const { stack, phone } = props;
  const now = props.now ?? Date.now();
  const titleId = useId();
  const looked = useLooked(props.board ?? null);
  // Choosing a range: `null` while not; else the ends picked so far.
  const [picked, setPicked] = useState<string[] | null>(null);
  const crumb = (
    <nav className="ib-prst-crumb" aria-label="面包屑">
      <SidebarTrigger />
      <button type="button" className="ib-bback" onClick={props.onBack} data-pr-stack-back="">
        <Icon name="chevL" size={15} />
        PR
      </button>
      {props.repoLabel && <span className="ib-prst-repo">/ {props.repoLabel}</span>}
    </nav>
  );
  if (!stack) {
    return (
      <section className="ib-prs ib-prst" aria-labelledby={titleId} data-pr-stack-page="">
        <div className="ib-prs-scroll">
          {crumb}
          {props.loading ? (
            <div className="ib-prs-loading" aria-busy="true" />
          ) : (
            <div className="ib-prs-empty">
              <h1 id={titleId}>这个堆叠已不再开放</h1>
              <p>它的各层已合并或关闭，或者列表中已没有它们。</p>
            </div>
          )}
        </div>
      </section>
    );
  }
  const counts = stackCounts(stack);
  const next = inboxPullLandsNext(stack);
  const authors = [...new Set(stack.layers.map((l) => l.author).filter((a): a is string => !!a))];
  const owner = stack.layers[stack.layers.length - 1]!.author ?? authors[0] ?? null;
  const rows = topFirst(stack);
  const changed = stack.layers.filter((l) => changedSince(l, looked)).length;
  const range = picked?.length === 2 ? rangeOf(stack, picked[0]!, picked[1]!) : null;
  const inRange = new Set((range?.layers ?? []).map((l) => l.key).concat(picked ?? []));
  // A range needs three open layers: of two, either one is a layer and both are the whole stack.
  const rangeable = stack.layers.filter(inboxPullIsOpen).length >= 3;
  const pick = (pull: InboxPull) => setPicked((was) => pickNext(stack, was ?? [], pull.key));
  const meta = [
    counts.merged > 0 ? `已合并 ${counts.merged} 个` : null,
    `开放 ${counts.open} 个`,
    counts.needYou > 0 ? { you: `需要你处理 ${counts.needYou} 个` } : null,
    counts.failing > 0 ? { bad: `${counts.failing} 个检查失败` } : null,
    changed > 0 ? { changed: `${changed} 个自上次查看后有更新` } : null,
    next ? `接下来合并 ${inboxPullLabel(next)}` : null,
    owner ? { by: ['来自 ', person(owner), ...(authors.length > 1 ? [` 等 ${authors.length - 1} 人`] : [])] as Words } : null,
  ].filter(Boolean) as (string | { you: string } | { bad: string } | { changed: string } | { by: Words })[];
  return (
    <section className="ib-prs ib-prst" aria-labelledby={titleId} data-pr-stack-page={stack.id} data-phone={phone ? '' : undefined}>
      <div className="ib-prs-scroll">
        {crumb}
        <header className="ib-prst-head">
          <h1 id={titleId} tabIndex={-1}>
            堆叠共 {stack.layers.length} 层，合入 <code>{stack.base}</code>
          </h1>
          <p className="ib-prs-sum">
            {meta.map((m, i) =>
              typeof m === 'string' ? (
                <span key={i}>{m}</span>
              ) : 'by' in m ? (
                <span key={i}>
                  <Named words={m.by} host={stack.layers[0]!.host} />
                </span>
              ) : 'changed' in m ? (
                <span key={i} data-pr-stack-changed={changed}>
                  <i className="ib-prst-dot" aria-hidden="true" />
                  {m.changed}
                </span>
              ) : 'you' in m ? (
                <span key={i} className="ib-prs-you">
                  {m.you}
                </span>
              ) : (
                <span key={i} className="ib-prs-bad">
                  {m.bad}
                </span>
              ),
            )}
          </p>
        </header>
        {picked && (
          <StackRangeBar
            stack={stack}
            picked={picked}
            onOpen={(chosen) => {
              const opens = rangeOpens(stack, chosen);
              props.onOpenLayer(chosen.last, opens.scope);
            }}
            onClear={() => setPicked(null)}
          />
        )}
        <ol className="ib-prst-list" aria-label={`层，堆叠顶部在前`} data-picking={picked ? '' : undefined}>
          {rows.map((pull) => {
            const at = stack.layers.indexOf(pull) + 1;
            const you = needsYou(pull);
            const open = inboxPullIsOpen(pull);
            const lands = next?.key === pull.key;
            const other = pull.author && pull.author !== owner ? pull.author : null;
            const said: Words = lands && open && statusWords(pull, now) === '已通过 · 可以合并' ? ['已通过 · 接下来合并'] : statusParts(pull, now);
            const status = wordsText(said);
            const moved = !!changedSince(pull, looked);
            const ends = picked?.includes(pull.key) ?? false;
            return (
              <li key={pull.key} className="ib-prst-li">
                <button
                  type="button"
                  className="ib-prst-row"
                  data-state={pull.state}
                  data-you={you ? '' : undefined}
                  data-lands={lands ? '' : undefined}
                  data-fail={open && pull.checks === 'failure' ? '' : undefined}
                  data-picked={inRange.has(pull.key) ? '' : undefined}
                  aria-pressed={picked ? ends : undefined}
                  aria-disabled={picked && !open ? true : undefined}
                  // A shift-click would otherwise select the text between this row and the last one clicked.
                  onMouseDown={(event) => event.shiftKey && event.preventDefault()}
                  onClick={(event) => {
                    if (picked || (event.shiftKey && open && rangeable)) pick(pull);
                    else props.onOpenLayer(pull);
                  }}
                  aria-label={`第 ${at} 层：${inboxPullLabel(pull)} ${pull.title}，${status}${checksLabel(pull.checks) && open ? `，${checksLabel(pull.checks)}` : ''}${moved ? '，自上次查看后有更新' : ''}。${picked ? '' : '打开它。'}`}
                  data-pr-layer={pull.key}
                  data-pr-layer-changed={moved ? '' : undefined}
                >
                  <span className="ib-prst-at">{at}</span>
                  <span className="ib-prst-node" aria-hidden="true" />
                  <span className="ib-prst-n">
                    {inboxPullLabel(pull)}
                    {moved && <i className="ib-prst-dot" aria-hidden="true" />}
                  </span>
                  <span className="ib-prst-t" dir="auto">
                    <span className="ib-prst-title">{pull.title || inboxPullLabel(pull)}</span>
                    {other && (
                      <span className="ib-prst-who">
                        <Person login={other} host={pull.host} />
                      </span>
                    )}
                  </span>
                  <span className="ib-prst-ck">{open && <ChecksMark checks={pull.checks} />}</span>
                  <span className="ib-prst-diff">
                    <span className="ib-prst-add">+{pull.additions.toLocaleString()}</span> <span className="ib-prst-del">−{pull.deletions.toLocaleString()}</span>
                  </span>
                  <span className="ib-prst-st" title={status}>
                    <Named words={facesOnce(said, [other])} host={pull.host} />
                  </span>
                  <span className="ib-prst-age">{ageShort(pull.state === 'merged' && pull.merged_at ? pull.merged_at : pull.updated_at, now)}</span>
                </button>
              </li>
            );
          })}
          <li className="ib-prst-li ib-prst-base" aria-label={`${stack.base}，基础分支`}>
            <span className="ib-prst-at" />
            <span className="ib-prst-node" data-base="" aria-hidden="true" />
            <span className="ib-prst-basen">
              <code>{stack.base}</code> · 基础分支
            </span>
          </li>
        </ol>
        {rangeable && !picked && (
          <p className="ib-prst-foot">
            <button type="button" className="ib-prst-choose" onClick={() => setPicked([])} data-pr-stack-choose="">
              选择范围
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
