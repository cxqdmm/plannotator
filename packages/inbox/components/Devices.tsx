import { useCallback, useEffect, useRef, useState } from 'react';
import { inboxApi, type LanState, type PairedDevice, type TailnetState, type TailscaleSettings } from '../api';
import { shortTime } from '../format';
import { Icon, TailscaleMark } from '../icons';
import { PairFlow } from './PairFlow';
import { Tip } from './Tip';
// ThroughCloudflare exists but is not mounted in this fork (internal-network tool).
import { Switch } from './SettingSwitch';

const PLATFORM: Record<string, string> = { ios: 'iPhone', android: 'Android' };

/** The certificate's SHA-256 in groups of four, for a person comparing it by eye. */
function grouped(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

/**
 * Remove, asked twice like Delete thread: "Remove? Click again", then the
 * phone's token stops working. Its words, shown and spoken, are the phone
 * list's own and stay as they are; Settings → Machines' Unlink has its own
 * (UnlinkLink).
 */
function RemoveLink({ name, onRemove }: { name: string; onRemove: () => Promise<void> }) {
  return (
    <AskTwiceButton
      onRemove={onRemove}
      text="移除"
      label={`移除 ${name}`}
      confirmText="移除？再次点击"
      confirmLabel={`移除 ${name}：再次点击以移除`}
    />
  );
}

/**
 * Settings → Machines: Unlink, asked twice the same way. `warning`: what the
 * second click costs, said in the confirm itself (answers that will not be sent).
 */
export function UnlinkLink({ name, onRemove, warning }: { name: string; onRemove: () => Promise<void>; warning?: string }) {
  const confirmText = warning ? `取消关联？${warning} 再次点击` : '取消关联？再次点击';
  return (
    <AskTwiceButton
      onRemove={onRemove}
      text="取消关联"
      label={`取消关联 ${name}`}
      confirmText={confirmText}
      confirmLabel={warning ? `取消关联 ${name}：${warning} 再次点击以取消关联` : `取消关联 ${name}：再次点击以取消关联`}
    />
  );
}

/** The button both ask with: the first click asks (for 4 s), the second acts. `label`/`confirmLabel`: what a screen reader says in each state. */
function AskTwiceButton({
  onRemove,
  text,
  label,
  confirmText,
  confirmLabel,
}: {
  onRemove: () => Promise<void>;
  text: string;
  label: string;
  confirmText: string;
  confirmLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'confirm' | 'busy'>('idle');
  useEffect(() => {
    if (state !== 'confirm') return;
    const timer = setTimeout(() => setState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <button
      type="button"
      className={`ib-del-l${state === 'confirm' ? ' ib-confirm' : ''}`}
      disabled={state === 'busy'}
      aria-label={state === 'confirm' ? confirmLabel : label}
      onClick={() => {
        if (state === 'idle') return setState('confirm');
        if (state !== 'confirm') return;
        setState('busy');
        onRemove().finally(() => setState('idle'));
      }}
    >
      {state === 'confirm' ? confirmText : text}
    </button>
  );
}

export interface PhonesState {
  devices: PairedDevice[] | null;
  lan: LanState | null;
  tailnet: TailnetState | null;
  busy: boolean;
  error: string | null;
  readDevices: () => Promise<PairedDevice[]>;
  refreshWays: () => void;
  switchLan: (on: boolean) => Promise<boolean>;
  switchTailnet: (on: boolean) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
}

/**
 * The phones' state for Settings: the paired phones and the two ways a phone
 * reaches this computer. Read while Settings is open (the nav's Devices dot
 * needs it on every section), only when the Inbox serves phones.
 */
export function usePhones(enabled: boolean): PhonesState {
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [tailnet, setTailnet] = useState<TailnetState | null>(null);
  const [lan, setLan] = useState<LanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readDevices = useCallback(async () => {
    const { devices: next } = await inboxApi.devices();
    setDevices(next);
    return next;
  }, []);

  const refreshWays = useCallback(() => {
    inboxApi
      .tailnet()
      .then(({ tailnet: state }) => setTailnet(state))
      .catch(() => {});
    inboxApi
      .lan()
      .then(({ lan: state }) => setLan(state))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    readDevices().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    refreshWays();
  }, [enabled, readDevices, refreshWays]);

  const switchTailnet = async (on: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const { tailnet: state } = await inboxApi.setTailnet(on);
      setTailnet(state);
      return true;
    } catch (cause) {
      // A refused turn on leaves the switch off; a refused turn off leaves it on (the Inbox kept it).
      if (on) setTailnet((current) => (current ? { ...current, on: false, address: null } : current));
      setError(cause instanceof Error ? cause.message : '开关未能保存。');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const switchLan = async (on: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const { lan: state } = await inboxApi.setLan(on);
      setLan(state);
      return true;
    } catch (cause) {
      if (on) setLan((current) => (current ? { ...current, on: false, address: null, fingerprint: null, bonjour: false } : current));
      setError(cause instanceof Error ? cause.message : '开关未能保存。');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await inboxApi.removeDevice(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手机未能移除。');
    }
    await readDevices().catch(() => {});
  };

  return { devices, lan, tailnet, busy, error, readDevices, refreshWays, switchLan, switchTailnet, remove, clearError: () => setError(null) };
}

/** A way a phone reaches this computer, or Over your tailnet, is switched on and not working: the nav's Devices dot. */
export function devicesNeedAttention(phones: PhonesState | null, tailscale: TailscaleSettings | undefined): boolean {
  const way = (state: LanState | TailnetState | null) => state?.on === true && (state.error !== null || state.address === null);
  const browser = tailscale ? (tailscale.on && tailscale.error !== null) || (tailscale.exposed?.length ?? 0) > 0 : false;
  return way(phones?.lan ?? null) || way(phones?.tailnet ?? null) || browser;
}

/** A switch whose name is its row's visible title (label in name). */
/**
 * Over your tailnet, in Devices: the browser on your other devices, which
 * the phone app does not need (owner, decision 2: written out). One switch,
 * saved to config.json and applied at once. It shows the person's choice
 * even while publishing fails, so a click turns it off. It cannot be turned
 * on from a page that came through the tailnet, and the env var locks it.
 */
function OverYourTailnet({
  state,
  via,
  busy,
  onToggle,
}: {
  state: TailscaleSettings;
  via: 'local' | 'tailnet';
  busy: boolean;
  onToggle: (next: boolean, replaceExposed?: boolean) => void;
}) {
  const exposedPorts = (state.exposed ?? []).map((e) => e.https_port).filter((p): p is number => p !== null);
  const remote = via === 'tailnet';
  const who = state.allowed.length > 0 ? state.allowed.join('、') : (state.owner ?? '拥有这台机器的 Tailscale 登录');
  const logins = state.allowed.length > 1 ? state.allowed : null;
  const locked = state.env !== null;
  const exposed = (state.exposed?.length ?? 0) > 0;
  return (
    <section className="ib-sgroup" data-settings-tailscale={state.on ? 'on' : 'off'} aria-labelledby="ib-g-tailscale">
      <h2 id="ib-g-tailscale">通过你的 tailnet</h2>
      <p>
        在笔记本电脑或平板的浏览器中，通过{' '}
        <a href="https://tailscale.com/" target="_blank" rel="noreferrer">
          Tailscale
        </a>{' '}
        以 HTTPS 打开收件箱窗口。你手机上的应用不需要这个。
      </p>
      <div className="ib-card">
        <div className="ib-prow">
          <span className="ib-tile">
            <TailscaleMark />
          </span>
          <span className="ib-txt">
            <span className="ib-l">
              <span id="ib-ts-label">通过 Tailscale 访问收件箱</span>
              {exposed && <span className="ib-chip ib-chip-warn">已暴露</span>}
              {state.on && state.error && !exposed && <span className="ib-chip ib-chip-err">未正常工作</span>}
            </span>
            <span className="ib-desc" data-tailscale-url={state.url ?? ''}>
              {state.url ? (
                <>
                  已开启 ·{' '}
                  <a href={state.url} target="_blank" rel="noreferrer">
                    {state.url}
                  </a>{' '}
                  · 只有{logins ? '这些登录' : who}能打开{logins ? '：' : ''}
                </>
              ) : state.on ? (
                '已开启 · 尚未发布'
              ) : (
                `已关闭 · 只有${logins ? '这些登录' : who}能打开${logins ? '：' : ''}`
              )}
              {/* Several logins, one per line: never one long sentence of addresses. */}
              {logins && (state.url || !state.on) && (
                <span className="ib-logins" data-tailscale-logins="">
                  {logins.map((login) => (
                    <span key={login}>{login}</span>
                  ))}
                </span>
              )}
            </span>
          </span>
          <span className="ib-ctl">
            <Switch on={state.on} labelledBy="ib-ts-label" disabled={busy || locked} onClick={() => onToggle(!state.on)} />
          </span>
        </div>
        {exposed && (
          <div className="ib-callout ib-warn ib-in-card" data-tailscale-exposed="">
            <Icon name="warn" />
            <span>
              一个 tailscale serve 映射{exposedPorts.length ? `（端口 ${exposedPorts.join('、')}）` : ''}指向收件箱自己的端口。它会把整个
              收件箱（包括 agent 工具）暴露给你 tailnet 上的所有人，因此收件箱会拒绝所有经它而来的请求。{' '}
              {!locked && (
                <button type="button" className="ib-lnk" data-tailscale-replace="" disabled={busy} onClick={() => onToggle(true, true)}>
                  将其替换为仅所有者可用的地址
                </button>
              )}
            </span>
          </div>
        )}
        {state.on && state.error && !exposed && (
          <div className="ib-callout ib-err ib-in-card" data-tailscale-error="">
            <Icon name="xCircle" />
            <span>{state.error}</span>
          </div>
        )}
      </div>
      <div className="ib-note">
        <Icon name="info" />
        {locked ? (
          `此收件箱的环境中已设置 PLANNOTATOR_INBOX_TAILSCALE，因此它会保持${state.env ? '开启' : '关闭'}。`
        ) : remote && state.source !== 'flag' ? (
          '你是通过 tailnet 打开此页面的。关闭此项会断开该连接；请在这台机器上重新开启。'
        ) : state.source === 'flag' ? (
          <span>
            本次运行期间开启（plannotator inbox --tailscale）。{' '}
            <button type="button" className="ib-lnk" data-tailscale-keep="" disabled={busy} onClick={() => onToggle(true)}>
              每次启动时保持开启
            </button>
          </span>
        ) : (
          '立即生效，并在每次启动时生效。你从那里发送的内容会成为这台机器上某个 agent 会话中的一轮。'
        )}
      </div>
    </section>
  );
}

/** One way a phone reaches this computer, as a row with its switch, address and, when not working, why. */
function WayRow({ kind, state, busy, onSwitch }: { kind: 'wifi' | 'tailscale'; state: LanState | TailnetState | null; busy: boolean; onSwitch: (on: boolean) => void }) {
  const isWifi = kind === 'wifi';
  const on = state?.on === true;
  const working = on && state!.address !== null && !state!.error;
  const lan = isWifi ? (state as LanState | null) : null;
  const id = `ib-way-row-${kind}`;
  return (
    <>
      <div className="ib-prow" data-lan={isWifi ? (on ? 'on' : 'off') : undefined} data-tailnet={isWifi ? undefined : on ? 'on' : 'off'}>
        <span className="ib-tile">{isWifi ? <Icon name="wifi" /> : <TailscaleMark />}</span>
        <span className="ib-txt">
          <span className="ib-l">
            <span id={id}>{isWifi ? '此 Wi-Fi' : 'Tailscale'}</span>
            {on && !working && <span className="ib-chip ib-chip-err">未正常工作</span>}
          </span>
          <span className="ib-desc" data-lan-address={isWifi ? (state?.address ?? '') : undefined} data-tailnet-address={isWifi ? undefined : (state?.address ?? '')}>
            {working ? (
              <>
                已开启 · {state!.address}
                {lan?.fingerprint && (
                  <span data-lan-fingerprint={lan.fingerprint}>
                    {' '}
                    · 证书 <Tip content={<span className="ib-tip-fp">{grouped(lan.fingerprint)}</span>}><span className="ib-sfp" data-fingerprint={grouped(lan.fingerprint)}>{grouped(lan.fingerprint).slice(0, 19)}…</span></Tip>
                  </span>
                )}
              </>
            ) : on ? (
              (state?.error ?? '尚无法访问')
            ) : isWifi ? (
              '已关闭 · 同一 Wi-Fi 上的手机，通过它们会验证的加密连接'
            ) : (
              '已关闭 · 装有 Tailscale 的手机，无论在家还是在外，都无需将这台机器暴露到互联网'
            )}
          </span>
        </span>
        <span className="ib-ctl">
          <Switch on={on} labelledBy={id} disabled={!state || busy} onClick={() => onSwitch(!on)} />
        </span>
      </div>
      {isWifi && working && lan && !lan.bonjour && (
        <div className="ib-callout ib-in-card" data-lan-no-bonjour="">
          <Icon name="info" />
          <span>手机不会在附近列表中看到这台机器（没有 dns-sd 或 avahi-publish）。扫描二维码仍可配对。</span>
        </div>
      )}
      {on && !working && state?.error && (
        <div className="ib-callout ib-err ib-in-card">
          <Icon name="xCircle" />
          <span>开关会保持开启，以便一键关闭。关闭后再开启可再试一次。</span>
        </div>
      )}
    </>
  );
}

export interface DevicesSectionProps {
  /** Null: this Inbox does not serve phones (PLANNOTATOR_INBOX_PHONES off), so Devices shows Over your tailnet only. */
  phones: PhonesState | null;
  tailscale: TailscaleSettings | undefined;
  via: 'local' | 'tailnet';
  tailscaleBusy: boolean;
  onToggleTailscale: (next: boolean, replaceExposed?: boolean) => void;
  /** `#settings/devices/pair`: Pair a phone is open. */
  pairing: boolean;
  onPairing: (open: boolean) => void;
}

/**
 * Devices (design of record `.product/approved/inbox-settings-tabs/`):
 * phones, how a phone reaches this computer (This Wi-Fi, Tailscale), and
 * Over your tailnet for browsers on other devices, the difference written
 * out (owner, decision 2).
 */
export function DevicesSection({ phones, tailscale, via, tailscaleBusy, onToggleTailscale, pairing, onPairing }: DevicesSectionProps) {
  // The owner pairs and switches from this computer or any of their own devices over the tailnet (owner ruling 2026-11-11).
  const pairButton = useRef<HTMLButtonElement>(null);
  const [justPaired, setJustPaired] = useState(false);
  const wasPairing = useRef(pairing);
  // Leaving the flow puts focus back on the button that opened it.
  useEffect(() => {
    if (wasPairing.current && !pairing) pairButton.current?.focus();
    wasPairing.current = pairing;
  }, [pairing]);
  const devices = phones?.devices ?? [];
  return (
    <>
      {phones && (
        <>
          <section className="ib-sgroup" data-settings-phones="" aria-labelledby="ib-g-phones">
            <h2 id="ib-g-phones">手机</h2>
            <p>在手机上的 Plannotator 中阅读和回复收件箱。每部手机都有自己的密钥，移除会将其收回。</p>
            {pairing ? (
              <PairFlow
                lan={phones.lan}
                tailnet={phones.tailnet}
                busy={phones.busy}
                error={phones.error}
                onSwitchLan={phones.switchLan}
                onSwitchTailnet={phones.switchTailnet}
                onRefreshWays={phones.refreshWays}
                readDevices={phones.readDevices}
                onClose={(paired) => {
                  phones.clearError();
                  setJustPaired(paired);
                  onPairing(false);
                }}
              />
            ) : (
              <div className="ib-card" aria-label="已配对的手机">
                {devices.map((device) => (
                  <div className="ib-prow" key={device.id} data-device={device.id}>
                    <span className="ib-tile">
                      <Icon name="phone" />
                    </span>
                    <span className="ib-txt">
                      <span className="ib-l">{device.name}</span>
                      <span className="ib-desc">
                        {PLATFORM[device.platform] ?? device.platform} · 最后出现 {shortTime(device.last_seen_at)}
                      </span>
                    </span>
                    <span className="ib-ctl">
                      <RemoveLink name={device.name} onRemove={() => phones.remove(device.id)} />
                    </span>
                  </div>
                ))}
                <div className="ib-prow">
                  <span className="ib-txt">
                    <span className="ib-l">{devices.length > 0 ? '配对另一部手机' : '尚未配对手机'}</span>
                    {devices.length === 0 && <span className="ib-desc">配对一部手机，以便在手机上阅读和回复。</span>}
                    {justPaired && (
                      <span className="ib-desc ib-paired" data-paired="" role="status">
                        <Icon name="check" size={13} /> 已与 {devices[0]?.name ?? '你的手机'} 配对。
                      </span>
                    )}
                  </span>
                  <span className="ib-ctl">
                    <button
                      ref={pairButton}
                      type="button"
                      className={`ib-btn${devices.length === 0 ? ' ib-pri' : ''}`}
                      onClick={() => {
                        setJustPaired(false);
                        onPairing(true);
                      }}
                      data-pair-start=""
                    >
                      配对手机
                    </button>
                  </span>
                </div>
              </div>
            )}
            {phones.error && !pairing && (
              <div className="ib-callout ib-err" role="alert">
                <Icon name="xCircle" />
                <span>{phones.error}</span>
              </div>
            )}
          </section>
          {/* While pairing, step 1 holds the two ways and their switches: one thing in one place. */}
          {!pairing && (
          <section className="ib-sgroup" data-settings-ways="" aria-labelledby="ib-g-ways">
            <h2 id="ib-g-ways">你的手机如何访问这台机器</h2>
            <p>开启一个或两个。手机会使用当前位置可用的那一个。</p>
            <div className="ib-card">
              <WayRow kind="wifi" state={phones.lan} busy={phones.busy} onSwitch={(on) => void phones.switchLan(on)} />
              <WayRow kind="tailscale" state={phones.tailnet} busy={phones.busy} onSwitch={(on) => void phones.switchTailnet(on)} />
            </div>
          </section>
          )}
        </>
      )}
      {tailscale && <OverYourTailnet state={tailscale} via={via} busy={tailscaleBusy} onToggle={onToggleTailscale} />}
      {/* This fork publishes through no one's cloud: the Cloudflare Access
          section (ThroughCloudflare) is not mounted. The tailnet above stays. */}
    </>
  );
}
