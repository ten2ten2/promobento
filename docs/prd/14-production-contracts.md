# 生产契约：版本、状态、指纹与交付

本章是产品规格 v2.3 的跨模块契约依据。现行结构协议仅接受 `2.3.0`，定义在 `contracts/production.schema.json`；帧协议类型在 `contracts/render-protocol.d.ts`；预算与输入分别在 `config/agent-policy.json`、`config/input-capabilities.json`。结构验证、语义验证与资源授权必须同时成立，不接受已撤销的协议版本、字段形态或商品别名。现行可选创作字段仍可省略；可选不等于历史兼容。参考检查不是D1原子性、隔离沙箱或生产服务。

生产入口显式执行带 `{production:true}` 的语义验证，并拒绝 `exampleOnly:true` 的请求、快照和资源清单。离线Reference允许标注的样例以验证关联和状态；其默认测试上下文不是生产授权路径，不应直接当作上线服务复用。

[01](01-product-prd.md)定义产品，[03](03-platform-presets.md)定义输出，[05](05-waffo-billing.md)定义付款退款，[10](10-i18n-and-themes.md)定义语言主题，[11](11-ui-design-spec.md)定义UI，[12](12-routing-and-auth.md)定义认证，[13](13-agent-native-production.md)定义创作方法。API唯一登记在 `config/routes.json`，Agent请求/响应通过 `contracts/agent-api.json` 引用Schema；[08](08-codex-execution.md)是唯一实施顺序。

## 1 唯一版本模型

| 实体 | 不变量 |
| --- | --- |
| projects | workspace_id、current_revision_id、generation、deleted_at；当前草稿指针必须指向本项目 |
| project_revisions | 唯一内容版本实体；id/project/parent/content_hash/manifest_key/created_by；一旦写入内容不可变 |
| composition_sources / composition_variants | revision关联源码、锁定依赖、runtime；UNIQUE(revision_id,target_id)；源码/资源/声音按实际hash引用 |
| agent_runs / agent_run_steps | 一次用户操作及内部步骤；attempt不是队列投递次数，generation是写入栅栏 |
| agent_candidates / agent_patches | base/candidate revision、scope、read/write set、验证状态；状态在关联记录，不更新源码内容 |
| creative_reservations / creative_ledger | 整片/AI改稿轮成功次数预留、消费、释放、补偿，与成片版本账本分开 |
| trial_claims | 以user_id唯一绑定一次试用project；跨workspace、复制、删除、身份关联不重置；只允许Owner绑定自己 |
| cost_events / cost_reservations | workspace/project/operation/attempt/target/子调用、模型/价格版本与实际用量；用户次数回退不删除实际开销 |
| export_snapshots / export_releases | snapshot是确认收据；release是按项目及内容身份去重的实际交付/版本消费实体 |
| comments / edit_requests | 一轮请求固定baseRevision，comments为1至5条，每条target/frame与可选point/element/screenshot；合计最多4,000个Unicode code points，不强制scene存在 |
| fact_manifests / quality_reports | 与真实源码、资源、事实和检查版本绑定，不能新源码配旧报告 |

所有关联从数据库真实资源推导workspace，以组合外键/同事务条件避免跨项目ID拼接。候选接受时重查会员、项目正常期、非墓碑、baseRevision、If-Match（两者同时提供要一致）、read/write set、资源和QA，再CAS切换指针并标记接受、写outbox。同基线两候选只能一个成功，另一409保留；不自动合并不可信代码。

恢复使用 `PATCH /api/projects/:projectId/draft` 的 restoreFromRevisionId，与changes互斥，创建新revision，可复用源包；不改订单或余额。素材清理后409 SOURCE_UNAVAILABLE。源包相同而revisionId/检查记录变化不必然是新的付费内容。

## 2 Manifest、目标与冻结准备

