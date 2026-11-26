/**
 * 管家交互卡片的协议（owner 2026-11-27）：只有信息串是 `html card` 的围栏才是卡片；
 * 普通 ```html 是代码示例；流式途中没有收尾也要认（画骨架）；渲染前的校验挡住空卡、
 * 超限与外链。
 */
import { describe, expect, test } from 'bun:test';
import { BUTLER_CARD_MAX_BYTES, BUTLER_CARD_SOFT_BYTES, cardHeightOf, cardMetaOf, cardProblem, cardReplyOf, cardWarnings, parseButlerCards } from './components/butler-card-protocol';

const CARD = '```html card\n<!-- card: {"title":"进展","height":260} -->\n<div data-card>hi</div>\n```';

describe('parseButlerCards', () => {
  test('splits prose and a closed card, with its meta', () => {
    const segments = parseButlerCards(`前面一句\n\n${CARD}\n\n后面一句`);
    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'card', 'text']);
    const card = segments[1]!;
    if (card.kind !== 'card') throw new Error('expected a card');
    expect(card.closed).toBe(true);
    expect(card.meta).toEqual({ title: '进展', height: 260 });
    expect(card.html).toContain('<div data-card>hi</div>');
    expect((segments[0] as { text: string }).text).toContain('前面一句');
    expect((segments[2] as { text: string }).text).toContain('后面一句');
  });

  test('a card still streaming (no closing fence) is reported open, so the page draws the skeleton', () => {
    const segments = parseButlerCards('好的，我画一张：\n```html card\n<!-- card: {"title":"选一个"} -->\n<div data-card>');
    const card = segments.at(-1)!;
    if (card.kind !== 'card') throw new Error('expected a card');
    expect(card.closed).toBe(false);
    expect(card.meta.title).toBe('选一个');
  });

  test('a plain ```html block stays prose (a code sample is never a card)', () => {
    const segments = parseButlerCards('看这段代码：\n```html\n<div>sample</div>\n```');
    expect(segments.every((segment) => segment.kind === 'text')).toBe(true);
  });

  test('the fence marker is case-insensitive and tolerates extra spaces', () => {
    const segments = parseButlerCards('```HTML   CARD\n<div data-card></div>\n```');
    expect(segments[0]!.kind).toBe('card');
  });

  test('a bad meta line is ignored rather than failing the card', () => {
    const segments = parseButlerCards('```html card\n<!-- card: {nope} -->\n<div data-card></div>\n```');
    const card = segments[0]!;
    if (card.kind !== 'card') throw new Error('expected a card');
    expect(card.meta).toEqual({});
    expect(cardHeightOf(card.meta)).toBe(320);
  });

  test('the height is clamped to the sane range', () => {
    expect(cardMetaOf('<!-- card: {"height":10} -->')).toMatchObject({ height: 160 });
    expect(cardMetaOf('<!-- card: {"height":5000} -->')).toMatchObject({ height: 900 });
  });
});

describe('cardProblem', () => {
  test('accepts a plain self-contained card', () => {
    expect(cardProblem('<div data-card>ok</div>')).toBeNull();
  });

  test('refuses the empty, the tagless, and the externally loaded', () => {
    expect(cardProblem('  ')).toContain('空');
    expect(cardProblem('<div>no root marker</div>')).toContain('data-card');
    expect(cardProblem('<script src="https://x.test/a.js"></script><div data-card></div>')).toContain('外部');
    expect(cardProblem('<link rel="stylesheet" href="x.css"><div data-card></div>')).toContain('外部');
    expect(cardProblem('<style>@import "x.css";</style><div data-card></div>')).toContain('外部');
  });

  test('refuses a card past the size cap', () => {
    const big = `<div data-card>${'x'.repeat(BUTLER_CARD_MAX_BYTES)}</div>`;
    expect(cardProblem(big)).toContain('太大');
  });
});

describe('tolerant fences (models do not always put them on their own line)', () => {
  const F = '```';
  const NL = String.fromCharCode(10);
  test('an opener at the end of a sentence and a closer at the end of a line still parse', () => {
    const text = ['好的，样例卡在此：' + F + 'html card', '', '<!-- card: {"title":"样例","height":300} -->', '', '<div data-card>hi</div> ' + F + ' 后面还有一句'].join(NL);
    const segments = parseButlerCards(text);
    expect(segments.map((segment) => segment.kind)).toEqual(['text', 'card', 'text']);
    const card = segments[1]!;
    if (card.kind !== 'card') throw new Error('expected a card');
    expect(card.closed).toBe(true);
    expect(card.meta.title).toBe('样例');
    expect(card.html).toContain('<div data-card>hi</div>');
    expect((segments[2] as { text: string }).text).toContain('后面还有一句');
  });

  test('two cards in one reply are both found', () => {
    const text = [F + 'html card', '<div data-card>A</div>', F, '中间', F + 'html card', '<div data-card>B</div>', F].join(NL);
    const kinds = parseButlerCards(text).map((segment) => segment.kind);
    expect(kinds.filter((kind) => kind === 'card')).toHaveLength(2);
  });
});

describe('cardWarnings', () => {
  test('multiple inputs without a confirm button are flagged', () => {
    const html = '<div data-card><input type="checkbox">A<input type="checkbox">B<button onclick="plannotator.send(1)">x</button><button onclick="plannotator.send(2)">y</button></div>';
    expect(cardWarnings(html).join()).toContain('确认按钮');
  });

  test('a confirm button settles it, and a single-choice card needs none', () => {
    const multi = '<div data-card><input type="checkbox"><button data-card-confirm onclick="plannotator.send(1)">ok</button></div>';
    expect(cardWarnings(multi)).toEqual([]);
    const single = '<div data-card><button onclick="plannotator.send(1)">A</button><button onclick="plannotator.send(2)">B</button></div>';
    expect(cardWarnings(single)).toEqual([]);
  });

  test('a <style> block is flagged (utilities only)', () => {
    expect(cardWarnings('<style>.x{}</style><div data-card></div>').join()).toContain('工具类');
  });
});

describe('cardReplyOf', () => {
  test('a card reply is recognised, and plain words are not', () => {
    expect(cardReplyOf('（来自卡片：选好了 B）')).toBe('选好了 B');
    expect(cardReplyOf('  你好  ')).toBeNull();
    expect(cardReplyOf('（来自卡片：）')).toBeNull();
  });
});

describe('card compactness', () => {
  test('a card past the soft limit is flagged for slimming', () => {
    const big = `<div data-card>${'x'.repeat(BUTLER_CARD_SOFT_BYTES)}</div>`;
    expect(cardWarnings(big).join()).toContain('偏大');
  });
});
