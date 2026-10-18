# 仓库接手指南

本文说明如何使用当前仓库、将源文件导入 GitHub，以及让 Codex 开始应用开发。产品需求从 [PRD 索引](prd/README.md) 阅读。

## 1 解压与根目录

解压仓库 ZIP 后，进入 `promobento/`。根目录直接包含 `README.md`、`AGENTS.md`、`package.json`、`.mise.toml`、`docs/` 和 `scripts/`。不要把整个外层目录再次嵌套成远程仓库里的 `promobento/promobento/`。

交付 ZIP 包含源文件和必要的点文件，不包含 `.git/`、本机路径、凭据、依赖缓存或虚构的应用构建产物。通过命令行 `git add .` 可一并纳入 `.mise.toml` 等文件。

## 2 执行当前仓库检查

当前只需要 Node.js；已验证的版本为 `24.19.0`。检查脚本没有 npm 依赖，因此最直接的方式是：

```bash
node scripts/check-repo.mjs
```

如果已经有本仓库固定的 pnpm `11.25.0`，可以使用同一任务入口：

```bash
pnpm run check:repo
```

使用 mise 时先查看根 `.mise.toml`，再在你自己的环境中信任并安装其固定工具：

```bash
mise trust
mise install
mise run check:repo
```

本次交付环境执行了 Node/pnpm 入口；mise CLI 的安装与任务执行状态见 [实际检查记录](evidence/repository-check.md)。配置中的精确版本目前用于仓库工具，应用兼容性需在 M0 核查。

根 `package.json` 仅定义真实存在的仓库检查，不是 React 应用入口。`pnpm-lock.yaml` 由当前 pnpm 生成；M0 初始化应用和工作区后再更新依赖与锁文件。

## 3 初始化 Git

在解压后的仓库根目录运行：

```bash
git init -b main
git add .
git commit -m "chore: initialize PromoBento repository with PRD"
```

提交使用你的 Git 作者配置。如果 Git 提示缺少作者信息，按你希望显示在提交中的真实身份，在该仓库配置 `user.name` 与 `user.email` 后重试。无需使用交付环境的作者信息。

## 4 推送到 GitHub

创建一个名为 `promobento` 的空仓库。为了让第一次推送保持简单，创建页面上不要同时生成另一份 README 或初始提交。仓库可见性由你的项目安排决定。

将下面的 `YOUR_GITHUB_OWNER` 替换为实际个人或组织名，再在本地执行：

```bash
git remote add origin https://github.com/YOUR_GITHUB_OWNER/promobento.git
git push -u origin main
```

如果你导入的远程仓库已有内容，应先检查其历史与现有文件，再合并本目录，保留已有工作。本次仓库包不包含既定的远程地址。

## 5 交给 Codex 的开工提示词

在 Codex 打开这个仓库后，可以直接使用以下任务：

```text
请在当前仓库实现 PromoBento P0。

先完整阅读根 AGENTS.md、README.md、docs/prd/README.md 和相关 PRD 专章，
以 docs/prd/08-codex-execution.md 的 M0–M4 顺序推进。

已确定的决策：
- PromoBento / promobento.com。
- 软件产品团队与已有课程或数字产品收入的内容团队同时作为首批用户。
- React、TypeScript、Vite、React Router、mise、pnpm。
- Cloudflare 全栈部署，Waffo.ai 支付。
- 六个平台预设全部在 P0；真实素材、确认事实、共享浏览器预览与云端渲染。
- 从首版建立国际化架构；自有 UI 与生成视频文案只开放英语。
- System / Light / Dark 属于 P0，网站主题与视频内容、计费独立。

当前仓库只有完整规格、配置种子、契约示例和仓库检查工具。
从 M0 建立真实应用代码与运行命令；先证明 Cloudflare 渲染和 Waffo test 的可行性，
再推进编辑器、账务、交付、团队和运营。复用已有配置，避免制造两套权威来源。

核查官方兼容性并锁定实际依赖版本，建立 pnpm 工作区、必要迁移、环境示例和测试。
把实际实现与执行证据更新到 docs/implementation-status.md、
docs/implementation-decisions.md 和 docs/evidence/。

缺少外部账户或凭据时，明确记录受影响的真实验证，继续完成不依赖它的工作。
每次汇报列出已实现功能、未实现 P0、实际运行的命令与环境、尚未完成的外部验证。
不要把静态页面、模拟付款或空测试脚本报告为完整 SaaS 已完成。
```

## 6 M0 的具体出口

M0 的应用工作至少包括：初始化受支持的 Cloudflare React Router 工程并锁版本，建立英语 SSR、主题 Cookie/CSS 与配置基础，连接 D1/R2，在目标 Cloudflare 环境通过单场景容器生成 30 秒 MP4，并验证 Waffo test checkout、签名和查询。精确出口与其余阶段见 [08](prd/08-codex-execution.md)。

当前仓库的检查命令与 M0 的真实环境验证分别记录。开发账号尚未配置时，状态保持未验证，不填写虚构的资源 ID 或成功结果。
