# v2.2 生产契约与一致性修订

修订：2026-10-20 · consistency-1。此章闭合 v2.2 的实施边界，不新增产品大版本。**文档、fixture 与参考检查不是已部署的 Agent、云端隔离或支付实现。**

## 1 权威来源与不变的产品规则

01 定义用户范围，03 与 `config/platform-presets.json` 定义输出，05 定义商品、支付、退款及成片版本权益，10 定义网站语言/主题，11 定义视觉系统，12 与 `config/routes.json` 定义 URI 和认证，13 定义自由创作方法。本章定义跨模块的 Composition → Agent Run → Revision → Variant → Release → Billing 契约。不得同时维护第二套 `composition_revisions`、release API 或旧固定场景的执行白名单。

视频仅 15/30 秒（默认 30 秒），30 fps，450/900 帧；六个平台和配置内可选方形不变。用户视频文案任意语言混排，不设全局视频语言选择器。风格标签可自定义，不用 `clean|bold` 作为准入枚举。镜头数量、叙事、SVG/Canvas/WebGL/3D/Shader 和算法可以自由创作；限制只针对授权、安全、依赖、预算和可交付性。

本章契约版本为 `2.2.1`。JSON Schema 在 `contracts/production.schema.json`；对应时间协议类型在 `contracts/render-protocol.d.ts`；费用与算力起始值在 `config/agent-policy.json`；输入能力在 `config/input-capabilities.json`。应用必须使用完整 JSON Schema 验证器再执行语义/权限检查，不能把 fixture 的存在当运行验收。

## 2 唯一版本模型

| 记录 | 职责与不变量 |
| --- | --- |
| `projects` | `workspace_id,current_revision_id,generation,deleted_at`；只保存当前草稿指针与业务生命周期 |
| `project_revisions` | 唯一版本实体；`id,project_id,parent_revision_id,content_hash,manifest_key,created_by`。内容一旦写入不更新，候选/接受等状态在独立关系或事件表保存 |
| `composition_sources` | `revision_id,source_archive_hash,dependency_manifest_hash,runtime_version`；不再建 `composition_revisions` |
| `composition_variants` | `revision_id,target_id,entrypoint,source_hash,resource_manifest_hash,audio_hash,variant_hash`；`UNIQUE(revision_id,target_id)`，跨表强制同 project/workspace |
| `agent_runs/agent_run_steps` | 一次用户操作和内部步骤。`run_id` 下最多一次成功扣次；模型尝试/工具重试不是新操作 |
| `agent_candidates/agent_patches` | 关联 `base_revision_id,candidate_revision_id,scope,read_set_hash,write_set_hash,validation_state`；可接受的候选是不可变源包，不是任意可执行 diff |
| `creative_reservations/creative_ledger` | 整片生成、局部改稿的预留/消费/释放/补偿，与成片版本账本分开；唯一键见 §6 |
| `export_snapshots/export_releases` | snapshot 冻结创作内容；release 沿用既有支付交付实体，不能用 Agent Run 替代 |
| `comments/edit_requests` | `revision_id,target_id,frame_index,point?,element_id?,screenshot_id?`；scene/element 都可空，不强制存在镜头标记 |
| `fact_manifests/quality_reports` | 关联实际 revision、资源、目标、检测版本和证据 hash。不能把新源码配旧 QA 报告 |

所有关联都以数据库实际资源推导 workspace，不能信任请求体自报归属。采用组合外键或同事务约束避免跨租户 ID 组合。`current_revision_id` 必须指向本项目。

**接受补丁**：验证当前成员权限、项目有效、candidate 已验证、`baseRevision` 和 `If-Match`（若同时提供必须相符）、read/write set 与资源归属，再以 compare-and-swap 原子切换指针、标记候选接受和写 outbox。并发两次接受只有一次获胜；另一请求返回 409 并保留候选。用户可要求重新基于最新稿生成，不能自动合并不可信代码。

**恢复旧稿**：沿用 `PATCH /api/projects/:projectId/draft` 的 `restoreFromRevisionId`，创建新的 revision；复用不可变源包可以，但不修改旧版、不转移订单或余额。原资源已清理则 409 `SOURCE_UNAVAILABLE`，不能返回假恢复成功。

## 3 CompositionManifest 与内容指纹

manifest 至少包含 `schemaVersion,kind,projectId,revisionId,durationSeconds,fps,totalFrames,seed,sourceArchiveHash,dependencyManifestHash,resourceManifestHash,factManifestHash,runtimeVersion,rendererImageDigest,presetRulesVersion,variants`。实际资源清单包含各文件逻辑路径、SHA-256、大小、媒体类型、来源/许可、字体/塑形配置和受控不可变存储引用。授权 URL 不进入 hash，也不由 Agent 任意指定公网地址。

