import { Fragment } from 'react';
import { Modal } from './Updates';

/** The words of the grill-me tip. Every `/grill-me` in them is drawn as inline code. */
export interface GrillMeTipCopy {
  title: string;
  body: string;
  /** The muted second line. */
  reach: string;
}

/** Variant A, the one shown (approved by the owner, 2026-11-08). */
export const GRILL_ME_TIP_COPY_A: GrillMeTipCopy = {
  title: '在这里试试 /grill-me',
  body: 'Plannotator 为 grill-me 提供了优化体验：它的问题会以卡片形式进入你的收件箱，你可以随时回答。',
  reach: '在回复或新消息中选择 /grill-me。无需开启任何东西。',
};

/** Variant B, kept for the owner to swap in (`GRILL_ME_TIP_COPY`). */
export const GRILL_ME_TIP_COPY_B: GrillMeTipCopy = {
  title: '在这里试试 /grill-me',
  body: '在回复或新消息中选择 /grill-me，它的访谈会回到这里，每个问题一张卡片：选一个答案、加一条备注，不必着急。',
  reach: '适用于你拥有的任意 grill-me 技能。无需开启任何东西。',
};

/** The words the card shows. */
export const GRILL_ME_TIP_COPY: GrillMeTipCopy = GRILL_ME_TIP_COPY_A;

/**
 * The picture: one question card as the Inbox draws it (decorative), showing what a question can hold: picture
 * choices, the Recommended tag, the `Why <choice>:` line and a note being typed.
 */
export const GRILL_ME_TIP_ART = {
  question: '哪种深色配色？',
  context: '每张图片都是你的应用使用该配色的样子。',
  choices: [
    { label: '微暗', tone: 'dim' },
    { label: '夜间', tone: 'night' },
  ],
  /** The choice marked Recommended and picked (its index). */
  recommended: 1,
  why: '你的浅色主题已经用了 GitHub 的配色。',
  note: '保留蓝色强调色',
} as const;

const COMMAND = '/grill-me';

/** A line of the copy, each `/grill-me` as inline code. */
function withCommand(text: string) {
  return text.split(COMMAND).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <code>{COMMAND}</code>}
      {part}
    </Fragment>
  ));
}

/**
 * The grill-me tip (approved; the owner, 2026-11-08: "similar to the bro mode pop-up ... have you tried /grill-me yet?
 * ... There's nothing to turn on"): a one-time card of the line (reveals.ts `grill_me_tip`) on Bro mode's card (navy,
 * dot grid; no Experimental chip, the owner 2026-11-08), with a small picture of one question card. Nothing to turn on, so one button:
 * "Got it". Escape and a click outside close it too; every way out is final, as the claim already stamped it. No
 * keyboard shortcut.
 */
export function GrillMeTip({ phone, onClose, copy = GRILL_ME_TIP_COPY }: { phone: boolean; onClose: () => void; copy?: GrillMeTipCopy }) {
  return (
    <Modal labelledBy="ib-gm-title" describedBy="ib-gm-desc" testId="grill-me-tip" onClose={onClose} ownKeys className={`ib-bi ib-bro ib-gm${phone ? ' ib-bi-phone' : ''}`}>
      <h2 id="ib-gm-title">{withCommand(copy.title)}</h2>
      <div className="ib-gm-art" aria-hidden="true">
        <p className="q">{GRILL_ME_TIP_ART.question}</p>
        <p className="ctx">{GRILL_ME_TIP_ART.context}</p>
        <div className="tiles">
          {GRILL_ME_TIP_ART.choices.map((choice, i) => (
            <div key={choice.label} className={i === GRILL_ME_TIP_ART.recommended ? 'tile on' : 'tile'}>
              <span className={`pic ${choice.tone}`}>
                <i />
                <i />
                <i />
              </span>
              <span className="cap">
                <span className="dot" />
                {choice.label}
                {i === GRILL_ME_TIP_ART.recommended && <span className="tag">推荐</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="why">
          <b>为什么选 {GRILL_ME_TIP_ART.choices[GRILL_ME_TIP_ART.recommended].label}：</b> {GRILL_ME_TIP_ART.why}
        </p>
        <div className="note">
          {GRILL_ME_TIP_ART.note}
          <span className="caret" />
        </div>
      </div>
      <div className="ib-bi-text">
        <p id="ib-gm-desc">{withCommand(copy.body)}</p>
        <p className="ib-bro-reach">{withCommand(copy.reach)}</p>
      </div>
      <div className="ib-bi-acts">
        <span className="ib-bsp" />
        <button type="button" className="ib-btn ib-pri ib-bi-copy" onClick={onClose} data-grill-me-tip-ok="">
          知道了
        </button>
      </div>
    </Modal>
  );
}
