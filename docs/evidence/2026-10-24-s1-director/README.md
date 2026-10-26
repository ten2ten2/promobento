# S1 真实导演：成片质量未过，出片阻断排查

2026-10-24 负责人要求「放开一点预算门槛，继续 S1」。本次在原 $300 授权中取 $5 历史风险预留、staging 新增模型实际/未知预留累计上限 $10，至 2026-10-31 上海时间结束。原授权身份、起算、历史清单和确认空值保留；风险预留不等于核实账单。配置与语义见 [14 预算契约](../../prd/14-production-contracts.md#6-ai操作费用与成功次数)。

本页模型费用按实际返回的 usage 与调用时冻结的目录/汇率计价结算，不是已核对的供应商账单；未知 usage 继续占预留。计算费用另按分配资源记保守上界，不混入模型新增上限。

## 预算放行已在真实 Worker 生效

[Actions 40082980568](https://github.com/ten2ten2/promobento/actions/runs/40082980568) 在 `bca8861bee6fc43a0ac9f0cd3786874cfd205fae` 仅部署 Worker，版本 `3201b4b7-db88-4d61-8932-70d38b185c18`。命令为 `gh workflow run checks.yml --ref main -f suite=staging -f staging_scenario=deploy-only`，另传 renderer `420e245a72f7655bf3aa1b2a190be65ae95d2257` 和已登记镜像 `sha256:9bfd46ae79e01615b8519e6319ba03f183cfef8f8617011c06b3a3788b34ce84`。

[实际只读回执](deployment/deployment-health.json)显示健康正常、容量为空，`budgetBasis:provisional`、历史风险预留 5,000,000、准入合计上限 15,000,000 usd_micros，`openingConfirmed:false`、`openingMicros:null`。128 条历史请求与 14 条未知保持不变。部署本身 0 模型/媒体调用，临时内部密钥已删除；[镜像复用回执](deployment/renderer-reuse.json)确认未重建镜像。自动全套 push run `40082971156` 已取消，不计通过；没有重跑原媒体、矩阵或完整 CI。

## 首题已真正请求模型，尚未生成方向或成片

执行：

```sh
mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-2026-10-24 deepseek-15 artifacts/s1-deepseek-15-2026-10-24
```

操作 `eval-deepseek-15-1792835108664`，使用同一提交的 Worker、`renderer-257ca1b6babd` 登记的同一镜像，原已确认 DeepSeek 三条事实与一张实际素材，目标为 15 秒横/竖两版。预检许可、真实镜像、沙箱、字体和 PNG 取帧后，向 `modelswitch/deepseek-v4.1-flash-1017` 发出一次真实流式请求。

[原始响应](first-attempt/facts-response.json)含正确的版本、`fact_analysis`、三个原 factId 与 summary，但额外返回 `schemaVersionNote:null`。严格 `additionalProperties:false` 拒绝为 `FACT_ANALYSIS_INVALID`；没有截断字段或将结果当作已通过。该提交尚无 A 的结构纠正，操作落 failed，未调用素材/方向/C/E/F，也没有成片。

[完整费用与回收回执](first-attempt/report.json)：首 token **3,514 ms**、完整响应 **5,578 ms**；419 输入 / 384 输出 token，原币 CNY 978 micros，按原目录与 6.6863 汇率计 **147 usd_micros**。真实预检 standard-3 运行 4,758 ms，已停止/结算 **291 usd_micros** 分配资源保守上界。两项合计 438 usd_micros，未结为空、容量为空、Workflow 已 errored/对账、临时内部密钥已删除。历史未被确认或清零，共享新增模型累计为 147 usd_micros；计算上界不混入模型费用。

依据这个实际反例，后续补齐 A/B/F 的一次结构纠正，A 的总调用上限从 1 调整为含纠正的 2，金额不提高；素材纠正保持同一 per-asset 预算。C 仍最多两次校验纠正；传输/未知响应不重发。新路径本地有定点回放，真实结果另行记录，不能将本次失败当成成功导演或六题评测。

工具：Node 26.12.0、pnpm 12.14.0、TypeScript 7.0.2、Wrangler 4.152.0；容器继续为 Chromium 151.0.7922.34、FFmpeg `7:6.1.1-3ubuntu5`。生产保持关闭；负责人正常速度视听仍待真实成片。

## 第二次：事实、看图与方向纠正通过，真实 studio 揭示能力准入缺口

`f4088819a91322e6f74521b52907b3142d703d73` 由 [40084165840](https://github.com/ten2ten2/promobento/actions/runs/40084165840) 仅部署 Worker；仍复用同一 renderer/镜像，没有重做媒体或全套 CI（自动全套 push `40084152643` 已取消）。读回历史字段保持 null/false，新模型已用 147 usd_micros，没有因部署重置。

实际命令仅把前节输出目录换为 `artifacts/s1-deepseek-15-corrected-2026-10-24`，新操作 `eval-deepseek-15-1792836265169`。事实整理、真实素材看图，以及三方向经过一次结构/规格纠正后均已通过；有一张 fit studio 帧完成。随后 amplify 的真实 studio 以 `TEXTURE_NOT_IMPLEMENTED` 停止，未等用户选择，也未调用 C/E/F 或出片。

[真正采用的纠正后方向响应](second-attempt/directions-output-repair-response.json)中，fit 为 texture none，amplify 为 glow，unexpected 为 grain。完整协议允许这些未来字段，但当前 S1 渲染器只实现 none；前置 FilmSpec Schema/跨字段检查未覆盖实际支持边界。不能用初始响应代替被采用的纠正后响应，也不能仅删模型字段冒充同一视觉方向。

[完整回执](second-attempt/report.json)记录 4 次模型调用：事实 160、素材 331、方向 6,045、方向纠正 2,125 usd_micros，共 **8,661 usd_micros**；三次预检/studio 计算均已物理停止并结算，保守上界共 **1,019 usd_micros**。本轮合计 9,680 usd_micros，无未知用量或遗留 lease，原生 Workflow errored/已对账，临时内部密钥已删。两轮共享新增模型累计 **8,808 usd_micros**，仍在同一 $10 上限内。

据此把模型看到的 S1 FilmSpec 提示收窄到实际支持的纹理、转场、布局、裁剪与精确字体 face；完整协议不缩减。Worker 在付费 studio/渲染前复用现有 `generateFilmPage` 做纯数据支持性准入，丢弃 HTML、不求值任何创作代码；生成器与真正容器使用相同规则。三方向汇总全部卡片的错误，一次纠正可以看到各卡问题。新边界本地定点回放已通过；容器源码/镜像不变，真实后续结果另记。

## 第三次：复用理解结果，三份完整预览规格触发截断

`6b0d054e3e497613af229c1361f43c8b5361cdba` 经 [40085536307](https://github.com/ten2ten2/promobento/actions/runs/40085536307) 仅部署 Worker（自动全套 push `40085528275` 已取消）。新操作 `eval-deepseek-15-1792837491696`，输出目录 `artifacts/s1-deepseek-15-supported-2026-10-24`。事实/素材理解直接复用已有有效响应，未重发；方向请求以 `MODEL_OUTPUT_TRUNCATED` 停止。没有方向图、C 或成片。

[实际回执](third-attempt/report.json)保留该方向请求 **6,196 usd_micros 未知消费预留**，没有记作 0 或按最大输出数虚构实收。该旧适配器在读到 length 时立即抛错，没有保存后续 usage；现有原始响应无法补造。预检计算已物理停止并结算 333 usd_micros 保守上界，容量/实例均已清空，原生 Workflow 已对账，临时内部密钥已删除。前三轮共享模型已结 **8,808**、未知预留 **6,196**，准入合计 **15,004 usd_micros**，仍计入同一 $10 新增上限。

方向阶段原先一次请求三份完整 15 秒 FilmSpec，超出方向卡本身的职责。修复后 B 只返回三张精简卡和镜头骨架，可信宿主按已确认事实、真实素材、卡片色板/纵深/积木选择构造静音 hero，再由原 studio 截图；完整影片仍只交 C。衍生 FilmSpec 与来源在持久检查点冻结，保留既有完整 keyframeFilm 响应的兼容。这次精简卡的 B 输出上限为 8,192；后续 Duolingo 截断与新候选见[实际记录](#素材尺寸修复后方向输出截断已结算)，总预算不变。

适配器今后对终态 length/refusal 仍拒绝结果，但继续读取后续 usage，并把 partial text 和失败状态交持久层保存；有完整 usage 就按原价结算，没有则继续保留预留。截断不进入自动纠正或缓存。本次旧请求仍未知。另按历史 Claude 隐藏输入反例，为登记了隐藏提示的网关路线额外预留 128k 输入 token 风险空间，阶段金额/总额不提高。

## 第四次：三方向与 Opus 实际调用通过，完整 JSON 围栏掩盖规格错误

`d1c36f69879b098832b5c19c84f9b6638848c7de` 经 [40087690141](https://github.com/ten2ten2/promobento/actions/runs/40087690141) 仅部署 Worker，原镜像未变；自动全套 push `40087682603` 已取消。操作 `eval-deepseek-15-1792839467235`，输出目录 `artifacts/s1-deepseek-15-compact-2026-10-24`。复用既有事实/素材理解；精简 B 完成，三张真实 studio PNG 全部生成并下载，Codex 已逐张查看。

已按[实际画面选择 Fit](fourth-attempt/choice.json)：产品入口图更大，Chat/API/Harness 标签更清楚，白底深色对比直接；Amplify 的设备图较小，Unexpected 偏文字索引。方向源与图片引用在该目录 `directions.json`，原生方向等待/恢复已实际通过。这个判断不代替负责人正常速度视听。

随后网关 Opus 经现有 `MODEL_COMPAT_API_KEY` 实际完成三次流式规格响应，耗时 **45,695 / 28,399 / 34,770 ms**，费用 **15,534 / 9,024 / 11,608 usd_micros**；证明所选 Claude 路由实际鉴权与计价已走通。[首份原始响应](fourth-attempt/spec-response.json)及两次纠正都将完整 JSON 包在单一 Markdown json 围栏中。旧处理直接按裸 JSON 解析，因此三次均止于 `MODEL_OUTPUT_JSON_INVALID`，未继续 Schema/跨字段校验，更没有渲染或冷审。

只读检查三份完整 JSON 本体发现相同的实际错误：转场有时长但镜头未重叠，CTA 槽位没有 factId。不能把去围栏等同于规格通过。修复后仅识别完整的单一 Markdown 包络，JSON 本体仍先由共享严格解析器、完整 Schema、跨字段规则和真实页面生成器准入；前后散文、多段代码或重复 JSON 键仍拒绝。

[完整费用/回收回执](fourth-attempt/report.json)：本轮 B 为 2,172 usd_micros，三次 C 合计 36,166，本轮模型共 **38,338**；预检与三次 studio 均停止/结算，保守计算上界 **1,123**。本轮合计 39,461，无本轮未知费用/遗留实例，原生已对账，临时内部密钥已删。四轮共享模型已结 **47,146**，前一轮未知预留 **6,196** 仍保留，合计占用 **53,342 usd_micros**。

后续同项目/工作区/用途、相同请求/模型/目录可优先重新校验已结算的不可变原始回执，不为解析器修复重新请求同一回答。重用不改原费用，不复活原操作；不合格规格给出真正的 code/path 反馈后，才可在原规则下请求纠正。原未知截断仍不回填用量；成功成片与 E/F 仍待实际执行。

## 第五次：已付费回执复用与规格纠正通过，review 拼接码率失败

`d94ef6aa61944544855f3823cc3f55b1d9446ef3` 经 [40089888901](https://github.com/ten2ten2/promobento/actions/runs/40089888901) 仅部署 Worker，仍使用旧镜像；自动全套 push `40089881296` 已取消。操作 `eval-deepseek-15-1792841857404`，输出目录 `artifacts/s1-deepseek-15-receipt-2026-10-24`。事实/素材/B 沿用有效结果，三方向摘要与已查看版本完全一致，复用原 Fit 选择；首份 C 原始回执重新准入，没有再次计费。

真实语义错误反馈后，一次 Opus 纠正用时 **28,720 ms**、费用 **10,329 usd_micros**，完整 JSON、Schema、跨字段及实际页面支持性检查全部通过。原生 review `render-dbb3b11c2346d48c9aaa903cffad457aa73750517c4c5c67` 的两个分段与音频已成功，观测及接缝通过后进入拼接；拼接及一次原回退后仍为 `OUTPUT_BITRATE_EXCEEDED`，未交付 MP4，也未到 E/F。旧失败回执未保留具体峰值，不补造数值。

[完整费用与回收回执](fifth-attempt/report.json)：本次模型 **10,329**、8 次计算保守上界合计 **5,243**，总计 **15,572 usd_micros**。计算全部物理停止并结算，容量为空、原生 Workflow 已 errored/对账、临时密钥已删除。共享模型已计价结算 **57,475** 加旧截断预留 **6,196**，占用 **63,671 usd_micros**；历史确认仍为空。

旧回退沿用正常分段的两秒 VBV reservoir，不能保证滑动一秒峰值。后续只收紧纠正编码的 maxrate/buffer，并把纠正前后实测峰值写入结果；一秒码率门槛、正常分段、尺寸、fps、音频与其他 QA 不变。该修改涉及容器真实源码，必须由 Actions 构建并使用新 release，旧 G1 证据仍绑定原候选，不能以旧镜像复用绕过更新。

## 第六次：码率修复、E 与横竖渲染通过，F 在原 1,024 token 输出上限截断

[40092112348](https://github.com/ten2ten2/promobento/actions/runs/40092112348) 在 `dda33944656156b2edd37eac8899d013e8464d8c` 由 Actions 实际构建并推送新镜像 `sha256:6e58bae5dc9a2117652cf8829721546d9b2cd51d5c723c34dfaff2deb1606986`，Worker `5d5992a0-7ed6-42d9-8330-3cee62c64c1e`。只部署/读健康，未重跑原 G1/隔离/配乐矩阵，自动全套 push `40092105527` 已取消。新输入固定 `renderer-dda339446561`，旧 release 不改绑。

操作 `eval-deepseek-15-1792843644103`，输出 `artifacts/s1-deepseek-15-vbv-2026-10-24`。新方向图已逐张查看并[选择 Fit](sixth-attempt/choice.json)；A/素材复用，B 和新 release 对应的 C 按新请求计费。规格一次纠正通过，真实 review 及 E 的 `submit_candidate` 已通过，横/竖两部 **15 秒、450 帧、1080p/30 fps/AAC** 已实际生成并提交。review 的滑动一秒峰值由 3,785,344 降至 **1,577,016** bit/s，横版由 14,578,464 降至 **6,238,848**，竖版由 11,731,512 降至 **5,583,520**；分别低于原 2.5M / 10M 门槛，未调宽标准。媒体报告见[实际回执](sixth-attempt/media-diagnosis.json)。

冷审确实读取两画幅，但[原始响应](sixth-attempt/cold-review-response.json)在 **1,024 completion token** 时以 `length` 结束，只输出分析散文，没有完整 verdict JSON。新适配器已保存 partial/usage 并结算 **673 usd_micros**，没有把失败记作未知、JSON 通过或冷审通过。操作正确失败，没有交付合格候选；私有 MP4 只取回作内部诊断。实际封面显示 API 镜头的卡片大而空，仍需冷审和创意修复，不因编码通过认定质量合格。

[完整费用/回收](sixth-attempt/report.json)：5 次模型 **28,117**，18 次计算均已停止/结算 **21,012** 保守上界，总计 **49,129 usd_micros**；容量/本轮未知为空，Workflow 已对账、临时内部密钥已删除。共享模型已计价结算 **85,592** 加旧未知 **6,196**，共占用 **91,788 usd_micros**。

下一候选把 F 的输出空间改为 8,192，并在用户消息中明确同一 JSON Schema/禁止分析散文；仍是原 2 次调用、$0.05 阶段预算、全画幅和独立模型检查。截断不自动重试，也不缓存或捏造原 verdict；此 Worker-only 修正复用本节已验证的新镜像。

## 第七次：E 修改元数据后再次长输出，尚未执行修正后的 F

`be5b3bf1a0e7738a7f6ae76468ff89126f363892` 经 [40093788760](https://github.com/ten2ten2/promobento/actions/runs/40093788760) 仅部署 Worker（自动全套 push `40093781592` 已取消），同一新镜像不变。操作 `eval-deepseek-15-1792844833456`，输出 `artifacts/s1-deepseek-15-cold-2026-10-24`。冻结方向未变，沿用前轮已查看的 Fit 选择；规格纠正通过，review 渲染成功。

[E 首次回执](seventh-attempt/review-0-response.json)调用 `write_spec`，仅把 web-claim 的 maxLines 从 2 改为 4，未改善已看到的空卡片。该修复后的 [E 再审](seventh-attempt/review-1-response.json)耗时 **96,637 ms**、完成用量 **8,192 token**，仍在分析和反复考虑修改，未完成工具调用即截断。没有把散文提取为工具或将放宽元数据认作视觉修复；未到 F，不能据此认定增大后的 F 仍截断。

[完整回执](seventh-attempt/report.json)记录三次模型 **15,035**、12 次计算保守上界 **11,491**，共 **26,526 usd_micros**，均已结算、物理停止、容量清空、Workflow 对账和密钥回收。共享模型已计价结算 **100,627** 加旧未知 **6,196**，共占用 **106,823**。第六轮实际横竖 MP4 已另在 Chrome 155.0.8059.85 解码、逐帧查看并默认 1× 播放到结束，无媒体错误；[播放器记录](sixth-attempt/actual-playback.json)不等于负责人视听或冷审通过。

针对这个具体失败，当前内部候选将 E/F 请求从 medium 改为 low，要求只完成一次工具/完整 JSON，不输出分析散文；E 明确要修复实际画面而不是调宽 maxLines。金额、次数、8192 输出上限、独立冷审及质量门槛不变。[DeepSeek 官方说明](https://api-docs.deepseek.com/guides/thinking_mode/)指出 medium 映射 high；网关只证明参数被接受，尚不能断言它实际转发了此语义。后续仍按真实结果判断。

另将旧回执的审计引用保留在持久步骤结果外层，不再混入发给模型的校验反馈。原第六轮首次纠正与第七轮的非语义追踪字段差异曾导致新请求计费；修复后相同语义反馈可命中原确切请求。账本和原始费用不改写。

## 第八次：B/C 实际免重付，E 坏工具参数暴露回执保存顺序问题

`dcea81f59e863f7ac638957164d0d58cb315bf27` 经 [40094915466](https://github.com/ten2ten2/promobento/actions/runs/40094915466) 仅部署 Worker，同一镜像不变；自动全套 push `40094908195` 已取消。操作 `eval-deepseek-15-1792845834583`，输出 `artifacts/s1-deepseek-15-low-review-2026-10-24`。B/C 的有效回执与纠正已实际复用，无新 B/C 费用，证明审计字段移出模型反馈后原语义请求命中。两次 review 的实际渲染均通过。

E 首次完成 `write_spec`，计 **2,882 usd_micros / 8,033 completion token / 52,091 ms**。再审因工具 arguments 的未闭合字符串在适配器内抛 `SyntaxError`（[原生首因](eighth-attempt/native-workflow-error.json)），早于原始回执/usage 保存；业务终态为 `DIRECTOR_INTERNAL_ERROR`。该请求 **14,029 usd_micros** 预留仍未知，不按新实现回填或记零。尚未执行 F。

[完整费用与回收](eighth-attempt/report.json)：本轮实际模型 2,882、未知预留 14,029，计算全部物理停止并结算 7,744 保守上界，准入合计 **24,655 usd_micros**；容量清空、Workflow 已 errored/对账、密钥已删除。共享模型实际 **103,509** 加两笔未知 **20,225**，共占用 **123,734**，仍在同一有限授权内。

修复后完整坏工具参数以 `MODEL_TOOL_JSON_INVALID` 连同原 arguments/usage 交持久层，先存/结算再给一次结构反馈。E 同样走该严格纠正路径，不能补齐 JSON 冒充工具；原阶段 6 次/$0.30、内部视觉修复 2 次不增加。无 usage 则停在对账，不允许结构纠正重发。Node 26.12.0 下仅运行新增的两项最小适配器/账本检查，**2 项通过，729 ms**，覆盖两协议原参数/后到 usage、结算后失败重放不发第二次请求，以及未知费用继续保留。未重跑已通过的适配器、预算矩阵、媒体或完整 CI。

## 第九次：low 仍触及输出上限，按实际负载放宽 E token 空间

`aec4da98e18362121543fa97628bdadb3d8be41c` 经 [40095952537](https://github.com/ten2ten2/promobento/actions/runs/40095952537) 仅部署 Worker，复用相同镜像；自动全套 push `40095942148` 已取消。操作 `eval-deepseek-15-1792846835293`，输出 `artifacts/s1-deepseek-15-tool-receipt-2026-10-24`。B/C 继续免重付，review 媒体通过，E 在 low 请求下仍于 **8,192 token / 59,322 ms** 终态截断。没有进入自动结构纠正，坏工具路径没有在该轮触发；F 未执行。

[完整回执](ninth-attempt/report.json)：本轮模型 **2,926**，8 次计算停止/结算 **4,904** 保守上界，合计 **7,830 usd_micros**。容量/本轮未知为空，Workflow 对账、密钥回收完成。共享模型实际 **106,435** 加旧未知 **20,225**，共占用 **126,660**。这表明仅请求 low 不能保证短输出，不能把网关参数接受等同真实强度已验证。

下一候选只把 E 可用输出扩大到适配器已有的 **16,384 token**，供分析与完整 FilmSpec 工具写入；仍在原 **6 次/$0.30** 阶段上限内预留/计费，不扩总额、期限或质量门槛。F 保持 8,192。没有重复原 8,192 参数碰运气，也不把截断结果补成可用工具。

## 第十次：完整工具响应已取得，E 缺少积木参数定义导致猜字段

`8acef1e65b89af1ded23055511b93b5c468d3221` 经 [40096746500](https://github.com/ten2ten2/promobento/actions/runs/40096746500) 仅部署 Worker，镜像不变；自动全套 push `40096738412` 已取消。操作 `eval-deepseek-15-1792847367993`，输出 `artifacts/s1-deepseek-15-review-16k-2026-10-24`。本轮取得两份完整、可计费的工具响应，没有截断。

[首份 E](tenth-attempt/review-0-response.json)确实尝试填充空卡片，但发明 `bodySlot`（真实参数为 `subtitleSlot`），积木参数校验拒绝。该份通过 FilmSpec 结构校验，`body` 是受支持的文本 role。E 原消息只有 FilmSpec Schema，未像 B/C 提供积木自己的参数 Schema。[一次结构纠正](tenth-attempt/review-0-output-repair-1-response.json)改用实际产品图，却在只允许 `{film}` 的 `write_spec` 参数外又加 `note`，因此 `DIRECTOR_TOOL_INVALID`，未执行该修复、未到 F。不能删除 note 或映射猜测字段后冒充原工具通过。

[完整回执](tenth-attempt/report.json)：两次模型 **3,832**，8 次计算停止/结算 **4,887** 保守上界，共 **8,719 usd_micros**，无本轮未知/遗留容量，Workflow 已对账、密钥已回收。共享模型实际 **110,267** 加旧未知 **20,225**，共占用 **130,492**。

修正直接向 E 提供同一真实 `blockCatalog` 参数契约，写明两个工具各自唯一的包络，并把工具自身的精确 Schema 错误路径反馈给结构纠正；原完整校验、一次纠正和费用/次数门槛不变。只改提示/错误定位，不新增测试矩阵或改渲染器。

## 第十一次：契约修正通过，DeepSeek 仍耗尽两轮视觉修复

`92824a46909985e7b22b580920ebd5f27b7477bf` 经 [40097605133](https://github.com/ten2ten2/promobento/actions/runs/40097605133) 仅部署 Worker，同一镜像不变；自动全套 push `40097596386` 已取消。操作 `eval-deepseek-15-1792848186867`，输出 `artifacts/s1-deepseek-15-block-review-2026-10-24`。三次 E 都给出完整、合法的 `write_spec`；前两次修改已实际重新渲染。模型将空 API 卡片换成设备实图后继续调整，第三次仍要求修改，按原 **2 次内部视觉修复**落 `DIRECTOR_REPAIR_LIMIT`，未执行第三次改动、未到 F。保留该质量负例，不提高修复次数或假定质量通过，先推进其他题目。

[完整回执](eleventh-attempt/report.json)及[三份工具响应](eleventh-attempt/review-2-response.json)：模型 **5,616**，36 次计算（含新增 3D 镜头）均已物理停止/结算 **27,822** 保守上界，总计 **33,438 usd_micros**。无本轮未知/残留容量，Workflow 已对账、临时密钥已回收。共享模型实际 **115,883** 加旧未知 **20,225**，占用 **136,108**。模型/工具的完整契约已经可用，但不能据此把创作质量负例改成合格候选。

## MiniMax 首次：事实回复是散文，纠正上下文缺实际输出契约

执行前复核 [MiniMax 官网](https://www.minimax.io/)及[产品页](https://agent.minimax.io/about)，MiniMax Code 命名与已确认的三条功能声明仍可核对，未引入页面上的价格、速度/效果或其他新事实。操作 `eval-minimax-15-1792848706708`，输出 `artifacts/s1-minimax-15-2026-10-24`，使用同一部署。

[A 首份回答](minimax-first-attempt/facts-response.json)为 403 token 的散文/表格，不是 `fact_analysis`；[纠正](minimax-first-attempt/facts-output-repair-1-response.json)尝试输出事实数组，又在 **1,024 token** 截断。原 A 用户消息只带事实和 brief，Schema 只在 system，纠正消息也没重给实际契约；当前提示不足以稳定约束该线路。不能由此断言网关丢弃 system。尚未调用素材/B/C 或渲染。

[完整回执](minimax-first-attempt/report.json)：两次模型 **136 + 318 = 454 usd_micros**，0 新计算，无本轮未知/容量，Workflow 已对账、密钥已回收。共享模型实际 **116,337** 加未知 **20,225**，占用 **136,562**。

修正把事实响应 Schema 放到原用户消息，结构纠正同时携带相应 Schema/工具契约并区分 JSON 与实际工具回复；A 的事实/素材输出空间改为 4,096，次数/金额不提高。另将 C 的“事实证据逐字当标题”改为允许忠实压缩未定稿文案，明确保留任何用户定稿、名称/URL/CTA、限定条件、归属与事实绑定；不改原事实卡或确认。这是对真实画面中长句标题/空卡片的创作修正，不改变事实和独立冷审标准。

## MiniMax 第二次：A 显式契约通过，真实卡片布局碰撞导致修复耗尽

`d56cea6a3b7d2e004525d7216fbccd64d233d392` 经 [40099463344](https://github.com/ten2ten2/promobento/actions/runs/40099463344) 仅部署 Worker，同一镜像不变；自动全套 push `40099455917` 已取消。操作 `eval-minimax-15-1792849798870`，输出 `artifacts/s1-minimax-15-contract-2026-10-24`。事实 210 token、素材 838 token 一次通过；B 三张实际方向已查看并选择 Fit，Opus 一次纠正通过。E 完成两轮实际修改后仍要求第三次，按原上限 `DIRECTOR_REPAIR_LIMIT`，未到 F。

已取回并查看原 `review-1` / `review-2` 私有拼图：E 给卡片加上真实素材后，标题和副标题相互重叠。[造成该画面的合法 FilmSpec](minimax-second-attempt/review-1-response.json)在 `feature-grid` 传了受支持的 `assetKey`、`textSlot`、`subtitleSlot`；运行时却给标题 y=52% / h=42%，副标题 y=61% / h=30%，两个区域本身相交。该缺陷不由模型继续改字段或提高修复次数解决。原阅读观测没有对这组文本作成对碰撞检查，因此媒体数值通过不等于此布局正确。

[完整费用与回收](minimax-second-attempt/report.json)：模型 **37,333**，27 次计算停止/结算 **16,712** 保守上界，总计 **54,045 usd_micros**；无本轮未知/残留容量，Workflow 已对账、密钥回收。共享模型已计价结算 **153,670** 加旧未知 **20,225**，占用 **173,895**。本轮 B 请求 max_tokens=8,192，返回 usage 的 completion_tokens=10,857；其推理/输出统计口径尚未核对，按完整 usage 结算 3,631，低于本次预留 4,229，不把请求参数当成已证明的网关硬上限。

修复将上图卡片下方 40% 文案区分为标题 22%、间隔 3%、副标题 15%，`feature-grid` 实现同步为 1.0.1。无图/其他画幅不变，旧 release 保留原字节；离线 Studio 已按现有生成器重新生成，无差异。实际创作代码仍只在容器执行。新入口的两份 Node 脚本语法检查已一次通过；后续 Actions 新镜像、同源单帧与 CDP 结果见下一节，不重跑旧矩阵或完整 CI。

## 卡片布局修复：同源实际帧与 CDP 间隔通过

[40104630266](https://github.com/ten2ten2/promobento/actions/runs/40104630266) 在 `9d5ad9dbd46abcf65545390d07ec728c8be278c2` 由 Actions 构建/推送新镜像 **`sha256:f6599e3c5595a685bb214c4e844215c6d956f2dfd7d34d70d3f1083cb2d1527b`**，Worker `2cb2edea-c767-4aae-9201-c786ea3d7e8e`；仅部署/读健康，自动全套 push `40104621352` 已取消。实际镜像身份见[部署回执](card-layout/deployment-metadata.json)，与新 release 的当前元数据一致，没有复用旧容器源码。

新输入 `artifacts/s1-eval-inputs-layout-2026-10-24` 固定 `renderer-9d5ad9dbd46a`；按[单帧命令](../../../research/evals/README.md#只复验实际卡片的标题副标题碰撞)传原 MiniMax E `review-1` 完整回执。操作 `eval-minimax-15-1792854734062`，输出 `artifacts/s1-card-layout-2026-10-24`。实际 1080p 横屏 270 帧使用同一 FilmSpec、素材、Geist 600 与 seed；三组标题盒底至副标题盒顶的间隔均 **19.953125 px**，原帧观测无 BLOCK。[完整 CDP 记录](card-layout/layout-check.json)与[费用/回收](card-layout/report.json)可核对。

Codex 已查看实际 PNG，原标题/副标题重叠消失，完整文本及图片均保留；PNG 只留本机私有忽略目录。一次 studio 已物理停止并结算 **1,191 usd_micros** 分配资源保守上界，0 模型/影片编码，模型共享占用前后均 **173,895**；容量/未结为空，临时密钥已删。该回归不计入候选或 4/6，下一步继续真实 MiniMax 导演/冷审；未重做配乐、媒体矩阵或完整 CI。

## MiniMax 第三次：实际冷启动临近 30 秒，重试耗尽 review 期限

同一 `9d5ad9d` 部署，操作 `eval-minimax-15-1792854953412`，输出 `artifacts/s1-minimax-15-layout-fixed-2026-10-24`。A/素材复用，新的 B 三图实际查看后选择 Fit；C 一次结构纠正完成。首个 review 分段在 **30,000 ms** 未 ready；同行分段实际控制器启动 **29,381 ms**、音频 **25,812 ms**。确认失败实例停止/结算、退避 15 秒后，新 attempt 已进入执行，但耗尽原 **90 秒**整片期限而落 `RENDER_DEADLINE`，未到 E/F。该期限从本次 render 入队计算，不把方向选择等待误算进来。

[完整回执](minimax-third-attempt/report.json)：新 B/C/纠正模型共 **26,359**，8 次计算停止并结算 **10,877** 保守上界，总计 **37,236 usd_micros**。容量/本轮未知为空，Workflow 已对账、密钥回收。共享模型已计价 **180,029** 加旧未知 **20,225**，占用 **200,254**。

修正将物理控制器健康窗口独立配置为 **45 秒**，仍受原 render 剩余绝对期限约束；沙箱页面初始化 30/60 秒不变。纯 2D review 保留 15/30 秒的 **3/6** 个源时间轴分段以缩短最长分段，15 fps / 30 源帧切点与闭合 GOP 不变；最终片、WebGL 计划、并发名额、整片 90 秒、性能目标和重试次数均未放宽。实际冷启动数据只支持留余量，尚不代表新分布通过。

Node 26.12.0 定点分段检查一次通过（194 ms），覆盖 15/30 秒、review GOP、限制名额、最终片/WebGL 计划及原页面/整片期限。健康检查首次仅因新测试在 mock Date 启用前设置绝对 deadline，漏测剩余期限；修正夹具后只复验该失败项（1.80 秒）通过，含 32 秒 ready、45 秒超时、20 秒剩余上限、晚到 ready 拒绝与停止/结算。两份评测脚本语法检查通过；未跑全套测试、类型或旧 G1。新镜像与无模型原生结果见下一节。

## review 原生回归通过：90 秒期限内交付，没有重新调用模型

[40109101329](https://github.com/ten2ten2/promobento/actions/runs/40109101329) 在 `ed3fc49fab8e11f836307b324dfa6f18304d5cd3` 由 Actions 构建/推送新镜像 **`sha256:efb71645436c6504a59130d8e65c79544a54380fcd7c78df60aa127e964afc7a`**，Worker `5d4504d1-0e88-40d9-a3e5-d34287c524bd`；仅部署/读健康，自动全套 `40109089080` 已取消。[实际部署身份](review-cold-start/deployment-metadata.json)与固定 `renderer-ed3fc49fab8e` 的当前摘要一致。

首个私有 CLI 在 capacity 取得鉴权成功后，下一次只读 budget 仍收到旧绑定的确切 `404 Not found`，在创建操作前停止，[零模型/计算记录](review-cold-start/auth-propagation-no-work.json)保留。CLI 已复用 Actions harness 的 30 秒传播守卫：仅该路由前、未接纳工作的确切响应可等待；资源缺失、已接纳任务、供应商/媒体失败与未知超时不重发。

操作 `eval-minimax-15-1792857839971`，输出 `artifacts/s1-review-render-propagation-fixed-2026-10-25`。用原付费 E1 完整 FilmSpec、真实私有素材/字体/seed，只走一次横屏 review；[原生 D1 入队到提交 **79,241 ms**](review-cold-start/native-render-timing.json)，客户端读到通过 **81,248 ms**。三段各 150 源帧，实际 **960×540 / 15 fps / 225 帧 / 15 秒 / AAC**，两处接缝零差异；原观测和媒体/提交通过。[完整计划和媒体](review-cold-start/review-render.json)保留原 90 秒期限及一次 VBV 重编码（1 秒滑窗峰值 1,631,568 ≤ 2,500,000 bit/s）。这不是 review p50 ≤30 秒目标达标的证据。

[5 次计算](review-cold-start/report.json)全部首次成功、物理停止并结算 **9,410 usd_micros** 保守上界，实际控制器 ready **2,814–28,449 ms**；无模型调用，模型共享占用前后均 **200,254**，容量/未结为空、密钥回收。Chromium 155.0.8059.85 对实际 MP4 的 1.5/9/13.5 秒解码图已查看，三卡文字不重叠、CTA/URL 保留；完整 1× 播放到 15 秒无解码错误/掉帧，[解码回执](review-cold-start/decoded-video.json)。媒体与 PNG 只留私有目录，未进 Git/Actions 产物。该回归不计候选、完整导演或负责人视听；G1 分布/隔离/配乐未重跑，峰值仍待验。

## MiniMax 第四次：前两轮 review 通过，第三轮音频实例 45 秒未就绪

2026-10-25 再核对 [MiniMax 官网](https://www.minimax.io/)的 Code 命名、Coding/Work、agents 及多模态创作声明，原确认事实仍有官网依据；不采纳新价格/排名或业绩。`agent.minimax.io/about` 本次抓取不可达，官网已足以核对原三项声明，素材和原确认不改。

同一 `ed3fc49` 部署，操作 `eval-minimax-15-1792858052602`，输出 `artifacts/s1-minimax-15-coldstart-fixed-2026-10-25`。三张新方向 PNG 已查看：Fit 的实际产品界面最大且边界清晰，Amplify 的深色设备图更小，Unexpected 的浅色设备图对比偏弱，选择 Fit。客户端开始到方向就绪 **86.518 秒**（单例，不作 p50）。C 一次纠正完成；E 两次有效修改均进入下一轮媒体，前两轮 review 全部通过。

第三轮三段画面均成功，控制器 ready **1,858–1,938 ms**；音频实例却在新的 **45,000 ms** 健康窗口内始终未 ready，监视器仍 pending，9 次探测最后为 timeout。停止/回收尚未完成时原 **90 秒**期限耗尽，按 `RENDER_DEADLINE` 结束，未调用第三次 E、最终片或 F。[三次固定输入](minimax-fourth-attempt/render-inputs/review-2.json)显示第一/二轮 AudioPlan 身份相同，但第三轮已改变；不能直接拿上一轮声音替代本轮计划。尚未查明这次音频实例不就绪的原生原因，保留失败，不再调宽整片期限或重复同一例碰运气。

客户端首次 reconcile 等待超时，原业务失败与密钥回收已保存，但未取得完整停止/费用报告。新增[只恢复终态清理的入口](../../../research/evals/README.md#一次执行一份真实导演输入)实际调用原 reconcile，未启动模型/渲染；[补齐回执](minimax-fourth-attempt/report.json)确认 **19 次计算全部物理停止/结算 22,010** 保守上界，5 次新模型共 **34,580**，本轮合计 **56,590 usd_micros**。容量/本轮未知为空，Workflow 已终止/对账，临时密钥回收。共享模型已计价 **214,609** 加旧未知 **20,225**，共占用 **234,834**。普通 CLI 也已补逐步保存清理证据、单列清理错误和保留原失败；受影响两份脚本语法检查一次通过，没有重跑模型、原生片或 CI。

诊断期间本机 Wrangler 的 D1 管理查询返回 [7403 权限拒绝](minimax-fourth-attempt/d1-management-access-error.txt)；只读账户检查仍显示原账户、`d1 (write)`。已请求负责人重新授权/核查 D1 权限。既有 Worker 终态清理入口和 R2 素材/输入读取仍成功，失败任务已安全收尾。负责人恢复本机 D1 管理访问后，继续执行前活动操作盘点、查该音频 attempt 的原生失败原因与未完成导演链路。

## D1 已恢复；音频资源对齐一核，按原失败规格复验

负责人确认重新授权后，直接 D1 查询成功、活动操作为空，原失败 audio attempt 的 45 秒健康超时仍可核对。原生 Workflow 只记录被终止，音频 step 没有合成结果；具体启动失败原因仍未知。Wrangler 实例列表中的 inactive 行没有物理实例详情，`created` 此时取 DO 的 `assigned_at`，不能把它当作 VM 创建时间推断调度延迟。

对照[官方规格](https://developers.cloudflare.com/containers/platform/limits/)，发现实际 audio 派发的 standard-1 只有 **0.5 vCPU**，低于方案规定的一核、容器 FFmpeg 固定一线程的配置。当前修正为已有计价的 **standard-2（1 vCPU / 6 GiB）**，入口/调度/mock 共用 Worker 常量 `AUDIO_INSTANCE`；原 45 秒物理 ready、90 秒 review、页面限时、修复次数和名额不变。新 CPU 配置与启动超时的因果关系仍待原生证据判断，不据此改写前一版 G1 的音频规格或分布。

Node 26.12.0 下仅一次新增的音频派发单项检查通过（66 ms / 命令 1.31 秒），核对实际 profile、单次执行、原 generation/绝对期限、预算及结算。未重跑其他调度测试、模型或 G1。

[40113457211](https://github.com/ten2ten2/promobento/actions/runs/40113457211) 在 `e9be39b01b5559285264b6f9117db419d8bef8e8` 只部署 Worker，[复用](audio-sizing/renderer-reuse.json)原 `ed3fc49` 实际镜像；自动全套 `40113456118` 已取消。操作 `eval-minimax-15-1792861103225` 复用第四次付费 E1，FilmSpec 身份与原失败 review-2 完全相同（`ca260452…9ac49c`），素材/字体/seed 不变。客户端读到通过 **74,669 ms**，原 90 秒期限内交付 15 秒 / 540p / 15 fps / 225 帧 / AAC，两处接缝零差异；5 次计算全部首次成功、停止/结算 **6,729 usd_micros** 保守上界。[实际音频 standard-2](audio-sizing/report.json) ready **13,715 ms**，720,000 样本帧、−14 LUFS、−1.03 dBTP；0 模型，共享占用仍 **234,834**，容量/未结为空、密钥回收。[媒体计划](audio-sizing/review-render.json)与[部署身份](audio-sizing/deployment-metadata.json)齐全。

实际 MP4 的 1.5/9/13.5 秒已解码查看，Chrome 155.0.8059.85 完整 1× 播放到 15 秒无错误/掉帧；[解码回执](audio-sizing/decoded-video.json)留存，视频/PNG 仅在私有忽略目录 `artifacts/s1-review-audio-1cpu-2026-10-25`。该例证明一核配置下同源媒体链路可用；45 秒健康超时的平台首因、G1 新资源分布与完整导演另行判断。

## 审片补齐原需求，保留宣传故事而非改成核验页

上述实际 9 秒帧仍是重复产品图与大片空卡片，标题为 `Product claims, as MiniMax describes them`。原 E 请求只有当前 FilmSpec/积木/图片与媒体，没有原需求、确认事实或所选方向；因此其“事实忠实/故事连贯”判断缺少直接依据。F 原来也未收到原 brief 与选择，只有 facts/film/图片。当前修正让 E/F 同时拿到原 `briefContext` 与方向数据，F 仍是独立上下文。

C/E 提示现在聚焦用户要的具体产品/课程故事、按片长选择相关事实和清晰供应商归属，不把事实证据逐字当成标题或用审计标签填空；名称、用户定稿、CTA/URL、限定条件、许可署名和完整 factId/Schema 校验保留。没有增加修复轮数、费用或降低冷审标准。真实执行结果见下一节；未为纯提示变动重跑本地测试或旧矩阵。

## MiniMax 第五次：两轮媒体通过，改稿丢失 CTA 事实绑定

`58a92048bcbd06c79b4c723396735bec6dc3c0b0` 经 [40114873459](https://github.com/ten2ten2/promobento/actions/runs/40114873459) 只部署 Worker，[复用](minimax-fifth-attempt/renderer-reuse.json)同一 `ed3fc49` 镜像；[部署健康](minimax-fifth-attempt/deployment-health.json)正常。操作 `eval-minimax-15-1792862141172`，私有输出 `artifacts/s1-minimax-15-brief-review-2026-10-25`。A/B 复用，三张实际方向图和冻结方向与已查看版本一致，[沿用 Fit 选择](minimax-fifth-attempt/choice.json)。方向就绪 46.535 秒，仅是单次样本。C 一次纠正后通过，两个 review 的原生媒体 Workflow 均完成；本轮没有再次发生音频 ready 超时。

[E 第二轮原始工具](minimax-fifth-attempt/review-1-response.json)把积木实现补丁版本误写为 `feature-grid@1.0.1`，同时将 CTA `Explore MiniMax Code` 的 `factIds` 清为空。[一次纠正](minimax-fifth-attempt/review-1-output-repair-1-response.json)修好积木引用，完整 FilmSpec Schema 通过，但共享跨字段校验仍返回 `CLAIM_UNBOUND /texts/cta`。已用实际付费回执和原确认事实在本地定位，不再重新请求模型复现。不能删除 CTA 的事实绑定要求或代填无关事实来放行；未到最终横竖渲染/F，也没有合格候选。

[完整回执](minimax-fifth-attempt/report.json)：6 次模型 **32,608**、14 次计算均已物理停止/结算 **10,736** 保守上界，总计 **43,344 usd_micros**；本轮未知/容量为空，Workflow 已终止/对账，临时密钥回收。共享模型已计价 **247,217** 加旧未知 **20,225**，合计占用 **267,442**。

随后向 C/E 已有的提示 Schema 补 `id@major` 引用枚举、确认事实 ID 枚举及 CTA/数值/引语等绑定说明；不改完整执行校验、结构纠正或视觉修复上限。实际部署与下一轮结果见下节。

## MiniMax 第六次：CTA 绑定通过，旅程转场的真实接缝暴露栅格历史差异

`4548184dd27d28d12de59db03e26ea6e3079ee95` 经 [40124728590](https://github.com/ten2ten2/promobento/actions/runs/40124728590) 只部署 Worker，[复用](minimax-sixth-attempt/renderer-reuse.json)同一 `ed3fc49` 镜像，[部署健康](minimax-sixth-attempt/deployment-health.json)正常。操作 `eval-minimax-15-1792869602772`，私有输出 `artifacts/s1-minimax-15-fact-bindings-2026-10-25`。已再次查看三张实际方向图，选择 Fit；方向就绪 **43.194 秒**，不作分位数。执行前复核 MiniMax 官网仍使用 MiniMax Code 名称及原三项产品描述，没有扩充已确认事实。

C 用满三次规格调用后通过；首轮 review 在原 90 秒内完成。已付费 [E 工具回执](minimax-sixth-attempt/review-0-response.json)保留 `id@major` 与 CTA 事实绑定，通过完整准入，生成[第二轮 FilmSpec](minimax-sixth-attempt/review-1-film.json)。该轮 3 段画面和声音均执行成功，但在 **149 帧**接缝被拦下：最大通道差 **92**、差异像素 **5.1107253086419755%**；299 帧完全一致。没有拼接该轮影片、执行最终横竖片或 F。

只读复核 C 的[原始输出](minimax-sixth-attempt/spec-response.json)发现 JSON 末尾多一个闭括号；[第一次纠正](minimax-sixth-attempt/spec-repair-1-response.json)则在四处非 cut 转场没有安排镜头重叠。原解析失败反馈只含错误码，没有把已完整保存并计费的实际坏输出交给纠正请求，导致模型重写而非定点修正。当前把完整坏文字/工具参数作为 `previousOutput` 数据传入原纠正流程，同时在提示 Schema 说明半开区间及转场重叠关系；严格解析、完整校验、纠正次数与预算均不变，未知 usage 仍须对账。

Node 26.12.0 的既有规格纠正单项（534 ms）和坏工具参数先保存/结算单项（62 ms）通过，Worker 类型检查通过。规格回放同时发现旧测试仍要求相同纠正重复付款；未改动的 `45d1ea9` 源码也实际得到 2 次而非 3 次规格请求。已据现有“确切请求复用已付费回执”契约修正该断言：始终非法仍失败且无渲染，三次逻辑校验尝试只付两次不同请求的费用；没有降低校验或增加重试。真实纠正效果仍待部署验证。

已从私有 R2 下载并查看原 149/299 帧两组 PNG。149 帧为 `ui-showcase` 推入 `ui-journey` 的过程中，差异集中于旅程的图像面板：顺序帧模糊、冷 seek 清晰，文字和外层位置一致；三个分段 CPU flags 摘要相同。最初候选将旅程的 perspective 移至面板的直接父容器，去除后代 `preserve-3d`，零位移时移除恒等 transform；保留透视旅程、时间轴及原容差。新增原创素材的四画幅/双捕获比例、转场中与移动中顺序/逆序/冷 seek 回归；本地语法与运行时 TypeScript 7.0.2 检查通过，后续真实浏览器与原片结果见下文。

[完整回执](minimax-sixth-attempt/report.json)：4 次模型 **43,109**、13 次计算全部停止/结算 **12,679** 保守上界，总计 **55,788 usd_micros**。本轮未知和容量为空、Workflow 已对账、临时密钥回收。共享模型已结 **290,326** 加历史两笔未知 **20,225**，合计占用 **310,551**。本次失败不计成功导演或六题候选；未重跑性能矩阵、隔离或配乐。

### 旅程的确定性回归与原片复验

[40125749616](https://github.com/ten2ten2/promobento/actions/runs/40125749616) 在 `51a63c6` 用固定 Chromium 151.0.7922.34、原容差执行原创素材的回归。[报告](journey-raster/first-candidate.json)中原有四画幅 **72 次**比较通过，新增旅程横屏最终尺寸六项通过；review 的 149 帧逆序仍失败（最大 **63**、差异 **0.12442129629629631%**），其他画幅未继续。这说明只调整 3D 层级还不足以消除 review 的图像栅格历史差异；该候选没有部署。

`f6ce560` 的 [40126239915](https://github.com/ten2ten2/promobento/actions/runs/40126239915)将 review 的 0.5 比例固定在会话 `deviceScaleFactor`，实际尺寸和逻辑坐标检查通过，但[同一 149 帧反例](journey-raster/fixed-scale-candidate.json)数值不变；该捕获改动已撤回，未部署。`0d07753` 在 [40126680559](https://github.com/ten2ten2/promobento/actions/runs/40126680559)仅重建投影层、保留图像节点，仍取得[相同的反例](journey-raster/layer-reset-candidate.json)，额外的节点重建也已撤回。

`45d1ea9` 将旅程静态素材在初始化时按原尺寸解码至 canvas；[40127172566](https://github.com/ten2ten2/promobento/actions/runs/40127172566)的[原创 SVG 素材回归](journey-raster/canvas-verified.json)取得四画幅/双比例 **48 次**比较通过，最大通道差 **1**、差异像素最多 **0.02300347222222222%**；review 的 24 项全零差异。该证据只覆盖当时的原创 SVG，原 PNG 另行验证。

`be860ffdcb4754633575658cecbf3763253d275b` 经 [40127610185](https://github.com/ten2ten2/promobento/actions/runs/40127610185)构建并部署新镜像 `sha256:8b960db45181dc5752c77f6f53376d4d5ff94c1b62cd29d44f5489d62759981b`，操作 `eval-minimax-15-1792872263692` 复用本轮已付费 E0、原素材/字体/seed，没有模型请求。[真实 review 回执](journey-native-first/review-render.json)仍在 149 帧被拦下（最大 **245**、差异 **26.52951388888889%**），299 帧完全一致；已查看 PNG，顺序帧的旅程画布为空、冷帧有图。CI 的 SVG 通过不能替代实际 PNG。四次计算全部停止并结算 **9,750 usd_micros** 保守上界，[清理回执](journey-native-first/report.json)与[部署健康](journey-native-first/deployment-health.json)保留；共享模型占用仍 **310,551**，临时密钥已回收，没有该轮成片。

随后等待静态图片预解码、在旅程可见时逐帧绘制到原尺寸 CPU canvas，不只在隐藏的初始化阶段绘制一次。文字、点选、透视和动态视频 PTS 路径不变；同一回归替换为 **2200×1400 原创 PNG**并保留实际顺序帧，匹配真实故障的格式和尺寸。`suite=journey` 只复验受影响旅程，运行时类型与语法通过，实际结果见下文，原容差不变。内存平台查询与负责人暂缓决定统一见 [G1 证据](../2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)。

PNG 夹具首次误用了有尺寸上限的 review-sheet 编码器，[40128644787](https://github.com/ten2ten2/promobento/actions/runs/40128644787)在浏览器前即失败；生产上限未放宽，改用原固定 FFmpeg 编码夹具。`68f9a75` 的 [40129077839](https://github.com/ten2ten2/promobento/actions/runs/40129077839)取得[实际 PNG 回归](journey-raster/png-cpu-candidate.json)，横屏最终尺寸 185 帧冷 seek 仍为最大 **1**、差异 **0.11439043209876543%**，略超原比例门槛，未继续其余画幅。

同一运行时代码 `11ecd6253c9a0f3fd5ea1fc8a1c6321d390b4448` 经 [40128702674](https://github.com/ten2ten2/promobento/actions/runs/40128702674)部署，镜像 `sha256:16af910a0feaa625f704aafe14319a53bd3be94b590c3975c9547c94fd137ee2`。原规格操作 `eval-minimax-15-1792873401314` 的[实际 review](journey-native-cpu/review-render.json)仍在 149 帧被拦下，最大 **27**、差异 **0.18614969135802467%**；299 帧全零。已看原两张 PNG，空白已消除、产品图正常，但不据此绕过数值门槛。[四次计算](journey-native-cpu/report.json)均停止/结算 **8,059 usd_micros**，0 模型，共享占用仍 **310,551**，临时密钥回收。

`fd6bc03` 按 [Chromium 的资源复用选项](https://chromium.googlesource.com/chromium/src/+/1eab1994ee10fe58b342d8d89cb0b22e9f72201c/ui/base/ui_base_switches.cc)禁止近似尺寸的合成资源复用。[40129860364](https://github.com/ten2ten2/promobento/actions/runs/40129860364)的[实际报告](journey-raster/non-exact-resource-candidate.json)保留原 72 项通过，但 PNG review 的 185 帧逆序仍失败（最大 **13**、差异 **9.95949074074074%**）；该选项无效已撤回，没有部署。

`0c98098` 将实际场景位置/可见性设在积木绘制前；[40130658262](https://github.com/ten2ten2/promobento/actions/runs/40130658262)的[报告](journey-raster/scene-order-candidate.json)仍为原 72 项通过、PNG 横屏 185 帧冷 seek 最大 **1** / **0.11439043209876543%**。该引擎改动也已撤回，原引擎路径与此前有效代码相同。

`5803aa1` 把旅程图片画在固定逻辑尺寸的 CPU 画布中，以原 1800px 焦距、位移、纵深和角度投影素材。[40131547849](https://github.com/ten2ten2/promobento/actions/runs/40131547849)的[实际 PNG 报告](journey-raster/triangle-projection-candidate.json)中横竖屏和 feed 的全部 36 项、方形的 9 项通过；方形 review 的 149 帧冷 seek 仍为最大 **1** / **2.6680384087791493%**。查看实际图另发现三角裁片的细小拼接纹，因此该候选未部署。

当前改为直接逆投影取样、单次写入固定画布，移除三角裁片；素材原尺寸读取一次，以确定性像素均值建立缩小层级，保留透明度和 contain。DOM 文字、边框、点选、相机节奏及动态视频 PTS 保留，不增加 WebGL 前提、不修改预算/期限/接缝门槛。正逆投影校准单项通过（Node 26.12.0，2.98 ms），运行时 TypeScript 7.0.2 通过；`220957c` 的 [40132398160](https://github.com/ten2ten2/promobento/actions/runs/40132398160)取得[四画幅实际 PNG 的 48 次比较通过](journey-raster/inverse-projection-verified.json)：最大通道差 **1**、差异像素最多 **0.024594907407407406%**。已查看横屏移动中、方形 review 转场和竖屏移动中实际图，拼接纹消失，图片与原透视边框对齐。原片复验待完成；未重跑普通 72 项、媒体或配乐。

[40132839502](https://github.com/ten2ten2/promobento/actions/runs/40132839502) 已由 Actions 构建并推送 `220957c15e98dc32ea15c8793bbb15931eb20873` 的镜像 **`sha256:321543190be9136b2fafe1dcd8a888544be1b605a18b514b94d71b59cbec2ecf`**，但 Wrangler 在 Worker 上传后报容器应用设置未完成；[40133344359](https://github.com/ten2ten2/promobento/actions/runs/40133344359) 仅复用该摘要补部署仍失败，没有重建镜像。未取得包装错误的内部原因，不把这两次工作流记为通过。

之后的[只读诊断 40133657079](https://github.com/ten2ten2/promobento/actions/runs/40133657079) 用同一 Actions Token 对确切版本和容器应用均读到 **HTTP 200**：[版本的 ShardDO、应用名/命名空间/策略与新镜像一致](journey-inverse/deployment-inspection.json)，配置仍为空（本次没有应用设置变更）。[实际部署读回](journey-inverse/effective-deployment.json)确认版本 `40915f5c-34af-46a5-9693-74b7a6b0ec2a` 已承接 staging **100%** 流量。因此沿用已生效版本继续原片复验，不反复上传/构建；渲染仍须以容器实际镜像和媒体回执验收。

操作 `eval-minimax-15-1792876963508` 复用第六次已付费 E0、原私有素材/字体/seed，固定 `renderer-220957c15e98`；[原生 review](journey-inverse/review-render.json)在原 **90 秒**内交付，客户端读到通过 **69,149 ms**。149 帧接缝最大通道差 **1**、差异像素 **0.04996141975308642%**，299 帧全零，原容差通过。实际 **960×540 / 15 fps / 225 帧 / 15 秒 / AAC**；一次原有 VBV 纠正后峰值 **1,860,256 ≤ 2,500,000 bit/s**。三段实际镜像均为本节新摘要，[五次计算](journey-inverse/report.json)全部停止/结算 **7,879 usd_micros**，0 模型，未结/容量为空、临时密钥回收。

已查看实际 MP4 的转场中、移动中和后段解码图，产品图不再丢失、模糊历史差异与拼接纹已消除；Chrome 155.0.8059.85 完整 **1×** 播放到结束、无解码错误/掉帧，[解码回执](journey-inverse/decoded-video.json)。该回归不计成功导演或六题候选，也未达到 review 的 30 秒 p50 目标；继续完整 A–C/E/F。

## MiniMax 第七次：C 一次通过，大字被误用正文对比度门槛拦截

同一实际 `220957c` 镜像，操作 `eval-minimax-15-1792877270141`。三张新方向已查看，选择[蓝底的工作区导览](minimax-seventh-attempt/choice.json)，真实白色界面比白底边界更清楚，面积大于设备图。方向就绪 **141,543 ms**，该单例超过 2 分钟目标，完整分布仍待验。[C 原始回执](minimax-seventh-attempt/spec-response.json)经现有单一围栏解析、Schema/事实/转场和页面支持性检查一次通过；首个 review 三段画面与音频均成功，随后 `QA_BLOCK`，未到 E/F 或成片。

[三段实际 CDP 观测](minimax-seventh-attempt/observations-0.json)（[中段](minimax-seventh-attempt/observations-1.json)、[后段](minimax-seventh-attempt/observations-2.json)）均将文字判为 `largeText:true`、对比度 **3.324836041798544:1**，仍全部标 `low-contrast / BLOCK`。观测器没有采用方案 §7 原定的大字 **3:1**，而是硬编码全部文字 4.5:1；这与 [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 的大字规则不符。当前修正由 CDP 实际字号/字重区分大字与普通文字，分别执行原 **3:1 / 4.5:1**，不按 role 豁免、不舍入。主机观测单项通过（Node 26.12.0，6.92 ms），涵盖大小字号、粗体、大字仍低于 3、普通文字低于 4.5 及 4.478 不得进位；原片待新镜像复验，不改旧失败回执。

[费用与回收](minimax-seventh-attempt/report.json)：2 次新模型 **20,051**，8 次计算均停止/结算 **9,884** 保守上界，总计 **29,935 usd_micros**。共享模型已结 **310,377** 加旧未知 **20,225**，合计占用 **330,602**；原历史 128/14 和确认空值不变。临时密钥已回收，没有合格候选。原片复验入口扩展为直接读取已付费 C 完整 JSON，复用同一共享围栏/严格解析，不伪造 E 工具或重新付费。

### 大字云验通过；第二种透视积木暴露同类 PNG 问题

[40135202235](https://github.com/ten2ten2/promobento/actions/runs/40135202235) 在 `6559da7308b477d64683852e42c4e48fd2763c61` 完整构建/部署成功，[健康与预算回执](contrast-gate/deployment-health.json)正常；镜像 **`sha256:99d223a26cbe6f1731e92de67c33c4190b331a4c184ef73f36a486c54df53fa4`**，Worker `fd892c4e-568e-4933-a7ad-c806e6f77810`。原部分部署的包装错误未再出现，未修改平台设置绕过它。

操作 `eval-minimax-15-1792878395279` 用[同一付费 C](minimax-seventh-attempt/spec-response.json)、原素材/字体/seed，只走原生 review。[实际 CDP](contrast-gate/observations-0.json)（[中段](contrast-gate/observations-1.json)、[后段](contrast-gate/observations-2.json)）共 **18 个文字观测全部无 finding**，原 3.324836:1 蓝底和文案未改，证明大字误拦已修复。之后在两个 `ui-showcase` 推入的 149 帧被接缝拦下：最大 **20** / **1.4469521604938271%**，299 帧零差异；已下载并查看两张实际 PNG，差异集中于正在透视缩放的产品面板底边及阴影，不是文字。原生失败和停止费用见[回执](contrast-gate/report.json)；四次计算均停止/结算 **8,172 usd_micros**，0 模型，容量/未结为空、密钥回收。

当前让 `ui-showcase@1` 也共用旅程的固定 CPU 逆透视取样，边框/阴影/ROI 一并在固定像素面投影；原入场旋转、缩放、纵向位移及 DOM 文字/点选保留，实现升为 1.0.1，历史镜像不变。新增原 140–150 帧 showcase 推入时序的 2200×1400 原创 PNG 回归；shared 投影校准补缩放与纵移。当前候选正逆投影（含原入场缩放/纵移）单项通过（Node 26.12.0，3.31 ms），运行时 TypeScript 7.0.2 与浏览器脚本语法通过；实际四画幅 PNG 及原 C 复验仍待完成。

`e44b670` 的 [40136610496](https://github.com/ten2ten2/promobento/actions/runs/40136610496)取得[原 72 项、旅程 48 项及 showcase 44 项通过](showcase-raster/cpu-surface-candidate.json)，showcase 已完成的 44 项全零差异。剩余方形 review 149 帧逆序仍为最大 **1** / **1.7983539094650205%**，冷 seek 未继续。已查看实际 PNG，面板/ROI/阴影正常；保留原门槛。随后只复现该方形缩小场景，同时保留原尺寸 PNG 与画布像素，不重跑前述 164 项，结果见下文。

[40138194760](https://github.com/ten2ten2/promobento/actions/runs/40138194760) 的窄诊断取得六项通过，但未修改渲染代码，且增加了画布读回/原尺寸截图，不用它抹掉上一轮的方形反例。当前将 review 改为与 final 相同的完整逻辑尺寸截图：JPEG92 直送已有 FFmpeg scale，PNG 在主机以整数面积平均缩小。视频和 QA 都离开浏览器的半比例截图路径；15 fps、半尺寸输出、完整源时间线、原容差、期限和最终片捕获不变。PNG 编码器从导演拼图原实现移入共享契约模块并保留旧导出，尺寸上限不放宽。新增整数缩小/透明度单项（13.04 ms）和既有拼图完整帧/像素/尺寸拒绝检查（170.63 ms）通过；cloud TypeScript 7.0.2 通过。后续只复验改变的 review 路径，复用未改的普通与最终尺寸结果。

`ab4442f` 的 [40138961606](https://github.com/ten2ten2/promobento/actions/runs/40138961606)取得[新 review 路径四画幅的 48 次比较通过](showcase-raster/review-capture-verified.json)，最大通道差 **1**、差异像素最多 **0.03607253086419753%**，原门槛不变。已查看原方形反例及横竖屏的稳定帧，面板、阴影与 ROI 正常；普通 72 项和两种面板最终尺寸 48 项复用 `e44b670` 的适用结果，未重跑媒体/配乐。原 C 的真实复验见下文。


[40139493361](https://github.com/ten2ten2/promobento/actions/runs/40139493361) 在 `ab4442f` 构建/部署成功，镜像 **`sha256:70644412bc06d55a25c8aee7d4e5a7859bbc841634a365bb8fde6124633a48e7`**，Worker `79769107-701b-4388-9ee0-54d0a377831c`。操作 `eval-minimax-15-1792881915587` 复用第七次的同一付费 C、原素材/字体/seed；[真实 review](showcase-raster/native-review-render.json)在原 90 秒内交付，客户端 **75,439 ms**，149/299 帧接缝均零差异。实际 15 秒、960×540、15 fps、225 帧、有 AAC；原有 VBV 纠正后峰值 **1,424,992 ≤ 2,500,000 bit/s**。[五次计算](showcase-raster/native-report.json)全部物理停止/结算 **8,965 usd_micros**，0 模型，未结与容量为空、临时密钥回收。

已查看实际 MP4 的转场、ROI 和片尾解码图，面板/阴影正常；Chrome 155.0.8059.85 完整 **1×** 播放到结束，无解码错误/掉帧，[解码回执](showcase-raster/native-decoded-video.json)。该回归不计完整导演、最终片或负责人视听。已移除仅用于方形诊断的临时 selector 与画布导出，保留四画幅 review 的必要检查入口；继续完整导演。


### 停稳画面的取样优化

上述原 C 回执中，静态 showcase 停稳后每帧仍重复逆透视取样，明显慢于无产品图段。当前 1.0.2 只复用静态图片、入场和 ROI 都停稳时的不变像素，仍每帧写回 canvas，避免隐藏后首次画面丢失；回跳到运动帧立即重算，视频仍逐帧按 PTS 读取。运行时 TypeScript 7.0.2 与浏览器脚本语法通过；实际四画幅与耗时见下文。


## MiniMax 第八次：三轮真实 review 通过，网关请求失败

操作 `eval-minimax-15-1792882183168` 使用 `ab4442f` 镜像和原私有事实/素材，三张实际方向图已查看并[选择 Fit](minimax-eighth-attempt/choice.json)。方向就绪 **114,108 ms**；[C](minimax-eighth-attempt/spec-response.json)一次通过，选定到首轮草稿提交约 **103,540 ms**。E 的[第一次](minimax-eighth-attempt/review-0-response.json)与[第二次](minimax-eighth-attempt/review-1-response.json)改稿都保留事实绑定并通过完整准入；[三轮 review 媒体](minimax-eighth-attempt/database.json)均交付，没有再出现观测或接缝阻断。

随后 E 第三次请求在适配器的 HTTP/响应体入口失败，首因为 `MODEL_REQUEST_FAILED`，没有可计价 usage 或完整响应回执；旧代码未保存具体 HTTP 状态，因此无法据此判断网关限流、服务器故障或其他 HTTP 原因。没有重发此请求，也未到最终横竖片/F。新路径仅保存去敏的 HTTP 状态/请求身份和未知用量状态，不保存响应正文或凭据，不增加重试、不把未知记零；新增离线 HTTP 503 单项通过（Node 26.12.0，92.15 ms），Worker TypeScript 7.0.2 通过，真实故障诊断效果仍待遇到该错误时验证。

[本轮回执](minimax-eighth-attempt/report.json)：4 次模型已结 **19,920**，第五次未知保留 **17,768**；15 次计算均停止/结算 **24,719** 保守上界，临时密钥回收、容量为空。共享新增模型已结 **330,297**，三笔未知预留 **37,993**，合计占用 **368,290 usd_micros**，旧历史 128/14 与开账空值不变。未知模型消费仍占用预算；本次没有合格候选，不计 4/6。


[40140772761](https://github.com/ten2ten2/promobento/actions/runs/40140772761) 在 `4dd5699` 完成[showcase 四画幅、最终片/review 的全部 48 次比较](showcase-raster/settled-pixels-browser.json)，均为零差异，沙箱/无外网断言也已通过；已查看实际方形 review 与横屏 ROI 图。job 随后在报告收尾因清理遗留的 `rasterOnly` 名称而失败，不记作整个 CI 通过。已修正报告分支和场景标签，语法通过；不重跑已完成的像素比较，完整 CI 的报告收尾仍未复验。取样优化的原 C 实际媒体/耗时另验。


[40140997061](https://github.com/ten2ten2/promobento/actions/runs/40140997061) 在 `09179831d2b6ebccc879c6938d1a2b11fdc72c6c` 部署成功，镜像 **`sha256:1b1c4cf1372e6406d7ab1a79ccafaebbb51a8eee76d2c13daf2d357d3114d0a5`**，Worker `92042b76-7281-41a5-8f61-ad27de168ba2`。操作 `eval-minimax-15-1792883239966` 沿用第七次的同一付费 C、原素材/字体/seed，[真实 review](showcase-raster/settled-native-review-render.json)在 **72,970 ms** 交付，149/299 帧均零差异；15 秒、960×540、15 fps、AAC、225 帧，VBV 纠正后峰值 **1,457,792 bit/s**。[五次计算](showcase-raster/settled-native-report.json)全部停止/结算 **8,569 usd_micros**，0 模型，容量/未结为空、临时密钥回收。

三个分段 renderMs 为 **20,163 / 15,705 / 13,884**；上轮同片前两段为 25,851 / 22,208 ms。本轮完整墙钟仍为 72.970 秒，单次对照不作延迟分位数或 30 秒 review 目标通过。已查看实际 MP4 的 ROI 停稳图，产品图没有因像素复用丢失；Chrome 155.0.8059.85 完整 1× 播放、无解码错误/掉帧，[解码回执](showcase-raster/settled-native-decoded-video.json)。开始其余题目验收，完整导演仍未通过。


## IELTS 首次：草稿通过，E 用满 16k 输出仍未调用工具

操作 `eval-ielts-ready-15-1792883344124` 使用 `0917983` 的固定 release、负责人确认的三项课程内容及已批准原创事实图。已查看三张实际方向图并[选择 Unexpected](ielts-first-attempt/choice.json)：暖底完整事实图较空卡片或缩小的概念设备更清楚。C 一次通过，[首轮真实 review 与五次计算](ielts-first-attempt/report.json)全部成功并停止/结算，随后 E 在输出上限截断，未到最终片/F。

[原始回执诊断](ielts-first-attempt/truncation.json)：usage 的 completion_tokens 恰为 **16,384**，完整流结束，正文 **70,510 字符**仍在反复分析布局，**0 个工具调用**；原回执在私有 R2。没有把部分文字提取成规格或重新请求同一回执。本轮五次模型已结 **24,097**、五次计算 **11,592** 保守上界，无本轮未知，容量为空、密钥回收。共享新增模型已结 **354,394**，原三笔未知 **37,993**，合计占用 **392,387 usd_micros**。

当前只将 E/F 的兼容参数由 low 改为 `reasoning_effort:none`，输出、次数、金额、质量校验及独立上下文不变。依据 [DeepSeek 官方 API](https://api-docs.deepseek.com/api/create-chat-completion/)对 none 的说明；[网关公开文档](https://api.modelswitch.org/docs)未描述此参数，不能据此假定其实际转发。参数传输单项通过（Node 26.12.0，2.50 ms），现有绑定/预算配置检查通过；真实网关效果待下一题验证，原能力登记仍只表示接受过 low。


## IELTS 第二次：E/F 完整返回，冷审混淆了拼图边界

[40142403757](https://github.com/ten2ten2/promobento/actions/runs/40142403757) 在 `8c0a4c0e9eaf26f8ba51c80aea65974f9daff7fd` 构建/部署成功，镜像 **`sha256:3863520b644116337cba272090a2a592762f2eb010ae4f79491eda5d68d04b01`**，Worker `d999cebc-9a6f-4a97-af82-d59ea57263a4`。操作 `eval-ielts-ready-15-1792884514265` 三图已查看并[选择 Fit](ielts-second-attempt/choice.json)。当前 none 请求被实际接受：[E 返回 submit_candidate](ielts-second-attempt/review-0-response.json)，F 返回[完整 block JSON](ielts-second-attempt/cold-review-response.json)，随后 C 纠正、E 两轮工具均完整返回。不能由此推断网关内部思考已关闭；仍未交付合格候选，最后因 E 要求第三次内部修复而按原上限停止。

已下载 F 看到的两张原拼图与横竖实际 MP4。冷审将未占用的黑色格子当作影片留黑，并将两个完整课程卡片判作超出画面边界；实际 MP4 9 秒的课程文字均完整、没有该裁切/重叠。[横屏](ielts-second-attempt/landscape-film-decoded.json)和[竖屏](ielts-second-attempt/portrait-film-decoded.json)已完整 1× 解码播放，无错误/掉帧。这不改变旧冷审失败，也不替代负责人视听；课程图较小、卡片留白等实际质量仍须继续判断。

原拼图把 7 个帧直接拼成 3×3，无分隔/可见帧号，最近邻缩小还丢失细字和边框。当前保持全部源帧、两张图片和原 960×1920 / 1 MiB 上限，常规片改为两列、面积平均缩图；片外增加 `FRAME <帧号>`、深灰间隔与 `NO FRAME` 标记，E/F 都按 tiles 的精确矩形区分影片像素与审片包装。已用相同原生 PNG 重排并查看[横屏元数据](ielts-second-attempt/labelled-sheet-landscape.json)/[竖屏元数据](ielts-second-attempt/labelled-sheet-portrait.json)，分别 932×1164 / 522×1884、109,396 / 90,532 bytes，全部 7 帧保留，未重新渲染或调用模型。云端判断效果仍待验。

两个拼图单项通过（184.53 / 322.43 ms），涵盖全帧顺序/来源、比例、尺寸拒绝、细笔画均值与包装分隔。双协议回放发现旧夹具仍将 F 改绑未启用的官方 Sonnet；仅 8,192 输出 token 最坏预留就为 **81,920 > 50,000 usd_micros**，不可能通过现行阶段预算。夹具现只在 C 切换原生协议，F 保持实际的独立 DeepSeek 绑定；不提高生产预算。修正后的双协议单项通过（500.64 ms），Worker TypeScript 7.0.2 通过；没有重跑前述已通过的像素检查或完整测试。

[本轮费用与停止](ielts-second-attempt/report.json)：7 次模型已结 **49,727**，25 次计算全部停止/结算 **42,134** 保守上界，无本轮未知，容量为空、密钥回收。共享新增模型已结 **404,121**，三笔未知 **37,993**，合计占用 **442,114 usd_micros**。两部实际 15 秒最终媒体耗时 **94,751 / 102,706 ms**（[原生计时](ielts-second-attempt/database.json)），均需原有码率纠正重编码；不能据此宣称 45 秒目标通过，当前资源的 G1 分布仍待验。


## IELTS 第三次：拼图边界误判消失，暴露固定片尾布局问题

[40144637588](https://github.com/ten2ten2/promobento/actions/runs/40144637588) 在 `10a3333` 只部署 Worker，版本 `42f77b32-6876-4491-a8a2-2d8d3dc91fad`，复用同一 `8c0a4c0` / `sha256:3863520b644116337cba272090a2a592762f2eb010ae4f79491eda5d68d04b01` 镜像。操作 `eval-ielts-ready-15-1792886220636` 的方向冻结数据及三张预览身份与上轮相同，[沿用已逐张查看的 Fit](ielts-third-attempt/choice.json)；A/B/C 复用已付费结果，没有再次付款。

新 E/F 完整读取标注拼图；[冷审](ielts-third-attempt/cold-review-response.json)不再把补位区当影片留黑或将完整课程卡片判作越界，转而指出套餐表述、素材过小与 CTA/URL 分散。C 纠正后的 E 又请求修复，按原两次内部上限停止，仍无合格候选。片尾积木把 CTA 固定在安全区 30%、URL 在 80%，参数只有文字/Logo，模型无法通过改 FilmSpec 修复这种相距半屏的布局。

当前将 `cta-endcard@1` 实现升为 1.0.1：按已适配的实际文字高度居中排列 CTA/URL，Logo 或短线与文字同组、共同入场；原文字、字号下限、点选和音效事件不变。同时在原 showcase 参数描述中说明 focus 只是高亮、不放大，密集素材可省去伴随标题以给图片更多面积。新增四画幅带 Logo 与 CTA/URL 间距检查，实际布局/冷审待验；不更改任何成片质量、费用或修复门槛。

[本轮回执](ielts-third-attempt/report.json)：5 次模型已结 **24,267**、29 次计算全部停止/结算 **34,299** 保守上界，无本轮未知、容量为空、密钥回收。共享新增模型已结 **428,388**，三笔未知 **37,993**，合计占用 **466,381 usd_micros**。


### 新片尾的四画幅检查通过

`918e5d5` 的 [40146197967](https://github.com/ten2ten2/promobento/actions/runs/40146197967) 在固定 Chromium 151.0.7922.34 取得[原 72 次比较全零差异](closing-layout/browser-report.json)，四画幅 CTA/URL 间距、原安全区/字体/点选及带 Logo 的四组布局均通过。已查看横竖默认片尾及 feed/方形 Logo 版，CTA 与网址成组、不再相距半屏。报告收尾也实际通过，原变量错误不再列为未验证；不重跑旅程/showcase 专项、媒体或配乐。真实 IELTS 与独立冷审另行验证。


[40146200239](https://github.com/ten2ten2/promobento/actions/runs/40146200239) 在 `918e5d562afa5bfcb3cf578c04f6b8a4dc0e9283` 构建/部署成功，新镜像 **`sha256:dbacb2d070778aa6eeda1d0bc8874a8f57012270e7132024b0e43cb89b7aa021`**，Worker `bc55b664-692a-41e2-9c44-ce2172d28aeb`。首次真实操作 `eval-ielts-ready-15-1792887960107` 在导演的独立容器健康预检返回 `RENDER_STARTUP_TIMEOUT`，没有调用任何模型、生成方向或提交作品；[唯一计算](closing-layout/director-startup-failure.json)在 45.492 秒停止并结算 **2,781 usd_micros**，未结/容量为空、临时密钥回收。不能用部署健康或 CI 代替该容器通过，也不能由空 attempts 推断零计算（该路径为 studio 模式）。保留启动上限与失败，转用已付费规格的模型零调用原生 review 核对新镜像启动与实际片尾，不反复付费重跑导演。


随后操作 `eval-ielts-ready-15-1792888290389` 在同一新镜像沿用 IELTS 第一份完整付费 C、原素材/字体/seed，只走原生 review。[实际媒体](closing-layout/native-review-render.json)在 **53,824 ms** 交付，149/299 帧均零差异；15 秒、960×540、15 fps、225 帧、有 AAC，原有 VBV 纠正后峰值 **1,440,384 ≤ 2,500,000 bit/s**。新镜像的容器启动/沙箱、实际片尾与媒体路径已取得成功回执，但首次健康预检超时的内部原因仍未知，未增加上限或抹掉失败。已查看实际 MP4 片尾，CTA 与网址确已紧密成组；完整 1× 播放无错误/掉帧，[解码](closing-layout/native-decoded-video.json)。[五次计算](closing-layout/native-report.json)全部停止/结算 **6,427 usd_micros**，0 模型、无未结/容量、密钥回收。该回归不计成功导演或负责人通过，接着用 MiniMax 真实界面区分通用导演与 IELTS 图文密度问题。

## MiniMax 第九次：三轮 review 交付，E 在文案上往返耗尽修复

操作 `eval-minimax-15-1792888514649` 使用同一 `918e5d5` 固定镜像。环境预检通过，三张真实方向均已查看并[选择 Fit](minimax-ninth-attempt/choice.json)；[C](minimax-ninth-attempt/spec-response.json)一次通过，[三轮 review 媒体](minimax-ninth-attempt/database.json)全部交付、接缝零差异。E 首次把结尾转场改成 cut 却保留 8 帧，完整用量先结算后由一次[结构纠正](minimax-ninth-attempt/review-0-output-repair-1-response.json)恢复 crossfade。两次有效内部修复后，第三次 E 仍要求 write_spec，按原上限停止，未到最终横竖片/F。

已查看三张实际审核拼图（原图仍在私有 R2，[帧引用](minimax-ninth-attempt/review-2-images.json)）。CTA 与网址已紧密成组；开场标题/副标题仍上下分散，原功能网格的文字在大空框中太弱。E 用同一截图填了三张卡，随后将 UI 的中性标题改成未归属的功能声明，又在[下一轮](minimax-ninth-attempt/review-2-response.json)改回原文；还改了不影响画面的 purpose/continuity。据此将开场成组、纯文字功能/课程网格按实际文字高度收紧，去掉空图片框。参数说明明确主标题/辅助文字和可选图片；E 保留原事实/质量门槛，只修具体可见缺陷，不用同图填空或同义改写消耗次数。运行时 TypeScript 7.0.2 与浏览器脚本语法通过，四画幅实测见下文；完整导演另行验收，未重跑完整测试或 CI。

[费用与回收](minimax-ninth-attempt/report.json)：6 次新模型已结 **25,312**，19 次计算均物理停止/结算 **18,039** 保守上界，无本轮未知、容量为空、临时密钥回收。共享新增模型已结 **453,700**、原三笔未知 **37,993**，合计占用 **491,693 usd_micros**；原历史 128/14 和开账空值不变。仍无合格候选，不计负责人 4/6。

`b4a53d1` 的最小 [40148619883](https://github.com/ten2ten2/promobento/actions/runs/40148619883) 在首个页面准备时被原运行时规则拒绝：[开场同时返回 timeline 与 render](typography/first-browser-report.json)，没有产生有效布局/像素结果，也未部署到 staging。现把同一开场运动和实际高度排版合并到单一 `render(time)`，不改引擎的互斥规则；只复验本次受影响的 typography 场景。

`f3d7aa7` 的 [40149001200](https://github.com/ten2ten2/promobento/actions/runs/40149001200) 已通过横屏开场和功能网格的布局/字体检查并保存实际 PNG，已查看；随后课程网格的字体检查返回空：[报告](typography/second-browser-report.json)。同一文字槽位在功能/课程镜头复用，测试的全局选择器取到了已隐藏的前一镜头。仅将测试定位收窄到实际可见的 scene/slot，仍要求真实自定义字体，运行时代码与门槛不改；该轮没有完整像素/其余画幅结果，修正后的证据见下文。

`5e17289` 的 [40149352459](https://github.com/ten2ten2/promobento/actions/runs/40149352459) 取得[四画幅开场、功能与课程的 24 次比较全零差异](typography/browser-report.json)，实际字号/字体、安全区、主辅文间距、长文字拒绝均通过；已查看实际四画幅，纯文字不再落在大空卡框里。随后 `4708235` 的 [40149766557](https://github.com/ten2ten2/promobento/actions/runs/40149766557) 仅补[开场 0/12 帧的 16 次比较](typography/opening-motion-report.json)，同样全零差异；已看实际运动期图。运行时代码仍为 `5e17289`，没有重跑前述通过项、媒体或声音。

[40149355093](https://github.com/ten2ten2/promobento/actions/runs/40149355093) 已在 `5e1728997a213b44f831a6700e10f715bd574747` 构建/部署镜像 **`sha256:15647bfa6a76701b133d0a1d965ac904d894a7a9500d0a5ec0d80e33265bdfbb`**，Worker `d666fba4-5873-4769-a8d3-b65af68c31d1`。[只读健康](typography/deployment-health.json)正常、容量为空、模型账本占用仍为 **491,693 usd_micros**，部署本身 0 模型/渲染、临时密钥回收；真实导演沿用该固定 release 继续，不改生产开关。

## MiniMax 15 秒：首份完整候选通过冷审，渲染时间未达标

操作 `eval-minimax-15-1792891140650` 使用上述固定镜像，[选择 Fit](minimax-15/choice.json)。原 Fit 图片身份与已看画面一致，新 Amplify/Unexpected 均已查看；A/素材理解复用，B/C 新调用。E 只作一次实际修复：去掉界面旁的核验标题，让真实产品图放大；随后 submit_candidate，独立 F 返回[完整 pass](minimax-15/cold-review-response.json)。[候选](minimax-15/candidate.json)与[执行回执](minimax-15/report.json)均保留：选方向到交付 **460,808 ms（7 分 40.808 秒）**，方向就绪 **124,984 ms**。它是 12 份创作输入中的 **1 份**，对应 24 部最终片中的 **2 部**；正常速度负责人视听仍为 pending，MiniMax 30 秒尚未完成。

两部实际 MP4 均为 15 秒、450 帧、1080p/30 fps/AAC，各 149/299 接缝零差异；码率纠正后分别 **6,584,248 / 5,382,688 bit/s ≤ 10,000,000**。已查看原生解码的横竖画面，Chrome 155.0.8059.85 完整 1× 播放无错误/掉帧：[横屏](minimax-15/landscape-film-decoded.json)、[竖屏](minimax-15/portrait-film-decoded.json)。截图改为同源回环播放器中提取已呈现的视频像素，排除了原 file 播放器控件/加载转圈；复用同一不可变 MP4 已通过的完整播放，未重复播放验证。

[实际阶段时间](minimax-15/database.json)显示横竖最终渲染 **85,474 / 80,238 ms**，均未达 45 秒目标。横屏运动分段实际渲染 39,817 ms，75–102 帧捕获多为 0.55–0.80 秒；两部拼接均作第二次编码，assemble 实例约 23–24 秒。据此将静态面板和 ROI 端点预合成、按预乘透明度仅融合差异像素，入场每帧只投影一次；停稳底图保留原取样；15 秒也使用既有 6 段上限，初始分段即采用已有窗口余量。视频、平台上限、绝对期限及物理并发上限不改。新分段单项（34.39 ms）、最终质量参数/旧 review 输出兼容单项（54.59 ms）、像素透明度与回跳/源不变单项（4.22 ms）和运行时 TypeScript 7.0.2 通过，CLI 语法通过；未重跑不受影响的检查。`--check-final-render` 复用该付费规格，只作横屏最终质量回归，不为性能修复重跑模型。

5 次新模型已结 **21,243**，25 次计算均停止/结算 **27,619** 保守上界，无本轮未知、容量为空、临时密钥回收。共享新增模型已结 **474,943**、三笔未知 **37,993**，合计占用 **512,936 usd_micros**；原历史、开账空值、内存例外及生产关闭状态不变。

## 面板与编码修复：实际媒体通过，性能仍未达标

`94e80033a26ac5d7cb7cfaa95332c2bb4399596b` 的 [40153760216](https://github.com/ten2ten2/promobento/actions/runs/40153760216) 只复验 showcase：四画幅、正式/半尺寸、运动/停稳/回跳与独立冷 seek 的 [48 次比较全零差异](panel-performance/browser-report.json)，已看实际四画幅。未重复 typography、普通运行时、journey、媒体或 13 风格检查。[40153762685](https://github.com/ten2ten2/promobento/actions/runs/40153762685) 由 Actions 构建/部署镜像 `sha256:798cb7aca18cd0959bda60be35e61f6767e09148810f7917d9f13c915d8a6c6f`，部署日志 Worker 版本 `ac0dd262-b55d-440a-b967-81a2f893a50c`；[部署健康](panel-performance/deployment-health.json)无活动计算，模型账本占用未变。

操作 `eval-minimax-15-1792894943297` 从上述完整付费 E0 回执只渲染一部最终横屏片，0 模型请求。[媒体](panel-performance/final-render.json)为 15 秒、450 帧、1920×1080/30 fps/AAC、5,012,677 bytes，一秒峰值 **5,854,264 bit/s**，`reencoded:false`；五处 74/149/224/299/374 接缝全零差异。已看实际解码画面，[完整 1× 播放](panel-performance/final-film-decoded.json)无错误/掉帧。

[D1 创建至完成](panel-performance/database.json)为 **72,483 ms**，客户端至读到 passed 为 **74,033 ms**，仍未达 45 秒目标。运动分段 render 为 20,975 ms，但本次 shard 实例启动为 14,377–16,334 ms（原完整候选约 1–2 秒），assemble 实例 11,344 ms；不同启动条件的单片不能作为分位数或宣称门槛通过。[回收](panel-performance/report.json)确认 8 次计算均停止/结算 **14,103 usd_micros**、无未结、容量为空、临时密钥删除；原内存 null/原因和共享模型预算不变。继续真实 30 秒创作和当前资源分布验收，不重跑已付费的 15 秒导演。

## MiniMax 30 秒首轮：两轮 review 交付，公共说明塞入单卡后阻断

操作 `eval-minimax-30-1792895116834` 沿用 `94e8003` 的固定镜像。运行前核对[官网](https://www.minimax.io/)仍使用 MiniMax Code、Coding/Work modes 和既定功能陈述；三张实际方向均已查看，[选择 Fit](minimax-30-first/choice.json)保留最大的清晰产品界面，另外两种 3D 摆放缩小/冲淡了真实截图。[C](minimax-30-first/spec-response.json)一次通过，[两轮低清横屏](minimax-30-first/database.json)分别 **45,226 / 52,440 ms** 交付，均不再整片重编码。尚未到最终横竖片或 F。

E0 缩短卡片文字与标题，得到已看实际[拼图引用](minimax-30-first/review-1-images.json)：标题 “The workflow MiniMax describes” 已为功能列表提供归属。E1 却又[新增](minimax-30-first/review-1-response.json) 68 字符的共用来源/非独立测量说明，放进四列布局第一卡的两行副标题；相对前一规格，其余可见字段未变。下一轮全部画面分段在准备时被 `TEXT_FIT_FAILED` 拒绝，停止，不提高两次修复上限。

据此为 C/E/F 增加同一文案层级指引：功能陈述的明确近邻归属足够，额外免责声明不能替代真实效果/性能证据；共用来源用通栏标题区，单卡副标题只放简短条目补充。原事实绑定、必要限定/署名、可读字号、行数与独立冷审门槛不变。Node 26.12.0 下既有双适配器 A–C/E/F 和 E 实修两项本地回放通过（558.47 / 420.73 ms），未重跑无改动的渲染器；新提示实际效果待后续原生验收。

[费用与回收](minimax-30-first/report.json)：4 次模型已结 **24,167**，27 次计算均停止/结算 **22,517** 保守上界，无本轮未知、容量为空、临时密钥回收。共享新增模型已结 **499,110**、原三笔未知 **37,993**，合计占用 **537,103 usd_micros**；原历史开账空值、内存例外与生产关闭不变。本轮不增加 1/12、2/24 或负责人 4/6 的通过数。

## MiniMax 30 秒第二轮：文字可适配，E 继续小幅改写至上限

[40155511220](https://github.com/ten2ten2/promobento/actions/runs/40155511220) 只部署 `bf6c3f3` Worker，严格检查后复用 `94e8003` 镜像，未重建渲染器。操作 `eval-minimax-30-1792896226960` 的原 A/B 复用；三张方向的内容与原生图片身份不变，[沿用已完成的视图判断](minimax-30-second/choice.json)，没有重做同一视觉检查。C 新调用，三轮 review 均交付：[60,492 / 45,983 / 40,095 ms](minimax-30-second/database.json)，全部为 540p/15 fps/AAC 且未整片重编码，先前的文字适配阻断未再出现。

已看第三轮[实际拼图引用](minimax-30-second/review-2-images.json)。E0 改标题/补充短文，E1 又改通栏归属；E2 最后仅[提议改写](minimax-30-second/review-2-response.json) “Start with one message, then select a folder.” 为 “One message, then a folder.”，达到原两次上限而停止，未进入最终片/F。每轮 E 先前只看当前规格，不知道已经应用过哪些修改；现补入有界的前次规格与已用次数，要求核对既有修改、一次处理具体缺陷。Node 26.12.0 的既有 E 修复、F 修复及上限/首因三项本地回放通过（417.72 / 820.63 / 240.23 ms），检查历史隔离与次数不重置。F 不接收该历史，不因剩余次数少而降低门槛；实际效果待验。

[实际费用及回收](minimax-30-second/report.json)：4 次新模型 **19,247**，28 次计算均停止/结算 **31,568 usd_micros**，无本轮未知、无容量/密钥遗留。共享新增模型已结 **518,357**、原三笔未知 **37,993**，合计占用 **556,350 usd_micros**；完整通过数仍为 1/12、2/24。

## MiniMax 30 秒第三轮：历史已送达，界面布局仍未收敛

`9dd8b36` 随 [40156758448](https://github.com/ten2ten2/promobento/actions/runs/40156758448) 部署后，操作 `eval-minimax-30-1792899762451` 的三张新方向均已查看并[选择 Fit](minimax-30-third/choice.json)。C 与三轮 E 已实际运行，三部 review 分别在 **42,400 / 58,650 / 43,719 ms** 交付，未到最终片/F；第三次 E 仍请求修复，按原两次上限停止。[原始模型回执、媒体及回收](minimax-30-third/report.json)保留，修复历史不再标为“尚未送达”。

已查看第三轮[实际拼图](minimax-30-third/review-2-images.json)：标题、三列功能与 CTA 清楚；真正界面仍被旁列文案压到小面板。E0 修正过度承诺的开场，E1 去掉 focus，却未去掉占据左列的 textSlot；E2 才要求将同一截图重复放入 ui-journey。这里还有真实尺寸问题，不能把第三次 write_spec 当同义润色而直接放行。现为 C/E 明确已有积木行为：ui-showcase 的 textSlot 占独立列，密集截图应去掉它以获得大面板，必要文案放相邻标题；focus 只高亮，不裁剪/放大，也不靠重复同图放大。该做法已在通过的 MiniMax 15 秒实际采用。原修复上限、文字门槛与独立 F 保留，新提示的真实效果待验。

[费用及回收](minimax-30-third/report.json)：5 次新模型 **25,772**，29 次计算均停止/结算 **25,434 usd_micros**，无本轮未知、容量为空、临时密钥删除。共享新增模型已结 **544,129**、原三笔未知 **37,993**，合计占用 **582,122 usd_micros**；仍为 1/12、2/24，负责人正常速度视听 pending。

## 原创音乐首轮：ABC 准入通过，超尺寸素材阻断方向预览

负责人已批准[原谱及其合成 WAV 的 15/30 秒内部测试](../2026-10-24-s1-audio-review/original-score-test-clearance.json)，15 秒取前半段，不公开。两段源母带已由同一预构建镜像生成，均 −14 LUFS，真峰值 −2.67 / −2.56 dBTP；原谱、WAV 与完整批准材料保存在私有存储和本地暂停分支，不进入公开仓库。

操作 `eval-duolingo-15-1792902641482` 使用 `fbf1a74` 的固定镜像，实际核对 ABC 字节、许可和 450/900 帧批准后，通过事实、四张素材理解及方向调用，首次方向 studio 在计算消费前以 `TASK_INVALID` 停止。学习路径原图 **2340×5064**，超过 render_task 的 4096 边长上限；未到 C、音乐合成或最终片，不能把准入通过记作完整音乐路径通过。

[实际回执](duolingo-score-attempt/report.json)：6 次新模型已结 **5,211**，两次计算预留均已停止/结算（合计 **393 usd_micros** 保守上界），无本轮未知、无容量、临时密钥已删。共享新增模型已结 **549,340**、三笔未知 **37,993**，合计占用 **587,333 usd_micros**。

已在断网的独立 Chrome 155.0.8059.85 中将全图缩为 **1893×4096**，没有裁剪；新图已查看并[入私有库](duolingo-score-attempt/selected-materials-ingestion.json)，原图及其 R2 引用保留。该次收据只覆盖旧目录的八项素材。负责人恢复 S1 并批准复用、重新登记私有 staging 的九项素材后，操作 `materials-20261026-full-bounded` 已将派生图接回[完整清单](../../../research/evals/materials.json)，IELTS 原创 PNG／SVG 与 HF 许可通知原引用保留，全部九项复用字节，未调用模型或渲染。私有完整清单为 `evals/materials-20261026-full-bounded/manifest.json`，入库操作已关闭、无未结费用、临时密钥已删。输入准备与服务端初始预检现会提前拒绝超过 4096 边长的目录项；本地定点回放通过，不再等到付费模型之后的方向 studio 才发现。ABC／WAV 到成片和正常速度视听仍待验。


## 素材尺寸修复后：方向输出截断，已结算

[40210203134](https://github.com/ten2ten2/promobento/actions/runs/40210203134) 只部署 `49a1366242443b7920e91b980889f9068f102116` Worker（`5681b16b-c6b1-42c0-a428-d383b3d7e98b`），复用 `fbf1a74`／`sha256:68be977c8ad9dc1c7abc2d27a701faddf3d88ed389cd8dfe64c01a6a4c4fa076` 渲染器，未重建镜像。健康、空容量及共享预算读取通过。

操作 `eval-duolingo-15-1792944531703` 使用完整九项清单中的四张 Duolingo 图和已批准 ABC。原事实、三张未变图片理解复用；派生路径图的新理解通过，方向因 `MODEL_OUTPUT_TRUNCATED` 停止，没有方向图／C／音乐成片。原始模型回执保持私有，仅公开数值指标。[方向调用指标](duolingo-score-resumed/metrics.json)计 8,192 输出 token，实际文本为 4,665 bytes，停在第三张精简卡的 skeleton；未返回完整 JSON，不修补或接纳其内容。内部候选仅把 B 的请求输出空间改为 16,384，保留 high 和原阶段调用／金额／质量门槛，后续使用新请求身份。

[费用与回收指标](duolingo-score-resumed/metrics.json)：两个模型调用共 **3,988**、健康预检 **445 usd_micros** 分配资源上界，均已结算；容量为空，临时密钥已删，无本轮未知。共享新增模型已结 **553,328**、原三笔未知 **37,993**，合计占用 **591,321 usd_micros**。完整通过数仍为 1/12、2/24，正常速度视听 pending。


## 完整三方向和 C 规格通过，review 内部错误阻断

[40210816481](https://github.com/ten2ten2/promobento/actions/runs/40210816481) 只部署 `20feee6b0adbde236836eea76a448c8f397f1134` Worker，继续复用原 `fbf1a74` 镜像。操作 `eval-duolingo-15-1792945006894` 取得完整方向响应及三张实际 PNG，方向就绪 **101.180 秒**；三图均已查看并选择真实练习最清楚的 Fit。C 返回未静音、指定原谱的完整规格，通过原准入。

随后六段横屏低清 review 中出现 `RENDER_INTERNAL_ERROR`，现有容器回执 `diagnostic:null`；音频另报容量错误，未取得音乐母带或 review 成片。没有到 E／最终片／F。[数值与停止回执](duolingo-score-render/metrics.json)保留：两次新模型 **10,821**，11 次计算均停止／结算 **9,764 usd_micros** 分配资源上界，容量为空、临时密钥回收，无本轮未知。共享新增模型已结 **564,149**、原三笔未知 **37,993**，占用 **602,142 usd_micros**。原始模型响应、规格和媒体均保持私有。

负责人批准 Actions 新建安全诊断镜像，只复验已付费的同一规格，不再调用模型。普通失败回执只记录可信阶段、帧号、白名单错误类型／系统码和媒体进程特征，不输出任意错误文本、URL、请求头、凭据或源素材内容；有界私有消息的范围见下文。原操作不重启，不把未知内部错误加入自动重试。


[40212843174](https://github.com/ten2ten2/promobento/actions/runs/40212843174) 在 `66e64b8e2ff92d07b84d06c426b60d5d4f46a104` 构建并部署诊断镜像 `sha256:d44258ae3a6cb7ff539a16dd4debda1d06a0a1f0ee0e2d8afdafdbff83223e19`。原付费规格的[零模型复验](duolingo-score-render/diagnostic-metrics.json)仍失败：两段的首个可见内部错误在 `runtime_ready`，即 Playwright 页内就绪等待；另有容量／连接失败。七次计算全部停止／结算，分配资源上界 **12,277 usd_micros**，密钥回收、容量为空，共享模型占用未变。

同一 Playwright 1.62.1、严格 CSP 和时钟 shim 的本机无素材合成空页检查通过（Chrome 155.0.8059.85），没有复现该失败。新候选改为可信宿主直接读取同一 ready／boot-failure 标志，保留原初始化绝对期限、取消和首因；不使用页内 RAF／eval 轮询，也不放宽沙箱。具体底层错误另只记录关闭、上下文、CSP 或禁止 API 的固定特征。宿主等待与诊断安全定点检查通过。随后 [40214002553](https://github.com/ten2ten2/promobento/actions/runs/40214002553) 构建 `1c4cfb8` 镜像 `sha256:ce3c93eae63de0392d8cee177c8b1bf175f3d756f6e3c9de1859f699dc3b0695`，同一规格的[再次零模型复验](duolingo-score-render/host-readiness-metrics.json)仍在 runtime_ready 失败；该改动没有解除阻断。全部计算已停止／结算，密钥回收、无容量遗留，模型占用未变。

随后修正浏览器素材服务把实际读取错误吞成 HTTP 500 的诊断缺口：保留原始可信错误对象，优先于随后派生的页面解码失败返回，并仅输出原白名单元数据；同时辨认图像解码、内存分配和脚本异常的固定特征。静态核对原冻结输入的图片键、字节长度、尺寸、音源和字体引用一致，未改写 FilmSpec 或放宽期限。

[40215346538](https://github.com/ten2ten2/promobento/actions/runs/40215346538) 的 `b46dff7` 镜像 `sha256:04f67ed9930cccd5e0577a2e845b5aae9c2100fb93605cae8ed2549b345b0b44` 复验仍失败；[回执](duolingo-score-render/resource-cause-metrics.json)同时保留 runtime_ready 内部错误和实际端口启动超时，零模型、全部停止／结算、密钥回收。最小 VM 回放随后证实 `instanceof Error` 会丢失另一 realm 的错误消息和类型，已改为保留结构化 Error；[40216396651](https://github.com/ten2ten2/promobento/actions/runs/40216396651) 的 `d7d1038` 镜像仍在同一阶段失败，[实际指标](duolingo-score-render/foreign-cause-metrics.json)保留七次计算停止／结算及 **19,270 usd_micros** 分配资源上界，零模型、容量为空、密钥回收。

同一付费 FilmSpec、冻结选项、两张实际输入图和固定字体，在本机缓存的 Actions 原镜像 `68be977…`、断网及完整 Chromium 沙箱下初始化并取得第 45 帧。[40218003686](https://github.com/ten2ten2/promobento/actions/runs/40218003686) 随后在 `d4bc18b` 部署有界私有消息捕获及节拍接力代码；操作 `eval-duolingo-15-1792950689524` 的私有回执明确为 Chromium 页面崩溃。原消息保留在私有 attempt R2，不进入公开仓库或 Actions 产物。

本机仅改变共享内存配额取得了反例与修复：512 MiB 成功、64 MiB 同样页面崩溃，64 MiB 加 `--disable-dev-shm-usage` 后再次成功，完整 uid／namespace／seccomp 沙箱仍通过。新选项让 Chromium 改用容器私有 `/tmp`，不改变字体、画质、分镜、超时或模型；云端实际 `/dev/shm` 容量尚未读到。

该轮无新模型调用。原生清单先确认七项均 `inactive`，终态恢复 API 两次超时，三项计算保留预留，没有手工清零。[40219486055](https://github.com/ten2ten2/promobento/actions/runs/40219486055) 部署 `d5714be` 后，既有恢复入口已补齐全部停止／结算：[最终回执指标](duolingo-score-render/private-cause-metrics.json)为 **74,704 usd_micros** 保守分配资源上界、无本轮未知、空容量、密钥回收。停止先固定旧任务不可复活，再只销毁实际 running 的实例；运行中销毁失败仍不得归还名额。

### 页面崩溃解除，ABC 母带成功，整片仍超时

在同一 `d5714be`／镜像 `sha256:e219c1821c01e957f4b0f83b5c551a90a58c7ce37cead93d2de3bb9d30cea97f` 下，操作 `eval-duolingo-15-1792951862017` 的[六个实际分段与原谱母带均成功](duolingo-score-render/shm-fixed-metrics.json)，没有再发生页面崩溃。ABC 的 15 秒混音为 **720,000 样本帧、−13.99 LUFS、−2.73 dBTP**，通过原音频数值门槛。最后的组装在原 **90 秒** 总限内未完成，结果仍为 `RENDER_DEADLINE`，未交付合格整片。各分段冷启动实际为 37.250–42.718 秒；保留原期限，不用延长时限掩盖启动成本。

该轮零模型，八次计算全部停止／结算，共 **22,723 usd_micros** 保守分配资源上界；无本轮未知，容量为空、密钥回收。已成功分段与母带保持私有，用于视听诊断和下一步时延分析，不重跑这些成功子项。

用同一未改动的装配器在本机复用这七份真实云端产物，生成私有 `artifacts/s1-duolingo-15-score-preview-2026-10-26/index.html`：15 秒、960×540／15 fps review、AAC、1,347,292 bytes；没有重编码或重新合成音乐。已查看实际封面与播放画面，Chrome 155.0.8059.85 完整 1× 解码 225 帧、零掉帧／错误；自动播放检查静音，不代替听感判断。这个诊断预览没有修复云端时限失败，不计完整导演、最终片或负责人质量通过；MiniMax 新版见下节。

## 负责人否定旧版 MiniMax 15 秒的质量

[正常速度质量决定](minimax-15/owner-review.json)为 **不愿意发布**：品牌 Logo、可感知且踩点的配乐和有趣记忆点不足，整体无聊。旧规格使用 88 BPM 的 ambient；重新分析两部原 MP4 的实际 AAC，均为 **−14.04 LUFS、−1.25 dBTP**。负责人质量仍不通过，下一版改用鼓点明确的配乐和可见击打，不靠继续加大音量。保留原技术交付与模型冷审记录。

改片围绕 “One brief. A whole crew.” 做单个品牌标记在 Coding／Work／Media 之间踩点接力，再回到真实产品与原 CTA；不批量复制功能卡片顺排。负责人已于 2026-10-26 明确批准官方 Logo 新增至私有 staging，用于内部改片；现已按[单项证据及完整十项清单](../../../research/evals/README.md#用私有素材清单准备评测)入库，原九项只复用字节、不删除或替换原图。新接力参数已用原创工程标记在缓存的 Actions 镜像中检查：四画幅 56 次逆序／冷 seek 比较零差异、落点与布局通过，已查看实际图；真实改片结果见下文，负责人质量仍待判断。13 种样曲的保留决定不变，也不等于其在这部片中的使用有效。

新操作 `eval-minimax-15-1792974389174` 已取得三张紧凑方向数据，但首张实际预览 `TEXT_FIT_FAILED`，未到 C。冻结 hero 暴露的是可信生成器缺陷：因骨架先出现 feature-grid，它把三段完整事实原文放进三列小字块；按方向序号轮换素材还会将新增 Logo 当成产品主图。[本轮数值及回收](minimax-brand-relay/preview-attempt-metrics.json)：三次新模型 **2,863**、两次计算 **1,416 usd_micros** 保守资源上界，全部停止／结算、容量为空、密钥回收、无新未知。

`trusted_direction_hero_v2` 改为优先骨架中的产品镜头，统一使用第一张清权主图，带图标题使用产品名而非完整事实段落；原事实、字号、完整 keyframeFilm 和 C 的故事不改写。复用原付费 B 的本机三张 45 帧均通过完整沙箱且已查看。[40250589327](https://github.com/ten2ten2/promobento/actions/runs/40250589327) 随后只部署 `965cfa3` Worker，复用原镜像；新操作 `eval-minimax-15-1792975629625` 的 A/B 命中缓存，三张真实云端 PNG 均已查看并选择 Fit，优先保留大幅真实界面与前置 Logo 接力。

该操作的 C/E 通过，横竖两部 MP4 均渲出，分别 **65,818 / 65,346 ms**；15 秒、450 帧、1080p/30 fps/AAC，无整片重编码，十处接缝全零差异。已看真实 Logo 在三个角色间的落点、产品画面和 CTA；两部完整 1× 静音解码均 450 帧、零错误／掉帧。实际 AAC 为 **−13.8 LUFS、−1.5 dBFS 真峰值**，频谱通量测得 **100.2 BPM**（可靠度 0.749）；3.0／3.6／4.2 秒三个可见落点与最近拍点相差 **10／5／17 ms**。这给出实际音频和同步证据，负责人听感与发布意愿仍待判断。

最终 F 的 JSON-mode 在 **8,192** 输出 token 时截断，私有文本为 **35,491 bytes** 分析，没有 verdict，不能提取猜测结论或记完整通过。[本轮数值及回收](minimax-brand-relay/film-attempt-metrics.json)：三次新模型 **21,572**、28 次计算 **37,144 usd_micros** 保守资源上界，全部停止／结算、空容量、密钥回收，无本轮未知。

[40252639209](https://github.com/ten2ten2/promobento/actions/runs/40252639209) 只部署 `c7154d4`，F 改用一个 `submit_cold_review` 原生工具传回原冷审 JSON、输出空间为 16k。操作 `eval-minimax-15-1792977034683` 的 A/B/C 复用；E 两次修稿后提交，横竖 MP4 均渲出，F 在 **17,532 ms / 1,738 token** 返回合法 **BLOCK**，没有再截断。[数值及回收](minimax-brand-relay/cold-tool-attempt-metrics.json)：四次新模型 **6,332**、44 次计算 **47,803 usd_micros** 保守资源上界，全部停止／结算、空容量、密钥回收，无本轮未知；不增加完整通过数。

实际竖屏空白桌面缩成窄条、功能副标题循环复述标题的问题成立，不把有 Logo／有声轨当质量通过。F 关于「没有接力」的判断只依据 132／157 两张相同停留图，未见已在实际 MP4 90／108／126 帧核对过的移动落点；现为 E/F 单独补入落点和中途姿势，不缩小或减少原各画幅阅读图、不把运动期当文字停留 QA。三项定点检查及 cloud 类型通过，新捕获路径待新镜像实跑。

负责人随后批准官方 pocket-pet 演示画面及对应案例事实。固定官方提交 `da22f11c55d4748155d7162c1030414228a00565` 的原片、许可说明和三张裁帧已查看；[完整十三项清单](../../../research/evals/README.md#用私有素材清单准备评测)已入私有 staging。新方向改讲计时→暂停→庆祝的具体案例，保留 CLI／维护者完成视觉设计的署名，不把演示时长或现成 starter 说成生成速度／从零生成；原泛角色版本不再重复生成。

### Pocket-pet 规格和分段成功，原 review 总限阻断组装

[40255753593](https://github.com/ten2ten2/promobento/actions/runs/40255753593) 构建并部署 `b19435f`／镜像 `sha256:005d7c646d505c241d7a393477143a42272f8adccd95a94a4690eb2afba57d54`。操作 `eval-minimax-15-1792979531490` 的三张实际方向图均已查看，选择宠物占幅最大的 Fit；C 完成，六个低清画面分段与程序配乐均成功。母带为 **720,000 样本帧、−14.03 LUFS、−1.35 dBTP**。分段实际控制器 ready 为 **13.898–31.482 秒**，最后一段停止后还需校验及组装，原 **90 秒**总限耗尽；未到 E、最终片或 F，不增加通过数。

[本轮数值与回收](minimax-pocket/attempt-metrics.json)：七次新模型 **21,041**、11 次计算 **19,609 usd_micros** 保守资源上界，全部停止／结算、容量为空、临时密钥回收，无本轮未知。私有完整回执和分段保留在 `artifacts/s1-minimax-15-pocket-2026-10-26` 及原 R2 引用。

负责人随后批准[内部 review 止损上限调整为 180 秒](../../plans/cloud-motion-v3.md#53-期限)。这次失败仍按原期限保留，续跑使用同一镜像、素材、seed 和已付费规格；性能目标、预算、取消和质量检查不变。

### 180 秒配置已部署，三轮审片完成，改稿未收敛

[40258179685](https://github.com/ten2ten2/promobento/actions/runs/40258179685) 部署 `7151ff2` Worker，复用 `b19435f` 镜像。操作 `eval-minimax-15-1792980997507` 的 A/B/C 均复用已付费回执，三张实际方向图再次查看后选择 Fit；随后三部 **15 秒、960×540／15 fps、AAC** 的完整低清审片全部交付，没有重编码。E 第一轮去掉三段字幕、第二轮又恢复，第三轮仍要求修改，并把 ROI 高亮框误当作会裁剪放大的参数；达到原两次修稿上限后以 `DIRECTOR_REPAIR_LIMIT` 停止。不继续这一轮付费改稿；未到高清最终片或 F，不增加完整通过数。

第三部实际 MP4 已查看开场、计时、暂停、庆祝及 CTA；Chrome 155.0.8059.85 完整 1× 静音解码 **225 帧、零错误／掉帧**。私有播放器在 `artifacts/s1-minimax-15-pocket-review180-2026-10-26/index.html`，从头有声播放与重播按钮已实际检查。实际 AAC 为 **−13.8 LUFS、−1.4 dBFS 真峰值**；节拍分析为 **100 BPM、可靠度 0.735**，最强检测网格与状态落点相差约 **291 ms**，尚不记为踩点通过，负责人试听待完成。

[本轮数值与回收](minimax-pocket/review180-metrics.json)：三部从云端渲染记录创建到提交分别为 **74.694／62.323／54.789 秒**，均未触及新上限；这轮结果不说明必须用满 180 秒。仅新增三次 E，模型 **5,572**；28 次计算 **34,371 usd_micros** 保守资源上界，全部停止／结算、空容量、密钥回收，无本轮未知。此前失败记录保持不变。

核对实际 FilmSpec 另发现庆祝音效显式 `gain:-6` 被接入层当作线性倍率，写成 **−60 dB**。现已[按原契约修正为 −6 dB](../../../packages/audio/src/NOTICE.md)，保留旧冻结计划和成片；包含 −30／−6／0／+6 dB 及省略值的实际 PCM 检查通过。没有扩大 E 次数或放行质量。

### 音效增益修复已云验，编码后的音频峰值仍不合格

[40260579571](https://github.com/ten2ten2/promobento/actions/runs/40260579571) 构建并部署 `6ce57ab`／镜像 `sha256:8b2c0b86b86d907e733c2cb046ae0ea99953c17359888e2ec3276dd2ad3ed954`。操作 `eval-minimax-15-1792983373084` 复用上一轮完整 E1 回执和同素材、seed，零模型复验。实际云端 AudioPlan 的庆祝音效为 **306 帧、−6 dB**；低清 MP4 成功提交，客户端从提交到观察通过为 **66.382 秒**（含轮询），15 秒、225 帧、960×540／15 fps、AAC，五处接缝零差异、没有重编码。实际片完整 1× 解码零错误／掉帧，开场、产品状态和 CTA 已查看，有声播放／重播控件通过。

WAV 母带为 **−14.32 LUFS、−0.97 dBTP**，落在当时母带实现的 0.05 dB 容差内；但实际 MP4 的 AAC 实测为 **−14.1 LUFS、−0.2 dBTP**，超过原 **−1 dBTP** 上限。当时 `media.mjs` 只检查 AAC 格式，未测编码后的响度／真峰，因此这轮云端 `passed` 只记出片，不记音频验收通过。此片保留为私有诊断预览 `artifacts/s1-minimax-15-pocket-sfx-db-2026-10-26/index.html`。负责人继续后，已按[渲染服务](../../../apps/render-container/README.md)补上编码后实测与一次纠正：复用原私有 MP4 和 WAV 的离线反例达到 **−14.06 LUFS、−2.13 dBTP**，逐字节比较确认视频码流未变，修复版位于 `artifacts/s1-aac-peak-repair-2026-10-26`；实际云验见下节。内容审片、踩点、高清横竖最终片、F 和负责人发布意愿仍未通过或未完成。

[本轮数值与回收](minimax-pocket/sfx-db-metrics.json)：零模型，八次计算全部停止／结算，共 **13,083 usd_micros** 保守资源上界；空容量、无本轮未知、临时密钥回收。共享模型占用仍为 **659,522 usd_micros**，旧未知没有清零。S1 完整通过数不变。

### 最终 AAC 纠正已通过原规格云验

[40267510307](https://github.com/ten2ten2/promobento/actions/runs/40267510307) 构建并部署 `8f77bc9`。操作 `eval-minimax-15-1792988121897` 复用同一已付费 E1 规格、素材与 seed，零模型交付 15 秒低清片；组装器先测最终 AAC，再从原 WAV 纠正一次。最终 **−14.06 LUFS／−2.13 dBTP**，通过原 ±0.5 LU／≤−1 dBTP 门槛；视频未重编码，五处接缝零差异。客户端观察通过 **87.710 秒**，不是性能分位数。

[数值回执](minimax-pocket/aac-gate-metrics.json)保留实际编码和停止结果：八次计算全部停止／结算，共 **14,847 usd_micros** 保守上界，空容量、临时密钥撤销、无新增未知。Chrome 155.0.8059.85 完整 1× 静音解码 225 帧，零掉帧／错误；听感与踩点仍待判断。私有播放器为 `artifacts/s1-minimax-15-pocket-aac-gate-2026-10-26/index.html`。本轮未调用 E/F，不增加完整导演或最终片通过数。
