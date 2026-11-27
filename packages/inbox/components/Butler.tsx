/**
 * 管家（approval "butler" 一期）：the Inbox's digital butler. Its owl lives in
 * the sidebar brand (left of "Plannotator Inbox") and opens — with the entry
 * animation — the full-screen butler view: the butler's avatar up top, the
 * dialog at the bottom. The brain is the daemon's butler chat route (the
 * configured model with the butler persona; history persists in the butler folder).
 */
import { useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '@plannotator/ui/utils/clipboard';
import { isImeCompositionKey } from '@plannotator/ui/utils/commentSubmitKey';
import { Tip } from '@plannotator/ui/components/inbox-thread/Tip';
import { Icon } from '../icons';
import { inboxApi, type InboxButlerApprovalsModel } from '../api';
import { ButlerApprovals, ButlerAuthSettings } from './ButlerApprovals';
import { ButlerLedger } from './ButlerLedger';
import { ButlerCharacter } from './ButlerCharacter';
import { ButlerRichText } from './ButlerCards';
import { cardReplyOf } from './butler-card-protocol';
import { BUTLER_FILE_MAX_BYTES, BUTLER_FILE_MAX_COUNT } from '@plannotator/core/inbox-types';



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
  /**
   * 这一轮的「过程」（owner 2026-11-26「看不到管家的思考过程和工具调用」）：模型的思考增量
   * 与工具调用，只属于正在进行的这一轮；历史里只存正文，所以下一轮开始时清空。
   */
  const [live, setLive] = useState<{ reasoning: string; tools: ButlerToolCall[] }>({ reasoning: '', tools: [] });
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  /**
   * 左侧菜单 + 右侧内容（owner 2026-11-27「改成 inbox 主页的风格，分成菜单和右侧内容
   * 区域」）：`section` 是菜单选中的一栏——对话、审批、台账；配置是菜单底部的一个入口，
   * 点开内容区整体换成配置。对话常驻为默认一栏。
   */
  const [section, setSection] = useState<'chat' | 'approvals' | 'ledger' | 'config'>('chat');
  const [approvalsModel, setApprovalsModel] = useState<InboxButlerApprovalsModel | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  /** The Inbox's projects, for the card's project picker in the approval tab. */
  const [projects, setProjects] = useState<{ id: string; name: string; root: string }[]>([]);
  /** 这台收件箱能开的 agent（新建会话同一份），建卡审批选默认执行 agent 用。 */
  const [agents, setAgents] = useState<{ agent: string; name: string }[]>([]);
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
    void inboxApi.projectsList().then((answer) => setProjects(answer.projects ?? [])).catch(() => setProjects([]));
    void inboxApi.composeSessions().then((model) => setAgents((model.launch?.agents ?? []).map((entry) => ({ agent: entry.agent, name: entry.name })))).catch(() => setAgents([]));
    const timer = setInterval(loadApprovals, 5000);
    return () => clearInterval(timer);
  }, [open]);

  const decideApproval = async (id: string, decision: 'approve' | 'deny', always: boolean, projectId?: string | null, agent?: string | null, note?: string) => {
    if (approvalBusy) return;
    setApprovalBusy(id);
    setApprovalsError(null);
    try {
      await inboxApi.butlerApprovalDecide(id, {
        decision,
        ...(always ? { always: true } : {}),
        ...(projectId !== undefined ? { project_id: projectId } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(note && note.trim() ? { note: note.trim() } : {}),
      });
      loadApprovals();
    } catch (error) {
      setApprovalsError(error instanceof Error ? error.message : String(error));
    } finally {
      setApprovalBusy(null);
    }
  };

  const setApprovalMode = async (action: 'create-requirement' | 'launch-session' | 'archive-requirement' | 'stop-session', mode: 'ask' | 'auto') => {
    setApprovalsError(null);
    try {
      await inboxApi.butlerApprovalSettings(action, mode);
      loadApprovals();
    } catch (error) {
      setApprovalsError(error instanceof Error ? error.message : String(error));
    }
  };

  // ESC 收整页（与全屏面板的其它入口一致）。
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

  // 卡片自己报高度后，若列表本来贴着底部就继续贴底（M2：卡片加载不把视线甩走）。
  useEffect(() => {
    if (!open) return;
    const onCardResize = () => {
      const list = listRef.current;
      if (!list) return;
      if (list.scrollHeight - list.scrollTop - list.clientHeight < 120) list.scrollTop = list.scrollHeight;
    };
    window.addEventListener('butler:card-resize', onCardResize);
    return () => window.removeEventListener('butler:card-resize', onCardResize);
  }, [open]);

  const send = async () => {
    const message = draft.trim();
    if ((!message && pendingFiles.length === 0) || pending) return;
    setDraft('');
    const files = pendingFiles;
    setPendingFiles([]);
    await sendText(message, files);
  };

  /** 真正发一轮：输入框与卡片回话（「来自卡片：…」）共用同一条路径。 */
  const sendText = async (message: string, files: PendingFile[] = []) => {
    if (pending) return;
    setCompoError(null);
    setTurns((current) => [...current, { at: new Date().toISOString(), role: 'you', text: message, ...(files.length ? { files: files.map((file) => file.name) } : {}) }]);
    setPending(true);
    setLive({ reasoning: '', tools: [] });
    // 流式（v3，owner 2026-11-25「像 web 版一样」）：管家的回复随增量生长。
    const streamAt = new Date().toISOString();
    setTurns((current) => [...current, { at: streamAt, role: 'butler', text: '' }]);
    try {
      const reply = await inboxApi.butlerChatStream(
        message || `（发来了 ${files.length} 个附件）`,
        {
          onDelta: (delta) => {
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1]!;
              next[next.length - 1] = { ...last, text: last.text + delta };
              return next;
            });
          },
          onReasoning: (delta) => setLive((current) => ({ ...current, reasoning: current.reasoning + delta })),
          onTool: (tool) =>
            setLive((current) => ({
              ...current,
              tools: [...current.tools.filter((each) => each.id !== tool.id), { id: tool.id, name: tool.name, input: tool.input }],
            })),
          onToolResult: (result) =>
            setLive((current) => ({
              ...current,
              tools: current.tools.map((each) => (result.id !== null && each.id !== result.id ? each : { ...each, result: result.text })),
            })),
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
      {open && (
        <div className="ib-butler-pane" role="dialog" aria-label="管家">
          {/* 左侧菜单（inbox 主页风格）：顶部猫头鹰，中部对话/审批/台账，底部配置 + 终端。 */}
          <nav className="ib-butler-nav" aria-label="管家面板">
            <span className="ib-butler-nav-owl" title="管家">
              <ButlerCharacter size={56} mood={pending ? 'working' : sessionCopy === 'copied' ? 'happy' : 'idle'} />
            </span>
            <div className="ib-butler-nav-group" role="tablist" aria-label="管家面板">
              <button
                type="button"
                className="ib-butler-navbtn"
                role="tab"
                aria-selected={section === 'chat'}
                data-on={section === 'chat'}
                onClick={() => setSection('chat')}
              >
                <Icon name="comment" size={15} />
                对话
              </button>
              <button
                type="button"
                className="ib-butler-navbtn"
                role="tab"
                aria-selected={section === 'approvals'}
                data-on={section === 'approvals'}
                aria-label={approvalsPending > 0 ? `审批（${approvalsPending} 件待批）` : '审批'}
                onClick={() => setSection('approvals')}
              >
                <Icon name="checkCircle" size={15} />
                审批
                {approvalsPending > 0 && <span className="ib-butler-railbadge">{approvalsPending}</span>}
              </button>
              <button
                type="button"
                className="ib-butler-navbtn"
                role="tab"
                aria-selected={section === 'ledger'}
                data-on={section === 'ledger'}
                onClick={() => setSection('ledger')}
              >
                <Icon name="book" size={15} />
                台账
              </button>
            </div>
            <div className="ib-butler-nav-foot">
              <button
                type="button"
                className="ib-butler-navbtn"
                role="tab"
                aria-selected={section === 'config'}
                data-on={section === 'config'}
                onClick={() => setSection('config')}
              >
                <Icon name="settings" size={15} />
                配置
              </button>
              <Tip content="复制在终端打开管家会话的命令">
                <button
                  type="button"
                  className="ib-butler-navbtn ib-butler-nav-ico"
                  aria-label="复制管家会话的终端命令"
                  data-butler-session-copy={sessionCopy}
                  onClick={() => void copySession()}
                >
                  <Icon name={sessionCopy === 'copied' ? 'check' : 'terminal'} size={15} />
                </button>
              </Tip>
            </div>
          </nav>
          {/* 右侧内容区：菜单选中哪栏，这里就是哪栏。 */}
          <div className="ib-butler-content">
            {section === 'chat' && (
              <div className="ib-butler-chat">
                <div className="ib-butler-top">
                  <div className="ib-butler-top-buttons">
                    <Tip content="关闭管家">
                      <button type="button" className="ib-iconbtn" onClick={() => setOpen(false)} aria-label="关闭管家">
                        <Icon name="x" />
                      </button>
                    </Tip>
                  </div>
                  <span className="ib-butler-avatar" title="管家">
                    <ButlerCharacter size={144} mood={pending ? 'working' : sessionCopy === 'copied' ? 'happy' : 'idle'} />
                    <span className="ib-butler-presence" aria-hidden="true" />
                  </span>
                </div>
                <div className="ib-butler-list" ref={listRef}>
                  {turns.length === 0 && !pending ? (
                    <div className="ib-butler-hero">
                      <span className="ib-butler-hero-badge">
                        <ButlerCharacter size={192} mood={sessionCopy === 'copied' ? 'happy' : 'idle'} />
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
                        const showProcess = index === turns.length - 1 && turn.role === 'butler' && (live.reasoning !== '' || live.tools.length > 0);
                        return (
                          <div key={`${turn.at}-${index}`} className={`ib-butler-msg ib-butler-msg-${turn.role}`}>
                            {showProcess && <ButlerProcess reasoning={live.reasoning} tools={live.tools} streaming={streaming || pending} answered={turn.text !== ''} />}
                            {turn.files && turn.files.length > 0 && (
                              <span className="ib-butler-files" aria-label="附件">
                                <Icon name="clip" size={12} /> {turn.files.join('、')}
                              </span>
                            )}
                            {turn.role === 'butler' ? (
                              <ButlerRichText text={turn.text} streaming={streaming} onCardMessage={(text) => void sendText(text)} />
                            ) : cardReplyOf(turn.text) !== null ? (
                              // 卡片按钮回话：不是主人打字，用专门的标记画（M2）。
                              <span className="ib-butler-cardreply">
                                <Icon name="checkCircle" size={12} />
                                {cardReplyOf(turn.text)}
                              </span>
                            ) : (
                              turn.text
                            )}
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
            {section === 'approvals' && (
              <section className="ib-butler-view" aria-label="待批事项">
                <header className="ib-butler-view-head">
                  <div>
                    <span className="ib-butler-side-kicker">APPROVALS</span>
                    <h2>待批事项</h2>
                  </div>
                  <Tip content="关闭管家">
                    <button type="button" className="ib-iconbtn" onClick={() => setOpen(false)} aria-label="关闭管家">
                      <Icon name="x" />
                    </button>
                  </Tip>
                </header>
                <div className="ib-butler-view-body">
                  <ButlerApprovals
                    model={approvalsModel}
                    projects={projects}
                    onProjectsChanged={setProjects}
                    agents={agents}
                    error={approvalsError}
                    busy={approvalBusy}
                    onDecide={(id, decision, always, projectId, agent, note) => void decideApproval(id, decision, always, projectId, agent, note)}
                    onRefresh={loadApprovals}
                  />
                </div>
              </section>
            )}
            {section === 'ledger' && (
              <section className="ib-butler-view" aria-label="台账">
                <header className="ib-butler-view-head">
                  <div>
                    <span className="ib-butler-side-kicker">LEDGER</span>
                    <h2>台账</h2>
                  </div>
                  <Tip content="关闭管家">
                    <button type="button" className="ib-iconbtn" onClick={() => setOpen(false)} aria-label="关闭管家">
                      <Icon name="x" />
                    </button>
                  </Tip>
                </header>
                <div className="ib-butler-view-body">
                  <ButlerLedger open />
                </div>
              </section>
            )}
            {section === 'config' && (
              <section className="ib-butler-view" aria-label="配置">
                <header className="ib-butler-view-head">
                  <div>
                    <span className="ib-butler-side-kicker">SETTINGS</span>
                    <h2>配置</h2>
                  </div>
                  <Tip content="关闭管家">
                    <button type="button" className="ib-iconbtn" onClick={() => setOpen(false)} aria-label="关闭管家">
                      <Icon name="x" />
                    </button>
                  </Tip>
                </header>
                <div className="ib-butler-view-body">
                  <ButlerAuthSettings
                    model={approvalsModel}
                    error={approvalsError}
                    onMode={(action, mode) => void setApprovalMode(action, mode)}
                  />
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** 一轮里的工具调用（过程视图用；历史不存）。 */
interface ButlerToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

/**
 * 一轮对话的过程（owner 2026-11-26「看不到管家的思考过程和工具调用」）：可折叠的「思考」，
 * 加上每次工具调用的名字、输入摘要与结果。回答开始出现后「思考」自动收起；下一轮开始时整块清空。
 */
function ButlerProcess({ reasoning, tools, streaming, answered }: { reasoning: string; tools: ButlerToolCall[]; streaming: boolean; answered: boolean }) {
  return (
    <div className="ib-butler-proc">
      {reasoning !== '' && (
        <details className="ib-butler-think" open={!answered}>
          <summary>
            <span className="ib-butler-proc-k">思考</span>
            <span className="ib-butler-proc-n">{streaming && !answered ? '正在想…' : `${reasoning.length} 字`}</span>
          </summary>
          <div className="ib-butler-think-body">{reasoning}</div>
        </details>
      )}
      {tools.length > 0 && (
        <div className="ib-butler-tools">
          {tools.map((tool) => (
            <details key={tool.id} className="ib-butler-tool" data-done={tool.result !== undefined}>
              <summary>
                <span className="ib-butler-tool-name">{tool.name}</span>
                <span className="ib-butler-tool-arg">{butlerToolArg(tool.input)}</span>
                <span className="ib-butler-tool-state">{tool.result === undefined ? (streaming ? '运行中' : '已结束') : '完成'}</span>
              </summary>
              {tool.result !== undefined && <pre className="ib-butler-tool-out">{tool.result.slice(0, 2000)}</pre>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/** 工具输入的一行摘要：常见字段优先，否则 JSON 截断。 */
function butlerToolArg(input: Record<string, unknown>): string {
  for (const key of ['command', 'path', 'filePath', 'file_path', 'pattern', 'query', 'url', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.length > 90 ? `${value.slice(0, 90)}…` : value;
  }
  const json = JSON.stringify(input);
  return json.length > 90 ? `${json.slice(0, 90)}…` : json;
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
