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
| `check:repo` | 当前文档链接、锚点和变量；配置、路由、认证、主题、平台规则版本；PRD/协议版本入口；v2 旧标识符不得出现（方案与留证目录除外）；并执行契约与离线参考检查 |
| `check:contracts` | 生产 Schema 样例、语义、摘要、合法目标与 API 清单；目标与画幅、分段并发；模型配置与授权、价格目录一致 |
| `test` | 先构建验证器，再运行 scripts、packages、apps、tests 中的 `*.test.{mjs,js,cjs,ts,mts,cts}`，排除 `*.render.test.*`；不支持的测试后缀报错。原生 TS 执行不代替类型检查 |
| `typecheck` | 先构建契约验证器，再检查 `apps/cloud` 和 `packages/film-runtime`/`blocks` 的 TypeScript，包含共享契约导入用例 |
| `build:film-runtime` | 构建 Node 页面生成器及可信浏览器 shim、engine、首批三个积木 |
| `test:browser` | CI 隔离测试容器内运行首批积木的四画幅正序、逆序、冷 seek、实际布局/字体、桥接与虚拟时钟回归；本机直接调用明确失败，见[运行时说明](../../packages/film-runtime/README.md) |
| `build:validators` | 把全部 11 个 v3 Schema（含单位经济）预编译为独立 ESM 验证器及类型声明；Workers 从 `@promobento/contracts/validators/<name>` 导入，见[共享契约库](../../packages/contracts/README.md) |
| `build:agent-reference` / `check:agent-reference` | 生成并核对离线 Studio 参考 |

`build:containers`、`cloud:dev`、`cloud:deploy`、`test:cloud`、`eval`、`upstream:diff` 随 S1–S3 的真实实现加入，见[改造方案](../plans/cloud-motion-v3.md)第 13 节。

检查范围是 Git 跟踪文件和未被忽略的新文件。渲染产物放 `artifacts/`；不能让生成的报告进入文档遍历，也不把媒体文件读成文本。新增 package/app 时同步其依赖和 lockfile；浏览器与媒体测试使用 `*.render.test.*`，外部集成测试随模块加入独立命令和 CI。新增根级 package script 同步登记 mise task，仓库检查自动核对，不创建空脚本占位。

## 2 里程碑与退出关口

动效管线按[云端动效管线改造方案](../plans/cloud-motion-v3.md)第 14 节的切片 S0–S3 推进；网站、交易、团队与上线按 M1–M4，可在 S0 契约就绪后并行。切片只决定顺序和检查点，终版能力都在方案内实现；保留现有检查契约，不把已知失败或未运行项记为通过，每个切片结束时如实更新实施状态。

| 切片 | 实施内容 | 退出条件 |
| --- | --- | --- |
| S0 清场与契约 | 删除 v2 旧链路（受限源码执行、旧绘制 profile、本地研究控制器）；迁出字体、CC0 采样与契约底层；v3.0 Schema、`film-runtime.d.ts`、`render-protocol.d.ts` 3.0.0、预编译验证器；模型配置与授权；TypeScript 工具链与 `apps/cloud` 骨架。不调用付费模型 | `check:repo`、`test`、`typecheck` 通过 |
| S1 一条龙 | film-runtime 与 ★ 积木、渲染容器（Chromium 沙箱、CDP 捕获、分段与拼接、声音）、Worker/Workflows/DO/broker/D1/R2、分阶段导演 A–C、E、F 及两种模型适配器、程序配乐与 CC0 采样 | **G1** 通过；积木版创作的模型费用 p50 ≤ $0.70、p95 ≤ $1.20；方向卡、积木草稿与 30 秒成片达到方案第 1.2 节的时间目标；负责人按正常速度试听愿意发布的不少于 4/6 |
| S2 自写镜头、QA 与改稿 | 自写镜头合同与 Q0 静态规则、阶段 D 与 E 完整版；Q1（CDP）与 Q2；分流改稿、直接改值、增量渲染与改稿证据 | 方案第 14 节 S2 出口 |
| S3 素材、其余能力与上线准备 | 资产容器与 AssetWorkflow、ASR 与转写确认、网址抓取；其余积木与转场、课程类方法；配乐调整；可观测性与验收 | 方案第 14 节 S3 出口 |
| M1 Studio 与用户流程 | 试用/先购、素材事实、方向、本地预览、多批注改稿、恢复、声音、目标和移动 UI | 两类用户可自助完成流程，02 的 UI-01–UI-08 通过 |
| M2 可靠交付 | D1、账本/队列、冻结、Waffo 权益、延迟编码和发布版本登记 | 真实并发、计量、补目标、退款、删除与旧版重放通过 |
| M3 团队与运营 | 邀请、审阅、冲突、清理、成本/归因/质量面板与用途页 | **G2**：M1–M3 的真实集成验收通过，费用可对账 |
| M4 生产上线与有限试运营 | 性能、安全、平台上传、正式收款退款、域名发信、政策及回滚 | 06/12 的发布条件通过；达到下述 **G3** 才扩大获客 |