CompositionManifest包含project/revision、15/30秒、30fps/450或900帧、seed、sourceArchiveHash、dependencyManifestHash、resourceManifestHash、layoutRulesHash、factManifestHash、factContentHash、runtimeVersion、rendererImageDigest、presetRulesVersion、releaseEligible与variants；可选styleLabel自由值，内容语言元数据可省略。每个variant冻结targetOverrideHash，无覆盖项时明确为null；有覆盖时hash指向实际执行的不可变适配内容。网站Cookie/uiLocale/theme不进入manifest。

资源清单列逻辑路径、字节SHA-256、大小、媒体类型、不可变存储引用、来源许可和字体/塑形配置。字体以实际客户文字逐码位/字素簇验证支持、塑形及明确回退；仅等待 `document.fonts.ready` 不算成功，不允许静默 tofu/系统字体漂移。确认可商用的字体/音源与使用的子集或回退映射须冻结进 resourceManifest，署名义务无法履行的采样不得进入 P0 成片。源码包只包括实际执行源码及锁定依赖引用，不包含manifest自身、QA输出、临时URL、运行日志等自引用/可变材料。实际业务字段声明不足不等于授权通过；必须核对资源归属。

`targetId = presetId + ':' + aspectId`。服务器依据**快照固定的**rulesVersion读取合法配对、presetVersion、尺寸、安全区与编码；当前六平台七target。比例分别存在不代表配对有效，例如TikTok:square拒绝。加载不到固定规则版本则 PRESET_VERSION_UNAVAILABLE，不用当前配置代替。

候选可以只覆盖当前目标；releaseEligible前必须有该规则版本全部合法target的源分支/资源/字体/音轨/coverFrame与Q0/Q1、必要片段及事实复核。相同画幅只有源码、资源、声音、参数经验证等价才可共享，不按比例自动去重。releaseEligible是准备资格，不是完整高清编码通过证明。

准备平台是显式prepare_targets操作，响应式语义布局优先，并仅对 Q1 失败镜头做 Agent 定点适配；按原revision/target去重和独立系统预算，不扣额外成功次数。同operation下全部target、attempt和子调用共同受美元上限约束，不能为每个目标重开一份无限预算。共享源码、布局规则、依赖、资源及每个target的覆盖项必须进入冻结身份，不能只保存一个可变规则名称。每新增构图的模型、CPU、字幕/字体、QA 和返工成本应计量，报告一次通过率与修复开销，不假设派生成本为零。它不能原地追加不可变revision；产出新的候选revision并CAS确认，保留原稿。改变原主目标风格或事实必须重新向用户确认，不能伪装成无变化准备。

目标Q1覆盖整片关键时点、转场和高风险动态片段，绑定真实布局、安全区、字体与资源；允许低清取帧优化，不要求付款前全部高清编码。付款页静态图用于浏览，不能替代时序QA或七个目标的可执行来源。相同画幅只在实际绘制、字幕、音频与安全区条件等价时复用，不把“7个目标”承诺成恒定“4份视频”。

`POST .../export-snapshots`只冻结已经准备好的revision，缺目标/报告409 VARIANTS_NOT_READY；不会在请求内暗中做昂贵生成。付款冻结所有来源，首次只编码所选目标；后补平台仅运行被冻结源包，不再调用模型。系统缺陷以独立correction关联原release、免费且有审计，原文件不覆盖。

## 3 内容与产物指纹

固定规范化为 `scripts/contract-validation.mjs` 中canonical/digest：UTF-8、JSON对象键排序、数组保持声明顺序、拒绝非有限数值，不对用户Unicode原文做自动归一化。跨语言实现通过相同测试向量。实际文件另用字节级SHA-256，不能把JSON的digest当文件校验和。

