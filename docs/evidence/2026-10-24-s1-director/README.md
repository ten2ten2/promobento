# S1 真实导演：有限预算已开放，首题结构化输出阻断

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
