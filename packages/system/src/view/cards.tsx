// The Key (symbols and keys) and the notes of the sheet on screen, as small
// cards over the stage, opened from the zoom group (Key) and with N.
import { Fragment } from 'react';
import { MOVES, MOVES_ORDER } from '../draw/grammar.ts';
import type { SheetLayout } from '../layout/types.ts';

const Kbd = ({ k }: { k: string }) => <kbd className="sys-kbd">{k}</kbd>;

const Swatch = ({ is, dashed }: { is?: 'added' | 'changed' | 'removed'; dashed?: boolean }) => (
  <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
    <rect x="1" y="1" width="24" height="14" rx="2" fill={is === 'changed' ? 'color-mix(in oklab, var(--sys-chg-ink) 11%, var(--sys-box))' : 'var(--sys-box)'}
      stroke={is ? `var(--sys-${is === 'added' ? 'add' : is === 'changed' ? 'chg' : 'gone'}-ink)` : 'var(--sys-line)'} strokeWidth="1.3" strokeDasharray={dashed || is === 'removed' ? '3 2' : undefined} />
  </svg>
);

/** What the change on the sheet means: a PR's review, a plan, only the parts its files touch (the gate), or several open PRs' touched parts at rest. */
export type KeyChange = 'review' | 'plan' | 'gate' | 'touches' | null;

export function KeyCard({ notes, sheets, keys, pane, change = null }: { notes: boolean; sheets: boolean; keys: boolean; pane: boolean; change?: KeyChange }) {
  return (
    <div className="sys-card-pop sys-keycard" role="dialog" aria-label="符号与键">
      {change && (
        <>
          <div className="sys-kc-h">{change === 'plan' ? '此计划' : change === 'touches' ? '打开的 PR' : '此改动'}</div>
          {change !== 'gate' && change !== 'touches' && <div className="sys-kc-r"><span className="sys-kc-i"><Swatch is="added" dashed={change === 'plan'} /></span><span>{change === 'plan' ? '新增，尚未实现' : '已新增'}</span></div>}
          <div className="sys-kc-r"><span className="sys-kc-i"><Swatch is="changed" dashed={change === 'plan'} /></span><span>{change === 'plan' ? '改动，尚未实现' : change === 'gate' ? '它的文件有改动' : change === 'touches' ? '它们的文件改动它，并标注各自的 PR' : '已改动'}</span></div>
          {change === 'review' && <div className="sys-kc-r"><span className="sys-kc-i"><Swatch is="removed" /></span><span>已移除，带删除线</span></div>}
          {change === 'review' && <div className="sys-kc-r"><span className="sys-kc-i"><span className="sys-kc-num">1</span></span><span>它在部分列表中的编号</span></div>}
        </>
      )}
      <div className="sys-kc-h">符号</div>
      <div className="sys-kc-r">
        <span className="sys-kc-i"><svg width="40" height="10" aria-hidden="true"><path d="M2 5H31" stroke="var(--sys-line)" strokeWidth="1.3" /><path d="M38 5l-9 3.6v-7.2z" fill="var(--sys-line)" /></svg></span>
        <span>一条线：表示流动的方向</span>
      </div>
      <div className="sys-kc-r"><span className="sys-kc-i"><span className="sys-letter">a</span></span><span>一条注释：悬停或聚焦它的字母</span></div>
      <div className="sys-kc-r">
        <span className="sys-kc-i"><svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><rect x="1.5" y="0.5" width="20" height="13" rx="1.5" fill="var(--sys-box)" stroke="var(--sys-line)" /><path d="M4.5 16.5h19v-13" fill="none" stroke="var(--sys-line-faint)" /></svg></span>
        <span>内部还有图纸的部分：放大或打开它</span>
      </div>
      <div className="sys-kc-h">线条</div>
      {MOVES_ORDER.map((m) => (
        <div className="sys-kc-r" key={m}>
          <span className="sys-kc-i"><svg width="40" height="10" aria-hidden="true"><path d="M2 5H38" stroke={MOVES[m].ink} strokeWidth="2.2" /></svg></span>
          <span><b className="sys-kc-w">{MOVES[m].word}</b> {MOVES[m].key}</span>
        </div>
      ))}
      <div className="sys-kc-h">聚焦图纸时的按键</div>
      <div className="sys-kc-k"><Kbd k="Tab" /><Kbd k="←↑→↓" /><span>在部分之间移动</span></div>
      <div className="sys-kc-k"><Kbd k="Enter" /><span>打开内部还有图纸的部分</span></div>
      <div className="sys-kc-k"><Kbd k="Esc" /><span>返回上一级</span></div>
      {keys && (
        <>
          <div className="sys-kc-k"><Kbd k="+" /><Kbd k="−" /><Kbd k="F" /><span>放大、缩小、适应</span></div>
          {sheets && <div className="sys-kc-k"><Kbd k="1" />至<Kbd k="9" /><span>这里的图纸</span></div>}
          {notes && <div className="sys-kc-k"><Kbd k="N" /><span>此图纸的所有注释</span></div>}
        </>
      )}
      <div className="sys-kc-k"><span>{pane ? '拖动移动；双指捏合，或按住 Ctrl 或 ⌘ 滚轮，可缩放' : '拖动移动；滚轮或双指捏合可缩放'}</span></div>
    </div>
  );
}

export function NotesCard({ notes, onClose }: { notes: SheetLayout['notes']; onClose: () => void }) {
  return (
    <div className="sys-card-pop sys-notescard" role="dialog" aria-label="此图纸的注释">
      <div className="sys-kc-h">
        <span>注释</span>
        <button type="button" className="sys-card-x" aria-label="关闭注释" title="关闭" onClick={onClose}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      </div>
      {notes.map((n) => (
        <Fragment key={n.l}>
          <div className="sys-note-row"><span className="sys-letter">{n.l}</span><span>{n.text}</span></div>
        </Fragment>
      ))}
    </div>
  );
}
