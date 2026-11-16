/**
 * A reveal's "Turn it on" (the owner, 2026-11-04: reveals are opt-in), apart from App so a test drives it with a save
 * that fails. The dialog closes and the switch shows on at once; the save is Settings' own, so the page follows and
 * agents from their next session. Not saved: the switch goes back to off first (the offer only opens while the feature
 * is off, so off is the value before the click; the settings re-read may fail the same way), then a toast says so.
 * The dialog never comes back; Settings is the way on from here.
 */
import type { InboxToastModel } from './components/Toast';

export type RevealFeature = 'board' | 'steps' | 'code_review' | 'bro';

/** The part of the settings a reveal reads and writes. */
type FeatureSettings = { [K in RevealFeature]?: { on: boolean } };

export interface RevealTurnOnDeps<S extends FeatureSettings> {
  /** The switch's save (`POST /api/inbox/settings`), answering the switch as saved. */
  save: () => Promise<{ on: boolean }>;
  setSettings: (update: (current: S | null) => S | null) => void;
  showToast: (toast: Omit<InboxToastModel, 'id'>, ms: number) => void;
  dismissToast: () => void;
  /** Read the settings again (a failure leaves them as they are). */
  refreshSettings: () => unknown;
  /** Settings → Capabilities. */
  openSettings: () => void;
}

/** The toast's lead when the save fails. */
const REVEAL_FEATURE_NAMES: Record<RevealFeature, string> = {
  board: '看板未开启',
  steps: '清单未开启',
  code_review: '代码评审未开启',
  bro: 'Bro 模式未开启',
};

/** How long the "isn't on" toast stays. */
export const REVEAL_TURN_ON_FAILED_MS = 8000;

export function turnOnFromReveal<S extends FeatureSettings>(feature: RevealFeature, close: () => void, deps: RevealTurnOnDeps<S>): Promise<void> {
  close();
  const put = (value: { on: boolean }) => deps.setSettings((current) => (current ? { ...current, [feature]: value } : current));
  put({ on: true });
  return deps.save().then(
    (saved) => put(saved),
    () => {
      put({ on: false });
      void deps.refreshSettings();
      deps.showToast(
        {
          icon: 'warn',
          lead: REVEAL_FEATURE_NAMES[feature],
          detail: '设置未保存。你可以在设置中开启。',
          action: {
            label: '打开设置',
            onPress: () => {
              deps.dismissToast();
              deps.openSettings();
            },
          },
        },
        REVEAL_TURN_ON_FAILED_MS,
      );
    },
  );
}
