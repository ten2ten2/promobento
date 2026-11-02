# Native huashu control plane

Cloudflare 保存操作、不可变工程版本、预算、任务状态与私有产物。影片只使用固定版本 huashu-motion 的 HTML 工程；每次预览或整片导出都是一个独立容器任务，没有 FilmSpec、分片合并或云端长期 Studio 执行入口。

本页是**主线内部 API**，受 `EVAL_API_KEY` 保护；原生代码尚未部署 staging，生产 `S1_ENABLED=off`。客户认证、资产 ACL、购买、冻结交付和 Studio 待实现。内部 `evals/` 导入区不得向租户开放；操作生成文件限定在 `operations/:id/`，跨操作复用须证明同工作区／项目的父 revision。实际验收见[实施状态](../../docs/implementation-status.md)。

## 工程与任务

共享文件清单见 [native-project](../../packages/contracts/src/native-project.mjs)。工程是 `index.html`、本地素材与运行时文件，清单固定原生运行时提交 `52467f99c602b76ba86d511d37acdfe93fa1e16e`，并记录 15/30 秒、30 fps 和目标画幅尺寸。它不定义镜头、积木或新的动画语言。

- `saveNativeProject` 先核对每个私有 R2 对象的大小与摘要，再保存规范化清单。revision 是清单 hash；旧版本永不覆盖。
- `baseRevision` 表示改稿来源。加载来源须匹配操作的 workspace/project；方向预览、不同画幅及改稿各有独立不可变分支，不用一个全局 head 覆盖其他画幅。
- `createNativeRender` 在同一 D1 batch 中记录渲染与 outbox。任务生成后立即尝试发送；定时 sweep 重发未入队项，也会对超过 5 分钟仍未登记 Workflow 的活跃创作／排队渲染做有界补派发。对于**已登记但尚未确认创建、也未领取执行权**的活跃 Workflow，恢复扫描可补做首次 `create`；任何已创建、已领取执行权或已经停机／清理的实例均不得重新创建。
- 预览默认取 4 个原生 PNG 帧，也可指定 1–12 个互异秒数，范围为 `[0, durationSeconds - 1/30]`；导出执行原生完整工程，生成一部 MP4。多画幅分别创作和运行，不拉伸复用。
- 原生 CLI 会刷新运行时文件并可能生成音乐、修改 HTML 音频引用。回执分别记录输入 index 摘要、实际渲染 index 摘要与原清单摘要；导出还保存实际工程清单及全部可服务源文件，以便复现。

HTTP 请求按下表提交版本与渲染参数；Worker 从可信存储读取 NativeProject 与 release，形成 R2 中的 `native_render_request`。operation generation 由 D1 渲染记录和内部 `native_render_task` 绑定，不由客户端提交。清单先经预编译 Schema 与共享语义校验，再核对实际文件、画幅和 release；作品不能设置预算、存储权限、编码或付费动作。

导演沿素材分析 → 方向创作／真实预览 → 用户选择 → Treatment → 各画幅原生创作／修改与抽帧审阅 → 整片与独立冷审 → 候选提交推进。相互独立的素材分析及三方向预览按 `agent-policy.director.stageConcurrency` 最多各 2 路并行，结果仍按输入顺序存储，每项保持原有的稳定 Workflow step、模型 callId、工程 revision 与渲染 ID；其中方向的原生方法模板固定为**该方向**的语言。失败后等待已派出的工作结束，才终止本阶段，防止丢失正在发生的收费和渲染副作用。依赖前作的最难镜头、完成/修复、画幅重构和正式提交仍串行。这里的上限是单操作内的本地限流，**不是**供应商全局 RPM/TPM 或真实 Cloudflare 容量证明。

