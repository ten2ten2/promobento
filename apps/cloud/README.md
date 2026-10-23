# S1 内部云端链路

只在 **staging** 启用。`/healthz` 以外的路由均要求 `S1_ENABLED=internal_eval` 和独立 `EVAL_API_KEY`；生产配置为 `off`。这是持有评测密钥的负责人使用的内部控制面，不能作为客户 API 接入，尚无 Google/邮箱登录或成员权限系统。

内部入口位于 `/internal/s1/`：`operations`、不可变 `objects/evals/…`、许可 `rights`、镜像 `releases`、`renders`、`studio`、`creative`；`artifacts/<key>` 只读取当前许可仍有效的已发布输出或已登记方向帧；操作可通过 `operations/<id>/events` 收取进度、`operations/<id>/frames/<frame>` 取许可帧、`operations/<id>/cancel` 取消。请求原文经共享解析器；渲染私有传输经预编译完整 Schema。实际权利记录必须在处理前入 D1，并引用私有 R2 中的来源/许可证据；不能拿素材 JSON 自报清权代替这一步。

`RenderWorkflow` 执行分段、声音、接缝/阅读停留观测、拼接和 generation-fenced 提交；`ShardDO` 每次 attempt 使用独立容器，禁网，仅挂该任务的 broker；`CoordinatorDO` 在确认停止前持有并发 lease；`OperationDO` 管 studio 与进度。取消先推进 generation、撤销后续读写，再经 outbox 停止实例。任务、回执、冻结输出引用、费用预留与结算保留；重试不得覆盖已提交字节。

计算费用目前按 **分配的完整 CPU + 内存 + 磁盘 × 实际运行时间**记保守上界，不是 Cloudflare 账单实测值。CPU/内存/磁盘单价来源：[Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)，2026-10-23；实例规格见[官方表](https://developers.cloudflare.com/containers/platform/limits/)。未知模型 usage 保留预留，不记作零。生产预算未标定，Agent 仍关闭。

## 部署

由 [Deploy S1 staging](../../.github/workflows/cloud-deploy.yml) 在 Actions 安装冻结依赖、预编译验证器、应用 staging D1 迁移，再由 Wrangler 构建/推送镜像并部署。开发分支尚未在默认分支登记新工作流时，从既有入口 `gh workflow run checks.yml --ref <branch> -f suite=staging` 调用同一部署工作流，其他检查 job 均跳过。Mac 不构建镜像。随后只运行一次 15 秒原创工程片，覆盖真实 broker、任务 Schema、字体、分段、声音、观测、接缝、拼接、私有输出与 lease 归还；不会重跑九积木帧图、13 风格或模型评测，也不代替完整 G1。

Actions 为本轮生成并遮蔽 `EVAL_API_KEY`，只经 stdin 绑定到 staging Worker；结束前取消该轮操作、确认 lease 归还并删除密钥。内部入口随即恢复 404，`/healthz` 仍可用。失败报告与已生成媒体在 `s1-staging-deployment` 产物；不删除 D1/R2 的任务、权利和费用证据。需要人工恢复时从此工作流重新部署已核对的分支；不要删除数据库或回滚 Durable Object 迁移。手动使用内部入口时另行绑定密钥，不向聊天或日志粘贴值。官方 Anthropic 的密钥暂不添加，相关真实集成保留未验证。部署、G1、导演和首次六题评测的实际完成范围见[实施状态](../../docs/implementation-status.md)。
