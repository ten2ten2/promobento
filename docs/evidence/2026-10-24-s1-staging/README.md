# S1 云端媒体与恢复证据

覆盖内部 staging 的媒体闭环、真实取消／原生终止／restart 防重放及零消费准入；不是客户业务或生产发布验收。当前部署和未完成项见[实施状态](../../implementation-status.md)，操作入口见 [cloud README](../../../apps/cloud/README.md)。

这些运行使用 Node26.12.0、pnpm12.14.0、Wrangler4.152.0、Chromium151.0.7922.34、FFmpeg Ubuntu包 `7:6.1.1-3ubuntu5`；各原始回执固定精确源码／镜像。媒体保持私有，不把单次墙钟当 p50/p95。

## 15 秒 2D：出片、提交与下载通过

[40040999452](https://github.com/ten2ten2/promobento/actions/runs/40040999452)，Worker `f5b431a4f2729326048acf1563c93c4b05d76f13`，[复用](film-success/renderer-reuse.json) `860df13` 镜像。[原始报告](film-success/smoke-report.json)覆盖分段／声音、观测／接缝、拼接、generation-fenced 提交与私有下载。

实际 **15 秒、450 帧、1920×1080／30fps／AAC、5,320,462 bytes**，两处接缝零差异，滑动一秒峰值8,487,520bit/s、未整片重编码。按要求静音，不能用于配乐听感验收。harness113.865秒包含准备／上传／轮询／下载；当轮未独立采集账单金额，不纳入费用分位数。已看实际封面和45／165／375解码帧，lease清空／密钥回收。

先前计算成功但提交 NOT_JSON 的[原生诊断](film-attempt/inspection.json)保留；复合步骤改为共享规范 JSON 文本，最终确定性提交失败不自动重试，不能用后来成功抹去旧失败。

## WebGL 四画幅：顺逆与冷 seek 通过

[40046230859](https://github.com/ten2ten2/promobento/actions/runs/40046230859)，源码 `ca1c37e2d8c46a1a2a91e48e8d7371f0b4d371bd`。[回执](webgl/smoke-report.json)覆盖原创 device-3d、Three.js0.186.1 和真实锁定 SwiftShader，八个独立 studio 生命周期。

四画幅0／12／45／375帧逆序及新实例冷45帧，共 **20次比较全零差异**；实际四画幅和横竖首尾已看。HTTP取帧350–622ms不是完整成片或加载分布。当轮未单独采集费用，不纳入费用分位数；关闭、lease、取消和密钥回收通过。

## 修复后：30 秒 WebGL、24 分段、配乐与交付通过

[40051873501](https://github.com/ten2ten2/promobento/actions/runs/40051873501)，源码 `fe3df1e942c20c343f7c1330ea7aa42041961117`。[成片回执](webgl-film-success/smoke-report.json)与[步骤／费用](webgl-film-success/inspection.json)覆盖24个standard-4分段、程序配乐／四种lead-in、精确阅读计划、23处接缝、拼接／提交／私有下载。

实际 **30秒、900帧、1920×1080／30fps／AAC、14,681,738bytes**，接缝全零差异、一秒峰值5,247,632bit/s、未重编码。混音1,440,000样本帧、−14LUFS／−1.4dBTP；提交至读到passed126.118秒，属于一部全WebGL压力校准片，不代表真实创作分位数。26次计算均物理停止／结算 **94,041 usd_micros** 保守上界，无未结／lease／临时密钥。已看实际封面及45／450／870帧，未作负责人正常速度视听。

原 [24段观测失败](webgl-film-attempt/smoke-report.json)与[诊断](webgl-film-attempt/inspection.json)保留：全片只有两个计划点，错误要求每段非空而阻断。当前逐段核对共享计划的精确帧和身份，无计划点允许空数组，缺帧／重复／错身份／BLOCK仍拒绝。

## 真实取消、原生终止与整次重启防重放通过

[40055971723](https://github.com/ten2ten2/promobento/actions/runs/40055971723)，源码 `8acc356a6cc9440c8ccd4a44e6d52bb018c09ef7`。父job因独立导演预检超时失败，以下子项由[原始恢复报告](recovery-attempt/recovery-report.json)和[只读诊断](recovery-attempt/inspection.json)单独支持：

- 运行中的分段取消后generation0→1、原生Workflow terminated，四实例均实际停止／结算3,525usd_micros，render cancelled。
- 另一活动操作原生terminate后，同一恢复入口发现并落 `RENDER_WORKFLOW_TERMINATED`；四实例停止／结算1,594usd_micros，业务操作当时仍active，未用取消伪装恢复。
- 在该操作上原生restart清空检查点，再领执行claim被拒，attempt和费用未增加，首因保留。
- 三个相关操作最终清理／对账，无未结／lease／临时密钥，零模型调用。[历史模型导入](recovery-attempt/model-budget.json)保持开账未确认。

这八次计算总保守上界 **5,119 usd_micros**；不重做整片或模型调用，不能把父job失败改记整轮成功。

## 零消费准入与模型密钥

[40056929096](https://github.com/ten2ten2/promobento/actions/runs/40056929096) 在 `eb4843a` 单独通过[确定性预检](director-preflight/director-preflight-report.json)：14.617秒落MODEL_SECRET_MISSING，失败证据／清理完整，零模型／媒体／预留。

之后 [40077653946](https://github.com/ten2ten2/promobento/actions/runs/40077653946) 通过[绑定回执](gateway-director-preflight/binding.json)证明已有 Actions MODEL_COMPAT_API_KEY 经stdin绑定staging，零模型／渲染、不读回密钥。[40080916901](https://github.com/ten2ten2/promobento/actions/runs/40080916901) 在 `b4b56d2` 的[预检](gateway-director-preflight/director-preflight-report.json)8.698秒准确到达MODEL_HISTORY_RECONCILIATION_REQUIRED，零消费。它们是准入反例；后来的有限放行及真实导演结果见[导演证据](../2026-10-24-s1-director/README.md)，不能继续写“尚未调用真实模型”。

## 内存和证据保留

[早期环境回执](environment.json)确认cgroup高水位路径未暴露；后续所有相关峰值保持null＋原因、unverified，不用RSS或0替代。[当前S1例外](../2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)仅允许暂缓此项。

截图／媒体通过各run的s1-staging-deployment或报告中私有R2引用取回；本机历史仅保留原始JSON／源码／许可，未承诺完整媒体下载包。当前G1性能、选型和固定隔离见[性能证据](../2026-10-24-s1-performance/README.md)，完整六题、客户认证／支付和生产发布仍按实施状态推进。
