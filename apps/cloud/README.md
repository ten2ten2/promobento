# Native huashu control plane

Cloudflare 保存操作、不可变工程版本、预算、任务状态与私有产物。影片只使用固定版本 huashu-motion 的 HTML 工程；每次预览或整片导出都是一个独立容器任务，没有 FilmSpec、分片合并或云端长期 Studio 执行入口。

本页是**主线内部 API**，受 `EVAL_API_KEY` 保护；原生代码尚未部署 staging，生产 `S1_ENABLED=off`。客户认证、资产 ACL、购买、冻结交付和 Studio 待实现。内部 `evals/` 导入区不得向租户开放；操作生成文件限定在 `operations/:id/`，跨操作复用须证明同工作区／项目的父 revision。实际验收见[实施状态](../../docs/implementation-status.md)。

## 工程与任务

共享文件清单见 [native-project](../../packages/contracts/src/native-project.mjs)。工程是 `index.html`、本地素材与运行时文件，清单固定原生运行时提交 `52467f99c602b76ba86d511d37acdfe93fa1e16e`，并记录 15/30 秒、30 fps 和目标画幅尺寸。它不定义镜头、积木或新的动画语言。

- `saveNativeProject` 先核对每个私有 R2 对象的大小与摘要，再保存规范化清单。revision 是清单 hash；旧版本永不覆盖。
- `baseRevision` 表示改稿来源。加载来源须匹配操作的 workspace/project；方向预览、不同画幅及改稿各有独立不可变分支，不用一个全局 head 覆盖其他画幅。
- `createNativeRender` 在同一 D1 batch 中记录渲染与 outbox。任务生成后立即尝试发送，定时 sweep 负责未发送项。
- 预览默认取 4 个原生 PNG 帧，也可指定 1–12 个互异秒数，范围为 `[0, durationSeconds - 1/30]`；导出执行原生完整工程，生成一部 MP4。多画幅分别创作和运行，不拉伸复用。
- 原生 CLI 会刷新运行时文件并可能生成音乐、修改 HTML 音频引用。回执分别记录输入 index 摘要、实际渲染 index 摘要与原清单摘要；导出还保存实际工程清单及全部可服务源文件，以便复现。

HTTP 请求按下表提交版本与渲染参数；Worker 从可信存储读取 NativeProject 与 release，形成 R2 中的 `native_render_request`。operation generation 由 D1 渲染记录和内部 `native_render_task` 绑定，不由客户端提交。清单先经预编译 Schema 与共享语义校验，再核对实际文件、画幅和 release；作品不能设置预算、存储权限、编码或付费动作。

`RenderWorkflow` 负责读取、等待持久化容量准入、运行一次完整任务、核验回执及提交。`pipeline_render_admissions` 将排队记录与物理 `pipeline_attempts` 分开；CoordinatorDO 在全局／工作区限额内授予 generation/token 租约，Workflow 以事件唤醒，并按工作区最早任务公平准入。导演的渲染完成事件与**用户方向选择**均先持久化，再由 Queue 投递；失败终态通知与渲染失败状态同事务保存，不等待物理停机确认才写入；事件实际送达结果独立记录，定时 sweep 补发。Queue、Workflow/Director 恢复、停机清理、非关键进度上报和 outbox 采用受限并发及远端调用超时，单个卡住的请求不能挡住其他任务；超时仍按未知结果安全重试，不代表物理任务已停止。

平台故障最多使用两个物理 attempt；只有上一 attempt 的实际停止、计算结算和租约释放均确认后，才允许另一个 attempt。Workflow 观察到的传输失败代码单独保存在 `pipeline_attempts.recovery_code`，供重放预检恢复；Shard 的 `result_json` 仍是更高优先级的执行诊断。若该诊断写入暂时不可用，必须再确认 Shard 无成功结果及全部停机／结算／租约屏障，才允许把缺失诊断归类为可重试失败，未知费用仍禁止重发。claim 前租约失效或预检读取暂时失败时，只有确认同一作用域没有物理执行或费用，才允许复用原 ticket 的剩余排队窗口；不消耗物理重试次数。排队过期不产生物理 attempt；取消和晚到事件受 generation/token 拦截。初始持久等待上限 15 分钟、单次预览／导出执行上限 3／10 分钟，单个渲染总上限 30／45 分钟（含排队、重试及验证）；内部评估值尚未经过真实云端标定，不能当作客户 SLA。

