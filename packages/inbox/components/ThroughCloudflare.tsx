import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CloudflareRefusal, postCloudflare, readCloudflare, type CloudflareView } from '../data/cloudflareAccess';
import { Icon } from '../icons';
import { qrModules } from '../qr';
import { CloudflareForm, CloudflareProgress } from './CloudflareSetup';
import { Switch } from './SettingSwitch';
import { CloudflareMark } from './CloudflareMark';

const CloudflareTileMark = CloudflareMark;

function AddressQr({ url }: { url: string }) {
  const path = useMemo(() => qrModules(url), [url]);
  return (
    <div className="ib-qr-wrap ib-cf-qr">
      <svg className="ib-qr" viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`} role="img" aria-label="收件箱地址的二维码" data-cloudflare-qr="" shapeRendering="crispEdges">
        <rect x={-2} y={-2} width={path.size + 4} height={path.size + 4} fill="#fff" />
        <path d={path.d} fill="#000" />
      </svg>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ib-btn ib-ghost"
      aria-label={label === 'Inbox' ? '复制收件箱地址' : '复制会话地址'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function problemOf(view: CloudflareView): string | null {
  if (!view.on) return null;
  if (view.error) return view.error;
  const tunnel = view.tunnel;
  if (!tunnel) return null;
  if (tunnel.state === 'missing') return tunnel.error ?? '未安装 cloudflared。';
  if (tunnel.state === 'retrying') return `隧道未连接：${tunnel.error ?? 'cloudflared 已停止'}。它会自行重新启动。`;
  return null;
}

function tunnelLine(view: CloudflareView): string {
  const tunnel = view.tunnel;
  if (!view.on) return '隧道已停止，设置已保留';
  if (!tunnel) return '正在启动';
  if (tunnel.state === 'connected') return '隧道已连接';
  if (tunnel.state === 'starting') return '隧道正在启动';
  return '隧道未连接';
}

function RemoveForm({ onDone, onCancel }: { onDone: (view: CloudflareView) => void; onCancel: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sent = token;
    setToken('');
    setBusy(true);
    setError(null);
    try {
      onDone(await postCloudflare('remove', { token: sent }));
    } catch (failure) {
      setError(failure instanceof CloudflareRefusal ? failure.message : '无法连接到该收件箱。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ib-prow" onSubmit={(event) => void submit(event)} data-cloudflare-remove="">
      <span className="ib-txt">
        <label className="ib-l" htmlFor="ib-cf-remove-token">
          从 Cloudflare 移除
        </label>
        <span className="ib-desc">删除两个地址、登录验证和隧道。需要再次提供 API 令牌；令牌不会被保留。</span>
        {error && (
          <span className="ib-desc" role="alert">
            {error}
          </span>
        )}
      </span>
      <span className="ib-ctl ib-vkeyctl">
        <input id="ib-cf-remove-token" className="ib-vkey" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} />
        <button type="submit" className="ib-btn ib-danger" disabled={busy || !token.trim()}>
          移除
        </button>
        <button type="button" className="ib-btn ib-ghost" onClick={onCancel}>
          取消
        </button>
      </span>
    </form>
  );
}

export function ThroughCloudflare() {
  const [view, setView] = useState<CloudflareView | null>(null);
  const [refused, setRefused] = useState(false);
  const [mode, setMode] = useState<'view' | 'form' | 'remove'>('view');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await readCloudflare());
    } catch (failure) {
      if (failure instanceof CloudflareRefusal && failure.code === 'local_only') setRefused(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const running = view?.job?.running === true;
  useEffect(() => {
    if (!view || (!running && !view.on)) return;
    const timer = setInterval(() => void load(), running ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [view, running, load]);

  if (refused) {
    return (
      <section className="ib-sgroup" data-settings-cloudflare="elsewhere" aria-labelledby="ib-g-cloudflare">
        <h2 id="ib-g-cloudflare">Cloudflare</h2>
        <p>请在这台计算机上或通过你的 tailnet 修改。</p>
      </section>
    );
  }
  if (!view) return null;

  const swap = async (on: boolean) => {
    setBusy(true);
    try {
      setView(await postCloudflare('switch', { on }));
    } finally {
      setBusy(false);
    }
  };

  const job = view.job;
  const showJob = job && (job.running || job.failed);
  const problem = problemOf(view);
  const state = showJob ? 'setting-up' : mode === 'form' ? 'form' : !view.configured ? 'off' : problem ? 'problem' : view.on ? 'on' : 'paused';

  return (
    <section className="ib-sgroup" data-settings-cloudflare={state} aria-labelledby="ib-g-cloudflare">
      <h2 id="ib-g-cloudflare">Cloudflare</h2>
      <p>
        用你自己的 Cloudflare 账户，通过{' '}
        <a href="https://www.cloudflare.com/products/access/" target="_blank" rel="noreferrer">
          Cloudflare Access
        </a>{' '}
        和 Cloudflare Tunnel，在你的其他设备上打开收件箱和会话。只有你的电子邮箱可以登录。
      </p>
      {showJob ? (
        <CloudflareProgress
          job={job!}
          onClose={() => void postCloudflare('dismiss', {}).then(setView)}
          onRetry={() => void postCloudflare('dismiss', {}).then((next) => {
            setView(next);
            setMode('form');
          })}
        />
      ) : mode === 'form' ? (
        <CloudflareForm
          onStarted={(next) => {
            setView(next);
            setMode('view');
          }}
          onCancel={() => setMode('view')}
        />
      ) : !view.configured ? (
        <div className="ib-card">
          <div className="ib-prow">
            <span className="ib-tile">
              <CloudflareTileMark />
            </span>
            <span className="ib-txt">
              <span className="ib-l">通过 Cloudflare 访问收件箱</span>
              <span className="ib-desc">需要一个绑定了域名的 Cloudflare 账户、已开启 Zero Trust（免费计划即可），以及这台计算机上安装的 cloudflared。</span>
              <ul className="ib-checks ib-cf-need" data-cloudflared={view.cloudflared.found ? 'found' : 'missing'}>
                <li className={view.cloudflared.found ? 'ib-ck-ok' : 'ib-ck-fail'}>
                  <Icon name={view.cloudflared.found ? 'checkCircle' : 'xCircle'} size={14} />
                  <span>
                    {view.cloudflared.found ? '已在这台计算机上找到 cloudflared' : '未安装 cloudflared'}
                    {!view.cloudflared.found && <span className="ib-fix">{view.cloudflared.install}</span>}
                  </span>
                </li>
              </ul>
            </span>
            <span className="ib-ctl">
              <button type="button" className="ib-btn ib-pri" disabled={!view.cloudflared.found} onClick={() => setMode('form')} data-cloudflare-setup="">
                设置
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div className="ib-card">
          <div className="ib-prow">
            <span className="ib-tile">
              <CloudflareTileMark />
            </span>
            <span className="ib-txt">
              <span className="ib-l">
                <span id="ib-cf-label">通过 Cloudflare 访问收件箱</span>
                {problem && <span className="ib-chip ib-chip-err">无法正常工作</span>}
              </span>
              <span className="ib-desc">
                {view.on ? '开' : '关'} · 仅 {view.allowed.join('、')} 可登录 · {tunnelLine(view)}
              </span>
            </span>
            <span className="ib-ctl">
              <Switch on={view.on} labelledBy="ib-cf-label" disabled={busy} onClick={() => void swap(!view.on)} />
            </span>
          </div>
          {[
            { label: 'Inbox', url: view.url ?? (view.host ? `https://${view.host}/` : null) },
            { label: 'sessions', url: view.sessions_url ?? (view.session_host ? `https://${view.session_host}/` : null) },
          ].map(
            (row) =>
              row.url && (
                <div className="ib-prow" key={row.label} data-cloudflare-address={row.label}>
                  <span className="ib-txt">
                    <span className="ib-l">{row.label === 'Inbox' ? '收件箱地址' : '会话地址'}</span>
                    <span className="ib-desc ib-mono">{row.label === 'Inbox' ? row.url : `${row.url}s/…`}</span>
                  </span>
                  <span className="ib-ctl">
                    <CopyButton text={row.url} label={row.label} />
                  </span>
                </div>
              ),
          )}
          {view.on && view.url && (
            <div className="ib-prow ib-cf-on">
              <AddressQr url={view.url} />
              <span className="ib-txt">
                <span className="ib-desc">扫描即可在手机上打开收件箱，然后使用 Cloudflare 发到你邮箱的验证码登录。</span>
              </span>
            </div>
          )}
          {problem && (
            <div className="ib-callout ib-err ib-in-card" data-cloudflare-problem="">
              <Icon name="xCircle" />
              <span>{problem}</span>
            </div>
          )}
          {mode === 'remove' ? (
            <RemoveForm
              onDone={(next) => {
                setView(next);
                setMode('view');
              }}
              onCancel={() => setMode('view')}
            />
          ) : (
            <div className="ib-prow">
              <span className="ib-txt">
                <span className="ib-desc">开关会停止或启动隧道，并保留设置。“移除”会从 Cloudflare 删除它。</span>
              </span>
              <span className="ib-ctl">
                <button type="button" className="ib-btn ib-ghost" onClick={() => setMode('remove')} data-cloudflare-remove-open="">
                  移除
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
