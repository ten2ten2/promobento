# Native huashu control plane

Cloudflare 保存操作、不可变工程版本、预算、任务状态与私有产物。影片直接使用固定版本 huashu-motion 的 HTML 工程；每个画幅的预览或整片导出是一个容器任务。原来的 FilmSpec、PB.scene、跨容器分片、接缝合并和自建长期 Studio 执行入口已移除。

当前仅提供受 `EVAL_API_KEY` 保护的内部 staging API。生产 `S1_ENABLED=off`，客户认证、工作区权限、购买、冻结交付和客户 Studio 仍由[实施状态](../../docs/implementation-status.md)说明；这些内部接口不代替客户业务 API。管理 token 能访问内部共享的 `evals/` 导入区；当前操作生成的文件限定在自己的 `operations/:id/`，跨操作复用须绑定同工作区／项目的父 revision。客户上传的资产 ACL 仍须在客户控制面接入时实现，不能把这个内部导入区开放给租户。

## 工程与任务

共享文件清单见 [native-project](../../packages/contracts/src/native-project.mjs)。工程是 `index.html`、本地素材与运行时文件，清单固定原生运行时提交 `52467f99c602b76ba86d511d37acdfe93fa1e16e`，并记录 15/30 秒、30 fps 和目标画幅尺寸。它不定义镜头、积木或新的动画语言。

- `saveNativeProject` 先核对每个私有 R2 对象的大小与摘要，再保存规范化清单。revision 是清单 hash；旧版本永不覆盖。
- `baseRevision` 表示改稿来源。加载来源须匹配操作的 workspace/project；方向预览、不同画幅及改稿各有独立不可变分支，不用一个全局 head 覆盖其他画幅。
- `createNativeRender` 在同一 D1 batch 中记录渲染与 outbox。任务生成后立即尝试发送，定时 sweep 负责未发送项。
- 预览默认取 4 个原生 PNG 帧，也可明确指定 1–12 个时间点；导出直接执行原生完整工程，生成一部 MP4。多画幅分别创作和运行，不拉伸复用。
- 原生 CLI 会刷新运行时文件并可能生成音乐、修改 HTML 音频引用。回执分别记录输入 index 摘要、实际渲染 index 摘要与原清单摘要；导出还保存实际工程清单及全部可服务源文件，以便复现。

`RenderWorkflow` 只负责读取、准入、运行一次整片任务、核验回执及提交。平台故障最多使用两个物理 attempt；只有上一 attempt 的实际停止和计算结算均确认后，才允许另一个 attempt。原期限、操作 generation、累计预算均不重置。

初始执行上限为全局 4 个容器、每工作区 1 个，`standard-3`，预览 3 分钟、导出 10 分钟，原生渲染并发由容器固定为 1。这些是止损与容量上限，尚不是已测出的性能承诺。

## 隔离与回执

原生代码与客户创作代码不在 Worker 求值。容器内的可信 controller 接收已核对的文件清单、持有仅本任务有效的 broker token；原生 Node/Chromium 以另一 UID 运行，不持有业务凭据。容器关闭 Internet。broker 只允许读取本次清单列出的 R2 key，并写入 `renders/<renderId>/attempts/<attemptId>/out/`。

成功响应须同时具备完整 R2 对象、匹配的 native commit/工程 hash、无页面错误，以及存储中的 JSON 回执。预览检查全部指定 PNG 的尺寸；导出检查实际 ffprobe 的编码、尺寸、30 fps、15/30 秒及 450/900 帧，并核对实际工程清单。最终审片另使用从实际 MP4 解码的 4 帧 PNG 和 2×2 JPEG 拼图，不拿页面截图冒充编码结果。模型审片和负责人正常速度视听仍单独进行；4 帧抽样不等于完整影片质量验收。

取消先提高 operation generation，再通过 outbox 停止原生 Workflow 和实际容器。即使超时、RPC 丢失或平台查询不可用，也不把计算视为已经停止。未确认费用继续占用原预留，不写成 0，不自动重发模型。

## 数据与兼容边界

应用迁移 `0004_native_projects.sql` 新增原生工程版本表，以及 Workflow/context 的 engine 标记。旧行默认为 `legacy`；新任务标记 `huashu`，自动恢复只处理新任务。旧业务、账本、费用回执、已通过影片与 R2 文件保持原样。旧原生平台实例不通过新渲染器重放。

`SHARDS` / `ShardDO` 仅保留已部署 Durable Object 的名称及持久状态身份，让旧容器的 stop/cost 句柄仍可查询和清理；新执行能力只有完整 native job。`closeStudio` 是历史句柄的清理函数，没有创建、取帧或运行旧 Studio 的入口。旧的 `shard_index` 数据列只用于保留和读取历史记录，新 attempt 不填写它。

共享 `MODEL_LEDGER`、`model-budget.ts` 与 `store.reserve/settle` 延续原预留与不可变结算规则。新开发不会重新创建授权、补零历史用量或提高费用额度。

## 内部 API

所有下列路径都位于 `/internal/s1/`，需要 staging 内部 Bearer key。

| 方法与路径 | 用途 |
| --- | --- |
| `POST operations` | 建立 evaluation/calibration 操作及硬预算 |
| `PUT objects/evals/...` | 上传一个不可变、摘要绑定的工程文件或上下文 |
| `POST native/projects` | 以 `operationId, composition, files, resources?, baseRevision?` 保存工程 |
| `GET operations/:id/projects/:revision` | 在相同 workspace/project 范围读取工程清单 |
| `POST renders` | 以 `operationId, renderId, revisionId, mode, rendererRelease, frames?` 创建 native job |
| `GET renders/:id` | 读取实际渲染状态和结果 |
| `POST creative` | 对上下文启动导演；改稿由上下文的 baseRevision/baseRevisions 指定 |
| `GET operations/:id` | 方向、预览、选择和 Workflow 状态 |
| `POST operations/:id/direction` | 提交方向 hash 与 fit/amplify/unexpected 选择 |
| `GET operations/:id/candidate` | 读取实际已成功提交的候选 |
| `GET operations/:id/review-draft` | 内部查看审核未通过而保留的草稿 |
| `GET artifacts/:key` | 读取当前 generation 有权访问的私有结果 |
| `GET operations/:id/events` | 短连接 SSE 进度 |
| `POST operations/:id/cancel` | generation fence 与持久清理 |
| `GET operations/:id/recovery` | Workflow、实际停止状态、已结与未知费用 |
| `POST operations/:id/reconcile` | 清理已终止操作，不重启创作 |
| `GET capacity`、`GET model-budget` | 只读容量与共享账本 |
| `GET/POST releases` | 固定实际容器镜像摘要与原生 runtime commit |

注册新 release 时，`runtimeVersion` 必须为固定 huashu commit；旧 release 仍可读取，但不得用于新的 native job。原来的 `/studio`、`/frames`、Studio check/benchmark/isolation 入口不再存在。

## 构建、验证与部署

依赖与工具链由仓库根配置管理。Worker 的入口是 `src/index.ts`，容器构建见 [render-container](../render-container/README.md)。镜像仍由 GitHub Actions 构建；本次源码接入本身不部署、不运行付费模型或 staging 渲染。

`test/native-control.test.mjs` 用真实 SQLite 事务和内存 R2 验证版本范围、不可变身份、outbox、取消 fence、平台重试、未知计算费用和历史迁移；媒体执行与进程隔离由容器侧验证。旧模型账务与密钥测试继续保留。未运行的云集成不能根据离线单元检查记为通过。