`RenderWorkflow` 负责读取、等待持久化容量准入、运行一次完整任务、核验回执及提交。`pipeline_render_admissions` 将排队记录与物理 `pipeline_attempts` 分开；CoordinatorDO 在全局／工作区限额内授予 generation/token 租约，Workflow 以事件唤醒，并按工作区最早任务公平准入。导演的渲染完成事件与**用户方向选择**均先持久化，再由 Queue 投递；失败终态通知与渲染失败状态同事务保存，不等待物理停机确认才写入；事件实际送达结果独立记录，定时 sweep 补发。完成事件只是唤醒信号：导演最多每 60 秒核查一次 D1 持久渲染终态；短暂读取故障保留未知状态并继续等待，不会重发模型或渲染，取消／明确失败仍立即终止；迟于操作期限的结果仍被拒绝。Queue、Workflow/Director 恢复、停机清理、非关键进度上报和 outbox 采用受限并发及远端调用超时；单次清理的 Workflow、Shard 和容量释放批次分别最多四路，单个卡住的请求不能挡住其他任务；超时仍按未知结果安全重试，不代表物理任务已停止。`GET operations/:id/recovery` 的停机探测最多四路并设三秒总期限，逾时结果为未知，重复的 attempt／费用 ID 只查询一次。

平台故障最多使用两个物理 attempt；只有上一 attempt 的实际停止、计算结算和租约释放均确认后，才允许另一个 attempt。Workflow 观察到的传输失败代码单独保存在 `pipeline_attempts.recovery_code`，供重放预检恢复；Shard 的 `result_json` 仍是更高优先级的执行诊断。若该诊断写入暂时不可用，必须再确认 Shard 无成功结果及全部停机／结算／租约屏障，才允许把缺失诊断归类为可重试失败，未知费用仍禁止重发。claim 前租约失效或预检读取暂时失败时，只有确认同一作用域没有物理执行或费用，才允许复用原 ticket 的剩余排队窗口；不消耗物理重试次数。排队过期不产生物理 attempt；取消和晚到事件受 generation/token 拦截。初始持久等待上限 15 分钟、单次预览／导出执行上限 3／10 分钟，单个渲染总上限 30／45 分钟（含排队、重试及验证）；内部评估值尚未经过真实云端标定，不能当作客户 SLA。

初始执行上限为全局 4 个容器、每工作区 1 个，`standard-3`，原生渲染并发由容器固定为 1。这些是止损与容量上限，尚不是已测出的性能承诺。已付交付容量保护和资源分档属于客户账本接入后的工作，当前 `internal_eval` 仅实现公平的内部任务准入。

独立素材／方向的某项失败后，同阶段其他已发出的模型及渲染工作仍要完成结算与回执；但不能再发起纠错模型、保存新候选或提交新预览。阶段中途失效也在模型真正传输前、渲染请求写入 D1 前再次确认。相同资源与预览字节的素材分析只派发一次模型调用，其他重复输入复用结果并保留原始位置；不同图片不能混用。批量停止 Workflow 时，逐项写入 `native_stop_confirmed_at`，Queue 重试只检查未确认的原生停机；物理任务、费用、租约和渲染终态全部清理成功后才写 `reconciled_at`。定时恢复按终态操作去重，避免多个 Workflow 同时重复清理同一操作。

## 隔离与回执

原生代码与客户创作代码不在 Worker 求值。容器内的可信 controller 接收已核对的文件清单、持有仅本任务有效的 broker token；原生 Node/Chromium 以另一 UID 运行，不持有业务凭据。容器关闭 Internet。broker 只允许读取本次清单列出的 R2 key，并写入 `renders/<renderId>/attempts/<attemptId>/out/`。执行前再次检查工程清单中的素材授权；Broker 每次读取素材前也核查授权，最终发布前再次校验，D1 成片提交与 `revoked_at` 校验在同一 SQL 更新中完成，避免并发撤销后发布。原生工程的直接保存 API 和导演改稿均自动继承父 revision 的授权资源，拒绝同一授权身份的冲突元数据；导演的最终候选提交也在同一 D1 更新中校验所有结果工程的素材授权，包括从父 revision 继承、但当前改稿请求未重复列出的资源。