`targetId = presetId + ':' + aspectId`。target 的尺寸、安全区和编码由服务器解析**冻结版本的**平台配置。首发有 7 个合法 target（Instagram Feed 两种选择）；不是 7 个平台。`tiktok:square` 等虽然比例存在但不属于该平台的配置，仍须拒绝。

manifest 的 `variants` 可以在未冻结的候选中只覆盖当前目标；标记 `releaseEligible=true` 前必须完成该配置版本所有合法 target 的可执行源码/分支、字体、资源、音轨、封面帧和 QA。相同画幅且布局、音频、安全区、编码完全一致时可以映射同一构图源；不能仅因同是 9:16 自动视为相同。

内容 hash 使用 UTF-8 原文、固定 JSON 规范化方式和字节级资源 SHA-256；对象键排序、数组顺序保留、拒绝非有限数值。不得自动 Unicode 归一化改变用户原文。manifest 的 hash 不包含它自己的 hash 字段、临时 URL、运行状态或网站主题；保存规范化版本，升级不得改变已购指纹。

`compositionHash` 是完整 manifest 的 canonical SHA-256；`contentHash` 的投影删除 `projectId/revisionId/exampleOnly/releaseEligible` 和各 Variant 的 `qaReportHash`，避免同内容恢复或重新检查消耗新版本。canonical 算法以 `scripts/contract-validation.mjs` 的参考和测试向量为准，生产实现必须跨语言匹配；不包含 self-hash、临时授权 URL 和可变状态。

`variantHash` 包括该目标实际源码、资源/字体、内容事实、独立音轨、布局配置；`artifactFingerprint` 包括实际 variantHash、renderer image、runtime、解析后的编码/尺寸与安全区。平台展示名/targetId 不单独造成重复渲染；不同运行结果或参数必须产生不同指纹。浮点动画可在相同镜像下用已标定像素容差比较，不声称所有 GPU 逐像素相同。

## 4 固定来源、延迟编码的多平台交付

**草稿阶段可以让 Agent 重新设计每个平台；付款冻结以后只能运行被冻结的源包，不能临时再调用模型创作缺失的竖屏版。**

步骤：当前目标预览 → 准备所有合法 target 源码/音轨及封面帧 → 逐目标预检与必要小片段 QA → 展示可切换预览和影响摘要 → 用户确认 → 写入不可变 ReleaseSnapshot → Waffo checkout。冻结不要求全部高清 MP4 提前编码；内部 QA 片段属于有预算的制作成本，不是免费可下载成片。

`POST .../export-snapshots` 只冻结已准备好的 revision，缺少 target/报告返回 409 `VARIANTS_NOT_READY`，不在这个请求中偷偷运行昂贵生成。显式的 `prepare_targets` Agent 操作在 UI 显示准备状态，计入原创作操作内部成本而非新增成功次数；其上限独立受平台预算控制。失败保留主目标预览且不启动付款，重试同一准备任务不多扣次。

新购 snapshot 保存所有 target 的不可变版本和可执行入口；首次文件集合仍是用户勾选的平台。补平台读取同一 snapshot，最多补源配置内已冻结 target；不改变初次批次、不再预留/消费成片版本。过后要求新运镜/文案/音轨时先建新草稿并明确新版本消耗。**系统 bug 的免费修复**用链接到原 release 的独立 correction revision/记录交付，原源包和原文件保留不覆盖。

首次下载、部分失败、ZIP、退款冻结及过期保留继续按05。新平台配置不追溯改旧快照；必须保留可执行 renderer/runtime 到所有关联项目、宽限和在途任务结束，安全停用通过可审计免费兼容修复处理。

## 5 RenderProtocol：运行权限与帧身份分离

可信控制器解析 `revisionId,targetId,presetRulesVersion` 后创建短期 render session；生成代码无权指定任意宽高、变更预设、修改源包或自行调用支付/模型接口。详见 `contracts/render-protocol.d.ts`。

生命周期：`created → initializing → idle → seeking → ready`；后续 `ready → seeking`，任何活动态可 `failed/disposed`。一次 session 的 revision/target 不变；切 target 创建新 session。session 内逐个串行 seek，不并行读取同一画布。

每条命令/响应携带 `protocolVersion,sessionId,requestId,sequence,revisionId,targetId`；seek 另含 `frameIndex`。`frame-ready` 必须回显全部身份和同一 sequence。旧响应、超时响应、来自旧 iframe 的消息全部丢弃；`dispose` 后不得返回可截图状态。init 30 秒、单帧 5 秒为待压测上限，次数和预算以配置为准。

