# Cloudflare Core

Worker 负责操作、不可变 NativeProject 版本、模型预算、渲染调度、恢复与私有结果；完整 huashu-motion HTML/JS 工程是唯一影片源码，Worker 不执行作品代码。

Core 保留 **`/internal/s1/` 内部评估 API**，仅在 `S1_ENABLED=internal_eval` 并配置 `EVAL_API_KEY` 后可用；生产配置为 `S1_ENABLED=off`。SaaS 命名入口、断言批写和本地多 Worker 测试台已实现；客户 Studio、认证、支付和正式交付还未接入。实际部署见[实施状态](../../docs/implementation-status.md)；`evals/` 是私有导入区。

## SaaS 基础设施

| 入口 | 调用方 | 当前行为 |
| --- | --- | --- |
| `CoreApi.fetch` | [Web Worker](../web/README.md) 的 `CORE_API` | 只分派已实现的 `kind=api` 路由，不调用默认内部评测入口 |
| `PreviewGateway.fetch` | [Preview Worker](../preview/README.md) 的 `PREVIEW_GATEWAY` | 所有资源返回 404；能力令牌和 manifest 文件授权随预览阶段实现 |
| 默认 `fetch` | 内部评测客户端 | 保留 `/healthz` 和受密钥保护的 `/internal/s1/*` |

