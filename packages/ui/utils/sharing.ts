/**
 * Portable sharing utilities for Plannotator
 *
 * Enables sharing plan + annotations via URL hash using:
 * - Native CompressionStream/DecompressionStream (deflate-raw)
 * - Base64url encoding for URL safety
 *
 * Inspired by textarea.my's approach.
 */

import { AnnotationType, type Annotation, type DocumentRenderAs, type ImageAttachment } from '../types';
import { isDiagramRenderKind } from '@plannotator/core/annotatable';
import { compress, decompress } from '@plannotator/core/compress';
import { encrypt, decrypt } from '@plannotator/core/crypto';

// Image in shareable format: plain string (old) or [path, name] tuple (new)
type ShareableImage = string | [string, string];

// Minimal shareable annotation format: [type, originalText, text?, author?, images?, quickLabel?, quickLabelTip?]
export type ShareableAnnotation =
  | ['D', string, string | null, ShareableImage[]?]                    // Deletion: type, original, author, images
  | ['C', string, string, string | null, ShareableImage[]?, (1)?, string?] // Comment: type, original, comment, author, images, isQuickLabel, quickLabelTip (a label's tip; older links end before it)
  | ['G', string, string | null, ShareableImage[]?];                   // Global Comment: type, comment, author, images

export interface SharePayload {
  p: string;  // plan markdown
  a: ShareableAnnotation[];
  g?: ShareableImage[];  // global attachments (path strings or [path, name] tuples)
  d?: (string | null)[];  // diffContext per annotation, parallel to `a`
  s?: (string | undefined)[];  // source per annotation (external tool identifier), parallel to `a`
  h?: string;  // raw HTML content (direct HTML rendering mode)
  r?: 'html' | 'asciidoc';  // render mode flag (omitted = markdown)
}

/**
 * The markdown a document ships as in a share payload's `p`.
 *
 * A whole-file diagram source (.mmd/.dot) has no fence of its own — the
 * annotate session renders it as one diagram because the SERVER said so in
 * `renderAs`, and a share link carries no server. So it travels as the fenced
 * form, which the portal's ordinary markdown parse turns back into the same
 * diagram block. This is deliberately smaller than adding a render-mode flag
 * (`r: 'html'`'s sibling): the portal needs no change at all.
 *
 * Diagram comments themselves still degrade to text comments in a share link,
 * exactly as they do today — `diagramAnchor` is dropped like `htmlAnchor`
 * (see sharing.multiTarget.test.ts).
 */
export function shareableDocumentMarkdown(
  markdown: string,
  renderAs: DocumentRenderAs | undefined,
): string {
  if (!isDiagramRenderKind(renderAs) || markdown === '') return markdown;
  const language = renderAs === 'graphviz' ? 'dot' : 'mermaid';
  // A diagram source can itself contain a ``` run only in a comment/label;
  // a four-backtick fence keeps such a body intact.
  const fence = markdown.includes('```') ? '````' : '```';
  return `${fence}${language}\n${markdown.replace(/\n+$/, '')}\n${fence}`;
}

/**
 * Convert ShareableImage[] to ImageAttachment[] (handles old plain-string format)
 */
export function parseShareableImages(raw: ShareableImage[] | undefined): ImageAttachment[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map(img => {
    if (typeof img === 'string') {
      // Old format: plain path string — derive name from filename
      const name = img.split('/').pop()?.replace(/\.[^.]+$/, '') || 'image';
      return { path: img, name };
    }
    return { path: img[0], name: img[1] };
  });
}

/**
 * Convert ImageAttachment[] to ShareableImage[] for compact serialization
 */
export function toShareableImages(images: ImageAttachment[] | undefined): ShareableImage[] | undefined {
  if (!images?.length) return undefined;
  return images.map(img => [img.path, img.name]);
}

// Re-export compress/decompress from shared package (single source of truth)
export { compress, decompress };

/**
 * Convert full Annotation objects to minimal shareable format
 */
export function toShareable(annotations: Annotation[]): ShareableAnnotation[] {
  return annotations.map(ann => {
    const author = ann.author || null;
    const images = toShareableImages(ann.images);

    // Handle GLOBAL_COMMENT specially - it starts with 'G' (from GLOBAL_COMMENT)
    if (ann.type === AnnotationType.GLOBAL_COMMENT) {
      return ['G', ann.text || '', author, images] as ShareableAnnotation;
    }

    if (ann.type === AnnotationType.DELETION) {
      return ['D', ann.originalText, author, images] as ShareableAnnotation;
    }

    // COMMENT
    if (ann.isQuickLabel) {
      // The tip rides an optional 7th slot: readers that predate it stop at
      // the flag, and a label without a tip encodes exactly as before.
      if (ann.quickLabelTip) {
        return ['C', ann.originalText, ann.text || '', author, images ?? undefined, 1, ann.quickLabelTip] as ShareableAnnotation;
      }
      return ['C', ann.originalText, ann.text || '', author, images ?? undefined, 1] as ShareableAnnotation;
    }
    return ['C', ann.originalText, ann.text || '', author, images] as ShareableAnnotation;
  });
}

