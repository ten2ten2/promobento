# S1 正式形态 staging：工程片出片通过，峰值内存未提供

[Actions 39987356301](https://github.com/ten2ten2/promobento/actions/runs/39987356301) 部署 `3942ffc06162efd658cca757d1f7409a08ac2ded`；正式 runtime 镜像摘要 `sha256:c042583ad9ecdb58ea348e10bc55fe85da440fd1af89567b4346fcdf3bc4048c`，Worker 版本 `45749dc4-e696-4d5d-82bc-3434eced59bc`。不是临时探针，也不是完整 G1。

工具为 Node 26.12.0、pnpm 12.14.0、Wrangler 4.152.0、Chromium 151.0.7922.34。构建日志确认 FFmpeg 的 Ubuntu 包版本为 `7:6.1.1-3ubuntu5`，与环境锁一致；后续安装显式固定该版本，未因补记录重建相同媒体环境。

## 实际结果

- 真实 Worker → OperationDO → ShardDO → 独立容器 → broker/R2 → Chromium，studio 成功输出原创工程片的 45、375 帧。运行时执行了独立 uid 与 SANDBOX_FULL 自检；未运行完整攻击语料。
- 45→375→45 的两张 45 帧 PNG 完全相同：最大通道差 0、差异像素 0%。已查看实际开场和 CTA，两段文字清晰可读。这只覆盖该横屏逆序路径，不代替完整四画幅矩阵。
- [环境回执](environment.json)确认 cgroup v2 `memory.peak` 和两个 v1 `memory.max_usage_in_bytes` 路径均未暴露。任务明确阻断为 `RENDER_MEMORY_METRIC_UNAVAILABLE`；没有填 0、改用控制器 RSS 或放宽门槛。
- 在 studio 预检就发现问题，本轮未启动三个分段和声音任务，未重复编码整片。studio 关闭、操作取消、并发计数归还与一次性密钥删除均完成。
- [旧任务对账](reconciliation.json)：只对先前取消的 `smoke-546f411b83c7-39985471319` 再确认停止；补齐 1 条旧 attempt 的停止记录，无未结费用。不重启计算、不改写原结算、不清零未知费用。

截图、部署日志和报告在该轮 `s1-staging-deployment` 产物（artifact `12515579404`）；本机原始 JSON 回执归档至 `artifacts/history/s1-staging-39987356301/`。素材仅为仓库原创 SVG 和虚构工程文案，未处理六题第三方素材，未调用模型。

## 负责人决定与后续范围

2026-10-24 负责人允许峰值内存显式记为未提供，继续本次内部出片，G1 此项保留未验证。后续回执使用 `peakMemoryMiB:null` 与 `peakMemoryUnavailableReason:"cgroup_peak_not_exposed"`，不改写本轮实际阻断结果。媒体、隔离和预算门槛不变；已通过的 studio 帧路径复用证据。官方 Anthropic 继续按负责人决定未接通；S1 仍未完成。

## 继续出片：计算成功，提交失败

[40038946955](https://github.com/ten2ten2/promobento/actions/runs/40038946955) 部署 `860df139a6d40053860462cb22f93a79f4b2286b`，镜像 `sha256:8c0a1c628e582578ae2914e9bf79cf0b70957dc82e6cb1513e7bf597ae0a80d9`，Worker `a2740a18-bfc8-47c7-b527-05628aa7e546`。三个分段、声音及拼接均成功，峰值回执正确为 null 加原因；约 99.47 秒生成 450 帧、1920×1080/30 fps、AAC 的 15 秒工程片（5,318,671 bytes，一秒峰值码率 8,490,632 bit/s）。两处接缝均完全一致。计算保守费用上界合计 12,998 usd_micros，五笔均已结算并停止。

该轮**没有提交或交付成功**：`commit-render` 的首次错误为 `NOT_JSON`，默认重试随后把它掩盖成 `RENDER_DEADLINE`；harness 在 240 秒超时后取消操作。D1 初次只读查询 [40040029787](https://github.com/ten2ten2/promobento/actions/runs/40040029787)确认计算成功；补读 Workflow 的 [40040227722](https://github.com/ten2ten2/promobento/actions/runs/40040227722)定位了原始错误。[完整只读回执](film-attempt/inspection.json)保留步骤、结果引用与结算，未再次渲染。

修复将复合步骤值改为共享规范 JSON 文本边界，并禁止最终提交默认重试。Node 26.12.0 下只运行了一次实际提交代码的回执回放（392 ms，通过），没有重跑媒体或导演套件。

## 修复后：真实云端出片、提交与下载通过

[40040999452](https://github.com/ten2ten2/promobento/actions/runs/40040999452) 在 `f5b431a4f2729326048acf1563c93c4b05d76f13` 通过。只部署 Worker（版本 `391d6c84-7f8b-43d4-a789-09b1f8021094`），确认渲染输入未变化后[复用上述镜像](film-success/renderer-reuse.json)，未重建或推送容器。事实卡、真实模型、配乐风格、九积木帧图和完整 G1 均未重跑。

[原始出片报告](film-success/smoke-report.json)：

- Worker → Workflow → 三个独立分段、声音 → 接缝/观测 → 拼接 → generation-fenced 提交 → 私有下载全部通过；harness 总计 113.865 秒，包含准备/上传/轮询/下载，不作任务 p95。
- 15 秒、450 帧、1920×1080、30 fps、AAC，5,320,462 bytes，一秒滑动峰值码率 8,487,520 bit/s，未触发整片重编码。这是按输入要求静音的工程片，不是配乐试听或六题作品。
- 149、299 两处 PNG 接缝均完全一致；三个分段的内存均为 `null` 加 `cgroup_peak_not_exposed`，汇总为 `unverified`，不计 G1 内存通过。
- 本机回执归档至 `artifacts/history/s1-staging-40040999452/`，媒体在 Actions 产物 `s1-staging-deployment`。已查看实际封面，并用独立临时 Chrome 155.0.8059.85 解码 MP4 的 45、165、375 帧，开场、产品图和 CTA 清晰；未将该查看记作完整正常速度视听验收。
- 成片提交时 lease 已清空；结束取消与临时密钥删除成功。此轮未单独采集账单金额，不纳入成本分位基准。先前失败轮的结算见上一节，不能混作本轮费用。

云端渲染仍为 Chromium 151.0.7922.34、FFmpeg `7:6.1.1-3ubuntu5`、Node 26.12.0；部署工具 Wrangler 4.152.0、pnpm 12.14.0。峰值内存契约只跑一次定点检查（20.6 ms，通过），最终提交只跑上述一次本地回放；两次出片之间先读取原始错误修复，未反复运行完整 CI。该记录覆盖工程片闭环；S1 其余出口及官方 Anthropic 集成的当前状态见[实施进度](../../implementation-status.md)。

## 新 WebGL 积木：四画幅逆序与冷 seek 通过

[40046230859](https://github.com/ten2ten2/promobento/actions/runs/40046230859) 只运行新增的 `webgl-studio` 场景，提交 `ca1c37e2d8c46a1a2a91e48e8d7371f0b4d371bd`。Actions 构建/推送镜像 `sha256:6a69284ea5338908e77c7acc842b50c20bd41fc846d5784d7bf2ac97df847433`，Worker 版本 `f85a8a71-bd34-4093-b8aa-9f3608149d32`。容器内 Three.js 0.186.1，其他媒体版本同上；此镜像不含后续 `2278fc3` 的 lead-in 音效改动。

[实际回执](webgl/smoke-report.json)覆盖：

- 原创 `device-3d@1`，真实纹理、透视相机和设备几何；每画幅独立 warm/cold 实例，合计 8 次 studio 生命周期。横屏、竖屏、feed、square 各捕获 0/12/45/375 帧，逆序四帧，再在新实例冷取 45 帧。20 次比较全部最大差 0、差异像素 0%，没有使用容差放行。
- CDP 从真实 context 读取 WebGL 2.0；renderer 与环境锁完全匹配：`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`，vendor 为 `Google Inc. (Google)`。正式 UID/沙箱自检仍必需。
- 已查看四画幅 45 帧，以及横竖屏的 0/375 帧：截图完整、文字可读、无明显越界。这是工程画面检查，不作六题审美签字。
- 16 次正向取帧的 HTTP 请求为 350–622 ms，包含 Worker/DO/截图/传输；harness 86.805 秒包含上传、启动和所有检查，不作为纯 WebGL 单帧或成片 p50/p95。未单独收集本轮成本，不纳入成本分位数。
- 各实例启动健康仍确认 cgroup 峰值接口未暴露；此 studio 检查不采集渲染后峰值，指标保持未验证。studio 关闭、lease 为空、操作取消及密钥删除均成功。

[历史终态对账](webgl/reconciliation.json)修复此前已取消的 `smoke-860df139a6d4-40038946955` 的 1 条残留渲染非终态；未重启计算，未结费用为空，原来的计算/失败证据保留。

实际 PNG、部署日志、`webgl-report.json` 在该轮 `s1-staging-deployment`（artifact `12541137870`），本机回执位置 `artifacts/history/s1-webgl-40046230859/`。未重跑 2D 工程片、配乐、模型或全量 CI。30 秒分段影片、standard-3/4 对比、性能分布、主动取消与平台重启等正式 G1 项目仍待验收。

## 30 秒 WebGL：计算通过，观测覆盖校验阻断

[40050568828](https://github.com/ten2ten2/promobento/actions/runs/40050568828) 在 `1af113f9f325f8735dfe35f04d19a8b44434d4fc` 构建/部署镜像 `sha256:ef1242b6c25d39533f400838693ac103cab0fda22893d8d35bfc24adf1678f53`，Worker `1da03739-a01c-4fc5-ab13-797d17734fb8`。只执行新 30 秒校准场景，没有重复先前画幅矩阵、配乐风格或模型调用。[原始诊断](webgl-film-attempt/inspection.json)、[运行结果](webgl-film-attempt/smoke-report.json)、[声音计划](webgl-film-attempt/audio-plan.json)和[分段计划](webgl-film-attempt/shard-plan.json)保留完整记录。

- 24 个 standard-4 WebGL 分段全部成功，覆盖 900 帧；另一个音频任务成功。在工作区原有 24 个名额与 1,000,000 usd_micros 预算内完成，没有放宽并发或预算。每段真实 SwiftShader 和 uid/沙箱回执通过；峰值均为 null 加原因。
- 程序配乐加 whoosh/whip/riser/reverse 的新 lead-in 已在真实音频容器合成：1,440,000 个样本帧、−14 LUFS、−1.4 dBTP。此轮没有负责人正常速度试听。
- QA 为 `QA_OBSERVATION_MISSING`，没有拼接、提交或交付 MP4。现有容器只在整片计划的阅读停留点观测，本片为 45、450；24 个短分段中只有两段包含这些点。Worker 却要求每段数组非空，错误阻断了其余分段；Workflow 对这个确定性错误重试六次，harness 389.855 秒后收到失败。
- 25 个计算实例均已停止且费用全部结算：分配资源保守上界合计 95,309 usd_micros，未结清单为空；操作取消、lease 归还与临时密钥删除成功。该金额是此轮计算的估计上界，不是供应商账单或成功成片单位成本。

修复让容器与 Worker 共用全局阅读停留帧计划，逐段检查实际应覆盖的精确帧集合；不包含计划点的段允许空数组，缺帧、重复帧、错 render/画幅、BLOCK 项仍阻断，同时核对回执的分段范围和观测字节身份。观测校验不再默认重试。新规则恢复的是按镜头阅读停留取证的原意，不将“每个计算分区非空”作为 QA 指标；修复后的实际整片见下节。

## 修复后：30 秒 WebGL、24 分段、配乐与交付通过

[40051873501](https://github.com/ten2ten2/promobento/actions/runs/40051873501) 在 `fe3df1e942c20c343f7c1330ea7aa42041961117` 通过。仅为修复已定位的观测覆盖错误复验同一场景；不运行其他检查 job、画幅矩阵、13 风格或真实模型。Actions 构建部署的镜像为 `sha256:6f6015661766fa31bf4d050325bb2175995c899478f07a2bd1cf65dc6736a93e`，Worker `52393fb1-35bb-45c3-9642-e9023028293e`。

[实际成片回执](webgl-film-success/smoke-report.json)与[步骤/费用清单](webgl-film-success/inspection.json)：

- 24 个 WebGL 分段、音频、精确阅读停留观测、23 处接缝、拼接、终态提交和私有下载均通过。全部接缝最大差 0、差异像素 0%；`verify-shards` 与 `commit-render` 各只执行一次。
- 成片 30 秒、900 帧、1920×1080/30 fps、AAC，14,681,738 bytes；滑动一秒峰值码率 5,247,632 bit/s，未重编码。配乐与四种 lead-in 混音仍为 1,440,000 样本帧、−14 LUFS、−1.4 dBTP，无补偿重测。
- 从提交渲染请求到读到 passed 为 126.118 秒；harness 全程 137.269 秒，包含准备、上传、轮询与下载。只是一部 100% WebGL 的压力校准输入，不作真实创作的 p50/p95 或默认 30% 3D 预算作品。
- 26 次计算全部停止、全部结算；分配资源保守上界共 94,041 usd_micros（约 $0.094），没有未结费用。lease 清空、操作取消和一次性密钥删除成功。这个上界不等于供应商账单；本轮原有的预算与并发上限未变化。
- 实际 MP4/封面保留该轮 Actions 引用，本机回执在 `artifacts/history/s1-webgl-film-40051873501/`；曾用独立临时 Chrome 155.0.8059.85 解码第 45、450、870 帧。已查看封面和这三帧：字体清晰、纹理/设备完整、无明显裁切；不是负责人正常速度视听或六题审美验收。
- 24 段均为真实锁定 SwiftShader、独立沙箱；峰值均为 `null` 加 `cgroup_peak_not_exposed`，G1 内存保持未验证。

新增导演健康预检、外部音轨/ABC 准入及故障 outbox 已部署，但本场景直接使用渲染入口，未实际执行它们的真实模型导演路径。相应本地回放证据继续有效，官方 C/F 保持未验证。完整 G1 的串行/并行分布、捕获格式/机型对照、主动取消与平台重启，以及六题素材/作品/负责人试听仍未完成。

## 真实取消、原生终止与整次重启防重放通过

[40055971723](https://github.com/ten2ten2/promobento/actions/runs/40055971723) 部署 `8acc356a6cc9440c8ccd4a44e6d52bb018c09ef7`，镜像 `sha256:620b7b6feb4b75fc6a73db74f162ee44dd1d4277de48bece9e122267a2b0d2b0`、Worker `b501ceb3-968d-4fbf-b341-28cc4a03ea06`。只运行新增 `lifecycle-recovery`，不重做完整成片或配乐。job 最终失败于新增导演预检的 60 秒等待；下列三个独立子项的原始结果保留在 [recovery-report.json](recovery-attempt/recovery-report.json)，不把整个 job 记作通过。

- **实际中途取消**：已确认分段物理实例运行后取消，操作 generation 从 0 推进到 1，原生 RenderWorkflow 实际为 terminated；3 个分段及声音共 4 个实例均 `physicallyStopped:true`，停止时间与结算齐全，渲染落 cancelled。保守计算上界合计 3,525 usd_micros，未结为空。
- **平台原生终止**：另一个活动操作由 Wrangler 定点 terminate 原生 RenderWorkflow，随后通过同一定期恢复入口发现并对账；渲染 blocked，首因为 `RENDER_WORKFLOW_TERMINATED`。4 个物理实例均停止、结算，共 1,594 usd_micros，未结为空。业务操作在此时仍为 active，未通过取消伪装成平台恢复。
- **整次 restart 不重做**：在该 active 操作上执行原生 restart（清空 Workflow 检查点）；实际第一步拒绝再次领取 D1 执行 claim，原生落 errored。attempt ID、费用项及完整原结算未增加或改变，原渲染失败原因保留；不是只重放 mock。
- **共享模型历史导入**：[model-budget.json](recovery-attempt/model-budget.json)显示真实共享 D1 已导入 128 次历史清单，可计价部分估算 255,521 usd_micros、14 次未知；`openingMicros:null`、`openingConfirmed:false`、新调用/费用预留均为 0，没有把历史未知总额清零。
- **清理**：两个计算操作及超时的导演操作最终均取消/对账成功，无未结费用；lease 清空，一次性密钥删除成功。无成片公开，也未调用真实模型。原始状态与费用另见 [只读诊断](recovery-attempt/inspection.json)。本机 JSON 回执在 `artifacts/history/s1-recovery-40055971723/`。

**当轮失败的导演子项**：真实导演预检未在 60 秒内落 failed，随后按原取消路径终止。准备门槛仍使用平台默认 step 重试，缺密钥/验证等确定性问题会拖延终态。修复和单独补验见下一节。

## 导演确定性预检修复通过，零模型/媒体消费

[40056929096](https://github.com/ten2ten2/promobento/actions/runs/40056929096) 在 `eb4843afe84ae3cc4b11085b335be531bf5a3fd4` 只补 `director-preflight`，job 通过。仅部署 Worker（版本 `ded3278c-a70c-411c-a2ec-1dffd8c73e1c`），[镜像回执](director-preflight/renderer-reuse.json)确认复用上一轮实际镜像 `sha256:620b7b6feb4b75fc6a73db74f162ee44dd1d4277de48bece9e122267a2b0d2b0`，未构建/推送镜像，不重跑取消、原生终止、restart 或完整成片。

[实际回执](director-preflight/director-preflight-report.json)：真实 OperationWorkflow 的准入检查 14.617 秒内落 `failed`，首因 `MODEL_SECRET_MISSING` 已保存在 D1 outbox 与实际私有 R2 故障证据；原生 Workflow 为 errored，清理已确认。无模型请求、无渲染 attempt、无费用预留/结算，历史确认总额仍为 null，未放行真实模型。该时长包括队列派发和证据轮询，不作成功导演的性能指标。临时密钥已删除。

本地仅复验缺密钥/验证/许可的同一准入分支一次（Node 26.12.0，136 ms）；不重跑已通过模型账本、恢复或媒体检查。官方 C/F 仍未接通，成功导演路径及完整 G1/六题评测仍未完成。

## 现有网关密钥已绑定，导演预检到达历史费用门槛

2026-10-24 负责人确认 Claude 也使用 Actions 已有的 `MODEL_COMPAT_API_KEY`，并提供 [ModelSwitch 文档](https://api.modelswitch.org/docs)。统一入口为 `https://api.modelswitch.org/v1/chat/completions`，使用 OpenAI 兼容适配器、按 model ID 选择模型。C 改回网关 Opus 的文本规格，F 使用历史探针已验证可看图的网关 DeepSeek；保留网关 Claude 两轮图片丢失的 `vision:false`。官方 Anthropic 仅作未绑定/未验证备用，不再是当前所选步骤的密钥前提。

[40077653946](https://github.com/ten2ten2/promobento/actions/runs/40077653946) 在 `ddac7002e0475217ef1dc1c83874a82a2d2ac005` 通过独立维护入口绑定 staging 模型密钥。[名称与结果回执](gateway-director-preflight/binding.json)为 `configuredBefore:false → configuredAfter:true`、`status:bound`，模型/渲染调用均为 0，未上传 Worker 代码。Actions secret 只经 stdin 写入 Wrangler，不读回或保存密钥值；已存在的绑定不会被覆盖。

随后 [40080916901](https://github.com/ten2ten2/promobento/actions/runs/40080916901) 在 `b4b56d22bac51658bbef0452d6d82dc3fc29ede7` 只部署 Worker，版本 `1bd994c9-11de-4113-82e5-6cd45ddca502`。实际命令：

```sh
gh workflow run checks.yml --ref main \
  -f suite=staging -f staging_scenario=director-preflight \
  -f staging_renderer_sha=420e245a72f7655bf3aa1b2a190be65ae95d2257 \
  -f staging_renderer_digest=sha256:9bfd46ae79e01615b8519e6319ba03f183cfef8f8617011c06b3a3788b34ce84
```

- [预检原始回执](gateway-director-preflight/director-preflight-report.json)：真实 OperationWorkflow 在 **8.698 秒**内落 `failed`，首因准确为 `MODEL_HISTORY_RECONCILIATION_REQUIRED`，不是原来的缺密钥或未验证模型。D1 outbox 与实际私有 R2 故障证据均已保存，原生状态为 errored，恢复登记已对账。
- 无模型请求、渲染 attempt 或费用记录；共享预算仍为 0 新结算/0 新预留。128 次历史清单、255,521 usd_micros 可计价估算和 14 次未知均保留，`openingMicros:null`、`openingConfirmed:false`，授权身份、$300 上限与起算不变。
- [镜像复用回执](gateway-director-preflight/renderer-reuse.json)确认原 renderer `420e245` 和镜像未变化，没有构建/推送容器。[完整 harness 回执](gateway-director-preflight/smoke-report.json)为 13.819 秒；这不作为成功导演性能指标。最终取消/对账、lease 清空和临时 `EVAL_API_KEY` 删除均成功，模型运行时密钥保留。
- 只执行这一必要预检。该提交自动触发的全套 push run `40080907326` 已取消，未记为通过；没有重跑媒体、28 部矩阵、隔离、捕获选型、配乐或完整 CI。

本轮部署工具为 Node 26.12.0、pnpm 12.14.0、Wrangler 4.152.0。C 校验纠正、全画幅阅读停留拼图和 E/F 共用修复额度已随 Worker 部署，本地定点回放及类型检查通过；本轮在它们执行前停下，真实模型鉴权/长提示、成功导演、六题成片和正常速度视听仍待验证。S1 仍未完成，生产保持关闭。
