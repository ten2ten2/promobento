# 实施顺序与交付

先读 [AGENTS](../../AGENTS.md)、[PRD 索引](README.md)和[实际进度](../implementation-status.md)，再按下列未完成阶段推进。本章统一接手步骤、里程碑、工具链与交付要求；文档、离线参考和返回成功的空脚本不能替代产品实现。

## 1 接手与当前命令

新工作区：

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
mise trust
mise install
mise run install
mise run check:repo
mise run check:contracts
mise run test:contracts
mise run check:agent-reference
```

已有工作区先保留未提交改动并同步 remote main，不覆盖他人的提交。当前产品为 v2.5，请求协议为 2.5.0；按 01 的范围和 14 的契约实施，不恢复已删除的旧规则。修改文档、配置、契约与 UI 时同步消费者；更新模板或其输入后运行 `mise run build:agent-reference`。

| 任务 | 实际范围 |
| --- | --- |
| `install` | pnpm 冻结安装 |
| `check:repo` | 当前文档、链接、配置、路由、认证、主题与契约一致性 |
| `check:contracts` | Schema 样例、语义、hash、合法目标与 API 清单 |
| `test:contracts` | 协议反例、CAS、计量、状态、授权引用及内容身份参考测试 |
| `build:agent-reference` | 从模板、tokens、预设与商品配置生成离线 Studio 参考 |
| `check:agent-reference` | 参考同步性、合法目标和样例边界 |

应用 dev/build/test:e2e/test:render/test:billing/test:auth/check:i18n/test:appearance/deploy/smoke 在真实实现时加入，不能用空脚本占位。备用 Node 可运行兼容检查，但须报告实际版本及缺少的固定工具链验证，不得称已通过 mise/Node/pnpm 全环境验证。

## 2 里程碑与退出关口

| 阶段 | 实施内容 | 退出条件 |
| --- | --- | --- |
| M0a 本地自由创作 | GSAP-free 绝对时间运行时与 huashu-motion 本地基线对照；Director/Treatment、原创镜头、关键帧、ABC/SFX、字幕、MP4/QA | 下述真实作品、盲审、确定性与全费用基准通过 |
| M0b Cloudflare 准入 | 同源包的构建/workerd、字形、PTS 抽帧、seek、WebGL、子帧成本、回收隔离；并行最小 Google/邮箱/Waffo test | **G1**：M0a 与真实目标实例通过，完成完整成本情景和下述预算/反滥用门槛；无账户保持 NOT_TESTED |
| M1 Studio 与用户流程 | 试用/先购入口、素材与事实、方向、隔离预览、多批注一轮、候选/CAS/恢复、声音、目标与移动 UI | 两类用户可自助完成流程；02 的 UI-01–UI-08、混排及真实音轨可用 |
| M2 可靠交付 | D1 唯一性、账本/队列、全目标冻结、购买意图、四 SKU 的 Waffo 权益与延迟编码 | 版本计量、补目标、退款依赖、删除、授权证据和版本化运行恢复实测 |
| M3 团队与运营 | 邀请、审阅、冲突、清理、成本/归因/质量面板与用途页 | **G2**：M1–M3 的 06 真实集成、并发/重放/退款/删除与恢复验收通过，费用可对账 |
| M4 生产上线与有限试运营 | 性能、安全、平台上传、实际收款退款、域名发信、正式条款及回滚 | 06/12 的外部门槛通过后开展有限试运营；达到下述 **G3** 才扩大获客 |

**M0a 按三个纵向任务交付，后项使用前项的真实产物：**

| 顺序 | 输入与实施时交付 | 通过条件与人工参与 |
| --- | --- | --- |
| 1. 运行时到本地成片 | 按13/14及帧协议实现 `packages/composition-runtime` 的创作 API、绝对时间/子帧采样和声明读取；本地 harness 接通 Chromium、PTS 抽帧、冻结混音、FFmpeg 与 Q0/Q1/Q2。随代码交付可运行的 `test:render`、输入示例和产物路径 | 同一来源冷启、顺/逆向及重试采样一致；15/30秒音画与编码通过06。命令和运行时尚未实现前不能登记通过 |
| 2. 两个授权题目到自有作品 | 在实施时交付 `research/m0a/` 题目卡、事实/素材清单与09许可记录，并固定两种候选模型、方法包版本及每题费用上限；接通 Director、代码、声音、改稿、全目标准备 | 两个题目各产出可播放成片、报告及完整费用记录；素材本体保存在受控位置，清单记录hash。人工确认素材授权、事实和正常速度试听，缺项明确等待，不伪造 |
| 3. 作品对照到准入判断 | 扩为下述12组对照，实施时交付一条可复跑基准的命令及输入/产物说明；保留实际执行日志、费用和盲审结果 | 确定性、质量及完整费用达到下述门槛。盲审由未参与制作的目标用户完成，Agent不代投票 |

**作品基准：** 6 个题目（软件3、课程/数字产品3）×15/30秒，共12组；每组使用相同素材、模型候选和费用上限，对比固定 huashu-motion 本地 GSAP 基线与 PromoBento GSAP-free 管线，必要时各做一轮相当范围的改稿。基线仅限隔离研究。目标用户按「愿意公开发布」盲审并记录人数、偏差；暂定至少8/12组获认可且认可率不低于基线。小样本仅用于工程准入，不证明市场转化。

**费用基准：** 按07的F/R/A/D/E记录实际模型输入/输出及缓存、生成/改稿/修复、素材/字幕/混音、四构图七target的准备/QA、编码、重试和基础设施费用。估算05各商品用满权益，并做q=5%/10%/20%情景；记录每个新增构图的边际成本。60%贡献和F阈值仅是07的敏感性算例，不能作自动停项线。费用不满足事前预算时按07 §4.3依次优化缓存、响应式/定点修复、按意图准备和实测模型，仍不成立再提出价格/权益决策；现行试用、四SKU及付款前冻结边界不自动改变。

**G1 运行预算：** 首次向客户开放真实免费云任务前，完成身份/素材权限、一次试用claim、费用预留与累计、单操作/滚动/全局预算和风险限流的实测，配置具体阈值及暂停/恢复条件。不得等到M2才补保护；未知价格或预算保持关闭。M0a在隔离材料和环境中研究，M0b在2–4 vCPU目标实例验证06要求；缺外部账户可继续无生产数据研究，不能承诺已可接客或收款。

**G3 试运营关口：** 两类用户各至少 3 个独立、非赠送的付费交付；成熟 30 天队列扣除剩余权益预计履约成本后，满足事前确定的贡献目标和最大试用损失预算，同时达到作品质量与可靠性门槛。试运营前冻结目标、样本窗口、费用上限、止损条件和负责人。G1/G2 不要求尚不存在的市场数据；G3 不以少量实收、问卷报价或增量利润代替完整核算。关口失败时修复或停止新增成本，保留查询、退款、既有下载和已收款任务恢复。

## 3 代码责任与可复现工具链

应用责任为 web、api、jobs、agent-runner、renderer；共享类型、身份计算、运行时、音频、QA、账本、数据库及UI按实际依赖组织packages。规范实现共用一份，脚本导入它，不复制到生产模块；不以空目录凑模块或擅自更换云/数据库。

权威来源按 PRD 索引划分：`project_revisions` 是唯一版本实体，routes 注册 URI，agent-api 绑定 Schema，14 定义状态、hash、引用和计量，12 定义认证例外。示例是工程输入，不代表运行成功；生产边界拒绝 `exampleOnly`。购买 snapshot、内容身份和首次交付集合分别处理。

mise 管理工具与任务，pnpm 管理依赖；精确版本在 `.mise.toml`、`package.json`，复现使用 `pnpm-lock.yaml`。版本选择顺序为目标平台支持、依赖兼容、范围内正式发布、精确锁定、目标环境实测。初始化或主动升级时查官方兼容性，不以本机现有版本作依据；普通文档/业务修改不自动升级，也不声称当前锁定版始终是最新版。非稳定 SDK 须记录采用理由、风险、实测与替换条件。

| 环境 | 验证要求 |
| --- | --- |
| 本地/CI | 实际 OS/架构、mise/Node/pnpm 版本、冻结安装和检查 |
| Workers Builds | 显式同步工具安装路径/变量，干净检出可构建，不假定平台自动读取 mise |
| workerd | 固定 compatibility_date/flags/bindings；实测 SSR、认证、签名、存储和队列，Node engines 不能代替 |
| Composer/Renderer | 目标 Linux 架构、基础/应用镜像 digest、Node/Chromium/FFmpeg/字体/系统库；M0b 实测复杂片和隔离 |
| 客户浏览器 | 支持范围内的实际 UI、hydration、字体、预览与帧协议；明确设备差异 |

依赖、镜像和资源均可追溯，不以浮动 latest 重放已购源包。新增依赖在可信构建流程离线审核、锁版本、核查生命周期脚本和许可证；动画代码不能任意安装或联网。媒体、字体和采样许可另按 09 核实。选型例外写入对应模块配置/说明，关键实测按 06 留证，不另建持续堆积的迁移日志。

官方实施入口：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[compatibility](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Node APIs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[Containers](https://developers.cloudflare.com/containers/get-started/)。实施日核实，链接存在不代表当前环境兼容。

## 4 环境与交付

M1/M2按模块同时交付实现、机器合同和运行配置，不先写一套无人执行的完整模板：

- API按04的实施清单补齐请求、响应、权限及错误；前后端共用生成类型和完整Schema校验，具体跨字段/状态不变量仍在可信服务执行。
- 数据模块提交实际migrations，在真实D1验证14的唯一键、外键、并发及退款/消费仲裁；实体名清单或DDL文本检查不能代替执行。
- 首个本地/云模块随实现提供可用的 `.dev.vars.example` 和 wrangler配置，列明实际D1/R2/Queues/DLQ/DO/AI/EMAIL绑定、变量用途、机密性及local/staging/production取值来源。本地/CI认证、发信和Waffo适配有明确mock模式，真实test及production验证分别记录；不提交密钥或以mock通过宣称实际集成成功。

可信appUrl、回调、发信和支持地址取brand/routes/auth。密钥仅交给需要它的可信Worker，沙箱不带凭据；新增服务同时纳入全局预算。

完成报告列出变更、实际命令/环境、成功与失败、未实现 P0、样片、费用、恢复及外部账户条件。普通检查写提交/CI；关键验收按 [06](06-testing-and-release.md#5-发布与证据) 留证。仅在真实状态变化时更新实施进度。产品交付包含实际迁移、锁文件、部署运维、许可、安全与健康/回滚，不以规格完整声称可运行。

CI在push main及PR上使用固定mise工具链、冻结安装和当前检查，随实现增加真实应用验证；不强制以PR交付。提交直接快进remote main，推送前核对远端预期提交，前移时先读取整合再检查，禁止强推。合入后的CI须绑定最终提交复核；并行工作先汇总到同一提交再推送，不并发覆盖main。清理文档不改写Git历史或删除用户作品及财务版本。
