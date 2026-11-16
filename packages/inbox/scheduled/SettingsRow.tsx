import { Switch } from '../components/SoundRow';

/**
 * Settings → Capabilities → Routines (CONTRACT.md section 3), after Checklist. Where the Inbox cannot start
 * itself at login (`login: 'unavailable'`), one plain line says so.
 */
export function ScheduledSettingsRow({ value, onToggle }: { value: { on: boolean; login?: 'added' | 'unavailable' }; onToggle: (next: boolean) => void }) {
  return (
    <div className="ib-prow" data-settings-scheduled="">
      <span className="ib-txt">
        <span className="ib-l" id="ib-scheduled-label">
          例行任务
        </span>
        <span className="ib-desc">
          在收件箱运行期间，按计划在这台计算机上运行已保存的提示词。
          {value.on && value.login === 'unavailable' && <> 你在这台计算机上登录时，它不会启动收件箱。</>}
        </span>
      </span>
      <span className="ib-ctl">
        <Switch on={value.on} labelledBy="ib-scheduled-label" onClick={() => onToggle(!value.on)} />
      </span>
    </div>
  );
}
