# S1 真实导演：横竖媒体已生成，审片长输出仍阻断

2026-10-24 负责人要求「放开一点预算门槛，继续 S1」。本次在原 $300 授权中取 $5 历史风险预留、staging 新增模型实际/未知预留累计上限 $10，至 2026-10-31 上海时间结束。原授权身份、起算、历史清单和确认空值保留；风险预留不等于核实账单。配置与语义见 [14 预算契约](../../prd/14-production-contracts.md#6-ai操作费用与成功次数)。

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

[完整费用与回收回执](fifth-attempt/report.json)：本次模型 **10,329**、8 次计算保守上界合计 **5,243**，总计 **15,572 usd_micros**。计算全部物理停止并结算，容量为空、原生 Workflow 已 errored/对账、临时密钥已删除。共享模型实收 **57,475** 加旧截断预留 **6,196**，占用 **63,671 usd_micros**；历史确认仍为空。

旧回退沿用正常分段的两秒 VBV reservoir，不能保证滑动一秒峰值。后续只收紧纠正编码的 maxrate/buffer，并把纠正前后实测峰值写入结果；一秒码率门槛、正常分段、尺寸、fps、音频与其他 QA 不变。该修改涉及容器真实源码，必须由 Actions 构建并使用新 release，旧 G1 证据仍绑定原候选，不能以旧镜像复用绕过更新。

## 第六次：码率修复、E 与横竖渲染通过，F 在原 1,024 token 输出上限截断

[40092112348](https://github.com/ten2ten2/promobento/actions/runs/40092112348) 在 `dda33944656156b2edd37eac8899d013e8464d8c` 由 Actions 实际构建并推送新镜像 `sha256:6e58bae5dc9a2117652cf8829721546d9b2cd51d5c723c34dfaff2deb1606986`，Worker `5d5992a0-7ed6-42d9-8330-3cee62c64c1e`。只部署/读健康，未重跑原 G1/隔离/配乐矩阵，自动全套 push `40092105527` 已取消。新输入固定 `renderer-dda339446561`，旧 release 不改绑。

操作 `eval-deepseek-15-1792843644103`，输出 `artifacts/s1-deepseek-15-vbv-2026-10-24`。新方向图已逐张查看并[选择 Fit](sixth-attempt/choice.json)；A/素材复用，B 和新 release 对应的 C 按新请求计费。规格一次纠正通过，真实 review 及 E 的 `submit_candidate` 已通过，横/竖两部 **15 秒、450 帧、1080p/30 fps/AAC** 已实际生成并提交。review 的滑动一秒峰值由 3,785,344 降至 **1,577,016** bit/s，横版由 14,578,464 降至 **6,238,848**，竖版由 11,731,512 降至 **5,583,520**；分别低于原 2.5M / 10M 门槛，未调宽标准。媒体报告见[实际回执](sixth-attempt/media-diagnosis.json)。

冷审确实读取两画幅，但[原始响应](sixth-attempt/cold-review-response.json)在 **1,024 completion token** 时以 `length` 结束，只输出分析散文，没有完整 verdict JSON。新适配器已保存 partial/usage 并结算 **673 usd_micros**，没有把失败记作未知、JSON 通过或冷审通过。操作正确失败，没有交付合格候选；私有 MP4 只取回作内部诊断。实际封面显示 API 镜头的卡片大而空，仍需冷审和创意修复，不因编码通过认定质量合格。

[完整费用/回收](sixth-attempt/report.json)：5 次模型 **28,117**，18 次计算均已停止/结算 **21,012** 保守上界，总计 **49,129 usd_micros**；容量/本轮未知为空，Workflow 已对账、临时内部密钥已删除。共享模型实收 **85,592** 加旧未知 **6,196**，共占用 **91,788 usd_micros**。

下一候选把 F 的输出空间改为 8,192，并在用户消息中明确同一 JSON Schema/禁止分析散文；仍是原 2 次调用、$0.05 阶段预算、全画幅和独立模型检查。截断不自动重试，也不缓存或捏造原 verdict；此 Worker-only 修正复用本节已验证的新镜像。

## 第七次：E 修改元数据后再次长输出，尚未执行修正后的 F

`be5b3bf1a0e7738a7f6ae76468ff89126f363892` 经 [40093788760](https://github.com/ten2ten2/promobento/actions/runs/40093788760) 仅部署 Worker（自动全套 push `40093781592` 已取消），同一新镜像不变。操作 `eval-deepseek-15-1792844833456`，输出 `artifacts/s1-deepseek-15-cold-2026-10-24`。冻结方向未变，沿用前轮已查看的 Fit 选择；规格纠正通过，review 渲染成功。

[E 首次回执](seventh-attempt/review-0-response.json)调用 `write_spec`，仅把 web-claim 的 maxLines 从 2 改为 4，未改善已看到的空卡片。该修复后的 [E 再审](seventh-attempt/review-1-response.json)耗时 **96,637 ms**、完成用量 **8,192 token**，仍在分析和反复考虑修改，未完成工具调用即截断。没有把散文提取为工具或将放宽元数据认作视觉修复；未到 F，不能据此认定增大后的 F 仍截断。

[完整回执](seventh-attempt/report.json)记录三次模型 **15,035**、12 次计算保守上界 **11,491**，共 **26,526 usd_micros**，均已结算、物理停止、容量清空、Workflow 对账和密钥回收。共享模型实收 **100,627** 加旧未知 **6,196**，共占用 **106,823**。第六轮实际横竖 MP4 已另在 Chrome 155.0.8059.85 解码、逐帧查看并默认 1× 播放到结束，无媒体错误；[播放器记录](sixth-attempt/actual-playback.json)不等于负责人视听或冷审通过。

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

[首份 E](tenth-attempt/review-0-response.json)确实尝试填充空卡片，但发明 `bodySlot`（真实参数为 `subtitleSlot`）并使用未支持的文本 role，完整 FilmSpec 被拒。E 原消息只有 FilmSpec Schema，未像 B/C 提供积木自己的参数 Schema。[一次结构纠正](tenth-attempt/review-0-output-repair-1-response.json)改用实际产品图，却在只允许 `{film}` 的 `write_spec` 参数外又加 `note`，因此 `DIRECTOR_TOOL_INVALID`，未执行该修复、未到 F。不能删除 note 或映射猜测字段后冒充原工具通过。

[完整回执](tenth-attempt/report.json)：两次模型 **3,832**，8 次计算停止/结算 **4,887** 保守上界，共 **8,719 usd_micros**，无本轮未知/遗留容量，Workflow 已对账、密钥已回收。共享模型实际 **110,267** 加旧未知 **20,225**，共占用 **130,492**。

修正直接向 E 提供同一真实 `blockCatalog` 参数契约，写明两个工具各自唯一的包络，并把工具自身的精确 Schema 错误路径反馈给结构纠正；原完整校验、一次纠正和费用/次数门槛不变。只改提示/错误定位，不新增测试矩阵或改渲染器。

## 第十一次：契约修正通过，DeepSeek 仍耗尽两轮视觉修复

`92824a46909985e7b22b580920ebd5f27b7477bf` 经 [40097605133](https://github.com/ten2ten2/promobento/actions/runs/40097605133) 仅部署 Worker，同一镜像不变；自动全套 push `40097596386` 已取消。操作 `eval-deepseek-15-1792848186867`，输出 `artifacts/s1-deepseek-15-block-review-2026-10-24`。三次 E 都给出完整、合法的 `write_spec`；前两次修改已实际重新渲染。模型将空 API 卡片换成设备实图后继续调整，第三次仍要求修改，按原 **2 次内部视觉修复**落 `DIRECTOR_REPAIR_LIMIT`，未执行第三次改动、未到 F。保留该质量负例，不提高修复次数或假定质量通过，先推进其他题目。

[完整回执](eleventh-attempt/report.json)及[三份工具响应](eleventh-attempt/review-2-response.json)：模型 **5,616**，36 次计算（含新增 3D 镜头）均已物理停止/结算 **27,822** 保守上界，总计 **33,438 usd_micros**。无本轮未知/残留容量，Workflow 已对账、临时密钥已回收。共享模型实际 **115,883** 加旧未知 **20,225**，占用 **136,108**。模型/工具的完整契约已经可用，但不能据此把创作质量负例改成合格候选。

## MiniMax 首次：事实回复是散文，纠正上下文缺实际输出契约

执行前复核 [MiniMax 官网](https://www.minimax.io/)及[产品页](https://agent.minimax.io/about)，MiniMax Code 命名与已确认的三条功能声明仍可核对，未引入页面上的价格、速度/效果或其他新事实。操作 `eval-minimax-15-1792848706708`，输出 `artifacts/s1-minimax-15-2026-10-24`，使用同一部署。

[A 首份回答](minimax-first-attempt/facts-response.json)为 403 token 的散文/表格，不是 `fact_analysis`；[纠正](minimax-first-attempt/facts-output-repair-1-response.json)尝试输出事实数组，又在 **1,024 token** 截断。原 A 用户消息只带事实和 brief，Schema 只在 system，纠正消息也没重给实际契约；当前提示不足以稳定约束该线路。不能由此断言网关丢弃 system。尚未调用素材/B/C 或渲染。

[完整回执](minimax-first-attempt/report.json)：两次模型 **136 + 318 = 454 usd_micros**，0 新计算，无本轮未知/容量，Workflow 已对账、密钥已回收。共享模型实际 **116,337** 加未知 **20,225**，占用 **136,562**。

修正把事实响应 Schema 放到原用户消息，结构纠正同时携带相应 Schema/工具契约并区分 JSON 与实际工具回复；A 的事实/素材输出空间改为 4,096，次数/金额不提高。另将 C 的“事实证据逐字当标题”收紧为忠实压缩未定稿文案，明确保留任何用户定稿、名称/URL/CTA、限定条件、归属与事实绑定；不改原事实卡或确认。这是对真实画面中长句标题/空卡片的创作修正，不改变事实和独立冷审标准。
