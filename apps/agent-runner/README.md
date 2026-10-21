# 本地导演、改稿与全目标工程

使用已确认题目和获准资源生成独立源码候选，再交给 Docker 内的 QuickJS 执行。源码不会在 Node 或浏览器中导入。当前入口用于 M0a 研究，`config/agent-policy.json` 的生产 Agent 仍关闭。

```bash
mise run agent:local -- init --directory artifacts/local-agent --project /path/to/project.json
mise run agent:local -- plan --directory artifacts/local-agent --project-id PROJECT_ID --config /path/to/authorized-config.json
mise run agent:local -- status --directory artifacts/local-agent --operation-id OPERATION_ID
```

`project.json` 的完整结构见 [project 定义](src/schema.mjs)。它包含软件/课程题目、15/30 秒、既有目标、固定 seed、事实原文及其证据/确认人/确认时间、资源许可确认、声音选择和本地研究责任人。题目卡中的待确认信息不能自行填成用户确认。当前只能使用 Renderer 已登记媒体；公开网页不自动成为获准素材。

## 真实调用须有单独的研究授权

配置的字段和校验见 [config 定义](src/schema.mjs)：

- `version: "local-agent-v1"`、`mode: "local_research"`、`provider: "openai"`，明确指定账户可用的 `model`；可选 `reasoningEffort`。
- `priceVersion` 与 `prices`：普通输入、缓存输入和输出每百万 token 的整数 USD micros，以及本地 Docker 每秒的明确计价。1 USD = 1,000,000 micros。当前付费适配器的普通输入、输出费率必须大于零，未标定价格不能填零启用。零本地费率仅表示实验采用零边际账单成本，不代表基础设施没有成本。
- `maxInputTokens`、`maxOutputTokens`、`requestTimeoutMs`，以及 `budgets` 中同一操作、项目、用户与整个实验目录的累计费用上限。
- `authorization`：`purpose: "m0a_research"`、`approvedBy`、`approvedAt`、`expiresAt`、`maxUsdMicros`。这些值来自实际责任人的授权，不能用示例金额代填。

只通过受信任环境变量 `OPENAI_API_KEY` 提供凭据，不写文件、命令行或模型上下文。当前仓库不包含账户、默认收费模型或已批准的费用。未确认这些信息时仅运行离线单元测试。

