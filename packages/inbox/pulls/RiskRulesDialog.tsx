import { useEffect, useId, useRef, useState } from 'react';
import type { InboxPullRiskAnswer, InboxPullRiskModels } from '@plannotator/core/inbox-types';
import { modelSelectOptions } from '@plannotator/core/model-catalog';
import { InlinePicker } from '@plannotator/ui/components/InlinePicker';
import { inboxApi } from '../api';
import { Modal } from '../components/Updates';

const PLACEHOLDER = '它涉及账单或认证。\n它改变了我们存储用户数据的方式。';
const LOADING = [{ value: '', label: '正在加载模型…' }];
/** What the guided review's picker calls an agent's own default model. */
const AGENT_DEFAULT = { value: '', label: '默认' };

/**
 * "No slop zone rules": the person's words for what a high-risk pull request is, and the
 * agent that ranks the open ones against them. Saved to the Inbox's config, never to a
 * repository. Empty rules turn the judging off.
 */
export function RiskRulesDialog({ answer, onSaved, onClose }: { answer: InboxPullRiskAnswer; onSaved: (next: InboxPullRiskAnswer) => void; onClose: () => void }) {
  const titleId = useId();
  const rulesId = useId();
  const [rules, setRules] = useState(answer.rules);
  const saved = answer.provider && answer.agents.some((a) => a.id === answer.provider) ? answer.provider : null;
  const [provider, setProvider] = useState<string | null>(saved ?? answer.agents[0]?.id ?? null);
  const [model, setModel] = useState<string | null>(saved ? answer.model : null);
  const [list, setList] = useState<InboxPullRiskModels | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // The words come first: the box takes the focus, not Save.
  useEffect(() => field.current?.focus(), []);
  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    setList(null);
    inboxApi
      .pullRiskModels(provider, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setList(next);
        // A saved pick stays while the list can't say otherwise.
        setModel((was) => (was && (next.models.length === 0 || next.models.some((m) => m.id === was)) ? was : next.default_model));
      })
      .catch(() => {
        if (!controller.signal.aborted) setList({ models: [], default_model: null });
      });
    return () => controller.abort();
  }, [provider]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await inboxApi.savePullRisk({ rules, provider, model }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则无法保存。');
      setSaving(false);
    }
  };
  // No model yet: wait for the list and the pick it starts on.
  const readingModel = !!provider && !list && !model;
  // No pick to start on means the agent's own default is a choice, as in the guided review (Pi, OpenCode).
  const modelOptions = !list ? LOADING : [...(list.default_model ? [] : [AGENT_DEFAULT]), ...modelSelectOptions(list.models, model ?? undefined)];
  return (
    <Modal labelledBy={titleId} onClose={onClose} testId="pull-risk-rules" className="ib-riskd" ownKeys>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id={titleId}>低质代码规则</h2>
        <label className="ib-sub ib-riskd-l" htmlFor={rulesId}>
          对你来说，什么样的 PR 属于高风险？每个开放的 PR 都会据此评级：没涉及是低，可能有是中，确定有是高。
        </label>
        <textarea ref={field} id={rulesId} className="ib-riskd-t" rows={5} placeholder={PLACEHOLDER} value={rules} onChange={(event) => setRules(event.target.value)} data-pull-risk-rules-text="" />
        {answer.agents.length === 0 ? (
          <p className="ib-quietline" data-pull-risk-no-agent="">
            这台计算机上没有找到 agent。安装 Claude Code、Codex、Pi 或 OpenCode 后即可为 PR 评级。
          </p>
        ) : (
          <>
            <div className="ib-riskd-row">
              <div data-pull-risk-agent={provider ?? ''}>
                <InlinePicker
                  keysStayInList
                  plainGroupLabels
                  label="评级 agent"
                  value={provider ?? ''}
                  options={answer.agents.map((agent) => ({ value: agent.id, label: agent.label }))}
                  onChange={(next) => {
                    if (next === provider) return;
                    setModel(null);
                    setProvider(next);
                  }}
                />
              </div>
              <div data-pull-risk-model={model ?? ''}>
                <InlinePicker keysStayInList plainGroupLabels label="模型" value={list ? (model ?? '') : ''} options={modelOptions} onChange={(next) => setModel(next || null)} />
              </div>
            </div>
            <p className="ib-quietline">便宜的模型就足够：Sonnet、Luna 等即可。Diff 只会发送到你在这里选择的提供商。</p>
            {answer.last_failure && (
              <p className="ib-quietline" data-pull-risk-failed="">
                上一次评级没有完成。{answer.last_failure}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="ib-error" role="alert">
            {error}
          </p>
        )}
        <div className="ib-acts-row ib-riskd-acts">
          <button type="button" className="ib-btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="ib-btn ib-pri" disabled={saving || readingModel} data-pull-risk-save="">
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
