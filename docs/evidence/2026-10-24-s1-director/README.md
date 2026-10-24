# S1 真实导演：完整链路仍未通过

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

方向阶段原先一次请求三份完整 15 秒 FilmSpec，超出方向卡本身的职责。修复后 B 只返回三张精简卡和镜头骨架，可信宿主按已确认事实、真实素材、卡片色板/纵深/积木选择构造静音 hero，再由原 studio 截图；完整影片仍只交 C。衍生 FilmSpec 与来源在持久检查点冻结，保留既有完整 keyframeFilm 响应的兼容。B 输出上限 8,192，不以提高总预算解决冗长输出。

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
