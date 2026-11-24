/**
 * 材料的内嵌文本（approval "session-reply-contexts"）：点选/拖拽的材料以 markdown
 * 链接 `[名字](引用)` 进回复正文——agent 直接读引用；无引用的裸名。
 */
import { describe, expect, test } from 'bun:test';
import { replyContextMarkdown, type ReplyContextOption } from './replyContexts';

const file: ReplyContextOption = { id: 'ctx_1', kind: 'file', name: '设计稿-v2.png', ref: 'design/login-v2.png' };
const link: ReplyContextOption = { id: 'ctx_2', kind: 'link', name: '竞品参考', ref: 'https://example.com/comp' };
const bare: ReplyContextOption = { id: 'ctx_3', kind: 'file', name: '无引用的旧件' };

describe('replyContextMarkdown', () => {
  test('a ref rides the line: [名字](引用) — the agent reads the material from the reply', () => {
    expect(replyContextMarkdown(file)).toBe('[设计稿-v2.png](design/login-v2.png)');
    expect(replyContextMarkdown(link)).toBe('[竞品参考](https://example.com/comp)');
  });

  test('a context without a ref is its bare name', () => {
    expect(replyContextMarkdown(bare)).toBe('无引用的旧件');
  });
});
