# S1 内部云端链路

只在 **staging** 启用。`/healthz` 以外的路由均要求 `S1_ENABLED=internal_eval` 和独立 `EVAL_API_KEY`；生产配置为 `off`。这是持有评测密钥的负责人使用的内部控制面，不能作为客户 API 接入，尚无 Google/邮箱登录或成员权限系统。

内部入口位于 `/internal/s1/`：`operations`、不可变 `objects/evals/…`、许可 `rights`、镜像 `releases`、`renders`、`studio`、`creative`；`artifacts/<key>` 只读取当前许可仍有效的已发布输出或已登记方向帧；操作可通过 `operations/<id>/events` 收取进度、`operations/<id>/frames/<frame>` 取许可帧、`operations/<id>/cancel` 取消。请求原文经共享解析器；渲染私有传输经预编译完整 Schema。实际权利记录必须在处理前入 D1，并引用私有 R2 中的来源/许可证据；不能拿素材 JSON 自报清权代替这一步。

`RenderWorkflow` 执行分段、声音、接缝/阅读停留观测、拼接和 generation-fenced 提交；`ShardDO` 每次 attempt 使用独立容器，禁网，仅挂该任务的 broker；`CoordinatorDO` 在确认停止前持有并发 lease；`OperationDO` 管 studio 与进度。取消先推进 generation、撤销后续读写，再经 outbox 停止实例。任务、回执、冻结输出引用、费用预留与结算保留；重试不得覆盖已提交字节。