/**
 * Convert shareable format back to full Annotation objects
 * Note: blockId, offsets, and meta will need to be populated separately
 * by finding the text in the rendered document.
 */
export function fromShareable(data: ShareableAnnotation[], diffContexts?: (string | null)[] | null, sources?: (string | undefined)[] | null): Annotation[] {
  const typeMap: Record<string, AnnotationType> = {
    'D': AnnotationType.DELETION,
    'C': AnnotationType.COMMENT,
    'G': AnnotationType.GLOBAL_COMMENT,
  };

  return data.map((item, index) => {
    const type = item[0];

    // Handle global comments specially: ['G', text, author, images?]
    if (type === 'G') {
      const text = item[1] as string;
      const author = item[2] as string | null;
      const rawImages = item[3] as ShareableImage[] | undefined;

      return {
        id: `shared-${index}-${Date.now()}`,
        blockId: '',
        startOffset: 0,
        endOffset: 0,
        type: AnnotationType.GLOBAL_COMMENT,
        text: text || undefined,
        originalText: '',
        createdA: Date.now() + index,
        author: author || undefined,
        images: parseShareableImages(rawImages),
        ...(sources?.[index] ? { source: sources[index] } : {}),
      };
    }

    const originalText = item[1];
    // For deletion: [type, original, author, images?]
    // For others: [type, original, text, author, images?]
    const text = type === 'D' ? undefined : item[2] as string;
    const author = type === 'D' ? item[2] as string | null : item[3] as string | null;
    const rawImages = type === 'D' ? item[3] as ShareableImage[] | undefined : item[4] as ShareableImage[] | undefined;
    // Comment annotations may have isQuickLabel flag at index 5
    const isQuickLabel = type === 'C' && item.length > 5 && item[5] === 1 ? true : undefined;
    // ...and its tip at index 6 (links made before the tip was shared end at 5)
    const quickLabelTip = isQuickLabel && typeof item[6] === 'string' && item[6] ? item[6] : undefined;

    return {
      id: `shared-${index}-${Date.now()}`,
      blockId: '',  // Will be populated during highlight restoration
      startOffset: 0,
      endOffset: 0,
      type: typeMap[type],
      text: text || undefined,
      originalText,
      createdA: Date.now() + index,  // Preserve order
      author: author || undefined,
      images: parseShareableImages(rawImages),
      ...(isQuickLabel ? { isQuickLabel } : {}),
      ...(quickLabelTip ? { quickLabelTip } : {}),
      ...(diffContexts?.[index] ? { diffContext: diffContexts[index] as Annotation['diffContext'] } : {}),
      ...(sources?.[index] ? { source: sources[index] } : {}),
      // startMeta/endMeta will be set by web-highlighter
    };
  });
}

function buildDiffContextArray(annotations: Annotation[]): (string | null)[] | null {
  const arr = annotations.map(a => a.diffContext || null);
  return arr.some(v => v !== null) ? arr : null;
}

function buildSourceArray(annotations: Annotation[]): (string | undefined)[] | null {
  const arr = annotations.map(a => a.source || undefined);
  return arr.some(v => v !== undefined) ? arr : null;
}

/**
 * The share payload of the current document and annotations — one builder for
 * every transport (hash link, paste short link, and this fork's review packet
 * file: packages/ui/utils/reviewPacket.ts).
 */
export function buildSharePayload(
  markdown: string,
  annotations: Annotation[],
  globalAttachments?: ImageAttachment[],
  rawHtml?: string,
  renderAs?: DocumentRenderAs,
): SharePayload {
  const diffContexts = buildDiffContextArray(annotations);
  const sources = buildSourceArray(annotations);
  return {
    p: markdown,
    a: toShareable(annotations),
    g: globalAttachments?.length ? toShareableImages(globalAttachments) : undefined,
    ...(diffContexts ? { d: diffContexts } : {}),
    ...(sources ? { s: sources } : {}),
    ...(rawHtml ? { h: rawHtml, r: 'html' as const } : renderAs === 'asciidoc' ? { r: 'asciidoc' as const } : {}),
  };
}

/**
 * Generate a full shareable URL from plan and annotations.
 *
 * This fork has no external share portal: `baseUrl` must name a self-hosted
 * one (the server passes PLANNOTATOR_SHARE_URL through). Nothing is
 * generated without it — sharing stays local.
 */