适配器按 [OpenAI 官方文本接口](https://developers.openai.com/api/docs/guides/text)及[精确输入 token 计数](https://developers.openai.com/api/docs/guides/token-counting)使用 Responses REST，无额外 SDK。请求关闭存储和工具，明确输出上限；实际 usage 包含全部输出 token，缓存输入包含在输入总量内，不重复相加。网络异常不自动重试。接口兼容性测试使用 mock HTTP，不能作为真实模型或账户验收。

## 看实际片子，再选择与确认

`direct: false` 生成 Fit/Amplify/Unexpected 三个方向，各有实际隔离渲染产物；`direct: true` 直接做一个方向。每个方向都有 Treatment、AudioPlan、完整源包，以及可信 Renderer 取出的开场、主展示、命令最密、片尾和声明 marker 关键帧。方向中的 keyframeIds 来自这些实际图片，不采用模型编造的标识。运行状态先是 `withheld`，`status` 不返回未审核文案。状态和 CLI 错误只返回固定错误码；模型 JSON、供应商正文或渲染源码诊断保留在私有错误文件，不通过错误消息绕过审核。AudioPlan 的事件参数、自动音量包络和 catalog 许可必须与冻结声音一致；可选 sourceHash 还必须匹配实际 Renderer 证据。未写 automation 表示全程附加 0 dB。

本地责任人从私有目录的 `operations/ID/run.json` 取得待审对象，查看对应 `renders/` 的实际 MP4、封面和技术报告，正常速度试听，核对事实、权利、内容安全与静音可读性。提交精确 `subjectHash` 绑定的 [review 回执](src/schema.mjs)，包括真实审核人、时间、证据记录与逐项结果：

```bash
mise run agent:local -- review --directory artifacts/local-agent --operation-id OPERATION_ID --receipt /path/to/review.json
mise run agent:local -- select --directory artifacts/local-agent --operation-id OPERATION_ID --candidate-id CANDIDATE_ID
mise run agent:local -- accept --directory artifacts/local-agent --operation-id OPERATION_ID --expected-revision null
```

此回执是本地研究的人工审核记录，不是已部署的生产审核服务或独立盲审票。所有结果保留 `productionEligible: false`。拒绝审核不覆盖原稿；接受候选检查当前版本，冲突时停止。

逐项检查填写真实 boolean。`allowed` 要求所有检查为 true；发现问题时用 `withheld`、相应 false 项和必填 `notes` 保存实际原因，不必为了拒绝结果填写虚假通过。

## 一次改稿与全部目标准备

`patch` 的评论文件使用生产契约 `editComment[]`，保留目标、整数帧、位置和范围，一次最多 5 条、合计 4,000 Unicode code points。不截断、不拆成多轮。模型返回完整独立候选，技术错误最多内部修复 2 次，全部调用共用同一操作预算。候选完成后仍须审核、比较和明确接受。

评论可引用当前已接受版本中已经准备的目标，包括后来由 `prepare` 补出的目标；未准备或无关的目标拒绝。控制器实际渲染每个被评论的目标，`all-variants` 则渲染当前版本全部已准备目标。由于当前源模块共享，未重新渲染的目标列入 `invalidatedTargetIds`，不会继承旧稿的就绪状态；接受改稿后再用 `prepare` 补齐。改稿失败、未审核或未接受时，旧版本及其全部目标保持不变。

```bash
mise run agent:local -- patch --directory artifacts/local-agent --project-id PROJECT_ID --config /path/to/authorized-config.json --comments /path/to/comments.json
mise run agent:local -- prepare --directory artifacts/local-agent --project-id PROJECT_ID --config /path/to/authorized-config.json
```

`prepare` 使用当前已接受的源码和事实，补齐当前平台规则中的全部 7 个合法目标，而不是只处理项目最初请求的目标子集。已准备目标复用原证据；只对缺失目标执行实际确定性渲染，不改变创意内容。即使项目只从一个目标开始，也会补齐其余 6 个。初次创作和基准实验仍只渲染所选主目标。

全部成功后保存新候选，审核并用当前 revision ID 接受；任一目标失败保留原版本。相同 `prepare` operation ID 重放返回已有状态，不再次渲染或支出；修改用途或项目不能复用该 ID。当前实现为了本地证据实际编码每个缺失目标，未实现生产的延迟高清交付。

## 成本、取消和恢复证据

`cost-events.jsonl` 按生产 `costEvent` 保存最坏预留和实际观察的替代链。费用计入同一目录的累计操作/项目/用户/实验上限，换 attempt 或创建新操作不能清零。无法取得生成 usage 时保留最坏预留，须取得供应商账单后对账，不能当作免费失败。该目录是一个本地研究账户的唯一账本；不得另开目录来规避已批准的实验总额。

取得供应商实际金额和 usage 后，使用 `reconcile`，回执包含 `usdMicros`、`usage`、`evidenceRef`、`reconciledBy` 和可选 `providerRequestId`。它追加替代观察，不覆盖旧费用。相同 `plan`/`patch` operation ID 和请求重放返回已有状态，不再次计费；换请求不能复用该 ID。

本地 `.lock` 跨调用、渲染与结算保持单写者；候选与受控诊断保存在私有目录。SIGINT/SIGTERM 会取消 HTTP/容器工作并保存失败状态，晚到输出不得变成可用候选。进程被 SIGKILL 时未知费用预留仍保留；确认原 PID 已结束后，由责任人处理遗留锁与供应商对账，不自动猜测或重跑收费请求。生产跨主机账本、身份授权和事务不在此实现范围。

## 基线共享预算与修复上限

基准另一实验臂可调用 `generateResearchArtifact()`，共享精确 token 检查、固定模型设置和同一账本；它只返回模型数据，状态为 `active/awaiting_render`，不执行生成的 HTML/JS。基准执行必须走自己的受限容器，不能导入宿主。实际渲染后进入 `awaiting_user/output_review`，负责人审核放行后才是 `succeeded`。

基线内容校验或已识别的隔离渲染内容错误，可调用 `repairResearchArtifact({directory, projectId, config, operationId, instructions, input, previousValue, error, provider?, signal?})`。复用初次请求的 `instructions/input`、完整配置和 operation ID，传入真实错误与上一轮 value；控制器注入修复上下文，最多内部修复 2 次（共 3 次模型 attempt）。`isResearchRepairableError(error)` 是封闭的内容错误分类入口，许可、授权、预算、未知费用、取消、环境或清理错误不可自动重试。已经进入人工审核、审核拒绝或成功的操作不能以内部修复重开。

每个 attempt 的响应、渲染报告和原始失败原因保存到 `operations/ID/attempts/N/`；费用仍只用同一个 append-only 账本，渲染失败也计实际耗时。重试不清零费用，不能改用其他项目、模型设置、授权或预算。任何未结算预留都会阻止修复。

`operation.model` 是请求身份（`config.model`、provider、settingsHash），用于预登记实验匹配；`operation.returnedModels` 按 `{attempt, provider, id}` 保留 API 实际返回的模型版本，包含已计费但输出无效的响应。模型别名不能覆盖或丢弃实际 snapshot；基线同一操作内实际版本漂移会停止，基准比较还需核对两个实验臂使用同一实际版本。
