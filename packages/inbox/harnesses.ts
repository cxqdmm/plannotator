/**
 * "Connect an agent": one verified way to add the Inbox's MCP server per
 * harness, from each vendor's docs (read 2026-10-07), in the shape of the
 * Workspaces app's connect-an-agent sheet. Every
 * artefact names the stdio entry with the CLI's absolute path, which the
 * server reports (`mcp_command`), so apps started from the Dock that do not
 * see the shell PATH still find it. Pure.
 */

import { HERMES_APPLIES, HERMES_PLUGIN_INSTALL, HERMES_WAKE_GRANT_LINE } from '@plannotator/core/inbox-hermes';

export type HarnessId =
  | 'claude-code'
  | 'claude-app'
  | 'codex'
  | 'cursor'
  | 'vscode'
  | 'windsurf'
  | 'gemini'
  | 'antigravity'
  | 'qwen'
  | 'goose'
  | 'amp'
  | 'cline'
  | 'pi'
  | 'opencode'
  | 'dsh'
  | 'openclaw'
  | 'hermes'
  | 'zed'
  | 'kiro'
  | 'muse'
  | 'jetbrains'
  | 'other';

export interface Harness {
  id: HarnessId;
  label: string;
}

/** The picker's order (the research record's), Claude Code first. */
export const HARNESSES: readonly Harness[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-app', label: 'Claude 应用' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'windsurf', label: 'Windsurf / Devin' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'qwen', label: 'Qwen Code' },
  { id: 'goose', label: 'Goose' },
  { id: 'amp', label: 'Amp' },
  { id: 'cline', label: 'Cline' },
  { id: 'pi', label: 'Pi' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'dsh', label: 'DeepSeek Harness' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'hermes', label: 'Hermes Agent' },
  { id: 'zed', label: 'Zed' },
  { id: 'kiro', label: 'Kiro' },
  { id: 'muse', label: 'Muse Code' },
  { id: 'jetbrains', label: 'JetBrains' },
  { id: 'other', label: '其他 MCP 客户端' },
];

/** The empty state's "Any other agent" tabs: the three Plannotator hosts have their own cards above. */
export const OTHER_HARNESSES: readonly Harness[] = HARNESSES.filter(
  (h) => h.id !== 'claude-code' && h.id !== 'pi' && h.id !== 'opencode',
);

export type Artefact =
  | { kind: 'code'; text: string; label?: string }
  | { kind: 'link'; label: string; href: string };

/** What a selected tab shows: the artefact, one short note, and the folded "Another way". */
export interface HarnessPanel {
  artefacts: Artefact[];
  note?: string;
  another?: { summary: string; body?: Artefact };
}

export interface ConnectContext {
  /** The stdio entry as argv: `[<absolute CLI>, "inbox", "mcp"]`. */
  command: readonly string[];
  /** `http://127.0.0.1:<port>/mcp`. */
  mcpUrl: string;
  /** For the Claude app's config path. */
  platform: 'mac' | 'windows' | 'linux';
}

const SERVER = 'plannotator-inbox';
/** Plannotator's Cline plugin package (npm: @plannotator/cline). */
const CLINE_PLUGIN = '@plannotator/cline';
/** Plannotator's DeepSeek Harness plugin package (npm: @plannotator/dsh). */
const DSH_PLUGIN = '@plannotator/dsh';
const OPENCLAW_PLUGIN = '@plannotator/openclaw';

/** When a DSH tool switch takes effect: the plugin decides once, when DSH starts, never per session. */
export const DSH_APPLIES = '下次启动 DeepSeek Harness 时生效。';

/** When Cline's tool switch takes effect: the plugin decides at each session's setup, never in a running one. */
export const CLINE_APPLIES = '从现在起启动的 Cline 会话都会生效。';

export const OPENCLAW_APPLIES = '每个 OpenClaw 聊天的下一条消息起生效。';

