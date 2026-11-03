# 实施顺序与交付

本章记录实施顺序、常用命令和验收条件。当前完成度见[实施状态](../implementation-status.md)，协作约定见[AGENTS](../../AGENTS.md)。

## 1 接手与当前命令

新工作区：

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
bash scripts/agent-setup.sh
```

已有工作区先保留未提交改动，再同步 remote main。配置或契约变更须同步使用它们的代码与文档。

验证按 [AGENTS](../../AGENTS.md#验证与提交) 的最小检查规则执行。下表是可用命令及范围，不是每次接手或提交的必跑清单。

setup 按 `.mise.toml` 安装固定 Node/pnpm，依赖使用 `pnpm install --frozen-lockfile`。没有 mise 时只能使用同版本的工具。离线环境可设置 `PROMOBENTO_SETUP_OFFLINE=1` 和 `PROMOBENTO_PNPM_STORE_DIR`；缺少工具或依赖时直接报错。工具来源见 [mise](https://mise.jdx.dev/getting-started.html)、[Node](https://nodejs.org/en/download) 和 [pnpm](https://pnpm.io/installation)。

| 任务 | 实际范围 |
| --- | --- |
| `install` | pnpm 冻结安装 |
| `check:repo` | 预编译验证器，检查文档链接/锚点、版本、配置、路由与契约一致性 |
| `check:contracts` | 检查原生运行时、平台预设、模型目录及授权配置 |
| `test` | 先构建验证器与 Web，再运行单元测试和本地多 Worker/D1 集成测试，排除 `*.render.test.*`；原生 TS 执行不代替类型检查 |
| `typecheck` | 先构建契约验证器，再检查 Core、Web 和 Preview 的 TypeScript，包含共享契约导入用例 |
| `test:browser` | CI 固定镜像内运行完整 huashu 的四画幅真实取帧、原生变量编辑和 15/30 秒有声整片导出；见[原生运行时](../../packages/native-motion/README.md) |
| `test:cloud-local` | 以 SQLite／R2 和模型／容器响应夹具验证原生方向等待、创作／改稿、整片提交、取消与恢复；不产生模型费用，不代替真实云验 |
| `test:saas-local` | 构建 Web，使用真实本地 workerd/D1 验证断言批写、T0–T7、命名服务绑定与流式网关；不部署、不调用模型 |
| `build:web` | 构建 React Router SSR Worker、页面和静态资源 |
| `test:web-browser` | 已完成 `build:web` 后，使用固定 Chromium 验证 hydration、页面导航、CSP 和窄屏；CI 的 browser job 提供浏览器 |
| `build:validators` | 将当前原生工程与辅助 Schema 预编译为 ESM；Workers 不在请求内编译 Ajv |
| `test:native` | 原生清单与路径边界、导演编排、源码版本、媒介证据、物理停止恢复及实际／未知模型账本的最小离线集 |

云部署使用 [Actions 工作流](../../apps/cloud/README.md)，素材评测从 [research/evals](../../research/evals/README.md) 运行。只使用 `package.json` / mise 中实际登记的命令。

仓库检查覆盖 Git 跟踪文件和未忽略的新文件，产物放 `artifacts/`。新增 app、package 或脚本时同步依赖、lockfile、mise 任务及相应测试；浏览器媒体测试使用 `*.render.test.*`。

## 2 里程碑与退出关口

本章是 S0–S3 和 M1–M4 的唯一实施／出口清单；[06](06-testing-and-release.md#渲染与导演性能目标)维护性能目标，[13](13-agent-native-production.md)维护导演规则，[实施状态](../implementation-status.md)说明实际完成度。S0 原生基础就绪后，网站／交易工作可独立推进；客户模块可用离线夹具开发，S2 的开发前置是 G1a，S2 出口仍须等 S1 出口。

| 切片 | 实施内容 | 退出条件 |
| --- | --- | --- |
| S0 契约与工具链 | 原生工程及所需辅助契约、预编译校验、固定工具链与云骨架 | 相关仓库、契约和类型检查通过；客户业务要求仍待各模块实现 |
| S1 一条龙 | 完整 huashu 原生创作、参考理解、Brief/Treatment/Script、素材角色/候选、语义作者事件、预览、局部改稿、整片导出；预算／回执／恢复；六题首轮 | G1 真实云端通过；参考与语义/复用的 06 反例通过；创作模型费用达到 [agent-policy.unitCostTargets](../../config/agent-policy.json) 的当前目标；既定时间目标达标；负责人正常速度视听愿意发布≥4/6 |
| S2 客户预览与完整 QA | 独立域名原生播放器、Script/素材角色界面、候选选择与锁定、直接改值、时间／元素批注、动态 Q0/Q1/Q2、完整攻击语料与四画幅准备 | 成本／时间目标达标；批注/候选/依赖复用与攻击/QA 变异按预期；作品愿意发布≥5/6且两类用户各≥2 |
| S3 素材与上线准备 | 客户素材处理、来源/参考分析、声音、观测告警；ASR/逐词对齐、受控抓取、生成图片/视频/TTS 和经验作为独立 P1 功能验收 | P0 完整管线关口通过；未验证或 P1 能力不因源码存在自动开放，不以外部生成视频作为 P0 前置条件 |
| M1 Studio与用户流程 | 两类用户的试用／先购、素材事实、方向、预览、批注、恢复、声音、目标与移动UI | 可自助完成流程，02的UI-01–UI-08通过 |
| M2 可靠交付 | 客户 D1／账本／队列、冻结、Waffo、按需编码和发布版本登记 | 真实并发、计量、补目标、退款、删除及迟到事件重放通过 |
| M3 团队与运营 | 邀请／审阅／冲突／清理，成本／归因／质量面板与用途页 | **G2**：M1–M3真实集成通过，费用可对账 |
| M4 上线与有限试运营 | 性能／安全／平台上传、正式收款退款、域名发信／政策／回滚 | 06／12发布条件通过；达到下述G3才扩大获客 |

**G1 云端检查点：** 使用固定预发布镜像，验证真实 Broker/R2/D1、隔离 Chromium、字体与媒体解码、2D/WebGL 整片、编码与声音、取消、物理停止、恢复、租约和费用。按 [06 的 1/4/16/64 并发及资源矩阵](06-testing-and-release.md#真实高并发内存和经济性关口)记录吞吐、p95/p99、内存峰值、OOM、排队、公平性、每份合格片的总成本和失败恢复。关键观测缺失、未解释的 OOM 或账务/隔离不一致均不得通过；容量与预算要先用实测值标定。

**G1a 基础设施检查：** 不调用付费模型，随对应代码完成分三次进行，每次只验新增链路：Web/Core 骨架完成后，验证服务绑定与命名入口、staging D1 上的断言批写与并发、固定镜像夹具的渲染/取消/物理停止/恢复、Core 部署期间新旧版本并存下的在途任务，以及容器内存指标可得性；上传完成后，验证 50 MiB 文件经 Web→Core→R2、权益预留与素材处理；预览完成后，验证独立预览域、能力令牌和播放器隔离。能在本地 workerd 与浏览器复现的部分先在本地测，staging 只补真实域名、TLS、请求体上限与吞吐。G1a 不代替 G1 的作品质量、成本与 1/4/16/64 并发结论。

**完整管线关口：** 在固定镜像和 staging 中用真实素材完成导演→成片→改稿→全目标准备，并通过动态 QA、隔离、预算、用户视听和性能检查；离线 mock 或单个编码样例不能替代。自动生成图片/视频及逐词对齐属于独立的 P1 验收，不能替换基础真实素材能力。

开放免费云任务前另验身份／素材权限、一次试用领取、费用预留／预算／限流和暂停恢复；未知价格或限额保持关闭。Chromium完整沙箱是自写执行前提，实际降级必须先取得负责人书面决定，不能静默用无沙箱模式。

**费用基准：** 以 `agent-policy.unitCostTargets` 为准，核算方法见[07](07-growth-and-experiments.md)；超标先优化并复测，调整商品须另获批准。

**G3：** 两类用户各至少3个独立、非赠送的付费交付。用户样本观察满30天后，扣除实际成本和剩余付费权益的预计成本，贡献达到事前目标，试用损失不超预算，作品质量和可靠性达标。试运营前确定负责人、样本窗口与止损条件。未达到时停止扩大新增成本，保留查询、退款、既有下载和已收款任务恢复。G1/G2 不要求尚不存在的市场数据。

### 外部输入何时阻塞

| 所需输入 | 责任角色 | Agent 先交付什么 |
| --- | --- | --- |
| 商业事实与客户素材权利 | 产品/素材提供者 | 题目卡、待核实事实和许可清单；先用明确标注的虚构工程样例 |
| 每题预算与模型账户 | 项目负责人、账户持有人 | 模型/方法候选、费用上限和最小凭据需求，已有授权直接沿用 |
| Cloudflare、域名发信、Google/Waffo | 相应账户持有人 | 可用配置、隔离测试与最小绑定清单，不索取无关权限 |
| 实际主体、市场、合同与审核方案 | 经营负责人 | 政策草稿、具体待补事实和可演示流程 |
| 正常速度试听与目标用户盲审 | 作品负责人、独立目标用户 | 可播放作品、对照材料、评分说明和已测费用 |

有审核或开通周期的外部输入（Waffo 商户与 AIGC 审核、输出审核供应商、发信域名、Google OAuth、主域与预览域 DNS）在开发期间并行启动，不等集中验收；生产模型费用与研究授权分开登记，staging 不能占用，具体额度在真实收费前确认。

缺输入时，交付已有代码/样片、可复跑命令、缺项和恢复步骤；在实施状态中标明受影响任务。只暂停依赖缺项的部分，不伪造人工确认、凭据或外部验收。客户及受限素材本体放仓库外受控存储，清单只保存摘要、来源和授权引用，不链接个人机器路径；自制且可公开的测试素材可入库。

## 3 代码责任与可复现工具链

应用按 [apps/cloud](../../apps/cloud/README.md)（Worker/Workflows/DO、broker、版本与账本）和 [apps/render-container](../../apps/render-container/README.md)（隔离预览/整片、媒体归一与实际工程归档）分工；[packages/native-motion](../../packages/native-motion/README.md)直接调用完整上游，`packages/contracts`统一清单、身份与校验，`packages/methods`管理原生导演和上游方法。[apps/web](../../apps/web/README.md) 提供 SSR、页面与 API 网关，无数据绑定和密钥；[apps/preview](../../apps/preview/README.md) 是独立预览域的服务边界。客户业务模块放在 `apps/cloud/src/` 下按领域分目录，现有 S1 文件不做零散搬迁；拓扑与写入归属见 [04 §1](04-architecture-and-data.md#部署拓扑与写入归属)。客户素材/播放器模块随相应阶段实现。

客户实现按依赖顺序拆分：文档定稿 → 带断言批写（含可复跑的额度竞争、冻结、重放与重复付款并发用例）、多 Worker 测试台、Web 骨架与网关、Preview 空壳 → 身份与会话 → 项目（含删除墓碑与删除后禁止新建作业）、试用、权益账本与费用信封 → 上传、素材权利与归一化 → 引擎适配层、审核端口与候选状态机 → Studio 与预览 → 改稿、QA、目标准备与快照 → Waffo、交付与退款 → 团队、审阅、后台与清理。每步提交针对性的单元、契约与安全测试；数据库步骤按 §4 在真实 D1 验证并发。

mise 管理工具与任务，pnpm 管理依赖。精确版本在 `.mise.toml`、`package.json`，安装使用冻结 lockfile；TypeScript 与 wrangler 锁定精确版本，依赖的安装脚本默认不运行。初始化或主动升级时核对目标平台、官方兼容性与实际运行结果；普通文档/业务修改不自动升级，也不把本机版本当作选型依据。新增依赖锁版本，核查安装脚本和许可证；创作代码不能任意安装或联网。

### 自写镜头的执行隔离

原生工程代码只在无凭据 Chromium 沙箱中执行，每个预览或整片任务独立容器。控制器、原生运行子进程和 supervisor 分 UID；页面文件与媒体源都须约束在任务目录，容器禁公网，broker 仅允许任务输入和输出。Worker／可信 Node 不求值作品代码。完整上游、隔离补丁、Chrome 与 FFmpeg 固定；取消／超时以物理容器停止为最终依据，不能靠杀父进程证明无孤儿浏览器。

### 媒体验证与结果交接

缺浏览器、编码器或所需字体时明确失败，不采用宿主的浮动默认值；必需的 CI 媒体门禁不能把环境不可用记为 skip 后通过。没有容器能力时，本地继续纯代码工作并注明媒体未验证。

| 环境 | 另需验证 |
| --- | --- |
| 本地/CI | 工具实际版本、冻结安装；S1 起的 `test:browser` 与 `cloud-local` 全流程 mock，分别保留样片、环境与验证报告 |
| Workers Builds | 显式安装工具并设置路径，干净检出可构建，不假定平台读取 mise |
| workerd | compatibility_date/flags/bindings；SSR、认证、签名、存储和队列 |
| Cloudflare 容器 | 06 的复杂片、媒体、沙箱与回收，镜像可重复获取；镜像只经 GitHub Actions 构建推送 |
| 客户浏览器 | 支持范围内的 UI、hydration、字体、本地预览和帧协议 |

CI 的 [checks](../../.github/workflows/checks.yml) 包含 `contracts` 与 `browser`；后者在固定镜像中运行原生媒体测试。独立 [staging 工作流](../../.github/workflows/cloud-deploy.yml) 需要显式手动启动，不会自动发起付费模型评测。发布以最终 SHA 的检查为准。

长期验收证据按06移到受控存储。Agent无法读取CI时，由有权限的执行方交回精确commit SHA、run ID/attempt、各job结果，以及关联的报告、样片和环境文件；核对环境/镜像/浏览器摘要和实际覆盖，不能仅凭“已通过”的文字结论。拿不到结果就保留受影响的项未验证，不改lock绕过环境校验。确定性样例可重新生成，模型作品或试听材料不能只留命令/hash；受跟踪文档不链接仅本地存在的产物。

首次生产冻结和后续修复按[14](14-production-contracts.md)登记发布版本；媒体许可见[09](09-sources-and-licensing.md)，真实验收证据按[06](06-testing-and-release.md)保存。

工具来源：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[Containers](https://developers.cloudflare.com/containers/get-started/)、[Playwright](https://playwright.dev/docs/test-snapshots)。

## 4 环境与交付

各模块随实现提交请求/响应契约、权限和错误测试、运行配置；数据库模块同时提交 migrations 和真实 D1 并发验证。首个云模块提供可用的 `.dev.vars.example` 和 wrangler 配置，列明实际绑定、变量用途及环境来源。认证、发信和支付区分本地 mock、真实 test 与 production，不提交密钥，也不用 mock 通过代替集成验收。

appUrl、回调、发信和支持地址取 brand/routes/auth。密钥只交给需要它的可信服务，沙箱不带凭据；新增服务纳入费用预算。完成报告写清变更、实际验证、未实现项、样片/费用和外部条件；仅在能力变化时更新实施进度。

CI 基线由 [select-ci-baseline.mjs](../../scripts/select-ci-baseline.mjs) 选择最近成功的 `main` 祖先；无法确认时检查失败，不自动退回当前提交或空基线。本地 `PROMOBENTO_BASE_REF` 只用于指定已核实的基线，具体规则以脚本为准。

失败先读日志和产物，区分代码错误与 runner/网络故障，分别修复代码或环境；是否重验按 AGENTS 判断。生产仅部署最终 SHA 必需检查全部成功的产物，被取消不算成功。推送按 [AGENTS](../../AGENTS.md#验证与提交) 处理远端更新。
