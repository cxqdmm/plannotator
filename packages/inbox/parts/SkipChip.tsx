import { Icon } from '../icons';
import { formatCount } from '../format';

export function SkipChip({ count, keepOpen, onToggle }: { count: number; keepOpen: boolean; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <span className="ib-skipchip" data-skip-chip={keepOpen ? 'keep' : 'skip'}>
      <span className="ib-skip-s">
        {!keepOpen && <Icon name="forward" size={14} />}
        <span>
          {formatCount(count)}
          {keepOpen ? ' 个问题保持打开' : ' 个问题将被跳过'}
        </span>
      </span>
      <button type="button" onClick={onToggle} data-skip-toggle="">
        {keepOpen ? '跳过' : '保持打开'}
      </button>
    </span>
  );
}
