# 生产契约：版本、状态、指纹与交付

本章定义产品规格 v2.5 的跨系统不变量；协议为 `2.5.0`。字段类型只在 [Schema](../../contracts/production.schema.json)、[帧协议](../../contracts/render-protocol.d.ts) 和 [创作运行时](../../contracts/composition-runtime.d.ts) 定义；本章补充身份、状态、授权和执行语义。参考检查不是生产服务。

生产入口显式使用 `{production:true}`，拒绝 `exampleOnly:true` 的清单及登记证据。校验context必须由可信服务从数据库和真实执行结果构建，不能接受请求体或Agent自报的授权、素材观察记录或检查结果。离线样例只验证结构和关联。

职责按 [PRD 索引](README.md) 划分：routes 注册 URI，agent-api 绑定请求/响应，05 定义交易，09 定义许可原则，13 定义创作方法，08 定义实施顺序；消费方引用，不复制另一套规则。

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

CompositionManifest 固定 project/revision、15/30 秒、30 fps、450/900 帧、seed，以及源码、依赖、资源、布局、事实、runtime/renderer、平台规则和 `renderProfile`。每个 variant 的 `targetOverrideHash` 指向不可变适配内容，无覆盖时为 null。`styleLabel` 和内容语言元数据可省略；网站 Cookie/语言/主题不进入创作身份。

`resource_manifest` 保存实际素材的 path、sha256、byteLength、mediaType 和稳定 licenseRef。Asset broker 按 hash 解析不可变存储；可信构建/渲染记录实际访问的资源、音源和混音，与清单核对，不能只信 Agent 自报。源码包保存代码和静态创作声明，素材单独按资源 hash 引用；不包含自身 manifest、QA 输出、临时 URL 或日志。字体子集、塑形和回退配置一同冻结；按实际文字检查字素簇、塑形和回退，不能用 `document.fonts.ready` 证明无缺字。

当前编辑值随不可变源码包保存，并计入源包及相关目标的源码摘要。`RuntimeContext.values` 只能从该冻结版本构造，不能从当前草稿或浏览器状态补入。

**音频冻结：** AudioPlan 的未合成事件允许缺音源与混音细节；进入资源清单的 `frozenAudioEvent` 必须显式提供音源、许可、半开帧区间、`sourceOffsetFrames`、`gainDb`、`fadeInFrames` 和 `fadeOutFrames`，零值不能靠实现方猜默认值。源内偏移和事件长度不得超过实际解码音源。可选 `gainAutomation` 是相对事件起点的整数 `frameOffset` 与相对基础 gainDb 的增量 dB；必须含 0 和事件长度两个端点、严格递增，按 linear-dB 插值。Ducking 编译为这些关键帧。淡入淡出使用线性振幅包络，与增益相乘；两段长度之和不能超过事件长度。

混音统一为 48 kHz、双声道；1 帧等于 1,600 个音频采样帧。最终 WAV 恰为 `totalFrames × 1600` 个采样帧，空白补静音，处理顺序与后处理由固定 `mixerVersion` 决定。`mixedAudio` 固定资源路径、真实 sha256、采样率、声道和 mixerVersion，必须解析到资源表中同路径/同 hash 的实际 WAV。可信解码观察 `audioMetadata` 按字节 hash 保存 sampleRate、channels、sampleFrames；校验音源为音频、源内时间范围及混音的采样率/声道/完整片长，不只检查清单自报值。

`audioHash = digest({audioEvents, mixedAudio})`；静音只允许空事件表和 `mixedAudio:null`，不制作假音轨。预览与导出读取同一混音字节，可信观察记录须证明实际取用；编码阶段不临时改音量、重新 ducking 或重新混音。声音来源的授权链仍逐项保留，最终 WAV 不能代替来源证据。参考验证器只核对可信解码/执行记录，不能据此声称已运行真实解码器或混音器。

`licenseRef`是服务端为素材固定的权利登记ID，不是“OFL”“CC0”或“已获授权”声明。可信登记记录按不可变版本保留依据及evidenceHash、素材字节hash、适用用途；依据可为平台创作、第三方许可或客户保存的授权声明。客户记录必须匹配workspace/project/素材字节，平台已登记来源才可共享。登记存在表示已保存依据，不证明声明真实或拥有版权。免费首次使用前，broker执行 `resourceRightsErrors` 的preview范围检查；商业冻结、编码和发布再按commercial_export检查，未知、缺依据或范围不符均BLOCK。P0平台内置素材须符合09的成片授权条件。

