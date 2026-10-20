# 生产契约：版本、状态、指纹与交付

本章定义产品规格 v2.4 的跨模块契约。唯一结构协议为 `2.4.0`，见 `contracts/production.schema.json`；帧协议见 `contracts/render-protocol.d.ts`。结构、语义和资源授权须同时通过；可选创作字段以Schema为准。参考检查不是D1、渲染或生产服务。

生产入口显式使用 `{production:true}`，拒绝 `exampleOnly:true` 的清单及登记证据。校验context必须由可信服务从数据库和真实执行结果构建，不能接受请求体或Agent自报的授权、素材观察记录或检查结果。离线样例只验证结构和关联。

[01](01-product-prd.md)定义产品，[02](02-ux-and-ui.md)定义界面，[03](03-platform-presets.md)定义输出，[05](05-waffo-billing.md)定义交易，[09](09-sources-and-decisions.md)定义许可原则，[13](13-agent-native-production.md)定义创作。路由唯一登记在 `config/routes.json`，Agent请求/响应由 `contracts/agent-api.json` 引用Schema；实施顺序见[08](08-codex-execution.md)。

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

`resource_manifest`列实际素材的path、sha256、byteLength、mediaType和稳定licenseRef；audioEvents覆盖实际音频事件的sourceHash、licenseRef与帧范围，必须找到对应资源；variant.audioHash等于其清单audioEvents的canonical摘要，无声音时固定为空数组的摘要。asset broker按hash解析不可变存储引用，构建/渲染器提供实际访问的资源和声音记录，与清单核对，不能以Agent自己的清单证明无遗漏。字体子集、塑形和回退配置作为锁定源码/资源冻结；按实际文字验证字素簇、塑形及回退，`document.fonts.ready`不能证明无缺字。源码包不含自身manifest、QA输出、临时URL或运行日志。

`licenseRef`是服务端为素材固定的权利登记ID，不是“OFL”“CC0”或“已获授权”声明。可信登记记录按不可变版本保留依据及evidenceHash、素材字节hash、适用用途；依据可为平台创作、第三方许可或客户保存的授权声明。客户记录必须匹配workspace/project/素材字节，平台已登记来源才可共享。登记存在表示已保存依据，不证明声明真实或拥有版权。免费首次使用前，broker执行 `resourceRightsErrors` 的preview范围检查；商业冻结、编码和发布再按commercial_export检查，未知、缺依据或范围不符均BLOCK。P0平台内置素材须符合09的成片授权条件。

证据更新只新增外部登记版本，不改同一素材的licenseRef；可信assetBindings拒绝任意换绑。resourceManifestHash保留稳定ID而不含声明版本、许可核对日期或证据内容，避免证据更新变成付费内容变化。错误绑定的修正走免费correction，不能以新hash补收一次成片。

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
| factContentHash | factContentIdentity：去掉projectId/revisionId/exampleOnly，各fact去confirmedBy/confirmedAt/evidenceRefs，各binding去coverage，其余保留 |
| compositionHash | 完整CompositionManifest的canonical SHA-256；用于源包关联与帧会话精确身份 |
| contentHash | contentIdentity：去projectId/revisionId/exampleOnly/releaseEligible/factManifestHash/styleLabel；variants去qaReportHash并按targetId排序；实际源码、事实内容、依赖、声音、seed、时序、封面、runtime/renderer与规则版本保留 |
| variantHash | variantIdentity：目标sourceHash、layoutRulesHash/targetOverrideHash、锁依赖、目标resourceManifestHash/audioHash、factContentHash、seed/总帧/fps与固定layout |
| videoFingerprint | outputArtifactIdentity(video)：kind+artifactIdentity+markingProfileVersion；artifactIdentity包含variantHash、runtimeVersion、rendererImageDigest、固定encoding与layout |
| coverFingerprint | outputArtifactIdentity(cover)：kind+artifactIdentity+markingProfileVersion+coverFrame+jpg_v1；改封面帧不能复用旧JPG，可复用未变视频 |
| mappingFingerprint | outputArtifactIdentity(mapping)：kind+targetId+规则版本+videoFingerprint+coverFingerprint+mapping_v1；对应固定、无临时URL的目标映射 |

source/variant资源hash覆盖所有实际绘制依赖。QA、确认、许可/事实证据版本、标记策略和样式标签不单独产生新的成片次数。标记策略改变产物指纹及最终字节，不改变contentHash；必要重标记以免费correction绑定原release，不覆写旧收据。不同target的映射文件仍各自保存。

`contentHash`只是同一项目的计费身份，不能用于跨租户授权。规则/运行版本属于内容身份；用户主动采用新配置会形成新稿，平台安全兼容修复则走免费correction。哈希自指字段不得加入被哈希对象；改变规范化方式需新版本并保留已购执行能力。

