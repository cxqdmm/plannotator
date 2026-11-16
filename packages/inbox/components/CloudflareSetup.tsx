import { useState, type FormEvent } from 'react';
import { CloudflareRefusal, postCloudflare, type CloudflareStepId, type CloudflareView, type CloudflareZone } from '../data/cloudflareAccess';
import { Icon, type IconName } from '../icons';

const STEP_LABEL: Record<CloudflareStepId, string> = {
  account: '你的 Cloudflare 账户及其一次性验证码登录',
  tunnel: '通往这台机器的隧道',
  gate: '登录门禁，仅限你的电子邮箱',
  address: '两个地址',
  checks: '外部检查：不登录就什么都进不来',
};

const STEP_ICON: Record<string, { icon: IconName; word: string; cls: string }> = {
  done: { icon: 'checkCircle', word: '完成', cls: 'ok' },
  running: { icon: 'refresh', word: '处理中', cls: 'later' },
  pending: { icon: 'minus', word: '等待中', cls: 'later' },
  failed: { icon: 'xCircle', word: '失败', cls: 'fail' },
};

export function CloudflareProgress({ job, onClose, onRetry }: { job: NonNullable<CloudflareView['job']>; onClose: () => void; onRetry: () => void }) {
  return (
    <div className="ib-flow" data-cloudflare-progress={job.running ? 'running' : job.failed ? 'failed' : 'done'}>
      <div className="ib-flow-head">
        <h3>{job.failed ? '设置已停止' : job.running ? '正在设置' : '设置'} {job.host ?? ''}</h3>
      </div>
      <div className="ib-flow-body">
        <ul className="ib-checks" aria-live="polite">
          {job.steps.map((step) => {
            const look = STEP_ICON[step.state]!;
            return (
              <li key={step.id} className={`ib-ck-${look.cls}`} data-cloudflare-step={step.id} data-state={step.state}>
                <Icon name={look.icon} size={14} />
                <span>
                  <span className="ib-sr">{look.word}: </span>
                  {STEP_LABEL[step.id]}
                </span>
              </li>
            );
          })}
        </ul>
        {job.failed && (
          <div className="ib-callout ib-err" role="alert" data-cloudflare-failed={job.failed.step}>
            <Icon name="xCircle" />
            <span>
              {STEP_LABEL[job.failed.step]}: {job.failed.message}{' '}
              {job.failed.leftover.length > 0
                ? `无法移除全部内容；请在 Cloudflare 中删除：${job.failed.leftover.join('、')}。`
                : 'Cloudflare 中没有留下任何内容。'}
            </span>
          </div>
        )}
        {!job.running && job.failed && (
          <div className="ib-flow-f">
            <button type="button" className="ib-btn ib-pri" onClick={onRetry}>
              重试
            </button>
            <button type="button" className="ib-btn ib-ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CloudflareForm({ onStarted, onCancel }: { onStarted: (view: CloudflareView) => void; onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [zones, setZones] = useState<CloudflareZone[] | null>(null);
  const [zone, setZone] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = zones?.find((z) => z.name === zone)?.account ?? null;
  const host = zone && label ? `${label}.${zone}` : null;

  const findZones = async () => {
    setBusy(true);
    setError(null);
    try {
      const found = await postCloudflare<{ zones: CloudflareZone[]; label: string }>('zones', { token });
      setZones(found.zones);
      setLabel(found.label);
      setZone(found.zones.length === 1 ? found.zones[0]!.name : '');
    } catch (failure) {
      setError(failure instanceof CloudflareRefusal ? failure.message : '无法连接到此收件箱。');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!host) return;
    const sent = token;
    setToken('');
    setBusy(true);
    setError(null);
    try {
      onStarted(await postCloudflare('setup', { token: sent, email, zone, hostname: host, account }));
    } catch (failure) {
      setError(failure instanceof CloudflareRefusal ? `${failure.message} 请再次粘贴 token 以重试。` : '无法连接到此收件箱。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ib-flow" onSubmit={(event) => void submit(event)} data-cloudflare-form="">
      <div className="ib-flow-head">
        <h3>设置 Cloudflare</h3>
      </div>
      <div className="ib-flow-body">
        <p className="ib-lead">
          token 仅使用一次，绝不会保存。{' '}
          <a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">
            在 Cloudflare 中创建一个
          </a>{' '}
          并授予 Tunnel、Access（应用、策略、身份提供商）和 DNS 的编辑权限。
        </p>
        <div className="ib-card">
          <div className="ib-prow">
            <span className="ib-txt">
              <label className="ib-l" htmlFor="ib-cf-email">
                谁可以登录
              </label>
              <span className="ib-desc">你的电子邮箱。只有这个地址会收到登录验证码。</span>
            </span>
            <span className="ib-ctl ib-vkeyctl">
              <input id="ib-cf-email" className="ib-vkey" type="email" autoComplete="off" spellCheck={false} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
            </span>
          </div>
          <div className="ib-prow">
            <span className="ib-txt">
              <label className="ib-l" htmlFor="ib-cf-token">
                API 令牌
              </label>
              <span className="ib-desc">仅发送到此收件箱一次，用于设置，随后即被遗忘。</span>
            </span>
            <span className="ib-ctl ib-vkeyctl">
              <input id="ib-cf-token" className="ib-vkey" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} />
              {zones === null && (
                <button type="button" className="ib-btn" disabled={busy || !token.trim()} onClick={() => void findZones()} data-cloudflare-zones="">
                  查找域
                </button>
              )}
            </span>
          </div>
          {zones !== null && (
            <div className="ib-prow">
              <span className="ib-txt">
                <label className="ib-l" htmlFor="ib-cf-zone">
                  域名
                </label>
                <span className="ib-desc" data-cloudflare-names={host ?? ''}>
                  {host ? (
                    <>
                      收件箱位于 <span className="ib-mono">{host}</span>
                      <br />
                      会话位于 <span className="ib-mono">{`${label}-s.${zone}`}</span>
                    </>
                  ) : zones.length === 0 ? (
                    '此 token 在 Cloudflare 上看不到任何域名。'
                  ) : (
                    '选择要使用的域名。'
                  )}
                </span>
              </span>
              <span className="ib-ctl ib-vkeyctl">
                <select id="ib-cf-zone" className="ib-vkey" value={zone} onChange={(event) => setZone(event.target.value)} disabled={zones.length === 0}>
                  <option value="">请选择…</option>
                  {zones.map((z) => (
                    <option key={z.name} value={z.name}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          )}
        </div>
        {error && (
          <div className="ib-callout ib-err" role="alert">
            <Icon name="xCircle" />
            <span>{error}</span>
          </div>
        )}
        <div className="ib-flow-f">
          <button type="submit" className="ib-btn ib-pri" disabled={busy || !host || !email.trim() || !token.trim()} data-cloudflare-start="">
            开始设置
          </button>
          <button type="button" className="ib-btn ib-ghost" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </form>
  );
}
