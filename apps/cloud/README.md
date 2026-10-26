# S1 内部云端链路

只在 **staging** 启用。`/healthz` 以外的路由均要求 `S1_ENABLED=internal_eval` 和独立 `EVAL_API_KEY`；生产配置为 `off`。这是持有评测密钥的负责人使用的内部控制面，不能作为客户 API 接入，尚无 Google/邮箱登录或成员权限系统。

内部入口位于 `/internal/s1/`：`operations`、不可变 `objects/evals/…`、许可 `rights`、镜像 `releases`、`renders`、`studio`、`creative`；`artifacts/<key>` 只读取当前许可仍有效的已发布输出或已登记方向帧；操作可通过 `operations/<id>/events` 收取进度、`operations/<id>/frames/<frame>` 取许可帧、`operations/<id>/cancel` 取消。请求原文经共享解析器；渲染私有传输经预编译完整 Schema。实际权利记录必须在处理前入 D1，并引用私有 R2 中的来源/许可证据；不能拿素材 JSON 自报清权代替这一步。

`GET releases/<id>` 返回固定登记及当前容器元数据的镜像摘要，用于执行前核对，缺失返回 404。新镜像须以新 release 登记，不能覆盖旧引用；`POST releases` 从实际容器元数据取摘要，不信任调用者声明的 imageDigest。查询不启动计算。

已就绪的 studio 可用 `POST operations/<id>/studio/check/<frame>` 对授权帧重新取 PNG 并执行实际 CDP 阅读观测；返回该帧、取帧/观测耗时和原始 `frame_observation`，不是完整动态 Q1。`POST …/studio/benchmark/<frame>` 只允许 `calibration` 操作，在同一帧比较 PNG、JPEG90/92/95；普通评测仍只用 standard-3，只有校准允许 standard-4。每个工具都重新核对 generation/许可及原 task 的允许帧，控制器串行化整个 seek/截图/观测，拒绝交错命令；不能借诊断扩大素材或帧权限。

`RenderWorkflow` 执行分段、声音、接缝/阅读停留观测、拼接和 generation-fenced 提交；`ShardDO` 每次 attempt 使用独立容器，禁网，仅挂该任务的 broker；`CoordinatorDO` 在确认停止前持有并发 lease；`OperationDO` 管 studio 与进度。取消先推进 generation、撤销后续读写，再经 outbox 停止实例。任务、回执、冻结输出引用、费用预留与结算保留；重试不得覆盖已提交字节。

音频派发与入口校验共用 Worker 的 `AUDIO_INSTANCE`：standard-2（1 vCPU / 6 GiB），对应容器固定一个 FFmpeg 线程。旧 standard-1 实际只有 0.5 vCPU，低于方案的一核要求；现改用现有标准计价/预留，不改变冻结 AudioPlan、最终字节校验、名额和期限。该配置修正的原生结果另见导演证据；前一版 G1 的音频规格与分布不改写。