初始执行上限为全局 4 个容器、每工作区 1 个，`standard-3`，原生渲染并发由容器固定为 1。这些是止损与容量上限，尚不是已测出的性能承诺。已付交付容量保护和资源分档属于客户账本接入后的工作，当前 `internal_eval` 仅实现公平的内部任务准入。

## 隔离与回执

原生代码与客户创作代码不在 Worker 求值。容器内的可信 controller 接收已核对的文件清单、持有仅本任务有效的 broker token；原生 Node/Chromium 以另一 UID 运行，不持有业务凭据。容器关闭 Internet。broker 只允许读取本次清单列出的 R2 key，并写入 `renders/<renderId>/attempts/<attemptId>/out/`。

成功响应须同时具备完整 R2 对象、匹配的 native commit/工程 hash、无页面错误，以及存储中的 JSON 回执。预览检查全部指定 PNG 的尺寸与帧时刻；导出检查实际 ffprobe 的编码、尺寸、30 fps、15/30 秒及 450/900 帧，并核对实际工程清单。报告和全部输出写入 R2、字节身份匹配且 operation generation 仍有效后才原子提交。审片另使用最终 MP4 解码的 4 帧 PNG 和 2×2 JPEG 拼图；页面截图不能冒充编码结果。模型冷审基于该抽样，负责人正常速度视听另行验收；抽样通过不代表全片质量通过。

取消先提高 operation generation，再通过 outbox 停止原生 Workflow 和实际容器；未知或已完成操作不能返回虚假的「取消中」。即使超时、RPC 丢失或平台查询不可用，也不把计算视为已经停止。已结束的 Shard 协程单独持久记录，清理失败不丢失终结证据；未确认费用继续占用原预留，不写成 0，不自动重发模型。费用预留和内部操作创建按完整身份进行并发幂等校验。容器传入 SHA-256 和字节数，Broker 限长流式写入 R2，由 R2 验证 SHA-256；上传完成复核对象大小、摘要元数据及可用的 R2 校验值，竞争写入只能确认实际保存的相同字节。不同摘要不得冒充同一对象；代际撤销后暂存对象不可提交。SSE 进度流对慢读者设置缓冲上限与连接数上限，断开后可重新订阅最新进度。

## 部署标识与账本

迁移 `0004_native_projects.sql` 引入原生 revision 表和 `engine` 审计标记；`0005_render_admissions.sql` 添加独立排队记录和排队／单任务总期限，不修改历史费用或成片记录。旧行不会在新引擎重放，恢复只处理 `huashu`。现有 D1/R2/账本和未知用量按原始身份保存，不提供旧协议的创作或读取接口。

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
| `GET capacity`、`GET model-budget` | 只读当前租约、待准入任务数／最久等待和共享账本 |
| `POST releases`、`GET releases/:id` | 登记或读取固定容器镜像摘要与原生 runtime commit |

注册 release 时 `runtimeVersion` 必须为固定 huashu commit；不提供旧 `/studio`、`/frames` 等入口。公开 `/healthz` 返回 `nativeProjectSchema: "1.0.0"`、`runtime: "huashu-motion"` 和原生 commit；**产品 PRD 协议 3.0.0 与内部文件清单 1.0.0 是不同版本域**。

## 构建、验证与部署

依赖、工具链和 Actions 入口见[08](../../docs/prd/08-codex-execution.md#3-代码责任与可复现工具链)。Worker 入口为 `src/index.ts`，容器构建见 [render-container](../render-container/README.md)。检查不自动部署或发起付费模型评测。

`test/native-control.test.mjs` 用 SQLite 事务和内存 R2 验证不可变版本、outbox、取消 fence、平台重试、未知计算费用及迁移安全；`test/native-broker.test.mjs` 覆盖流式写入、长度/SHA-256 和竞争身份。媒体/进程隔离由容器检查。离线检查不构成真实云端、付费模型或客户功能验收。