/** POSIX single-quoting where a word needs it; plain words stay bare. */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9_\-./:=@%+,~]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

export function shellLine(words: readonly string[]): string {
  return words.map(shellWord).join(' ');
}

function stdio(ctx: ConnectContext): { command: string; args: string[] } {
  const [command = 'plannotator', ...args] = ctx.command;
  return { command, args };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function mcpServersSnippet(ctx: ConnectContext): string {
  return json({ mcpServers: { [SERVER]: stdio(ctx) } });
}

/** base64 of UTF-8 text, browser and Bun alike. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Cursor's documented install link: the single server's JSON, base64, no mcpServers wrapper. */
export function cursorInstallLink(ctx: ConnectContext): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER}&config=${encodeURIComponent(base64(JSON.stringify(stdio(ctx))))}`;
}

/** VS Code's documented install link: `{ name, ...server config }`, URI-encoded. */
export function vscodeInstallLink(ctx: ConnectContext): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER, type: 'stdio', ...stdio(ctx) }))}`;
}

/** Goose's documented extension link: `cmd` plus one `arg` per argument. */
export function gooseInstallLink(ctx: ConnectContext): string {
  const { command, args } = stdio(ctx);
  const params = [`cmd=${encodeURIComponent(command)}`, ...args.map((a) => `arg=${encodeURIComponent(a)}`)];
  params.push(`id=${SERVER}`, 'name=Plannotator%20Inbox', 'description=Plannotator%20Inbox', 'timeout=300');
  return `goose://extension?${params.join('&')}`;
}

/** What "Use MCP instead" reveals under each Plannotator host's card. */
export function hostMcpSnippet(host: 'claude-code' | 'pi' | 'opencode', ctx: ConnectContext): string {
  const cmd = shellLine(ctx.command);
  if (host === 'claude-code') return `claude mcp add --scope user ${SERVER} -- ${cmd}`;
  if (host === 'pi') return `pi mcp add ${SERVER} -- ${cmd}`;
  return `opencode.json: "mcp": { "${SERVER}": { "type": "local", "command": ${JSON.stringify([...ctx.command])}, "enabled": true } }`;
}