| 身份 | 精确定义与用途 |
| --- | --- |
| factManifestHash | 完整FactManifest的canonical SHA-256，含确认主体/时间及绑定覆盖证据 |
| factContentHash | factContentIdentity：去掉projectId/revisionId/exampleOnly，各fact去confirmedBy/confirmedAt，各binding去coverage，其余保留 |
| compositionHash | 完整CompositionManifest的canonical SHA-256；用于源包关联与帧会话精确身份 |
| contentHash | contentIdentity：去projectId/revisionId/exampleOnly/releaseEligible/factManifestHash/styleLabel；variants去qaReportHash并按targetId排序；实际源码、事实内容、依赖、声音、seed、时序、封面、runtime/renderer与规则版本保留 |
| variantHash | variantIdentity：目标sourceHash、layoutRulesHash/targetOverrideHash、锁依赖、目标resourceManifestHash/audioHash、factContentHash、seed/总帧/fps与固定layout |
| videoFingerprint | outputArtifactIdentity(video)：kind+artifactIdentity，后者为variantHash、runtimeVersion、rendererImageDigest、固定encoding与layout |
| coverFingerprint | outputArtifactIdentity(cover)：kind+artifactIdentity+coverFrame+固定jpg_v1编码标识；改封面帧不能复用旧JPG，但可复用未变视频 |
| mappingFingerprint | outputArtifactIdentity(mapping)：kind+targetId+规则版本+videoFingerprint+coverFingerprint+mapping_v1；对应固定、无临时URL的目标映射 |

source/variant资源hash必须覆盖所有实际绘制依赖；不能遗漏字体、纹理或外部数据。QA声明、确认时间、任意样式标签不应单独触发新版本收费；实际视觉由源码/参数hash体现。相同的预设展示名不造成重复视频，映射文件因目标不同可以不同。

`contentHash`只是同一项目的计费身份，不能用于跨租户授权。规则/运行版本属于内容身份；用户主动采用新配置会形成新稿，平台安全兼容修复则走免费correction。哈希自指字段不得加入被哈希对象；改变规范化方式需新版本并保留已购执行能力。

## 4 Snapshot、Release与账务身份

不同snapshotId可能只是同一内容的重新确认，不应重复扣次。已交付release的授权若因退款撤销，普通请求重放不能恢复其下载；同内容的purchase_and_export在创建checkout前返回RELEASE_RESTORATION_REVIEW_REQUIRED并转review_required，按05核查既有消费与恢复授权，不把新grant伪装成从未使用。此边界不阻止普通未使用/未发布失败退款后的新购买、新内容或$39的top_up_only创作购买。`UNIQUE(project_id,content_hash)`确定release；首次成功交付最多消费一个成片版本。重复请求仍执行当前权限检查，同幂等键不同请求摘要409，不因“相同内容”跳过幂等约束。

发现同内容既有release时返回原release及其**原始snapshot/批次**，不能把本次新snapshot重贴到原输出。若另选平台，用独立补平台请求；不修改initialTargetIds。首次预留固定首批MP4、JPG与映射文件的逻辑集合；每个target均有video/cover/mapping记录，允许共享实际对象。全部就绪、预留/grant有效、项目未删除才原子ready+consume+published_at。

中间文件不下载；最终失败释放预留，可在同release重新预留，consume仍按release唯一，release操作按reservation唯一。补平台不再预留成片次数，不改变已交付状态；ZIP随后派生，失败免费重试不决定首次消费。完整Q2与输出字节绑定、发布前完成，不能用付款前报告冒充成片检测。

快照保存全部目标源包、精确compositionHash、contentHash、事实/renderer和首次目标；manifest关联其真实snapshotHash与revision。ready artifact必须有实际sha256、正确输出指纹和冻结target；首次ready缺任一逻辑输出不可发布。短期签名URL不入内容或产物身份。

订单授予、退款冻结、晚成功付款、素材失效、保留和恢复按 [05](05-waffo-billing.md)。普通界面注销不取消已付款交付。付费snapshot/runtime/镜像在其正常期、宽限与在途任务仍引用时必须可运行；安全停用走有审计的免费兼容修复。

