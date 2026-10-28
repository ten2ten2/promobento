# S1 导演与作品验收证据

**完整覆盖仍为 1/12 创作输入、2/24 最终片；此前两部 MiniMax 15 秒完整候选均未获负责人质量接受。** 本机横屏人工稿按负责人提出的出处标注条件通过画面质量，声音听感及竖屏尚未验证。当前实际能力、授权余额和下一步统一见[实施状态](../../implementation-status.md)，运行用法见 [evals](../../../research/evals/README.md)。本页保留决定验收和继续执行的证据，不逐轮记开发过程。

模型金额按实际 usage 和调用时冻结目录／汇率结算，不是已对账的供应商账单；无 usage 保留未知预留。计算金额是分配资源保守上界，和模型分开。

## 方法 1.5.0：横屏低清审片已生成，E 无用量截断

源码 `6204a149bc68b9c55ec806f971e6cb1544944be3` 的 [CI](https://github.com/ten2ten2/promobento/actions/runs/40481688976)及 [staging 部署](https://github.com/ten2ten2/promobento/actions/runs/40483086885)通过；renderer 为 `renderer-6204a149bc68`，实际镜像和完整回执见 [summary.json](custom-method150-attempt/summary.json)。方法 1.5.0 使用负责人批准的内部自写评测 30 分钟活动上限，适用范围见[期限契约](../../plans/cloud-motion-v3.md#611-预算限制与-effort)；本轮未触及新上限。

操作 `eval-minimax-15-1793094623437` 选择 Fit，以 Start／Resume／Reset 的真实状态作叙事锚点；C 生成一个 custom pet-story 和 CTA，D 一次布局／三次动作编辑完成。横竖各 11 张前向帧，逆序与新实例冷 seek 共 **24 次比较全零差异**，阅读无 BLOCK。

横屏 review 为 **15 秒、960×540、15 fps、225 帧、AAC**，耗时 **83.442 秒**，五处接缝零差异，实际 AAC **−14.15 LUFS／−1.46 dBTP**。renderId 为 `render-b5738fef9de01f95e229a7639029cc28de37807ffaf910a5`。Chrome **156.0.8078.48** 完整有声 1× 播放零掉帧／解码错误，从头重播有效。正常播放的帧回调取出八张实际解码帧，暂停／庆祝、署名与 CTA 可见；seeked 后立即 canvas 抽帧曾停留旧表面，该批截图已丢弃。

E 请求于上海时间 **2026-10-27 18:05:30.906** 派发，模型 `modelswitch/deepseek-v4.1-flash-1017`，callId **`eval-minimax-15-1793094623437-review-0`**。一个 write_spec 的参数在第 **5,225** 字符处字符串未结束，`usage:null`、`quote:null`，原响应私有保存。操作以 `MODEL_CALL_RECONCILIATION_REQUIRED` 停止，**40,505 usd_micros** 继续预留；账户负责人／供应商须按原 callId 核对，不重发或补造建议。

本轮 6 笔模型已结 **92,776**，1 笔未知 **40,505**；18 次计算均停止／结算 **32,531**，实际／预留合计 **165,812 usd_micros**。容量为空、临时密钥撤销。原片已按通过的渲染回执取回，本机私有审片页 `artifacts/s1-minimax-method150-2026-10-27/index.html`。负责人依据抽样实际帧判定画面质量不通过：空开场、长冻结、截图／指针跳动和正文／CTA 叠字，声音未试听；具体反馈已写入同一 summary。E 未完成、F 未运行、无高清横竖最终片。这个本机提取稿不等于自动 review-draft 分支云验或成功候选。

仅给三张图推镜的人工稿被负责人拒绝：缺少操作与结果的联系。后续真实操作版又收到倒计时拖沓、按钮过小、需求关系不清和声音对位不足的审片反馈。随后的**节奏修订版**使用已获准官方源片 **15–22.4 秒、25.8–29.733 秒**的原速操作，放大真实长按，标注并缩短倒计时，让结果文案靠近庆祝；结尾使用同一官方演示中的品牌字标。原源片在 27.733 秒混入一帧无关画面，已在抽帧时剔除；最后有效庆祝帧另停留约 0.67 秒。无新增模型或云调用。

本地自写镜头仅在独立 UID 的 Chromium 沙箱执行；源视频经帧拼图保留原速鼠标及界面响应。按 Start、暂停、恢复、剪辑点、庆祝和 CTA 的帧标记重混程序音乐与打击音效。横屏低清片为 15 秒、960×540／15 fps／225 帧，AAC **−14.12 LUFS／−1.35 dBTP**；八次逆序／未受影响帧比较零差异，九处文字观察无 BLOCK。Chrome **156.0.8078.48** 无头有声 1× 播放掉 **3/225 帧**，无页面或解码错误，重播有效；掉帧原因、实际桌面播放和音乐听感待确认。负责人判定此版仍不通过：录到的是案例成品的操作，而不是 MiniMax Agent 界面如何接收和完成任务。前一真实操作版曾在非无头播放掉 2/225 帧，原因未定位；其回执仍在 [summary.json](custom-method150-attempt/summary.json)。该稿输入、授权、源码和检查保存在本机私有 `manual-revision-rhythm/`；视频未加入自动导演素材清单，自动高清横竖最终片与 S1 覆盖数均不变。

负责人认为真实 Agent 稿的需求、构建、估价和预订确认已讲清，可在出处说明贯穿素材画面后按画面质量通过；当前修订只延长该说明至 12 秒片尾卡开始。审片使用负责人提供并表示获非公开内部评测剪辑许可的 [DevZoneX 桌面端教程](https://www.youtube.com/watch?v=Wn7Ijd2RBx4)：同一 ServiceKar 案例的原片 **646.2–648.0、1120.1–1123.7、1332.5–1334.0、1336.1–1337.6、1343.5–1345.3、1388.3–1390.1 秒**分别呈现真实需求提交、Agent 构建、选项操作、演示估价和预订确认。Processing 不足一秒；裁切排除客户信息和预订编号。保留源片动作，加入轻推镜和两处五帧叠化；源教程及本片均经剪辑，不表示生成耗时。片内注明来源、剪辑和作者披露的 MiniMax 赞助，不使用教程原声，金额仅为演示。

前后标志统一使用 [MiniMax 官网](https://agent.minimax.io/about)当前透明图形及矢量字标，按本次内部审片用途保留来源；程序配乐和音效沿用前版，编码音频包逐个一致。横屏审片为 **15 秒／1920×1080／30 fps／450 帧，AAC −14.39 LUFS／−1.13 dBTP**；PyAV 19.0.2 完整解码 450 帧并检查出处区域，署名在第 0–359 帧持续可见、第 360 帧随片尾卡切走。Chrome **156.0.8078.48** 无头、未静音、1× 正常播放 **0/450 掉帧**，重播正常；另一轮播放中同时截全页图时掉 **17/450 帧**，差异原因未隔离。素材、时间映射、源码、音频和检查保存在本机私有 `manual-revision-agent-credited/`；音乐实际听感待确认，视频未加入自动导演素材清单，竖屏、自动流程成功与 S1 覆盖数不变。

## Pocket-pet 高清横竖候选通过冷审，负责人仍不愿发布

操作 `eval-minimax-15-1792994190327` 使用 `1aed7d3` Worker／`8f77bc9` 镜像，完成 A–C/E/F：E 首次提交、无内部修复，独立 F pass／无 issue。[数值、媒体引用和回收](minimax-pocket/candidate-metrics.json)绑定实际候选。

两部均 **15 秒、450 帧、1080p／30 fps／AAC**，十处接缝全零差异，视频未重编码，AAC 纠正后均 **−14.06 LUFS／−2.13 dBTP**。方向就绪 **183.716 秒**；选择确认至执行报告完成 **313.259 秒**；最终渲染 **78.198／82.407 秒**仍超过 45 秒目标，不作分位数。

实际解码画面已看；完整有声 1× 播放无解码错误，竖屏零掉帧、横屏首次掉 **3/450 帧**，原因未定位。[负责人决定](minimax-pocket/owner-review.json)为**不愿意发布**：认可音乐踩点改善，画面仍无聊、同画面停留过久、蓝色 ROI 小框无意义。私有播放器 `artifacts/s1-minimax-15-review-handoff-2026-10-26/index.html`。同输入改版不增加覆盖数。

旧版 [candidate](minimax-15/candidate.json)、[完整回执](minimax-15/report.json)和[负责人否定](minimax-15/owner-review.json)保留；它通过技术／冷审，不代表审美通过。旧版实测 AAC −14.04 LUFS／−1.25 dBTP，主要问题不是简单提高音量。

## ABC 15 秒实际 review 已通过，音乐全链路未完成

[原谱／WAV 的 15/30 秒内部批准](../2026-10-24-s1-audio-review/original-score-test-clearance.json)固定音源身份和用途。操作 `eval-duolingo-15-1792998933707` 复用已付费 C，在 180 秒止损内交付实际 review：**60.248 秒、15 秒、960×540／15 fps、225 帧、AAC −14.03 LUFS／−2.74 dBTP**，五处接缝零差异，未重编码／音频纠正。[完整数值和私有引用](duolingo-score-render/complete-metrics.json)。零模型，八次计算停止／结算 **8,524 usd_micros**，容量为空、临时密钥撤销。

私有播放器 `artifacts/s1-duolingo-15-score-complete-2026-10-26/index.html` 有声 1× 完整解码零掉帧／错误。只证明一次 ABC review 渲染；E/F、最终横竖、WAV 上传和 30 秒仍未验收。原 90 秒超时见 [shm-fixed-metrics](duolingo-score-render/shm-fixed-metrics.json)，不改记通过。[13 种程序风格保留决定](../2026-10-24-s1-audio-review/owner-decision.json)不适用于新谱或成片质量。

## 当前修复所依据的反例

| 影响当前判断的证据 | 结果与适用范围 |
| --- | --- |
| [最终 AAC 超峰反例](minimax-pocket/sfx-db-metrics.json)、[原规格纠正云验](minimax-pocket/aac-gate-metrics.json) | 原 AAC −0.2 dBTP 超过 −1；新增最终解码检查／一次纠正后 −14.06 LUFS／−2.13 dBTP，视频不重编码。原云端 passed 不追认音频合格 |
| [MiniMax 30 秒](minimax-30-third/report.json)／[实际审片图引用](minimax-30-third/review-2-images.json) | 三部 review 已出，修复历史确实送达；布局仍未收敛，第三次修改被两次上限拒绝，无最终片／F |
| [Opus 自写实际响应](custom-eleventh-attempt/d-responses.json)、[seek 诊断](custom-eleventh-attempt/seek-diagnosis.json) | 两模块 Q0 通过，开场逆序像素超原 0.1% 且状态／署名不完整，无影片；结构通过不能替代实际帧 |
| [手工离线修复](custom-eleventh-attempt/local-scene-repair.json)、[阅读节奏修正](custom-eleventh-attempt/local-rhythm-check.json) | 同一付费源码的人工派生按原像素／阅读门槛通过，非模型自动修复、非最终质量验收；私有稿在 artifacts 的 offline-repair／rhythm 目录 |
| [方法 1.3](custom-method130-attempt/summary.json) | 父容器颜色未覆盖 text mount 内联颜色，实际对比度 1.925:1，定点修复仍失败 |
| [方法 1.4](custom-method140-attempt/summary.json) | 最难镜头横竖探针 18 次比较零差异；完整检查时耗尽原 20 分钟活动期限，无 review／最终片，不是 180 秒单片超时 |
| [卡片布局](card-layout/layout-check.json)、[showcase 确定性](panel-performance/browser-report.json)、[最终渲染](panel-performance/final-render.json) | 实际布局／四画幅像素与媒体修复有证据；单片耗时仍高于目标，不推导完整性能通过 |

按拍界面旅程的 5.4 秒横竖短片已有四画幅 64 次逆／冷比较零差异及三次阅读检查；浏览器横屏首次掉 1 帧、竖屏零掉帧，未达到参考的多场景衔接，不计完整片或发布意愿。源码与回执在私有 `artifacts/history/s1-minimax-journey-motion-2026-10-26/`，不是当前审片入口。

## 原始证据与继续执行

各目录中的原始 report、模型响应、输入／选择、观测和费用仍保留，用于恢复、未知费用核对和反例；不把逐轮部署／局部检查叙事再复制为决策历史。第三方图片、影片和源码本体通过报告里的私有 R2／Actions 引用取回，不提交 Git；本机 history 只保留原始数据，不保证历史播放器存在。

- 模型未知消费依据：[早期方向截断](third-attempt/report.json)、[E 坏工具参数](eighth-attempt/report.json)、[网关请求失败](minimax-eighth-attempt/report.json)、[D HTTP502](custom-seventh-attempt/report.json)、[D 无工具／usage](custom-tenth-attempt/report.json)、[最新 E 无 usage](custom-method150-attempt/summary.json)。当前合计在实施状态；旧调用不重发。
- 支持当前准入／回执语义的早期报告仍在 first-attempt 至 eleventh-attempt 等目录；它们只说明各自冻结候选，不能从当时的“待验”推断当前状态。
- 逐轮授权次数已用完；继续付费前需有效具体授权和明确修改方向。历史费用确认、补账与恢复入口见 [cloud README](../../../apps/cloud/README.md#研究模型共用一份预算)。
