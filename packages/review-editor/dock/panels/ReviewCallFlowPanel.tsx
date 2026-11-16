import React, { useEffect, useMemo, useState } from 'react';
import type { CallFlowAdvert, CallFlowInstallStage, CallFlowNode } from '@plannotator/shared/call-flow-types';
import { getCallFlowLanguage, type CallFlowLanguageId } from '@plannotator/shared/call-flow-languages';
import type { CallFlowInstallController } from '../../hooks/useCallFlowInstall';
import { Popover } from '@base-ui/react/popover';
import { Check, Info, Settings2, X } from 'lucide-react';
import { Tooltip } from '@plannotator/ui/components/Tooltip';
import { useReviewState } from '../ReviewStateContext';
import { useCallFlowNodeSource } from '../../hooks/useCallFlowNodeSource';
import {
  CallFlowTreeView,
  selectionForCallFlowNode,
} from '../../components/CallFlowTreeView';
import { CallFlowRawView } from '../../components/CallFlowRawView';
import { CallTreeList } from '../../components/callTree/CallTreeList';
import { callTreeFromEntry } from '@plannotator/shared/call-tree';
import { formatCallFlowInstallSize } from '../../utils/callFlowPresentation';

function errorMessage(error: Exclude<import('@plannotator/shared/call-flow-types').CallFlowResponse, { status: 'ok' }> | Error): string {
  return error.message || '调用流分析失败。';
}

const INSTALL_STAGES: ReadonlyArray<{ id: CallFlowInstallStage; label: string }> = [
  { id: 'downloading', label: '正在下载固定版本的包' },
  { id: 'verifying', label: '正在校验包完整性' },
  { id: 'installing-deps', label: '正在安装固定版本的依赖' },
  { id: 'building', label: '正在准备原生运行时' },
];

function isNodeInstallError(reason: string | undefined): boolean {
  return reason === 'node-unavailable' || reason === 'node-version';
}

function installFailedForLanguage(
  status: CallFlowInstallController['status'],
  languageId: CallFlowLanguageId,
): status is Extract<CallFlowInstallController['status'], { state: 'error' }> {
  if (status.state !== 'error') return false;
  if (status.currentLanguageId) return status.currentLanguageId === languageId;
  return status.languageIds?.includes(languageId) === true;
}

function installIncludesLanguage(
  status: CallFlowInstallController['status'],
  languageId: CallFlowLanguageId,
): boolean {
  return status.state === 'running' && status.languageIds.includes(languageId);
}