`whenFrameReady` 是待加载资源的屏障，不是“画面正确”的证明。控制器核查来源、manifest hash、资源解码、字体就绪、视频 seek、Shader 能力和会话期限后截图；不采信不可信源码自报的 QA/事实通过。正常播放与截图使用同一版本、时间函数、混音和资源。纯音乐编辑改变 audioHash；只改无关颜色不重做音轨。

必须验证冷 seek、顺序 seek、逆向 seek 三种路径；最后一帧是 `N-1`，末帧时间 `(N-1)/30`，文件仍长 N/30 秒。仿真使用固定步长或预烘焙状态。WebGL 扩展缺失返回 `CAPABILITY_UNAVAILABLE`，提供相同创意可支持的实现建议或等待用户选择，不能静默把运镜换成静态图片。

独立预览 origin 按任务隔离并禁用主站 Cookie，iframe 不授予 top navigation、popup、download、form 等无关能力。message bridge 校验精确 origin、source window、不可预测 nonce、消息 schema 与 session；`origin='null'` 方案必须有独立已验证设计，不能随意放行。截图由可信浏览器渲染服务对指定工程取帧，不信任客户端上传图片即代表该帧。只读分享传最小受控预览投影，不授予源码下载/Agent 执行能力。

## 6 AI 操作、成本和权益

$39/$12、3 个成片版本、原免费和付费整片/局部次数不变；旧“整片分镜”统一映射 `creative_generate`，旧“局部改写”映射 `agent_patch`。不创建隐藏的“购买预算”SKU，也不追溯降低旧权益。

| 操作 | 用户成功次数 | 系统费用与失败规则 |
| --- | --- | --- |
| `creative_generate` | 完整可用主目标候选交付时消费 1 次整片次数 | 三个方向、选方向、编曲、构建、QA、最多2轮内部修复属同一 operation；方向尚未完成成片不算成功 |
| `agent_patch` | 可用修改候选交付时消费 1 次局部次数 | 单镜头或用户明确的全局改稿均先说明范围与上限，不按源码行数/内部调用拆次 |
| `prepare_targets` | 0 | 完成同一创作内容的冻结平台源包，按 revision+target 去重并限预算；用户另改风格不属于免费准备 |
| `internal_repair` | 0 | 归属原 run，总成本和轮数共同计量，不递归启动新收费操作 |
| 属性直改/预览重播 | 0 | 不调用模型，不启动高清 MP4 编码；旧源包无 editables 时用户明确转 AI 改稿 |
| `render_export` | 05 的 1 个成片版本 | 编码器/队列重试、补平台、重下和系统兼容修复不重复收费 |

**预留在前、可用候选交付时消费**。`UNIQUE(workspace_id,project_id,operation_id,kind)`；幂等键另绑定 actor、路由与请求摘要。同键同体返回原状态，同键异体409。预留/消费/释放由同一项目协调器和 D1 原子批次完成，不能先“查余额再减”。成功候选要有可访问的源码、媒体和通过的机械 QA；单纯代码编译/模型完成不算成功。

候选已交付后因个人审美拒绝，保留扣次；确认前因系统失败/输出无效/取消，没有成功结果则释放。该边界在点击生成前说明，不只藏在条款里。已消费结果后证实系统缺陷可补偿一次，使用 append-only `compensation` 行关联原消费；保留真实成本。系统重试不向用户重复收费。导出仍到05的首次整批发布才消费版本。

run 预算快照至少含累计 input/output tokens、模型/价格版本、执行秒数、CPU、预览秒数、修复次数和整数 USD micros；不得使用 float 金额。每次外部调用前预留其最坏费用，结束结算真实 usage；提供方 usage 未知先按上限记账并待对账，防止免费重试绕过。成本报表与用户成功次数分开。

**预算暂停**保存工作、释放物理容器，24小时内可查看候选。resume 仅允许原权限、原 base、剩余既有预算；耗尽上限返回409 `BUDGET_EXHAUSTED`，不让前端自己提高额度。用户可以缩小要求发起新操作（仍受账号/全局成本限流），或使用已交付候选；没有可销售新 SKU 时禁止“付款解锁继续”的假入口。暂停过期释放未消费预留；已成功扣次不因关页面返还。

## 7 作业与跨系统状态机

状态表是逻辑契约；应用仍须实现持久化和原子条件写。`attempt` 是真实执行次数，`generation` 是 fencing token，二者都不以 Queue delivery count 代替。

