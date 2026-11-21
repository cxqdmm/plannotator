# 安装说明（汉化 fork · 含工坊）

这是 [backnotprop/plannotator](https://github.com/backnotprop/plannotator) 的汉化 fork：简体中文界面 + 工坊（需求与会话管理面板）。本文写给拿到这个 fork 的人，分**联网安装**和**内网安装**两条路，按自己的机器选一条。

> ⚠️ **不要用上游官方的安装脚本**（`curl … plannotator.ai/install.sh` / `irm … install.ps1`）：它们安装的是**官方英文版**，没有汉化和工坊。本 fork 一律从下面的地址安装。

## 前提

- 已装好 Claude Code，能正常使用；
- 不需要 bun / node（二进制是自包含单文件）。

## 一、联网机器安装

### 第 1 步：下载二进制

打开 <https://github.com/cxqdmm/plannotator/releases>，找最新版本（如 `v0.29.0`），下载对应系统的文件：

| 系统 | 文件 |
| --- | --- |
| Windows（一般电脑） | `plannotator-win32-x64.exe` |
| Windows ARM | `plannotator-win32-arm64.exe` |
| macOS（M 系列） | `plannotator-darwin-arm64` |
| macOS（Intel） | `plannotator-darwin-x64` |
| Linux x64 / ARM | `plannotator-linux-x64` / `plannotator-linux-arm64` |

### 第 2 步：放进 PATH

- **Windows**：把 `plannotator-win32-x64.exe` 改名为 `plannotator.exe`，放到 `C:\Users\<你>\.local\bin`（文件夹没有就新建），并确认这个路径在系统 PATH 里（“环境变量 → Path → 新建”）；
- **macOS / Linux**：改名为 `plannotator`，`chmod +x plannotator` 后移到 `~/.local/bin`。

验证：开一个**新**终端，运行

```
plannotator --version
```

能打印版本号（如 `0.29.0`）即成功。

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

- **二进制**（或它的 `.gz` 压缩版，约 70 MB，到位后解压）；
- **插件包** `plannotator-plugin-<版本>.zip`（**不到 1 MB**）——只含插件本体（市场清单 + hooks/mod），不带源码和构建产物。

插件包在 Release 附件里拿；拿不到时可以自制：建一个文件夹，按下面的结构从仓库复制 4 样东西再压缩即可（目录结构必须一致，`marketplace.json` 里写的插件位置是 `./apps/hook`）：

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
2. 二进制按上面“第 2 步”放进 PATH；
3. 插件 zip 解压到固定位置（如 `D:\tools\plannotator-plugin\plugin`），然后在 Claude Code 里：

   ```
   /plugin marketplace add D:\tools\plannotator-plugin\plugin
   ```

   （写你自己的解压路径——marketplace 支持本地目录，插件文件全从硬盘读，不联网）

   ```
   /plugin install plannotator@plannotator
   ```

   重启 Claude Code；
4. 运行 `plannotator inbox` 打开收件箱/工坊。

## 更新

- 联网机器：去 Releases 下载新版二进制覆盖旧的，Claude Code 里执行 `/plugin marketplace update plannotator` 和 `/plugin update plannotator@plannotator`，重启；
- 内网机器：重复上面的拷贝步骤覆盖即可。

## 常见问题

- **界面上看不到工坊**：工坊在收件箱窗口的侧栏；若侧栏没有，确认装的是本 fork 的二进制（`plannotator --version` 出的版本对应 fork 的 Release），而不是官方版。
- **数据在哪**：全部在本机用户目录下（plans、需求、设置各归其位），不联网、不上传；卸载用 `plannotator uninstall`（默认保留你的数据）。
- **多个 agent**：装好插件后 OpenCode 等其它 agent 的接入见仓库 `apps/hook/README.md`。
