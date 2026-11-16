import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { InboxApiError, inboxApi, type MachineOffer, type MachineView, type OutboxView } from '../api';
import { shortTime } from '../format';
import { Icon } from '../icons';
import { machineNotice, machineStatus } from '../machines';
import { MachineUpdateButton } from './MachineUpdate';
import { CodeBox, CopyButton } from './ConnectPicker';
import { UnlinkLink } from './Devices';
import { errorText } from '../toastError';

/**
 * What a refused link means, in the window's words. The server's messages
 * name CLI flags (`--back`, `--address`), so the codes the person can act on
 * are said here; anything else shows the server's own sentence.
 */
export function linkErrorText(error: unknown): string {
  // A fetch that never reached the Inbox (a phone on a dropped link) says so in plain words, never the browser's own.
  if (!(error instanceof InboxApiError)) return errorText(error, '链接未能建立。');
  if (error.code === 'validation_error') {
    if (error.message.startsWith('address:')) return '输入另一台机器在你 tailnet 上的地址，例如 mini.tail1234.ts.net:8443。';
    if (error.message.startsWith('link:')) return '这不是链接码。链接码以 plannotator://link 开头。';
    return '粘贴另一台机器的链接码，或输入其地址和六位数字。';
  }
  if (error.code === 'no_way_back') return '另一台机器需要一条回到这台机器的通路，而 Tailscale 无法发布这台机器。请在此检查 Tailscale，然后重新链接。';
  return error.message;
}

/** "2 waiting to send": what the outbox holds for a machine, said the same way in its line and in Unlink. */
function waitingText(waiting: number): string {
  return `${waiting} 条待发送`;
}

/** The line under a linked machine: its state, what its update says when this page offers updates, then the answers waiting for it. */
function machineLine(machine: MachineView, offersUpdates: boolean): string {
  const status = machineStatus(machine);
  const notice = offersUpdates ? machineNotice(machine) : null;
  const withNotice = notice ? `${status} · ${notice.line}` : status;
  return machine.waiting > 0 ? `${withNotice} · ${waitingText(machine.waiting)}` : withNotice;
}

export interface MachinesSectionProps {
  /** Every machine the merged view knows, this one included. */
  machines: MachineView[];
  /** After a link or an Unlink: read the machines again. */
  onChanged: () => void;
  /** Open a machine's update dialog. Absent on a page that offers no updates. */
  onMachineUpdate?: (machineId: string) => void;
}

/**
 * Settings → Machines: the other computers whose threads this Inbox shows.
 * Each one keeps its own Inbox; a link works both ways, over the tailnet.
 * Built like Devices → Phones: one card, a row per machine with Unlink
 * (asked twice), then the row that starts a link. The owner links from this
 * computer or from any of their own devices over the tailnet.
 */