## 4 Snapshot、Release与账务身份

`UNIQUE(project_id,content_hash)`确定release；重新确认snapshot不重复扣次。已撤销授权不能通过重放恢复，需恢复审查时返回RELEASE_RESTORATION_REVIEW_REQUIRED，按05处理。请求仍检查当前权限，同幂等键不同摘要409。

发现同内容既有release时返回原release及其**原始snapshot/批次**，不能把本次新snapshot重贴到原输出。若另选平台，用独立补平台请求；不修改initialTargetIds。首次预留固定首批MP4、JPG与映射文件的逻辑集合；每个target均有video/cover/mapping记录，允许共享实际对象。全部就绪、预留/grant有效、项目未删除才原子ready+consume+published_at。

中间文件不下载；最终失败释放预留，可在同release重新预留，consume仍按release唯一，release操作按reservation唯一。补平台不再预留成片次数，不改变已交付状态；ZIP随后派生，失败免费重试不决定首次消费。完整Q2与输出字节绑定、发布前完成，不能用付款前报告冒充成片检测。

快照保存全部目标源包、compositionHash、contentHash、事实/renderer、首次目标、usagePolicy及markingProfileVersion。usagePolicy固定termsVersion、rightsPolicyVersion、intendedUse=commercial_export和每个licenseRef的recordVersion，须可解析为可信历史记录；表示拟交付适用范围，付款和05规定的条件满足后才授予使用权。导出通过真实snapshotHash关联此收据，不复制一套授权规则。ready artifact必须有实际sha256、正确指纹和冻结target；首批逻辑输出不全不能发布。短期URL不入身份。

AI标记和观众披露分开：可信markingProfile按09及实际用途分别确定machineMarking、audienceDisclosure为required或有依据的not_applicable，并保存decisionRef。不得把所有动画或普通TTS都认作深度合成。付费视频/封面和免费ready预览都需markingEvidenceRef指向真实最终字节的检查结果，绑定输出ID、sha256、策略版本、workspace/project/revision；导出另绑定artifactFingerprint。ready预览的screenshotAssetId不得为空，可信检查记录须将assetId与实际sha256、上述作用域以及target/帧区间一同绑定，不能换成另一个已存输出。mapping不是媒体，不能用其标记代替视频/封面。C2PA只是技术选择；文件含标签或用户勾选不构成检测通过，真实标记、检测、转码后的表现按适用规则验收。

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

商品、权益增量、退款范围和依赖结清由05及agent-policy定义。本章只规定跨系统幂等和消费边界，不维护第二套价格表。

`create_project_request.requestTrial` 缺省false；仅Owner可绑定其已认证user_id。project、幂等结果与trial_claims原子创建，一个user跨工作区最多一个试用项目；并发最多一个granted，重复requestId返回同一project。已用完仍建无权益草稿并返回unavailable，未请求为not_requested。删除/复制/转移Owner/关联身份不重置累计记录。未获试用的草稿须先按05购创作权益，不能消耗免费云资源。

账号/设备/IP和全局限额叠加，设备/IP不能替代user_id。成功计量以可用候选交付为准；未交付的失败释放，已确认技术缺陷通过关联原consume的append-only补偿保留真实成本。免费预览和内部QA片段受访问授权、用途及费用限制，不提供可下载的免费高清交付。

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

FactManifest记录事实版本、原文、evidenceRefs、确认人/时间。商业文本/旁白绑定factIds、expectedText、target和半开帧区间；expectedText须等于已确认text。evidenceRefs从可信证据登记解析并绑定workspace/project、来源字节hash和确认文案hash；缺失、越界或张冠李戴均BLOCK。可信检查按13识别general/testimonial/outcome/promotion；后三类必须有实际来源证据，客户声明不能单独替代。此机制检查来源与确认链，不自动认证真实性。AI改写商业句子须确认新版本，不能凭真数字附带新保证；装饰不伪造factId，空价格不补造。

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

素材、成片、快照和缓存的保存与删除按04/05执行。有效作业引用须可运行；主动删除先墓碑/取消再清理，晚到产物回收。必要交易、授权和侵权证据与完整客户媒体分离，不能借不可变快照永久保留素材；常规日志不留prompt全文/源码/token。

性能分别测排队、方向、首帧、主预览、全目标准备、patch和编码交付；无基准目标保持null，不用硬超时当SLA。样本包含两用户组、15/30秒、复杂运动、两模型配置、空队列与4容器混合；报告人数、p50/p95、失败/人工介入/费用，不宣传未经测量95%。

验收命令与结果边界见 [06](06-testing-and-release.md) 和 [08](08-codex-execution.md)。当前文档、结构和内存参考测试不证明真实模型、浏览器、D1事务、Cloudflare或付款已实现。
