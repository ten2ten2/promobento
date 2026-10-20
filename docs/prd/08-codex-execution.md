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

已有工作区先保留未提交改动并同步 remote main，不覆盖他人的提交。当前产品为 v2.4，请求协议为 2.4.0；按 01 的范围和 14 的契约实施，不恢复已删除的旧规则。修改文档、配置、契约与 UI 时同步消费者；更新模板或其输入后运行 `mise run build:agent-reference`。

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
| M0b Cloudflare 准入 | 同源包的构建/workerd、字形、PTS 抽帧、seek、WebGL、子帧成本、回收隔离；并行最小 Google/邮箱/Waffo test | **G1**：M0a 与真实目标实例验证通过，完成免费队列成本情景并标定可执行预算；无账户保持 NOT_TESTED |
| M1 Studio 与用户流程 | 试用/先购入口、素材与事实、方向、隔离预览、多批注一轮、候选/CAS/恢复、声音、目标与移动 UI | 两类用户可自助完成流程；02 的 UI-01–UI-08、混排及真实音轨可用 |
| M2 可靠交付 | Schema/权限、D1 唯一性、成本账本/预算/队列、全目标冻结、购买意图、Waffo 权益、延迟编码 | 版本计量、补目标、退款依赖、删除、授权证据和版本化运行恢复实测 |
| M3 团队与运营 | 邀请、审阅、冲突、清理、成本/归因/质量面板与用途页 | **G2**：M1–M3 的 06 真实集成、并发/重放/退款/删除与恢复验收通过，费用可对账 |
| M4 生产上线与有限试运营 | 性能、安全、平台上传、实际收款退款、域名发信、正式条款及回滚 | 06/12 的外部门槛通过后开展有限试运营；达到下述 **G3** 才扩大获客 |

**M0a 作品基准：** 先以 2 个有授权题目完成端到端冒烟，再完成 6 个题目（软件 3、课程/数字产品 3）× 15/30 秒的 12 组对照。每组在相同素材、模型候选和费用上限下，分别以固定上游 huashu-motion 本地 GSAP 基线和 PromoBento GSAP-free 管线制作，必要时各做一轮范围相当的改稿；基线仅限隔离研究，不打包或上线。由不参与制作的目标用户按「愿意公开发布」盲审，记录人数和偏差。暂定退出门槛为至少 8/12 组获认可，且认可率不低于基线。该小样本仅为工程准入，不能证明市场转化；自动测试数不能代替作品质量。

**M0a 成本基准：** 逐题记录模型输入/输出与提示缓存、生成/修复/改稿、素材/字幕/音轨、四构图和七个合法 target 的准备与 Q0/Q1、重试、CPU/容器/存储等实际费用和耗时。按 05 的各项权益估算用满成本，并按 07 做 q=5%/10%/20% 及 A/D/E 敏感性分析；不将研究样本称为真实转化或已盈利。响应式优先，记录新增构图边际费用；购买并导出前完成目标来源，不以收款后调用模型掩盖准备成本。模型价格和硬预算仍未标定，只有同等质量、全部费用与上界经实测，才能提出配置变更。

M0a 使用隔离素材和运行环境；M0b 未通过可继续无生产数据研究，不开放客户任意代码或收款承诺。认证、授权和计量须在对应能力向用户开放前完成。M0b 在 2–4 vCPU 目标实例上验证；全局容器限制见 04/配置，具体运行验收见 06。

**G3 试运营关口：** 两类用户各至少 3 个独立、非赠送的付费交付；成熟 30 天队列扣除剩余权益预计履约成本后，满足事前确定的贡献目标和最大试用损失预算，同时达到作品质量与可靠性门槛。试运营前冻结目标、样本窗口、费用上限、止损条件和负责人。G1/G2 不要求尚不存在的市场数据；G3 不以少量实收、问卷报价或增量利润代替完整核算。关口失败时修复或停止新增成本，保留查询、退款、既有下载和已收款任务恢复。

## 3 代码责任与可复现工具链

应用责任为 web、api、jobs、agent-runner、renderer。按实现需要建立 contracts、composition-runtime、creative-director、audio-engine、quality-engine、agent-orchestrator、platform-presets、billing、auth、db、ui、i18n、brand 等 packages，不建立空目录凑模块，不擅自更换云或数据库。

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

可信 appUrl、回调、发信和支持地址来自 brand/routes/auth，不从任意 Host 或前端 origin 拼接。D1/R2/Queues/DLQ/DO/AI/EMAIL 及新增计算类别均受全局预算；Google/OTP/CSRF/Waffo/服务间和模型密钥只给可信 Worker，沙箱不带凭据。没有真实模型、价格和预算不得启用客户执行。

完成报告列出变更、实际命令/环境、成功与失败、未实现 P0、样片、费用、恢复及外部账户条件。普通检查写提交/CI；关键验收按 [06](06-testing-and-release.md#5-发布与证据) 留证。仅在真实状态变化时更新实施进度。产品交付包含实际迁移、锁文件、部署运维、许可、安全与健康/回滚，不以规格完整声称可运行。

提交直接快进 remote main；推送前检查 expected head，远端前移时先读取整合，不强推覆盖他人提交。清理失效文档不等于改写 Git 历史或删除用户作品和财务版本数据。