创作计划的最小机器合同：`run_result.directions` 可含语言、look、palette、rhythm、sound、risk、whyItFits；`run_result.treatment` 保存总帧、半开区间节奏事件和连续性/关键帧；`run_result.audioPlan` 保存总帧、事件范围、许可与可选已确认转写稿 hash；`patch_result` 可含影响摘要、Agent 解读和同线程 followUpOf。其现行字段和允许省略项以 `production.schema.json` 为准，跨字段时长验证由可信层执行。这些创作记录本身是可追溯证据，**不单独改变 contentHash**；只有真正修改已执行源码、参数、事实、音频、资源或合法目标布局才产生新计费内容。

商品结构使用 `checkout_request`：requestId/projectId/sku/purchaseIntent，导出意图额外提供snapshotId，升级额外提供upgradeFromOrderId。purchaseIntent必须显式传入；`top_up_only` 禁止snapshotId且不创建导出任务，`purchase_and_export` 必须绑定已准备、已确认的全部目标快照。单片商品 `single_export` 仅允许后者；`project_pack`、`project_upgrade`、`extra_pack` 允许两种意图，UI默认仅增权益。升级源字段只允许升级商品。客户端不能指定金额、币种、权益或支付回跳。资格、并发槽、付款与退款按05执行；结构合法不代表订单已获授权。

## 5 RenderProtocol

协议类型在 `contracts/render-protocol.d.ts`，结构与Schema一致。可信控制器解析revision/target/固定规则后建立短期session；源码不能指定任意尺寸、改预设、写源包或调用支付/模型服务。生命周期created→initializing→idle→seeking→ready；后续ready→seeking，活动态可failed/disposed。

每命令和响应有protocolVersion/sessionId/requestId/sequence/revisionId/targetId；seek/ready有frameIndex，init/ready有manifestHash。一次session的revision/target固定，换目标新建session；同画布寻帧串行，sequence递增。frame-ready必须回显全部身份；错误响应同样匹配当前命令身份，迟到、已dispose、旧iframe消息均丢弃，不能拿错误的准备结果截图。

init30秒、单帧5秒为初始待测上限，实际配置见agent-policy。whenFrameReady只是资源屏障，不证明画面或事实正确；可信控制器检查来源/身份、资源解码、字体/视频seek/Shader、会话期限后取帧。客户端上传图片不能冒充权威帧；不相信生成代码自报pass。

`seekFrame(n)`按绝对时间n/30，最后帧N−1、文件长度N/30；不依赖自由运行墙钟、未保存随机数或播放历史。生产时间轴按绝对时间构建/采样，tween 起点在构建时确定，不允许状态性 onUpdate 隐藏历史依赖；仿真可从已知初态固定步长回放或预烘焙，但其结果须和 seek 顺序无关。`renderSeek` 仍只接受整数帧；运动模糊子帧仅由可信 Renderer 内部选择并测量 1/4/8 倍开销，不给不可信源码控制快门的权限。冷/顺/逆向路径一致性需要真实目标环境验证；WebGL不可用返回CAPABILITY_UNAVAILABLE并提供兼容建议，未经同意不变静态图片。

独立预览origin按任务隔离，不带主站Cookie；精确origin/source window/不可预测nonce/消息schema校验，不授予top-navigation、popup、download、form等无关iframe能力。origin=null不能直接放行，需单独已验证设计。只读审阅提供最小媒体投影，不授予源码下载或Agent执行；资产broker权限按任务限制且可撤销。

## 6 AI操作、费用与成功次数

| 操作 | 用户计量 | 内部边界 |
| --- | --- | --- |
| creative_generate | 可用主目标候选交付时1次整片 | 方向、选择、构建、配乐、QA、最多2轮内部修复共用同operation |
| agent_patch | 可用修改候选交付时1轮AI修改 | 一次提交1至5条同base评论、总计≤4,000个Unicode code points；先显示合并影响，不按评论、调用或源码行数拆次 |
| prepare_targets | 0 | 同创作内容补全冻结来源，revision/target去重并限预算；用户新风格请求不是免费准备 |
| internal_repair | 0 | 属于原run，不递归新收费operation，修复与总费用有上限 |
| 普通参数本地编辑/重播 | 0且不限编辑次数 | 无模型、不启动高清交付编码；素材替换、ASR、云预览和QA独立计入云预算、去抖与缓存；没有editables要明确选择AI修改 |
| render_export | 首批发布1个成片版本 | 按05/§4去重；重试、补平台、重下、ZIP、系统修复不重复收费 |

