# 安装说明（汉化 fork · 含工坊）

这是 [backnotprop/plannotator](https://github.com/backnotprop/plannotator) 的汉化 fork：简体中文界面 + 工坊（需求与会话管理面板）。本文写给拿到这个 fork 的人：**联网机器看一，内网机器看二**；用 OpenCode 的同学再看**三**。Windows 和 macOS 的步骤都分别写明，照自己系统的那部分做。

> ⚠️ **不要用上游官方的安装脚本**（`curl … plannotator.ai/install.sh` / `irm … install.ps1`）：它们安装的是**官方英文版**，没有汉化和工坊。本 fork 一律从下面的地址安装。

## 前提

- 已装好 Claude Code（只用 OpenCode 的同学：前提是同样的第 2 步——二进制进 PATH）；
- 不需要 bun / node（二进制是自包含单文件）。

## 一、联网机器安装（Claude Code）

### 第 1 步：下载二进制

打开 <https://github.com/cxqdmm/plannotator/releases>，找最新版本（如 `v0.29.0`）：

| 系统 | 直接下载 | 传输省流量的选择 |
| --- | --- | --- |
| Windows（一般电脑） | `plannotator-win32-x64.exe` | 同名的 `.gz`（约 82 MB，解压即用） |
| Windows ARM | `plannotator-win32-arm64.exe` | 同名的 `.gz` |
| macOS（M 系列） | `plannotator-darwin-arm64` | 同名的 `.tar.xz`（仅约 43 MB） |
| macOS（Intel） | `plannotator-darwin-x64` | 同名的 `.tar.xz`（约 47 MB） |

（每个文件旁都有同名 `.sha256` 校验和；mac 压缩包解压 `tar -xJf 文件名`，Windows 的 `.gz` 解压 `tar -xf 文件名`——Windows 10+ 自带 tar。）

### 第 2 步：放进 PATH

**Windows**：

1. 把 `plannotator-win32-x64.exe` 改名为 `plannotator.exe`；
2. 放到 `C:\Users\<你>\.local\bin`（文件夹没有就新建）；
3. 把这个路径加进系统 PATH：开始菜单搜“环境变量” → 编辑你的 Path → 新建 → 填 `C:\Users\<你>\.local\bin` → 一路确定。

**macOS**：

```bash
mv plannotator-darwin-arm64 plannotator        # Intel 机器换成 darwin-x64 那个
chmod +x plannotator
mkdir -p ~/.local/bin && mv plannotator ~/.local/bin/
# ~/.local/bin 不在 PATH 时（终端里 echo $PATH 看一眼），补一行进 zsh 配置：
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
# 浏览器下载的文件带隔离标记，首次运行会被 Gatekeeper 拦，先摘掉：
xattr -d com.apple.quarantine ~/.local/bin/plannotator
```

**验证（两个系统一样）**：开一个**新**终端，运行 `plannotator --version`，能打印版本号（如 `0.29.0`）即成功。

### 第 3 步：安装 Claude Code 插件

在 Claude Code 对话框里依次输入（`plannotator@plannotator` 的意思是“从名为 plannotator 的市场装名为 plannotator 的插件”，市场在第 1 条命令里已指向本 fork）：

```
/plugin marketplace add cxqdmm/plannotator
```

```
/plugin install plannotator@plannotator
```

然后**重启 Claude Code**。

### 第 4 步：打开收件箱（工坊在里面）

```
plannotator inbox
```

浏览器会打开收件箱窗口（本机地址，默认 65455 端口）；侧栏里的**工坊**就是需求/会话管理面板。之后 plan review、code review 等能力会在 Claude Code 工作时自动带出。

## 二、内网机器安装（访问不了 GitHub）

只需要拷两个文件，全程不访问外网：

- **二进制**（建议拷压缩版：Windows 拿 `.gz` 约 82 MB、mac 拿 `.tar.xz` 约 43–47 MB，解压命令见上）；
- **插件包** `plannotator-plugin-<版本>.zip`（**不到 1 MB**）——只含插件本体（市场清单 + hooks/mod），不带源码和构建产物。

插件包在 Release 附件里拿；拿不到时自制——仓库里一条命令（在仓库根目录）：

```
bun run package:plugin
```

它按下面的结构从仓库摘 4 样东西、压成 `plannotator-plugin-<版本>.zip`，放到仓库旁边的 `plannotator-local-builds/v<版本>/`（目录结构必须一致，`marketplace.json` 里写的插件位置是 `./apps/hook`）：

```
plugin/
├── .claude-plugin/marketplace.json        ← 仓库根 .claude-plugin/
└── apps/hook/
    ├── .claude-plugin/plugin.json         ← 仓库 apps/hook/.claude-plugin/
    ├── package.json                       ← 仓库 apps/hook/
    └── hooks/                             ← 仓库 apps/hook/hooks/（约 1.5 MB）
```

安装步骤：

1. 两个文件用 U 盘 / 内网共享拷到内网机器；
2. 二进制解压后按上面“第 2 步”放进 PATH（Windows/macOS 步骤同前）；
3. 插件 zip 解压到固定位置，然后在 Claude Code 里执行 `/plugin marketplace add <解压出的 plugin 目录>`。两个系统的例子：

   **Windows**（解压到 `D:\tools\`，得到 `D:\tools\plugin`）：

   ```
   /plugin marketplace add D:\tools\plugin
   ```

   **macOS**（解压到 `~/tools/`，得到 `~/tools/plugin`）：

   ```
   /plugin marketplace add /Users/<你>/tools/plugin
   ```

   （写你自己的实际路径——marketplace 支持本地目录，插件文件全从硬盘读，不联网）

   再执行 `/plugin install plannotator@plannotator`，**重启 Claude Code**；
4. 运行 `plannotator inbox` 打开收件箱/工坊。

## 三、OpenCode 的接入（含内网）

前提：`plannotator` 二进制已按“第 2 步”进 PATH。OpenCode 的插件**不走 Claude Code 的 marketplace**，也不从 npm 装（npm 上的 `@plannotator/opencode` 是上游英文包），而是在 `opencode.json` 里把插件指到**本地文件夹**——联网内网都一样，文件夹拷过去就行。

**要拷的东西**：`plannotator-opencode-plugin-<版本>` 文件夹（Release 附件或 `plannotator-local-builds/v<版本>/` 里的 zip，约 17 MB，解压即得）。

### Windows 上的接法

1. 插件 zip 解压到固定位置，如 `D:\tools\`，得到 `D:\tools\plannotator-opencode-plugin-0.29.0`；
2. 编辑 OpenCode 的全局配置 `%USERPROFILE%\.config\opencode\opencode.json`（没有就新建）：

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       { "package": "D:\\tools\\plannotator-opencode-plugin-0.29.0" }
     ]
   }
   ```

   注意 **JSON 里 Windows 路径要双反斜杠** `\\`；想要计划工作流可在里面对象加 `"options": { "workflow": "plan-agent" }`；
3. 重启 OpenCode（或运行 `opencode2 reload`），`opencode2 plugin list` 里出现 plannotator 即成功。

### macOS 上的接法

1. 插件 zip 解压到固定位置，如 `~/tools/`：

   ```bash
   mkdir -p ~/tools && tar -xf plannotator-opencode-plugin-0.29.0.zip -C ~/tools
   #（或直接双击 zip 用归档实用工具解压）
   ```

2. 编辑 `~/.config/opencode/opencode.json`（没有就新建）：

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       { "package": "/Users/<你>/tools/plannotator-opencode-plugin-0.29.0" }
     ]
   }
   ```

   mac 路径用正斜杠 `/`，**不需要**转义；
3. 重启 OpenCode（或 `opencode2 reload`），`opencode2 plugin list` 里出现 plannotator 即成功。

### 版本差异与再生产

- **OpenCode 1** 的字段名不同：`"plugin": ["<同上路径>"]`（数组里直接放路径字符串），其余步骤一样；
- 插件文件夹的再生产：仓库里 `bun run build:opencode` 后，按 `apps/opencode-plugin/package.json` 的 `files` 清单把 dist、commands、skills、scripts、plannotator.html、review-editor.html、diagram-engine 拷出来（约 64 MB）。里面内嵌的界面页就是汉化版——这正是不用 npm 包的原因。

## 更新

- 联网机器：去 Releases 下载新版二进制覆盖旧的；Claude Code 里执行 `/plugin marketplace update plannotator` 和 `/plugin update plannotator@plannotator`，重启；OpenCode 的插件文件夹整个换成新版，并把 `opencode.json` 里的路径改成新版本号；
- 内网机器：重复上面的拷贝步骤覆盖即可（mac 别忘了更新后再执行一次 `xattr` 命令）。

## 常见问题

- **界面上看不到工坊**：工坊在收件箱窗口的侧栏；若侧栏没有，确认装的是本 fork 的二进制（`plannotator --version` 出的版本对应 fork 的 Release），而不是官方版。
- **mac 首次运行被拦**（“无法验证开发者”或文件被隔离）：见第 2 步的 `xattr` 命令；二进制每次更新后都要再执行一次。
- **数据在哪**：全部在本机用户目录下（plans、需求、设置各归其位），不联网、不上传；卸载用 `plannotator uninstall`（默认保留你的数据）。