export async function generateShareUrl(
  markdown: string,
  annotations: Annotation[],
  globalAttachments?: ImageAttachment[],
  baseUrl?: string,
  rawHtml?: string,
  renderAs?: DocumentRenderAs,
): Promise<string | null> {
  // HTML content is too large for URL hashes — force paste service path
  if (rawHtml) return null;
  if (!baseUrl) return null;
  const payload = buildSharePayload(markdown, annotations, globalAttachments, undefined, renderAs);
  const hash = await compress(payload);
  return `${baseUrl}/#${hash}`;
}

/**
 * Parse a share URL hash and return the payload
 * Returns null if no valid hash or parsing fails
 */
export async function parseShareHash(): Promise<SharePayload | null> {
  const raw = window.location.hash.slice(1); // Remove leading #
  const hash = raw.split('?')[0]; // Strip callback params (?cb=...&ct=...)

  if (!hash) {
    return null;
  }

  try {
    return (await decompress(hash)) as SharePayload;
  } catch (e) {
    console.warn('Failed to parse share hash:', e);
    return null;
  }
}

/**
 * Get the size of a URL in a human-readable format
 */
export function formatUrlSize(url: string): string {
  const bytes = new Blob([url]).size;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// Short URL support (paste-service backed)
//
// This fork uploads to NO ONE by default: `pasteApiUrl`/`shareBaseUrl` must
// name a self-hosted paste service and share portal (PLANNOTATOR_PASTE_URL /
// PLANNOTATOR_SHARE_URL reach here from the server config). Unconfigured →
// null, with no network request at all.
// ---------------------------------------------------------------------------

export class ShortShareUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShortShareUrlError';
  }
}

/**
 * Create a short share URL by posting compressed plan data to the paste service.
 *
 * Returns `{ shortUrl, id }` on success, or `null` when no self-hosted paste
 * service is configured (this fork's default) or it is unreachable. Callers
 * should fall back to the hash-based URL in that case.
 *
 * The request has a 5-second timeout so UI responsiveness is not affected.
 */
export async function createShortShareUrl(
  markdown: string,
  annotations: Annotation[],
  globalAttachments?: ImageAttachment[],
  options?: {
    /** The self-hosted paste API base URL; no request is made without it. */
    pasteApiUrl?: string;
    /** The self-hosted share site base URL used in the returned short link. */
    shareBaseUrl?: string;
  },
  rawHtml?: string,
  renderAs?: DocumentRenderAs,
): Promise<{ shortUrl: string; id: string } | null> {
  const pasteApi = options?.pasteApiUrl;
  const shareBase = options?.shareBaseUrl;
  if (!pasteApi || !shareBase) return null;

  try {
    const payload = buildSharePayload(markdown, annotations, globalAttachments, rawHtml, renderAs);
    const compressed = await compress(payload);

    // Encrypt before uploading — the service only sees ciphertext
    const { ciphertext, key } = await encrypt(compressed);

    const response = await fetch(`${pasteApi}/api/paste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: ciphertext }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      if (response.status === 413) {
        throw new ShortShareUrlError(await readPasteError(response, '分享内容过大'));
      }
      console.warn(`[sharing] Paste service returned ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { id: string };
    // The link always names its paste service: there is no default one any more.
    const pasteParam = `&paste=${btoa(pasteApi).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`;
    const shortUrl = `${shareBase}/p/${result.id}#key=${key}${pasteParam}`;

    return { shortUrl, id: result.id };
  } catch (e) {
    if (e instanceof ShortShareUrlError) {
      throw e;
    }
    // Service unavailable — the caller is responsible for falling back to
    // hash-based sharing silently.
    return null;
  }
}

async function readPasteError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Load plan data from a paste service using the paste ID embedded in a short URL.
 *
 * Fetches the compressed payload from `<pasteApiUrl>/api/paste/<pasteId>` and
 * decompresses it into a `SharePayload`. Returns `null` on any failure —
 * including no paste URL at all (short links name their own service in the
 * fragment, so a self-hosted link still loads without configuration).
 */
export async function loadFromPasteId(
  pasteId: string,
  pasteApiUrl?: string,
  encryptionKey?: string
): Promise<SharePayload | null> {
  if (!pasteApiUrl) return null;
  try {
    const response = await fetch(`${pasteApiUrl}/api/paste/${pasteId}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[sharing] Paste fetch returned ${response.status} for id ${pasteId}`);
      return null;
    }

    const result = (await response.json()) as { data: string };

    if (encryptionKey) {
      // Encrypted path: decrypt ciphertext, then decompress
      const compressed = await decrypt(result.data, encryptionKey);
      return await decompress(compressed) as SharePayload;
    }

    // Legacy unencrypted path: decompress directly
    return await decompress(result.data) as SharePayload;
  } catch (e) {
    console.warn('[sharing] Failed to load from paste ID:', e);
    return null;
  }
}
