# PromoBento

**Turn your product or course into a promo video.**

PromoBento 用 AI Director 与 Coding Agent 将真实截图、录屏和产品素材创作成自由动画 Composition，并可点选修改、按平台预设导出宣传短片。目标主域为 `promobento.com`。

这是 PromoBento 的初始开发仓库，包含整合后的 PRD v2.2（继承 v1.4 业务/认证/语言与 UI 规则）、UI 规范与可视化参考、路由与认证配置、契约示例、Codex 工作指引和可运行的仓库工具。需求说明采用中文；网站首发英语并预留网站多语言能力。用户文案可使用任意语言或混排，不需要选择视频语言。

## 从这里开始

| 你要做什么 | 入口 |
| --- | --- |
| 阅读完整产品需求 | [PRD 文档索引](docs/prd/README.md)、[13 AI 视频创作规格](docs/prd/13-agent-native-production.md) |
| 查看 UI 规范与页面参考 | [UI 设计规范](docs/prd/11-ui-design-spec.md)、[离线可视化参考](docs/design/ui-reference.html) |
| 查看完整 URI 与邮件登录方案 | [路由与认证](docs/prd/12-routing-and-auth.md)、[路由表](config/routes.json)、[认证配置](config/auth.json) |
| 让 Codex 开始开发 | 先读 [AGENTS.md](AGENTS.md)，再读 [v2.2 Codex 任务](docs/v2.2-CODEX_START.md)与[接手指南](docs/getting-started.md) |
| 查看目前完成到哪里 | [实施进度](docs/implementation-status.md) |
| 了解技术、支付与部署 | [技术架构](docs/prd/04-architecture-and-data.md)、[Waffo 支付](docs/prd/05-waffo-billing.md)、[实施顺序](docs/prd/08-codex-execution.md) |
| 查看后续开发决策 | [实施决策记录](docs/implementation-decisions.md) |
| 选择依赖版本与验证部署兼容性 | [依赖策略](docs/dependency-policy.md) |

## 已确定的产品方向

| 项目 | 决策 |
| --- | --- |
| 品牌与主域 | PromoBento / `promobento.com`；域名配置状态见品牌种子 |
| 第一批用户 A | 创业团队、中小型 SaaS / AI / App / 软件产品团队 |
| 第一批用户 B | 已有课程、数字产品或会员收入的内容团队 |
| 用户闭环 | 确认事实与素材 → AI 导演/自由代码/程序化音效 → 浏览器定点编辑与 QA → Waffo 支付 → 多平台云端渲染 |
| 前端与开发工具 | React、TypeScript、Vite、React Router、mise、pnpm |
| 部署 | Cloudflare Workers、Static Assets、D1、R2、Queues、Durable Objects、Containers、Workers AI、Email Service |
| 登录 | Google 或邮箱验证码；统一登录注册，显式关联方式，当前/全部设备退出；邮件服务需实际接入验证 |
| 时长与画幅 | 仅 15/30 秒、30 fps，继续六个平台预设；Agent 可自由设计镜头数量、视觉和动画源码 |
| 支付 | Waffo.ai；项目和成片版本计费，详细政策以支付专章为准 |
| 首发平台预设 | TikTok、Instagram Feed、Instagram Reels、X、YouTube、YouTube Shorts |
| 语言 | 网站从首版建立国际化架构，先提供英语界面；用户文案独立于网站语言，可自由混排 |
| 产品界面主题 | 默认跟随系统；太阳/月亮图标一键切换并记住选择，设置可恢复跟随系统；独立于成片样式 |
| UI 方案 | 杂志排版主体＋专业工具配色；品牌与大标题用衬线字体，正文和控件用无衬线字体；shadcn/ui + Base UI、Tailwind CSS、Lucide，数值见 UI 规范 |

本表负责导览。精确规则、可配置配额、验收条件及事实来源见 PRD，不在根 README 维护第二份完整规格。

## 当前包含什么

| 路径 | 当前内容 |
| --- | --- |
| `AGENTS.md` | Codex 的阅读顺序、关键边界和完成报告要求 |
| `docs/prd/` | 14 份 Markdown：索引与 01–13 完整专章；13 为新创作规格 |
| `config/` | 品牌、语言、主题、UI、平台、路由、认证 7 份 JSON 种子 |
| `locales/en.json` | 英语界面消息种子 |
| `contracts/` | Composition/点选改稿、旧场景迁移与导出清单共 4 份 JSON 示例 |
| `docs/getting-started.md` | 克隆仓库、mise 环境准备与 Codex 开工提示词 |
| `docs/implementation-status.md` | M0–M4 的实现及验证状态 |
| `docs/implementation-decisions.md` | 仓库结构和工具版本决策 |
| `docs/evidence/` | 关键验收记录与历史检查快照；普通检查不要求逐次新增档案 |
| `scripts/check-repo.mjs` | 无外部依赖的仓库检查工具 |
| `docs/design/`、`scripts/build-ui-reference.mjs` | 四页 UI 参考模板、生成物与生成器；不连接生产功能 |
| `.mise.toml`、`package.json`、`pnpm-lock.yaml` | 已锁定的文档工具版本与检查入口 |
| `.github/PULL_REQUEST_TEMPLATE.md` | 后续实现提交的评审说明模板 |

应用开发从 M0 开始：AI Director、Coding Agent、自由 Composition/音乐/QA、React 页面、Google/邮箱认证、云服务、视频 renderer 和 Waffo 集成均待实施。路由 JSON 和验证码规则是可检查的实施输入，尚未发送邮件或建立实际登录会话。未来的 `apps/`、`packages/` 与 `tests/` 在产生真实代码时按 [08 的目录规划](docs/prd/08-codex-execution.md) 建立。

## 获取仓库与运行检查

项目仓库：[ten2ten2/promobento](https://github.com/ten2ten2/promobento)。

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
mise trust
mise install
mise run install
mise run check:repo
mise run check:ui-reference
```

mise 已确定为工具版本和任务入口。`mise install` 安装固定的 Node/pnpm，`mise run install` 根据已提交的锁文件安装包依赖。后续日常检查运行 `mise run check:repo`。工具安装与接手说明见 [指南](docs/getting-started.md)。

版本选择以部署平台和依赖兼容范围为前提，在范围内优先采用最新正式版，然后精确锁定。当前仓库工具的版本与验证范围见 [依赖策略](docs/dependency-policy.md) 和 [工具链验证](docs/evidence/toolchain-2026-10-19.md)。

仓库检查包括 PRD 清单、相对文件链接、JSON、英语资源引用、路由/API/外部回跳一致性、认证配置、平台与构图、示例映射和声明的主题色彩组合。Cloudflare 构建、workerd 运行、邮件与登录、容器渲染及 Waffo 集成各有独立的真实验证要求。

UI 规范或 tokens 修改后运行 `mise run build:ui-reference`，再运行 `mise run check:ui-reference` 检查参考页是否同步；参考页可直接在浏览器打开，使用样例状态且不连接外部服务。

`dev`、`build`、`test:billing`、`deploy:*` 等应用任务会随 M0–M4 实现加入 mise。

## 维护方式

需求的唯一规范来源为 `docs/prd/`；配置和契约种子各保留一份，位于仓库根目录的 `config/`、`locales/`、`contracts/`。运行时代码建立后，由实施决策明确源文件或生成关系，避免手工维护两套相同配置。

外部来源、核查日期和产品假设见 [09 来源与决策](docs/prd/09-sources-and-decisions.md)。实施进度只有在代码与对应证据存在后才更新为完成。
