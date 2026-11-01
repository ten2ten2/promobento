# 生产契约：版本、状态、指纹与交付

本章规定产品规格 v3.0 / 协议 `3.0.0` 中影响保存、验证、计费和交付的共同要求。当前内部实现以 [NativeProject 1.0.0](../../contracts/native-project.schema.json)、[共享原生身份](../../packages/contracts/src/native-project.mjs)和[云端入口](../../apps/cloud/README.md)为准，界面流程见[02](02-ux-and-ui.md)。

客户草稿、购买、冻结、输出审核和交付服务尚未实现；下文的客户实体、字段和状态描述产品要求，随对应服务建立真实契约和事务，不再维护另一套内存参考控制器。实际能力见[实施状态](../implementation-status.md)。权限、素材、摘要和检查依据必须来自可信存储与实际观察；示例、离线夹具或Agent自报不能作为生产放行证据。

## 1 唯一版本模型

| 实体 | 必须成立的规则 |
| --- | --- |
| projects | workspace_id、current_revision_id、generation、deleted_at；当前草稿指针必须指向本项目 |
| project_revisions | 唯一内容版本实体；id/project/parent/content_hash/manifest_key/created_by；一旦写入内容不可变 |
| composition_sources / composition_variants | revision关联源码、锁定依赖、runtime；UNIQUE(revision_id,target_id)；源码/资源/声音按实际hash引用 |
| agent_runs / agent_run_steps | 一次用户操作及内部步骤；attempt不是队列投递次数，generation是写入栅栏 |
| agent_candidates / agent_patches | base/candidate revision、scope、read/write set、验证状态；状态在关联记录，不更新源码内容 |
| export_snapshots / export_releases | snapshot是确认收据；release是按项目及内容身份去重的实际交付/版本消费实体 |
| fact_manifests | 保存事实内容、当前确认及证据引用；创作内容与确认记录分别计算摘要 |
| quality_reports / quality_associations / quality_waivers | 报告保存检查结果；关联绑定当前 revision；豁免保存成员对指定 REVIEW 的确认，三者分别不可变 |

所有对象的 workspace 从数据库归属推导，外键与事务条件必须拒绝跨项目 ID 拼接。空草稿的首次 `creative_generate` 使用 `baseRevision:null`；改稿与目标准备必须有已保存基线。三类操作统一通过 candidate 查询、接受和拒绝。接受时检查成员权限、项目期限、删除状态、候选 ready 状态、输出审核、baseRevision、If-Match、读写集合和资源；两个基线同时提供时必须一致。再通过 CAS（仅在当前版本仍等于基线时写入）切换草稿、标记接受并写 outbox。同一基线的两个候选只能接受一个，另一个返回 409 并保留，不能自动合并不可信代码。当前事实尚待确认可以作为草稿接受，冻结资格另按 §8 检查。

候选操作先验证当前权限、作用域和幂等摘要；已有同键同请求返回原结果，不能因候选已 accepted/rejected 再次执行状态检查而拒绝重放。新接受操作才检查当前基线和准入条件；拒绝只改变候选状态，不要求其旧基线仍为当前草稿。

客户候选入口须统一请求校验、身份与作用域、请求指纹、重放、当前状态检查和提交。首次创作、改稿和目标准备均返回实际候选与影响摘要；未获准展示或已取消时不返回计划正文。CAS、消费与outbox须在生产数据库同事务实现。

恢复使用 `PATCH /api/projects/:projectId/draft` 的 restoreFromRevisionId，与changes互斥，创建新revision，可复用源包；不改订单或余额。素材清理后409 SOURCE_UNAVAILABLE。源包相同而revisionId/检查记录变化不必然是新的付费内容。

普通参数保存检查权限、`baseRevision`、静态声明和值的范围，通过 CAS 创建新 revision；不调用模型，也不自动启动 Q0/Q1 或编码。修改事实绑定文本时，同一事务须更新所有绑定值、创建未确认事实版本并返回 `unconfirmedFactIds`。一次请求给同一事实写入不同文本时拒绝，不能由最后一项覆盖。绑定事实的文本保存时不能为空白；本地输入过程中可以暂时清空，但不能因此创建空事实。

反向更新事实也要同步全部绑定文字及其预期原文；有绑定时必须提供当前`baseRevision`，并检查事实记录版本。合并后的完整工程参数须通过类型、可见文字、范围、时序及文件字节上限校验，不能只检查这次传入的字符串。全部绑定事实在更新前后都须存在，包括只提供依据的事实；缺失时拒绝，不能过滤后保留悬空引用。删除仍被引用的事实须先改源码解除绑定。事实、参数、绑定与新revision须在同一数据库事务写入。

`facts_result` 返回新建的 `revisionId`（未创建时为 null）、`currentRevisionId` 与 `unconfirmedFactIds`。非空 `revisionId` 必须等于同一响应的 `currentRevisionId`；`unconfirmedFactIds` 必须与该响应中确认字段为 null 的事实 ID 集合完全一致，不能漏报、多报或仅比较数量。校验以同一响应快照为准；幂等重放原成功结果时，不与后来推进的当前草稿比较。实际事务及重放服务仍按 §1 的数据库要求实现。

