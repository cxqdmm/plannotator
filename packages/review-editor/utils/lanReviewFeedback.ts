import type { CodeAnnotation, Annotation, CommentAnnotation } from '@plannotator/ui/types';

/**
 * 门内批注交回的快照形状（代码评审页）：三路批注原样序列化（CodeAnnotation 自带
 * anchorSnapshot 锚点，导入侧靠 reanchorCodeAnnotations 重挂），压成与分享链接同款
 * 的压缩串 POST 给门（/api/lan-feedback），随链接保存。不带时间戳——快照内容寻址，
 * 同一状态压出同一个串，门端去重后只存一份。
 */
export interface LanReviewFeedback {
  review: true;
  annotations: CodeAnnotation[];
  descriptionAnnotations: Annotation[];
  commentAnnotations: CommentAnnotation[];
}

/** 分享链接那头的载荷是不是代码评审页的批注快照（设计评审页的导入据此跳过）。 */
export function isLanReviewFeedback(value: unknown): value is LanReviewFeedback {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { review?: unknown; annotations?: unknown };
  return v.review === true && Array.isArray(v.annotations);
}