计算费用目前按 **分配的完整 CPU + 内存 + 磁盘 × 实际运行时间**记保守上界，不是 Cloudflare 账单实测值。CPU/内存/磁盘单价来源：[Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-23；实例规格见[官方表](https://developers.cloudflare.com/containers/platform/limits/)。未知模型 usage 保留预留，不记作零。生产预算未标定，Agent 仍关闭。

满载时 ShardDO 在原始期限内等待物理 lease，不启动容器、不预留容器费用；每次重查 generation 与持久停止标记，取得名额后再核对许可和预算。这样 24 个 WebGL 分段与声音可共用工作区的 24 个名额，不因瞬时满额直接失败，也不增加并发上限或重置期限。Coordinator alarm 设置失败仍先确认实例停止再归还 lease。该路径随 `1af113f` 部署；`fe3df1e` 修复观测覆盖检查后，30 秒 WebGL 出片/交付和全部计算停止/结算均已通过。正式满载性能分布/主动取消 G1 仍未完成。

## 研究模型共用一份预算

`MODEL_LEDGER` 绑定独立的共享 D1 `promobento-model-ledger`，staging/production 使用同一数据库；各自的操作、素材、计算账本仍在原环境的 `DB`，不混用客户数据。资源由 Actions 创建，迁移目录为 `model-ledger-migrations`。授权身份只取批准人与批准时间，不随价格目录、步骤换绑、新操作或部署而重置。

内部 `GET model-budget` 返回历史确认状态、目录估算、未知条目、当前已结/预留费用；`POST model-budget/import` 只接受 [`model-spend` 契约](../../contracts/model-spend.schema.json) 的不可变历史清单。部署场景导入四轮探针的 128 次请求清单：可计价的 114 次合计估算 255,521 usd_micros，另 14 次未知。负责人暂时没有供应商统计，`openingMicros:null`、`openingConfirmed:false`；未对账时拒绝新增付费调用，不阻断不使用模型的媒体工作。

负责人获得完整历史统计后，先用 `objects/evals/…` 上传 `kind:"model_spend_confirmation"` 的证据，再 `POST model-budget/confirm` 提交 `{evidenceKey}`。证据必须匹配当前授权与清单摘要，包含负责人确认的**本次授权以来全部历史** `totalUsdMicros`、实际来源及依据；不只填 114 次的目录估算。确认只能幂等重放，不能覆盖已有金额。密钥、登录信息不进入证据。

每次模型调用先在共享 D1 原子预留：历史确认总额 + 所有环境的实际/未结预留 + 本次预留 ≤ 授权上限；然后再通过本地操作/阶段/次数门槛。仅能证明尚未发出请求的本地准入失败可释放为零；请求已派发但 usage 未知时保留预留。调用结果先把原始响应、usage 与当时价格/汇率不可变写入私有 R2，再解析和结算。结算写入中断可用同一个 callId 补账，不重发请求、不按新目录重算；缺响应时要求对账，不自动重试付费调用。

原独立 `model-probe.yml` 已停用并移除；[历史脚本](../../research/model-probe/archive/probe-2026-10-23.mjs)只保留作来源。后续真实探针也必须纳入共享账本，不能从归档脚本绕过预算。官方 C/F 仍保留 `verified:false`，不因账本实现而视为已接通。

## 部署

由 [Deploy S1 staging](../../.github/workflows/cloud-deploy.yml) 在 Actions 安装冻结依赖、预编译验证器、应用 staging DB 与共享 MODEL_LEDGER 两套迁移，再由 Wrangler 构建/推送镜像并部署。开发分支尚未在默认分支登记新工作流时，从既有入口 `gh workflow run checks.yml --ref <branch> -f suite=staging` 调用同一部署工作流，其他检查 job 均跳过。Mac 不构建镜像。随后只运行一次 15 秒原创工程片，覆盖真实 broker、任务 Schema、字体、分段、声音、观测、接缝、拼接、私有输出与 lease 归还；不会重跑九积木帧图、13 风格或模型评测，也不代替完整 G1。

Actions 为本轮生成并遮蔽 `EVAL_API_KEY`，只经 stdin 绑定到 staging Worker；结束前取消该轮操作、确认 lease 归还并删除密钥。内部入口随即恢复 404，`/healthz` 仍可用。失败报告与已生成媒体在 `s1-staging-deployment` 产物；不删除 D1/R2 的任务、权利和费用证据。需要人工恢复时从此工作流重新部署已核对的分支；不要删除数据库或回滚 Durable Object 迁移。手动使用内部入口时另行绑定密钥，不向聊天或日志粘贴值。官方 Anthropic 的密钥暂不添加，相关真实集成保留未验证。部署、G1、导演和首次六题评测的实际完成范围见[实施状态](../../docs/implementation-status.md)。

studio 的 45→375→45 与关闭已在 [39987356301](../../docs/evidence/2026-10-24-s1-staging/README.md)通过，普通出片检查复用该证据，不重复取三帧。每个分段仍读取实际健康回执；负责人允许 cgroup 峰值接口均缺失时以 `null` 加明确原因继续本次内部出片，整片 `peakMemory.status` 保留 `unverified`，G1 此指标不算通过。无效读数、权限错误、媒体、沙箱和预算门槛不变。

新增 WebGL 时选 `-f staging_scenario=webgl-studio`，只覆盖新设备积木的四画幅 0/12/45/375 帧、逆序与独立实例冷 seek、真实 SwiftShader 字符串及停止/lease 归还；不重跑 2D 工程片、配乐或模型。产物为 `webgl-*.png` 和 `webgl-report.json`。这不是完整 G1；30 秒分段成片另见 `webgl-film` 证据，性能分布和 standard-3/4 对比仍未完成。一般工程片仍使用默认 `engineering` 场景。

验证新排队/声音集成时选 `-f staging_scenario=webgl-film`：一部 30 秒、24 个 standard-4 分段的原创 3D 校准片，共享工作区 24 个名额，另有程序配乐和四种 lead-in。沿用内部操作 1,000,000 usd_micros 预算，实际费用另从不可变结算收集，不当作预算全额消耗。该场景保存声音/分段计划、实际成片、接缝、只读费用清单与私有下载；不重复先前的四画幅 studio 比较或 13 风格样曲。单次计时不作为 p50/p95 或完整 G1。

仅修复检查脚本、仍需验证原部署时，可在上述手动入口加 `-f staging_sha=<实际已部署完整SHA>`：跳过迁移、构建和部署，只修复并运行 harness。报告分别记录部署 SHA 和 harness SHA，不把新分支当成已部署。内部密钥写入后先等待只读鉴权就绪（最多 60 秒）；相邻请求仍可能看到旧密钥，此时仅对调度前的确切 `404 Not found` 有界等待，并记录次数。模型/渲染失败和不确定超时不自动重试。

只改 Worker 时，可改用 `-f staging_renderer_sha=<已部署镜像源码完整SHA> -f staging_renderer_digest=sha256:<实际registry摘要>`：确认镜像源码为当前祖先，且容器、共享包、契约、配置、依赖与构建输入均未变化后，只部署 Worker，复用原镜像，不构建推送。`renderer-reuse.json` 分别保留镜像来源和摘要，部署 SHA 仍是新 Worker 的提交。镜像摘要必须来自原部署回执，不能填写本地 image ID。

先诊断再修复：同一入口另加 `-f staging_inspect_run=<原 Actions run ID>`，只查询该次操作的 Workflow 步骤/错误及 D1 状态、attempt 和费用结算，保存 `inspection.json`；不部署、不绑定内部密钥、不新建渲染，不读取任何凭据值。出片失败时，部署工作流也自动保留这份只读诊断，不为收集错误重复渲染。

只修复已失败/取消的指定操作，可加 `-f staging_reconcile_operation=<operation ID>`。新版本通过 `operations/<id>/reconcile` 再次确认实例停止，补齐旧 attempt 的停止记录及遗留的渲染非终态；返回未结费用清单。不重启计算、不改 generation、不清零未知模型费用、不覆盖 passed 成片或原始失败原因。活动操作拒绝此入口。

## 不消费云资源的导演回放

`mise run test:cloud-local` 在本机预编译当前 Schema 后，用真实 `OperationWorkflow`、两种 SSE 适配器、SQLite 预算 SQL 和内存 R2 回放 A–C/E/F。覆盖三方向取帧请求、12 小时用户等待排除、review 修复、冷审拒绝、取消栅栏、缺许可/密钥/模型验证的提前阻断，以及未知消费保留预留。`fetch` 完全替换为固定 SSE，容器/成片为明确模拟，不访问外网、不读真实密钥、不构建 Mac 镜像；这些结果不代替媒体质量或 G1。官方模型仅在这个独立 mock bundle 中视为可回放，部署配置的 `verified=false` 不变。

## 导演使用已批准的音乐

图片仍放 `context.resources`；可选的 `context.audioSources` 单独列出最多四个音乐源，不送入看图模型。每项提供 `kind: "score" | "upload"`、`resourceId`、`sha256`、私有 `evals/…` 的 `key`、`byteLength`；ABC 另有 FilmSpec 使用的 `scoreRef`（例如 `audio/original.abc`）。不接受目录中自报的 `rightsCleared` 或许可证；可信宿主从 D1 权利行和私有 R2 证据读取许可。完整结构见 [`audio-admission.schema.json`](../../contracts/audio-admission.schema.json)。

先按既有内部入口上传不可变素材与证据，再登记 `rights`。音源证据须含 `kind: "audio_source_rights"`、当前 `operationId`、匹配的 `resourceId`/`sha256`/`licenseRef`、`scope: "internal_eval_only"`、`approvedBy: "owner"`、实际 `source` 和 `basis`。ABC 还须由负责人独立批准 `scoreApprovals: [{totalFrames, requestHash}]`：`requestHash = digest({text, totalFrames})`，其中 text 为源文件严格 UTF-8 解码文本，totalFrames 为 450 或 900。15 秒的批准不能用于 30 秒；不能从模型返回的 FilmSpec 推导批准。

预检先核对许可，再读源文件；ABC 上限 16 KiB、上传音乐上限 8 MiB。FilmSpec 只选择已批准的 `scoreRef` 或 `resourceId`，宿主确定性生成 AudioPlan、`audio:music` 字节输入及独立清权记录；容器再核对实际摘要、谱文本与批准时长，然后解析/合成。上传仅支持现有有界 WAV 解码器的 mono/stereo PCM16/24、44.1/48 kHz、最长 30 秒子集，源必须覆盖整段，不自动循环或补静音。音轨素材也进入 job 的权利清单，后续渲染和私有下载重新检查撤销状态。旁白仍需转写/字幕准入，不能作为本音乐入口上传；方向卡保持静音。

新增准入/真实 PCM 合成、失败恢复及导演传输回放已做定点本地检查；外部音乐路径随 `1af113f` 部署，但尚未实际运行真实导演请求，未调用真实模型或替代负责人试听。

导演准备输入也纳入失败处理。失败先原子写入终态与首个错误的 `operation_failure` outbox，再确认停止、修复非终态渲染；未知消费保持预留。清理专用检查点和队列可重试清理，不重复模型/媒体调用。最终候选与 `operation_progress` outbox 原子提交，通知故障不回滚成功。中间进度是尽力通知，可通过操作查询读取权威状态。内部修复使用策略的 `maxInternalRepairs=2`，最多初审加两次修复后复审；达到上限不再出新片或冷审。上述新增导演恢复仍待实际云端故障验收。

模型阶段先核对所有后续密钥和能力，再检查当前渲染器登记、实际镜像摘要、Chromium 沙箱、字体、broker/R2 读与实际 PNG 取帧，并确认 studio 停止；预检容器计入当前操作的计算预算。Coordinator 按 release/镜像/runtime/environment 缓存成功结果 10 分钟；缓存过期、换镜像或跨越用户等待时重新探测，失败不发模型请求、不缓存成功。S1 不使用的 Workers AI/ASR 仍待 S3 集成，不能由此算作已验证。studio 在启动前持久化所有权，启动失败或取消后仍能找到并停止；停止失败保留句柄供 outbox/alarm 处理，旧关闭请求不能删掉新 studio 的句柄。这些新增路径已有定点回放，实际云验范围见实施状态。

RenderWorkflow 的复合步骤值以共享 `canonical` 文本持久化、经 `parseCanonicalJson` 恢复；不依赖平台结构化对象的属性形态，也不放宽 JCS 对非 JSON 值的拒绝。最终提交不自动重试确定性失败，避免原始错误被后续期限错误掩盖。`test/render-commit.test.mjs` 只回放已生成的云端计算回执，检查实际提交代码，不重新捕获或编码媒体。

渲染记录依次为 `queued → sharding → verifying → assembling → passed`，失败/取消为 `blocked`/`cancelled`。准备输入也在失败处理范围内；失败先封锁新 attempt，再确认实例停止。`fail-render` 检查点只重试清理，最多三次重试，保留首个错误和 `stopPending`；确认失败时 lease 不归还。ShardDO 持久化单次 attempt 的停止标记，晚到 execute 不能重新启动。最终成片与 `render_progress` outbox 原子提交；通知由既有队列独立重试，陈旧 generation 的通知丢弃，查询渲染记录不依赖通知到达。

`verify-shards` 按共享整片阅读停留计划核对各段的精确观测帧及身份，不要求无计划点的短段伪造非空结果；QA/接缝确定性错误不默认重试。30 秒 24 段初验曾因原“每段非空”检查错误阻断；修复后 23 处接缝零差异、拼接/提交/私有下载均通过。[验收记录](../../docs/evidence/2026-10-24-s1-staging/README.md#修复后30-秒-webgl24-分段配乐与交付通过)同时保留原始失败、修复范围与实际费用。

旧恢复路径随 `ca1c37e` 部署；旧取消操作的残留渲染行修复与新 WebGL studio 停止已有云端证据。新增平台恢复如下，当前仅有定点本地检查，实际部署/验收见[实施状态](../../docs/implementation-status.md)。

## 原生 Workflow 中断后只清理，不猜测重跑

`pipeline_workflows` 区分派发登记、已确认创建、平台状态和清理完成；旧的非终态渲染/导演在迁移时补登记。每分钟按最久未检查顺序最多审查 20 条，原生 errored/terminated 或完成但未提交业务结果时落失败、停止实例、保留首因和未结费用。`POST workflows/reconcile` 使用同一入口立即对账；`GET operations/<id>/recovery` 返回原生登记、每个 attempt 的实际 `physicallyStopped` 和费用。读取失败为 null/未确认，不能假装已经停止。

取消先封锁 generation，再分别终止原生 Workflow 和停止计算/studio；平台状态查询故障也不会跳过物理清理。原生创建在取消后才返回时，派发者仍须停止该实例。导演在自己的失败步骤中不终止自己；独立 outbox 和定期对账补齐原生终止。停止/通知重试不调用模型或重捕获媒体。

首个 `claim-execution` 持久步骤在 D1 单次领取执行权。正常 Workflow 重放复用该检查点；整次原生 `restart()` 清空检查点后重领失败，触发清理与对账，不生成新 attempt 或重发付费请求。保留原 generation；取消不能通过重启复活。原生实例过期或状态 API 报错不自动 recreate，需保留未确认再调查。[官方 API 的 restart/terminate 语义](https://developers.cloudflare.com/workflows/build/workers-api/)。

新增路径用 `-f staging_scenario=lifecycle-recovery` 验收：只对本次新建的内部校准操作，在实际分段容器运行时取消；另一次原生强制终止后对账，再整次 restart 检查无新增计算/费用。另检查当前缺密钥/未验证模型的真实导演预检在消费前落失败，以及历史预算状态未被改写。产物为 `recovery-report.json` 与两条原生操作回执，不重做完整成片、13 风格或模型评测。每次操作结束再次确认停止，不删任务、源素材或费用证据；此场景不代替其余性能/安全 G1。
