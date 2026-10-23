# 当前实施状态

当前为 PRD **v3.0**、协议 **3.0.0**。按[云端动效管线方案](plans/cloud-motion-v3.md)实施：**S0 已完成，S1 尚未完成**。已加入九积木、OM/clip、渲染/声音控制器和内部云端编排代码；15 秒工程样片的实际媒体链路已通过；正式 G1、六题成片与负责人正常速度试听尚未完成。客户网站、认证、购买、冻结交付与生产 Agent 均未开放。

[六张事实卡](../research/evals/README.md)为 DeepSeek、MiniMax、Duolingo、IELTS Ready、Marugoto Japanese Online Course、Hugging Face LLM Course。负责人已确认官网可核对的功能/课程内容用于**本次内部评测**；不使用虚构成绩、收益或业绩，不公开成片。来源与许可线索已记录，素材本体尚未采集到预发布 R2；事实确认不等于素材清权。

网关 Claude 最新两轮复测丢图，C/F 已改绑官方 Anthropic Opus/Sonnet。负责人决定暂不添加 `ANTHROPIC_API_KEY`，这两项真实集成保留未验证。导演预检在任何付费调用前检查后续必需的密钥；缺失时停止，不暗中降级或先消费其他模型。原始证据见[模型探针](evidence/2026-10-23-model-probe/README.md)。

| 部分 | 已有代码/材料 | 仍缺的实现或验收 |
| --- | --- | --- |
| 契约 | 12 个 v3 Schema 与派生积木参数的预编译校验；新增私有 render_task、事实整理/冷审结构；共享 film-v1 文件身份、分段规划、PNG 接缝比较 | 产品 `production.schema.json` 的 Manifest/Composition、冻结与计费仍为旧结构，尚未迁移；内部 filmSourceHash 不替代它 |
| 片子运行时 | 页面、shim、engine；九个 ★ 积木、四画幅布局、cut/crossfade/push/whip；暂停 GSAP、固定参考 OM/clip 通用函数；PTS 视频帧清单与有界缓存；字体 cmap/缺字检查 | 旧横屏逆序 seek 差异 0.2827% 超过 0.1%，完整四画幅 seek 矩阵仍未完成。已修 ui-journey 退场面板、CDP 画外点选与卡片拆词；15 秒三段出片和 108 张四画幅帧图通过，已查看实际卡片、课程、旅程与名牌画面；WebGL 积木、自写镜头、纹理/布局覆盖未实现 |
| 渲染容器 | [四种模式](../apps/render-container/README.md)；独立 uid、沙箱自检；JPEG92→FFmpeg、PNG 接缝帧、CDP 阅读停留观测；H.264 分段、MP4/AAC 拼接、码率/PTS/GOP/颜色检查与真实帧封面；review 540p/15 fps | 15 秒工程片已验证 450 帧、1080p/30 fps、AAC、PTS/GOP/颜色、体积/码率和接缝；阅读停留观测不是完整动态 Q1/Q2；生产形态 supervisor、studio 回收和 broker 需正式 G1 |
| 声音 | [DSP/ABC/音效与 CC0 采样接入](../packages/audio/src/NOTICE.md)；不可变 AudioPlan、与积木共用事件点、授权检查、48 kHz 双声道、两遍 loudnorm 与最终响度测量 | 13 风格各 30 秒已生成，11 种通过响度/真峰值；guofeng、synthwave 的母带越界正按实际测量做有界修复，未记为通过；负责人尚未试听；显式 lead-in 音效计划及导演的外部音轨/ABC 准入仍需补齐 |
| 云端 | [内部 staging 链路](../apps/cloud/README.md)：RenderWorkflow、ShardDO、CoordinatorDO、OperationDO、broker；generation 栅栏、lease、私有 R2、outbox、D1 内部任务/费用预留与结算迁移；[手动 Actions 部署](../.github/workflows/cloud-deploy.yml) | 未部署这些产品形态代码、未应用新迁移；未完成正式 G1、重试/故障恢复与计费对账；整体期限和用户等待排除已写入代码，未云验；全流程本地 mock 尚缺。生产配置保持关闭 |
| 导演 | OperationWorkflow 的 A–C/E/F 代码与方向选择 waitForEvent；两种流式适配器、缓存、授权、阶段调用/费用预留、真实 usage 结算 | 官方线路按负责人决定未接通；三方向实际 keyframeFilm/studio 取帧与排除用户等待的 20 分钟期限已写入代码，尚未云验；完整阶段 mock、环境健康预检、历史费用衔接和失败修复仍需完善；六题真实调用、成本/时间指标未测 |
| 素材与模型配置 | 固定 OFL 字体与六个 CC0 乐器采样；官网事实卡；模型能力按最新网关证据修正 | 实际素材采集、逐项许可证据与预发布 R2 入库未完成；资产容器/ASR/抓取在 S3；官方模型真实能力未测 |
| 网站/业务 | Studio 离线参考、品牌、政策正文、共享业务契约 | 客户 Studio、Google/邮箱认证、租户权限、试用/购买账本与 Waffo、真实冻结交付均未实现 |

## 当前有效证据

- **本地构建/类型**：Node 26.12.0、pnpm 12.14.0、TypeScript 7.0.2、Wrangler 4.152.0。已修复私有任务 Schema 的 strictRequired 与 Worker RPC/Workflow 类型错误；预编译生成、cloud 和 runtime/blocks 类型检查通过。未重复运行全量 Node 测试或完整 CI。
- **最小单元检查**：[39975166855](https://github.com/ten2ten2/promobento/actions/runs/39975166855)，提交 `7e36090`：9 项管线/D1 预算 SQL、适配器和事实卡检查通过，后续直接复用。该轮媒体检查暴露的画外点选与文字拆词已修复。
- **实际媒体**：[39977612586](https://github.com/ten2ten2/promobento/actions/runs/39977612586)，提交 `3e97498`：15 秒、450 帧、1920×1080/30 fps、有 AAC 的 MP4（5,660,439 bytes），滑动一秒峰值码率 7,635,752 bit/s；首接缝最大通道差 1、差异像素 0.00463%，次接缝完全相同，均通过原门槛。混音 −13.99 LUFS、−1.36 dBTP；九积木四画幅 108 帧已产出。job 最终失败仅因 guofeng/synthwave 两种 30 秒配乐的母带越界，不影响上述媒体子项证据。影片与截图已下载至本机 `artifacts/s1-media-39977612586/`；不再重跑这些已通过子项。
- **声音修复**：只对测得越界的母带执行一次补偿增益与 4× 过采样限幅，随后按原响度/真峰值与样本数门槛检查；已经通过的母带不改字节。仅验证上述两种失败风格，未重跑视频、九项单元检查或全矩阵。
- **Cloudflare 已实测范围仍仅是临时探针**：[G1 预探针](evidence/2026-10-23-g1-pre-probe/README.md)与[S1 前置探针](evidence/2026-10-23-pre-s1-probe/README.md)覆盖 sandbox、broker/断网、实例停止/回收、Workflow 事件、捕获格式、WebGL 单帧耗时与冷启动；它们不替代正式镜像和新代码的 G1。

继续完成媒体主链路与现有失败，再补云端缺口、正式 G1 和真实评测。S1 出口仍包括方案规定的时间/成本指标，以及负责人正常速度试听愿意发布不少于 4/6；暂不进入 S2。生产 `agent-policy.enabled=false` 保持不变。