[routes.json](../../config/routes.json) 是产品路由计划；[implemented-routes.json](../../config/implemented-routes.json) 才是已实现清单，目前 `api` 为空。新增客户 API 时同时修改清单、[业务注册表](src/api-registry.ts) 和 `contracts/api/<routeId>.schema.json`，Schema 须有 `$defs.request`、`$defs.response`。[仓库检查](../../scripts/check-saas-foundation.mjs)核对三者一致，禁止只登记路径便开放未实现功能。已实现路径的方法不符返回 405；未知或未实现路径返回 404，错误结构来自[共享契约](../../packages/contracts/README.md#客户-http-契约)。

Core 是业务 D1 的唯一写入方。Web 以流转交 Cookie、Origin、CSRF、客户端业务 `requestId`/`Idempotency-Key` 和原始上传/webhook 字节；`x-request-id` 是单独的追踪关联 ID（`ApiContext.correlationId`），不能当幂等键。Core 自行解析身份与权限，不接受调用者自报的用户、角色或工作区。当前没有登录或付款 handler，这些规则还须在各业务模块实现时验证。

### 带断言的批写

[guardedBatch](src/shared/guarded-batch.ts) 将幂等结果、SQL 前提、业务修改和 outbox 放在一次 D1 batch 中。`assertSql(code, condition, bindings, status)` 将 false/NULL 变成带原因的前提失败；`writeSql(sql, bindings, {expectedChanges, code, status})` 紧接着核验修改行数，条件 UPDATE 修改零行也会回滚整批。`status` 仅允许 404/409/422，默认 409；普通 SQL 约束错误不会被冒充成业务前提失败。调用者仍须在重放前检查当前权限，并将提交时所需的权限、版本、删除状态和余额条件写入 SQL 断言；外部副作用通过持久 outbox 执行。

幂等身份由可信处理器解析出的 workspace/project/actor/route、**路由参数**和业务 `requestId` 组成，请求正文摘要单独保存。创建作用域时必须提供 `routeParams`（无参数则 `{}`），不能使用追踪 ID。同一身份换正文报 409；重放返回已保存的原结果。预读及失败后的确认读都用 `withSession('first-primary')`：主键冲突或提交确认丢失时，只有匹配的结果行才能证明成功。找不到结果保留原错误，读回失败返回可重试的 503 `OUTCOME_UNKNOWN`；工具不会自动再执行 batch。类型化前提错误带受控 `reason`，分别映射 404/409/422。

[0008 迁移](migrations/0008_saas_guarded_batches.sql)只新增无存储行的断言 view/trigger 和幂等结果表，不建立客户项目、额度或支付业务表，也不修改已有 S1 数据。首次客户业务模块须根据 PRD 04 §6 加入幂等结果的保存期限、清理索引/任务及删除处理；当前无客户数据，不提前清理。

## 工程与任务

- [NativeProject](../../packages/contracts/README.md)把原生文件的 key、SHA-256、大小、媒体类型与固定 runtime 绑定；先验真实 R2 字节，再保存不可变 revision。修改需显式 `baseRevision`，父版本必须属于同一 workspace/project；多画幅各有独立版本，不使用会覆盖其他画幅的全局 head。
- `createNativeRender` 在同一 D1 事务记录渲染及 outbox。预览默认四张原生 PNG，也可指定 1–12 个互异合法时刻（`0 ≤ t ≤ durationSeconds - 1/30`）；整片输出 15/30 秒 H.264/AAC MP4。原生 CLI 可能刷新 vendor/音频和 HTML：报告同时保留输入清单、输入源码及实际渲染工程的身份。
- 导演首次创作流程为素材/参考观察 → 三方向预览 → 用户选择方向 → Treatment 与正式 Script → 选择并锁定素材 → 最难镜头 → 各画幅创作 → 成片与冷审。当前尚不支持跳过方向选择直接制作。Worker 校验生产文档和素材锁；改稿基于已有版本复用未变资源。独立素材与方向阶段最多两路并行，参考片观察一路；失败后收集已派发的费用与渲染回执，不再追加付费步骤。
- 同一素材/预览字节只做一次模型观察；来源、授权及父 revision 的素材在读取、渲染和最终候选提交时重新检查。导演方向预览也检查独立传入音频的授权。
- 参考视频通过 `resources` 中的 `webp-pack-v1` 帧包和最多三条 `references:{resourceId,purpose,notes}` 传入；核对源视频、抽帧和 SHA，现阶段只观察实际取到的画面。参考片若要成为成片素材须另获授权。`scriptEdits:[{segmentId,field,value}]` 更新正式台词；`materialReplacements:[{fromResourceId,toResourceId}]` 显式更换素材，旧词时间证据随源音频变化失效。素材及配音同时绑定 ID 和原始 SHA，锁文件、Script 引用和实际源码路径必须一致。需要清空测量证据时提交 `timingEvidenceRef:null`，省略字段则沿用父版本。

改稿先核对全部目标的画幅、片长、当前素材锁和文件容量。作者可删减旧源码；返回后按实际源码和生产文档验算文件数与字节，空 `index.html` 进入纠错，超限结果不进入缓存。

## 准入、取消与恢复

- `pipeline_render_admissions` 管排队，`pipeline_attempts` 记录真正物理执行。CoordinatorDO 依 generation/lease token 限制全局 **4** 个容器、每 workspace **1** 个；初始使用 `standard-3`，容器内仅一个渲染 worker。按工作区最早待处理任务公平准入，不代表供应商全局限流或实测吞吐。
- Queue/outbox 消息、方向选择和渲染完成事件先持久化再发送；通知失败由定时任务补发，Director 以 D1 最终状态判定结果，不能只凭事件或超时重做任务。未注册 Workflow 的任务在超过五分钟后可补派发；已登记但尚未创建、未领取执行权的实例可补做**首次**创建。已创建、领取执行权、停机或完成清理的实例绝不重开。
- 并发启动同一导演操作时，只确认事务实际保存的上下文；不同 `contextKey` 返回身份冲突。取消或失败已生效的操作不能在迟到请求中新增导演上下文或派发消息。
- 初始排队最多 **15 分钟**；单次预览/导出执行最多 **3/10 分钟**；一次渲染含排队与重试最多 **30/45 分钟**。平台故障最多两个物理 attempt，重试前必须确认上一 attempt 已物理停止、结算计算并释放租约。期限与数量只是当前内部止损配置，不是客户 SLA。
- 取消先递增 operation generation，再停 Workflow、Shard 和实际容器。Workflow 原生停机逐项写 `native_stop_confirmed_at`；计算/租约/渲染全部清理成功才写 `reconciled_at`。未知状态不等于停止；批量操作使用有限并行与远端超时，恢复扫描不会因单个失联任务停滞。只读 `GET operations/:id/recovery` 的物理探测最多四路、共三秒；逾时保持未知。
- 模型受单调用、阶段、operation 与跨环境共享费用上限约束。先原子预留最高可能费用；缺少最终 usage、缓存写入计价信息或终态 SSE 时保留未知预留，不自动重发。确认未派发的调用才可释放预留；已完成却未结算的调用按原始流 SHA、冻结价格和 callId 恢复，不重新调用或重算旧价。授权过期后仍可补账和读取已结算缓存，但不可发起新付费请求。细节见[模型适配](../../packages/models/README.md)。

## 隔离、结果与持久数据

- 容器可信 controller 持有任务专用 Broker token；原生 Node/Chromium 使用不同 UID、无业务密钥、无公网。Broker 只读清单列出的 R2 对象，正常交付只写 `renders/<renderId>/attempts/<attemptId>/out/`；另仅允许同 attempt 的 `failed/film.mp4` 和 `failed/qa.json` 私有技术阻断诊断写入，绝不放入通过结果的 `outputs`。执行前、每次素材读和最终 D1 提交均核查授权撤销。
- `PUT objects/evals/...` 按流校验准确长度与 SHA-256，重复写入还须匹配已存 Content-Type；R2 文件身份同时包含长度、摘要和媒体类型。导出验证 30 fps、450/900 帧、H.264/AAC、全片严格解码和黑屏/静止/静音及响度，生成四张审片帧和十二帧时间线图。技术阻断时保留私有失败影片及 QA 报告；负责人正常速度试听仍需单独完成。
- 内部 JSON 响应禁止缓存；错误输入为 422、身份冲突为 409、暂时无法确认的远端控制为 503、非业务异常为 500，不暴露原始运行时信息。SSE 进度可在终态后重连，迟到旧代际事件不能覆盖 D1 终态。
- 迁移 `0004`–`0007` 包含原生 revision、准入、Workflow 停机检查点和恢复索引。`ShardDO` 当前仍承载原生任务；变更绑定前须处理真实状态和数据。

## 内部 API

下列路径均以 `/internal/s1/` 为前缀，须携带内部 Bearer key；没有客户租户授权语义。

| 方法与路径 | 用途 |
| --- | --- |
| `POST operations` | 建立 evaluation/calibration 操作及硬预算 |
| `POST rights` | 以原始证据绑定资源授权，拒绝撤权后的重复授权 |
| `PUT objects/evals/...` | 不可变 R2 文件流式入库，校验长度和 SHA-256 |
| `POST native/projects`；`GET operations/:id/projects/:revision` | 保存/读取不可变原生工程 |
| `POST renders`；`GET renders/:id` | 创建预览或导出、查询结果 |
| `POST creative`；`POST operations/:id/direction` | 启动导演，按已看到的 `directionsHash` 选择方向 |
| `GET operations/:id`；`GET operations/:id/candidate` | 方向与进度、已通过候选 |
| `GET operations/:id/review-draft`；`GET artifacts/:key` | 内部失败草稿及授权后的私有文件 |
| `GET operations/:id/events` | 有界 SSE 进度 |
| `POST operations/:id/cancel`；`POST operations/:id/reconcile` | 取消、清理已终止操作 |
| `GET operations/:id/recovery`；`POST workflows/reconcile` | 只读恢复诊断、批量恢复扫描 |
| `GET capacity` | 实际租约、排队数量及最老等待时间 |
| `GET model-budget`；`POST model-budget/import`；`POST model-budget/confirm` | 共享费用状态及基于负责人证据的历史开账/确认 |
| `POST releases`；`GET releases/:id` | 固定镜像摘要与原生 runtime 标识 |

公开 `GET /healthz` 返回原生 runtime、commit 和内部 NativeProject schema `1.0.0`；产品协议另为 `3.0.0`。

## 验证

`pnpm run test:saas-local` 构建验证器和 Web，再运行路由/注册契约、网关、断言批写与多 Worker 测试。[测试台](test/fixtures/multi-worker.mjs)在真实本地 workerd 中连接 Web → CoreApi、Preview → PreviewGateway，只有 Core 绑定 D1；还验证 SSR/静态资源、流式转发、Cookie、错误和内部路径隔离。外网请求关闭，每次运行使用独立临时数据库，结束后清理。

[断言批写测试](test/guarded-batch.test.mjs)的 T0–T7 使用本地 D1 和测试业务表：

| 用例 | 验证 |
| --- | --- |
| T0 | 业务记录、outbox、规范化结果一起提交 |
| T1 | false/NULL 断言和零行条件写回滚整批，准确返回原因和 404/409/422 |
| T2 | 多个请求竞争最后一份额度，只产生一项作业和 outbox |
| T3 | 重放、并发主键冲突、提交确认丢失复用原结果；读回失败不重发 |
| T4 | 同一身份换正文冲突；工作区、项目、用户、路由及路径参数作用域彼此独立 |
| T5 | 同版本并发冻结只成功一次；删除后拒绝迟到冻结 |
| T6 | outbox 写入失败回滚前面的预留、作业和结果 |
| T7 | 同一付款观察使用不同 requestId 重复到达，也不能重复授予权益 |

这些测试验证通用事务工具，客户额度、冻结和付款业务尚未实现。`pnpm test` 另外覆盖原有队列/准入、Workflow 恢复、租约、素材撤权、模型账本、SSE 等测试；`pnpm run typecheck` 检查三个 Worker。真正的 Chromium/FFmpeg、素材栅格化/视频采样和四画幅导出由 [固定容器 CI](../render-container/README.md#验证与部署)运行。测试不会自动部署或发起付费模型。

## 本地配置与部署

[.dev.vars.example](.dev.vars.example) 给出本地安全默认值；SaaS 基础测试不需要外部凭据。仅在另行授权的内部评测中填写所需密钥，Web 和 Preview 不接收这些密钥。

[手动 staging 工作流](../../.github/workflows/cloud-deploy.yml)仅从 `main` 启动，构建 Web、应用迁移后依次部署 Core → Preview → Web。Web/Preview 尚未配置域名，`workers.dev` 和版本预览 URL 均关闭；Core 生产无公网入口，staging 保留受密钥保护的内部评测入口及 `/healthz`。配置受 Cloudflare Access 保护的两个独立 staging route 后，在 GitHub `staging` 环境设置 `STAGING_WEB_URL`、`STAGING_PREVIEW_URL`（Variables）和可选的 `CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`（Secrets），部署会进行只读 SSR/API/Preview 探测。未配置时会明确跳过；探测不能代替真实 Core 服务绑定或 staging D1 并发验收，后者须用专用测试入口和隔离 D1 执行。

[Wrangler 配置](wrangler.jsonc)将 staging DO 代码更新设为 `deferred`、最多 900 秒，覆盖目前 600 秒导出 attempt 与 45 秒启动上限；仓库检查从 `nativeRenderPolicy` 推导下限，并在生产启用 DO 时一并校验。生产尚无 DO 绑定。延迟只减少部署中断，平台仍可能提前重启对象；恢复依赖已持久化的状态、租约、generation 和执行记录，相邻版本的内部调用必须互通。平台行为见 [Cloudflare 2026-10-30 更新说明](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/)。

下一次真实 G1a 按 [PRD 08](../../docs/prd/08-codex-execution.md)验证 staging 服务绑定、D1 并发、固定镜像渲染/取消/恢复及部署期间的在途任务；本地测试不代替该验收。
