# PromoBento

**Turn your product or course into a promo video.**

PromoBento 将真实截图、录屏与课程或数字产品素材，制作成可编辑、可按社交平台导出的宣传短片。目标主域为 `promobento.com`。

这是 PromoBento 的初始开发仓库，包含完整 PRD v1.1、配置种子、契约示例、Codex 工作指引和可运行的仓库检查工具。需求说明采用中文，首发产品界面与视频文案采用英语。

## 从这里开始

| 你要做什么 | 入口 |
| --- | --- |
| 阅读完整产品需求 | [PRD 文档索引](docs/prd/README.md) |
| 让 Codex 开始开发 | 先读 [AGENTS.md](AGENTS.md)，再读 [仓库接手指南](docs/getting-started.md) |
| 查看目前完成到哪里 | [实施进度](docs/implementation-status.md) |
| 了解技术、支付与部署 | [技术架构](docs/prd/04-architecture-and-data.md)、[Waffo 支付](docs/prd/05-waffo-billing.md)、[实施顺序](docs/prd/08-codex-execution.md) |
| 查看后续开发决策 | [实施决策记录](docs/implementation-decisions.md) |

## 已确定的产品方向

| 项目 | 决策 |
| --- | --- |
| 品牌与主域 | PromoBento / `promobento.com`；域名配置状态见品牌种子 |
| 第一批用户 A | 创业团队、中小型 SaaS / AI / App / 软件产品团队 |
| 第一批用户 B | 已有课程、数字产品或会员收入的内容团队 |
| 用户闭环 | 真实素材 → 确认事实 → 分镜与手动编辑 → 浏览器预览 → Waffo 付款 → 云端渲染与下载 |
| 前端与开发工具 | React、TypeScript、Vite、React Router、mise、pnpm |
| 部署 | Cloudflare Workers、Static Assets、D1、R2、Queues、Durable Objects、Containers、Workers AI |
| 支付 | Waffo.ai；项目和成片版本计费，详细政策以支付专章为准 |
| 首发平台预设 | TikTok、Instagram Feed、Instagram Reels、X、YouTube、YouTube Shorts |
| 语言 | 从首版建立国际化架构；自有界面与生成视频文案首先只开放英语 |
| 产品界面主题 | System / Light / Dark；独立于成片的 Clean / Bold 样式 |

本表负责导览。精确规则、可配置配额、验收条件及事实来源见 PRD，不在根 README 维护第二份完整规格。

## 当前包含什么

| 路径 | 当前内容 |
| --- | --- |
| `AGENTS.md` | Codex 的阅读顺序、关键边界和完成报告要求 |
| `docs/prd/` | 11 份 Markdown：文档索引与 01–10 完整专章 |
| `config/` | 品牌、语言、主题、平台预设 4 份 JSON 种子 |
| `locales/en.json` | 英语界面消息种子 |
| `contracts/` | 场景与导出清单 2 份 JSON 示例 |
| `docs/getting-started.md` | Git 初始化、导入 GitHub 与 Codex 开工提示词 |
| `docs/implementation-status.md` | M0–M4 的实现及验证状态 |
| `docs/implementation-decisions.md` | 仓库结构和工具版本决策 |
| `docs/evidence/` | 验证记录入口；当前记录的是仓库检查 |
| `scripts/check-repo.mjs` | 无外部依赖的仓库检查工具 |
| `.mise.toml`、`package.json`、`pnpm-lock.yaml` | 已锁定的文档工具版本与检查入口 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 后续实现提交的评审说明模板 |

本次已完成仓库整理。应用开发从 M0 开始：React 页面、Cloudflare 业务服务、视频 renderer 和 Waffo 集成均待实施。未来的 `apps/`、`packages/` 与 `tests/` 在产生真实代码时按 [08 的目录规划](docs/prd/08-codex-execution.md) 建立。

## 当前可运行的检查

本仓库的检查只使用 Node.js 内置模块，不需要安装业务依赖。

```bash
node scripts/check-repo.mjs
```

已固定的文档工具版本为 Node.js `24.19.0`、pnpm `11.25.0`。在相应 pnpm 可用时也可以运行：

```bash
pnpm run check:repo
```

如果使用 mise，在信任本仓库配置并安装已固定工具后运行：

```bash
mise trust
mise install
mise run check:repo
```

检查包括 PRD 清单、仓库相对文件链接、JSON 语法、英语资源引用、平台与构图关系、示例映射以及主题色彩配置。检查结果不代表产品已经通过浏览器、支付、视频编码或生产发布验收。已执行和未执行的命令见 [仓库检查记录](docs/evidence/repository-check.md)。

`dev`、`build`、`test:billing`、`deploy:*` 等应用命令会在 M0–M4 中实现，目前不提供占位成功脚本。

## 用作 GitHub 初始仓库

解压后将 `promobento/` 作为仓库根目录，根层应直接看到本 README 和 AGENTS.md。ZIP 保留可提交的源文件及必要的点文件，Git 历史由你本机初始化。

```bash
cd promobento
git init -b main
git add .
git commit -m "chore: initialize PromoBento repository with PRD"
```

Git 使用你已配置的作者身份。创建远程空仓库后，按 [接手指南](docs/getting-started.md) 添加真实 remote 并推送。建议仓库名为 `promobento`。

## 维护方式

需求的唯一规范来源为 `docs/prd/`；配置和契约种子各保留一份，位于仓库根目录的 `config/`、`locales/`、`contracts/`。运行时代码建立后，由实施决策明确源文件或生成关系，避免手工维护两套相同配置。

外部来源、核查日期和产品假设见 [09 来源与决策](docs/prd/09-sources-and-decisions.md)。实施进度只有在代码与对应证据存在后才更新为完成。
