# S1 内部云端链路

只在 **staging** 启用。`/healthz` 以外的路由均要求 `S1_ENABLED=internal_eval` 和独立 `EVAL_API_KEY`；生产配置为 `off`。这是持有评测密钥的负责人使用的内部控制面，不能作为客户 API 接入，尚无 Google/邮箱登录或成员权限系统。

内部入口位于 `/internal/s1/`：`operations`、不可变 `objects/evals/…`、许可 `rights`、镜像 `releases`、`renders`、`studio`、`creative`；`artifacts/<key>` 只读取当前许可仍有效的已发布输出或已登记方向帧；操作可通过 `operations/<id>/events` 收取进度、`operations/<id>/frames/<frame>` 取许可帧、`operations/<id>/cancel` 取消。请求原文经共享解析器；渲染私有传输经预编译完整 Schema。实际权利记录必须在处理前入 D1，并引用私有 R2 中的来源/许可证据；不能拿素材 JSON 自报清权代替这一步。

`RenderWorkflow` 执行分段、声音、接缝/阅读停留观测、拼接和 generation-fenced 提交；`ShardDO` 每次 attempt 使用独立容器，禁网，仅挂该任务的 broker；`CoordinatorDO` 在确认停止前持有并发 lease；`OperationDO` 管 studio 与进度。取消先推进 generation、撤销后续读写，再经 outbox 停止实例。任务、回执、冻结输出引用、费用预留与结算保留；重试不得覆盖已提交字节。

