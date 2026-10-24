# 当前实施状态

当前为 PRD **v3.0**、协议 **3.0.0**。按[云端动效管线方案](plans/cloud-motion-v3.md)实施：**S0 已完成，S1 尚未完成**。15 秒 2D 和 30 秒/24 分段 WebGL 工程片均已在正式形态 staging 完成配套音频、出片、提交及私有下载；正式 G1、六题成片与负责人正常速度试听尚未完成。客户网站、认证、购买、冻结交付与生产 Agent 均未开放。

[六张事实卡](../research/evals/README.md)为 DeepSeek、MiniMax、Duolingo、IELTS Ready、Marugoto Japanese Online Course、Hugging Face LLM Course。负责人已确认官网可核对的功能/课程内容用于**本次内部评测**；不使用虚构成绩、收益或业绩，不公开成片。除 IELTS Ready 外的五题已有 [8 张实际素材](../research/evals/materials.json)，逐张查看并存入私有 staging R2，来源/字节/尺寸/许可与 D1 权利记录齐全，图片不进 Git。IELTS 源请求返回 403，素材仍待获准的公开截图；未用虚构画面替代。

网关 Claude 最新两轮复测丢图，C/F 已改绑官方 Anthropic Opus/Sonnet。负责人决定暂不添加 `ANTHROPIC_API_KEY`，这两项真实集成保留未验证，模型登记的 `verified=false`；官网能力说明不能充当探针通过。关闭执行时允许保存待接通绑定；启用和付费调用仍拒绝未验证模型。导演预检在任何付费调用前检查所有后续必需的密钥与验证状态；缺失时停止，不暗中降级或先消费其他模型。原始证据见[模型探针](evidence/2026-10-23-model-probe/README.md)。

目前 staging Worker 尚未绑定两家供应商的运行时模型密钥；历史探针使用的 Actions 密钥不会自动成为 Worker secret。模型步骤恢复时仍须通过既有批准渠道绑定、核实官方能力，并完成历史费用确认；当前不调用模型。

| 部分 | 已有代码/材料 | 仍缺的实现或验收 |
| --- | --- | --- |
| 契约 | 14 个 v3 Schema 与派生积木参数预编译，含新增内部音乐准入；film-v1 Composition（identityVersion 2）、构建记录与冻结参考校验；内容/产物指纹及同画幅视频复用，平台 mapping/授权仍分开；旧 v1 入口和内容摘要保留重放；帧协议支持互斥的 aspectId 新包络与 targetId 历史包络 | 客户草稿、真实冻结事务和计费服务仍在 M1/M2；自写镜头/直接改值按 S2 接入，不能把参考校验当成已上线服务 |
| 片子运行时 | 页面、shim、engine；九个 ★ 积木、四画幅布局、cut/crossfade/push/whip；暂停 GSAP、OM/clip、PTS 视频帧缓存和字体检查；2D 四画幅顺序/逆序/独立冷 seek 的 72 次比较通过；真实 Three.js 0.186.1 设备积木、按需 3D bundle、ready/dispose 与锁定 SwiftShader 校验；四画幅 WebGL 逆序/冷 seek 的 20 次比较完全一致，30 秒/24 段成片的 23 处接缝零差异，已看实际画面 | 正式性能/并行 G1 待验。自写镜头、全局纹理/布局覆盖未实现 |
| 渲染容器 | [四种模式](../apps/render-container/README.md)；独立 uid、沙箱自检；JPEG92→FFmpeg、PNG 接缝帧、共享计划的精确 CDP 阅读停留观测；H.264 分段、MP4/AAC 拼接、码率/PTS/GOP/颜色与真实封面；15 秒 2D、30 秒 WebGL 成片已通过；review 540p/15 fps | 阅读停留观测不是完整动态 Q1/Q2；完整 supervisor、studio 回收、攻击/故障与 broker G1 仍待验 |
| 声音 | [DSP/ABC/音效与 CC0 采样接入](../packages/audio/src/NOTICE.md)；不可变 AudioPlan、共用积木事件点、授权检查、48 kHz 双声道、两遍 loudnorm；13 风格 30 秒母带数值已通过。四种 lead-in 与程序配乐的 30 秒混音（−14 LUFS、−1.4 dBTP）已纳入实际 MP4 交付；导演上传音乐/ABC 准入已部署，实际 PCM 和导演传输有本地检查 | 外部音乐/ABC 真实导演路径与负责人试听待验；旁白准入仍未开放 |
| 云端 | [内部 staging 链路](../apps/cloud/README.md)：15 秒 2D 与 30 秒 WebGL 出片、观测/接缝、拼接、提交及私有下载通过；24 分段与音频共用 24 个工作区名额。共享预算与历史清单已部署；真实中途取消、原生强制终止后落业务终态/物理停止结算、清空检查点的 restart 防重放均通过，保留首因与未知费用；真实导演缺密钥已验证零消费落失败 | 历史模型总额未对账；完整 G1 性能/安全等仍未完成。cgroup 峰值按负责人决定为 null 加原因，内存指标待验；生产关闭 |
| 导演 | OperationWorkflow 的 A–C/E/F 与方向选择 waitForEvent；两种流式适配器、缓存、授权、阶段调用/费用预留、usage 结算与响应补账；SQLite/SSE 离线回放通过。准备失败首因 outbox、候选/通知原子提交、两轮修复、镜像/沙箱/broker/R2 取帧预检与 studio 所有权已部署；真实缺密钥预检零消费失败通过 | 官方 C/F 按负责人决定未接通；成功导演路径、三方向实际 keyframeFilm/studio 与 20 分钟期限未云验；响应补账仅本地回放，历史费用未确认、模型付费门槛关闭；六题真实调用与模型成本/时间指标未测 |
| 素材与模型配置 | 固定 OFL 字体、六个 CC0 乐器采样、六题确认事实；五题 8 张真实素材已查看并入私有 R2/D1，含来源/尺寸/字节身份和 HF 原许可通知；模型能力按最新网关证据修正 | IELTS Ready 源站 403，素材待补；六题成片尚未使用这些素材。客户资产容器/ASR/抓取仍在 S3；官方模型真实能力未测 |
| 网站/业务 | Studio 离线参考、品牌、政策正文、共享业务契约 | 客户 Studio、Google/邮箱认证、租户权限、试用/购买账本与 Waffo、真实冻结交付均未实现 |