function CallFlowLanguagesMenu({
  languages,
  installable,
  install,
}: {
  readonly languages: NonNullable<CallFlowAdvert['languages']>;
  readonly installable: boolean;
  readonly install: CallFlowInstallController;
}) {
  const installed = languages.filter((language) => language.installed);
  const installedSize = installed.reduce((total, language) => total + language.installSizeBytes, 0);
  return (
    <Popover.Root>
      <Popover.Trigger render={
        <button
          type="button"
          className="call-flow-languages-trigger"
          aria-label={`管理调用流语言。已安装 ${installed.length}/${languages.length}。`}
          aria-busy={install.status.state === 'running'}
        />
      }>
        <Settings2 aria-hidden="true" size={14} strokeWidth={1.75} />
        <span>语言</span>
        <span className="call-flow-languages-trigger-count">{installed.length}/{languages.length}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" side="bottom" sideOffset={6} className="z-[110]">
          <Popover.Popup
            className="call-flow-languages-popover shadow-lg popover-enter"
            aria-label="调用流语言支持"
          >
            <header className="call-flow-languages-popover-header">
              <div>
                <strong>语言支持</strong>
                <span>提前安装解析器，供下次评审使用。</span>
              </div>
              <span>已安装 {formatCallFlowInstallSize(installedSize)}</span>
            </header>
            <ul aria-live="polite">
              {languages.map((language) => {
                const languageInstallError = installFailedForLanguage(install.status, language.id)
                  ? install.status
                  : undefined;
                const languageInstalling = installIncludesLanguage(install.status, language.id);
                const requirement = language.required
                  ? `有 ${language.changedFiles} 个更改文件需要此语言`
                  : '可用';
                return (
                  <li key={language.id}>
                    <span>
                      <strong>{language.label}</strong>
                      <small>
                        {language.installed
                          ? `已安装 · ${formatCallFlowInstallSize(language.installSizeBytes)}`
                          : `${requirement} · ${formatCallFlowInstallSize(language.installSizeBytes)}`}
                      </small>
                      {languageInstalling && <small className="call-flow-language-progress">安装中…</small>}
                      {languageInstallError && (
                        <small className="call-flow-language-error">安装失败：{languageInstallError.error}</small>
                      )}
                    </span>
                    {!language.installed
                      && language.kind === 'pack'
                      && installable
                      && !languageInstalling
                      && (
                      <button
                        type="button"
                        onClick={() => install.start([language.id])}
                        disabled={install.status.state === 'running'}
                      >
                        {languageInstallError ? '重试' : '安装'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Background setup progress shown only for the runtime-missing flavor of an
 * unavailable advert. Never rendered for unsupported views or while the
 * feature is disabled. The toggle already captured consent, so the idle state
 * informs rather than asking for a second confirmation.
 */
export function CallFlowInstallFunnel({
  advert,
  install,
}: {
  readonly advert: CallFlowAdvert;
  readonly install: CallFlowInstallController;
}) {
  const { status } = install;
  if (status.state === 'running' || status.state === 'done') {
    const activeIndex = status.state === 'done'
      ? INSTALL_STAGES.length
      : INSTALL_STAGES.findIndex((stage) => stage.id === status.stage);
    return (
      <div className="call-flow-panel" aria-live="polite">
        <div className="call-flow-shell call-flow-install call-flow-empty" role="status">
          <span className="call-flow-empty-kicker">正在安装运行时</span>
          <strong>
            {status.state === 'done'
              ? '安装完成，正在开始调用流分析。'
              : '正在准备调用流运行时。'}
          </strong>
          {status.state === 'running' && status.currentLanguageId && (
            <p>{getCallFlowLanguage(status.currentLanguageId).label}</p>
          )}
          <ol className="call-flow-install-stages">
            {INSTALL_STAGES.map((stage, index) => {
              const stageState = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending';
              return (
                <li key={stage.id} data-stage={stage.id} data-stage-state={stageState}>
                  {stageState === 'complete' ? (
                    <Check aria-hidden="true" size={13} strokeWidth={2} />
                  ) : stageState === 'active' ? (
                    <span className="call-flow-spinner call-flow-spinner-small" aria-hidden="true" />
                  ) : (
                    <span className="call-flow-install-stage-dot" aria-hidden="true" />
                  )}
                  <span>{stage.label}</span>
                  {stageState === 'active' && <span className="sr-only">（进行中）</span>}
                </li>
              );
            })}
          </ol>
          <p>这可能需要几分钟。运行期间评审依然可以正常使用。</p>
        </div>
      </div>
    );
  }
  if (status.state === 'error') {
    return (
      <div className="call-flow-panel">
        <div className="call-flow-shell call-flow-install call-flow-empty" role="alert">
          <span className="call-flow-empty-kicker">安装失败</span>
          <strong>{status.error}</strong>
          <p>
            {isNodeInstallError(status.reason)
              ? '请安装 Node.js 22.18 或更高版本，确认它在 PATH 中，然后重试。'
              : '没有做任何更改。你可以随时重试安装。'}
          </p>
          <div className="call-flow-install-action">
            <button
              type="button"
              className="call-flow-install-cta"
              onClick={() => install.start(status.languageIds)}
            >
              重试安装
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="call-flow-panel">
      <div className="call-flow-shell call-flow-install call-flow-empty">
        <span className="call-flow-empty-kicker">正在准备分析</span>
        <strong>调用流正在后台准备。</strong>
        <p>
          Plannotator 准备本地运行时和本次评审所需的语言支持时，你可以继续评审。
        </p>
        {advert.message && advert.reason !== 'runtime-unavailable' && (
          <p className="call-flow-install-detail">{advert.message}</p>
        )}
        {advert.installPlan && (
          <p className="call-flow-install-disclosure">
            正在安装 <strong>{advert.installPlan.labels.join('、')}</strong>，占用磁盘 <strong>{formatCallFlowInstallSize(advert.installPlan.installSizeBytes)}</strong>。{' '}需要 Node.js 22.18 或更高版本。其他语言只在评审需要时自动安装。
          </p>
        )}
      </div>
    </div>
  );
}

export function ReviewCallFlowPanel() {
  const state = useReviewState();
  const loadNodeSource = useCallFlowNodeSource(state);
  const analysis = state.callFlowAnalysis;
  // The tab opens on the Call tree (owner, 2026-11-10, once the tree had search); Paths and Raw stay one click away.
  const [view, setView] = useState<'paths' | 'tree' | 'raw'>('tree');
  const callTreeRequest = state.callTreeRequest ?? null;
  // A hunk's "Call tree" entry shows its tree here.
  useEffect(() => {
    if (callTreeRequest) setView('tree');
  }, [callTreeRequest]);
  const readyData = analysis.status === 'ready' ? analysis.data : null;
  const entryDocs = useMemo(
    () => (readyData ? readyData.trees.map((tree, index) => callTreeFromEntry(tree, index, { from: readyData.from, to: readyData.to })) : []),
    [readyData],
  );
  const entryTrees = useMemo(() => entryDocs.map((doc) => ({ key: doc.rootPath, doc })), [entryDocs]);

  const openNode = (node: CallFlowNode) => {
    if (!node.file) return;
    state.openDiffFile(node.file);
    state.onLineSelection(selectionForCallFlowNode(node));
  };
  const openTreeNode = state.openCallTreeNode ?? openNode;
  if (!state.callFlowAdvert.available) {
    // The runtime-missing flavor of unavailable is the setup progress surface.
    // Unsupported views and the disabled state never offer the install.
    if (state.callFlowAdvert.state === 'unavailable' && state.callFlowAdvert.installable && state.callFlowAdvert.installPlan) {
      return <CallFlowInstallFunnel advert={state.callFlowAdvert} install={state.callFlowInstall} />;
    }
    const recovery = state.callFlowAdvert.state === 'unsupported'
      ? state.callFlowAdvert.reason === 'demo-mode'
        ? '通过 Plannotator 启动评审，以分析其 Git 快照。'
        : '选择受支持的本地 Git 评审视图以运行此分析。'
      : '普通代码 Diff 仍然可用。';
    return (
      <div className="call-flow-panel">
        <div className="call-flow-shell call-flow-empty" role="status">
          <span className="call-flow-empty-kicker">
            {state.callFlowAdvert.state === 'unsupported' ? '此视图不支持' : '调用流不可用'}
          </span>
          <strong>{state.callFlowAdvert.message ?? '调用流不可用。'}</strong>
          <p>{recovery}</p>
        </div>
      </div>
    );
  }
  if (analysis.status === 'idle' || analysis.status === 'loading') {
    return (
      <div className="call-flow-panel" aria-live="polite">
        <div className="call-flow-shell">
          <div className="call-flow-loading">
            <span className="call-flow-spinner" aria-hidden="true" />
            <div>
              <strong>正在追踪更改的调用…</strong>
              <span>正在隔离的工作进程中比较完整的 Git 快照。</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (analysis.status === 'error') {
    return (
      <div className="call-flow-panel">
        <div className="call-flow-shell call-flow-empty" role="alert">
          <span className="call-flow-empty-kicker">调用流不可用</span>
          <strong>{errorMessage(analysis.error)}</strong>
          <p>代码 Diff 仍然可用，仓库文件未被更改。如果分析超时，请稍等片刻再重试。</p>
          <button type="button" className="call-flow-retry" onClick={state.retryCallFlowAnalysis}>
            重试分析
          </button>
        </div>
      </div>
    );
  }

  const { data } = analysis;
  const skippedFileCount = data.skippedLanguages.reduce((total, language) => total + language.files.length, 0);
  const skippedInstallError = state.callFlowInstall.status.state === 'error'
    && data.skippedLanguages.some((language) => installFailedForLanguage(state.callFlowInstall.status, language.id))
      ? state.callFlowInstall.status
      : undefined;
  const skippedLanguageIds = data.skippedLanguages.map((language) => language.id);
  const skippedInstallRunning = skippedLanguageIds.some((languageId) => (
    installIncludesLanguage(state.callFlowInstall.status, languageId)
  ));
  const retrySkipped = () => state.callFlowInstall.start(skippedLanguageIds);
  return (
    <div className="call-flow-panel">
      <div className="call-flow-shell">
        <header className="call-flow-header">
          <div>
            <h2>{data.summary.changedNodes === 0 ? '没有更改的调用路径' : '调用路径'}</h2>
            {/* The items are spaced by CSS gap; the hidden ", " keeps them apart when read aloud. */}
            <p className="call-flow-summary">
              {data.summary.added > 0 && (
                <span className="call-flow-summary-item call-flow-summary-changed">
                  <span className="call-flow-marker call-flow-marker-added" aria-hidden="true" />
                  {data.summary.added.toLocaleString()} 个新增
                </span>
              )}
              {data.summary.removed > 0 && (
                <span className="call-flow-summary-item call-flow-summary-changed">
                  {data.summary.added > 0 && <span className="sr-only">, </span>}
                  <span className="call-flow-marker call-flow-marker-removed" aria-hidden="true" />
                  {data.summary.removed.toLocaleString()} 个删除
                </span>
              )}
              <span className="call-flow-summary-item">
                {(data.summary.added > 0 || data.summary.removed > 0) && <span className="sr-only">, </span>}
                {data.summary.impactedFiles.toLocaleString()} 个文件
              </span>
              <span className="call-flow-summary-item">
                <span className="sr-only">, </span>
                {data.summary.entries.toLocaleString()} 个入口
              </span>
            </p>
          </div>
          <div className="call-flow-header-actions">
            <div className="call-flow-view-switch" aria-label="调用流视图">
              <button type="button" aria-pressed={view === 'tree'} onClick={() => setView('tree')}>调用树</button>
              <button type="button" aria-pressed={view === 'paths'} onClick={() => setView('paths')}>路径</button>
              <button type="button" aria-pressed={view === 'raw'} onClick={() => setView('raw')}>原始</button>
            </div>
            {state.callFlowAdvert.languages && (
              <CallFlowLanguagesMenu
                languages={state.callFlowAdvert.languages}
                installable={state.callFlowAdvert.installable}
                install={state.callFlowInstall}
              />
            )}
            <Tooltip
              content={`由 CallDiff ${data.version} 生成。对 ${data.from} 到 ${data.to} 的语法分析，并非运行时跟踪。`}
              side="bottom"
              align="end"
              wide
            >
              <button type="button" className="call-flow-info" aria-label="调用流分析详情">
                <Info aria-hidden="true" size={15} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
        </header>

        {view === 'paths' && (
          <div className="call-flow-legend" aria-label="调用流图例">
            <span className="call-flow-legend-key">
              <span className="call-flow-marker call-flow-marker-same" aria-hidden="true" /> 未更改
            </span>
            <span className="call-flow-legend-hint">点击调用可评论，按住 Shift 点击可添加步骤。点击位置可打开对应文件。</span>
          </div>
        )}

        {data.skippedLanguages.length > 0 && (
          <div className="call-flow-language-notice" role="status">
            <span>
              已跳过 {skippedFileCount} 个文件：{' '}
              {data.skippedLanguages.map((language) => language.label).join(', ')} 语言支持未安装
              {' '}（{formatCallFlowInstallSize(data.skippedLanguages.reduce((total, language) => total + language.installSizeBytes, 0))}）。
              {skippedInstallRunning && (
                <small className="call-flow-language-progress">正在后台安装语言支持…</small>
              )}
              {skippedInstallError && (
                <small className="call-flow-language-error">Install failed: {skippedInstallError.error}</small>
              )}
              {!state.callFlowAdvert.installable && (
                <small className="call-flow-language-progress">
                  将此语言的语法添加到 PLANNOTATOR_CALLDIFF_PATH 即可包含这些文件。
                </small>
              )}
            </span>
            {state.callFlowAdvert.installable && skippedInstallError && (
              <button
                type="button"
                onClick={retrySkipped}
              >
                重试
              </button>
            )}
          </div>
        )}

        {view === 'tree' && callTreeRequest ? (
          <CallTreeList
            key={`${callTreeRequest.doc.rootPath}:${callTreeRequest.token}`}
            trees={[{
              key: callTreeRequest.doc.rootPath,
              doc: callTreeRequest.doc,
              ...(state.returnFromCallTree ? { onBack: state.returnFromCallTree } : {}),
              autoFocus: true,
              headerAccessory: state.clearCallTreeRequest && (
                <button
                  type="button"
                  className="call-flow-icon-button"
                  aria-label="关闭"
                  title="关闭"
                  onClick={state.clearCallTreeRequest}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              ),
            }]}
            onOpen={openTreeNode}
            loadNodeSource={loadNodeSource}
            onAnnotateTargets={state.onAddCallFlowAnnotation}
            findShortcutActive={state.isCallFlowActive}
          />
        ) : view === 'tree' ? (
          data.trees.length === 0 ? (
            <div className="call-flow-empty">
              <span className="call-flow-empty-kicker">快照结构一致</span>
              <strong>{data.message ?? 'CallDiff 未发现更改的调用路径。'}</strong>
              <p>这是语法层面的调用分析；普通 Diff 和语义 Diff 中仍可能存在更改。</p>
            </div>
          ) : (
            <CallTreeList
              trees={entryTrees}
              onOpen={openTreeNode}
              loadNodeSource={loadNodeSource}
              onAnnotateTargets={state.onAddCallFlowAnnotation}
              findShortcutActive={state.isCallFlowActive}
            />
          )
        ) : view === 'raw' ? (
          <CallFlowRawView
            sections={[{ key: 'complete', raw: data.raw, rawLineStart: 1 }]}
            onAnnotateTargets={state.onAddCallFlowAnnotation}
            findShortcutActive={state.isCallFlowActive}
          />
        ) : data.trees.length === 0 ? (
          <div className="call-flow-empty">
            <span className="call-flow-empty-kicker">快照结构一致</span>
            <strong>{data.message ?? 'CallDiff 未发现更改的调用路径。'}</strong>
            <p>这是语法层面的调用分析；普通 Diff 和语义 Diff 中仍可能存在更改。</p>
          </div>
        ) : (
          <CallFlowTreeView
            trees={data.trees}
            onOpenNode={openNode}
            loadNodeSource={loadNodeSource}
            onAnnotateTargets={state.onAddCallFlowAnnotation}
            canInteractWithNode={state.isCallFlowNodeInPatch}
            findShortcutActive={state.isCallFlowActive}
          />
        )}

        {data.diagnostics.length > 0 && (
          <details className="call-flow-diagnostics">
            <summary>{data.diagnostics.length} 条解析器提示</summary>
            <ul>{data.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.message}:${index}`}>{diagnostic.message}</li>)}</ul>
          </details>
        )}

      </div>
    </div>
  );
}
