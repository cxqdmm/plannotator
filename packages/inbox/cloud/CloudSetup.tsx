import { useEffect, useRef, useState } from 'react';
import type { InboxCloudAgentView, InboxCloudSetup } from '@plannotator/core/inbox-cloud';
import { copyTextToClipboard } from '@plannotator/ui/utils/clipboard';
import { Icon } from '../icons';
import { CloudStatus } from './CloudStatus';

function CopyBox({ text, data, label, primary }: { text: string; data: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ib-cl-box" data-cloud-copy-block={data}>
      <div className="ib-cl-box-bar">
        <span className="ib-cl-note">{label}</span>
        <button type="button" className={`ib-btn ib-cl-copy-b${primary ? ' ib-pri' : ''}`} onClick={() => void copyTextToClipboard(text).then((ok) => setCopied(ok))} data-cloud-copy={data}>
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="ib-cl-block">{text}</pre>
    </div>
  );
}

export function CloudSetup({ agent, setup, busy, onRetry, onDone }: { agent: InboxCloudAgentView; setup: InboxCloudSetup | null; busy: boolean; onRetry: () => void; onDone: () => void }) {
  const head = useRef<HTMLDivElement>(null);
  useEffect(() => head.current?.focus(), [setup]);
  const connected = agent.link.state === 'connected';
  return (
    <div className="ib-cl-step" data-cloud-setup={setup ? setup.kind : 'no-relay'} tabIndex={-1} ref={head}>
      {!setup ? (
        <>
          <p className="ib-cl-step-t">暂时没有可发送给 {agent.name} 的内容</p>
          <p className="ib-cl-p" role="alert" data-cloud-no-relay="">
            这台计算机无法连接中继。请确认它已联网，然后重试。
          </p>
        </>
      ) : setup.kind === 'message' ? (
        <>
          <p className="ib-cl-step-t">把它发送给 {agent.name}，它会自行完成设置。</p>
          <CopyBox text={setup.message} data="message" label="仅显示这一次。" primary={!connected} />
        </>
      ) : (
        <>
          <p className="ib-cl-step-t">把以下内容添加到 {agent.name} 的例行任务中</p>
          <p className="ib-cl-p">在例行任务中依次打开：编辑 → 高级设置 → 云端环境 → 其设置图标，然后保存更改。</p>
          <CopyBox text={setup.variable} data="variable" label="环境变量 · 仅显示这一次" />
          <CopyBox text={setup.domains} data="domains" label="网络访问：受限。允许的域名" />
          <CopyBox text={setup.instructions} data="instructions" label="添加到例行任务的说明中" />
        </>
      )}
      <div className="ib-cl-step-f">
        {setup && <CloudStatus agent={agent} />}
        <span className="ib-cl-step-acts">
          <button type="button" className={`ib-btn${connected ? ' ib-pri' : ' ib-ghost'}`} onClick={onDone} data-cloud-done="">
            完成
          </button>
          {!setup && (
            <button type="button" className="ib-btn ib-pri" disabled={busy} onClick={onRetry} data-cloud-retry="">
              {busy ? '正在尝试…' : '重试'}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
