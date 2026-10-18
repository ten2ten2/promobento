# 仓库接手指南

产品需求从 [PRD 索引](prd/README.md) 阅读，当前实现状态见 [实施进度](implementation-status.md)。mise 已确定为工具版本和任务入口。

## 1 获取现有仓库

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
```

已有本地克隆时，在保留本地改动的前提下同步远程 main。根目录应直接包含 `README.md`、`AGENTS.md`、`.mise.toml`、`docs/` 和 `scripts/`。

## 2 准备 mise 工具链

先通过 [mise 官方安装说明](https://mise.jdx.dev/getting-started.html) 安装当前正式版。仓库配置声明所需的 mise 最低版本，Node/pnpm 采用精确版本。

查看仓库配置后执行：

```bash
mise trust
mise install
mise run install
mise run check:repo
```

`mise install` 安装工具，`mise run install` 使用 pnpm 和冻结锁文件安装包依赖。后续任务统一通过 `mise run` 进入；当前的实际执行范围见 [工具链验证](evidence/toolchain-2026-10-19.md)。

## 3 版本选择与部署环境

版本规则见 [依赖策略](dependency-policy.md)：先满足目标平台、运行时和框架/SDK 兼容要求，再选择最新正式版并锁定。CI 复现已提交版本；主动升级时才重新解析依赖。

Cloudflare Workers Builds、workerd 和 renderer 容器是不同环境。`.mise.toml` 不等于 Cloudflare 已配置同版本，M0 必须核对实际构建版本、平台变量、运行时 API 和容器输出。根 `package.json` 当前只包含仓库检查工具，应用依赖尚待 M0 初始化。

排查环境时可以执行 `mise exec -- node --version` 和 `mise exec -- pnpm --version`，确认进入的是项目工具链。

## 4 提交与维护

项目当前要求完成修改后直接提交到 remote main；使用正常的快进更新，并保留远程已有工作。先运行受影响的真实检查，再提交实际修改。若远程在工作期间新增提交，先读取并整合相应变更。

PRD 维护业务需求，AGENTS.md 保留简短的开发入口和关键约束；`.editorconfig` 与后续 formatter/linter 负责可自动执行的格式规范。状态与验证记录只在相关状态实际变化时更新。

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
- 网站从首版建立国际化架构，首发英语；用户文案可使用任意语言或混排，不设视频语言选择或识别确认门槛。
- System / Light / Dark 属于 P0，网站主题与视频内容、计费独立。

当前仓库只有完整规格、配置种子、契约示例和仓库检查工具。
从 M0 建立真实应用代码与运行命令；先证明 Cloudflare 渲染和 Waffo test 的可行性，
再推进编辑器、账务、交付、团队和运营。复用已有配置，避免制造两套权威来源。

先核查 Cloudflare 构建、workerd 和 Container 的实际兼容范围，再选择范围内最新正式版并锁定。
通过 mise 管理工具和任务，建立 pnpm 工作区、必要迁移、环境示例和测试。
把实际实现与执行证据更新到 docs/implementation-status.md、
docs/implementation-decisions.md 和 docs/evidence/。

缺少外部账户或凭据时，明确记录受影响的真实验证，继续完成不依赖它的工作。
每次汇报列出已实现功能、未实现 P0、实际运行的命令与环境、尚未完成的外部验证。
不要把静态页面、模拟付款或空测试脚本报告为完整 SaaS 已完成。
```

## 6 M0 的具体出口

M0 的应用工作至少包括：核对目标 Cloudflare 构建环境与工具版本，初始化受支持的 React Router 工程并锁版本，建立英语网站 SSR、主题 Cookie/CSS 与配置基础，连接 D1/R2，在目标 Cloudflare 环境通过单场景容器生成 30 秒 MP4，并验证 Waffo test checkout、签名和查询。精确出口与其余阶段见 [08](prd/08-codex-execution.md)。

当前仓库的检查命令与 M0 的真实环境验证分别记录。开发账号尚未配置时，状态保持未验证，不填写虚构的资源 ID 或成功结果。