成功响应须同时具备完整 R2 对象、匹配的 native commit/工程 hash、无页面错误，以及存储中的 JSON 回执。预览检查全部指定 PNG 的尺寸与帧时刻；导出检查实际 ffprobe 的编码、尺寸、30 fps、15/30 秒及 450/900 帧，并核对实际工程清单。报告和全部输出写入 R2、字节身份匹配且 operation generation 仍有效后才原子提交。审片另使用最终 MP4 解码的 4 帧 PNG 和 2×2 JPEG 拼图；页面截图不能冒充编码结果。模型冷审基于该抽样，负责人正常速度视听另行验收；抽样通过不代表全片质量通过。

取消先提高 operation generation，再通过 outbox 停止原生 Workflow 和实际容器；未知或已完成操作不能返回虚假的「取消中」。即使超时、RPC 丢失或平台查询不可用，也不把计算视为已经停止。Workflow 执行权的条件领取与状态更新是同一条 D1 更新，拒绝重复启动时不会抹掉既有终态与 reconciliation 证据。已结束的 Shard 协程单独持久记录，清理失败不丢失终结证据；未确认费用继续占用原预留，不写成 0，不自动重发模型。模型前置核查可能耗时，实际费用预留前及派发前须重查请求截止时间；派发标记的共享账本写入返回后，还要重查操作代际、期限和负责人授权有效期。确知尚未发送的模型请求撤销派发标记，两层费用预留均结为零；不把不确定的已派发费用冒充零。若供应商 SSE 在最终完成标记前失败，期间报告的部分 token 用量仅作为待核查证据，不以它结算最终费用或重新派发；传输清理错误不得覆盖原始解析／网络错误。费用预留和内部操作创建按完整身份进行并发幂等校验。容器传入 SHA-256 和字节数，Broker 限长流式写入 R2，使用 `FixedLengthStream` 保持 Cloudflare R2 所需的运行时已知长度，由 R2 验证 SHA-256；上传完成复核对象大小、摘要元数据及可用的 R2 校验值，竞争写入只能确认实际保存的相同字节。不同摘要不得冒充同一对象；代际撤销后暂存对象不可提交。SSE 进度流对慢读者设置缓冲上限与连接数上限；失败／取消时先推送已提交的终态再清理，乱序或旧 generation 的提示不能覆盖终态，连异步缓存写入期间迟到的旧提示也会被终态屏障拦截；断开后包括已完成操作均可重新订阅 D1 终态快照。

历史模型响应的复用只查真正完成并拥有不可变供应商回执的调用：已经确认 `not_dispatched` 的零费用结算不视作模型结果，允许其他操作首次派发相同请求；真实零费用的已派发调用若缺失回执仍然阻止重发。

## 部署标识与账本

迁移 `0004_native_projects.sql` 引入原生 revision 表和 `engine` 审计标记；`0005_render_admissions.sql` 添加独立排队记录和排队／单任务总期限；`0006_workflow_stop_checkpoints.sql` 分离原生停机证据与完整清理完成状态；`0007_recovery_query_indexes.sql` 用实际查询计划验证待恢复 Workflow、活跃操作、待渲染任务、未停止计算及 outbox 的索引，不改写历史费用或成片记录。旧行不会在新引擎重放，恢复只处理 `huashu`。现有 D1/R2/账本和未知用量按原始身份保存，不提供旧协议的创作或读取接口。

`SHARDS` / `ShardDO` 是 Cloudflare 已登记的 Durable Object 绑定/类名，**目前承载的是完整 native job**，不能仅凭名称删除。更名须单独规划 DO 迁移，确保执行中的真实容器和费用可结算。旧 `shard_index` 只存在于已应用的数据库迁移/历史行，当前任务与 API 不使用它。

