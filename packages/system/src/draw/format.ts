// Words and numbers the drawing prints from data, in one place.

export const KIND: Record<string, string> = {
  conceptual: '概念图',
  logical: '逻辑图',
  deployment: '部署图',
  service: '服务表',
  flow: '数据流',
  algorithm: '算法图',
  landscape: '全景图',
};
/** A sheet kind the drawing does not know is still a kind: "threat model" reads "Threat model". */
export const kindLabel = (k: string) => KIND[k] ?? (k || '图纸');

const nf = new Intl.NumberFormat('zh-CN');
/** "1 张图纸", "1,284 个部分". */
export const plural = (n: number, one: string, _many = one) => `${nf.format(n)} ${one}`;

/** Middle truncation: routes and hostnames differ at the end, so keep the head and the tail. */
export function middle(text: string | null | undefined, max = 34): string {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.45);
  return t.slice(0, head) + '…' + t.slice(t.length - (keep - head));
}