计算费用目前按 **分配的完整 CPU + 内存 + 磁盘 × 实际运行时间**记保守上界，不是 Cloudflare 账单实测值。CPU/内存/磁盘单价来源：[Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-23；实例规格见[官方表](https://developers.cloudflare.com/containers/platform/limits/)。未知模型 usage 保留预留，不记作零。生产预算未标定，Agent 仍关闭。

满载时 ShardDO 在原始期限内等待物理 lease，不启动容器、不预留容器费用；每次重查 generation 与持久停止标记，取得名额后再核对许可和预算。这样 24 个 WebGL 分段与声音可共用工作区的 24 个名额，不因瞬时满额直接失败，也不增加并发上限或重置期限。Coordinator alarm 设置失败仍先确认实例停止再归还 lease。该新增排队路径已有定点本地回放，尚未部署或完成正式满载 G1。

## 部署

由 [Deploy S1 staging](../../.github/workflows/cloud-deploy.yml) 在 Actions 安装冻结依赖、预编译验证器、应用 staging D1 迁移，再由 Wrangler 构建/推送镜像并部署。开发分支尚未在默认分支登记新工作流时，从既有入口 `gh workflow run checks.yml --ref <branch> -f suite=staging` 调用同一部署工作流，其他检查 job 均跳过。Mac 不构建镜像。随后只运行一次 15 秒原创工程片，覆盖真实 broker、任务 Schema、字体、分段、声音、观测、接缝、拼接、私有输出与 lease 归还；不会重跑九积木帧图、13 风格或模型评测，也不代替完整 G1。

Actions 为本轮生成并遮蔽 `EVAL_API_KEY`，只经 stdin 绑定到 staging Worker；结束前取消该轮操作、确认 lease 归还并删除密钥。内部入口随即恢复 404，`/healthz` 仍可用。失败报告与已生成媒体在 `s1-staging-deployment` 产物；不删除 D1/R2 的任务、权利和费用证据。需要人工恢复时从此工作流重新部署已核对的分支；不要删除数据库或回滚 Durable Object 迁移。手动使用内部入口时另行绑定密钥，不向聊天或日志粘贴值。官方 Anthropic 的密钥暂不添加，相关真实集成保留未验证。部署、G1、导演和首次六题评测的实际完成范围见[实施状态](../../docs/implementation-status.md)。

studio 的 45→375→45 与关闭已在 [39987356301](../../docs/evidence/2026-10-24-s1-staging/README.md)通过，普通出片检查复用该证据，不重复取三帧。每个分段仍读取实际健康回执；负责人允许 cgroup 峰值接口均缺失时以 `null` 加明确原因继续本次内部出片，整片 `peakMemory.status` 保留 `unverified`，G1 此指标不算通过。无效读数、权限错误、媒体、沙箱和预算门槛不变。

新增 WebGL 时选 `-f staging_scenario=webgl-studio`，只覆盖新设备积木的四画幅 0/12/45/375 帧、逆序与独立实例冷 seek、真实 SwiftShader 字符串及停止/lease 归还；不重跑 2D 工程片、配乐或模型。产物为 `webgl-*.png` 和 `webgl-report.json`。这不是完整 G1：30 秒分段成片、性能分布、standard-3/4 对比、真实中途取消与重启仍需验收。一般工程片仍使用默认 `engineering` 场景。

仅修复检查脚本、仍需验证原部署时，可在上述手动入口加 `-f staging_sha=<实际已部署完整SHA>`：跳过迁移、构建和部署，只修复并运行 harness。报告分别记录部署 SHA 和 harness SHA，不把新分支当成已部署。内部密钥写入后先等待只读鉴权就绪（最多 60 秒）；相邻请求仍可能看到旧密钥，此时仅对调度前的确切 `404 Not found` 有界等待，并记录次数。模型/渲染失败和不确定超时不自动重试。

只改 Worker 时，可改用 `-f staging_renderer_sha=<已部署镜像源码完整SHA> -f staging_renderer_digest=sha256:<实际registry摘要>`：确认镜像源码为当前祖先，且容器、共享包、契约、配置、依赖与构建输入均未变化后，只部署 Worker，复用原镜像，不构建推送。`renderer-reuse.json` 分别保留镜像来源和摘要，部署 SHA 仍是新 Worker 的提交。镜像摘要必须来自原部署回执，不能填写本地 image ID。

先诊断再修复：同一入口另加 `-f staging_inspect_run=<原 Actions run ID>`，只查询该次操作的 Workflow 步骤/错误及 D1 状态、attempt 和费用结算，保存 `inspection.json`；不部署、不绑定内部密钥、不新建渲染，不读取任何凭据值。出片失败时，部署工作流也自动保留这份只读诊断，不为收集错误重复渲染。

只修复已失败/取消的指定操作，可加 `-f staging_reconcile_operation=<operation ID>`。新版本通过 `operations/<id>/reconcile` 再次确认实例停止，补齐旧 attempt 的停止记录及遗留的渲染非终态；返回未结费用清单。不重启计算、不改 generation、不清零未知模型费用、不覆盖 passed 成片或原始失败原因。活动操作拒绝此入口。

## 不消费云资源的导演回放

`mise run test:cloud-local` 在本机预编译当前 Schema 后，用真实 `OperationWorkflow`、两种 SSE 适配器、SQLite 预算 SQL 和内存 R2 回放 A–C/E/F。覆盖三方向取帧请求、12 小时用户等待排除、review 修复、冷审拒绝、取消栅栏、缺许可/密钥/模型验证的提前阻断，以及未知消费保留预留。`fetch` 完全替换为固定 SSE，容器/成片为明确模拟，不访问外网、不读真实密钥、不构建 Mac 镜像；这些结果不代替媒体质量或 G1。官方模型仅在这个独立 mock bundle 中视为可回放，部署配置的 `verified=false` 不变。

RenderWorkflow 的复合步骤值以共享 `canonical` 文本持久化、经 `parseCanonicalJson` 恢复；不依赖平台结构化对象的属性形态，也不放宽 JCS 对非 JSON 值的拒绝。最终提交不自动重试确定性失败，避免原始错误被后续期限错误掩盖。`test/render-commit.test.mjs` 只回放已生成的云端计算回执，检查实际提交代码，不重新捕获或编码媒体。

渲染记录依次为 `queued → sharding → verifying → assembling → passed`，失败/取消为 `blocked`/`cancelled`。准备输入也在失败处理范围内；失败先封锁新 attempt，再确认实例停止。`fail-render` 检查点只重试清理，最多三次重试，保留首个错误和 `stopPending`；确认失败时 lease 不归还。ShardDO 持久化单次 attempt 的停止标记，晚到 execute 不能重新启动。最终成片与 `render_progress` outbox 原子提交；通知由既有队列独立重试，陈旧 generation 的通知丢弃，查询渲染记录不依赖通知到达。

上述恢复路径已随 `ca1c37e` 部署；旧取消操作的残留渲染行修复与新 WebGL studio 停止已有云端证据。准备失败、通知故障及晚到执行竞态仍只有 SQLite/DO/Workflow 本地回放，不代表平台强制终止、真实重启或完整 G1 已通过。真实云端出片和历史对账范围见[实施状态](../../docs/implementation-status.md)。