export function harnessPanel(id: HarnessId, ctx: ConnectContext): HarnessPanel {
  const cmd = shellLine(ctx.command);
  switch (id) {
    case 'claude-code':
      return {
        artefacts: [{ kind: 'code', text: hostMcpSnippet('claude-code', ctx) }],
        note: '使用 Plannotator 的 Claude Code 插件时不需要这样做，它的 mod 已经会写入这里。',
        another: {
          summary: 'HTTP 地址',
          body: { kind: 'code', text: `claude mcp add --scope user --transport http ${SERVER} ${ctx.mcpUrl}` },
        },
      };
    case 'claude-app':
      return {
        artefacts: [
          {
            kind: 'code',
            label:
              ctx.platform === 'windows'
                ? '%APPDATA%\\Claude\\claude_desktop_config.json'
                : '~/Library/Application Support/Claude/claude_desktop_config.json',
            text: mcpServersSnippet(ctx),
          },
        ],
        note: '将它合并到 Claude > Settings > Developer > Edit Config 中的 mcpServers，然后退出并重新打开 Claude。claude.ai 连接器无法访问这台计算机。',
      };
    case 'codex':
      return {
        artefacts: [{ kind: 'code', text: `codex mcp add ${SERVER} -- ${cmd}` }],
        note: '也会把它添加到 Codex 应用和 IDE 扩展。之后请重启它们。使用 Codex 0.149 或更高版本时，你的回复会自动回到 Codex 会话中。',
        another: { summary: '在 Codex 应用中：Settings > MCP servers > Add server > STDIO，然后重启' },
      };
    case 'cursor':
      return {
        artefacts: [{ kind: 'link', label: '添加到 Cursor', href: cursorInstallLink(ctx) }],
        note: '会打开 Cursor，添加服务器前它会先询问。',
        another: { summary: '自行添加到 ~/.cursor/mcp.json', body: { kind: 'code', label: '~/.cursor/mcp.json', text: mcpServersSnippet(ctx) } },
      };
    case 'vscode':
      return {
        artefacts: [{ kind: 'link', label: '安装到 VS Code', href: vscodeInstallLink(ctx) }],
        note: '会打开 VS Code，服务器首次启动时它会请求你信任。',
        another: {
          summary: '在终端运行 code --add-mcp',
          body: { kind: 'code', text: `code --add-mcp ${shellWord(JSON.stringify({ name: SERVER, type: 'stdio', ...stdio(ctx) }))}` },
        },
      };
    case 'windsurf':
      return {
        artefacts: [{ kind: 'code', text: `devin mcp add -s user ${SERVER} -- ${cmd}` }],
        note: '会将它添加到每个项目中的 Devin Desktop（原 Windsurf）。',
        another: {
          summary: '自行添加到 ~/.config/devin/config.json',
          body: { kind: 'code', label: '~/.config/devin/config.json', text: mcpServersSnippet(ctx) },
        },
      };
    case 'gemini':
      return {
        artefacts: [{ kind: 'code', text: `gemini mcp add -s user ${SERVER} ${cmd}` }],
        note: '会将它添加到每个项目中的 Gemini CLI。',
      };
    case 'antigravity':
      return {
        artefacts: [{ kind: 'code', label: '~/.gemini/config/mcp_config.json', text: mcpServersSnippet(ctx) }],
        note: '将它合并到 mcpServers。Antigravity 应用、IDE 和 agy 都会读取这个文件；请重启应用或 IDE。',
      };
    case 'qwen':
      // After NonoElRobot's fork (c6a02a0): the settings.json entry. Not `qwen mcp add`: it writes the
      // other servers back with their ${VAR} values filled in, so a token kept in the environment lands in the file.
      return {
        artefacts: [{ kind: 'code', label: '~/.qwen/settings.json', text: mcpServersSnippet(ctx) }],
        note: '将它合并到 Qwen Code 的 settings.json 中的 mcpServers（设置 QWEN_HOME 时为 $QWEN_HOME/settings.json）。它会在每个项目中生效。',
      };
    case 'goose':
      return {
        artefacts: [{ kind: 'link', label: '添加到 Goose', href: gooseInstallLink(ctx) }],
        note: '会打开 Goose 以添加扩展。',
        another: {
          summary: '在 Goose 中：Extensions > Add custom extension > Standard IO，使用此命令',
          body: { kind: 'code', text: cmd },
        },
      };
    case 'amp':
      return {
        artefacts: [{ kind: 'code', text: `amp mcp add ${SERVER} -- ${cmd}` }],
        note: '请在终端中运行。',
      };
    case 'cline':
      // Plannotator's Cline plugin: its tool, and replies as turns; over MCP alone nothing can wake a Cline session.
      return {
        artefacts: [{ kind: 'code', text: `cline plugin install npm:${CLINE_PLUGIN}` }],
        note: 'Plannotator 的 Cline 插件。它的收件箱工具默认关闭：请在“设置 > agent”中为 Cline 开启。之后你的回复会自动回到每个 Cline 会话中。',
        another: {
          summary: '不使用插件、在 Cline 扩展中：MCP Servers > Configure > Configure MCP Servers，然后粘贴此内容',
          body: { kind: 'code', text: mcpServersSnippet(ctx) },
        },
      };
    case 'pi':
      return {
        artefacts: [{ kind: 'code', text: hostMcpSnippet('pi', ctx) }],
        note: '然后在正在运行的 Pi 会话中执行 /reload。',
      };
    case 'opencode':
      return {
        artefacts: [
          {
            kind: 'code',
            label: 'opencode.json',
            text: json({ $schema: 'https://opencode.ai/config.json', mcp: { [SERVER]: { type: 'local', command: [...ctx.command], enabled: true } } }),
          },
        ],
        note: '使用项目的 opencode.json 或 ~/.config/opencode/opencode.json。',
      };
    case 'dsh':
      // Plannotator's DSH plugin, not MCP: DSH's MCP client strips every DSH_* variable and sends no session,
      // so over MCP the Inbox cannot tell which DSH session wrote, and a reply can never wake it.
      return {
        artefacts: [{ kind: 'code', text: `dsh plugin --profile <profile> add ${DSH_PLUGIN}` }],
        note: `Plannotator 的 DeepSeek Harness 插件。它的收件箱工具默认关闭：请在“设置 > agent”中为 DeepSeek Harness 开启。${DSH_APPLIES}之后你的回复会自动回到每个 DeepSeek Harness 会话中。`,
        another: {
          // A summary is a label: no comma (house rule, tests/e2e/inbox.spec.ts). Wording: the owner's (#2529).
          summary: 'DSH Desktop：运行此命令前先打开并退出一次',
          body: { kind: 'code', text: `dsh plugin --profile desktop add ${DSH_PLUGIN}` },
        },
      };
    case 'openclaw':
      return {
        artefacts: [{ kind: 'code', text: `openclaw plugins install ${OPENCLAW_PLUGIN}` }],
        note: `Plannotator 的 OpenClaw 插件。它的收件箱工具默认关闭：请在“设置 > agent”中为 OpenClaw 开启。${OPENCLAW_APPLIES}只有你自己的聊天会获得它：这台计算机上的 OpenClaw 和你的私信，绝不包括群组。之后你的回复会自动回到同一个聊天中。`,
      };
    case 'hermes':
      return {
        artefacts: [
          { kind: 'code', text: HERMES_PLUGIN_INSTALL },
          { kind: 'code', text: HERMES_WAKE_GRANT_LINE },
        ],
        note: `Plannotator 的 Hermes Agent 插件，以及 Hermes 允许它用你的回复开启一轮对话的权限。它的收件箱工具默认关闭：请在“设置 > agent”中为 Hermes Agent 开启。${HERMES_APPLIES}之后你的回复会回到发起询问的 Hermes 会话：终端、TUI、桌面应用或你的私信。`,
      };
    case 'zed':
      return {
        artefacts: [{ kind: 'code', label: '~/.config/zed/settings.json', text: json({ context_servers: { [SERVER]: { ...stdio(ctx), env: {} } } }) }],
        note: '将它合并到 Zed 的 settings.json。',
        another: { summary: '在 Zed 中：Settings > AI > MCP Servers > Add Server' },
      };
    case 'kiro':
      return {
        artefacts: [{ kind: 'code', label: '~/.kiro/settings/mcp.json', text: mcpServersSnippet(ctx) }],
        note: 'Kiro 无需重启即可读取。',
      };
    case 'muse':
      return {
        artefacts: [{ kind: 'code', text: `muse mcp add ${SERVER} -- ${cmd}` }],
        note: '请在终端中运行，然后在 Muse 信任的文件夹中启动新的 Muse Code 会话：它只在那里启动 MCP 服务器。回复不会唤醒 Muse Code：它会在下次检查收件箱时读取。',
      };
    case 'jetbrains':
      return {
        artefacts: [{ kind: 'code', text: mcpServersSnippet(ctx) }],
        note: '粘贴到 Settings | Tools | AI Assistant | Model Context Protocol (MCP) > Add。',
      };
    case 'other':
      return {
        artefacts: [
          { kind: 'code', label: '命令（stdio）', text: cmd },
          { kind: 'code', label: '地址（Streamable HTTP）', text: ctx.mcpUrl },
        ],
        note: '优先使用命令：收件箱重启时端口可能会变化。',
      };
  }
}