| 当前 → 事件 → 目标 | 条件与原子影响 | 用户结果 |
| --- | --- | --- |
| 无 → submit → queued | 当前成员、未删/未过期、预算与可用次数；原子预留+run+outbox | 202 runId，重复请求复用 |
| queued → start → active | 获得全局及工作区租约，generation匹配 | 显示真实阶段 |
| active → ask_user → awaiting_user | 检查点持久化，销毁/释放沙箱；不占CPU令牌 | 等待选方向/确认必要信息 |
| awaiting_user → resume → queued | 当前权限、base revision、24小时窗口、remaining budget；同 run | 保存选择继续 |
| active/validating → budget_limit → paused_budget | 停止新外部调用、保留检查点、释放资源 | 给出具体上限，不截短视频 |
| paused_budget → resume → queued | 原预算仍有可用余额且原因已消除，否则409 | 不新建收费操作 |
| active → candidate → validating | 保存源包hash，代码依赖和事实检查 | 候选不能立即替换草稿 |
| validating → pass → succeeded | 原子候选ready+消费成功次数+outbox，generation有效 | 可预览接受/拒绝 |
| validating → repair → active | 内部修复≤2且同一累计预算 | 不重复扣次 |
| 非终态 → cancel → cancelled | 项目/权限复核、提升generation、释放未消费额度与资源 | 晚到结果不能应用 |
| 非终态 → unrecoverable/expiry → failed | 不虚报成功；释放未消费额度，有成本与原因 | 旧稿可用 |
| ready候选 → accept → accepted | CAS当前base+权限/资源+QA；写指针、事件，重试幂等 | 同一候选只有一次成功接受 |
| ready候选 → reject → rejected | 不动当前稿，不返还已交付的成功次数 | 可基于原稿再改 |
| revision → freeze → snapshot | 所有合法target源包/报告完整且无未确认事实 | 只冻结，不暗中生成或付款 |
| snapshot → verified_payment → entitled/rendering | 05订单原子授予+outbox | 关闭网页仍按原快照交付 |
| render partial → retry → rendering | 仅失败指纹，最多3次实际尝试 | 未全部发布不下载中间产物 |
| render all valid → publish → ready | reservation/grant未撤销且项目有效；原子发布+consume | 首次批次可下载 |

长模型调用结束、补丁接受、预留消费、发布文件前都重查权限/generation/项目墓碑。**退出登录不取消已付款渲染**；移除发起成员后取消未提交的创作副作用，但付费交付继续由项目权益驱动。删除项目/工作区撤销新授权、提升generation、取消运行和清理排程；晚到产物进入孤儿清理，不能复活项目。退款只冻结相应 grant 和它的未发布预留，不能删除无关订单资源。

零预算、模型结果未知、Queue 重投、领取后崩溃、ready 回包丢失、重复接受、两个成员同基线、QA后事实改价、删除与付款/补平台并发，必须各有测试。不同运行阶段不叠加各自重试上限；总修复2和渲染尝试3是独立且有共同成本上限的两类计数。

## 8 事实、安全与 QA

`FactManifest` 保存用户确认的事实版本、原文、来源、确认人/时间；商业文本/旁白绑定 `factIds[] + expectedText + frame interval + targetId`。显示的商业句子必须与绑定事实中某条经用户确认的 `text` 完全一致；AI 改写句子要先保存为新的确认事实版本，不能只绑一个真实数字却写新的收益保证。未出现价格不要求价格字段；装饰性画面无需伪造 factId。Shader/Canvas/纹理内难提取的文字要声明可核验内容和覆盖区间；DOM/AST匹配不能证明整片没有新增承诺。

报告区分“引用已确认”“运行时文本对照”“实际像素/语音检查”的覆盖与未覆盖部分。与实际 source/resource/fact hash绑定，任何变化使相关 QA 失效。不可提取的关键商业主张进入 `REVIEW`，由有权限用户针对具体时段审看确认；不能凭 Agent 自报清单自动出具“商业事实已验证”。确认只是客户确认，不是平台担保主张真实。正常速度观看/听音按试运营抽样执行；不把每单必需人工审片作为未预算的隐形交付阻塞。

| 级别 | 项目 | 可豁免性 |
| --- | --- | --- |
| BLOCK | 跨租户/密钥/出网/路径异常、无权资产、未确认或不一致事实、非法编码/总帧/target、缺依赖、无法复现、无有效rights | 用户/Agent不能豁免；修复后重检 |
| REVIEW | 计划内硬切/停顿、复杂文本覆盖不足、风格/读字风险、关键帧需要客户复核 | 当前成员可按具体rule+revision+target+帧区间确认；范围变更或新revision失效 |
| INFO | 已声明的节奏和非关键风格提示 | 可展示不阻断 |

