# 当前实施状态

当前为 PRD **v3.0**、协议 **3.0.0**。按[云端动效管线方案](plans/cloud-motion-v3.md)实施：**S0 已完成，S1 尚未完成**。已加入九积木、OM/clip、渲染/声音控制器和内部云端编排代码；15 秒工程样片已在正式形态 staging 完成出片、提交及私有下载；正式 G1、六题成片与负责人正常速度试听尚未完成。客户网站、认证、购买、冻结交付与生产 Agent 均未开放。

[六张事实卡](../research/evals/README.md)为 DeepSeek、MiniMax、Duolingo、IELTS Ready、Marugoto Japanese Online Course、Hugging Face LLM Course。负责人已确认官网可核对的功能/课程内容用于**本次内部评测**；不使用虚构成绩、收益或业绩，不公开成片。来源与许可线索已记录，素材本体尚未采集到预发布 R2；事实确认不等于素材清权。

网关 Claude 最新两轮复测丢图，C/F 已改绑官方 Anthropic Opus/Sonnet。负责人决定暂不添加 `ANTHROPIC_API_KEY`，这两项真实集成保留未验证，模型登记的 `verified=false`；官网能力说明不能充当探针通过。关闭执行时允许保存待接通绑定；启用和付费调用仍拒绝未验证模型。导演预检在任何付费调用前检查所有后续必需的密钥与验证状态；缺失时停止，不暗中降级或先消费其他模型。原始证据见[模型探针](evidence/2026-10-23-model-probe/README.md)。

| 部分 | 已有代码/材料 | 仍缺的实现或验收 |
| --- | --- | --- |
| 契约 | 12 个 v3 Schema 与派生积木参数预编译；新增 film-v1 Composition（identityVersion 2）、构建记录与冻结参考校验；内容/产物指纹及同画幅视频复用，平台 mapping/授权仍分开；旧 v1 入口和内容摘要保留重放；帧协议支持互斥的 aspectId 新包络与 targetId 历史包络 | 客户草稿、真实冻结事务和计费服务仍在 M1/M2；自写镜头/直接改值按 S2 接入，不能把参考校验当成已上线服务 |
| 片子运行时 | 页面、shim、engine；九个 ★ 积木、四画幅布局、cut/crossfade/push/whip；暂停 GSAP、OM/clip、PTS 视频帧缓存和字体检查；新增真实 Three.js 0.186.1 设备积木、按需 3D bundle、ready/dispose、真实 context 回执及锁定 SwiftShader 校验，尚待云验 | 2D 横屏 45→375→45 已完全一致，旧全矩阵逆序曾差 0.2827%，完整四画幅 seek 仍未完成。15 秒三段出片和 108 张四画幅帧图已有证据；新 WebGL 四画幅定点验收待运行。自写镜头、全局纹理/布局覆盖未实现 |
| 渲染容器 | [四种模式](../apps/render-container/README.md)；独立 uid、沙箱自检；JPEG92→FFmpeg、PNG 接缝帧、CDP 阅读停留观测；H.264 分段、MP4/AAC 拼接、码率/PTS/GOP/颜色检查与真实帧封面；review 540p/15 fps | 15 秒工程片已验证 450 帧、1080p/30 fps、AAC、PTS/GOP/颜色、体积/码率和接缝；阅读停留观测不是完整动态 Q1/Q2；生产形态 supervisor、studio 回收和 broker 需正式 G1 |
| 声音 | [DSP/ABC/音效与 CC0 采样接入](../packages/audio/src/NOTICE.md)；不可变 AudioPlan、共用积木事件点、授权检查、48 kHz 双声道、两遍 loudnorm；13 风格 30 秒母带数值已通过。新增 whoosh/whip/riser/reverse 显式 lead-in 计划，样本级落点与片头裁切已本地检查，尚未进云端镜像 | 新 lead-in 母带/试听待验；负责人尚未试听已有风格，导演外部音轨/ABC 准入仍需补齐 |
| 云端 | [内部 staging 链路](../apps/cloud/README.md)：RenderWorkflow、ShardDO、CoordinatorDO、OperationDO、broker；15 秒云端出片、接缝/观测、拼接、提交及私有下载通过；studio 出图/关闭、逆序取帧与旧停止记录对账均有实测。新增准备阶段失败记录、sharding/verifying/assembling 状态、先栅栏后停止、持久停止标记、终态对账修复与成片/进度 outbox 原子提交，已有本地回放 | 新增恢复代码尚未部署；旧 `40038946955` 操作的遗留 sharding 行仍待明确对账，不重启该取消操作。平台重启/强制终止、完整重试与账单对账、正式 G1 未完成；cgroup 峰值按负责人决定为 null 加原因，内存指标仍待验；生产保持关闭 |
| 导演 | OperationWorkflow 的 A–C/E/F 与方向选择 waitForEvent；两种流式适配器、缓存、授权、阶段调用/费用预留、真实 usage 结算；固定 SSE、SQLite/R2 的离线阶段回放已通过，含 review 修复、冷审拒绝、12 小时用户等待排除、取消与未知消费保留预留 | 官方线路按负责人决定未接通；三方向实际 keyframeFilm/studio 取帧与 20 分钟期限尚未云验；环境健康预检、历史费用衔接和故障恢复仍需完善；六题真实调用、成本/时间指标未测 |
| 素材与模型配置 | 固定 OFL 字体与六个 CC0 乐器采样；官网事实卡；模型能力按最新网关证据修正 | 实际素材采集、逐项许可证据与预发布 R2 入库未完成；资产容器/ASR/抓取在 S3；官方模型真实能力未测 |
| 网站/业务 | Studio 离线参考、品牌、政策正文、共享业务契约 | 客户 Studio、Google/邮箱认证、租户权限、试用/购买账本与 Waffo、真实冻结交付均未实现 |

