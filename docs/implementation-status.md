# 当前实施状态

当前为 PRD **v3.0**、协议 **3.0.0**。按[云端动效管线方案](plans/cloud-motion-v3.md)实施：**S0 已完成，S1 尚未完成**。已加入九积木、OM/clip、渲染/声音控制器和内部云端编排代码；媒体检查、正式 G1、六题成片与负责人正常速度试听尚未完成。客户网站、认证、购买、冻结交付与生产 Agent 均未开放。

[六张事实卡](../research/evals/README.md)为 DeepSeek、MiniMax、Duolingo、IELTS Ready、Marugoto Japanese Online Course、Hugging Face LLM Course。负责人已确认官网可核对的功能/课程内容用于**本次内部评测**；不使用虚构成绩、收益或业绩，不公开成片。来源与许可线索已记录，素材本体尚未采集到预发布 R2；事实确认不等于素材清权。

网关 Claude 最新两轮复测丢图，C/F 已改绑官方 Anthropic Opus/Sonnet。负责人决定暂不添加 `ANTHROPIC_API_KEY`，这两项真实集成保留未验证。导演预检在任何付费调用前检查后续必需的密钥；缺失时停止，不暗中降级或先消费其他模型。原始证据见[模型探针](evidence/2026-10-23-model-probe/README.md)。

| 部分 | 已有代码/材料 | 仍缺的实现或验收 |
| --- | --- | --- |
| 契约 | 12 个 v3 Schema 与派生积木参数的预编译校验；新增私有 render_task、事实整理/冷审结构；共享 film-v1 文件身份、分段规划、PNG 接缝比较 | 产品 `production.schema.json` 的 Manifest/Composition、冻结与计费仍为旧结构，尚未迁移；内部 filmSourceHash 不替代它 |
| 片子运行时 | 页面、shim、engine；九个 ★ 积木、四画幅布局、cut/crossfade/push/whip；暂停 GSAP、固定参考 OM/clip 通用函数；PTS 视频帧清单与有界缓存；字体 cmap/缺字检查 | 上轮冷 seek 差异 0.2827% 超过 0.1%，已修定时器泄漏、隐藏镜头和固定栅格化参数，新媒体检查待结果；实际黄金帧仍待查看；WebGL 积木、自写镜头、纹理/布局覆盖未实现 |
| 渲染容器 | [四种模式](../apps/render-container/README.md)；独立 uid、沙箱自检；JPEG92→FFmpeg、PNG 接缝帧、CDP 阅读停留观测；H.264 分段、MP4/AAC 拼接、码率/PTS/GOP/颜色检查与真实帧封面；review 540p/15 fps | 新代码尚未完成实际媒体验收；阅读停留观测不是完整动态 Q1/Q2；生产形态 supervisor、studio 回收和 broker 需正式 G1 |
| 声音 | [DSP/ABC/音效与 CC0 采样接入](../packages/audio/src/NOTICE.md)；不可变 AudioPlan、与积木共用事件点、授权检查、48 kHz 双声道、两遍 loudnorm 与最终响度测量 | 13 风格各 30 秒的试听生成入口已接入媒体检查，尚未产出/试听；显式 lead-in 音效计划及导演的外部音轨/ABC 准入仍需补齐 |
| 云端 | [内部 staging 链路](../apps/cloud/README.md)：RenderWorkflow、ShardDO、CoordinatorDO、OperationDO、broker；generation 栅栏、lease、私有 R2、outbox、D1 内部任务/费用预留与结算迁移；[手动 Actions 部署](../.github/workflows/cloud-deploy.yml) | 未部署这些产品形态代码、未应用新迁移；未完成正式 G1、整体期限/重试/故障恢复与计费对账；全流程本地 mock 尚缺。生产配置保持关闭 |
| 导演 | OperationWorkflow 的 A–C/E/F 代码与方向选择 waitForEvent；两种流式适配器、缓存、授权、阶段调用/费用预留、真实 usage 结算 | 官方线路按负责人决定未接通；方向关键帧、完整阶段 mock、环境健康预检、历史费用衔接和失败修复仍需完善；六题真实调用、成本/时间指标未测 |
| 素材与模型配置 | 固定 OFL 字体与六个 CC0 乐器采样；官网事实卡；模型能力按最新网关证据修正 | 实际素材采集、逐项许可证据与预发布 R2 入库未完成；资产容器/ASR/抓取在 S3；官方模型真实能力未测 |
| 网站/业务 | Studio 离线参考、品牌、政策正文、共享业务契约 | 客户 Studio、Google/邮箱认证、租户权限、试用/购买账本与 Waffo、真实冻结交付均未实现 |

## 当前有效证据

- **本地构建/类型**：Node 26.12.0、pnpm 12.14.0、TypeScript 7.0.2、Wrangler 4.152.0。已修复私有任务 Schema 的 strictRequired 与 Worker RPC/Workflow 类型错误；预编译生成、cloud 和 runtime/blocks 类型检查通过。未重复运行全量 Node 测试或完整 CI。
- **本次媒体检查**：准备只运行一次受影响的最小 CI：新增管线/D1 预留 SQL、两种模型适配器、六张确认卡，以及离线 Chromium/媒体链路。结果未出，不能记作通过。
- **Cloudflare 已实测范围仍仅是临时探针**：[G1 预探针](evidence/2026-10-23-g1-pre-probe/README.md)与[S1 前置探针](evidence/2026-10-23-pre-s1-probe/README.md)覆盖 sandbox、broker/断网、实例停止/回收、Workflow 事件、捕获格式、WebGL 单帧耗时与冷启动；它们不替代正式镜像和新代码的 G1。

继续完成媒体主链路与现有失败，再补云端缺口、正式 G1 和真实评测。S1 出口仍包括方案规定的时间/成本指标，以及负责人正常速度试听愿意发布不少于 4/6；暂不进入 S2。生产 `agent-policy.enabled=false` 保持不变。
