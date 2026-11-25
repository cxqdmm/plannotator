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
import { inboxApi } from '../api';
import { BUTLER_FILE_MAX_BYTES, BUTLER_FILE_MAX_COUNT } from '@plannotator/core/inbox-types';

/** 管家徽标：礼帽+领结（SVG，随容器尺寸缩放）。 */
function ButlerBadge({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      {/* 礼帽 */}
      <rect x="14" y="8" width="20" height="12" rx="3" fill="currentColor" />
      <rect x="10" y="19" width="28" height="4" rx="2" fill="currentColor" />
      {/* 领结 */}
      <path d="M24 30 L15 25 L15 35 Z" fill="currentColor" />
      <path d="M24 30 L33 25 L33 35 Z" fill="currentColor" />
      <circle cx="24" cy="30" r="3" fill="currentColor" />
      {/* 单眼（单片眼镜的雅致感） */}
      <circle cx="24" cy="26.5" r="1.2" fill="var(--background, #fff)" />
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
        <ButlerBadge size={26} />
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
            <div className="ib-butler-mast">
              <span className="ib-butler-avatar ib-butler-avatar-live">
                <ButlerBadge size={40} />
                <span className="ib-butler-presence" aria-hidden="true" />
              </span>
              <span className="ib-butler-id">
                <span className="ib-butler-name">管家</span>
                <span className="ib-butler-role">数字总管 · 随时吩咐</span>
              </span>
            </div>
          </div>
          <div className="ib-butler-list" ref={listRef}>
            {turns.length === 0 && !pending ? (
              <div className="ib-butler-hero">
                <span className="ib-butler-hero-badge">
                  <ButlerBadge size={60} />
                </span>
                <h2 className="ib-butler-hero-word">{butlerGreeting()}</h2>
                <p className="ib-butler-hero-sub">吩咐一声——我帮您把想法整理成需求卡片；真正动手，从卡片开启会话。</p>
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
const BUTLER_IDEAS: readonly string[] = ['帮我把一个想法整理成需求', '计划评审是怎么用的？', '代码评审的结论会去哪里？'];

/** 发送键的回车箭头（会话流同款）。 */
function ButlerSendGlyph() {
  return (
    <svg className="ib-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 5v6a4 4 0 0 1-4 4H5" />
      <path d="M9 11l-4 4 4 4" />
    </svg>
  );
}