共享 `MODEL_LEDGER`、模型预留与不可变结算规则仍有效；删除旧执行代码不会重置授权或把未知费用算成零。

## 内部 API

所有下列路径都位于 `/internal/s1/`，需要 staging 内部 Bearer key。

| 方法与路径 | 用途 |
| --- | --- |
| `POST operations` | 建立 evaluation/calibration 操作及硬预算 |
| `PUT objects/evals/...` | 流式上传不可变工程文件；必须给 `Content-Length`、`X-Content-SHA256`（64 位小写 hex），R2 校验后回执 |
| `POST native/projects` | 以 `operationId, composition, files, resources?, baseRevision?` 保存工程 |
| `GET operations/:id/projects/:revision` | 在相同 workspace/project 范围读取工程清单 |
| `POST renders` | 以 `operationId, renderId, revisionId, mode, rendererRelease, runtimeVersion?, frames?` 创建 native job |
| `GET renders/:id` | 读取实际渲染状态和结果 |
| `POST creative` | 以 `operationId, contextKey` 启动导演；上下文中的 baseRevision/baseRevisions 指定改稿来源 |
| `GET operations/:id` | 方向、预览、选择和 Workflow 状态 |
| `POST operations/:id/direction` | 提交所见 `directionsHash` 与 `key: fit/amplify/unexpected` |
| `GET operations/:id/candidate` | 读取实际已成功提交的候选 |
| `GET operations/:id/review-draft` | 内部查看审核未通过而保留的草稿 |
| `GET artifacts/:key` | 读取当前 generation 有权访问的私有结果 |
| `GET operations/:id/events` | 短连接 SSE 进度 |
| `POST operations/:id/cancel` | generation fence 与持久清理 |
| `GET operations/:id/recovery` | Workflow、实际停止状态、已结与未知费用 |
| `POST operations/:id/reconcile` | 清理已终止操作，不重启创作 |
| `GET capacity`、`GET model-budget` | 容量返回 `{leases, queued, oldestWaitMs}`，供内部检查运行中与排队任务；另可只读共享账本 |
| `POST releases`、`GET releases/:id` | 登记或读取固定容器镜像摘要与原生 runtime commit |

注册 release 时 `runtimeVersion` 必须为固定 huashu commit；不提供旧 `/studio`、`/frames` 等入口。公开 `/healthz` 返回 `nativeProjectSchema: "1.0.0"`、`runtime: "huashu-motion"` 和原生 commit；**产品 PRD 协议 3.0.0 与内部文件清单 1.0.0 是不同版本域**。

## 构建、验证与部署

依赖、工具链和 Actions 入口见[08](../../docs/prd/08-codex-execution.md#3-代码责任与可复现工具链)。Worker 入口为 `src/index.ts`，容器构建见 [render-container](../render-container/README.md)。检查不自动部署或发起付费模型评测。

`test/native-control.test.mjs` 用 SQLite 事务和内存 R2 验证不可变版本、父 revision 授权继承、outbox、取消 fence、平台重试、Workflow 重复启动保护、**登记后丢失创建消息的补建与已领取执行权禁止重开**、授权撤销竞态、未知计算费用及迁移安全；`test/recovery-indexes.test.mjs` 验证迁移幂等性与实际查询计划；`test/native-api.test.mjs` 校验内部 HTTP 错误边界及预览音频授权撤销；`test/native-coordinator.test.mjs` 验证终态 SSE 重连、旧代际隔离与异步缓存竞态，`test/model-budget.test.mjs` 验证过期／已撤销请求不派发、未派发费用清算及不完整 SSE 用量待确认；`test/native-render-workflow.test.mjs` 注入执行前／执行后撤销，`test/native-director.test.mjs` 注入完成事件丢失；`test/native-broker.test.mjs` 覆盖流式写入、长度/SHA-256、并发身份与授权读取。媒体/进程隔离由容器检查。离线检查不构成真实云端、付费模型或客户功能验收。