证据更新只新增外部登记版本，不改同一素材的licenseRef；可信assetBindings拒绝任意换绑。resourceManifestHash保留稳定ID而不含声明版本、许可核对日期或证据内容，避免证据更新变成付费内容变化。错误绑定的修正走免费correction，不能以新hash补收一次成片。

`targetId = presetId + ':' + aspectId`。服务器依据**快照固定的**rulesVersion读取合法配对、presetVersion、尺寸、安全区与编码；当前六平台七target。比例分别存在不代表配对有效，例如TikTok:square拒绝。加载不到固定规则版本则 PRESET_VERSION_UNAVAILABLE，不用当前配置代替。

候选可以只覆盖当前目标；releaseEligible前必须有该规则版本全部合法target的源分支/资源/字体/音轨/coverFrame与Q0/Q1、必要片段及事实复核。相同画幅只有源码、资源、声音、参数经验证等价才可共享，不按比例自动去重。releaseEligible是准备资格，不是完整高清编码通过证明。

准备平台是显式prepare_targets操作，响应式语义布局优先，并仅对 Q1 失败镜头做 Agent 定点适配；按原revision/target去重和独立系统预算，不扣额外成功次数。同operation下全部target、attempt和子调用共同受美元上限约束，不能为每个目标重开一份无限预算。共享源码、布局规则、依赖、资源及每个target的覆盖项必须进入冻结身份，不能只保存一个可变规则名称。每新增构图的模型、CPU、字幕/字体、QA 和返工成本应计量，报告一次通过率与修复开销，不假设派生成本为零。它不能原地追加不可变revision；产出新的候选revision并CAS确认，保留原稿。改变原主目标风格或事实必须重新向用户确认，不能伪装成无变化准备。

目标 Q1 覆盖关键时点、转场和高风险动态片段，可用真实布局的低清取帧，不要求付款前全部高清编码。静态图不能替代时序 QA。渲染缓存按 targetId 隔离；同画幅不能自动证明绘制、字幕、音频和安全区等价。分别验证后，相同最终字节可按 sha256 共用物理对象，不承诺七目标恒为四份视频。

`POST .../export-snapshots`只冻结已经准备好的revision，缺目标/报告409 VARIANTS_NOT_READY；不会在请求内暗中做昂贵生成。付款冻结所有来源，首次只编码所选目标；后补平台仅运行被冻结源包，不再调用模型。系统缺陷以独立correction关联原release、免费且有审计，原文件不覆盖。

## 3 内容与产物指纹

