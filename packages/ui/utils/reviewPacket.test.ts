import { describe, expect, test } from 'bun:test';
import { injectReviewPacket, packetScriptTag, safeFileStem, verdictText, REVIEW_PACKET_ID } from './reviewPacket';

const PACKET = { p: '# 计划\n正文', a: [['C', '原文', '改这里', 'me', [], 1]] } as Parameters<typeof packetScriptTag>[0];

describe('reviewPacket', () => {
  test('script 岛转义 <，杜绝 </script> 提前闭合', () => {
    const tag = packetScriptTag({ ...PACKET, p: '内容含 </script> 与 <b>标签</b>' });
    expect(tag).not.toContain('</script>意外');
    expect(tag).toContain('\\u003c');
    // 岛本身以正常闭合收尾
    expect(tag.endsWith('</script>')).toBe(true);
  });

  test('注入只动第一个 <head>，原页其余一字不动', () => {
    const page = '<!doctype html>\n<html><head><meta charset="utf-8"></head><body>正文</body></html>';
    const out = injectReviewPacket(page, PACKET);
    const open = out.indexOf(`id="${REVIEW_PACKET_ID}"`);
    expect(open).toBeGreaterThan(0);
    expect(out.indexOf('<meta charset')).toBeGreaterThan(open); // 岛在 head 开口处、meta 之前
    expect(out.endsWith('正文</body></html>')).toBe(true);
    expect(out).toContain(JSON.stringify(PACKET).replace(/</g, '\\u003c'));
  });

  test('没有 <head> 的页面直接报错，不产出半成品', () => {
    expect(() => injectReviewPacket('<html><body>x</body></html>', PACKET)).toThrow(/no <head>/);
  });

  test('意见文件含可粘贴的 #hash 行，且能被导入框的 indexOf("#") 解析', () => {
    const text = verdictText('AbC123xyz_MIXED', '登录方案设计', '张三');
    expect(text).toContain('#AbC123xyz_MIXED');
    expect(text.slice(text.indexOf('#'))).toBe('#AbC123xyz_MIXED\n');
    expect(text).toContain('登录方案设计');
    expect(text).toContain('张三');
  });

  test('文件名安全化：去路径与 Windows 保留字符、空白折叠、限长、空回退', () => {
    expect(safeFileStem('  a/b\\c:d*e?f"g<h>|i  ')).toBe('abcdefghi');
    expect(safeFileStem('标题'.repeat(50)).length).toBeLessThanOrEqual(60);
    expect(safeFileStem('   ')).toBe('评审件');
  });
});
