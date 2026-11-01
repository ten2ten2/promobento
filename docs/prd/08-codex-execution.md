# 实施顺序与交付

先读 [AGENTS](../../AGENTS.md)、[PRD 索引](README.md)和[实际进度](../implementation-status.md)，从尚未完成的阶段继续。本章规定实施顺序、工具链和交付要求。

## 1 接手与当前命令

新工作区：

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
bash scripts/agent-setup.sh
```

已有工作区先保留未提交改动，再同步 remote main。配置或契约变更须同步使用它们的代码与文档。

开发期间非必要不跑测试，也不反复触发 CI；必须验证时只运行一次最小检查，已有适用结果直接复用。下表列出可用命令，不是每次接手或提交都要执行的清单；生产发布的必需检查保持不变。

setup 用 mise 安装精确版本并冻结安装依赖；没有 mise 时只接受 PATH 中相同的 Node/pnpm，缺工具先给明确提示。工具来源为 [mise 官方](https://mise.jdx.dev/getting-started.html)、[Node 官方发行](https://nodejs.org/en/download)及 [pnpm 官方安装](https://pnpm.io/installation)，也可使用已核验的内部镜像；不因某个沙箱下载方便而接受第三方重打包二进制。无 mise 时使用相同版本执行 `pnpm install --frozen-lockfile`，需要的已登记任务对应 `pnpm run <任务名>`。已预置工具和缓存的环境可设置 `PROMOBENTO_SETUP_OFFLINE=1`，缓存位置用 `PROMOBENTO_PNPM_STORE_DIR`；缺项明确报错，不自动改用系统版本。其他 Node 可用于诊断，但不能据此宣称通过固定工具链验收。

| 任务 | 实际范围 |
| --- | --- |
| `install` | pnpm 冻结安装 |
| `check:repo` | 先预编译验证器，再检查当前文档链接、锚点和变量；配置、路由、认证、主题、平台规则版本；PRD/协议版本入口；v2 旧标识符不得出现（方案与留证目录除外）；并执行契约检查 |
| `check:contracts` | 先预编译验证器，再检查生产 Schema 样例、语义、摘要、合法目标与 API 清单；固定目标与原生工程边界；模型配置与授权、价格目录一致 |
| `test` | 先构建验证器，再运行 scripts、packages、apps、tests 中的 `*.test.{mjs,js,cjs,ts,mts,cts}`，排除 `*.render.test.*`；不支持的测试后缀报错。原生 TS 执行不代替类型检查 |
| `typecheck` | 先构建契约验证器，再检查 `apps/cloud` 的 TypeScript，包含共享契约导入用例 |
| `test:browser` | CI 固定镜像内运行完整 huashu 的四画幅真实取帧、原生变量编辑和 15/30 秒有声整片导出；见[原生运行时](../../packages/native-motion/README.md) |
| `test:cloud-local` | 以 SQLite／R2 和模型／容器响应夹具验证原生方向等待、创作／改稿、整片提交、取消与恢复；不产生模型费用，不代替真实云验 |
| `build:validators` | 将当前十二个 Schema（原生工程 1.0.0、业务结构 3.0.0）预编译为 ESM；Workers 不在请求内编译 Ajv |
| `test:native` | 原生清单与路径边界、导演编排、源码版本、媒介证据、物理停止恢复及实际／未知模型账本的最小离线集 |

云部署／集成目前使用 [Actions 工作流](../../apps/cloud/README.md)，评测使用 [research/evals 的 Node 入口](../../research/evals/README.md)。`build:containers`、`cloud:dev`、`cloud:deploy`、`test:cloud`、`eval`、`upstream:diff` 尚不是已登记的 mise 命令；有真实实现时再加入，不建空脚本。

检查范围是 Git 跟踪文件和未被忽略的新文件。渲染产物放 `artifacts/`；不能让生成的报告进入文档遍历，也不把媒体文件读成文本。新增 package/app 时同步其依赖和 lockfile；浏览器与媒体测试使用 `*.render.test.*`，外部集成测试随模块加入独立命令和 CI。新增根级 package script 同步登记 mise task，仓库检查自动核对，不创建空脚本占位。

## 2 里程碑与退出关口

本章是 S0–S3 和 M1–M4 的唯一实施／出口清单；[技术设计](../plans/cloud-motion-v3.md)说明能力范围，[实施状态](../implementation-status.md)说明实际完成度。S0 契约就绪后，网站／交易工作可独立推进，但 S2 仍须等 S1 出口。

| 切片 | 实施内容 | 退出条件 |
| --- | --- | --- |
| S0 契约与工具链 | 业务 v3 契约、原生工程清单、预编译校验、固定工具链与云骨架 | 相关仓库、契约和类型检查通过 |
| S1 一条龙 | 完整 huashu 原生创作、预览、改稿、整片导出；Hypit 导演方法；预算／回执／恢复；六题首轮 | G1 通过；创作模型 p50≤$0.70、p95≤$1.20；既定时间目标达标；负责人正常速度视听愿意发布≥4/6 |
| S2 客户预览与完整 QA | 独立域名原生播放器、直接改值、时间／元素批注、动态 Q0/Q1/Q2、完整攻击语料与四画幅准备 | 成本／时间目标达标；攻击与 QA 变异按预期；作品愿意发布≥5/6且两类用户各≥2 |
| S3 素材与上线准备 | 客户素材处理、ASR／确认转写、受控抓取、声音与用户经验；观测告警 | 完整管线关口通过；未验证或 P1 能力不因源码存在自动开放 |
| M1 Studio与用户流程 | 两类用户的试用／先购、素材事实、方向、预览、批注、恢复、声音、目标与移动UI | 可自助完成流程，02的UI-01–UI-08通过 |
| M2 可靠交付 | 客户D1／账本／队列、冻结、Waffo、按需编码和发布版本登记 | 真实并发、计量、补目标、退款、删除与历史重放通过 |
| M3 团队与运营 | 邀请／审阅／冲突／清理，成本／归因／质量面板与用途页 | **G2**：M1–M3真实集成通过，费用可对账 |
| M4 上线与有限试运营 | 性能／安全／平台上传、正式收款退款、域名发信／政策／回滚 | 06／12发布条件通过；达到下述G3才扩大获客 |

**S1 原生切换**：用户已授权接入完整 huashu 的原生创作／预览／改稿／整片路径，并退出旧协议、执行器和分片链。原生 HTML／GSAP／SVG／Canvas／Three.js 在隔离容器里执行；完整攻击语料、动态 QA、作品质量和真实云端性能仍须通过对应出口，不能把引擎接通当成 SaaS 上线。

**G1 云端检查点**：固定预发布镜像的 broker、分离 UID／Chromium 沙箱、原生 2D／WebGL 性能与并发、字体／视频／seek、真实取消／终止／restart 防重放、物理回收与结算。详细范围见[技术设计§10.2](../plans/cloud-motion-v3.md#102-g1-云端检查点)。旧分片接缝矩阵退役；内存峰值继续按既有平台限制保持未验证。实测不足不能自行提高性能或费用目标。

**完整管线关口**：完整原生模板和真实素材四画幅创作、预览、改稿与声音；固定镜像和 staging 的创建→选择方向→成片→改稿→目标准备与账本；完整动态 QA、隔离攻击、目标用户视听以及既定成本／性能目标。离线 mock 或单个编码样例不能替代。

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

应用按 `apps/cloud`（控制面）与 `apps/render-container`（预览／整片容器）分工；`packages/native-motion` 直接连接完整上游，`packages/contracts` 统一清单与身份，`packages/methods` 管理原生导演和上游方法。其余客户素材／播放器模块随真实实现加入，不建空入口。职责见[技术设计](../plans/cloud-motion-v3.md#31-代码归属)。

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

CI 的 [checks](../../.github/workflows/checks.yml) 包含 `contracts` 与 `browser`，可手动只选必要一项；contracts 验证原生编排、边界和账本，browser 实际构建并离线运行 huashu，不访问模型或部署云端。独立 [staging 部署](../../.github/workflows/cloud-deploy.yml) 仅显式手动部署或只读检查，不自动开始影片或付费模型评测。最终发布仍核对实际 SHA 的必要检查。

长期验收证据按06移到受控存储。Agent无法读取CI时，由有权限的执行方交回精确commit SHA、run ID/attempt、各job结果，以及关联的报告、样片和环境文件；核对环境/镜像/浏览器摘要和实际覆盖，不能仅凭“已通过”的文字结论。拿不到结果就保留受影响的项未验证，不改lock绕过环境校验。确定性样例可重新生成，模型作品或试听材料不能只留命令/hash；受跟踪文档不链接仅本地存在的产物。

首次生产冻结时按14建立发布版本登记；当前未发布草稿直接更新，不建 legacy 目录。已购作品的环境继承、修复和保留按14执行，不用浮动 latest 重放。媒体许可见09，关键实测按06留证，不另写迁移日记。

官方入口：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[compatibility date](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Containers](https://developers.cloudflare.com/containers/get-started/)、[浏览器截图差异](https://playwright.dev/docs/test-snapshots)。实施日重新核对。

## 4 环境与交付

各模块随实现提交请求/响应契约、权限和错误测试、运行配置；数据库模块同时提交 migrations 和真实 D1 并发验证。首个云模块提供可用的 `.dev.vars.example` 和 wrangler 配置，列明实际绑定、变量用途及环境来源。认证、发信和支付区分本地 mock、真实 test 与 production，不提交密钥，也不用 mock 通过代替集成验收。

appUrl、回调、发信和支持地址取 brand/routes/auth。密钥只交给需要它的可信服务，沙箱不带凭据；新增服务纳入费用预算。完成报告写清变更、实际验证、未实现项、样片/费用和外部条件；仅在能力变化时更新实施进度。

验证按 AGENTS 的最小检查规则执行，不默认跑全套测试或为每次提交触发 CI。CI 结果只描述所验证的提交；后续未改变相关代码、配置和输入时直接复用，不因快进合并或纯文档修改重跑全量。必须验证的当前问题只做一次最小检查，失败先分析日志和产物。需要 CI 时记录实际提交和覆盖范围；生产发布仍要求最终发布 SHA 的必需检查通过。

平台规则比较由 [select-ci-baseline.mjs](../../scripts/select-ci-baseline.mjs) 选择main上最近成功祖先，PR用base SHA；API／网络异常和无法证明最近祖先均阻断，不退回HEAD或全零。仓库固定初始基线只用于API明确零成功历史且该提交为严格祖先的情况，不能由环境变量替换。本地可用 `PROMOBENTO_BASE_REF` 指定已核实基线；`origin/main=HEAD` 可比较未提交改动。算法限额与特殊条件在脚本维护，不在文档复制实现。

失败先区分代码错误与 runner/网络故障；前者修复或安全 revert，后者修复环境，是否再验证仍按最小检查规则判断，不自动重跑 CI。接入生产部署时，只部署该 SHA 必需检查全部成功的产物；被取消不算成功。推送方式及远端前移处理统一按 AGENTS。
