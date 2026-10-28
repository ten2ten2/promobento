# 实施顺序与交付

先读 [AGENTS](../../AGENTS.md)、[PRD 索引](README.md)和[实际进度](../implementation-status.md)，从尚未完成的阶段继续。本章规定实施顺序、工具链和交付要求。

## 1 接手与当前命令

新工作区：

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
bash scripts/agent-setup.sh
```

已有工作区先保留未提交改动，再同步 remote main。配置或契约变更须同步使用它们的代码与文档；参考页模板、tokens 或商品配置变化后，运行 `mise run build:agent-reference`。

开发期间非必要不跑测试，也不反复触发 CI；必须验证时只运行一次最小检查，已有适用结果直接复用。下表列出可用命令，不是每次接手或提交都要执行的清单；生产发布的必需检查保持不变。

setup 用 mise 安装精确版本并冻结安装依赖；没有 mise 时只接受 PATH 中相同的 Node/pnpm，缺工具先给明确提示。工具来源为 [mise 官方](https://mise.jdx.dev/getting-started.html)、[Node 官方发行](https://nodejs.org/en/download)及 [pnpm 官方安装](https://pnpm.io/installation)，也可使用已核验的内部镜像；不因某个沙箱下载方便而接受第三方重打包二进制。无 mise 时使用相同版本执行 `pnpm install --frozen-lockfile`，需要的已登记任务对应 `pnpm run <任务名>`。已预置工具和缓存的环境可设置 `PROMOBENTO_SETUP_OFFLINE=1`，缓存位置用 `PROMOBENTO_PNPM_STORE_DIR`；缺项明确报错，不自动改用系统版本。其他 Node 可用于诊断，但不能据此宣称通过固定工具链验收。

| 任务 | 实际范围 |
| --- | --- |
| `install` | pnpm 冻结安装 |
| `check:repo` | 先预编译验证器，再检查当前文档链接、锚点和变量；配置、路由、认证、主题、平台规则版本；PRD/协议版本入口；v2 旧标识符不得出现（方案与留证目录除外）；并执行契约与离线参考检查 |
| `check:contracts` | 先预编译验证器，再检查生产 Schema 样例、语义、摘要、合法目标与 API 清单；目标与画幅、分段并发；模型配置与授权、价格目录一致 |
| `test` | 先构建验证器，再运行 scripts、packages、apps、tests 中的 `*.test.{mjs,js,cjs,ts,mts,cts}`，排除 `*.render.test.*`；不支持的测试后缀报错。原生 TS 执行不代替类型检查 |
| `typecheck` | 先构建契约验证器，再检查 `apps/cloud` 和 `packages/film-runtime`/`blocks` 的 TypeScript，包含共享契约导入用例 |
| `build:film-runtime` | 构建 Node 页面生成器、预编译积木参数校验器及浏览器 shim、engine、OM/clip 与可信积木 |
| `test:browser` | CI 隔离镜像内运行核心积木帧集、新镜头专项、JPEG→MP4/音频链路及四画幅 seek/布局/字体/桥接回归；输出 13 种 30 秒程序风格试听；本机直接调用明确失败，见[运行时说明](../../packages/film-runtime/README.md) |
| `test:cloud-local` | 预编译当前 Schema，在本机以固定 SSE、SQLite 和 R2 模拟回放真实 A–C/E/F 编排、三方向 still 请求、用户等待、修复、冷审拒绝与取消；不访问网络、不构建镜像，不代表云验或模型能力通过 |
| `build:validators` | 把全部 14 个 v3 Schema（含单位经济、导演分析、音乐准入与研究模型费用）及派生积木参数预编译为独立 ESM 验证器及类型声明；Workers 从 `@promobento/contracts/validators/<name>` 导入，见[共享契约库](../../packages/contracts/README.md) |
| `build:agent-reference` / `check:agent-reference` | 先预编译验证器，再生成或核对离线 Studio 参考 |

云部署／集成目前使用 [Actions 工作流](../../apps/cloud/README.md#部署)，评测使用 [research/evals 的 Node 入口](../../research/evals/README.md)。`build:containers`、`cloud:dev`、`cloud:deploy`、`test:cloud`、`eval`、`upstream:diff` 尚不是已登记的 mise 命令；有真实实现时再加入，不建空脚本。

检查范围是 Git 跟踪文件和未被忽略的新文件。渲染产物放 `artifacts/`；不能让生成的报告进入文档遍历，也不把媒体文件读成文本。新增 package/app 时同步其依赖和 lockfile；浏览器与媒体测试使用 `*.render.test.*`，外部集成测试随模块加入独立命令和 CI。新增根级 package script 同步登记 mise task，仓库检查自动核对，不创建空脚本占位。

## 2 里程碑与退出关口

本章是 S0–S3 和 M1–M4 的唯一实施／出口清单；[技术设计](../plans/cloud-motion-v3.md)说明能力范围，[实施状态](../implementation-status.md)说明实际完成度。S0 契约就绪后，网站／交易工作可独立推进，但 S2 仍须等 S1 出口。

| 切片 | 实施内容 | 退出条件 |
| --- | --- | --- |
| S0 契约与工具链 | v3 Schema、film/runtime 协议、预编译验证器、精确 TypeScript 工具链、配置和云骨架；不调用付费模型 | 仓库／契约、单元和类型检查通过 |
| S1 一条龙 | 页面／shim／engine、九个核心积木和四转场；四模式渲染容器、云调度／broker／账本；A–F导演、两种模型适配器、程序配乐／ABC／CC0采样；六题首轮 | G1通过；积木创作模型p50≤$0.70、p95≤$1.20；方向／积木草稿／30秒2D成片达到技术设计§1.2；负责人正常速度视听愿意发布≥4/6 |
| S2 自写、QA、改稿与预览 | 完整D/E、Q0/Q1/Q2及反例；自写WebGL／Three.js与完整攻击语料；分流／直接改值／局部和结构修改、增量复用；四画幅准备／默认关闭的变体；独立域名客户播放器与点选；三类3D积木；评测第二轮 | 完整创作／改稿／准备成本和时间目标达标；攻击／QA变异按预期；负责人愿意发布≥5/6，软件／课程各≥2；据实测提议收紧止损，批准后生效 |
| S3 素材、完整能力与上线准备 | AssetWorkflow／AssetDO／资产容器、ASR和确认转写、受控抓取；其余全部积木／转场、课程方法；用户可控经验；按试听调整音乐、观测／告警 | 下述完整管线关口通过；P1功能仍按PRD开关／许可启用，不能因代码完成自动公开 |
| M1 Studio与用户流程 | 两类用户的试用／先购、素材事实、方向、预览、批注、恢复、声音、目标与移动UI | 可自助完成流程，02的UI-01–UI-08通过 |
| M2 可靠交付 | 客户D1／账本／队列、冻结、Waffo、按需编码和发布版本登记 | 真实并发、计量、补目标、退款、删除与历史重放通过 |
| M3 团队与运营 | 邀请／审阅／冲突／清理，成本／归因／质量面板与用途页 | **G2**：M1–M3真实集成通过，费用可对账 |
| M4 上线与有限试运营 | 性能／安全／平台上传、正式收款退款、域名发信／政策／回滚 | 06／12发布条件通过；达到下述G3才扩大获客 |

**S1 提前范围**：已批准 DOM/SVG/Canvas2D 自写镜头及其必要Q0／安全／帧验证提前进入S1，先确定方向和Treatment、先验最难镜头，再检查实际输出。自写先验证再生成候选；自写WebGL、完整动态Q1/Q2和其他S2能力不提前，原费用／时间／质量出口不变。

**G1 云端检查点**：正式预发布镜像的生产broker、分离uid／沙箱与固定隔离；纯2D和WebGL的30秒片各十串行＋四并发；捕获格式／机型、接缝／CPU flags、studio延迟、真实取消／原生终止／restart防重放、物理回收与结算。详细范围见[技术设计§10.2](../plans/cloud-motion-v3.md#102-g1-云端检查点)。内存峰值仅按[平台限制批准](../evidence/2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)暂缓，仍未测量通过。实测不足不能自行提高目标或期限。

**完整管线关口**：终版积木／转场四画幅黄金帧与审美接受、上游12模板原创改写自写冒烟、攻击／QA变异通过；本地真实镜像链路和staging均走通创作→方向→成片→改稿→四画幅准备→变体且账本可对账；当前实际命令的必要CI通过，成本／时间／作品目标完整达标，留证符合06。尚未实现的命令或mock不能代替该关口。

开放免费云任务前另验身份／素材权限、一次试用领取、费用预留／预算／限流和暂停恢复；未知价格或限额保持关闭。Chromium完整沙箱是自写执行前提，实际降级必须先取得负责人书面决定，不能静默用无沙箱模式。

**费用基准：** 按[07](07-growth-and-experiments.md)记录全流程费用，估算通常使用、用满权益和不同试用转付费情景；商户费用取实际账单，新增构图另记边际成本。单位成本目标见 `config/agent-policy.json` 的 `unitCostTargets`。超预算时先按07优化，再提出价格或权益调整，不在实现中自行改变商品规则。

**G3：** 两类用户各至少3个独立、非赠送的付费交付。用户样本观察满30天后，扣除实际成本和剩余付费权益的预计成本，贡献达到事前目标，试用损失不超预算，作品质量和可靠性达标。试运营前确定负责人、样本窗口与止损条件。未达到时停止扩大新增成本，保留查询、退款、既有下载和已收款任务恢复。G1/G2 不要求尚不存在的市场数据。

### 外部输入何时阻塞

| 所需输入 | 责任角色 | Agent 先交付什么 |
| --- | --- | --- |
| 商业事实与客户素材权利 | 产品/素材提供者 | 题目卡、待核实事实和许可清单；先用明确标注的虚构工程样例 |
| 每题预算与模型账户 | 项目负责人、账户持有人 | 模型/方法候选、费用上限和最小凭据需求，已有授权直接沿用 |
| Cloudflare、域名发信、Google/Waffo | 相应账户持有人 | 可用配置、隔离测试与最小绑定清单，不索取无关权限 |
| 实际主体、市场、合同与审核方案 | 经营负责人 | 政策草稿、具体待补事实和可演示流程 |
| 正常速度试听与目标用户盲审 | 作品负责人、独立目标用户 | 可播放作品、对照材料、评分说明和已测费用 |

缺输入时，交付已有代码/样片、可复跑命令、缺项和恢复步骤；在实施状态中标明受影响任务。只暂停依赖缺项的部分，不伪造人工确认、凭据或外部验收。客户及受限素材本体放仓库外受控存储，清单只保存摘要、来源和授权引用，不链接个人机器路径；自制且可公开的测试素材可入库。

## 3 代码责任与可复现工具链

应用按 `apps/cloud`（Worker、Workflows、DO、broker）、`apps/render-container`、`apps/asset-container` 分工；共享契约、片子运行时、积木、声音、预览播放器、导演方法与字体按实际依赖组织为 packages，不建空模块。职责见[技术设计](../plans/cloud-motion-v3.md#31-代码归属)，规则归属见 [PRD 索引](README.md)，共享算法只保留一份。

mise 管理工具与任务，pnpm 管理依赖。精确版本在 `.mise.toml`、`package.json`，安装使用冻结 lockfile；TypeScript 与 wrangler 锁定精确版本，依赖的安装脚本默认不运行。初始化或主动升级时核对目标平台、官方兼容性与实际运行结果；普通文档/业务修改不自动升级，也不把本机版本当作选型依据。新增依赖锁版本，核查安装脚本和许可证；创作代码不能任意安装或联网。

### 自写镜头的执行隔离

自写镜头只在渲染容器的 Chromium 沙箱里运行：每个分段或 studio 实例单独隔离，Chromium 以独立 uid 运行，出网只经 broker，实例不带凭据。页面由 `film.json` 生成，运行时 shim 在作品代码求值前禁用网络、Worker、WebAssembly、eval、存储、音频、`<video>`、`<iframe>` 和初始化后的计时器，固定时间与随机源（`contracts/film-runtime.d.ts`）。Worker 和可信进程从不求值作品代码。浏览器归档与 GSAP 字节按[渲染环境锁](../../apps/render-container/environment.lock.json)校验。

### 媒体验证与结果交接

缺浏览器、编码器或所需字体时明确失败，不采用宿主的浮动默认值；必需的 CI 媒体门禁不能把环境不可用记为 skip 后通过。没有容器能力时，本地继续纯代码工作并注明媒体未验证。

| 环境 | 另需验证 |
| --- | --- |
| 本地/CI | 工具实际版本、冻结安装；S1 起的 `test:browser` 与 `cloud-local` 全流程 mock，分别保留样片、环境与验证报告 |
| Workers Builds | 显式安装工具并设置路径，干净检出可构建，不假定平台读取 mise |
| workerd | compatibility_date/flags/bindings；SSR、认证、签名、存储和队列 |
| Cloudflare 容器 | 06 的复杂片、媒体、沙箱与回收，镜像可重复获取；镜像只经 GitHub Actions 构建推送 |
| 客户浏览器 | 支持范围内的 UI、hydration、字体、本地预览和帧协议 |

CI 支持手动 `workflow_dispatch`。[工作流](../../.github/workflows/checks.yml)包含 `contracts`、可信积木/媒体的 `browser` 和离线导演的 `cloud-local` job，可只选必要子项。`browser` 只构建并运行离线镜像；`suite=runtime` 只复验四画幅顺序/逆序/冷 seek、字体/布局与桥接，不重复媒体和 13 种配乐，未运行项明确记录为 `not_run`；`cloud-local` 不访问模型或云资源。[staging 部署工作流](../../.github/workflows/cloud-deploy.yml)仅手动运行，按所选场景构建／推送镜像、迁移数据库和集成或只读健康检查，不隐式发布生产；harness 修复可复用明确的已部署 SHA，见[云端说明](../../apps/cloud/README.md)。实际证据和当前G1缺口见实施状态。临时探针（如 [G1 预探针](../evidence/2026-10-23-g1-pre-probe/README.md)）运行后删除云端资源。

长期验收证据按06移到受控存储。Agent无法读取CI时，由有权限的执行方交回精确commit SHA、run ID/attempt、各job结果，以及关联的报告、样片和环境文件；核对环境/镜像/浏览器摘要和实际覆盖，不能仅凭“已通过”的文字结论。拿不到结果就保留受影响的项未验证，不改lock绕过环境校验。确定性样例可重新生成，模型作品或试听材料不能只留命令/hash；受跟踪文档不链接仅本地存在的产物。

首次生产冻结时按14建立发布版本登记；当前未发布草稿直接更新，不建 legacy 目录。已购作品的环境继承、修复和保留按14执行，不用浮动 latest 重放。媒体许可见09，关键实测按06留证，不另写迁移日记。

官方入口：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[compatibility date](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Containers](https://developers.cloudflare.com/containers/get-started/)、[浏览器截图差异](https://playwright.dev/docs/test-snapshots)。实施日重新核对。

## 4 环境与交付

各模块随实现提交请求/响应契约、权限和错误测试、运行配置；数据库模块同时提交 migrations 和真实 D1 并发验证。首个云模块提供可用的 `.dev.vars.example` 和 wrangler 配置，列明实际绑定、变量用途及环境来源。认证、发信和支付区分本地 mock、真实 test 与 production，不提交密钥，也不用 mock 通过代替集成验收。

appUrl、回调、发信和支持地址取 brand/routes/auth。密钥只交给需要它的可信服务，沙箱不带凭据；新增服务纳入费用预算。完成报告写清变更、实际验证、未实现项、样片/费用和外部条件；仅在能力变化时更新实施进度。

验证按 AGENTS 的最小检查规则执行，不默认跑全套测试或为每次提交触发 CI。CI 结果只描述所验证的提交；后续未改变相关代码、配置和输入时直接复用，不因快进合并或纯文档修改重跑全量。必须验证的当前问题只做一次最小检查，失败先分析日志和产物。需要 CI 时记录实际提交和覆盖范围；生产发布仍要求最终发布 SHA 的必需检查通过。

平台规则比较由 [select-ci-baseline.mjs](../../scripts/select-ci-baseline.mjs) 选择main上最近成功祖先，PR用base SHA；API／网络异常和无法证明最近祖先均阻断，不退回HEAD或全零。仓库固定初始基线只用于API明确零成功历史且该提交为严格祖先的情况，不能由环境变量替换。本地可用 `PROMOBENTO_BASE_REF` 指定已核实基线；`origin/main=HEAD` 可比较未提交改动。算法限额与特殊条件在脚本维护，不在文档复制实现。

失败先区分代码错误与 runner/网络故障；前者修复或安全 revert，后者修复环境，是否再验证仍按最小检查规则判断，不自动重跑 CI。接入生产部署时，只部署该 SHA 必需检查全部成功的产物；被取消不算成功。推送方式及远端前移处理统一按 AGENTS。