`qualityEligibility` 是服务端计算的 `unchecked/checking/blocked/review_required/ready`，不写入不可变 Composition。草稿保存成功不等于可以冻结。项目响应同时给出试用状态、整片/AI 改稿/成片余额，以及 `activeRunIds`、`pendingCandidateRevisionIds`、`activePreviewIds`、`activeMediaJobIds` 和 `activeReleaseIds`，刷新后按这些引用恢复任务。`jobs.get` 只查询素材处理；创作、预览与交付由各自持久 ID 查询，交付使用 `exports.get`，并返回实际候选或产物引用。

### 数据库约束清单

首个数据库迁移须同时提交以下约束的并发测试；文档或 SQL 文本检查不能代替真实数据库执行。

| ID | 必须在数据库或同一原子事务中成立 |
| --- | --- |
| DB-SCOPE | revision、素材、报告、快照、订单等通过项目及工作区组合关联，拒绝跨租户 ID 拼接 |
| DB-TRIAL | trial_claims 的 user_id、trial_project_id 分别唯一；建项目、claim、grant和请求幂等结果同事务 |
| DB-REVISION | UNIQUE(revision_id,target_id)；接受/恢复以 current_revision_id、generation、非墓碑和当前权限做条件写 |
| DB-CHECKOUT | 同项目只有一个待定或有效初始购买槽；每个有效单片来源只有一个待定或有效升级槽；释放条件按05 |
| DB-CREATIVE | 创作预留按workspace/project/operation/kind唯一；consume/release/补偿可重放且不删除真实费用 |
| DB-RELEASE | UNIQUE(project_id,content_hash)；首次批次发布、有效grant/预留检查和唯一consume同事务 |
| DB-COST | costEvent的eventId/dedupKey幂等；同charge替代链只接受一个后继，scope一致，预留与结算原子更新 |
| DB-OUTBOX | 业务状态与outbox同事务；consumer以事件/作业身份去重，lease与generation阻止晚到提交 |

## 2 Manifest、目标与冻结准备

新内部创作使用NativeProject 1.0.0：`index.html`与普通本地工程文件、固定huashu commit、15/30秒、30fps和单画幅composition。不同画幅独立生成、审片和导出；每个文件固定path、R2 key、SHA-256、byteLength、mediaType。客户`project_revisions`、购买快照和完整冻结事务仍待接入，不能把内部工程清单当作已完成的客户冻结服务。历史原文、已存摘要、回执和环境按其冻结身份保留，不通过新创作入口重解释旧项目。

素材与字体的真实文件身份、来源及使用依据随项目保存；broker只允许本次已准入文件。可信检查核对实际读取的资源、音源和混音，不能只信Agent自报。原生源码保存原始字节，不混入临时URL、QA输出或日志。字体、塑形和回退配置随实际工程冻结；按实际文字验证，不能用`document.fonts.ready`证明无缺字。画面事实依据必须对应实际可见内容，未显示的声明文字不能充当证据。

原生 HTML/JS/CSS 是创作源，不再要求 `film.json`、`PB.scene` 或第二份可执行场景协议。Brief 和 Treatment 记录事实与导演决策，不用于宿主绘制。保存源文件原始 UTF-8 字节，不因 API 版本升级改写或归一化客户文案；源码修改由 baseRevision 约束并产生新版本。

原生变量保存在作品文件中；客户直接编辑须检查实际声明的类型、范围、事实绑定和所有受影响画幅，不另建一套当前值文件。素材替换须同时匹配可信媒体类型与可绘授权，事实证明附件不能仅因出现在存储中就用于画面。可信检查与导出只读取已保存版本，本地未保存预览不得冒充冻结结果。

首版影响时序的本地修改转交AI改稿，包括事实同步间接影响时序的修改。没有明确的时间补偿规则时，不能只改一个时间点却留下旧音轨、转场或录屏区间；所有修改仍受固定总帧数和完整音画验证约束。

**音频冻结要求：** 声音事件使用稳定身份，插入或重排不能使画面标记指向另一事件。冻结保存实际音源、使用依据、时间区间、源内偏移、增益、淡入淡出及实际采用的增益曲线；源范围不能超过真实解码时长，缺省值必须由固定实现明确记录。事件与混音文件均须可复现，不能只保存模型的声音计划。