有效付费商品仅为 `single_export` $19（1版本、0整片、0AI修改）、`project_pack` $39（新增5整片、15轮AI修改、3版本）、`project_upgrade` $20（有效$19订单同时最多一份在途/有效升级，增加5整片、15轮AI修改、2版本）、`extra_pack` $12（完整项目包或升级后，新增2整片、10轮AI修改、3版本）。完整销售条款与目录来自agent-policy和05，无隐藏预算充值。免费样片及已经消耗的免费次数不从购买新增权益扣除；升级仅授予目录规定的增量，不能把已消耗的首个成片版本再补回。升级及依赖的追加订单全部退款结清、没有未知付款或未结退款后，按05释放有效槽以允许新订单；初始购买亦须整条依赖结清。历史付款回调不能复活退款权益，历史消费和试用记录始终保留。

`create_project_request.requestTrial` 可省略并按false处理；只有当前Owner可请求绑定其已认证user_id，不能传其他user_id或workspace余额作为试用来源。原子创建project、请求幂等结果与trial_claims；一个user跨工作区最多一个试用项目。已用完仍创建无免费权益草稿并返回trialStatus=unavailable，不暗中付费；未请求为not_requested，成功绑定为granted。两个并发请求最多一个granted，重复requestId返回同一project。删除/复制/转移Owner/重新登录/关联登录方式不重置该user的累计记录。其他草稿不获得免费素材处理、方向、整片或改稿；试用耗尽可先购买$39的top_up_only，再开启创作。

试用项目仅有1次成功整片与2轮成功AI修改，三方向和内部工具在操作预算内；账号/设备/IP和全局限额按配置叠加，设备/IP不能替代稳定user_id主键。每次生成/改稿前展示“可用候选交付扣次、之后纯审美拒绝不退次”，不是用户Accept才扣。系统失败/无效输出/取消且没有已交付可用结果则释放；已成功结果经证实技术缺陷可append-only补偿一次，关联原consume保留真实成本。免费预览采用隔离交互iframe；内部QA片段受预算与访问授权控制，不作为可下载的免费高清成片，预览标识不构成绝对防录屏承诺。

额度预留、run和outbox同事务。`UNIQUE(workspace_id,project_id,operation_id,kind)`；请求幂等另绑定actor/route/requestId/摘要。内部attempt/工具重试不另预留成功次数；不同操作竞争最后额度必须原子仲裁。

预算快照及费用台账关联workspace/project/operation/attempt/target/子调用，并按04关联actor_user_id及trial_owner_user_id，记录输入、缓存与输出tokens、provider/model/价格版本、CPU/执行/片段/音频/存储操作用量、修复次数与整数USD micros。每次模型或受计费工具调用前，在同operation累计已用和在途预留之外原子预留最坏费用，结束结算实际usage；结果未知继续按上限占用待对账，不让未知结果触发免费无界重试。子模型、冷审、ASR、方向和多目标共用该operation上限，不因attempt改变而重置。用户次数退还不回滚已花系统费用；重新发起还受账号/项目累计预算控制。提供方真实费用超出预留时记录超额并停止新调用，不能截掉账单隐藏超支。

每次新调用还须原子核对账号与项目的通用滚动24小时费用窗口：`maxMicrosPerUserWindow` / `maxMicrosPerProjectWindow`、`usageWindowHours=24`、`usageWindowMode=rolling_all_actual_and_unsettled_costs`。统计窗口内全部成功及失败的实际云费用，并占用全部未结算最坏预留；成功的图片处理、云预览和QA也消耗这一窗口，不得只查失败预算。通用窗口与失败专属窗口、UTC免费总硬上限和原operation预算同时满足；新operation、付款、退款或用户次数退回均不清零。已确认付费交付的必要费用和容量须预留，新的非交付调用不能将其耗尽。两项通用上限未标定时保持null及enabled=false；参考校准检查不代替真实D1/DO的跨operation原子累计验收。