计算费用目前按 **分配的完整 CPU + 内存 + 磁盘 × 实际运行时间**记保守上界，不是 Cloudflare 账单实测值。CPU/内存/磁盘单价来源：[Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-23；实例规格见[官方表](https://developers.cloudflare.com/containers/platform/limits/)。未知模型 usage 保留预留，不记作零。生产预算未标定，Agent 仍关闭。

内部交互任务的 outbox consumer 保留每批最多 5 条，将批量等待明确设为 1 秒，不沿用平台默认的 5 秒；不改变重试、幂等或物理计算名额。成片仍按客户端提交到 passed 计时，排队没有从性能指标中删掉。

满载时 ShardDO 在原始期限内等待物理 lease，不启动容器、不预留容器费用；每次重查 generation 与持久停止标记，取得名额后再核对许可和预算。这样 24 个 WebGL 分段与声音可共用工作区的 24 个名额，不因瞬时满额直接失败，也不增加并发上限或重置期限。Coordinator alarm 设置失败仍先确认实例停止再归还 lease。该路径随 `1af113f` 部署；`fe3df1e` 修复观测覆盖检查后，30 秒 WebGL 出片/交付和全部计算停止/结算均已通过。真实中途取消、原生终止及 restart 防重放已有[独立证据](../../docs/evidence/2026-10-24-s1-staging/README.md#真实取消原生终止与整次重启防重放通过)；正式 28 部并发/串行分布见下文 G1 性能矩阵。

先在未启动的 DO 上注册唯一 broker，注册最多 30 秒且受原操作绝对期限约束；[官方 API](https://developers.cloudflare.com/containers/api/durable-object-container/#interceptoutboundhttp)允许启动前注册。只有注册成功并重查 generation/停止标记后才分配实例，避免注册等待耗尽整个健康窗口。回执单列 `brokerRegistrationMs`，不会从客户端墙钟中删去它。注册超时为 `RENDER_BROKER_REGISTRATION_TIMEOUT`，尚未分配实例时不记运行费用。

实际容器启动后必须在 `render.containerStartupMs`（45 秒）与整次渲染剩余期限内取得控制器 ready，单次探测最多 5 秒；到期才返回的 ready 不接受。物理启动与沙箱页面初始化分开，页面仍严格使用原 2D 30 秒 / WebGL 60 秒。未就绪时不派发 `/task`；超时与进程提前退出分别记录 `RENDER_STARTUP_TIMEOUT` / `RENDER_STARTUP_EXITED`，保留实际健康窗口、探测次数、最后状态与 monitor 状态。alarm 和执行轮询都沿用同一绝对期限，不因注册等待或重试重新计时；同一 DO 不重启计算。

当前纯 2D 的 15/30 秒均采用既有上限内的 6 段，15 秒最终片每段 75 帧；review 仍按源时间轴 30 帧单元切分并编码为 15 fps，15 秒段长为 60/90 帧。内部 review 使用[负责人批准的 180 秒止损上限](../../docs/plans/cloud-motion-v3.md#53-期限)，不是性能验收目标；最终片期限、WebGL 计划和全局/工作区名额不变。实际性能验证见[导演证据](../../docs/evidence/2026-10-24-s1-director/README.md)。

原生无可用实例记 `RENDER_CAPACITY_UNAVAILABLE`，网络断开按 startup/dispatch/execute 区分，Worker→DO RPC 断开另记 `RENDER_RPC_CONNECTION_LOST`；每个 attempt 保留首因。清理再次断开不覆盖首因，也不据此归还名额或清零未结费用。

`RenderWorkflow` 是基础设施重试的唯一调度方，原生计算 step 的重试仍为 0。仅明确容量/断连、注册超时与启动健康超时白名单可在**确认原实例停止且无未结预留**后，按 15/60 秒退避换新 attempt，最多读取策略规定的 3 次实际执行；不复用旧 DO、取消栅栏、预算或绝对期限。失败结果与新 ID 都是持久检查点，恢复不会再次执行已失败实例。未知停止/费用、作品错误、许可、预算、QA 与 deadline 均直接停止，不盲重试。回执保存失败尝试与全部费用，逐帧分布只统计最终成功分段的真实捕获数据。

当前 `durable_object` [调度策略](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)不支持 `max_instances`，运行实例计入账户资源限额；不能用旧策略默认 20 个实例解释并发错误或修改这里的配置。Wrangler 4.152.0 也会拒绝该字段。

## 研究模型共用一份预算

`MODEL_LEDGER` 绑定独立的共享 D1 `promobento-model-ledger`，staging/production 使用同一数据库；各自的操作、素材、计算账本仍在原环境的 `DB`，不混用客户数据。资源由 Actions 创建，迁移目录为 `model-ledger-migrations`。授权身份只取批准人与批准时间，不随价格目录、步骤换绑、新操作或部署而重置。

内部 `GET model-budget` 返回历史确认状态、目录估算、未知条目、当前已结/预留费用；`POST model-budget/import` 只接受 [`model-spend` 契约](../../contracts/model-spend.schema.json) 的不可变历史清单。部署场景导入四轮探针的 128 次请求清单：可计价的 114 次合计估算 255,521 usd_micros，另 14 次未知。负责人暂时没有供应商统计，`openingMicros:null`、`openingConfirmed:false`；默认拒绝未对账的新调用，不阻断不使用模型的媒体工作。

2026-10-24 负责人授权放宽门槛继续 S1，`model-authorization.json` 的 `unreconciledHistoryAllowance` 登记本次有限放行：在原 $300 内计 $5 历史风险预留，staging 新增模型费用最多 $10，2026-10-31 上海时间结束后失效。`budgetBasis:provisional` 与 `historyAllowance.active:true` 明示此状态；`budgetedHistoryMicros` 是风险预留而非账单，实际历史确认字段不变。共享 INSERT 仍原子累计全部环境/操作的实际和未知预留；新部署、操作、取消不重置 $10 上限。原清单摘要不符、期限已过或 production 不适用此例外。确认真实历史后恢复原授权准入，已有新费用仍累计。

负责人获得完整历史统计后，先用 `objects/evals/…` 上传 `kind:"model_spend_confirmation"` 的证据，再 `POST model-budget/confirm` 提交 `{evidenceKey}`。证据必须匹配当前授权与清单摘要，包含负责人确认的**本次授权以来全部历史** `totalUsdMicros`、实际来源及依据；不只填 114 次的目录估算。确认只能幂等重放，不能覆盖已有金额。密钥、登录信息不进入证据。

每次模型调用先在共享 D1 原子预留：历史确认总额 + 所有环境的实际/未结预留 + 本次预留 ≤ 授权上限；然后再通过本地操作/阶段/次数门槛。仅能证明尚未发出请求的本地准入失败可释放为零；请求已派发但 usage 未知时保留预留。调用结果先把原始响应、usage 与当时价格/汇率不可变写入私有 R2，再解析和结算。结算写入中断可用同一个 callId 补账，不重发请求、不按新目录重算；缺响应时要求对账，不自动重试付费调用。

无完整响应的 HTTP/传输错误另存去敏诊断 `model-calls/<调用身份>-request-failure.json`：仅含请求身份、错误码、可得的 HTTP 状态和 `usageStatus:unknown`，不保存响应正文或凭据。诊断写入失败不覆盖原首因；它不是成功响应或费用结算，未知预留继续占用预算。

终态截断/拒绝仍失败，但先读取后续 usage、保存 partial bytes 与失败标记；已报告用量照常结算，无用量仍占预留，不缓存或自动重发。当前 E/F 请求 `reasoning_effort:none`，但真实 F 的 JSON-mode 仍曾输出整段分析并用尽 8k。F 现与 E 一样要求工具返回：恰好一个 `submit_cold_review`，输入仍按原 `cold_review` Schema 和 verdict/问题一致性严格校验；输出空间为 16k。该传输已实际返回完整 BLOCK，独立上下文、两次调用、金额和质量门槛不变，不从截断文本猜结论。接力的实际落点／中途姿势另作一张第一画幅拼图，避免只凭相同的停留图判断没有运动；不代替完整动效或试听。登记隐藏提示的网关 Claude 路线额外预留 128k 输入 token 的风险空间，以覆盖历史约 110k 的异常注入；阶段与整次金额不提高。

完整但不合法的工具参数以 `MODEL_TOOL_JSON_INVALID` 保存原 arguments 与 usage，先入 R2/结算，再由导演在原调用/金额上限内作一次结构纠正。E 同样校验恰好一个允许工具及完整 FilmSpec；校验失败不能当作视觉通过。无 usage 的不合法响应必须对账，不为纠正再次发出请求；历史已丢失的 usage 不以新适配器回填。

纠正请求携带已完成坏输出的 `previousOutput`（原文字及工具参数），作为数据而非指令；JSON 语法失败不会只给错误码后让模型重新猜整份规格。该反馈不改写原始回执或费用，仍受原阶段次数、金额和绝对期限约束。

原独立 `model-probe.yml` 已停用并移除；[历史脚本](../../research/model-probe/archive/probe-2026-10-23.mjs)只保留作来源。后续真实探针也必须纳入共享账本，不能从归档脚本绕过预算。当前 C 走网关 Opus，F 和其余步骤走网关 DeepSeek；官方备用未绑定，仍保留 `verified:false`。

## 部署

由 [Deploy S1 staging](../../.github/workflows/cloud-deploy.yml) 在 Actions 安装冻结依赖、预编译验证器、应用 staging DB 与共享 MODEL_LEDGER 两套迁移，再由 Wrangler 构建/推送镜像并部署。开发分支尚未在默认分支登记新工作流时，从既有入口 `gh workflow run checks.yml --ref <branch> -f suite=staging` 调用同一部署工作流，其他检查 job 均跳过。Mac 不构建镜像。随后只运行一次 15 秒原创工程片，覆盖真实 broker、任务 Schema、字体、分段、声音、观测、接缝、拼接、私有输出与 lease 归还；不会重跑九积木帧图、13 风格或模型评测，也不代替完整 G1。

Actions 为本轮生成并遮蔽 `EVAL_API_KEY`，只经 stdin 绑定到 staging Worker；结束前取消该轮操作、确认 lease 归还并删除密钥。内部入口随即恢复 404，`/healthz` 仍可用。失败报告与已生成媒体在 `s1-staging-deployment` 产物；不删除 D1/R2 的任务、权利和费用证据。需要人工恢复时从此工作流重新部署已核对的分支；不要删除数据库或回滚 Durable Object 迁移。手动使用内部入口时另行绑定密钥，不向聊天或日志粘贴值。官方 Anthropic 的密钥暂不添加，相关真实集成保留未验证。部署、G1、导演和首次六题评测的实际完成范围见[实施状态](../../docs/implementation-status.md)。

### 将已有 Actions 模型密钥绑定到 Worker

仓库 Actions 已有 `MODEL_COMPAT_API_KEY`；它可供工作流使用，但不会自动成为 Worker 的运行时绑定。运行 [Bind staging ModelSwitch key](../../.github/workflows/model-runtime-key.yml)：

```sh
gh workflow run model-runtime-key.yml --ref main
```

该维护入口只绑定 staging 的这一项，不构建镜像、不上传 Worker 代码、不调用模型或渲染，也不改模型步骤绑定/预算。它与 staging 部署共用互斥组，拒绝活动内部密钥、未结束操作或未结计算费用；已存在的模型绑定保留，不旋转或覆盖。Actions 只在该步骤向维护脚本注入密钥，Wrangler 子进程只从 stdin 接收该值，不经环境或参数传递，日志/产物只含名称、状态与健康结果。后续普通部署保留已有 secret。

写入后核对 secret 名称和 `/healthz`；这仅证明配置存在，不是模型集成探针。[40077653946](https://github.com/ten2ten2/promobento/actions/runs/40077653946) 已成功绑定，0 模型/渲染调用。若健康异常，只撤销本次新增的绑定；未知写入结果不重试、不猜测删除。需要人工撤销本次新增项时，通过已有授权运行 `wrangler secret delete MODEL_COMPAT_API_KEY --env staging`，先确认没有其他活动操作；不要删除其他 secret。当前网关 Claude 和 DeepSeek 共用此密钥，历史费用门槛仍由服务端检查。

studio 的 45→375→45 与关闭已在 [39987356301](../../docs/evidence/2026-10-24-s1-staging/README.md)通过，普通出片检查复用该证据，不重复取三帧。每个分段仍读取实际健康回执；cgroup 峰值接口均缺失时以 `null` 加明确原因继续内部出片，整片 `peakMemory.status` 保留 `unverified`。S1 出口按[负责人批准的平台限制](../../docs/evidence/2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)处理，不把它记成测量通过。无效读数、权限错误、媒体、沙箱和预算门槛不变。

平台侧观测可通过 `gh workflow run cloud-account-check.yml --ref main -f scope=container-metrics` 只读查询既有 G1 28 部矩阵时间窗的 staging 应用。该分支不部署、不绑定临时密钥、不运行原账户检查中的模型请求或任何计算；产物为 `s1-container-metrics`。它读取官方 GraphQL 的全工作负载采样最大值，不能冒充 cgroup 全生命周期高水位，也不回填旧分段回执。权限、数据缺失和查询失败均保留为未验证；默认 `scope=prerequisites` 的原账户检查不变。

新增 WebGL 时选 `-f staging_scenario=webgl-studio`，只覆盖新设备积木的四画幅 0/12/45/375 帧、逆序与独立实例冷 seek、真实 SwiftShader 字符串及停止/lease 归还；不重跑 2D 工程片、配乐或模型。产物为 `webgl-*.png` 和 `webgl-report.json`。这不是完整 G1；30 秒分段成片另见 `webgl-film` 证据，正式性能分布与 standard-3/4 对比已有下文独立结果。一般工程片仍使用默认 `engineering` 场景。

验证新排队/声音集成时选 `-f staging_scenario=webgl-film`：一部 30 秒、24 个 standard-4 分段的原创 3D 校准片，共享工作区 24 个名额，另有程序配乐和四种 lead-in。沿用内部操作 1,000,000 usd_micros 预算，实际费用另从不可变结算收集，不当作预算全额消耗。该场景保存声音/分段计划、实际成片、接缝、只读费用清单与私有下载；不重复先前的四画幅 studio 比较或 13 风格样曲。单次计时不作为 p50/p95 或完整 G1。

仅修复检查脚本、仍需验证原部署时，可在上述手动入口加 `-f staging_sha=<实际已部署完整SHA>`：跳过迁移、构建和部署，只修复并运行 harness。报告分别记录部署 SHA 和 harness SHA，不把新分支当成已部署。内部密钥写入后先等待只读鉴权就绪（最多 60 秒）；相邻请求仍可能看到旧密钥，此时仅对调度前的确切 `404 Not found` 有界等待，并记录次数。模型/渲染失败和不确定超时不自动重试。

只改 Worker 时，可改用 `-f staging_renderer_sha=<已部署镜像源码完整SHA> -f staging_renderer_digest=sha256:<实际registry摘要>`：确认镜像源码为当前祖先，且实际渲染输入未变化后，只部署 Worker，复用原镜像，不构建推送。守卫只排除未被容器运行时导入的模型供应商/授权文件及其 `model-config` Schema、未被容器导入的 `packages/models` 适配器、纯单元测试及容器 README；`agent-policy` 仅允许模型目录标签、`director.steps` 和仅由 Worker 执行的 `render.totalMs.review` 不同。容器保留自身阶段超时；操作/计算预算、实例限额、最终片期限、编码与其他渲染规则仍逐项相同。其他共享源码、契约、配置、依赖、字体和许可仍受保护。`renderer-reuse.json` 分别保留镜像来源和摘要，部署 SHA 仍是新 Worker 的提交。镜像摘要必须来自原部署回执，不能填写本地 image ID。

仅部署已做必要定点检查的 Worker 时，选择 `-f staging_scenario=deploy-only`：只读取实际 `/healthz`、内部容量与预算状态并保存 `deployment-health.json`，不创建操作或启动模型/媒体。部署仍在 Actions 完成，临时内部密钥照常回收；这不是成功导演或媒体验收。

若 Wrangler 已上传 Worker，却未完成容器应用设置，先从版本列表取得确切版本 ID，再用 `gh workflow run cloud-account-check.yml --ref <branch> -f scope=container-deployment -f version_id=<UUID>` 只读核对同一 Actions Token 可见的版本、ShardDO 命名空间和容器应用。`s1-container-deployment` 只保留这些元数据及 API 错误，不保存其他绑定、凭据或用户素材，不修改部署、不启动计算。镜像已推送时沿用原 registry 摘要，不能为补设置反复构建。

先诊断再修复：同一入口另加 `-f staging_inspect_run=<原 Actions run ID>`，只查询该次操作的 Workflow 步骤/错误及 D1 状态、attempt 和费用结算，保存 `inspection.json`；不部署、不绑定内部密钥、不新建渲染，不读取任何凭据值。出片失败时，部署工作流也自动保留这份只读诊断，不为收集错误重复渲染。

矩阵子操作另加 `-f staging_inspect_operation=<同一 run 的完整子操作 ID>`，仍须用 `staging_sha` 指定当时部署。只接受该提交/run 前缀下的子操作；同时查询其开始/结束附近最多两分钟、500 条已存日志，删除凭据字段，保留实际 HTTP/权限结果。容器日志不一定带 Worker 名，不能用名称过滤后的 HTTP 请求日志推断容器没有启动错误。日志不可读不冒充“没有错误”，也不会为收集日志启动计算。

只修复已失败/取消的指定操作，可加 `-f staging_reconcile_operation=<operation ID>`。新版本通过 `operations/<id>/reconcile` 再次确认实例停止，补齐旧 attempt 的停止记录及遗留的渲染非终态；返回未结费用清单。不重启计算、不改 generation、不清零未知模型费用、不覆盖 passed 成片或原始失败原因。活动操作拒绝此入口。

## 不消费云资源的导演回放

`mise run test:cloud-local` 在本机预编译当前 Schema 后，用真实 `OperationWorkflow`、两种 SSE 适配器、SQLite 预算 SQL 和内存 R2 回放 A–C/E/F。网关默认路径不提供官方密钥，另显式回放原生 Anthropic 适配器。覆盖三方向取帧、12 小时用户等待排除、规格/JSON 校验纠正、review 修复、各画幅冷审、取消栅栏、缺许可/密钥/模型验证的提前阻断，以及未知消费保留预留。`fetch` 完全替换为固定 SSE，容器/成片为明确模拟，不访问外网、不读真实密钥、不构建 Mac 镜像；这些结果不代替媒体质量或 G1。官方模型仅在这个独立 mock bundle 中视为可回放，部署配置的 `verified=false` 不变。

### B 输出精简卡，可信积木生成真实 hero

B 一次只写三张方向卡与 3–8 镜头骨架，不同时写三份完整影片。宿主从原事实/素材、色板、纵深与积木选择生成 15 秒静音 hero，先过实际运行能力准入，再由 studio 出图；至少一个方向有纵深。衍生 FilmSpec/来源经 `materialize-direction-heroes` 冻结，方向摘要绑定这些实际内容。已有完整 `keyframeFilm` 仍按同一严格准入复用；最终完整影片由 C 生成。

`trusted_direction_hero_v2` 优先采用骨架中的产品镜头，三个方向使用同一张首位清权主图，比较色板／纵深而非按序号轮到辅助 Logo。带图镜头的标题使用上下文产品名／品牌名，不把完整事实原文塞进窄标题区；旧上下文没有名称时保留原用法。原事实、已提供的完整 keyframeFilm、字号和 C 的完整故事不改写，已经冻结的旧方向也不重写。

### 完整结构化响应可纠正一次

首次真实事实整理返回额外的 `schemaVersionNote:null`，已完整保存/计费，但严格 Schema 拒绝，未继续素材或出片。A/B/F 对这种完整 JSON/契约失败现可反馈 code/path 和原响应，最多一次新 callId 纠正；首次成功的检查点仍兼容。事实整理和每素材各最多 2 次，总阶段金额保持 $0.01/$0.04；B/F 保持原总调用限额。素材的纠正沿用原第一条图片输入的预算身份，不因反馈消息另开一份费用/次数。F 调用用尽后不再先花 C 的费用做无法复审的修复。未知消费、权限、预算或传输失败不进入纠正。

### 完整回执可重新准入，不为解析修复再付一次

模型文本先经共享严格 JSON 解析；只有完整单一 Markdown json 围栏可去包络后重解析，仍执行全部 Schema、跨字段和实际运行能力检查，不提取散文中的片段。原始回执不改写。

同工作区/项目/用途的相同请求、模型与目录，在派发前可查已结算的不可变原始回执重新校验。通过后进入正常缓存；未通过则保留原引用给结构纠正，不新增费用或伪造一次新调用。原操作不恢复、原账本不改，未知回执不按这个入口放行。新操作的实际/未结费用仍累计入同一授权。

### C 的校验纠正不重发未知消费

C 的完整模型响应先保存并按 usage 结算；JSON、Schema 或 FilmSpec 跨字段错误以结构化 code/path 反馈，最多再纠正两次。每次仍用完整原需求、事实与素材，换新 callId/持久检查点，并受原阶段 3 次、费用、generation 和绝对期限约束。原 `spec` 成功检查点保持兼容；无效响应不缓存、不渲染、不当作免费。网络/截断/未知响应、权限、预算和期限错误不进入此纠正循环。

### 模型输出先满足实际 S1 运行能力

模型所见 FilmSpec 提示限制 texture 为 none、转场为 cut/crossfade/push/whip、禁布局覆盖/素材裁剪，并只列 context 中已获准的精确字体 face。完整 FilmSpec 协议仍保留未来能力。准入复用当前页面生成器处理纯 JSON，检查实际积木、字体与素材支持，丢弃 HTML，不在 Worker 执行任何创作代码；真正捕获仍只在容器 Chromium。三张方向卡先汇总各自支持性错误后纠正，再启动 studio，避免第一张可运行就误认全部可运行。真实 texture 反例及费用见[导演记录](../../docs/evidence/2026-10-24-s1-director/README.md)。

### E/F 看全画幅阅读停留，不截断前 12/16 张

每个画幅将全部实际阅读停留 PNG 按帧排序、保持比例拼成一张图；逐张核对 R2 字节身份并解码，拒绝空集合、重复帧、混合尺寸和原有 1 MiB 图片上限之外的结果。拼图一次只保留一个源帧的完整像素缓冲，继续使用已获许可的真实帧，不启动新渲染。每格的源引用、frame、位置、画幅、成片引用和拼图身份写入不可变 `review-images.json`，候选保存 `coldReviewEvidenceKey`。常规片用两列、面积平均缩图，片外标注 `FRAME <帧号>` 并留深灰间隔，未占用格子写 `NO FRAME`；审片只判断 tiles 中的影片像素，不把这些包装当成影片留黑或裁切。

这样两画幅 F 只需两张图，既不丢竖屏或片尾，也不因逐张图片的最坏 token 预留超出原 $0.05 阶段预算。预算未放宽；网关 Claude 的视觉失败也未改成通过。这仍是**阅读停留帧**拼图，每秒缩略图与完整动态 Q1/Q2 仍按原切片继续实现。已用既有原生成片的横/竖屏 PNG 实际生成并查看拼图，没有调用模型或重新捕获。

E/F 均收到原始 `briefContext` 和所选方向的冻结数据；不把导演对话带入 F。审片须对照原需求、确认事实、受众、定稿/CTA 与许可限定，而非只看当前 FilmSpec 的文字。C/E 的标题聚焦具体产品/课程故事，事实原文供核对并绑定 factId，保留清晰的供应商声明归属、必要署名和限定条件；不以通用核验标题或免责声明代替宣传主张。完整 Schema、实图、独立冷审与原修复/调用/费用上限保持不变。

F 的具体 BLOCK 发现可触发一次规格修复，再经过 E、全画幅重渲和第二次独立 F；同一规格不变则以 `COLD_REVIEW_NO_CHANGE` 停止。E/F 共用最多两次 `internalRepairs`，不各自重置；C 的 3 次调用、F 的 2 次调用、阶段金额与整次期限也不重置。首次成功的检查点名称保留，修复影片另用新名称/引用，不覆盖先前成片。第二次 F 仍 BLOCK 或额度已用尽时不交付候选。

达到修改上限或 F 无法继续修复时，按[内部审片退出规则](../../docs/plans/cloud-motion-v3.md#66-阶段-e整片-review)保留未验收的 `review-draft.json`。`GET operations/<id>/review-draft` 只供内部负责人取回，操作仍是 `failed`，`candidate` 接口仍返回 404；不会增加修改次数或绕过 F。草稿绑定最后实际渲染的规格／影片、原停止原因、未应用建议及冷审状态。`artifacts/<key>` 在这类失败操作中只放行草稿所列的已通过媒体，仍核对 generation 与当前许可；普通失败、取消、旧代际和其他输出不开放。

## 导演选择结构，D 实现自写镜头

负责人批准把 DOM/SVG/Canvas2D 自写镜头提前到 S1；完整 S2、生产与客户入口未因此开放。新创作在 `creative` 准入时冻结 `packages/methods/directing.ts`，B/C/D/E/F 按阶段召回。方法版本/内容摘要进入模型缓存身份、费用用量与候选/草稿；已有操作的空 `directing_method_key` 保留原积木路径，不追溯改写已付费检查点。新操作先用真实自写 health 镜头确认当前 renderer 支持它，再发模型请求。

B 选择信息形态、运动语言与骨架；方向 hero 仍是静音可信积木的构图预览，不冒充自写镜头效果。C 写 Treatment 和完整 FilmSpec，自行决定结构/时间；需要原创动作时声明 custom scene（本轮最多两个），不把做不到的动作降成固定截图顺排。D 直接查看本镜头使用的已清权素材图，按 `hardest` 顺序调用既有 `edit_file`，只写该 scene 的模块；静态解析不求值。新路径的系统提示允许这些沙箱模块，旧操作仍保留原积木限制。每镜头的 12 次/$0.35 原上限独立累计，修复、重放、整次费用与期限不重置。

所有模块按 [运行时接口](../../packages/film-runtime/README.md)准入并冻结原始字节。D 在每个请求画幅的独立 studio 中先检查事件/首尾姿势和阅读窗口，保存实际 PNG、CDP 观测与 proof，并做逆序与新实例冷 seek 像素比较，确认关闭后才渲整片。Q0 或真实局部检查失败则不提交候选；不是自动放宽 QA。E 可通过唯一匹配的 `str_replace`/`insert` 定点改当前模块，仍使用 E/F 共用两次修复额度；修改后重新检查并渲染。F 继续独立看实际画面，不带 D/E 对话。自写镜头另有每秒及事件姿势，不能把静态阅读图当作完整运动审片。

原生 `edit_file` 参数从同一共享契约派生，但下发为自包含 Schema：`path` 明确为当前模块的字符串，不能留下指向父 Schema 的 `$ref`。D 首次只开放 create，E 只开放 str_replace/insert；坏路径按具体 code/path 反馈，不把模型返回的对象路径静默转换为字符串。

D 当前内部候选用 `reasoning_effort:none`，兼容接口另外命名指定 `edit_file`；不再只靠提示要求自动选择工具。先 create 静态构图与已声明槽位，再按 C 的阅读窗口选择至多三个创作片段，以 str_replace/insert 在原文件内逐步实现完整原 brief。分片不改变影片时长、事件、阅读点或剪辑；后一次保留已写的动作。提示给出单演员 API 示例、各画幅字号下限、保留挂载字体及直接调用 OM.clock 的规则。静态底稿不提交影片；只有最终源码进入实际帧检查和整片渲染。原 16,384 输出上限、每镜头共用调用/费用和完整源码/帧校验不变。Anthropic 路线保留原工具行为；适配语义见[模型接口](../../packages/models/README.md)。当前只真实生成过静态模块，完整动作和运行效果仍待重验，截断不自动重试。新模型回执记录选择的 effort、工具选择和输出上限，不据此声称供应商已按参数执行。

当前新路径的实际验证范围统一见[实施状态](../../docs/implementation-status.md)。

## 导演使用已批准的音乐

图片仍放 `context.resources`；可选的 `context.audioSources` 单独列出最多四个音乐源，不送入看图模型。每项提供 `kind: "score" | "upload"`、`resourceId`、`sha256`、私有 `evals/…` 的 `key`、`byteLength`；ABC 另有 FilmSpec 使用的 `scoreRef`（例如 `audio/original.abc`）。不接受目录中自报的 `rightsCleared` 或许可证；可信宿主从 D1 权利行和私有 R2 证据读取许可。完整结构见 [`audio-admission.schema.json`](../../contracts/audio-admission.schema.json)。

先按既有内部入口上传不可变素材与证据，再登记 `rights`。音源证据须含 `kind: "audio_source_rights"`、当前 `operationId`、匹配的 `resourceId`/`sha256`/`licenseRef`、`scope: "internal_eval_only"`、`approvedBy: "owner"`、实际 `source` 和 `basis`。ABC 还须由负责人独立批准 `scoreApprovals: [{totalFrames, requestHash}]`：`requestHash = digest({text, totalFrames})`，其中 text 为源文件严格 UTF-8 解码文本，totalFrames 为 450 或 900。15 秒的批准不能用于 30 秒；不能从模型返回的 FilmSpec 推导批准。

预检先核对许可，再读源文件；ABC 上限 16 KiB、上传音乐上限 8 MiB。FilmSpec 只选择已批准的 `scoreRef` 或 `resourceId`，宿主确定性生成 AudioPlan、`audio:music` 字节输入及独立清权记录；容器再核对实际摘要、谱文本与批准时长，然后解析/合成。上传仅支持现有有界 WAV 解码器的 mono/stereo PCM16/24、44.1/48 kHz、最长 30 秒子集，源必须覆盖整段，不自动循环或补静音。音轨素材也进入 job 的权利清单，后续渲染和私有下载重新检查撤销状态。旁白仍需转写/字幕准入，不能作为本音乐入口上传；方向卡保持静音。

新增准入／真实 PCM 合成、失败恢复及导演传输回放已做定点本地检查。真实 ABC 已完成准入、三张方向图、C、六个 review 分段和 15 秒母带；页面崩溃修复后，组装仍超出原 90 秒总限，尚未完成整片端到端验收。[实际范围与回执](../../docs/evidence/2026-10-24-s1-director/README.md#页面崩溃解除abc-母带成功整片仍超时)保留失败、时延和回收结果，不替代负责人试听。

导演准备输入也纳入失败处理。失败先原子写入终态与首个错误的 `operation_failure` outbox，再确认停止、修复非终态渲染；未知消费保持预留。清理专用检查点和队列可重试清理，不重复模型/媒体调用。最终候选与 `operation_progress` outbox 原子提交，通知故障不回滚成功。中间进度是尽力通知，可通过操作查询读取权威状态。内部修复使用策略的 `maxInternalRepairs=2`，最多初审加两次修复后复审；达到上限不再出新片或冷审。上述新增导演恢复仍待实际云端故障验收。

模型阶段先核对所有后续密钥和能力，再检查当前渲染器登记、实际镜像摘要、Chromium 沙箱、字体、broker/R2 读与实际 PNG 取帧，并确认 studio 停止；预检容器计入当前操作的计算预算。Coordinator 按 release/镜像/runtime/environment 缓存成功结果 10 分钟；缓存过期、换镜像或跨越用户等待时重新探测，失败不发模型请求、不缓存成功。S1 不使用的 Workers AI/ASR 仍待 S3 集成，不能由此算作已验证。studio 在启动前持久化所有权，启动失败或取消后仍能找到并停止；停止失败保留句柄供 outbox/alarm 处理，旧关闭请求不能删掉新 studio 的句柄。这些新增路径已有定点回放，实际云验范围见实施状态。

RenderWorkflow 的复合步骤值以共享 `canonical` 文本持久化、经 `parseCanonicalJson` 恢复；不依赖平台结构化对象的属性形态，也不放宽 JCS 对非 JSON 值的拒绝。最终提交不自动重试确定性失败，避免原始错误被后续期限错误掩盖。`test/render-commit.test.mjs` 使用已有六段最终片回执及其原规格，先核对现行计划与回执的帧区间；只回放已完成的计算／接缝步骤，检查实际提交、通知及准备失败终态，拒绝未缓存的新计算，不重新捕获或编码媒体。

渲染记录依次为 `queued → sharding → verifying → assembling → passed`，失败/取消为 `blocked`/`cancelled`。准备输入也在失败处理范围内；失败先封锁新 attempt，再确认实例停止。`fail-render` 检查点只重试清理，最多三次重试，保留首个错误和 `stopPending`；确认失败时 lease 不归还。ShardDO 持久化单次 attempt 的停止标记，晚到 execute 不能重新启动。最终成片与 `render_progress` outbox 原子提交；通知由既有队列独立重试，陈旧 generation 的通知丢弃，查询渲染记录不依赖通知到达。

`verify-shards` 按共享整片阅读停留计划核对各段的精确观测帧及身份，不要求无计划点的短段伪造非空结果；QA/接缝确定性错误不默认重试。30 秒 24 段初验曾因原“每段非空”检查错误阻断；修复后 23 处接缝零差异、拼接/提交/私有下载均通过。[验收记录](../../docs/evidence/2026-10-24-s1-staging/README.md#修复后30-秒-webgl24-分段配乐与交付通过)同时保留原始失败、修复范围与实际费用。

旧恢复路径随 `ca1c37e` 部署；`8acc356` 已部署原生实例登记/恢复和共享模型预算，真实中途取消、原生终止及整次 restart 防重放已有[云端证据](../../docs/evidence/2026-10-24-s1-staging/README.md#真实取消原生终止与整次重启防重放通过)。导演预检当轮等待超时，随后 `eb4843a` 零重试修复已单独云验通过，不重做前三项恢复。

## 原生 Workflow 中断后只清理，不猜测重跑

`pipeline_workflows` 区分派发登记、已确认创建、平台状态和清理完成；旧的非终态渲染/导演在迁移时补登记。每分钟按最久未检查顺序最多审查 20 条，原生 errored/terminated 或完成但未提交业务结果时落失败、停止实例、保留首因和未结费用。`POST workflows/reconcile` 使用同一入口立即对账；`GET operations/<id>/recovery` 返回原生登记、每个 attempt 的实际 `physicallyStopped` 和费用。读取失败为 null/未确认，不能假装已经停止。

取消先封锁 generation，再分别终止原生 Workflow 和停止计算/studio；平台状态查询故障也不会跳过物理清理。原生创建在取消后才返回时，派发者仍须停止该实例。导演在自己的失败步骤中不终止自己；独立 outbox 和定期对账补齐原生终止。停止/通知重试不调用模型或重捕获媒体。

ShardDO 每次停止都先持久化不可复活标记；仅当原生 `container.running` 为真时调用 `destroy()`，随后仍核对已停，才释放名额和结算。已经停止或未分配的实例不重复销毁；运行中销毁失败仍保持名额和未知费用。失败控制器的私有诊断引用仅在键严格属于当前 attempt、摘要／长度有效时保存，消息正文不进入普通失败回执。

studio 不建立成片 attempt 行；恢复查询会同时按持久计算预留 ID 检查其原生 `physicallyStopped`，读取失败为 null。不能用空的 `attempts` 列表或费用已结算推断 studio 已停止；已有分段状态直接复用，避免重复查询同一个实例。

首个 `claim-execution` 持久步骤在 D1 单次领取执行权。正常 Workflow 重放复用该检查点；整次原生 `restart()` 清空检查点后重领失败，触发清理与对账，不生成新 attempt 或重发付费请求。保留原 generation；取消不能通过重启复活。原生实例过期或状态 API 报错不自动 recreate，需保留未确认再调查。[官方 API 的 restart/terminate 语义](https://developers.cloudflare.com/workflows/build/workers-api/)。

新增路径用 `-f staging_scenario=lifecycle-recovery` 验收：只对本次新建的内部校准操作，在实际分段容器运行时取消；另一次原生强制终止后对账，再整次 restart 检查无新增计算/费用。另检查当前缺密钥/未验证模型的真实导演预检在消费前落失败，以及历史预算状态未被改写。产物为 `recovery-report.json` 与两条原生操作回执，不重做完整成片、13 风格或模型评测。每次操作结束再次确认停止，不删任务、源素材或费用证据；此场景不代替其余性能/安全 G1。

只修复确定性导演准入时用 `-f staging_scenario=director-preflight`，不启动分段或声音、不调用模型。该零消费探针先要求历史开账仍明确未确认且没有生效的临时风险放行；准入已开放时拒绝派发，不能意外变成付费创作。当前独立场景要求首因为 `MODEL_HISTORY_RECONCILIATION_REQUIRED`，验证已配置的网关密钥与模型能力检查没有误拦；`preflight` 明确零重试，清理仍可独立重试。报告从不可变 `operation_failure` outbox 和实际 R2 故障证据核对首因，不依赖原生 Workflow 已终止后是否仍返回原异常。查询、报告和临时密钥回收沿用同一工作流。

[40080916901](../../docs/evidence/2026-10-24-s1-staging/README.md#现有网关密钥已绑定导演预检到达历史费用门槛) 已在 `b4b56d2` 单独通过这一门槛检查，8.698 秒内终止、零模型/媒体调用，历史费用仍未确认。没有重建原 renderer 或重跑既有媒体/性能；真实模型请求及成功导演仍待历史费用确认后执行。

## G1 性能矩阵

`gh workflow run checks.yml --ref main -f suite=staging -f staging_scenario=g1-performance` 通过同一 Actions 部署入口执行正式分布：先采 30 秒原创 WebGL 校准片 10 次串行与 4 路并发，再采纯 2D 同组，共 28 部。每部独立 operation、预算和权利行，仍使用工作区原有 24 个计算名额及单操作 1,000,000 usd_micros 上限。不会额外跑默认 15 秒工程片、studio 画幅矩阵、13 风格或模型。工作流的 60 分钟只覆盖整组采样，每部原有期限不变。

只修纯 2D 时选择 `-f staging_scenario=g1-2d-performance`，仍采足 10 次串行和四路并发，不将 14 部标成完整 28 部矩阵；默认入口不变。当前 standard-2 的[完整结果](../../docs/evidence/2026-10-24-s1-performance/README.md#当前资源28-部交付2d-时间未通过)虽全部交付，2D 时间尚未通过；下文 `257ca1b` 为旧 standard-1 的历史结果。

`performance-report.json` 增量保留每部输入、分段、成片引用、实际回执、物理停止和结算。串行/并发分别用经验最近秩计算 p50/p95，保留样本数，不把不同负载混成一个分布。新实例启动到控制器健康响应、页面握手、等名额、逐帧 seek/确认/JPEG 捕获各自计时；逐帧计时不含编码器背压、QA 和额外接缝 PNG。旧回执可缺逐帧数组，不能用均摊段耗时补造分布。费用仍为实际持久结算的分配资源保守上界，不是供应商账单。

只下载每类首部实际 MP4 与封面，其他影片的不可变引用留在报告及私有 R2；不公开成片。每部结束取消并确认停止/结算，不自动重做整部失败影片；明确基础设施错误仅走上文确认停止/结算后的有界 attempt 重试。未结费用不清零，工作流最终回收本轮密钥。该组件不代替捕获格式/机型对照、安全与 studio 延迟等其余 G1 项，也不放开历史费用和官方模型门槛。

[40073832345](../../docs/evidence/2026-10-24-s1-performance/README.md#28-部完整矩阵通过2d-p50-达到-60-秒目标) 已在 `257ca1b` 完成 28/28 部，复用 `420e245` 的未变镜像。2D 串行墙钟 p50/p95 为 51.861/70.572 秒、四路并发 55.153/76.416 秒；WebGL 串行 67.844/102.814 秒、四路并发 101.524/106.862 秒。392 处接缝全零差异，476 次计算均实际停止并结算；cgroup 峰值仍待验。已有结果继续复用，不因文档或离线评测准备工具变化重跑矩阵。

### 捕获格式、机型与 studio 工具选型

`-f staging_scenario=g1-selection` 只补上述选型和工具延迟，不出片、合成声音或调用模型。原创 2D/WebGL 各用 standard-3/4 打开一次 studio；每组对授权的 45/165/375 帧轮流采样 10 次，分别记录实际 still/check HTTP 延迟、各捕获格式的耗时/字节，以及 JPEG 相对 PNG 的解码后平面 8-bit RGB SSIM。该计算使用镜像里的 FFmpeg 6.1.1，[过滤器支持的 RGB 格式](https://github.com/FFmpeg/FFmpeg/blob/n6.1/libavfilter/vf_ssim.c)为 `gbrp`，不把 JPEG 字节摘要当视觉质量。

`selection-report.json` 保存所有原始样本、CPU flags、真实 WebGL 字符串、启动与停止/费用；每组首张实际 PNG 随产物保留。另实测普通评测拒绝 standard-4/benchmark 且零计算，未授权帧拒绝 check。生产默认仍为 JPEG92 / studio standard-3；只有实测选型结论才能调整，新增入口未运行时保留未验证。

### 正式镜像的 S1 隔离检查

`-f staging_scenario=g1-isolation` 对 2D standard-3、WebGL standard-4 各开一个独立 studio，只测授权的 45 帧及[固定攻击项](../../tests/attacks/film-v1/isolation.json)。`POST operations/<id>/studio/isolation/<frame>` 在 Worker 与 ShardDO 均要求校准 purpose，仍检查 generation、许可、task 和帧范围；普通评测和越界帧先拒绝。控制器不执行调用者提供的代码或命令。

`isolation-report.json` 保留真实 Chromium 沙箱、shim/CSP、容器外网/DNS/TCP、broker 无令牌/错令牌/越权读写、uid 隔离和实际停止/结算结果。CSP 用普通同源脚本执行；令牌仅以指纹供 uid 探针检查原始进程字节，bearer 不传给启动器，指纹也不进报告。只保留父浏览器白名单键名、子进程的可读性/字节数/泄漏布尔值与权限结果，避免将重用的 argv 字节当作环境键或输出其中内容。固定请求只访问 example.com、Cloudflare 公共 DNS 地址及本任务的 broker；失败不自动重试。此场景不出片、不调模型，不代替 S2 的资源耗尽与任意镜头故障测试。

新自写路径的零模型云验入口：`suite=staging / staging_scenario=custom-studio`，只检查原创源码传输、四画幅正/逆/冷 seek 与实际 CDP 阅读观测，不合成声音、编码影片或调用导演模型。
