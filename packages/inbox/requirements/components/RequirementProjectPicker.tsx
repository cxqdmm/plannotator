/**
 * 需求卡上的项目选择（owner 2026-11-27「参考工坊新建会话里的项目选择，这样还能做到新建文件夹
 * 和其他文件夹」）：the card's compact project trigger opens the same folder browser the Workshop's
 * New message uses, so the person can pick an existing Inbox project, another folder, or type a new
 * folder name. A folder that is not a project yet is resolved by the Inbox (its repository, when it is
 * in one) before the card keeps its id, so launching the requirement later starts in the right place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { tooltipContainerOf } from '@plannotator/ui/components/HostTitle';
import { HomeFolderBrowser } from '../../compose/HomeFolderBrowser';
import { inboxApi, type SettingsModel } from '../../api';
import { Icon } from '../../icons';

export interface RequirementProjectChoice {
  id: string;
  name: string;
  root: string;
}

export function RequirementProjectPicker({
  projects,
  selected,
  onPick,
  onProjectsChanged,
}: {
  projects: RequirementProjectChoice[];
  selected: RequirementProjectChoice | null;
  onPick: (project: RequirementProjectChoice | null) => void;
  /** A folder became (or was found as) a project: the card's list keeps it for this open card. */
  onProjectsChanged: (projects: RequirementProjectChoice[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'folder'>('list');
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [kept, setKept] = useState('~/');
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The folder browser reads through this computer's launch routes; its home makes `~/…` readable
  // and pasted full paths show as `~/…`. Read once, when the menu first opens.
  useEffect(() => {
    if (!open || settings) return;
    let alive = true;
    void inboxApi.settings().then((answer) => { if (alive) setSettings(answer); }).catch(() => { if (alive) setSettings(null); });
    return () => { alive = false; };
  }, [open, settings]);

  // Every open starts on the project list, the way the Workshop's folder menu does.
  useEffect(() => {
    if (open) return;
    setView('list');
    setQuery('');
    setError(null);
    setBusy(false);
    setNewFolder(false);
  }, [open]);

  const canBrowse = settings === null || (settings.launch?.enabled !== false && settings.launch?.unsupported !== true);
  const home = settings?.home ?? null;
  // The current project stays listed even when the projects read is older than the card's own field.
  const choices = useMemo(
    () => (selected && !projects.some((project) => project.id === selected.id) ? [selected, ...projects] : projects),
    [projects, selected],
  );
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return choices;
    return choices.filter((project) => project.name.toLowerCase().includes(words) || project.root.toLowerCase().includes(words));
  }, [choices, query]);
  const container = triggerRef.current ? (tooltipContainerOf(triggerRef.current) ?? triggerRef.current.closest<HTMLElement>('.pn-inbox') ?? undefined) : undefined;

  const choose = (project: RequirementProjectChoice | null) => {
    onPick(project);
    setOpen(false);
  };

  const pickFolder = async (folder: string, _name: string, how: 'start' | 'create' | 'clone') => {
    if (how === 'clone') return;
    setBusy(true);
    setError(null);
    try {
      const answer = await inboxApi.ensureProject(folder, how === 'create' ? { create: true } : {});
      const project = answer.project;
      if (!choices.some((entry) => entry.id === project.id)) onProjectsChanged([...choices, project]);
      onPick(project);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '这个文件夹不能用。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        ref={triggerRef}
        render={<button type="button" className="ib-req-project-btn" aria-label={selected ? `项目：${selected.name}。更改` : '选择项目'} />}
      >
        <span className="ib-req-project-k">项目</span>
        <span className="ib-req-project-v" title={selected?.root}>{selected ? selected.name : '未指定'}</span>
        <Icon name="chevD" size={12} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner className="ib-req-project-pos" side="bottom" align="start" sideOffset={6} collisionPadding={10}>
          <Popover.Popup className="ib-req-project-pop" aria-label="选择项目" initialFocus={false} finalFocus={triggerRef}>
            {view === 'list' ? (
              <div className="ib-req-project-list">
                <div className="ib-req-project-head">
                  <b>项目</b>
                  <span>新会话会从这个项目的目录开始</span>
                </div>
                <label className="ib-req-project-search">
                  <Icon name="search" size={14} />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="查找项目"
                    aria-label="查找项目"
                  />
                </label>
                <div className="ib-req-project-rows" role="listbox" aria-label="项目">
                  <button
                    type="button"
                    className={`ib-req-project-row${selected === null ? ' is-on' : ''}`}
                    role="option"
                    aria-selected={selected === null}
                    onClick={() => choose(null)}
                  >
                    <span className="ib-req-project-rowtext">
                      <b>未指定</b>
                      <small>之后可以在需求卡里再选</small>
                    </span>
                    {selected === null && <Icon name="check" size={14} />}
                  </button>
                  {visible.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={`ib-req-project-row${selected?.id === project.id ? ' is-on' : ''}`}
                      role="option"
                      aria-selected={selected?.id === project.id}
                      title={project.root}
                      onClick={() => choose(project)}
                    >
                      <span className="ib-req-project-rowtext">
                        <b>{project.name}</b>
                        <small>{project.root}</small>
                      </span>
                      {selected?.id === project.id && <Icon name="check" size={14} />}
                    </button>
                  ))}
                  {visible.length === 0 && <p className="ib-req-project-none">没有匹配的项目。</p>}
                </div>
                {canBrowse ? (
                  <div className="ib-req-project-more">
                    <button type="button" onClick={() => { setNewFolder(false); setError(null); setView('folder'); }}>
                      <Icon name="folder" size={14} />
                      <span><b>其他文件夹…</b><small>选一个已有的文件夹作为项目</small></span>
                    </button>
                    <button type="button" onClick={() => { setNewFolder(true); setError(null); setView('folder'); }}>
                      <Icon name="folderPlus" size={14} />
                      <span><b>新建文件夹…</b><small>输入新名字，直接建成项目</small></span>
                    </button>
                  </div>
                ) : (
                  <p className="ib-req-project-off">文件夹选择需要开启「从新消息启动」。</p>
                )}
              </div>
            ) : (
              <div className="ib-req-project-browser" aria-busy={busy}>
                <HomeFolderBrowser
                  machine={{ id: null, name: null, home }}
                  purpose="project"
                  initialPath={newFolder ? '~/' : kept}
                  onTyped={(typed) => setKept(typed)}
                  onBack={() => { setView('list'); setError(null); }}
                  onPick={(folder, name, how) => void pickFolder(folder, name, how)}
                />
                {busy && <p className="ib-req-project-busy">正在选中…</p>}
                {error && <p className="ib-req-project-error" role="alert">{error}</p>}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The launch agents this Inbox can start (from the compose sessions read), for the card's agent picker. */
export interface RequirementAgentChoice {
  agent: string;
  name: string;
}

/** 需求卡上的 agent 选择：这张卡以后的会话默认用哪个 agent 起（未指定 = 启动时再说）。 */
export function RequirementAgentPicker({
  agents,
  selected,
  onPick,
}: {
  agents: RequirementAgentChoice[];
  selected: string | null;
  onPick: (agent: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shown = selected ? (agents.find((entry) => entry.agent === selected)?.name ?? selected) : '未指定';
  const container = triggerRef.current ? (tooltipContainerOf(triggerRef.current) ?? triggerRef.current.closest<HTMLElement>('.pn-inbox') ?? undefined) : undefined;
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        ref={triggerRef}
        render={<button type="button" className="ib-req-project-btn" aria-label={selected ? `执行 agent：${shown}。更改` : '选择执行 agent'} />}
      >
        <span className="ib-req-project-k">agent</span>
        <span className="ib-req-project-v">{shown}</span>
        <Icon name="chevD" size={12} />
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner className="ib-req-project-pos" side="bottom" align="start" sideOffset={6} collisionPadding={10}>
          <Popover.Popup className="ib-req-project-pop ib-req-agent-pop" aria-label="选择执行 agent" initialFocus={false} finalFocus={triggerRef}>
            <div className="ib-req-project-list">
              <div className="ib-req-project-head">
                <b>执行 agent</b>
                <span>这张卡以后的会话默认用它起</span>
              </div>
              <div className="ib-req-project-rows" role="listbox" aria-label="执行 agent">
                <button
                  type="button"
                  className={`ib-req-project-row${selected === null ? ' is-on' : ''}`}
                  role="option"
                  aria-selected={selected === null}
                  onClick={() => { onPick(null); setOpen(false); }}
                >
                  <span className="ib-req-project-rowtext">
                    <b>未指定</b>
                    <small>启动时再选，或听管家安排</small>
                  </span>
                  {selected === null && <Icon name="check" size={14} />}
                </button>
                {agents.map((entry) => (
                  <button
                    key={entry.agent}
                    type="button"
                    className={`ib-req-project-row${selected === entry.agent ? ' is-on' : ''}`}
                    role="option"
                    aria-selected={selected === entry.agent}
                    onClick={() => { onPick(entry.agent); setOpen(false); }}
                  >
                    <span className="ib-req-project-rowtext">
                      <b>{entry.name}</b>
                      <small>{entry.agent}</small>
                    </span>
                    {selected === entry.agent && <Icon name="check" size={14} />}
                  </button>
                ))}
                {agents.length === 0 && <p className="ib-req-project-none">这台收件箱开不了新会话，agent 在启动时再说。</p>}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
