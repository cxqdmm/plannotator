#!/usr/bin/env node
/**
 * 生成最小插件包（fork 分发用，INSTALL.zh-CN.md 内网安装的那半）。
 *
 * 插件本体只有市场清单 + hooks/mod（约 1.5 MB）；服务端与界面都在二进制里，
 * 源码和构建产物一概不需要。本脚本从当前仓库摘出这 4 样，按 marketplace.json
 * 认识的目录结构（./apps/hook）摆好，压成一个 zip：
 *
 *   plugin/
 *   ├── .claude-plugin/marketplace.json   ← 仓库根 .claude-plugin/
 *   └── apps/hook/
 *       ├── .claude-plugin/plugin.json    ← 仓库 apps/hook/.claude-plugin/
 *       ├── package.json                  ← 仓库 apps/hook/
 *       └── hooks/                        ← 仓库 apps/hook/hooks/
 *
 * 运行：bun scripts/plugin-package.mjs [输出目录]   （bun run package:plugin 同）
 * 默认输出到主仓库上级的 plannotator-local-builds/<插件版本>/（与本地打包的二进制放一起；
 * 在 worktree 里运行也会定位到主仓库旁边）。
 *
 * zip 由本文件内的最小打包器（node:zlib 的 deflate + 手写 ZIP 结构）生成：
 * 零依赖，Windows/macOS/Linux 一致。
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 主仓库根：worktree 里运行时，git 公共目录在主仓库的 .git 下。 */
const mainRepoRoot = () => {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: here, windowsHide: true, encoding: "utf8" }).trim();
    return dirname(gitDir.endsWith(".git") ? gitDir : join(gitDir, ".."));
  } catch {
    return here;
  }
};

/** 插件要带的 4 样东西：[仓库内来源, 包内目标]。 */
const PARTS = [
  [join(here, ".claude-plugin", "marketplace.json"), join(".claude-plugin", "marketplace.json")],
  [join(here, "apps", "hook", ".claude-plugin", "plugin.json"), join("apps", "hook", ".claude-plugin", "plugin.json")],
  [join(here, "apps", "hook", "package.json"), join("apps", "hook", "package.json")],
  [join(here, "apps", "hook", "hooks"), join("apps", "hook", "hooks")],
];

// ── 最小 ZIP 打包器（方法 8 deflate；时间戳固定为 2020-01-01，产物可复现） ──
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
/** 把 base 目录整树压成一个 zip 文件；条目名 = `<prefix>/<base 内相对路径>`（/ 分隔）。 */
const zipTree = (base, outFile, prefix) => {
  const dosTime = 0, dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1; // 2020-01-01 00:00
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of walk(base).sort()) {
    const name = `${prefix}/${relative(base, file).split(sep).join("/")}`;
    const raw = readFileSync(file);
    const deflated = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(Buffer.byteLength(name), 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, Buffer.from(name, "utf8"), data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(Buffer.byteLength(name), 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, Buffer.from(name, "utf8"));
    offset += local.length + Buffer.byteLength(name) + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length ? 0 : 0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(walk(base).length, 8);
  end.writeUInt16LE(walk(base).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(outFile, Buffer.concat([...chunks, dir, end]));
};

// ── 组装 ──
const { version } = JSON.parse(readFileSync(join(here, "apps", "hook", ".claude-plugin", "plugin.json"), "utf8"));
const outRoot = resolve(process.argv[2] ?? join(mainRepoRoot(), "..", "plannotator-local-builds", `v${version}`));
const tree = join(outRoot, "plugin");
const zip = join(outRoot, `plannotator-plugin-${version}.zip`);

rmSync(tree, { recursive: true, force: true });
for (const [from, to] of PARTS) {
  const target = join(tree, to);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(from, target, { recursive: true });
}

zipTree(tree, zip, "plugin");
const mb = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(2)} MB`;
console.log(`插件包：${zip}（${mb(zip)}，含 ${walk(tree).length} 个文件）`);
console.log(`未压缩目录（结构即装即用）：${tree}`);
console.log("内网安装：解压后对解压出的 plugin 目录 /plugin marketplace add <它的路径>，再 /plugin install plannotator@plannotator");