保留的[声音计划](../../contracts/audio-plan.schema.json)与[音乐准入](../../contracts/audio-admission.schema.json)服务声音/素材辅助结构，不能据其存在宣称客户音乐服务已完成。实际使用的乐谱、上传音轨、派生文件及片长须与来源证据一致；许可来自可信记录，作品不能自签。原生导演的声音方法见[13](13-agent-native-production.md#5-声音与实际时间)，客户冻结仍须满足本节的实际文件与声音要求。

有声交付统一48kHz、双声道；30fps下一帧对应1,600个音频采样帧。冻结母带须与实际片长一致，路径、原始字节摘要、采样率、声道、采样长度和处理版本由可信解码/执行记录确认。用户选择静音时不伪造音轨；编码前导/尾部按[06](06-testing-and-release.md)的有效播放区间检查。

原生声音准备和混音可能派生新的音频文件或修改 HTML 引用，因此导出保存实际完整工程及 rendered-project manifest。输入 project hash、实际 HTML hash、实际工程 hash 和最终 MP4 字节 hash 分别记录，不能互相代替。业务音频冻结仍需绑定实际音源与混音字节。

声音内容身份须包含实际事件及混音字节，许可补证或单纯处理版本记账不能算新的创作。客户预览与交付使用同一冻结声音；编码不得暗中重新配乐、ducking或更换音源。最终AAC须实测；只为纠正编码引入的响度/真峰越界，可按固定renderer从同一母带做一次确定性补偿/限幅并重编码AAC，冻结母带不改。纠正前后数值与实际字节绑定Q2，复测仍越界则阻断。真实混音和试听仍按06验收，当前原生导出不等于客户音频冻结已实现。

`licenseRef`指向服务端保存的不可变权利记录，不能填写“OFL”或“已获授权”代替。可信服务检查workspace/project、实际素材字节、用途和证据；首次预览与商业冻结/编码/发布分别检查对应权限，缺失或范围不符就阻止输出。登记依据、客户声明和内置素材要求统一见[09](09-sources-and-licensing.md)。

补证据只新增登记版本，不换同一素材的 licenseRef；可信 assetBindings 检查是否被换绑。完整资源清单固定许可记录，resourceContentHash 只固定实际内容，避免补证据被算成一次创作。错误绑定的系统修复关联原 release 免费处理。

`targetId = presetId + ':' + aspectId`。服务器依据**快照固定的**rulesVersion读取合法配对、presetVersion、尺寸、安全区与编码；当前六平台七target。比例分别存在不代表配对有效，例如TikTok:square拒绝。加载不到固定规则版本则 PRESET_VERSION_UNAVAILABLE，不用当前配置代替。

候选可以只覆盖当前目标；购买冻结前必须有该规则版本全部合法 target 的源引用、资源、字体、音轨、coverFrame，以及有效的 Q0/Q1 关联、必要片段和事实复核。原生同画幅目标只有在工程、环境、编码与声音完全相同时才可共享产物；实际布局、编码、运行环境及标记相同的视频指纹才共享。历史目标源码仍逐项验证，不按比例自动去重。准备状态独立于创作清单；全目标可冻结也不等于完整高清文件已经通过 Q2。

准备平台是显式prepare_targets操作，响应式语义布局优先，并仅对 Q1 失败镜头做 Agent 定点适配；按原revision/target去重和独立系统预算，不扣额外成功次数。同operation下全部target、attempt和子调用共同受美元上限约束，不能为每个目标重开一份无限预算。共享源码、布局规则、依赖、资源及每个target的覆盖项必须进入冻结身份，不能只保存一个可变规则名称。每新增构图的模型、CPU、字幕/字体、QA 和返工成本应计量，报告一次通过率与修复开销，不假设派生成本为零。它不能原地追加不可变revision；产出新的候选revision并CAS确认，保留原稿。改变原主目标风格或事实必须重新向用户确认，不能伪装成无变化准备。

目标 Q1 覆盖关键时点、转场和高风险动态片段，可用真实布局的低清取帧，不要求付款前全部高清编码。静态图不能替代时序 QA。原生渲染缓存按工程、画幅及完整产物指纹复用，QA 报告/权益/下载授权和 mapping 仍按 targetId 关联。编码、布局等条件分歧时拆分；不把比例相同当作共享证明。

`POST .../export-snapshots`只冻结已经准备好的revision，缺目标/报告409 VARIANTS_NOT_READY；不会在请求内暗中做昂贵生成。付款冻结所有来源，首次只编码所选目标；后补平台仅运行被冻结源包，不再调用模型。系统缺陷以独立correction关联原release、免费且有审计，原文件不覆盖。

## 3 内容与产物指纹

规范实现唯一入口为 [packages/contracts](../../packages/contracts/index.mjs)，脚本和生产代码共同调用，不另抄算法。`canonical` 按 [RFC 8785/JCS](https://www.rfc-editor.org/rfc/rfc8785) 处理 JSON 数据域：对象键按 UTF-16 码元排序，数组保持声明顺序，采用 binary64 数字序列化，拒绝非有限数和孤立代理码元；入站原始 JSON 经 `parseCanonicalJson` 拒绝重复键。不对用户 Unicode 原文归一化。`digest` 计算规范 UTF-8 字节的 SHA-256；实际文件直接计算原始字节 SHA-256。

身份采用显式字段与规范JSON，协议和内容版本互不混淆。新原生revision使用`nativeProjectHash`；历史已存摘要不重算。语义无序的文件按UTF-16路径排序，有序数组保留顺序。`digest("abc")`哈希含引号JSON字符串，原始媒体与源码用`sha256Bytes`；金额、计数和帧索引仍限制为安全整数。

| 身份 | 用途和边界 |
| --- | --- |
| nativeProjectHash | 当前已实现；固定运行时、画幅及完整输入清单，绑定每个文件路径、R2 key、字节SHA-256、长度与媒体类型 |
| renderedProjectHash | 当前已实现；固定原生工具补齐依赖/声音后的实际完整工程，连同文件写入私有R2后才提交 |
| 最终文件SHA-256 | 当前已实现；固定实际MP4、图片、工程文件和回执字节，不以输入工程摘要代替 |
| 客户contentHash | 待实施；对同项目创作内容计费去重，包含源码、事实正文、资源、布局、声音及runtime，不含QA、确认、补证、基础设施镜像或规则标签 |
| 客户qaInputHash | 待实施；固定目标的实际输出条件、封面、规则、事实及检查策略，单纯新增revision或确认人/时间不重复检查 |
| 客户产物/收据指纹 | 待实施；分别固定实际渲染/编码/标记、目标映射和完整冻结收据；封面变化可复用未变视频，短期URL不入身份 |

客户业务身份的字段投影和数据库去重须随真实服务实现，不能把内部revision直接用作购买版本计费，也不能把完整收据、创作内容和实际输出三个摘要混用。事实确认与证据进入冻结收据，创作身份只计事实正文和绑定；资源/声音计真实字节，不计许可记账字段。

原生文件路径须为合法Unicode且已经是NFC；拒绝路径穿越、保留设备名、不可移植字符、末尾点/空格，以及兼容字形/大小写别名和文件目录前缀冲突。入口、单文件/总量和字节身份由共享`native-project`校验，容器另做真实文件系统约束。只拒绝冲突，不静默重命名或归一化用户原文。

冻结和正式预检须把每个目标与实际源文件及输出记录核对；缺记录、入口/字节不符或摘要过期均拒绝。声明文字和变量检查不代替像素/语音QA。共享源码、素材或事实变化使相关目标失效；仅专有文件变化时，才可复用已证明不受影响的目标，不按Agent自报的影响范围省略依赖。

QA、确认和授权证据、标记策略、采样配置、样式标签本身不增加成片次数。采样或标记改变时重算产物指纹并重检，已购快照保留原策略；系统修复关联原 release，免费生成新文件，原收据不覆盖。

`contentHash` 只用于同一项目的计费去重，不能用于授权或跨租户缓存。runtime 影响创作行为，仍属于内容身份；基础设施镜像、编码或检查策略只改变执行/产物身份。源码按确定方式打包，不混入时间戳、环境路径和日志；不尝试证明任意两份代码的视觉等价。平台迁移即使必须改源码或 identityVersion，也须关联原 release 的免费 correction 或明确迁移映射，不能按新 hash 再收费。哈希自指字段不得加入被哈希对象。

## 4 Snapshot、Release与账务身份

`UNIQUE(project_id,content_hash)`确定release；重新确认snapshot不重复扣次。已撤销授权不能通过重放恢复，需恢复审查时返回RELEASE_RESTORATION_REVIEW_REQUIRED，按05处理。请求仍检查当前权限，同幂等键不同摘要409。

发现同内容既有release时返回原release及其**原始snapshot/批次**，不能把本次新snapshot重贴到原输出。若另选平台，用独立补平台请求；不修改initialTargetIds。首次预留固定首批MP4、JPG与映射文件的逻辑集合；每个target均有video/cover/mapping记录，允许共享实际对象。全部就绪、预留/grant有效、项目未删除才原子ready+consume+published_at。

同一 release 同时最多有一个有效预留；并发请求复用它，只有旧预留释放后才可建立新的预留。中间文件不下载；最终失败释放预留，可在同 release 重试，consume 按 release 唯一，release 操作按 reservation 唯一。补平台不预留成片次数，不改变已交付状态；ZIP 派生失败免费重试，不决定首次消费。完整 Q2 发布前执行，video/cover 的 `qualityEvidenceRef` 解析到可信登记，绑定实际输出 ID、target、sha256、artifactFingerprint、QA 策略及检查版本；mapping 不借此冒充媒体检查。付款前报告不能替代成片检测。

快照保存全部目标来源、compositionHash、contentHash、事实/renderer、首次目标、usagePolicy、markingProfileVersion、qaProfileVersion、`confirmedAt` 和 `qualityAssociations`。冻结当下验证全部关联与豁免，固定实际使用的证据；自然到期的审核确认不会事后抹掉已购冻结收据。新冻结仍检查当前时间/成员权限，既有交付仍检查当前项目、有效权益及实际撤销。usagePolicy 固定条款/权利版本、商业导出用途及各 licenseRef 的历史记录，付款及05的条件满足后才授予使用权。ready artifact 必须有实际 sha256、正确指纹和冻结 target；首批输出不全不能发布。短期 URL 不入身份。

AI 标记和观众披露分开：可信 markingProfile 按09及实际用途分别确定 machineMarking、audienceDisclosure 为 required 或有依据的 not_applicable，并保存 decisionRef。付费视频/封面及可信预览截图/片段的标记证据绑定实际输出 ID、sha256、策略和作用域；导出另绑定 artifactFingerprint。`previewResult.mediaKind` 区分 screenshot 与 clip，片段须有自身 clipAssetId/clipSha256/clipMarkingEvidenceRef，截图不能代替片段证据。完整本地回放不是编码媒体合规证据。mapping 不能代替媒体标记，品牌水印也不能代替 AI 标记。实际检测与平台转码后的表现按09验收。

订单、退款、素材失效与恢复按[05](05-waffo-billing.md)。退出界面不取消已付款交付；有效作品所需的运行版本按 §10 保留。

方向、Treatment、声音和候选须对应实际工程、固定片长与用户要求。客户输出审核未通过时不得返回计划正文；获准展示时审核结果须绑定该份实际内容。计划、解读和摘要是过程证据，不单独改变计费内容身份；真正修改源码、参数、事实正文、音频、资源或布局才改变创作内容。

Direction 的 palette 与可编辑颜色都使用小写六位十六进制；输入边界规范化颜色，不改变其他文字。

购买请求按[05](05-waffo-billing.md)检查资格与并发槽。`top_up_only` 不带 snapshot；`purchase_and_export` 必须绑定已准备的全部目标快照。商品可暂停新售，但不能因此阻断既有订单的付款确认、已购权益或重下。

## 5 RenderProtocol

旧页面命令、PB.scene 和 shard/assemble 协议已经退役。新内部渲染请求携带 operationId、generation、renderId、revisionId、rendererRelease、runtimeVersion 和 NativeProject；只有 `preview` 与 `export` 两种模式。请求先通过预编译 Schema，再核对路径、固定 composition、输入字节与实际 release。作品本身不能决定预算、存储权限、目标编码或付费动作。

`preview` 在同一任务实例调用上游 capture，默认四个实际时刻；指定时刻必须位于 `[0,(N-1)/30]`，总数不超过十二，N 为 450 或 900。`export` 原生逐帧渲染整片并混音，再执行交付编码校验。输出有原生预览 PNG、最终 MP4、最终 MP4 的解码抽帧／接触表、实际完整工程和 report，各自固定原始字节摘要；HTML 预览不能冒充已编码输出。

Worker 只有在所有报告和输出已写入 R2、hash／尺寸／帧时间／实际工程身份一致且 operation generation 有效后才原子提交。失败或取消先封锁后续 attempt，确认物理停止后结算和归还容量。新渲染不能借助旧 shard 回执通过校验。旧回执和发布镜像继续按原历史身份保留。

原生编辑允许明确的原文件替换或变量更新，必须携带 baseRevision／原生 baseToken；冲突保留原稿与修改建议，不能悄悄覆盖新的版本。时间批注固定保存时的版本、帧和可选 elementId。当前已实现内部改稿编排及不可变版本，客户实时播放器、点选和并发草稿 UI 尚未实现。

后续客户预览应在独立注册域名与sandbox iframe中使用冻结原生工程，不携带主站Cookie/管理凭据，不能直接暴露上游localhost Studio。低清全长、有声或明确静音、品牌水印与不提供正式下载的边界按[02](02-ux-and-ui.md)实现；权益、事实确认和输出审核按各章接通并实测，不能把内部管理预览当作已授权公开入口。

## 6 AI操作、费用与成功次数

| 操作 | 用户计量 | 内部边界 |
| --- | --- | --- |
| creative_generate | 可用主目标候选交付时1次整片 | 方向、选择、构建、配乐、QA、最多2轮内部修复共用同operation |
| agent_patch | 可用修改候选交付时1轮AI修改 | 一次提交1至5条同base评论、总计≤4,000个Unicode code points；先显示合并影响，不按评论、调用或源码行数拆次 |
| prepare_targets | 0 | 同创作内容补全冻结来源，revision/target去重并限预算；用户新风格请求不是免费准备 |
| internal_repair | 0 | 属于原run，不递归新收费operation，修复与总费用有上限 |
| 普通参数本地编辑/重播 | 0且不限编辑次数 | 无模型、不启动高清交付编码；素材替换、ASR、云预览和QA独立计入云预算、去抖与缓存；没有editables要明确选择AI修改 |
| render_export | 首批发布1个成片版本 | 按05/§4去重；重试、补平台、重下、ZIP、系统修复不重复收费 |

商品、试用资格和次数返还见[05](05-waffo-billing.md)，数值取 agent-policy。账号、设备/IP 和全局限制同时生效；设备/IP 不代替 user_id。免费预览和内部片段也检查授权与预算。

输出审核未通过的候选为 `withheld`，不能展示、接受或按可用结果消费次数。审核待处理期间只保留原操作的有期限预留；修复共用原预算，到期或终止释放未消费次数，实际审核与生成费用仍记账。通过审核的草稿候选可以等待用户确认事实，不能把候选可用与商业冻结混成同一状态。

额度预留、run和outbox同事务。`UNIQUE(workspace_id,project_id,operation_id,kind)`；请求幂等另绑定actor/route/requestId/摘要。内部attempt/工具重试不另预留成功次数；不同操作竞争最后额度必须原子仲裁。

客户费用事件须绑定稳定费用项、幂等观察ID、整数usdMicros及estimated/actual/reconciled状态。已有成本项结算或修正追加带原因的替代事件，不覆盖历史；汇总同一费用项最后有效观察，不能把估算与实收叠加。替代须同费用项/同scope且线性唯一，幂等与仲裁在真实数据库实施。project/shared scope、模型/价格版本、operation/attempt及用量单位明确，未知用量保留null。当前内部账本仍按现有预留/结算实现保存，不能因客户数据模型调整而重算或删除历史。

每次计费调用前，在 operation 已用及在途费用之外原子预留最坏成本，结束后结算实际 usage；未知结果继续占上限待对账。子模型、ASR、审核、多目标和修复共用 operation 上限，换 attempt 不重置。退次数不退系统费用；超额如实记录并停止新调用，不截掉账单。可选提示词审核的调用边界和数据处理见04/09及 [content-safety](../../config/content-safety.json)，默认关闭的参考适配不代表生产审核已经接通。

内部研究模型还受同一授权的跨环境总额约束：独立共享 `MODEL_LEDGER` 累加负责人确认的全部历史费用、各环境实际费用与未结预留；环境 `DB` 保留操作/阶段准入。历史清单及确认使用 [model-spend 契约](../../contracts/model-spend.schema.json)，缺价格/usage 不记作零。历史总额未确认时默认不发新付费请求；负责人明确允许有限继续研究时，可在[模型授权](../../config/model-authorization.json)登记有期限的 `unreconciledHistoryAllowance`，绑定原历史清单摘要、staging 环境、历史风险预留与累计新增上限。风险预留占用原授权总额，所有新操作/部署的实际与未知预留共同受较小上限原子约束；不用于 production，不改写 `openingMicros:null` 或 `openingConfirmed:false`，到期或清单不匹配即停止。风险预留不是已核实账单，历史仍待对账；获得真实确认后继续按原授权累计现有新费用。授权身份不因目录、绑定或临时放行变更重置。原始响应和当时计价依据先持久化，再解析/结算；补账重用原响应，不重发、不按新价重算。客户窗口和成功次数仍按本节另行实施。

每次新调用还须原子检查 `maxMicrosPerUserWindow` / `maxMicrosPerProjectWindow` 对应的滚动窗口（配置的 `usageWindowHours` / `usageWindowMode`），计入成功/失败的实际云费用和全部未结算最坏预留，不能只算失败。通用窗口、失败窗口、UTC 免费总硬上限和 operation 预算须同时满足；新操作、付款、退款或返还次数均不清零。付费交付的必要费用/容量预留不能被非交付调用耗尽。未标定上限保持 null 和 enabled=false；参考算例不代替真实 D1/DO 原子累计验收。

批注限制在排队和预留前检查，超限返回 422，不截断。字符数、模型 token 和美元预算分别检查；每个可用结果的成本包含失败、修复和目标验证，缓存按实际命中记录。

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
| Agent run | validating→pass→succeeded | 重新核对权限/generation/项目、候选技术检查和输出审核，原子候选ready+一次consume+outbox；冻结资格另算 |
| Agent run | validating→repair→active | 同预算且累计修复<2，不新增收费run |
| Agent run | 非终态→cancel→cancelled | 提升generation，释放未消费预留和资源；晚到不能提交 |
| Agent run | 非终态→fail/expiry→failed | 具体原因及真实成本，释放未消费预留，旧稿保留 |
| 渲染 | queued→start→rendering→verifying | 每次推进检查 operation/generation；每个 attempt 独立实例、累计预算与真实停止确认；重放有效检查点，不重跑成功捕获 |
| 渲染 | verifying→commit→passed | generation 栅栏下原子保存不可变输出引用与进度 outbox；通知可独立重试，不能因通知失败回滚成片 |
| 渲染 | 非终态→fail/cancel→blocked/cancelled | 先封锁新 attempt，再确认已有实例停止、归还 lease 与结算；保留首个原因及未确认停止标记，清理重试不重跑捕获/模型 |
| 候选 | withheld→审核通过→ready | 只由可信审核结果解锁；失败、未知或覆盖不足不能展示与消费 |
| 候选 | ready→accept→accepted | §1 CAS、权限与输出审核同时验证；同请求同候选幂等 |
| 候选 | ready/withheld→reject→rejected | 不改当前稿；ready不返已交付成功次数，withheld未交付则释放未消费预留 |
| 候选 | ready/withheld→cancel→cancelled | 原稿不变，作废后续接受；终止原操作时释放未消费预留并阻止晚到结果，已交付成功次数不返还 |

冻结、付款、预留和交付发布按§4与[05](05-waffo-billing.md)执行。有效产物复用，源码修复与平台重试分别计数并共享累计费用；当前原生任务只按`nativeRenderPolicy`允许最多两个物理attempt，须先确认上一实例停止且费用结算，不能在交付层另叠加旧编码重试循环。

终态不能通过普通resume重新活动；需要新的授权操作。长调用结束、消费、接受、发布均重查权限/generation/墓碑。移除发起成员取消未提交创作副作用，但已收款交付由项目权益继续驱动；删除项目/工作区撤销新授权、提升generation、取消作业并清理，晚到文件孤儿回收，不复活项目。退款只冻结关联grant及未发布预留，不能影响无关订单。

已失败/取消操作的对账只确认停止、补齐残留非终态记录并列出未结费用；不恢复 generation，不重启计算，不覆盖 passed 产物或原始失败原因。未知模型费用继续占预留。每个计算 attempt 的停止标记持久化，已确认停止后的晚到 execute 不得重新启动容器。

队列已发送不等于原生 Workflow 已创建或停止，须独立持久化实例身份、原 generation、平台状态和清理确认。取消先封锁操作，再终止已登记 Workflow 并确认物理实例停止；创建晚于取消返回时仍要停止。平台状态未知或停止失败保留未确认，不假定实例不存在。原生强制终止/出错由定期对账发现并落业务终态。有效检查点重放不重做付费阶段；清空检查点的整次 `restart()` 必须被持久执行 claim 阻断，转为清理和对账，不能当普通 resume。

真实并发、故障和恢复验收按[06](06-testing-and-release.md)；内存状态测试不构成 D1 实现。

## 8 事实与QA授权

FactManifest 固定事实版本、原文、证据和确认人/时间。草稿允许确认字段同时为 null；本地候选可提示待确认，正式预检、可信 ready 预览与商业冻结必须已确认且有相应依据。绑定的 expectedText 必须与事实原文一致。仅确认或补证不改写既有 Composition；正文改变则按 §1 同步事实、参数和绑定，生成新 revision。构建检查只能证明已声明的 values 与事实一致，不能自动认出源码硬编码、纹理、Canvas 或旁白中的所有商业句子；这些仍需运行时、像素/语音检查及覆盖说明。

证据登记须绑定workspace/project、来源字节和确认文案摘要。分类与撤销同时绑定项目、factId、版本和原文摘要，不能只按factId查找。新冻结检查当前事实；已购导出读取冻结的历史事实与证据。普通改稿不撤销旧作品，明确撤销才阻止相关输出。此机制核对来源和确认，不自动认证事实真伪。

商业文本分类、用户口播/录屏原声的确认转写、字幕与覆盖不足的处理统一见[13](13-agent-native-production.md)。无法检查的区域不能标成通过；需要成员复核时记录具体区间和 REVIEW。

`qualityReport` 是不可变 Q0/Q1 检查结果，固定 workspace/project/target、qaInputHash、qaProfileVersion、checkerVersion 与 findings；不保存 revisionId、成员豁免或完整事实确认清单。只有同一项目、相同输入和获准 checker 的可信报告才可复用。资源、布局、声音、封面、运行时、镜像或采样变化须重算；同内容仅新增 revision 或补充事实确认不重复昂贵检查。事实当前确认、证据和权利仍在冻结前独立检查，不因报告缓存而省略。

`qualityAssociation` 将当前 workspace/project/revision/target、qaInputHash、qaProfileVersion 绑定到 reportHash 与 waiverHashes。新 revision 需要新关联，不能沿用旧 revision 的豁免。`qualityWaiver` 固定同一作用域、reportHash/findingId、actorId、reason、acceptedAt/expiresAt，仅处理具体 REVIEW。新冻结验证当前 actor 权限和时间；已购快照按 confirmedAt 验证当时豁免，当前权限与权益撤销另行执行。关联由可信服务读取，完整嵌入快照并受 snapshotHash 固定；reportHash 和 waiverHashes 解析到各自可信登记。调用方改写自报 hash 不会得到可信身份。

Q2 另由 §4 的 `qualityEvidenceRef` 绑定真实媒体字节及输出指纹，须确认所用混音、实际帧数/时长、编码和检查结论后才 ready。QA 后重新编码、更换封面或替换文件都须重新绑定检查；相同源码并不足够。

| 等级 | 内容 | 谁可豁免 |
| --- | --- | --- |
| BLOCK | 越权/密钥/出网/路径、未授权资产、未确认/不一致事实、非法target/帧/编码、缺依赖、不复现、无rights | 任何用户和Agent都不可豁免，修复并重检 |
| REVIEW | 有意停顿/硬切、复杂商业文本覆盖不足、阅读与风格风险 | 当前有权成员确认指定 finding 与 revision/target/输入；作用域变化不得复用，已购冻结保留当时证据 |
| INFO | 已声明的非关键视觉/节奏提示 | 展示，不阻断 |

缺字、授权和事实错误必须修复；节奏、调色等风格判断不能冒充硬性错误。输出审核按[04](04-architecture-and-data.md#输出审核)独立放行，`qualityWaiver` 不能豁免输出安全阻断或覆盖不足。实际视听和覆盖验收按[06](06-testing-and-release.md)，不默认每单后台人工批准。

输出审核须从可信回执及覆盖记录推导，不能传入单一布尔值代替。候选绑定目标、实际工程内容、解读与影响摘要；计划绑定实际方向/Treatment/声音内容；本地预览绑定获准原生revision，媒体预览和交付绑定实际字节摘要。只有不可变内容与策略仍一致，才可由可信服务关联新的operation/revision；当前撤销状态仍必查，改文字不能自行推定视觉、布局或音频未受影响。

覆盖清单的 `sourceRange` 固定 `kind`（video/image）、`sourceFrameCount` 和源时间线半开区间 `frameStart/frameEndExclusive`；纯文本为 null。候选和本地运行时预览覆盖实际 revision 的完整450/900帧，成片覆盖冻结 Composition 全片，封面覆盖实际 `coverFrame`，截图覆盖请求起点一帧，片段覆盖实际截取区间。视频 `frameCount` 为区间长度，`durationMs = ceil(frameCount × 1000 / 30)`；图片为1帧且时长为 null。清单内 `frames[].frameIndex` 相对本次输出从0开始，镜头标记从源绝对帧换算；不同区间即使帧数相同也不能互换。

客户输出审核的最低覆盖要求保留：首末帧、从输出第0帧起每30帧，以及范围内全部可信镜头标记；额外采样只能增加。策略版本、实际源范围、片长与标记须由可信服务登记并从原生工程/实际媒体核对，缺覆盖时拒绝，不能复制待审回执自证。此服务尚未接入；原生导出的四帧冷审不是完整输出安全覆盖。1秒间隔也不证明能发现所有瞬间，实际模态观察、连续音频、审核结论及撤销状态仍须同时成立。

接入Agent前还须验收已准入文字绘制路径的可信时间轨迹，记录实际文字、出现区间和所选字体，并与实际输出关联，用于补充视觉采样。当前固定样例的DOM标签观察尚不是此能力；任意Canvas路径、图片内文字或短暂闪现也不能仅靠文字API hook证明已覆盖。未覆盖的内容如实标记，质量复核可按finding交有权用户处理，但用户确认或`qualityWaiver`不能豁免输出安全覆盖不足。

审核数据须先限额再规范化、求摘要和完整结构校验。证据引用最多128项、文字摘要最多1024项、连续音频区间和采样帧各最多900项；实现时同时登记字节、节点、深度与字符串上限，在昂贵遍历前拒绝超限输入。

创作、改稿与目标准备的客户成功事务须检查实际候选、project/run/operation、所有受影响目标、技术QA、权限、generation及输出审核；全部满足才可提交成功并消费一次额度。当前内部候选与模型冷审不能代替客户审核提供方和生产事务。

## 9 资源、输入与保存

任务隔离、调度和媒体清理按[04](04-architecture-and-data.md)，权益期限按[05](05-waffo-billing.md)，输入范围取 [input-capabilities](../../config/input-capabilities.json)与[01](01-product-prd.md)，权利依据按[09](09-sources-and-licensing.md)。固定镜像不代表客户代码可信，实例名称也不能证明GPU或完整浏览器能力。真实隔离、恢复和性能须通过[06](06-testing-and-release.md)及[08的执行隔离要求](08-codex-execution.md#自写镜头的执行隔离)；限制须在作品执行前生效，确定性由原生实际取帧验证，不依赖已退役的虚拟页面时钟。

## 10 协议与发布版本

新原生改稿必须显式引用同工作区、同项目的baseRevision，继承固定runtime commit、合法画幅及实际素材，不从浮动默认环境重建旧稿。客户保存/恢复仍须在`project_revisions`服务实现CAS；当前内部版本是不可变分支，没有协作草稿头。环境升级不得顺带改旧购买快照，旧运行环境的继续执行按实际安全性与冻结引用处理。

必须升级旧作品时，另建明确的兼容修复或迁移记录，保留原内容、快照和 release 关联。仅镜像更新可保持内容 hash；runtime、源码或身份算法变化可能改变它，此时按原 release 免费修复或明确迁移映射，不能把新 hash 当作一次新购买。存在安全问题的旧镜像停止执行，已交付文件和原收据仍不可变；不能以兼容承诺要求继续运行不安全版本。

未发布且已替换的开发规格直接删除。首次生产冻结后，发布登记固定 Schema/validator、identity 算法、平台配置、QA/marking 策略、runtime 与镜像 digest。加载时核对登记摘要，不能拿当前文件冒充旧版本；有效购买或在途作业引用的版本须可安全执行或有明确迁移与免费修复路径。

平台执行规则改变必须更换rulesVersion；仓库检查与[08](08-codex-execution.md)定义的最近可信成功Git基线比较，失败或取消的提交不推进基线，不能用同一提交中互相匹配的版本表和文件证明不可变。正文来源日期或文案修正不强制改执行版本。跨版本解析须明确分派，未知版本返回可定位错误，不把任意旧请求当当前结构。客户发布登记和历史重放属于M2；现行内部原生实现不宣称已具备这些服务。