export function MachinesSection({ machines, onChanged, onMachineUpdate }: MachinesSectionProps) {
  const linked = machines.filter((machine) => !machine.self);
  // Why this Inbox's own door is not on the tailnet (its port held by another mapping): linked machines cannot reach it until that is fixed.
  const doorError = machines.find((machine) => machine.self)?.reason ?? null;
  const [linking, setLinking] = useState(false);
  const [offer, setOffer] = useState<MachineOffer | null>(null);
  const [offering, setOffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState<string | null>(null);
  // After an Unlink the other machine could not hear (asleep): it drops the link at its next contact, said here.
  const [unlinkedNote, setUnlinkedNote] = useState<string | null>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  // A code someone used is spent: once a new machine shows up, the code goes away.
  const linkedCount = useRef(linked.length);
  useEffect(() => {
    if (linked.length > linkedCount.current) setOffer(null);
    linkedCount.current = linked.length;
  }, [linked.length]);

  const showOffer = async () => {
    setOffering(true);
    setError(null);
    try {
      setOffer(await inboxApi.offerMachine());
    } catch (cause) {
      setError(linkErrorText(cause));
    } finally {
      setOffering(false);
    }
  };

  return (
    <section className="ib-sgroup" data-settings-machines="" aria-labelledby="ib-g-machines">
      <h2 id="ib-g-machines">已关联的机器</h2>
      <p>链接在 tailnet 上双向生效。取消关联会在两台机器上移除它。</p>
      {doorError && (
        <div className="ib-callout ib-warn" role="alert" data-machines-door-error="">
          <Icon name="warn" />
          <span>这台机器不在你的 tailnet 上，因此已关联的机器无法访问它：{doorError}</span>
        </div>
      )}
      <div className="ib-card" aria-label="已关联的机器">
        {linked.map((machine) => (
          <div className="ib-prow" key={machine.id} data-machine-row={machine.id} data-machine-state={machine.state}>
            <span className="ib-tile">
              <Icon name="system" />
            </span>
            <span className="ib-txt">
              <span className="ib-l">{machine.name}</span>
              <span className="ib-desc">{machineLine(machine, !!onMachineUpdate)}</span>
            </span>
            <span className="ib-ctl">
              {onMachineUpdate && <MachineUpdateButton machine={machine} onPress={() => onMachineUpdate(machine.id)} />}
              <UnlinkLink
                name={machine.name}
                warning={machine.waiting > 0 ? `${waitingText(machine.waiting)}将丢失。` : undefined}
                onRemove={async () => {
                  setError(null);
                  setUnlinkedNote(null);
                  try {
                    const answer = await inboxApi.unlinkMachine(machine.id);
                    if (!answer.told) setUnlinkedNote(`已在此取消关联。无法联系到 ${machine.name}，因此它会在下次联系时断开链接。这台机器会在你的 tailnet 上对它保持可达最多 7 天，直到它收到消息。`);
                  } catch (cause) {
                    setError(linkErrorText(cause));
                  }
                  onChanged();
                }}
              />
            </span>
          </div>
        ))}
        {linking ? (
          <LinkForm
            onCancel={() => {
              setLinking(false);
              linkButton.current?.focus();
            }}
            onLinked={(name) => {
              setLinking(false);
              setJustLinked(name);
              onChanged();
            }}
          />
        ) : (
          <div className="ib-prow" data-machine-start="">
            <span className="ib-txt">
              <span className="ib-l">{linked.length > 0 ? '关联另一台机器' : '尚未关联机器'}</span>
              {linked.length === 0 && <span className="ib-desc">在另一台机器上生成链接码，然后粘贴到这里。</span>}
              {unlinkedNote && (
                <span className="ib-desc" data-machine-unlinked="" role="status">
                  {unlinkedNote}
                </span>
              )}
              {justLinked && (
                <span className="ib-desc ib-paired" data-machine-linked="" role="status">
                  <Icon name="check" size={13} /> 已与 {justLinked} 关联。
                </span>
              )}
            </span>
            <span className="ib-ctl">
              <button
                ref={linkButton}
                type="button"
                className={`ib-btn${linked.length === 0 ? ' ib-pri' : ''}`}
                onClick={() => {
                  setJustLinked(null);
                  setUnlinkedNote(null);
                  setError(null);
                  setLinking(true);
                }}
                data-machine-link=""
              >
                关联机器
              </button>
            </span>
          </div>
        )}
        <div className="ib-prow" data-machine-offer-row="">
          <span className="ib-txt">
            <span className="ib-l">这台机器的链接码</span>
            <span className="ib-desc">
              {offer
                ? `请在 ${shortTime(offer.expires_at)} 之前在另一台机器的设置 → 机器中粘贴。每个链接码只能使用一次。只要有链接码打开或有关联的机器，此收件箱就会保持在你的 tailnet 上。`
                : '显示链接码会让此收件箱通过 Tailscale Serve 出现在你的 tailnet 上，以便另一台机器能够访问它。'}
            </span>
          </span>
          <span className="ib-ctl">
            <button type="button" className="ib-btn" disabled={offering} onClick={() => void showOffer()} data-machine-offer-start="">
              {offer ? '新链接码' : '显示链接码'}
            </button>
          </span>
        </div>
        {offer && (
          <div className="ib-mcode" data-machine-offer="">
            {offer.tailnet_error && (
              <div className="ib-callout ib-warn" data-machine-offer-tailnet="">
                <Icon name="warn" />
                <span>
                  Tailscale 未能发布这台机器，因此另一台机器暂时无法访问它：{offer.tailnet_error}
                </span>
              </div>
            )}
            <CodeBox text={offer.link} />
            {offer.tailnet && (
              <p className="ib-cnote">
                或者输入这台机器的地址 <code>{offer.tailnet}</code>，以及 <code className="ib-mcode-digits">{offer.code}</code>。
              </p>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="ib-callout ib-err" role="alert" data-machines-error="">
          <Icon name="xCircle" />
          <span>{error}</span>
        </div>
      )}
      <UnsentWrites linked={machines} />
    </section>
  );
}

/**
 * What was waiting for a machine when its link went (an Unlink here, or one done on that machine): never dropped
 * silently. Its words stay here to copy, until the person dismisses them. Read from the outbox when the page opens,
 * and again when a machine leaves the list.
 */
function UnsentWrites({ linked }: { linked: readonly MachineView[] }) {
  const [entries, setEntries] = useState<OutboxView[]>([]);
  const ids = linked.map((m) => m.id).join('|');
  useEffect(() => {
    let live = true;
    inboxApi.outbox().then(
      ({ notices }) => {
        if (live) setEntries(notices ?? []);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [ids]);
  const known = new Set(linked.map((m) => m.id));
  const unsent = entries.filter((entry) => entry.notice !== null && !entry.dismissed && !known.has(entry.machine));
  if (unsent.length === 0) return null;
  return (
    <>
      <p className="ib-mnote">未发送：这些内容原本在等待一台已不再关联的机器。复制这些文字以通过其他方式发送。</p>
      <div className="ib-card" aria-label="未发送" data-machines-unsent="">
        {unsent.map((entry) => (
          <div className="ib-prow" key={entry.key} data-unsent={entry.key}>
            <span className="ib-txt">
              <span className="ib-l">
                {entry.notice?.kind === 'may_have_been_delivered' ? '可能已送达' : '未发送至'} {entry.machine_name ?? '一台已不再关联的机器'} · {shortTime(entry.queued_at)}
              </span>
              {entry.words ? (
                <span className="ib-desc ib-held-words" dir="auto">
                  {entry.words}
                </span>
              ) : (
                <span className="ib-desc">{unsentWhat(entry.route)}</span>
              )}
            </span>
            <span className="ib-ctl">
              {entry.words && <CopyButton text={entry.words} />}
              <button
                type="button"
                className="ib-btn ib-ghost"
                data-unsent-dismiss=""
                onClick={() => {
                  setEntries((current) => current.filter((e) => e.key !== entry.key));
                  void inboxApi.dismissOutbox(entry.key).catch(() => {});
                }}
              >
                忽略
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** A held write with no words, said by what it did. */
function unsentWhat(route: string): string {
  if (/\/picks$/.test(route)) return '一个选择';
  if (/\/(read|seen)$/.test(route)) return '标为已读';
  if (/\/resolve$/.test(route)) return '归档';
  return '一项更改';
}

/** Link a machine: paste its link code, or type its address and six digits. Only the Link button sends. */
function LinkForm({ onCancel, onLinked }: { onCancel: () => void; onLinked: (name: string) => void }) {
  const [link, setLink] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const pasted = link.trim();
  const typed = address.trim() && /^\d{6}$/.test(code.trim());
  const ready = !busy && (pasted !== '' || !!typed);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await inboxApi.linkMachine(pasted ? { link: pasted } : { address: address.trim(), code: code.trim() });
      onLinked(answer.machine.name);
    } catch (cause) {
      setError(linkErrorText(cause));
      setBusy(false);
    }
  };
  // Enter does not link (no new keys in the Inbox): only the Link button does.
  const noEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter') event.preventDefault();
  };

  return (
    <div className="ib-mform" data-machine-link-form="">
      <label className="ib-mfield">
        <span className="ib-l">来自另一台机器的链接码</span>
        <input
          ref={first}
          type="text"
          className="ib-fbk-contact ib-mono"
          placeholder="plannotator://link?…"
          spellCheck={false}
          autoComplete="off"
          value={link}
          readOnly={busy}
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={noEnter}
          data-machine-link-code=""
        />
      </label>
      <div className="ib-mor">或输入其地址和六位数字</div>
      <div className="ib-mpair">
        <label className="ib-mfield">
          <span className="ib-sr">地址</span>
          <input
            type="text"
            className="ib-fbk-contact"
            placeholder="其地址，例如 mini.tail1234.ts.net:8443"
            spellCheck={false}
            autoComplete="off"
            value={address}
            readOnly={busy || pasted !== ''}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={noEnter}
            data-machine-link-address=""
          />
        </label>
        <label className="ib-mfield ib-mdigits">
          <span className="ib-sr">六位数字</span>
          <input
            type="text"
            className="ib-fbk-contact ib-mono"
            inputMode="numeric"
            maxLength={6}
            placeholder="六位数字"
            autoComplete="one-time-code"
            value={code}
            readOnly={busy || pasted !== ''}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            onKeyDown={noEnter}
            data-machine-link-digits=""
          />
        </label>
      </div>
      {error && (
        <div className="ib-callout ib-err" role="alert" data-machine-link-error="">
          <Icon name="xCircle" />
          <span>{error}</span>
        </div>
      )}
      <div className="ib-mform-f">
        <button type="button" className="ib-btn ib-ghost" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="button" className={`ib-btn ib-pri${ready ? '' : ' ib-dim'}`} aria-disabled={!ready} onClick={() => void submit()} data-machine-link-submit="">
          {busy ? '正在关联…' : '关联'}
        </button>
      </div>
    </div>
  );
}
