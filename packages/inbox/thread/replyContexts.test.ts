/**
 * The reply's 上下文材料 section (approval "session-reply-contexts"): the picked
 * contexts become `- 名字（引用）` lines under the workshop compose template's own
 * heading — the ref rides the line (评审批注 2：只列名字不够，agent 要直接读材料)，
 * nothing picked means no section and no trailing blank line.
 */
import { describe, expect, test } from 'bun:test';
import { REPLY_CONTEXTS_HEADING, replyContextSection, type ReplyContextOption } from './replyContexts';

const contexts: ReplyContextOption[] = [
  { id: 'ctx_1', kind: 'file', name: '设计稿-v2.png', ref: 'design/login-v2.png' },
  { id: 'ctx_2', kind: 'link', name: '竞品参考', ref: 'https://example.com/comp' },
  { id: 'ctx_3', kind: 'file', name: '无引用的旧件' },
];

describe('replyContextSection', () => {
  test('nothing picked: null (no section, no blank line)', () => {
    expect(replyContextSection(contexts, new Set())).toBeNull();
    expect(replyContextSection([], new Set(['ctx_1']))).toBeNull();
    expect(replyContextSection(contexts, new Set(['ctx_missing']))).toBeNull();
  });

  test('picked contexts list as 名字（引用）under the template heading, in the offered order', () => {
    expect(replyContextSection(contexts, new Set(['ctx_2', 'ctx_1']))).toBe(
      `${REPLY_CONTEXTS_HEADING}\n\n- 设计稿-v2.png（design/login-v2.png）\n- 竞品参考（https://example.com/comp）`,
    );
  });

  test('a context without a ref lists its bare name', () => {
    expect(replyContextSection(contexts, new Set(['ctx_3']))).toBe(`${REPLY_CONTEXTS_HEADING}\n\n- 无引用的旧件`);
  });
});
