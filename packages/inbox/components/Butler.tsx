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
import { Tip } from '@plannotator/ui/components/inbox-thread/Tip';
import { Icon } from '../icons';
import { inboxApi, type InboxButlerApprovalsModel } from '../api';
import { ButlerApprovals, ButlerAuthSettings } from './ButlerApprovals';
import { ButlerLedger } from './ButlerLedger';
import { ButlerRichText } from './ButlerCards';
import { cardReplyOf } from './butler-card-protocol';
import { BUTLER_FILE_MAX_BYTES, BUTLER_FILE_MAX_COUNT } from '@plannotator/core/inbox-types';

/**
 * 管家的活形象（owner 2026-11-26「除了眼睛像，其他地方都不太像猫头鹰；要翘翘的耳朵、
 * 扑腾扑腾的翅膀」）：一只立在枝头的角鸮——两只尖耳朵、心形面盘带羽边、琥珀色大眼、
 * 蓬松眉羽，两片翅膀会成对扑腾（平时偶尔扑两下，开心时连续扑），头一直轻轻歪着晃。
 * 配色走 CSS 变量（--bc-*，inbox.css，深浅色同一套）。26px 悬浮球到 96px 首屏同一个，
 * 不放细碎装饰；prefers-reduced-motion 一律静止。
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
      {/* 枝头 + 叶子 */}
      <path d="M7 58 C19 55.2 45 55.2 57 57.2" stroke="var(--bc-branch, #b08f63)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M50.4 55.4 C52.6 52.6 56 52.8 57.4 55 C55 56.2 52.4 56.2 50.4 55.4 Z" fill="var(--bc-leaf, #9fbf8a)" />
      {/* 尾羽（在身后，向右翘） */}
      <g fill="var(--bc-fur-shade, #c9a877)">
        <path d="M42.4 48.6 q7.2 1 9.8 4.6 q-5.2 0.4 -8.6 -2.2 Z" />
        <path d="M42.8 52 q6 .8 8 3.6 q-4.4 0.4 -7.4 -1.8 Z" opacity="0.85" />
      </g>
      {/* 身体（坐姿）+ 胸脯羽纹 + 爪子 */}
      <ellipse cx="32" cy="45" rx="13.4" ry="11.6" fill="var(--bc-fur, #e3c79f)" />
      <ellipse cx="32" cy="48.6" rx="8.8" ry="7" fill="var(--bc-belly, #f8ecd9)" opacity="0.8" />
      <g stroke="var(--bc-fur-shade, #c9a877)" strokeWidth="0.8" strokeLinecap="round" fill="none" opacity="0.55">
        <path d="M27.4 45.6 q2.3 2.2 4.6 0 q2.3 2.2 4.6 0" />
        <path d="M27.4 49.4 q2.3 2.2 4.6 0 q2.3 2.2 4.6 0" />
      </g>
      <ellipse cx="27.6" cy="55.4" rx="2.4" ry="1.5" fill="var(--bc-beak, #eda53a)" />
      <ellipse cx="36.4" cy="55.4" rx="2.4" ry="1.5" fill="var(--bc-beak, #eda53a)" />
      {/* 翅膀：左右各一片，羽尖带叉口，会成对扑腾 */}
      <g className="ib-bc-wing-l">
        <path d="M19.8 36.8 C14 39 10.2 45 10.8 51.6 L13.2 54.8 L14.4 50.8 L16.6 54 L18 49.4 C19.4 45.2 20.4 40.6 21.4 38.2 Z" fill="var(--bc-fur-shade, #c9a877)" />
        <path d="M15.2 43.6 q-1.8 3.4 -1.6 6.6 M18.2 41.6 q-1.4 3.2 -1.2 6" stroke="var(--bc-fur, #e3c79f)" strokeWidth="0.85" strokeLinecap="round" fill="none" opacity="0.7" />
      </g>
      <g className="ib-bc-wing-r">
        <path d="M44.2 36.8 C50 39 53.8 45 53.2 51.6 L50.8 54.8 L49.6 50.8 L47.4 54 L46 49.4 C44.6 45.2 43.6 40.6 42.6 38.2 Z" fill="var(--bc-fur-shade, #c9a877)" />
        <path d="M48.8 43.6 q1.8 3.4 1.6 6.6 M45.8 41.6 q1.4 3.2 1.2 6" stroke="var(--bc-fur, #e3c79f)" strokeWidth="0.85" strokeLinecap="round" fill="none" opacity="0.7" />
      </g>
      {/* 头：两只尖耳朵、心形面盘（带羽边）、眉羽、眼睛、喙——整颗头轻轻歪着晃 */}
      <g className="ib-bc-head">
        {/* 耳朵（角鸮的尖耳，会抖） */}
        <g className="ib-bc-tuft-l">
          <path d="M22.6 16.6 L16.6 5 C16.2 4.2 17 3.6 17.8 4 L28.4 12.2 Z" fill="var(--bc-fur, #e3c79f)" />
          <path d="M22.2 15.8 L18 7 L26 12.4 Z" fill="var(--bc-fur-shade, #c9a877)" opacity="0.6" />
        </g>
        <g className="ib-bc-tuft-r">
          <path d="M41.4 16.6 L47.4 5 C47.8 4.2 47 3.6 46.2 4 L35.6 12.2 Z" fill="var(--bc-fur, #e3c79f)" />
          <path d="M41.8 15.8 L46 7 L38 12.4 Z" fill="var(--bc-fur-shade, #c9a877)" opacity="0.6" />
        </g>
        <circle cx="32" cy="26.6" r="14.6" fill="var(--bc-fur, #e3c79f)" />
        {/* 心形面盘 + 一圈羽边（猫头鹰的脸） */}
        <path d="M32 17.4 C36.6 17.4 42.2 20.4 43.8 26.2 C45.6 32.8 40.2 38.4 32 38.4 C23.8 38.4 18.4 32.8 20.2 26.2 C21.8 20.4 27.4 17.4 32 17.4 Z" fill="var(--bc-belly, #f8ecd9)" />
        <path d="M32 17.4 C36.6 17.4 42.2 20.4 43.8 26.2 C45.6 32.8 40.2 38.4 32 38.4 C23.8 38.4 18.4 32.8 20.2 26.2 C21.8 20.4 27.4 17.4 32 17.4 Z" fill="none" stroke="var(--bc-fur-shade, #c9a877)" strokeWidth="0.9" opacity="0.5" />
        {/* 蓬松眉羽（会挑） */}
        <g stroke="var(--bc-fur-shade, #c9a877)" strokeWidth="2" strokeLinecap="round" fill="none">
          <path className="ib-bc-brow-l" d="M21.6 20.6 q3.4 -2.8 6.6 -0.8" />
          <path className="ib-bc-brow-r" d="M42.4 20.6 q-3.4 -2.8 -6.6 -0.8" />
        </g>
        {/* 腮红 */}
        <ellipse cx="21.6" cy="32.6" rx="2.9" ry="1.7" fill="var(--bc-blush, #ef8f7d)" opacity="0.45" />
        <ellipse cx="42.4" cy="32.6" rx="2.9" ry="1.7" fill="var(--bc-blush, #ef8f7d)" opacity="0.45" />
        {/* 眼睛：happy 弯成弧；其余是琥珀虹膜的大眼，会眨（偶尔连眨两下） */}
        {mood === 'happy' ? (
          <g stroke="var(--bc-ink, #2b2320)" strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M22.2 26.8 q4.4 -4 8.8 0" />
            <path d="M33 26.8 q4.4 -4 8.8 0" />
          </g>
        ) : (
          <g className="ib-bc-eyes">
            <circle cx="26.6" cy="27" r="5.5" fill="var(--bc-eye-white, #fffdf7)" />
            <circle cx="37.4" cy="27" r="5.5" fill="var(--bc-eye-white, #fffdf7)" />
            <circle cx="26.6" cy="27" r="4.1" fill="var(--bc-iris, #e8a33d)" />
            <circle cx="37.4" cy="27" r="4.1" fill="var(--bc-iris, #e8a33d)" />
            <circle cx="26.9" cy="27.2" r="2.1" fill="var(--bc-ink, #2b2320)" />
            <circle cx="37.1" cy="27.2" r="2.1" fill="var(--bc-ink, #2b2320)" />
            <circle cx="25.4" cy="25.6" r="1.25" fill="#fff" />
            <circle cx="35.9" cy="25.6" r="1.25" fill="#fff" />
            <circle cx="27.9" cy="28.8" r="0.6" fill="#fff" opacity="0.85" />
            <circle cx="38.4" cy="28.8" r="0.6" fill="#fff" opacity="0.85" />
          </g>
        )}
        {/* 喙 + 一点笑意 */}
        <path d="M30.1 30.6 L33.9 30.6 L32 34.8 C31.5 35.4 30.6 35.2 30.4 34.6 Z" fill="var(--bc-beak, #eda53a)" />
        <path d="M30.7 35.4 q1.3 1 2.6 0" stroke="var(--bc-beak-shade, #c9862a)" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.75" />
      </g>
      {/* 领结：管家的身份 */}
      <g fill="var(--primary)">
        <path d="M32 38.6 L26.2 36.2 L26.2 41.4 Z" />
        <path d="M32 38.6 L37.8 36.2 L37.8 41.4 Z" />
        <circle cx="32" cy="38.8" r="1.9" />
      </g>
      <circle cx="32" cy="38.8" r="0.8" fill="var(--bc-belly, #f8ecd9)" opacity="0.9" />
      {/* working：头顶一颗小星光 */}
      <path className="ib-bc-spark" d="M47.4 13.6 l1.1 3 l3 1.1 l-3 1.1 l-1.1 3 l-1.1 -3 l-3 -1.1 l3 -1.1 z" fill="var(--primary)" />
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
  /**
   * 这一轮的「过程」（owner 2026-11-26「看不到管家的思考过程和工具调用」）：模型的思考增量
   * 与工具调用，只属于正在进行的这一轮；历史里只存正文，所以下一轮开始时清空。
   */
  const [live, setLive] = useState<{ reasoning: string; tools: ButlerToolCall[] }>({ reasoning: '', tools: [] });
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  /**
   * 右侧抽屉（owner 2026-11-26「不要页签，对话常驻；审批/配置从右边像抽屉一样挤出来」）：
   * `drawer` 是当前开着的那一栏，`shown` 是还在动画里的内容（收起时留到宽度动画结束再卸载，
   * 否则会看到一条空白面板缩回去）。
   */
  const [drawer, setDrawerState] = useState<'approvals' | 'config' | 'ledger' | null>(null);
  const [shown, setShown] = useState<'approvals' | 'config' | 'ledger' | null>(null);
  const drawerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDrawer = (next: 'approvals' | 'config' | 'ledger' | null) => {
    if (drawerTimer.current) {
      clearTimeout(drawerTimer.current);
      drawerTimer.current = null;
    }
    if (next !== null) {
      setShown(next);
      setDrawerState(next);
      return;
    }
    setDrawerState(null);
    drawerTimer.current = setTimeout(() => {
      setShown(null);
      drawerTimer.current = null;
    }, 380);
  };
  useEffect(() => () => {
    if (drawerTimer.current) clearTimeout(drawerTimer.current);
  }, []);
  const [approvalsModel, setApprovalsModel] = useState<InboxButlerApprovalsModel | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  /** The Inbox's projects, for the card's project picker in the approval tab. */
  const [projects, setProjects] = useState<{ id: string; name: string; root: string }[]>([]);
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
    const timer = setInterval(loadApprovals, 5000);
    return () => clearInterval(timer);
  }, [open]);

  const decideApproval = async (id: string, decision: 'approve' | 'deny', always: boolean, projectId?: string | null, note?: string) => {
    if (approvalBusy) return;
    setApprovalBusy(id);
    setApprovalsError(null);
    try {
      await inboxApi.butlerApprovalDecide(id, {
        decision,
        ...(always ? { always: true } : {}),
        ...(projectId !== undefined ? { project_id: projectId } : {}),
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

  // ESC：先收抽屉，再收整页（与全屏面板的其它入口一致）。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (drawer !== null) setDrawer(null);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, drawer]);

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
      <button
        type="button"
        className={`ib-butler-orb${open ? ' ib-butler-orb-open' : ''}`}
        aria-label="管家"
        title="管家"
        onClick={() => setOpen((current) => !current)}
      >
        <ButlerCharacter size={52} />
      </button>
      {open && (
        <div className="ib-butler-pane" role="dialog" aria-label="管家">
          <div className="ib-butler-main">
          <div className="ib-butler-top">
            {/* 左上角：审批（带待批数）/ 配置——右侧抽屉的入口（owner 2026-11-26）。 */}
            <div className="ib-butler-rail" role="group" aria-label="管家面板">
              <button
                type="button"
                className="ib-butler-railbtn"
                data-on={drawer === 'approvals'}
                aria-pressed={drawer === 'approvals'}
                aria-label={approvalsPending > 0 ? `审批（${approvalsPending} 件待批）` : '审批'}
                onClick={() => setDrawer(drawer === 'approvals' ? null : 'approvals')}
              >
                <Icon name="checkCircle" size={15} />
                审批
                {approvalsPending > 0 && <span className="ib-butler-railbadge">{approvalsPending}</span>}
              </button>
              <button
                type="button"
                className="ib-butler-railbtn"
                data-on={drawer === 'config'}
                aria-pressed={drawer === 'config'}
                aria-label="配置"
                onClick={() => setDrawer(drawer === 'config' ? null : 'config')}
              >
                <Icon name="settings" size={15} />
                配置
              </button>
              <button
                type="button"
                className="ib-butler-railbtn"
                data-on={drawer === 'ledger'}
                aria-pressed={drawer === 'ledger'}
                aria-label="台账"
                onClick={() => setDrawer(drawer === 'ledger' ? null : 'ledger')}
              >
                <Icon name="book" size={15} />
                台账
              </button>
            </div>
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
          {/* 右侧抽屉：不是浮层——占位挤压，对话列随之变窄（owner 2026-11-26「像抽屉一样
              挤出来，对话页面的宽度就变窄」）。收起时内容留到宽度动画结束再卸载。 */}
          <aside
            className="ib-butler-side"
            data-open={drawer !== null}
            aria-hidden={drawer === null}
            aria-label={shown === 'config' ? '配置' : shown === 'ledger' ? '台账' : '待批事项'}
          >
            <div className="ib-butler-side-inner">
              <header className="ib-butler-side-head">
                <div>
                  <span className="ib-butler-side-kicker">{shown === 'config' ? 'SETTINGS' : shown === 'ledger' ? 'LEDGER' : 'APPROVALS'}</span>
                  <h2>{shown === 'config' ? '配置' : shown === 'ledger' ? '台账' : '待批事项'}</h2>
                </div>
                <Tip content="收起侧栏">
                  <button type="button" className="ib-iconbtn" aria-label="收起侧栏" onClick={() => setDrawer(null)}>
                    <Icon name="x" />
                  </button>
                </Tip>
              </header>
              <div className="ib-butler-side-body">
                {shown === 'approvals' && (
                  <ButlerApprovals
                    model={approvalsModel}
                    projects={projects}
                    error={approvalsError}
                    busy={approvalBusy}
                    onDecide={(id, decision, always, projectId, note) => void decideApproval(id, decision, always, projectId, note)}
                    onRefresh={loadApprovals}
                  />
                )}
                {shown === 'ledger' && <ButlerLedger open={drawer === 'ledger'} />}
                {shown === 'config' && (
                  <ButlerAuthSettings
                    model={approvalsModel}
                    error={approvalsError}
                    onMode={(action, mode) => void setApprovalMode(action, mode)}
                  />
                )}
              </div>
            </div>
          </aside>
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