合并改稿在排队和额度预留前校验comments数量及Unicode code points总量，超限明确返回422，不静默截断。供应商token上限和美元预算独立校准，不能假设一个Unicode字符等于一个token。方法包缓存以实际供应商和固定版本计量；每个可用结果成本包括失败、内部修复和目标验证，不只统计成功的最后一次模型调用。

暂停保存工作、释放物理容器，24小时窗口内可访问未过期候选；resume仅在原权限、base仍有效、窗口内且原预算剩余时继续同run。上限耗尽409 BUDGET_EXHAUSTED，前端不能提高。可以缩小需求发起受全局限流的新操作或使用现有可用稿；没有批准SKU不提供“付款续跑”。到期释放未消费预留，已消费不因关页返还。

## 7 跨系统状态机

| 当前→事件→目标 | 权限、原子影响与恢复 |
| --- | --- |
| 无→submit→queued | 成员、正常期、非墓碑、次数与预算，原子reserve+run+outbox；重复请求返回原结果 |
| queued→start→active | 全局/工作区租约与generation匹配；真实attempt计数 |
| active→ask_user→awaiting_user | 检查点持久化、释放容器，不占CPU等待 |
| awaiting_user/paused_budget→resume→queued | 原权限/base/24小时窗口/剩余预算重查；同run |
| active/validating→budget_limit→paused_budget | 停止新调用，保存检查点与预算结算，释放资源 |
| active→candidate→validating | 保存候选不可变hash，暂不切当前指针 |
| validating→pass→succeeded | 重新核对权限/generation/项目/QA，原子候选ready+一次consume+outbox |
| validating→repair→active | 同预算且累计修复<2，不新增收费run |
| 非终态→cancel→cancelled | 提升generation，释放未消费预留和资源；晚到不能提交 |
| 非终态→fail/expiry→failed | 具体原因及真实成本，释放未消费预留，旧稿保留 |
| ready候选→accept→accepted | §1 CAS、权限与QA同时验证；同请求同候选幂等 |
| ready候选→reject→rejected | 不改当前稿，不返已交付成功次数 |
| revision→freeze→snapshot | 所有合法target来源和报告齐全；只冻结，不生成/付款 |
| checkout(top_up_only)→verified_payment→entitled | 05原子grant+outbox；无snapshot、无导出intent、不创建rendering |
| snapshot(purchase_and_export)→verified_payment→entitled/rendering | 05原子grant+导出intent+outbox，关闭网页仍交付 |
| partial→retry→rendering | 仅失败指纹最多3个真实编码attempt |
| all-valid→publish→ready | 原子批次发布/consume，退款或删除先发生则阻止发布 |

终态不能通过普通resume重新活动；需要新的授权操作。长调用结束、消费、接受、发布均重查权限/generation/墓碑。移除发起成员取消未提交创作副作用，但已收款交付由项目权益继续驱动；删除项目/工作区撤销新授权、提升generation、取消作业并清理，晚到文件孤儿回收，不复活项目。退款只冻结关联grant及未发布预留，不能影响无关订单。

参考代码的内存状态测试不构成D1实现；真实并发需复现零预算、unknown usage、队列重投、领取后宕机、ready回包丢失、重复接受、两成员同base、QA后改价、删除与付款/补平台竞态。源码修复2和编码attempt3为两类计数但都有共同费用上限，不能相乘失控。

## 8 事实与QA授权

FactManifest记录事实版本、原文、来源、确认人/时间。商业文本/旁白绑定factIds、expectedText、合法target和半开帧区间；expectedText必须等于一条已确认事实text。AI重写商业句子要先确认新版本，不能只引用一个真数字就附带新收益保证。装饰不伪造factId；空价格字段不补造。

