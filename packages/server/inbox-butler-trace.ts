/**
 * 管家的行为 trace（owner 2026-11-28「缺少对管家本身的监控…接收了某个事件后，后面触发了
 * 什么」）：一条 append-only 的 jsonl（管家文件夹 trace.jsonl），记下——
 *
 *  - `event`  事件入账（管家看到的每一笔：交付、阶段、会话提问……）
 *  - `wake`   唤醒的处置决定：开口了 / 延迟了（没有会话、正在说话）/ 被静默（连醒熔断）
 *  - `turn`   管家开口（一句摘要；正文在对话历史 history.jsonl，这里只是索引）
 *  - `action` 动作执行与结果（类型、关键参数、ok/错误码——排障的主现场）
 *  - `fuse`   熔断与自愈（工具循环熔断、过期会话重建、主人打断）
 *
 * 平铺时间线 + 因果引用：`cause` 指向引发本条的事件 id，UI 展开一行就能看到
 * 「因为什么 → 做了什么 → 结果如何」。读时裁剪（最近 14 天 / 2000 条，先到先截）。
 * 追加从不抛错——trace 挂了不能连累管家本体。
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "@plannotator/core/inbox-types";

export interface ButlerTraceEntry {
  /** 事件条目沿用事件自己的语义 id（因果能对上）；其余 `trc_` + ULID。 */
  id: string;
  at: string;
  type: "event" | "wake" | "turn" | "action" | "fuse";
  summary: string;
  /** 排障细节：动作参数、错误码、失败原因。 */
  detail?: string;
  /** 引发本条的事件（或 trace 条目）id。 */
  cause?: string;
  /** 处置结果：spoken / deferred / suppressed / ok / error:<code> … */
  outcome?: string;
  refs?: { requirement?: string; thread?: string };
}

export interface ButlerTrace {
  append: (entry: Omit<ButlerTraceEntry, "id"> & { id?: string }) => void;
  read: (options?: { days?: number; limit?: number }) => ButlerTraceEntry[];
}

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const KEEP_ENTRIES = 2000;
/** 单条上限：detail 里可能有长参数，别让一行吃掉整个文件。 */
const MAX_LINE = 2000;

const byDir = new Map<string, ButlerTrace>();

/** 按管家目录取 trace（同一目录同一份文件，三个模块各取各的、写的是同一条流）。 */
export function butlerTraceOf(dir: string): ButlerTrace {
  const known = byDir.get(dir);
  if (known) return known;
  const path = join(dir, "trace.jsonl");
  const trace: ButlerTrace = {
    append(entry) {
      try {
        const full: ButlerTraceEntry = { id: entry.id ?? `trc_${ulid()}`, ...entry } as ButlerTraceEntry;
        appendFileSync(path, `${JSON.stringify(full).slice(0, MAX_LINE)}\n`, { mode: 0o600 });
      } catch {
        // trace 挂了不连累管家本体（文件夹还没建、磁盘满……）。
      }
    },
    read(options) {
      const days = options?.days ?? 14;
      const limit = options?.limit ?? KEEP_ENTRIES;
      try {
        if (!existsSync(path)) return [];
        // 大文件只读尾部（stat 估行数不可靠，直接整读再裁——文件被 KEEP 限着，不会失控）。
        statSync(path);
        const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
        const floor = Date.now() - days * 24 * 60 * 60 * 1000;
        const parsed: ButlerTraceEntry[] = [];
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as ButlerTraceEntry;
            if ((Date.parse(entry.at) || 0) >= floor) parsed.push(entry);
          } catch {
            // 一行坏了跳过那一行。
          }
        }
        return parsed.slice(-limit);
      } catch {
        return [];
      }
    },
  };
  byDir.set(dir, trace);
  return trace;
}

/** 一句摘要工具：首行 + 截断（wake/turn 的正文都可能是多段）。 */
export function traceBrief(text: string, max = 80): string {
  const first = text.trim().split("\n").find((line) => line.trim()) ?? "";
  return first.length > max ? `${first.slice(0, max)}…` : first;
}
