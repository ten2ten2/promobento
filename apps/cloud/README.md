# Cloudflare 原生控制面

Worker 负责操作、不可变 NativeProject 版本、模型预算、渲染调度、恢复与私有结果；完整 huashu-motion HTML/JS 工程是唯一影片源码，Worker 不执行作品代码。

代码提供 **`/internal/s1/` 内部评估 API**，仅在 `S1_ENABLED=internal_eval` 并配置 `EVAL_API_KEY` 后可用；生产配置为 `S1_ENABLED=off`。客户 Studio、认证、支付和正式交付还未接入。实际部署见[实施状态](../../docs/implementation-status.md)；`evals/` 是私有导入区。

## 工程与任务

- [NativeProject](../../packages/contracts/README.md)把原生文件的 key、SHA-256、大小、媒体类型与固定 runtime 绑定；先验真实 R2 字节，再保存不可变 revision。修改需显式 `baseRevision`，父版本必须属于同一 workspace/project；多画幅各有独立版本，不使用会覆盖其他画幅的全局 head。
- `createNativeRender` 在同一 D1 事务记录渲染及 outbox。预览默认四张原生 PNG，也可指定 1–12 个互异合法时刻（`0 ≤ t ≤ durationSeconds - 1/30`）；整片输出 15/30 秒 H.264/AAC MP4。原生 CLI 可能刷新 vendor/音频和 HTML：报告同时保留输入清单、输入源码及实际渲染工程的身份。
- 导演流程为素材/参考观察 → 三方向预览或直接制作 → Treatment 与正式 Script → 选择并锁定素材 → 最难镜头 → 各画幅创作/改稿 → 成片与冷审。Worker 校验生产文档和素材锁；改稿复用未变资源。独立素材与方向阶段最多两路并行，参考片观察一路；失败后收集已派发的费用与渲染回执，不再追加付费步骤。
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

`pnpm test` 覆盖契约、队列/准入、Workflow 恢复、租约、素材撤权、模型账本、SSE 和非浏览器素材入库测试；`pnpm run typecheck` 校验 Worker 类型。真正的 Chromium/FFmpeg、素材栅格化/视频采样和四画幅导出由 [固定容器 CI](../render-container/README.md#验证与部署)运行。测试不会自动部署或发起付费模型；结果与实际验收范围见[实施状态](../../docs/implementation-status.md)。