**G1 云端检查点**（未通过不进入 S2）：在预发布账户上执行方案第 12.3 节第 1–9 项的首轮，覆盖纯 2D 和一个 3D 积木；据此修订时间目标、渲染期限、捕获格式与段数，以及 WebGL 的实例规格。开放免费云任务前，还要实测身份与素材权限、一次试用领取、费用预留、预算、限流和暂停/恢复；未知价格或限额保持关闭。

Chromium 沙箱是自写镜头的隔离前提。云端实例上沙箱降级（例如无法以独立 uid 运行或 seccomp 不可用）时，必须有负责人的书面决定才能继续，否则停止执行自写镜头。

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

应用按 `apps/cloud`（Worker、Workflows、DO、broker）、`apps/render-container`、`apps/asset-container` 分工；共享契约、片子运行时、积木、声音、预览播放器、导演方法与字体按实际依赖组织为 packages，不建空模块。目录见[改造方案](../plans/cloud-motion-v3.md)第 3.1 节，规则归属见 [PRD 索引](README.md)，共享算法只保留一份。

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

CI 支持手动 `workflow_dispatch`。[工作流](../../.github/workflows/checks.yml)当前有 `contracts` 和首批可信积木的 `browser` job。后者只构建并运行离线测试镜像，截图与报告随 artifact 提供，不部署服务；生产控制器、全部积木与 G1 继续随 S1 验证。`cloud-local` 与 `deploy` 随云端实现加入。临时探针（如 [G1 预探针](../evidence/2026-10-23-g1-pre-probe/README.md)）运行后删除云端资源。

长期验收证据按06移到受控存储。Agent无法读取CI时，由有权限的执行方交回精确commit SHA、run ID/attempt、各job结果，以及关联的报告、样片和环境文件；核对环境/镜像/浏览器摘要和实际覆盖，不能仅凭“已通过”的文字结论。拿不到结果就保留受影响的项未验证，不改lock绕过环境校验。确定性样例可重新生成，模型作品或试听材料不能只留命令/hash；受跟踪文档不链接仅本地存在的产物。

首次生产冻结时按14建立发布版本登记；当前未发布草稿直接更新，不建 legacy 目录。已购作品的环境继承、修复和保留按14执行，不用浮动 latest 重放。媒体许可见09，关键实测按06留证，不另写迁移日记。

官方入口：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[compatibility date](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Containers](https://developers.cloudflare.com/containers/get-started/)、[浏览器截图差异](https://playwright.dev/docs/test-snapshots)。实施日重新核对。

## 4 环境与交付

各模块随实现提交请求/响应契约、权限和错误测试、运行配置；数据库模块同时提交 migrations 和真实 D1 并发验证。首个云模块提供可用的 `.dev.vars.example` 和 wrangler 配置，列明实际绑定、变量用途及环境来源。认证、发信和支付区分本地 mock、真实 test 与 production，不提交密钥，也不用 mock 通过代替集成验收。

appUrl、回调、发信和支持地址取 brand/routes/auth。密钥只交给需要它的可信服务，沙箱不带凭据；新增服务纳入费用预算。完成报告写清变更、实际验证、未实现项、样片/费用和外部条件；仅在能力变化时更新实施进度。

验证按 AGENTS 的最小检查规则执行，不默认跑全套测试或为每次提交触发 CI。CI 结果只描述所验证的提交；后续未改变相关代码、配置和输入时直接复用，不因快进合并或纯文档修改重跑全量。必须验证的当前问题只做一次最小检查，失败先分析日志和产物。需要 CI 时记录实际提交和覆盖范围；生产发布仍要求最终发布 SHA 的必需检查通过。

平台规则比较使用 main 上相同检查工作流中、按 Git 祖先距离最近的成功提交；运行时间不决定距离，失败/取消不推进基线。选择器先从一页成功历史发现候选，再对候选与 HEAD 之间的祖先逐 SHA 分批核验，避开全局筛选列表上限及旧提交反复重跑的排序问题；最多128次请求、总期限60秒，单次请求最多30秒且不能超过剩余期限，Git子进程共用总期限。超预算明确失败，不将已找到但未证实最近的候选当作基线；PR 使用其 base SHA。

只有 API 明确返回零成功历史时，`ten2ten2/promobento` 才可使用脚本内固定的初始基线 `a55939e4e080b4a0731b0b43315b22d0ad7ec902`，且该提交必须为 HEAD 的严格祖先。不得用环境变量替换初始 SHA。API/网络失败、异常响应、已有成功历史却无合格祖先均阻断，不退回 `event.before`、HEAD 或全零 SHA。CI 显式基线必须为严格祖先；本地允许用 `origin/main=HEAD` 比较尚未提交的改动。默认比较已获取的上游，无上游时才按工作区状态比较 HEAD/HEAD^；可用 `PROMOBENTO_BASE_REF` 显式指定已核实基线。

失败先区分代码错误与 runner/网络故障；前者修复或安全 revert，后者修复环境，是否再验证仍按最小检查规则判断，不自动重跑 CI。接入生产部署时，只部署该 SHA 必需检查全部成功的产物；被取消不算成功。推送方式及远端前移处理统一按 AGENTS，并行工作汇总后推送。
