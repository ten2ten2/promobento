# 当前实施状态

**S0 已完成；S1 有内部制作代码，但真实云端、作品质量和性能尚未验收。** 生产创作开关为 `config/agent-policy.json` 中的 `enabled:false`，`S1_ENABLED=off`。这里记录实际能力；产品目标和验收标准见 [PRD](prd/README.md)。

## 已有代码和缺口

| 范围 | 已实现 | 仍需完成或验收 |
| --- | --- | --- |
| 原生制作 | 固定完整 huashu-motion v0.3.1（`52467f99c602b76ba86d511d37acdfe93fa1e16e`）；独立容器、Chromium 沙箱、Broker、不可变工程及文件身份校验 | 新镜像的真实 Cloudflare 部署、隔离和资源限制实测 |
| AI 导演 | 方法 2.1.0：真实素材整理、Brief/Treatment、方向预览、参考片抽帧观察、正式 Script/语义事件、素材候选与锁定、四画幅创作及版本化改稿 | 参考片音轨尚未分析；真实模型、完整作品质量、模型全局 RPM/TPM 需验证 |
| 视频和 QA | 15/30 秒原生 MP4、四构图、音频/编码检查；FFmpeg 全片解码、黑屏/静止/静音和响度检查、12 帧审片图；技术阻断的影片与报告留在私有存储 | 负责人正常速度观看/试听、复杂影片和云端性能实测 |
| 调度和费用 | D1/R2、Queue/Workflow、租约与 generation 栅栏、取消和恢复、费用预留/回执与未知费用保留；流式媒体和资源采样 | 真实 1/4/16/64 并发、内存峰值、费用与故障恢复验收 |
| SaaS 基础架构 | Web 的 React Router SSR/静态资源白名单、流式 API 网关；CoreApi/PreviewGateway 命名入口；Preview 空壳；带原因的 D1 断言批写/幂等读回及可重试错误映射；多 Worker workerd 测试台 | 首次 G1a 的 staging D1、服务绑定、固定镜像恢复和部署中在途任务接管；Web/Preview 的 Access 域名尚未配置 |
| 客户业务 | 品牌、路由、平台、交易与身份规划；实现清单中的客户 API 仍为空 | Studio、Google/邮箱登录、客户上传/ASR、权限、Waffo、成片冻结与正式交付均未接入 |

内部 API 见[控制面](../apps/cloud/README.md)，实际渲染边界见[容器](../apps/render-container/README.md)，模型用量与未知费用处理见[模型适配](../packages/models/README.md)。已完成的内部流程不等于客户功能上线。原始录屏最大 50 MiB，原生执行包单文件最大 40 MiB；客户上传后的转码/片段归一化尚未实现。

## 验证和部署

- 仓库提供契约、离线导演、恢复与费用测试，以及固定容器的真实 Chromium/FFmpeg 测试。它们验证代码和测试素材；**S1 还缺真实 staging 的模型、权限、音画、成本和高并发结果**。
- SaaS 的本地 workerd 测试覆盖真实 D1 回滚与并发、Web→CoreApi/Preview→PreviewGateway、原始流与 Cookie/重定向、未知路由和服务隔离；本地 SaaS 命令不要求 Chromium，Web hydration/CSP 测试仍在固定镜像中运行。部署工作流可在 Access 域名配置后探测 Web/Preview，但它们不替代 staging D1、真实服务绑定或 G1a 的在途渲染恢复。
- 最新可追溯的 staging 媒体/恢复报告属于旧执行架构，不能证明当前完整原生引擎已经部署。见[历史 staging 证据](evidence/2026-10-24-s1-staging/README.md)。
- 自动创作作品覆盖仍为 **1/12 输入、2/24 最终片**，负责人尚未认可整体发布质量；旧样片见[导演评测](evidence/2026-10-24-s1-director/README.md)。历史性能矩阵属于另一架构；当前容器内存峰值为 `unverified`，见[性能证据](evidence/2026-10-24-s1-performance/README.md)。

## 有效授权与费用

- [模型授权](../config/model-authorization.json)总上限为 **US$300**，但历史供应商总账未确认：`openingMicros:null`、`openingConfirmed:false`。2026-10-30 留存的本地快照为已结 **2,769,757**、15 笔未知预留 **1,052,499**，合计 **3,822,256 usd_micros**；这不是供应商账单，也不代表当前实时余额。
- staging 的临时费用放行已于 **2026-10-31（上海时间）** 过期。新付费模型调用须先对账或取得新的有效授权；未知费用继续占用预留。原始证据在[模型费用](evidence/2026-10-23-model-probe/README.md)和[导演回执](evidence/2026-10-24-s1-director/README.md)。

## 下一步

1. 基础架构合并后进行首次 G1a：真实 staging D1 断言批写与并发、命名绑定、固定镜像渲染/取消/物理停止/恢复、Core 部署期间在途任务接管及内存指标。此轮不调用付费模型。
2. 按[依赖顺序](prd/08-codex-execution.md#3-代码责任与可复现工具链)开发身份与会话，再做项目/试用/权益账本、上传、引擎适配和 Studio；这些模块可使用本地夹具开发，开放客户能力仍须各自验收。
3. S1 并行对账、确认新模型授权和完整原生 staging；补齐 **12 输入/24 最终片**、参考片/Script/候选复用/声音/全片 QA、负责人愿意发布至少 **4/6**，以及 [G1 的并发、内存、吞吐与总成本](prd/06-testing-and-release.md#真实高并发内存和经济性关口)。

历史运行时证据见 [runtime](evidence/2026-10-24-s1-runtime/README.md)；所有验收门槛只在 PRD 06/08 维护。
