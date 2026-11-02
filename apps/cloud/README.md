# Cloudflare 原生控制面

Worker 负责操作、不可变 NativeProject 版本、模型预算、渲染调度、恢复与私有结果；完整 huashu-motion HTML/JS 工程是唯一影片源码，Worker 不执行作品代码。

代码提供 **`/internal/s1/` 内部评估 API**，仅在 `S1_ENABLED=internal_eval` 并配置 `EVAL_API_KEY` 后可用；生产配置为 `S1_ENABLED=off`。客户 Studio、认证、支付和正式交付还未接入。实际部署见[实施状态](../../docs/implementation-status.md)；`evals/` 是私有导入区。

## 工程与任务

- [NativeProject](../../packages/contracts/README.md)把原生文件的 key、SHA-256、大小、媒体类型与固定 runtime 绑定；先验真实 R2 字节，再保存不可变 revision。修改需显式 `baseRevision`，父版本必须属于同一 workspace/project；多画幅各有独立版本，不使用会覆盖其他画幅的全局 head。
- `createNativeRender` 在同一 D1 事务记录渲染及 outbox。预览默认四张原生 PNG，也可指定 1–12 个互异合法时刻（`0 ≤ t ≤ durationSeconds - 1/30`）；整片输出 15/30 秒 H.264/AAC MP4。原生 CLI 可能刷新 vendor/音频和 HTML：报告同时保留输入清单、输入源码及实际渲染工程的身份。
- 导演依次进行素材观察、可选的参考片证据分析、三方向原生预览、选择、Treatment、**权威 Script 与语义 Moments、素材候选锁定**、最难镜头、各画幅制作/改稿、成片与独立冷审、候选提交。Script 与锁定表由 Worker 验证后作为只读生产文件保留；改稿沿用未变更素材的原始 SHA 锁，视频帧包 Manifest 的授权 SHA 与原始视频文件 SHA 分别记录。逐词对齐证据仅为当前 revision 实际保留的声音/视频素材生成三字段 `timingEvidenceRef`，后续几何改稿继承有效证据；Script 实测旁白/对白必须匹配词区间及实际保留的源文件。替换音轨后不能沿用旧源的 measured 时钟。显式 Script 文本编辑保留稳定 ID，对实际修改转为 authored 时钟并使既有质量报告失效。独立素材与方向任务单操作最多两路并行（`agent-policy.director.stageConcurrency`），参考片观察最多一路；稳定的 Workflow step、callId 和 revision 保持幂等。一个并行任务失败，已派出的付费调用和渲染仍须收回回执，但不得追加新纠错或候选。
- 同一素材/预览字节只做一次模型观察；来源、授权及父 revision 的素材在读取、渲染和最终候选提交时重新检查。导演方向预览也检查独立传入音频的授权。
- 参考视频在请求的 `resources` 中使用既有 `webp-pack-v1` 帧包证据，并在 `references` 提供 `{resourceId,purpose,notes}`（最多三条）。源视频与帧包、帧时间、源 SHA 和可见画面逐项校验；帧间变化与声音不宣称已观察。参考片不会自动进入成片素材清单；如需实际使用该视频，需作为独立已授权制作素材提交。`scriptEdits` 可在基于版本的改稿中单独提交，字段为 `{segmentId,field,value}`；**素材替换**必须另行声明 `materialReplacements:[{fromResourceId,toResourceId}]` 并提交对应授权素材。已登记的备选项可升为主选；锁定表、Script Moment 引用和 HTML/JS/CSS/SVG/JSON 原生素材路径必须一致，未选候选不代表可擅自替换。基础 Script 的 CTA/事实先对基础 Brief 验证，改稿后的 Script 再对新 Brief 验证。独立冷审的两张成片图／画幅费用在昂贵步骤之前预算预检。

## 准入、取消与恢复

