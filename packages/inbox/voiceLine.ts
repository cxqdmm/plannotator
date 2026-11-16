/**
 * What the mic's status says at this moment, from the session's state. Pure, so the moments it changes are tested
 * without waiting for them.
 */
import { voiceClock } from './voiceAudio';
import { VOICE_CAP_MS, VOICE_COUNTDOWN_MS, VOICE_NO_VOICE_MS, VOICE_QUIET_STOP_MS, VOICE_QUIET_WARN_MS, type VoiceMeter, type VoiceView } from './voiceSession';

export type VoiceLineState = 'asking' | 'opening' | 'hold' | 'tap' | 'quiet' | 'nearcap' | 'silencestop' | 'sending';

export interface VoiceLine {
  state: VoiceLineState;
  word: string;
  hint: string;
  time?: string;
  /** The level, and whether it is lit. */
  bars?: 'voice' | 'quiet';
}

/** Nothing to say while idle, or in the first moment the mic opens with no prompt (the button shows it then). */
export function voiceLine(view: VoiceView, meter: VoiceMeter, phone: boolean): VoiceLine | null {
  const { elapsedMs, voice, voiceSeen, quietMs } = meter;
  const time = voiceClock(elapsedMs);
  if (view.phase === 'opening') {
    // Short words: a phone's row has room for them whole beside Cancel and Send.
    if (view.prompting) return { state: 'asking', word: '正在请求麦克风…', hint: phone ? '' : '请回应浏览器的提示' };
    return view.slow ? { state: 'opening', word: '正在打开麦克风…', hint: '' } : null;
  }
  if (view.phase === 'sending') return { state: 'sending', word: '正在转写', hint: phone ? '' : `${voiceClock(view.clipMs)} 的片段` };
  if (view.phase !== 'listening') return null;
  const held = view.mode !== 'tap';
  if (!voiceSeen && elapsedMs >= VOICE_NO_VOICE_MS) return { state: 'quiet', word: '还没有声音', hint: phone ? '' : '请检查麦克风', bars: 'quiet', time };
  if (!held && voiceSeen && quietMs >= VOICE_QUIET_WARN_MS) {
    const left = Math.ceil((VOICE_QUIET_STOP_MS - quietMs) / 1000);
    return { state: 'silencestop', word: '安静', hint: phone ? '' : `${left} 秒后停止`, bars: 'quiet', time };
  }
  const bars = voice ? 'voice' : 'quiet';
  if (elapsedMs >= VOICE_COUNTDOWN_MS) {
    return { state: 'nearcap', word: '正在听', hint: phone ? '' : '2:00 时停止', bars, time: `还剩 ${voiceClock(VOICE_CAP_MS - elapsedMs + 999)}` };
  }
  if (held) return { state: 'hold', word: '正在听', hint: phone ? '' : '松开停止 · Esc 取消', bars, time };
  return { state: 'tap', word: '正在听', hint: phone ? '' : '点按麦克风停止', bars, time };
}