## 当前有效证据

- **2D 四画幅修复**：[40061965273](https://github.com/ten2ten2/promobento/actions/runs/40061965273)，提交 `38e6b25`：[报告及反例](evidence/2026-10-24-s1-runtime/README.md)。标题停稳改用 `transform:none` 后，四画幅顺序/逆序/独立冷 seek 的 72 次比较通过；36 次逆序均零差异，只有横屏冷 132 帧最大差 1 / 0.0142746914%，在原容差内。字体/布局、CTA/URL 点选、时钟、禁止 API、session/dispose、超长文字及 30 秒边界均通过，已看实际四画幅。`will-change` 候选的失败保留在证据中并已撤回；未重做媒体、13 风格或导演。仓库/契约/Studio 命令的自动预编译也已恢复，当前本地检查通过；全量 Node/类型未重跑。
- **本地构建/类型**：Node 26.12.0、pnpm 12.14.0、TypeScript 7.0.2、Wrangler 4.152.0。已修复私有任务 Schema 的 strictRequired 与 Worker RPC/Workflow 类型错误；预编译生成、cloud 和 runtime/blocks 类型检查通过。未重复运行全量 Node 测试或完整 CI。
- **最小单元检查**：[39975166855](https://github.com/ten2ten2/promobento/actions/runs/39975166855)，提交 `7e36090`：9 项管线/D1 预算 SQL、适配器和事实卡检查通过，后续直接复用。该轮媒体检查暴露的画外点选与文字拆词已修复。
- **实际媒体**：[39977612586](https://github.com/ten2ten2/promobento/actions/runs/39977612586)，提交 `3e97498`：15 秒、450 帧、1920×1080/30 fps、有 AAC 的 MP4（5,660,439 bytes），滑动一秒峰值码率 7,635,752 bit/s；首接缝最大通道差 1、差异像素 0.00463%，次接缝完全相同，均通过原门槛。混音 −13.99 LUFS、−1.36 dBTP；九积木四画幅 108 帧已产出。job 最终失败仅因 guofeng/synthwave 两种 30 秒配乐的母带越界，不影响上述媒体子项证据。影片与截图已下载至本机 `artifacts/s1-media-39977612586/`；不再重跑这些已通过子项。
- **声音修复**：[39980871364](https://github.com/ten2ten2/promobento/actions/runs/39980871364)，提交 `494d48c`：只对测得越界的母带执行一次补偿增益与 4× 过采样限幅。guofeng −14.03 LUFS / −1.24 dBTP，synthwave −14.02 LUFS / −1.33 dBTP，均为 1,440,000 个样本帧，按原门槛通过。已下载至 `artifacts/s1-audio-39980871364/`。之前通过的 11 种母带不改字节；未重跑视频、九项单元检查或全矩阵。
- **离线导演与登记**：Node 26.12.0 下新增 7 项阶段回放和受影响的 6 项模型配置/计价检查通过；修复 mock 使用旧生成验证器与 SQLite batch 的测试适配问题后，只复验失败分支。未调用任何真实模型，未重跑已有九项管线/适配器检查或媒体。`verified` 现在只表示实际集成证据，官方线路保持 false。
- **film-v1 产品契约**：新构造器、完整冻结参考准入、画幅视频/平台 mapping 身份、A→B→A 恢复及旧版摘要兼容的单项检查通过（363 ms）。帧协议新旧包络的定点检查通过（136 ms）；首次只发现测试夹具引用旧 revisionId，修正后仅复验该项。未重跑媒体、导演或完整 CI；新结构不自动改写旧作品或对迁移再次收费。
- **失败恢复与提交边界**：Node 26.12.0 下只运行一次受影响的两份检查文件，7 项通过（总计 633 ms）；覆盖原云端回执的实际提交回放、准备失败落终态、真实 SQLite 原子提交/通知重试/取消栅栏、历史行修复/未知费用保留，以及停止与晚到执行竞态。cloud TypeScript 7.0.2 定点检查通过。未重跑原媒体/配乐/导演；后续部署范围见 WebGL 云验，完整云端故障恢复仍待验。
- **WebGL 实现的定点检查**：新增页面/积木识别、代价分段及期限检查通过（68 ms）；因 RenderWorkflow 的期限计算改为共享方法，同时回放受影响的已生成回执提交路径（205 ms，通过）。运行时/积木及 cloud TypeScript 7.0.2 检查通过；真实画面与云端行为另见下项。
- **真实 WebGL 四画幅**：[40046230859](https://github.com/ten2ten2/promobento/actions/runs/40046230859)，提交 `ca1c37e`：[回执与范围](evidence/2026-10-24-s1-staging/README.md#新-webgl-积木四画幅逆序与冷-seek-通过)。8 个独立 studio 生命周期，四画幅 0/12/45/375 逆序及新实例冷 45 帧的 20 次比较全为零差异；真实 WebGL2/SwiftShader 匹配环境锁，已查看四画幅和横竖屏首尾画面，停止/lease/取消/密钥回收通过。历史取消操作的残留行已对账；未重跑 2D 成片、配乐、模型或完整 CI，不代替正式 G1 性能/中途取消/重启。
- **30 秒 WebGL 首次阻断**：[40050568828](https://github.com/ten2ten2/promobento/actions/runs/40050568828)，提交 `1af113f`：[原始诊断与计划](evidence/2026-10-24-s1-staging/README.md#30-秒-webgl计算通过观测覆盖校验阻断)。24 分段与声音共 25 次计算成功、停止并结算，共 95,309 usd_micros 保守资源上界，无未结费用；混音 1,440,000 样本帧、−14 LUFS、−1.4 dBTP。该轮因 Worker 错误要求每段观测非空而阻断，无成片；修复全局计划的精确覆盖与确定性 QA 重试后，交付结果见下一项。
- **30 秒 WebGL 修复后交付**：[40051873501](https://github.com/ten2ten2/promobento/actions/runs/40051873501)，提交 `fe3df1e`：[完整回执](evidence/2026-10-24-s1-staging/README.md#修复后30-秒-webgl24-分段配乐与交付通过)。900 帧、1080p/30 fps/AAC、14,681,738 bytes，23 处接缝零差异，精确观测/拼接/提交/私有下载通过；26 次计算均停止结算，保守上界 94,041 usd_micros，无未结费用。读到 passed 为 126.118 秒，harness 137.269 秒，不作 p50/p95。已看封面和实际 MP4 的 45/450/870 帧；峰值内存未验证，未代替六题正常速度验收。
- **Lead-in 音效**：新增单项 PCM 对齐检查通过（1.326 秒），含 whip 的非整数帧前导、片头裁切与原始波形样本比较。首次发现 riser/reverse 的现有 DSP 比请求时长多一个样本，已分别冻结请求时长与实际源长度；没有修改通用 DSP 或重做 13 种配乐。新路径后续部署/混音/交付见上述两轮 30 秒记录。
- **满载排队**：Node 26.12.0 下仅运行新增的容量等待项（828 ms，通过），覆盖无名额时不预留费用、取得 lease 后继续、等待中停止、alarm 设置失败不泄漏名额；cloud TypeScript 7.0.2 通过。后续 24 分段加声音的真实执行/停止与结算见上述 30 秒记录；正式并行分布/主动取消 G1 仍待验。
- **首次 staging 部署**：[39983255933](https://github.com/ten2ten2/promobento/actions/runs/39983255933)，提交 `546f411`：新迁移、镜像构建/推送、Worker/DO/Workflow/队列部署均成功；内部请求在密钥写入后立即返回 404，集成未通过、未启动影片任务。一次性密钥已经删除；不把部署成功记为 G1 通过。
- **云端分段故障**：[39985471319](https://github.com/ten2ten2/promobento/actions/runs/39985471319)仅复用已部署 `546f411`：声音产出 720,000 样本帧；画面分段 ENOENT，未提交成片。随后[只读诊断 39986268511](https://github.com/ten2ten2/promobento/actions/runs/39986268511)确认四次计算均已结算，保守资源上界合计 7,845 usd_micros；操作已取消。发现一个已停止/结算的 attempt 仍标 active，已加入终态确认停止后的记录修复入口，不按数据库旧状态重启计算。
- **并发结算修复**：新增一项 stop/timeout 并发的定点回放通过（27 ms）；固定同一份持久 usage，D1 `INSERT OR IGNORE` 后核对原结算，冲突不能覆盖。未重跑前述 7 项导演回放或已通过媒体。
- **正式镜像 studio 与环境**：[39987356301](https://github.com/ten2ten2/promobento/actions/runs/39987356301)，提交 `3942ffc`：[验收记录与回执](evidence/2026-10-24-s1-staging/README.md)。真实云端 45→375→45 的 PNG 完全一致，已查看实际开场/CTA；studio 已关闭、操作已取消、并发已归还、临时密钥已删。确认三个 cgroup 峰值路径均未暴露；预检阻断，没有再次完整渲染。旧故障操作的一条残留 active 记录已确认停止后修复，无未结费用。镜像与 Worker 部署成功不等于完整 G1 通过。
- **云端工程片提交修复**：[40040999452](https://github.com/ten2ten2/promobento/actions/runs/40040999452)，Worker 提交 `f5b431a`、复用 `860df13` 构建的未变镜像：15 秒、450 帧、1080p/30 fps/AAC、5,320,462 bytes，完整出片/提交/私有下载通过，两处接缝完全一致，lease 归还；harness 113.865 秒。已查看封面和实际 MP4 解码的开场/产品/CTA 三帧。峰值为 null 加明确原因，G1 内存未验证。此前一轮计算成功但最终提交 `NOT_JSON`，经只读 Workflow 步骤定位后修复，没有放宽 JCS；新增峰值契约和实际提交回放各只跑一次最小本地检查，未重跑配乐/导演/全量 CI。[报告与失败记录](evidence/2026-10-24-s1-staging/README.md)。
- **前置环境证据**：[G1 预探针](evidence/2026-10-23-g1-pre-probe/README.md)与[S1 前置探针](evidence/2026-10-23-pre-s1-probe/README.md)另覆盖攻击、broker/断网、停止/回收、Workflow 事件、捕获格式、WebGL 单帧耗时与冷启动；未覆盖的正式代码 G1 项目仍待验证。

历史模型费用已从四份原始报告整理为 [128 次请求清单](evidence/2026-10-23-model-probe/README.md#历史费用128-次请求尚未对账)：114 次按冻结目录估算 255,521 usd_micros，14 次未知；负责人暂时没有供应商统计，历史总额仍未确认。独立共享研究 D1 已由 [40054228740](https://github.com/ten2ten2/promobento/actions/runs/40054228740) 创建；跨环境原子预算、原始响应持久化/原价补账已有最小本地回放，并随 `8acc356` 部署；历史清单已实际导入，确认总额仍为 null。原独立付费探针 Actions 已停用；历史未对账时拒绝新的付费模型请求，媒体工作继续。

新增平台恢复的 5 项本地回放通过（672 ms），cloud TypeScript 7.0.2 通过。[40055971723](evidence/2026-10-24-s1-staging/README.md#真实取消原生终止与整次重启防重放通过) 在 `8acc356` 原生验收通过中途取消、强制终止恢复和整次 restart 不重复计算，8 个实例均实际停止/结算，共 5,119 usd_micros 保守上界，无未结；没有重跑完整成片。job 最终失败于导演预检等待 60 秒；确定性准入改为零重试后，[40056929096](evidence/2026-10-24-s1-staging/README.md#导演确定性预检修复通过零模型媒体消费) 在 `eb4843a` 只部署 Worker、复用原镜像并单独通过该分支：首因与实际故障文件齐全，0 模型请求、媒体计算及费用预留，未重复前三项恢复。五题素材入库另经已有 Wrangler 连接和临时内部入口完成，无模型或容器调用，未再触发 CI。其余性能/安全矩阵、IELTS 素材及六题作品评测仍待完成。

G1 新增 `g1-performance` 场景，分别采集纯 2D/WebGL 的 10 次串行与 4 路并发 30 秒影片；逐帧、实例启动/容量等待、串行/并发分布、接缝/CPU flags、实际停止和保守费用均保留原始数据。新增汇总/历史回执兼容/缺数据拒绝的单项本地检查通过（Node 26.12.0，138 ms），15 个验证器生成通过；尚未运行真实矩阵，不把代码存在记作性能通过。

S1 出口仍包括方案规定的时间/成本指标，以及负责人正常速度试听愿意发布不少于 4/6；暂不进入 S2。生产 `agent-policy.enabled=false` 保持不变。