- `pipeline_render_admissions` 管排队，`pipeline_attempts` 记录真正物理执行。CoordinatorDO 依 generation/lease token 限制全局 **4** 个容器、每 workspace **1** 个；初始使用 `standard-3`，容器内仅一个渲染 worker。按工作区最早待处理任务公平准入，不代表供应商全局限流或实测吞吐。
- Queue/outbox 消息、方向选择和渲染完成事件先持久化再发送；通知失败由定时任务补发，Director 以 D1 最终状态判定结果，不能只凭事件或超时重做任务。未注册 Workflow 的任务在超过五分钟后可补派发；已登记但尚未创建、未领取执行权的实例可补做**首次**创建。已创建、领取执行权、停机或完成清理的实例绝不重开。
- 初始排队最多 **15 分钟**；单次预览/导出执行最多 **3/10 分钟**；一次渲染含排队与重试最多 **30/45 分钟**。平台故障最多两个物理 attempt，重试前必须确认上一 attempt 已物理停止、结算计算并释放租约。期限与数量只是当前内部止损配置，不是客户 SLA。
- 取消先递增 operation generation，再停 Workflow、Shard 和实际容器。Workflow 原生停机逐项写 `native_stop_confirmed_at`；计算/租约/渲染全部清理成功才写 `reconciled_at`。未知状态不等于停止；批量操作使用有限并行与远端超时，恢复扫描不会因单个失联任务停滞。只读 `GET operations/:id/recovery` 的物理探测最多四路、共三秒；逾时保持未知。
- 模型调用使用本地与共享预算，发送前重查期限、授权和代际。确知未发送的请求可按证据零结算；发送结果不确定、SSE 缺最终标记或部分 token usage 仍保留预留和原始回执，不补零、不自动重发。只有确实完成且有不可变供应商回执的结果才可复用；未派发的零结算不当作缓存结果。

## 隔离、结果与持久数据

- 容器可信 controller 持有任务专用 Broker token；原生 Node/Chromium 使用不同 UID、无业务密钥、无公网。Broker 只读清单列出的 R2 对象，正常交付只写 `renders/<renderId>/attempts/<attemptId>/out/`；另仅允许同 attempt 的 `failed/film.mp4` 和 `failed/qa.json` 私有技术阻断诊断写入，绝不放入通过结果的 `outputs`。执行前、每次素材读和最终 D1 提交均核查授权撤销。
- 入口 `PUT objects/evals/...` 要求准确 `Content-Length` 与 SHA-256；按流校验、用 `FixedLengthStream` 写 R2，核对对象字节身份。结果须具备完整 R2 文件、原生工程 hash、实际编码及错误检查；导出验证 30 fps、15/30 秒、450/900 帧、H.264/AAC 和最终 MP4 的解码审片帧、12 帧时间线拼图与全片 FFmpeg 技术检测。FFmpeg 严格解码并检查即使返回零退出码仍出现的 H.264 错误日志；黑屏、冻结、长静音为需要人工复核的信号；响度缺测或越限直接阻断并留存 SHA 绑定的私有失败影片与 QA 报告，负责人正常速度视听始终为 `pending`。
- 内部 JSON 响应禁止缓存；错误输入为 422、身份冲突为 409、暂时无法确认的远端控制为 503、非业务异常为 500，不暴露原始运行时信息。SSE 进度可在终态后重连，迟到旧代际事件不能覆盖 D1 终态。
- 迁移 `0004`–`0007` 分别管理原生 revision、独立准入、Workflow 停机检查点及经查询计划验证的恢复索引。历史 D1/R2、真实素材、权利、费用和未知用量原样保留；旧执行协议不在新引擎重放。现有 `ShardDO` 绑定承载完整原生任务，更名需单独迁移，不能按名字删除。

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

公开 `GET /healthz` 返回原生 runtime、commit 和内部 NativeProject schema `1.0.0`；**产品协议是独立的 3.0.0**。旧 `/studio`、`/frames` 等接口不存在。

## 验证

`pnpm test` 覆盖契约、队列/准入、Workflow 恢复、租约、素材撤权、模型账本、SSE 和非浏览器素材入库测试；`pnpm run typecheck` 校验 Worker 类型。真正的 Chromium/FFmpeg、素材栅格化/视频采样和四画幅导出由 [固定容器 CI](../render-container/README.md#验证与部署)运行。测试不会自动部署或发起付费模型；结果与实际验收范围见[实施状态](../../docs/implementation-status.md)。