报告区分“已确认引用”“运行时文本对照”“实际像素/语音覆盖”。用户口播/选用录屏原声的商业主张必须先有用户确认的逐段转写稿并绑定已确认 factIds；手填/经验证 ASR 都可，未经确认不能猜测语音事实，也不能把未知词级对齐当成功。信息流目标以静音可理解和真实帧字幕为 Q1/Q3 审查项。缺字、缺少合法授权或商业事实不一致按 BLOCK，节奏稀疏、三秒钩子不足或调色雷同按 REVIEW/INFO 而非伪硬规范。源码/资产/事实hash变化使关联检查失效。Canvas/Shader/纹理的商业文字若不可提取，声明覆盖不足并以REVIEW要求当前成员审看指定区间；清单不能证明整片没有新承诺，平台不出真实性担保证书。

| 等级 | 内容 | 谁可豁免 |
| --- | --- | --- |
| BLOCK | 越权/密钥/出网/路径、未授权资产、未确认/不一致事实、非法target/帧/编码、缺依赖、不复现、无rights | 任何用户和Agent都不可豁免，修复并重检 |
| REVIEW | 有意停顿/硬切、复杂商业文本覆盖不足、阅读与风格风险 | 当前有权成员按rule/revision/target/帧区间及到期确认，变更即失效 |
| INFO | 已声明的非关键视觉/节奏提示 | 展示，不阻断 |

真实QA证据至少绑定实际revision/source/facts/target/checker/输出；不能把素材许可证缺失归入美学豁免。自动闪烁检测不是光敏医疗认证。正常速度听审按运营样本与客户复核进行，不让未预算后台人工审批阻塞每个订单。

## 9 资源、输入与保存

全局物理容器最多4、工作区2、创作/渲染各1，涵盖素材、Composer、预览、音频、QA和Renderer；同容器工具复用令牌，新开须原子申请，不能持有全部令牌等待子任务死锁。暂停/等用户不保留实例，付费交付预留容量并优先。具体待测值来自agent-policy，未标定费用不enable。

实例是信任边界；每job/generation由服务端派生实例名，Composer与Renderer都执行不可信代码，不因镜像固定就信任。独立目录/Linux用户不是多租户强隔离，不复用带客户文件的长期进程。默认禁公网，受限资产broker只读素材和有限输出；无主站/支付/模型/D1/R2管理凭据。离线依赖与生命周期脚本审核，不限制合法艺术算法。

图片/录屏/文本/Logo/上传声音的P0边界来自输入配置，不偷偷开放HTML/SVG上传、HEVC、长视频、网页抓取或全部TTS语种。目标standard-3仅为试验起点，不承诺GPU；M0b按08在真实Cloudflare验证同源30秒复杂片、字体/seek/Canvas/WebGL/FFmpeg、网络限制、销毁重建和跨job残留，没有结果不开放客户不可信代码。

源码、媒体、音轨、正式QA和snapshot按有效引用、免费正常7天/付费正常90天及各自7天只读宽限保留。临时截图默认72小时且不长于项目正常期；已接受版本或活动作业引用按对应内容保留。等待用户最长24小时。主动删除以墓碑/取消/孤儿清理，24小时内清理不再合法引用的数据；72小时不是例外。财务必要记录独立且配置实际法定周期；常规日志不留prompt全文/源码/token。

性能分别测排队、方向、首帧、主预览、全目标准备、patch和编码交付；无基准目标保持null，不用硬超时当SLA。样本包含两用户组、15/30秒、复杂运动、两模型配置、空队列与4容器混合；报告人数、p50/p95、失败/人工介入/费用，不宣传未经测量95%。

验收命令与结果边界见 [06](06-testing-and-release.md) 和 [08](08-codex-execution.md)。当前文档、结构和内存参考测试不证明真实模型、浏览器、D1事务、Cloudflare或付款已实现。