## 当前有效证据

- **本地构建/类型**：Node 26.12.0、pnpm 12.14.0、TypeScript 7.0.2、Wrangler 4.152.0。已修复私有任务 Schema 的 strictRequired 与 Worker RPC/Workflow 类型错误；预编译生成、cloud 和 runtime/blocks 类型检查通过。未重复运行全量 Node 测试或完整 CI。
- **最小单元检查**：[39975166855](https://github.com/ten2ten2/promobento/actions/runs/39975166855)，提交 `7e36090`：9 项管线/D1 预算 SQL、适配器和事实卡检查通过，后续直接复用。该轮媒体检查暴露的画外点选与文字拆词已修复。
- **实际媒体**：[39977612586](https://github.com/ten2ten2/promobento/actions/runs/39977612586)，提交 `3e97498`：15 秒、450 帧、1920×1080/30 fps、有 AAC 的 MP4（5,660,439 bytes），滑动一秒峰值码率 7,635,752 bit/s；首接缝最大通道差 1、差异像素 0.00463%，次接缝完全相同，均通过原门槛。混音 −13.99 LUFS、−1.36 dBTP；九积木四画幅 108 帧已产出。job 最终失败仅因 guofeng/synthwave 两种 30 秒配乐的母带越界，不影响上述媒体子项证据。影片与截图已下载至本机 `artifacts/s1-media-39977612586/`；不再重跑这些已通过子项。
- **声音修复**：[39980871364](https://github.com/ten2ten2/promobento/actions/runs/39980871364)，提交 `494d48c`：只对测得越界的母带执行一次补偿增益与 4× 过采样限幅。guofeng −14.03 LUFS / −1.24 dBTP，synthwave −14.02 LUFS / −1.33 dBTP，均为 1,440,000 个样本帧，按原门槛通过。已下载至 `artifacts/s1-audio-39980871364/`。之前通过的 11 种母带不改字节；未重跑视频、九项单元检查或全矩阵。
- **离线导演与登记**：Node 26.12.0 下新增 7 项阶段回放和受影响的 6 项模型配置/计价检查通过；修复 mock 使用旧生成验证器与 SQLite batch 的测试适配问题后，只复验失败分支。未调用任何真实模型，未重跑已有九项管线/适配器检查或媒体。`verified` 现在只表示实际集成证据，官方线路保持 false。
- **film-v1 产品契约**：新构造器、完整冻结参考准入、画幅视频/平台 mapping 身份、A→B→A 恢复及旧版摘要兼容的单项检查通过（363 ms）。帧协议新旧包络的定点检查通过（136 ms）；首次只发现测试夹具引用旧 revisionId，修正后仅复验该项。未重跑媒体、导演或完整 CI；新结构不自动改写旧作品或对迁移再次收费。
- **失败恢复与提交边界**：Node 26.12.0 下只运行一次受影响的两份检查文件，7 项通过（总计 633 ms）；覆盖原云端回执的实际提交回放、准备失败落终态、真实 SQLite 原子提交/通知重试/取消栅栏、历史行修复/未知费用保留，以及停止与晚到执行竞态。cloud TypeScript 7.0.2 定点检查通过。没有重跑媒体、配乐、导演或 CI；新增恢复路径未部署。
- **WebGL 实现的定点检查**：新增页面/积木识别、代价分段及期限检查通过（68 ms）；因 RenderWorkflow 的期限计算改为共享方法，同时回放受影响的已生成回执提交路径（205 ms，通过）。运行时/积木及 cloud TypeScript 7.0.2 检查通过。未重跑导演、配乐、旧媒体或完整 CI；真实 3D 画面与云端行为仍待定点验收。
- **Lead-in 音效**：新增单项 PCM 对齐检查通过（1.326 秒），含 whip 的非整数帧前导、片头裁切与原始波形样本比较。首次发现 riser/reverse 的现有 DSP 比请求时长多一个样本，已把请求时长与实际源长度分别冻结后只复验该项；没有修改通用 DSP、重做 13 种配乐或触发音频 CI。新路径未部署。
- **首次 staging 部署**：[39983255933](https://github.com/ten2ten2/promobento/actions/runs/39983255933)，提交 `546f411`：新迁移、镜像构建/推送、Worker/DO/Workflow/队列部署均成功；内部请求在密钥写入后立即返回 404，集成未通过、未启动影片任务。一次性密钥已经删除；不把部署成功记为 G1 通过。
- **云端分段故障**：[39985471319](https://github.com/ten2ten2/promobento/actions/runs/39985471319)仅复用已部署 `546f411`：声音产出 720,000 样本帧；画面分段 ENOENT，未提交成片。随后[只读诊断 39986268511](https://github.com/ten2ten2/promobento/actions/runs/39986268511)确认四次计算均已结算，保守资源上界合计 7,845 usd_micros；操作已取消。发现一个已停止/结算的 attempt 仍标 active，已加入终态确认停止后的记录修复入口，不按数据库旧状态重启计算。
- **并发结算修复**：新增一项 stop/timeout 并发的定点回放通过（27 ms）；固定同一份持久 usage，D1 `INSERT OR IGNORE` 后核对原结算，冲突不能覆盖。未重跑前述 7 项导演回放或已通过媒体。
- **正式镜像 studio 与环境**：[39987356301](https://github.com/ten2ten2/promobento/actions/runs/39987356301)，提交 `3942ffc`：[验收记录与回执](evidence/2026-10-24-s1-staging/README.md)。真实云端 45→375→45 的 PNG 完全一致，已查看实际开场/CTA；studio 已关闭、操作已取消、并发已归还、临时密钥已删。确认三个 cgroup 峰值路径均未暴露；预检阻断，没有再次完整渲染。旧故障操作的一条残留 active 记录已确认停止后修复，无未结费用。镜像与 Worker 部署成功不等于完整 G1 通过。
- **云端工程片提交修复**：[40040999452](https://github.com/ten2ten2/promobento/actions/runs/40040999452)，Worker 提交 `f5b431a`、复用 `860df13` 构建的未变镜像：15 秒、450 帧、1080p/30 fps/AAC、5,320,462 bytes，完整出片/提交/私有下载通过，两处接缝完全一致，lease 归还；harness 113.865 秒。已查看封面和实际 MP4 解码的开场/产品/CTA 三帧。峰值为 null 加明确原因，G1 内存未验证。此前一轮计算成功但最终提交 `NOT_JSON`，经只读 Workflow 步骤定位后修复，没有放宽 JCS；新增峰值契约和实际提交回放各只跑一次最小本地检查，未重跑配乐/导演/全量 CI。[报告与失败记录](evidence/2026-10-24-s1-staging/README.md)。
- **前置环境证据**：[G1 预探针](evidence/2026-10-23-g1-pre-probe/README.md)与[S1 前置探针](evidence/2026-10-23-pre-s1-probe/README.md)另覆盖攻击、broker/断网、停止/回收、Workflow 事件、捕获格式、WebGL 单帧耗时与冷启动；未覆盖的正式代码 G1 项目仍待验证。

接下来补 WebGL 与正式 G1，云验新增恢复路径，再完成真实素材和评测。S1 出口仍包括方案规定的时间/成本指标，以及负责人正常速度试听愿意发布不少于 4/6；暂不进入 S2。生产 `agent-policy.enabled=false` 保持不变。
