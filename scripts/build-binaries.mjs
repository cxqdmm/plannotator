#!/usr/bin/env node
/**
 * 本地出全套装机包（Windows + macOS 两平台，fork 的分发范围；与 CI release.yml 同款命令）：
 *
 *   1. 构建 UI（bun run build:review + bun --bun run build:hook；--no-build 可跳过，用现成 dist）；
 *   2. 交叉编译 4 个单文件二进制（bun --compile，arm64 约十来分钟属正常）：
 *        plannotator-win32-x64.exe / plannotator-win32-arm64.exe
 *        plannotator-darwin-arm64  / plannotator-darwin-x64
 *   3. 每个出 .sha256 校验和；全部出 .gz 压缩副本，mac 两个再出 .tar.xz（流量最省，~45 MB）；
 *   4. 产物放 <主仓库旁>/plannotator-local-builds/v<版本>/（与 package:plugin 同一目录）。
 *
 * 运行：bun run package:binaries [--no-build] [输出目录]
 * 不编 paste 辅助程序与 Linux 目标——那是上游发版的范围。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 真 bun 可执行文件（脚本正跑在它里面）：Windows 上 PATH 里的 "bun" 可能是 .cmd 垫片，
 *  它无法安全接收带引号的 --define 参数（cmd.exe 特殊字符限制），必须直呼真身。 */
const BUN = process.execPath;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, windowsHide: true, stdio: "inherit", ...opts });

const mainRepoRoot = () => {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, windowsHide: true, encoding: "utf8" }).trim();
    return dirname(gitDir.endsWith(".git") ? gitDir : join(gitDir, ".."));
  } catch {
    return root;
  }
};

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const outArg = args.find((a) => !a.startsWith("--"));
const outDir = resolve(outArg ?? join(mainRepoRoot(), "..", "plannotator-local-builds", `v${version}`));
mkdirSync(outDir, { recursive: true });

/** 与 release.yml 相同的目标清单（fork：仅 Windows + macOS）。 */
const TARGETS = [
  ["plannotator-win32-x64.exe", "bun-windows-x64-baseline"],
  ["plannotator-win32-arm64.exe", "bun-windows-arm64"],
  ["plannotator-darwin-arm64", "bun-darwin-arm64"],
  ["plannotator-darwin-x64", "bun-darwin-x64"],
];

// 1. UI（hook 在部分平台要 --bun 才不落给系统 Node——见仓库 CLAUDE/记忆的构建坑）
if (!skipBuild) {
  console.log(`[1/3] 构建 UI（review → hook）…`);
  run(BUN, ["run", "build:review"]);
  run(BUN, ["--bun", "run", "build:hook"]);
} else {
  if (!existsSync(join(root, "apps", "hook", "dist", "inbox.html"))) throw new Error("--no-build：但 apps/hook/dist 不存在，先去掉该参数完整跑一次。");
  console.log(`[1/3] 跳过构建（--no-build），使用现成 dist。`);
}

// 2. 交叉编译
console.log(`[2/3] 交叉编译 v${version} 的 4 个目标（Windows ×2 + macOS ×2）…`);
for (const [file, target] of TARGETS) {
  const started = Date.now();
  process.stdout.write(`  ${file} … `);
  execFileSync(BUN, [
    "build", "apps/hook/server/index.ts", "--compile", "--no-compile-autoload-bunfig",
    `--target=${target}`,
    `--define`, `__CLI_VERSION__="${version}"`,
    "--define", "__PLANNOTATOR_RELEASE__=true",
    "--outfile", join(outDir, file),
  ], { cwd: root, windowsHide: true });
  console.log(`${(statSync(join(outDir, file)).size / 1048576).toFixed(1)} MB，${Math.round((Date.now() - started) / 1000)}s`);
}

// 3. 校验和 + 压缩副本（.gz 全部；mac 再出 .tar.xz）
console.log(`[3/3] 校验和与压缩副本 → ${outDir}`);
for (const [file] of TARGETS) {
  const bytes = readFileSync(join(outDir, file));
  writeFileSync(join(outDir, `${file}.sha256`), `${createHash("sha256").update(bytes).digest("hex")} *${file}\n`);
  writeFileSync(join(outDir, `${file}.gz`), gzipSync(bytes, { level: 9 }));
}
const tar = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "/usr/bin/tar"; // 系统 bsdtar（内建 xz）；避开 PATH 里 Git 的 GNU tar
for (const [file] of TARGETS.filter(([f]) => !f.endsWith(".exe"))) {
  execFileSync(tar, ["-cJf", join(outDir, `${file}.tar.xz`), file], { cwd: outDir, windowsHide: true });
}
rmSync(join(outDir, "plannotator-darwin-arm64.gz"), { force: true }); // mac 以 .tar.xz 为省流版本，.gz 不留双份
rmSync(join(outDir, "plannotator-darwin-x64.gz"), { force: true });
console.log(`完成：${outDir}`);
for (const [file] of TARGETS) {
  const line = (n) => (existsSync(join(outDir, n)) ? `   ${n.padEnd(42)} ${(statSync(join(outDir, n)).size / 1048576).toFixed(1)} MB` : null);
  console.log([line(file), line(`${file}.gz`), line(`${file}.tar.xz`)].filter(Boolean).join("\n"));
}
console.log(`插件包配套：bun run package:plugin`);
