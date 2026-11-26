/**
 * 管家（approval "butler" 一期）：the Inbox's digital butler. A resident orb
 * (bottom-right, breathing glow) that expands — with an entry animation — into
 * the full-screen butler view: the butler's avatar up top, the dialog at the
 * bottom. The brain is the daemon's butler chat route (the configured model
 * with the butler persona; history persists in the butler folder).
 */
import { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '@plannotator/ui/utils/clipboard';
import { isImeCompositionKey } from '@plannotator/ui/utils/commentSubmitKey';
import { chatMarkdownHtml } from '@plannotator/ui/components/chat';
import { Tip } from '@plannotator/ui/components/inbox-thread/Tip';
import { Icon } from '../icons';
import { inboxApi, type InboxButlerApprovalsModel } from '../api';
import { ButlerApprovals } from './ButlerApprovals';
import { BUTLER_FILE_MAX_BYTES, BUTLER_FILE_MAX_COUNT } from '@plannotator/core/inbox-types';

/**
 * 管家的活形象（owner 2026-11-26「我想要一只猫头鹰的形象」）：一只圆滚滚的卡通
 * 猫头鹰——耳羽、两片浅色面盘、占脸一半的大眼睛、小钩喙、羽毛纹胸脯，脖子上一条
 * 品牌色围巾。配色走 CSS 变量（--bc-*，inbox.css，深浅色同一套），表情按对话状态换：
 * idle 眨眼、耳羽偶尔抖、围巾随风轻摆；working 眼睛左右张望 + 头顶小星光；
 * happy（复制成功）眼睛弯成两道弧、翅膀抬一下。
 * 26px（悬浮球）到 96px（首屏）都用这一个；细碎装饰一律不放，小尺寸才不糊。
 * prefers-reduced-motion 下一律静止。
 */
function ButlerCharacter({ size, mood = 'idle' }: { size: number; mood?: 'idle' | 'working' | 'happy' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={`ib-bc${mood === 'working' ? ' ib-bc-working' : ''}${mood === 'happy' ? ' ib-bc-happy' : ''}`}
    >
      {/* 尾羽（在身后） */}
      <g fill="var(--bc-fur-shade, #d9b98c)">
        <path d="M28 56 q4 6 4 6 q0 0 4 -6 z" />
        <path d="M24.4 55.4 q2.8 5.6 2.8 5.6 l3.4 -5 z" opacity="0.85" />
        <path d="M39.6 55.4 q-2.8 5.6 -2.8 5.6 l-3.4 -5 z" opacity="0.85" />
      </g>
      {/* 爪 */}
      <ellipse cx="27.4" cy="57.6" rx="3.6" ry="1.9" fill="var(--bc-beak, #e8a33d)" />
      <ellipse cx="36.6" cy="57.6" rx="3.6" ry="1.9" fill="var(--bc-beak, #e8a33d)" />
      {/* 耳羽（偶尔抖一下） */}
      <g className="ib-bc-tuft-l">
        <path d="M20.2 19.6 C18 14 16.4 9.4 16.9 7 C19.6 8 23.6 12.2 26 16 Z" fill="var(--bc-fur-shade, #d9b98c)" />
      </g>
      <g className="ib-bc-tuft-r">
        <path d="M43.8 19.6 C46 14 47.6 9.4 47.1 7 C44.4 8 40.4 12.2 38 16 Z" fill="var(--bc-fur-shade, #d9b98c)" />
      </g>
      {/* 身体：一整个圆滚滚的蛋形 */}
      <path d="M32 13.4 C43.8 13.4 49.4 22.4 49.4 35.4 C49.4 49 43 57.8 32 57.8 C21 57.8 14.6 49 14.6 35.4 C14.6 22.4 20.2 13.4 32 13.4 Z" fill="var(--bc-fur, #e9cfa8)" />
      {/* 翅膀：贴身体两侧，happy 时抬一下 */}
      <g className="ib-bc-wing-l">
        <path d="M17.4 34.6 C15 40 15.4 47.4 18.6 51.8 C20.2 54 22.4 52.6 21.6 50.2 C19.8 45 19.6 39.6 20.6 34.8 Z" fill="var(--bc-fur-shade, #d9b98c)" />
      </g>
      <g className="ib-bc-wing-r">
        <path d="M46.6 34.6 C49 40 48.6 47.4 45.4 51.8 C43.8 54 41.6 52.6 42.4 50.2 C44.2 45 44.4 39.6 43.4 34.8 Z" fill="var(--bc-fur-shade, #d9b98c)" />
      </g>
      {/* 胸脯羽毛：浅色底 + 两排羽纹 */}
      <ellipse cx="32" cy="47.6" rx="9.2" ry="8.6" fill="var(--bc-belly, #f8ecd9)" />
      <g stroke="var(--bc-fur-shade, #d9b98c)" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.7">
        <path d="M26.4 45 q2.8 2.6 5.6 0 q2.8 2.6 5.6 0" />
        <path d="M26.4 50 q2.8 2.6 5.6 0 q2.8 2.6 5.6 0" />
      </g>
      {/* 面盘：两片浅色圆，托住大眼 */}
      <circle cx="25.2" cy="30.6" r="9.2" fill="var(--bc-belly, #f8ecd9)" />
      <circle cx="38.8" cy="30.6" r="9.2" fill="var(--bc-belly, #f8ecd9)" />
      {/* 眼睛：happy 弯成弧，其余是会眨、working 时张望的大眼 */}
      {mood === 'happy' ? (
        <g stroke="var(--bc-ink, #2b2320)" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M21.4 30 q3.8 -3.8 7.6 0" />
          <path d="M35 30 q3.8 -3.8 7.6 0" />
        </g>
      ) : (
        <g className="ib-bc-eyes">
          <circle cx="25.2" cy="30.6" r="5.6" fill="var(--bc-ink, #2b2320)" />
          <circle cx="38.8" cy="30.6" r="5.6" fill="var(--bc-ink, #2b2320)" />
          <circle cx="23.4" cy="28.6" r="1.7" fill="#fff" />
          <circle cx="37" cy="28.6" r="1.7" fill="#fff" />
          <circle cx="27.2" cy="32.8" r="0.8" fill="#fff" opacity="0.85" />
          <circle cx="40.8" cy="32.8" r="0.8" fill="#fff" opacity="0.85" />
        </g>
      )}
      {/* 腮红 */}
      <ellipse cx="20" cy="39" rx="3.2" ry="1.9" fill="var(--bc-blush, #ef8f7d)" opacity="0.45" />
      <ellipse cx="44" cy="39" rx="3.2" ry="1.9" fill="var(--bc-blush, #ef8f7d)" opacity="0.45" />
      {/* 小钩喙：亮色、压在两面盘中间，向下勾一下 */}
      <path d="M28.9 33.2 L35.1 33.2 L32 38.9 C31.4 39.7 30.4 39.5 30.2 38.7 Z" fill="var(--bc-beak, #eda53a)" />
      <path d="M30.6 38.2 C31.2 38.9 32.8 38.9 33.4 38.2" stroke="var(--bc-beak-shade, #c9862a)" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.75" />
      {/* 围巾：品牌色，贴着下巴绕一圈，结上一点亮扣 */}
      <path d="M20.4 40.6 C26.4 43.6 37.6 43.6 43.6 40.6 L45.2 45.2 C38.2 49.6 25.8 49.6 18.8 45.2 Z" fill="var(--primary)" />
      <path d="M29.4 47 l2.6 3.8 l-2.6 1 l-2.4 -3.6 Z" fill="var(--primary)" opacity="0.85" />
      <path d="M34.6 47 l-2.6 3.8 l2.6 1 l2.4 -3.6 Z" fill="var(--primary)" opacity="0.85" />
      <circle cx="32" cy="47.4" r="1.7" fill="var(--bc-belly, #f8ecd9)" opacity="0.95" />
      {/* working：头顶一颗小星光 */}
      <path className="ib-bc-spark" d="M47.6 13 l1.1 3 l3 1.1 l-3 1.1 l-1.1 3 l-1.1 -3 l-3 -1.1 l3 -1.1 z" fill="var(--primary)" />
    </svg>
  );
}

interface ButlerTurn {
  at: string;
  role: 'you' | 'butler';
  text: string;
  files?: string[];
}

/** 待发送的附件：已读成 data URL，发送时原样上交（服务端按字节落盘 + 图片内联）。 */
interface PendingFile {
  id: string;
  name: string;
  mime: string;
  data: string;
}

export function Butler({ open: openProp, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  // 开着不由内存丢（owner 2026-11-25「管家是一个单独的页面…现在一刷新就不见了」）：
  // 传入 open/onOpenChange 时由路由管（#butler，App 写地址），否则本地内存（旧行为）。
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value;
    if (onOpenChange) onOpenChange(next);
    else setOpenState(next);
  };
  const [turns, setTurns] = useState<ButlerTurn[]>([]);
  const [draft, setDraft] = useState('');
  // 输入框的基础功能（owner 2026-11-25「关键的输入框的基础功能…图片文件等等」）：
  // 附件挑选/粘贴即读成 data URL 待发，超限当场拒绝；发送与文字一起走 chat 路由。
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [compoError, setCompoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compoRef = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  const [sessionCopy, setSessionCopy] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle');
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  /** 管家页的两个页签：对话 / 审批（owner 2026-11-26「审批放在管家页面中」）。 */
  const [tab, setTab] = useState<'chat' | 'approvals'>('chat');
  const [approvalsModel, setApprovalsModel] = useState<InboxButlerApprovalsModel | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const approvalsPending = approvalsModel?.approvals.pending.length ?? 0;

  /** 审批页签的数据：打开时与每 5 秒读一次；决定/开关后再读。 */
  const loadApprovals = () => {
    void inboxApi
      .butlerApprovals()
      .then((answer) => {
        if (!answer || !answer.approvals || !Array.isArray(answer.approvals.pending)) throw new Error('审批数据读不出来。');
        setApprovalsModel(answer);
        setApprovalsError(null);
      })
      .catch((error: unknown) => {
        setApprovalsError(error instanceof Error ? error.message : String(error));
      });
  };

  useEffect(() => {
    if (!open) return;
    loadApprovals();
    const timer = setInterval(loadApprovals, 5000);
    return () => clearInterval(timer);
  }, [open]);

  const decideApproval = async (id: string, decision: 'approve' | 'deny', always: boolean) => {
    if (approvalBusy) return;
    setApprovalBusy(id);
    setApprovalsError(null);
    try {
      await inboxApi.butlerApprovalDecide(id, { decision, ...(always ? { always: true } : {}) });
      loadApprovals();
    } catch (error) {
      setApprovalsError(error instanceof Error ? error.message : String(error));
    } finally {
      setApprovalBusy(null);
    }
  };

  const setApprovalMode = async (action: 'create-requirement' | 'launch-session' | 'stop-session', mode: 'ask' | 'auto') => {
    setApprovalsError(null);
    try {
      await inboxApi.butlerApprovalSettings(action, mode);
      loadApprovals();
    } catch (error) {
      setApprovalsError(error instanceof Error ? error.message : String(error));
    }
  };

  // ESC 收回（与全屏面板的其它入口一致）。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 打开时读历史（一次；此后本地追加）。
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    void inboxApi.butlerHistory().then((answer) => setTurns(answer.history ?? [])).catch(() => setTurns([]));
  }, [open]);

  // 事件唤醒（doc/管家-事件机制设计 §8.1）：管家自己开口说的话由服务端写进历史，
  // 这一页开着时每 5 秒对齐一次，主人当场看到「设计稿已交付，等你审阅」。
  // 正在流式的自己那条不动（pending），否则以服务端历史为准。
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      if (pending) return;
      void inboxApi
        .butlerHistory()
        .then((answer) => {
          const history = answer.history ?? [];
          setTurns((current) => (history.length > current.length ? history : current));
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [open, pending]);

  // 新消息/流式追加时滚到底。
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns, pending, open]);

  const send = async () => {
    const message = draft.trim();
    if ((!message && pendingFiles.length === 0) || pending) return;
    setDraft('');
    const files = pendingFiles;
    setPendingFiles([]);
    setCompoError(null);
    setTurns((current) => [...current, { at: new Date().toISOString(), role: 'you', text: message, ...(files.length ? { files: files.map((file) => file.name) } : {}) }]);
    setPending(true);
    // 流式（v3，owner 2026-11-25「像 web 版一样」）：管家的回复随增量生长。
    const streamAt = new Date().toISOString();
    setTurns((current) => [...current, { at: streamAt, role: 'butler', text: '' }]);
    try {
      const reply = await inboxApi.butlerChatStream(
        message || `（发来了 ${files.length} 个附件）`,
        (delta) => {
          setTurns((current) => {
            const next = [...current];
            const last = next[next.length - 1]!;
            next[next.length - 1] = { ...last, text: last.text + delta };
            return next;
          });
        },
        files.map((file) => ({ name: file.name, mime: file.mime, data: file.data })),
      );
      setTurns((current) => {
        const next = [...current];
        const last = next[next.length - 1]!;
        next[next.length - 1] = { ...last, at: new Date().toISOString(), text: reply };
        return next;
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      setTurns((current) => {
        const next = [...current];
        const last = next[next.length - 1]!;
        return last.role === 'butler' && last.text === ''
          ? [...next.slice(0, -1), { ...last, text: `（管家没能回答：${why}）` }]
          : [...next, { at: new Date().toISOString(), role: 'butler' as const, text: `（管家没能回答：${why}）` }];
      });
    } finally {
      setPending(false);
    }
  };

  /** 右上角：复制「在终端打开管家会话」的命令（首点会先把会话起好）。 */
  const copySession = async () => {
    if (sessionCopy === 'busy') return;
    setSessionCopy('busy');
    try {
      const answer = await inboxApi.butlerSession();
      const ok = await copyTextToClipboard(answer.command);
      setSessionCopy(ok ? 'copied' : 'failed');
    } catch {
      setSessionCopy('failed');
    }
    setTimeout(() => setSessionCopy('idle'), 1800);
  };

  /** 粘贴事件里的文件（截图直接贴进来）。 */
  const takePastedFiles = (event: { clipboardData?: { files?: FileList | null } }): File[] => Array.from(event.clipboardData?.files ?? []);

  /** 挑选/粘贴的附件进待发区：数量与大小当场把关，读成 data URL（发送时原样上交）。 */
  const addFiles = (list: File[]) => {
    if (list.length === 0) return;
    const reasons: string[] = [];
    const accepted: File[] = [];
    for (const file of list) {
      if (pendingFiles.length + accepted.length >= BUTLER_FILE_MAX_COUNT) {
        reasons.push(`附件最多 ${BUTLER_FILE_MAX_COUNT} 个。`);
        break;
      }
      if (file.size > BUTLER_FILE_MAX_BYTES) {
        reasons.push(`「${file.name}」超过 ${Math.round(BUTLER_FILE_MAX_BYTES / 1024 / 1024)} MB，没收。`);
        continue;
      }
      accepted.push(file);
    }
    if (reasons.length > 0) setCompoError(reasons.join(' '));
    if (accepted.length === 0) return;
    void Promise.all(
      accepted.map(
        (file) =>
          new Promise<PendingFile>((done, fail) => {
            const reader = new FileReader();
            reader.onload = () => done({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name || '未命名', mime: file.type || 'application/octet-stream', data: String(reader.result ?? '') });
            reader.onerror = () => fail(reader.error ?? new Error(`「${file.name}」读不出来。`));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((read) => {
        setPendingFiles((current) => [...current, ...read].slice(0, BUTLER_FILE_MAX_COUNT));
        setCompoError(null);
      })
      .catch((why: unknown) => setCompoError(why instanceof Error ? why.message : String(why)));
  };

  const dropFile = (id: string) => setPendingFiles((current) => current.filter((file) => file.id !== id));

  return (
    <>
      <button
        type="button"
        className={`ib-butler-orb${open ? ' ib-butler-orb-open' : ''}`}
        aria-label="管家"
        title="管家"
        onClick={() => setOpen((current) => !current)}
      >
        <ButlerCharacter size={26} />
      </button>
      {open && (
        <div className="ib-butler-pane" role="dialog" aria-label="管家">
          <div className="ib-butler-top">
            <div className="ib-butler-top-buttons">
              <Tip content="复制在终端打开管家会话的命令">
                <button
                  type="button"
                  className="ib-iconbtn"
                  aria-label="复制管家会话的终端命令"
                  data-butler-session-copy={sessionCopy}
                  onClick={() => void copySession()}
                >
                  <Icon name={sessionCopy === 'copied' ? 'check' : 'terminal'} />
                </button>
              </Tip>
              <Tip content="关闭管家">
                <button type="button" className="ib-iconbtn" onClick={() => setOpen(false)} aria-label="关闭管家">
                  <Icon name="x" />
                </button>
              </Tip>
            </div>
            {/* 顶部只有悬浮的数字形象（owner 2026-11-25「顶部只有一个悬浮的数字形象，
                不要整体的header头部了」）：无条带无字，慢慢上下浮，底下投影随之收放。
                形象 = 二维剪影管家（owner 2026-11-25「我还是喜欢二维的svg风格」——
                Three.js 3D 狐狸试过被否），随对话状态换情绪。 */}
            <span className="ib-butler-avatar" title="管家">
              <ButlerCharacter size={72} mood={pending ? 'working' : sessionCopy === 'copied' ? 'happy' : 'idle'} />
              <span className="ib-butler-presence" aria-hidden="true" />
            </span>
          </div>
          <div className="ib-butler-tabs" role="tablist" aria-label="管家页">
            <button type="button" role="tab" aria-selected={tab === 'chat'} className={`ib-butler-tab${tab === 'chat' ? ' is-on' : ''}`} onClick={() => setTab('chat')}>
              对话
            </button>
            <button type="button" role="tab" aria-selected={tab === 'approvals'} className={`ib-butler-tab${tab === 'approvals' ? ' is-on' : ''}`} onClick={() => setTab('approvals')}>
              审批
              {approvalsPending > 0 && <span className="ib-butler-tab-badge">{approvalsPending}</span>}
            </button>
          </div>
          {tab === 'chat' ? (
          <>
          <div className="ib-butler-list" ref={listRef}>
            {turns.length === 0 && !pending ? (
              <div className="ib-butler-hero">
                <span className="ib-butler-hero-badge">
                  <ButlerCharacter size={96} mood={sessionCopy === 'copied' ? 'happy' : 'idle'} />
                </span>
                <h2 className="ib-butler-hero-word">{butlerGreeting()}</h2>
                <p className="ib-butler-hero-sub">我盯着每件事的进展，有动静会先说；真正动手，从需求卡片开启会话。</p>
                <div className="ib-butler-ideas">
                  {BUTLER_IDEAS.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      className="ib-butler-idea"
                      onClick={() => {
                        setDraft(idea);
                        compoRef.current?.focus();
                      }}
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {turns.map((turn, index) => {
                  // 管家的话按 markdown 画（ui 的净化渲染；流式中仍在长的最后一条保持纯文本，
                  // 完成的那一刻成格式化——不做逐增量重排）。
                  const streaming = pending && index === turns.length - 1 && turn.role === 'butler';
                  const md = turn.role === 'butler' && !streaming && turn.text !== '' ? chatMarkdownHtml(turn.text) : null;
                  return (
                    <div key={`${turn.at}-${index}`} className={`ib-butler-msg ib-butler-msg-${turn.role}`}>
                      {turn.files && turn.files.length > 0 && (
                        <span className="ib-butler-files" aria-label="附件">
                          <Icon name="clip" size={12} /> {turn.files.join('、')}
                        </span>
                      )}
                      {md !== null ? <div className="ib-butler-md" dangerouslySetInnerHTML={{ __html: md }} /> : turn.text}
                    </div>
                  );
                })}
                {pending && (
                  <div className="ib-butler-msg ib-butler-msg-butler ib-butler-typing" aria-label="管家正在回复">
                    <span className="ib-butler-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="ib-butler-inputrow">
            {compoError && (
              <p className="ib-butler-compoerr" role="alert">{compoError}</p>
            )}
            <div className="ib-butler-compo">
              {pendingFiles.length > 0 && (
                <div className="ib-butler-chips" aria-label="待发送附件">
                  {pendingFiles.map((file) => (
                    <span key={file.id} className="ib-butler-chip">
                      <Icon name={file.mime.startsWith('image/') ? 'artifacts' : 'doc'} size={12} />
                      <span className="ib-butler-chip-name" dir="auto">{file.name}</span>
                      <button type="button" className="ib-butler-chip-x" aria-label={`移除附件 ${file.name}`} onClick={() => dropFile(file.id)}>
                        <Icon name="x" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="ib-butler-entry">
                <Tip content="添加附件（图片、文件）">
                  <button type="button" className="ib-butler-add" aria-label="添加附件" onClick={() => fileInputRef.current?.click()}>
                    <Icon name="clip" size={16} />
                  </button>
                </Tip>
                <textarea
                  ref={compoRef}
                  className="ib-butler-input"
                  rows={2}
                  dir="auto"
                  placeholder="对管家说点什么…（可粘贴图片）"
                  value={draft}
                  disabled={pending}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={(event) => {
                    const files = takePastedFiles(event);
                    if (files.length > 0) {
                      event.preventDefault();
                      addFiles(files);
                    }
                  }}
                  onKeyDown={(event) => {
                    const enter = event.key === 'Enter';
                    if (enter) event.stopPropagation();
                    if (isImeCompositionKey(event) || !enter) return;
                    if (event.shiftKey) return;
                    event.preventDefault();
                    if (!pending) void send();
                  }}
                />
                <button type="button" className="ib-butler-send" aria-label="发送" onClick={() => void send()} disabled={pending || (!draft.trim() && pendingFiles.length === 0)}>
                  {pending ? <span className="ib-spin" aria-hidden="true" /> : <ButlerSendGlyph />}
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="ib-butler-fileinput"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </div>
          </>
          ) : (
            <ButlerApprovals
              model={approvalsModel}
              error={approvalsError}
              busy={approvalBusy}
              onDecide={(id, decision, always) => void decideApproval(id, decision, always)}
              onMode={(action, mode) => void setApprovalMode(action, mode)}
              onRefresh={loadApprovals}
            />
          )}
        </div>
      )}
    </>
  );
}

/** 时辰问候：管家开口的第一句。 */
function butlerGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了，管家在。';
  if (hour < 11) return '早上好。';
  if (hour < 13) return '中午好。';
  if (hour < 18) return '下午好。';
  return '晚上好。';
}

/** 起步的建议（点一下填进输入框）：都是管家真的做得到的事。 */
const BUTLER_IDEAS: readonly string[] = ['现在什么情况？', '帮我把一个想法整理成需求', '计划评审是怎么用的？', '代码评审的结论会去哪里？'];

/** 发送键的回车箭头（会话流同款）。 */
function ButlerSendGlyph() {
  return (
    <svg className="ib-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 5v6a4 4 0 0 1-4 4H5" />
      <path d="M9 11l-4 4 4 4" />
    </svg>
  );
}
