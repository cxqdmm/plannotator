import { useEffect, useRef, useState } from 'react';
import { inboxCloudHostOf, INBOX_CLOUD_PRESET_LABELS, INBOX_CLOUD_PRESETS, type InboxCloudPreset, type InboxCloudSetup } from '@plannotator/core/inbox-cloud';
import { inboxApi, type CloudAgentsModel } from '../api';
import { HostMark, Icon } from '../icons';
import { errorText, noEnter } from './cloudShared';

function KindPicker({ value, disabled, onChange }: { value: InboxCloudPreset; disabled: boolean; onChange: (preset: InboxCloudPreset) => void }) {
  return (
    <fieldset className="ib-cl-kinds-f" disabled={disabled}>
      <legend className="ib-l">类型</legend>
      <div className="ib-cl-kinds">
        {INBOX_CLOUD_PRESETS.map((id) => (
          <label key={id} className="ib-cl-kind" data-on={value === id ? '' : undefined} data-cloud-kind={id}>
            <input type="radio" name="ib-cloud-preset" value={id} checked={value === id} onChange={() => onChange(id)} />
            <HostMark host={inboxCloudHostOf(id)} />
            <span className="ib-cl-kind-n">{INBOX_CLOUD_PRESET_LABELS[id]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CloudPairForm({
  onCancel,
  onPaired,
}: {
  onCancel: () => void;
  onPaired: (model: CloudAgentsModel, session: string, setup: InboxCloudSetup | null) => void;
}) {
  const [preset, setPreset] = useState<InboxCloudPreset>('claude-routine');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const ready = !busy && name.trim() !== '';

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await inboxApi.pairCloudAgent({ name: name.trim(), preset });
      onPaired(answer, answer.agent.session, answer.setup);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };

  return (
    <div className="ib-mform ib-cl-pair" data-cloud-pair-form="">
      <span className="ib-cl-step-t">配对云端 agent</span>
      <KindPicker value={preset} disabled={busy} onChange={setPreset} />
      <label className="ib-mfield">
        <span className="ib-l">名称</span>
        <input ref={first} type="text" className="ib-fbk-contact" placeholder="夜间修复机器人" maxLength={60} autoComplete="off" value={name} readOnly={busy} onChange={(event) => setName(event.target.value)} onKeyDown={noEnter} data-cloud-name="" />
      </label>
      <span className="ib-cl-note">
        它可以在这整个收件箱中读写，且始终以自己的名义。
      </span>
      {error && (
        <div className="ib-callout ib-err" role="alert" data-cloud-pair-error="">
          <Icon name="xCircle" />
          <span>{error}</span>
        </div>
      )}
      <div className="ib-mform-f">
        <button type="button" className="ib-btn ib-ghost" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="button" className={`ib-btn ib-pri${ready ? '' : ' ib-dim'}`} aria-disabled={!ready} onClick={() => void submit()} data-cloud-pair-submit="">
          {busy ? '正在配对…' : '配对'}
        </button>
      </div>
    </div>
  );
}