像素级闪烁算法不是医疗/光敏安全认证。未检测的音轨/画面不得标pass。自动检查不能证明艺术质量、媒体版权或商业真实性；许可缺失属于资源准入失败，不由美学评分覆盖。

## 9 云端资源、输入与上线门槛

全局同时运行物理容器初始最多4，涵盖 asset/composer/preview/audio/QA/renderer 全部类别；工作区最多2，其中创作或付费渲染各最多1。内部工具若在原容器运行复用同一令牌；若新开容器须额外原子申请，不能持有全部令牌等待子任务造成死锁。awaiting_user/paused阶段不保留容器。已收款交付预留容量并优先调度，不让免费任务挤占交付承诺。

基准实例沿用现有 standard-3 作为待测起点，不承诺 GPU。固定实例类型、镜像/Chromium/FFmpeg/字体、活跃时间、文件大小、解码像素、进程内存/线程和Shader能力；超额产生可诊断错误。沙箱名由可信层派生 workspace/job/generation，不接受客户端实例ID。Composer与Renderer都执行不可信代码，隔离边界是整个实例而非Linux用户；不复用含私有代码的进程，不挂平台凭据。

默认拒绝公网；资源代理按job范围给出只读素材和有限输出通道。依赖离线镜像+锁文件，禁止生命周期脚本；新增依赖是单独审核流程，不是限制动画类型。预览不同origin、短期权限、CSP和严格消息桥接；密钥留可信Worker，沙箱自报结果仍须校验。

输入以 `config/input-capabilities.json` 为准：P0公开为现有图片/录屏/Logo/用户文本/上传音轨；网址只做背景/CTA，CSV仅内部实验；不偷偷扩展HEVC、SVG/HTML上传、长视频、自动抓网页、所有语种TTS。自然语言可以描述任何画面，但首批公开创建仍按01至少一个真实视觉素材；无素材的纯抽象动画仅内部PoC，不伪装已开放产品入口。

M0 分本地创作切片与 **Cloudflare最小真机准入**：同一30秒复杂源包在目标容器完成Canvas/WebGL能力检测、字体/视频seek、音轨、FFmpeg、销毁重建和跨job隔离；没有真机结果只能标本地PoC通过。允许继续做无生产数据的Studio，不能宣布M0云端通过或开放不可信客户代码。

## 10 性能、保留与验收

取消旧“完整AI生成p95≤45秒/首预览≤60秒”总括目标。分别记录排队、方向候选、首真实关键帧、主目标完整预览、所有target准备、局部patch、编码和交付耗时；旧45秒仅适用于轻量文本操作。暂无基准的阶段标 `target=null, calibration_required`，不得猜测承诺；硬资源超时不是公开SLA。

最小基准覆盖两类客户、15/30秒、连续运镜/蒙太奇/复杂Canvas或3D、两种模型配置，以及队列空闲/混合4容器。同时记录样本数、人工介入、成功/失败、p50/p95、峰值资源和实际费用；小样本只作PoC，不宣传已达到95%。

原免费7天/付费90天+7天宽限不变。生成源码、素材、音轨、正式QA证据与snapshot共享引用保留；候选临时截图默认72小时且不长于项目正常期，已被接受或有效运行引用则按项目保留。待用户操作最长24小时，过期释放未消费预留；源包/引用在活动任务或有效已购版本仍需要时不能提前删。强制删除采用墓碑+取消+孤儿回收，72小时不是覆盖用户删除时限的例外。普通日志脱敏，不写完整提示词/源码或下载token。

检查命令：`mise run check:contracts` 校验协议与样例；`mise run test:contracts` 执行反例和状态/计量参考测试；`mise run check:repo` 校验链接、来源与配置；`mise run check:ui-reference` 校验历史参考，新增Agent参考单独检查。所有测试说明范围，不返回空成功。

本次审查 P0-01..10、P1 全部对应本章约束、相关专章或 fixtures。公开 API/数据库/CSP/云隔离/真实模型/收款等仍须应用实施与外部验收，不因为本地契约测试通过改写实施状态。

## 11 外部依据

2026-10-20 核对官方 [Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)、[Container scheduling](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)、[Outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)。官方说明同一sandbox内资源共享，预览应另设hostname，`durable_object`调度仍标public beta；本产品因此要求M0验证隔离、回收和目标能力，不能靠Linux用户或SDK存在替代。其他数字均为本产品起始预算，不是供应商保证。
