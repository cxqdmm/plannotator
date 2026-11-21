/**
 * Server-side share URL generation for remote sessions.
 *
 * This fork ships no external share/paste service (no upload to anyone's
 * cloud): both endpoints must be a self-hosted one, named by the caller
 * (PLANNOTATOR_SHARE_URL / PLANNOTATOR_PASTE_URL reach here as
 * `shareBaseUrl` / `pasteApiUrl`). Nothing is generated without them.
 */

import { compress } from "@plannotator/shared/compress";
import { encrypt } from "@plannotator/shared/crypto";

export interface RemoteShareOptions {
  rawHtml?: string;
  pasteApiUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Generate a share URL from plan markdown content.
 *
 * Returns the full hash-based URL, or null when no self-hosted share portal
 * is configured (this fork's default — sharing stays local).
 */
export async function generateRemoteShareUrl(
  plan: string,
  shareBaseUrl?: string,
  options: RemoteShareOptions = {},
): Promise<string | null> {
  if (!shareBaseUrl) return null;
  if (options.rawHtml) {
    // Callers that start from a local file should pass self-contained HTML
    // so sibling assets keep working after the payload leaves the machine.
    return generateRemotePasteShareUrl(
      { p: plan, a: [], h: options.rawHtml, r: "html" },
      shareBaseUrl,
      options.pasteApiUrl,
      options.fetchImpl,
    );
  }
  const hash = await compress({ p: plan, a: [] });
  return `${shareBaseUrl}/#${hash}`;
}

async function generateRemotePasteShareUrl(
  payload: unknown,
  shareBaseUrl: string,
  pasteApiUrl?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!pasteApiUrl) return null;
  const compressed = await compress(payload);
  const { ciphertext, key } = await encrypt(compressed);

  const response = await fetchImpl(`${pasteApiUrl}/api/paste`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: ciphertext }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(await readPasteError(response, `Paste service returned ${response.status}`));
  }

  const result = (await response.json()) as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) {
    throw new Error("Paste service response missing id");
  }

  // The link always names its paste service: there is no default one any more.
  return `${shareBaseUrl}/p/${result.id}#key=${key}&paste=${base64UrlEncode(pasteApiUrl)}`;
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function readPasteError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Format byte size as human-readable string
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 100 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
}

/**
 * Generate a remote share URL and write it to stderr for the user.
 * Keeps the local server running, but warns when the fallback share link
 * cannot be created for remote sessions.
 */
export async function writeRemoteShareLink(
  content: string,
  shareBaseUrl: string | undefined,
  verb: string,
  noun: string,
  options: RemoteShareOptions = {},
): Promise<void> {
  if (!shareBaseUrl && !options.rawHtml) return; // sharing off: nothing to say
  try {
    const shareUrl = await generateRemoteShareUrl(content, shareBaseUrl, options);
    if (!shareUrl) {
      // A paste upload was wanted (rawHtml) but no self-hosted paste service is
      // configured. Say so once, quietly — the local page still works.
      process.stderr.write(`\n  (Sharing is off: no self-hosted paste service configured for ${noun}.)\n\n`);
      return;
    }
    const size = formatSize(new TextEncoder().encode(shareUrl).length);
    process.stderr.write(
      `\n  Open this link on your local machine to ${verb}:\n` +
      `  ${shareUrl}\n\n` +
      `  (${size} — ${noun}, annotations added in browser)\n\n`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const pasteHint = options.rawHtml
      ? " HTML sharing uses the paste service; check PLANNOTATOR_PASTE_URL or try a smaller/self-contained HTML file."
      : "";
    process.stderr.write(
      `\n  Warning: could not create remote share link for ${noun}.\n` +
      `  ${reason}.${pasteHint}\n\n`
    );
  }
}