规范实现唯一入口为 [packages/contracts](../../packages/contracts/index.mjs)，脚本和生产代码共同调用，不另抄算法。`canonical` 按 [RFC 8785/JCS](https://www.rfc-editor.org/rfc/rfc8785) 处理 JSON 数据域：对象键按 UTF-16 码元排序，数组保持声明顺序，采用 binary64 数字序列化，拒绝非有限数和孤立代理码元；入站原始 JSON 经 `parseCanonicalJson` 拒绝重复键。不对用户 Unicode 原文归一化。`digest` 计算规范 UTF-8 字节的 SHA-256；实际文件直接计算原始字节 SHA-256。

`contentIdentity` 的 variants 按同一 UTF-16 比较规则排序，禁止 locale/ICU 排序。固定测试向量包含完整期望序列及摘要，跨语言实现必须通过；不以两份实现互相算出一样的值代替独立向量。

| 身份 | 精确定义与用途 |
| --- | --- |
| factManifestHash | 完整FactManifest的canonical SHA-256，含确认主体/时间及绑定覆盖证据 |
| factContentHash | factContentIdentity：去掉projectId/revisionId/exampleOnly，各fact去confirmedBy/confirmedAt/evidenceRefs，各binding去coverage，其余保留 |
| compositionHash | 完整CompositionManifest的canonical SHA-256；用于源包关联与帧会话精确身份 |
| contentHash | contentIdentity：去 projectId/revisionId/exampleOnly/releaseEligible/factManifestHash/styleLabel/renderProfile；variants 去 qaReportHash 并按 targetId 排序；源码、事实内容、依赖、声音、seed、时序、封面、runtime/renderer 和规则版本保留 |
| variantHash | variantIdentity：目标sourceHash、layoutRulesHash/targetOverrideHash、锁依赖、目标resourceManifestHash/audioHash、factContentHash、seed/总帧/fps与固定layout |
| audioHash | audioIdentity：完整冻结 audioEvents 与 mixedAudio；计划外的混音参数或重新混音不得进入交付 |
| qaInputHash | qaInputIdentity：目标 artifactIdentity、targetId、coverFrame、presetRulesVersion、factManifestHash 和 qaProfileVersion；不含报告自身或 compositionHash |
| videoFingerprint | outputArtifactIdentity(video)：kind+artifactIdentity+markingProfileVersion；artifactIdentity 含 targetId、variantHash、runtimeVersion、rendererImageDigest、renderProfile、encoding 和 layout |
| coverFingerprint | outputArtifactIdentity(cover)：kind+artifactIdentity+markingProfileVersion+coverFrame+jpg_v1；改封面帧不能复用旧JPG，可复用未变视频 |
| mappingFingerprint | outputArtifactIdentity(mapping)：kind+targetId+规则版本+videoFingerprint+coverFingerprint+mapping_v1；对应固定、无临时URL的目标映射 |

源码/资源摘要覆盖实际执行依赖。QA、确认、许可/事实证据版本、标记策略、采样配置和样式标签不单独产生新成片次数。采样或标记策略变化须改变产物指纹并重检，已购快照继续锁原策略；必要修复走原 release 的免费 correction，不覆写旧收据。不同 target 的逻辑产物和映射仍各自保存。

`contentHash`只是同一项目的计费身份，不能用于跨租户授权。规则/运行版本属于内容身份；用户主动采用新配置会形成新稿，平台安全兼容修复则走免费correction。哈希自指字段不得加入被哈希对象；改变规范化方式需新版本并保留已购执行能力。

## 4 Snapshot、Release与账务身份

`UNIQUE(project_id,content_hash)`确定release；重新确认snapshot不重复扣次。已撤销授权不能通过重放恢复，需恢复审查时返回RELEASE_RESTORATION_REVIEW_REQUIRED，按05处理。请求仍检查当前权限，同幂等键不同摘要409。

发现同内容既有release时返回原release及其**原始snapshot/批次**，不能把本次新snapshot重贴到原输出。若另选平台，用独立补平台请求；不修改initialTargetIds。首次预留固定首批MP4、JPG与映射文件的逻辑集合；每个target均有video/cover/mapping记录，允许共享实际对象。全部就绪、预留/grant有效、项目未删除才原子ready+consume+published_at。

中间文件不下载；最终失败释放预留，可在同 release 重试，consume 按 release 唯一，release 操作按 reservation 唯一。补平台不预留成片次数，不改变已交付状态；ZIP 派生失败免费重试，不决定首次消费。完整 Q2 发布前执行，video/cover 的 `qualityEvidenceRef` 解析到可信登记，绑定实际输出 ID、target、sha256、artifactFingerprint、QA 策略及检查版本；mapping 不借此冒充媒体检查。付款前报告不能替代成片检测。

快照保存全部目标来源、compositionHash、contentHash、事实/renderer、首次目标、usagePolicy、markingProfileVersion 和 qaProfileVersion，采样策略通过不可变 Composition 固定。usagePolicy 固定条款/权利版本、商业导出用途及各 licenseRef 的记录版本，须能解析到可信历史记录；付款及 05 的条件满足后才授予使用权。导出保留该 QA 策略，通过 snapshotHash 关联收据。ready artifact 必须有实际 sha256、正确指纹和冻结 target；首批输出不全不能发布。短期 URL 不入身份。

AI标记和观众披露分开：可信markingProfile按09及实际用途分别确定machineMarking、audienceDisclosure为required或有依据的not_applicable，并保存decisionRef。不得把所有动画或普通TTS都认作深度合成。付费视频/封面和免费ready预览都需markingEvidenceRef指向真实最终字节的检查结果，绑定输出ID、sha256、策略版本、workspace/project/revision；导出另绑定artifactFingerprint。ready预览的screenshotAssetId不得为空，可信检查记录须将assetId与实际sha256、上述作用域以及target/帧区间一同绑定，不能换成另一个已存输出。mapping不是媒体，不能用其标记代替视频/封面。C2PA只是技术选择；文件含标签或用户勾选不构成检测通过，真实标记、检测、转码后的表现按适用规则验收。

订单授予、退款冻结、晚成功付款、素材失效、保留和恢复按 [05](05-waffo-billing.md)。普通界面注销不取消已付款交付。付费snapshot/runtime/镜像在其正常期、宽限与在途任务仍引用时必须可运行；安全停用走有审计的免费兼容修复。

Directions、Treatment、AudioPlan 和 PatchResult 的字段以 Schema 为准；可信层检查总帧、半开区间和关联。计划、解读和摘要是过程证据，不单独改变 contentHash；真正修改执行源码、参数、事实、音频、资源或布局才改变创作内容。

购买结构和响应由 API/Schema 定义，资格及并发槽按 05。`top_up_only` 不带 snapshot、不导出；`purchase_and_export` 必须绑定已准备并确认的全部目标快照。升级源只用于升级商品，金额、币种、权益与支付回跳由服务端决定；结构合法不代表购买已获授权。

## 5 RenderProtocol

可信控制器解析 revision/target、固定规则和 renderProfile 后建立短期 session；源码不能自选尺寸、快门、源包写入或支付/模型权限。生命周期为 created→initializing→idle→seeking→ready，后续 ready→seeking；活动态可 failed/disposed。init 和所有 seek/sample 共用串行画布，不并行覆盖待取样内容。

命令/响应都有 protocolVersion/sessionId/requestId/sequence/revisionId/targetId；帧命令带 frameIndex，子帧另带 sampleIndex，帧与子帧就绪响应回显 manifestHash。每次调用使用匹配请求 ID 和递增 sequence；revision/target/profile 在会话内固定，变更须新建会话。错误、迟到、已 dispose 或旧 iframe 响应不能用于取帧。时限取 agent-policy；可信控制器校验身份、解码、字体、视频位置和 Shader 屏障后截图，不信源码自报 pass。

对外 `seekFrame(n)` 只收整数 `0 ≤ n < N`，请求冻结 profile 下的最终帧，名义时间为 n/30；N 为 450 或 900，视频总时长 N/30。renderProfile 只能从可信 `platform-presets.renderProfiles` 选择，按 §3 进入产物和 QA 身份。单样本 profile 的 shutterAngle 为 0，直接采样 n/30。多样本 profile 的样本数 M 为 4 或 8、快门角度 A 由冻结配置决定；第 j 个样本（0≤j<M）的秒数为：

```text
t = clamp((n + ((j + 0.5) / M - 0.5) * (A / 360)) / 30, 0, (N - 1) / 30)
```

`centered-box-v1` 在快门区间中点等距取样，`clamp-v1` 将首末名义帧外的样本固定到边界画面。时间以等值安全整数有理数传给 `draw(time)`，不向外开放任意小数 seek。内部 `sampleSubframe` 只接受可信 Renderer session，sampleIndex 必须小于冻结 M；逐样本完成资源屏障后回 `sample-ready`，全部样本在线性光空间等权平均，再发最终 `frame-ready`。单样本回执不能替代合成帧；成本按实际样本数计量。

创作模块静态声明 editables、markers 和 regions；可信构建检查唯一 ID、帧/数值范围和安全源码路径，运行时返回的区域只能引用已声明 ID。`prepare` 固定输入和 tween 端点，`draw(time)` 完整重建该时间的像素/区域，不累积播放状态。禁止 Date.now、未受控 Math.random、依赖 requestAnimationFrame/墙钟的推进、CSS transition 隐藏时间、出网及采样时播放音效/新增事件；仿真可固定初态重放或预烘焙。画面子帧不推进音频，预览音轨按名义播放时间定位同一 mixedAudio。冷/顺/逆序一致性仍需实际环境验证；WebGL 不可用返回 CAPABILITY_UNAVAILABLE，不静默变成静态图。

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

商品与试用状态见 05，数值只取 agent-policy。试用 claim、项目和幂等结果原子创建，只允许 Owner 绑定本人 user_id；跨工作区、删除、复制、转移或身份关联不重置累计资格。账号、设备/IP 和全局限额叠加，后两者不替代 user_id。未交付的失败释放次数，已确认技术缺陷以关联原 consume 的追加补偿处理，真实费用保留。免费预览/内部片段仍受授权和预算限制。

额度预留、run和outbox同事务。`UNIQUE(workspace_id,project_id,operation_id,kind)`；请求幂等另绑定actor/route/requestId/摘要。内部attempt/工具重试不另预留成功次数；不同操作竞争最后额度必须原子仲裁。

费用维度和用量字段见 04，包括缓存 tokens、子调用和实际媒体计算。每次模型/计费工具调用前，在 operation 已用及在途费用之外原子预留最坏成本，结束后结算实际 usage；未知结果继续占上限待对账。子模型、冷审、ASR、方向、多目标和修复共用 operation 上限，换 attempt 不重置。退次数不退系统费用；新操作仍受累计预算约束。真实费用超过预留时记录超额并停止新调用，不截掉账单。

每次新调用还须原子检查 `maxMicrosPerUserWindow` / `maxMicrosPerProjectWindow` 对应的滚动窗口（配置的 `usageWindowHours` / `usageWindowMode`），计入成功/失败的实际云费用和全部未结算最坏预留，不能只算失败。通用窗口、失败窗口、UTC 免费总硬上限和 operation 预算须同时满足；新操作、付款、退款或返还次数均不清零。付费交付的必要费用/容量预留不能被非交付调用耗尽。未标定上限保持 null 和 enabled=false；参考算例不代替真实 D1/DO 原子累计验收。

改稿在排队/预留前检查批注数量和 Unicode code points 总量，超限 422，不截断。字符数、供应商 token 上限和美元预算分别检查；每个可用结果计入全部失败、修复和目标验证费用，缓存按实际命中记录。

暂停保存工作、释放物理容器，24小时窗口内可访问未过期候选；resume仅在原权限、base仍有效、窗口内且原预算剩余时继续同run。上限耗尽409 BUDGET_EXHAUSTED，前端不能提高。可以缩小需求发起受全局限流的新操作或使用现有可用稿；没有批准SKU不提供“付款续跑”。到期释放未消费预留，已消费不因关页返还。

## 7 跨系统状态机

| 对象 | 当前状态→事件→目标状态 | 权限、原子影响与恢复 |
| --- | --- | --- |
| Agent run | 无→submit→queued | 成员、正常期、非墓碑、次数与预算，原子reserve+run+outbox；重复请求返回原结果 |
| Agent run | queued→start→active | 全局/工作区租约与generation匹配；真实attempt计数 |
| Agent run | active→ask_user→awaiting_user | 检查点持久化、释放容器，不占CPU等待 |
| Agent run | awaiting_user/paused_budget→resume→queued | 原权限/base/24小时窗口/剩余预算重查；同run |
| Agent run | active/validating→budget_limit→paused_budget | 停止新调用，保存检查点与预算结算，释放资源 |
| Agent run | active→candidate→validating | 保存候选不可变hash，暂不切当前指针 |
| Agent run | validating→pass→succeeded | 重新核对权限/generation/项目/QA，原子候选ready+一次consume+outbox |
| Agent run | validating→repair→active | 同预算且累计修复<2，不新增收费run |
| Agent run | 非终态→cancel→cancelled | 提升generation，释放未消费预留和资源；晚到不能提交 |
| Agent run | 非终态→fail/expiry→failed | 具体原因及真实成本，释放未消费预留，旧稿保留 |
| 候选 | ready→accept→accepted | §1 CAS、权限与QA同时验证；同请求同候选幂等 |
| 候选 | ready→reject→rejected | 不改当前稿，不返已交付成功次数 |

| 环节 | 事件 | 处理与结果 |
| --- | --- | --- |
| 版本冻结 | 用户确认已准备版本 | 所有合法target来源和报告齐全才创建snapshot；不生成或付款 |
| top_up_only 付款 | 权威付款确认 | 按05原子写paid、grant和outbox；无snapshot或导出intent |
| purchase_and_export 付款 | 权威付款确认 | 按05原子写paid、grant、导出intent和outbox；后续排队渲染，关闭网页仍交付 |
| 导出重试 | 部分文件未成功 | 只重试失败指纹，最多3个真实编码attempt；有效产物复用 |
| 导出发布 | 全部产物通过 | 原子发布批次并consume，exportManifest进入ready；退款或删除先发生则阻止发布 |

终态不能通过普通resume重新活动；需要新的授权操作。长调用结束、消费、接受、发布均重查权限/generation/墓碑。移除发起成员取消未提交创作副作用，但已收款交付由项目权益继续驱动；删除项目/工作区撤销新授权、提升generation、取消作业并清理，晚到文件孤儿回收，不复活项目。退款只冻结关联grant及未发布预留，不能影响无关订单。

真实并发、故障和恢复验收按 06；内存状态测试不构成 D1 实现。源码修复和编码重试分开计数，仍共享累计费用上限，不能相乘失控。

## 8 事实与QA授权

FactManifest记录事实版本、原文、evidenceRefs、确认人/时间。商业文本/旁白绑定factIds、expectedText、target和半开帧区间；expectedText须等于已确认text。evidenceRefs从可信证据登记解析并绑定workspace/project、来源字节hash和确认文案hash；缺失、越界或张冠李戴均BLOCK。可信检查按13识别general/testimonial/outcome/promotion；后三类必须有实际来源证据，客户声明不能单独替代。此机制检查来源与确认链，不自动认证真实性。AI改写商业句子须确认新版本，不能凭真数字附带新保证；装饰不伪造factId，空价格不补造。

用户口播/选用录屏原声的商业主张须先有用户确认的逐段转写稿并绑定 factIds；手填或经验证 ASR 均可，不能猜词或声称未知的逐词对齐。报告区分已确认引用、运行时文本对照、实际像素/语音覆盖。Canvas/Shader/纹理文字无法提取时标明覆盖不足，以 REVIEW 要求当前成员复核指定区间；信息流目标按 13 检查静音可理解及字幕。

`qualityReport` 是 Q0/Q1 检查输入的报告：project/revision/target、sourceHash、factManifestHash、qaProfileVersion、checkerVersion 和 `qaInputHash` 必须与可信服务解析的当前输入/期望策略一致。仅新增 revision 不能把旧报告原样移入；资源、布局、声音、封面帧、运行时、镜像或采样策略变化也须重算并重检，不能只比较 sourceHash。仅改封面不要求未变视频重新编码。报告由 variant 的 `qaReportHash` 正向引用，qaInputHash 不含报告自身，避免循环哈希。检查器版本必须获该可信 QA 策略批准，报告不能自行选择放宽规则。旧报告不可通过修改自报 hash 取得可信检查身份。

Q2 另由 §4 的 `qualityEvidenceRef` 绑定真实媒体字节及输出指纹，须确认所用混音、实际帧数/时长、编码和检查结论后才 ready。QA 后重新编码、更换封面或替换文件都须重新绑定检查；相同源码并不足够。

| 等级 | 内容 | 谁可豁免 |
| --- | --- | --- |
| BLOCK | 越权/密钥/出网/路径、未授权资产、未确认/不一致事实、非法target/帧/编码、缺依赖、不复现、无rights | 任何用户和Agent都不可豁免，修复并重检 |
| REVIEW | 有意停顿/硬切、复杂商业文本覆盖不足、阅读与风格风险 | 当前有权成员按rule/revision/target/帧区间及到期确认，变更即失效 |
| INFO | 已声明的非关键视觉/节奏提示 | 展示，不阻断 |

缺字、授权或商业事实错误是 BLOCK；节奏稀疏、钩子不足和调色相近按 REVIEW/INFO，不能把风格判断伪装成硬标准。自动闪烁检测不是光敏医疗认证；正常速度视听按运营样本和客户复核，不默认每单后台人工批准。

## 9 资源、输入与保存

所有计算类别共同受 agent-policy 的全局/工作区/任务并发上限约束。同容器工具复用令牌，新开实例原子申请，不能持有全部令牌等待子任务；暂停/等用户释放实例，付费交付预留容量并优先。

实例是信任边界；每job/generation由服务端派生实例名，Composer与Renderer都执行不可信代码，不因镜像固定就信任。独立目录/Linux用户不是多租户强隔离，不复用带客户文件的长期进程。默认禁公网，受限资产broker只读素材和有限输出；无主站/支付/模型/D1/R2管理凭据。离线依赖与生命周期脚本审核，不限制合法艺术算法。

输入范围取 input-capabilities，不因内部工具支持而扩大公开上传、抓取或 TTS 能力。M0b 的目标实例、功能与隔离矩阵按 06/08 在真实 Cloudflare 验证；实例名称不证明 GPU 或兼容性，未通过不开放客户不可信代码。

素材、成片、快照和缓存的保存与删除按04/05执行。有效作业引用须可运行；主动删除先墓碑/取消再清理，晚到产物回收。必要交易、授权和侵权证据与完整客户媒体分离，不能借不可变快照永久保留素材；常规日志不留prompt全文/源码/token。

性能按 06/08 分阶段测排队、方向、首帧、主预览、准备、改稿和交付，报告样本、p50/p95、失败/人工介入及费用；未测目标保持 null，不把硬超时当 SLA。检查结果与真实实施状态分开记录。
