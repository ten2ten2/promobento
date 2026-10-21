# 生产契约：版本、状态、指纹与交付

本章规定产品规格 v2.7 / 协议 `2.7.0` 中影响保存、验证、计费和交付的共同规则。字段类型以 [Schema](../../contracts/production.schema.json)、[帧协议](../../contracts/render-protocol.d.ts)和[创作运行时](../../contracts/composition-runtime.d.ts)为准，界面流程见[02](02-ux-and-ui.md)。

仓库提供共享契约与参考校验，实际实现范围以[实施状态](../implementation-status.md)为准；本章的完整要求不等于服务已经上线。生产校验使用 `{production:true}`，拒绝 `exampleOnly:true`。校验用的 context 必须来自可信存储和执行观察，不能直接接收请求体或 Agent 自报的权限、素材、摘要和检查结论。

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

`CandidateReference` 把请求校验、身份与作用域、请求指纹、重放、当前状态检查和候选提交连成一个内存参考入口。首次创作、改稿和目标准备统一返回 `candidateResult`；获准展示的候选包含 `agentInterpretation`、`impactSummary`，withheld/cancelled 时这两项为 null。实际 CAS、消费与 outbox 仍须在生产数据库同事务实现。

恢复使用 `PATCH /api/projects/:projectId/draft` 的 restoreFromRevisionId，与changes互斥，创建新revision，可复用源包；不改订单或余额。素材清理后409 SOURCE_UNAVAILABLE。源包相同而revisionId/检查记录变化不必然是新的付费内容。

普通参数保存检查权限、`baseRevision`、静态声明和值的范围，通过 CAS 创建新 revision；不调用模型，也不自动启动 Q0/Q1 或编码。修改事实绑定文本时，同一事务须更新所有绑定值、创建未确认事实版本并返回 `unconfirmedFactIds`。一次请求给同一事实写入不同文本时拒绝，不能由最后一项覆盖。绑定事实的文本保存时不能为空白；本地输入过程中可以暂时清空，但不能因此创建空事实。

反向调用 `facts.update` 也要同步所有绑定值及 bindings 的 `expectedText`；有绑定时必须提供当前 `baseRevision`，并同时检查事实记录版本。合并后的完整 values 复用普通草稿保存的类型、可见文字、范围、时序限制及规范文件字节上限校验，不能只检查这次传入的事实字符串。每个 binding 的全部 `factIds` 在更新前后都必须存在，包括只提供依据而未直接提供显示文字的事实；缺失时拒绝，不能先过滤再保留悬空引用。删除仍被引用的事实须先改源码解除绑定。`boundValueUpdates`、`factValueUpdates` 和 `factBindingUpdates` 只计算应更新的内容，事实、参数、绑定与新 revision 须在同一数据库事务写入。

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

CompositionManifest 固定 project/revision、15/30 秒、30 fps、450/900 帧、seed，以及源码、依赖、资源、布局、事实内容、runtime/renderer、平台规则和 `renderProfile`。事实只引用 `factContentHash`；确认与证据不写入 Composition，完整 `factManifestHash` 在冻结快照固定。每个 variant 的 `targetOverrideHash` 指向不可变适配内容，无覆盖时为 null。`styleLabel` 和内容语言元数据可省略；网站 Cookie/语言/主题不进入创作身份。

`resource_manifest` 保存实际素材的 path、sha256、byteLength、mediaType 和稳定 licenseRef。Asset broker 按 hash 解析不可变存储；可信构建/渲染记录实际访问的资源、音源和混音，与清单核对，不能只信 Agent 自报。源码包保存代码和静态创作声明，素材单独按资源 hash 引用；不包含自身 manifest、QA 输出、临时 URL 或日志。字体子集、塑形和回退配置一同冻结；按实际文字检查字素簇、塑形和回退，不能用 `document.fonts.ready` 证明无缺字。

保存后的参数只有一个来源：不可变源码包中的 `values.json`，内容严格为 `{kind:"source_values",values:{...}}` 的 JCS UTF-8 字节，最多 1 MiB、256 项。它不携带请求协议版本；格式由固定的 runtime 和依赖解释，单纯升级 API 协议不能改写该文件。颜色按声明转成小写，其他用户原文不归一化。`sourceValuesBytes` 与 `parseSourceValues` 是共同入口。

静态 editables 只声明类型、范围、`affectsTiming` 和可选 `factId`，不保存第二份当前值；首版所有目标共享同一套声明和值。`type:'asset'`必须声明非空、无重复的`acceptedMediaTypes`，其他类型禁止该字段；可选值以Schema为准，保留图片和视频槽位，按可信资源登记的实际MIME匹配，不按扩展名推断。每个目标的 `.mjs` 入口默认导出 `CompositionDefinition`，HTML 外壳由宿主提供。参数文件参与源码摘要；可信检查与导出只读冻结值，本地未保存预览按 §5 使用临时覆盖。可绘资源由可信素材登记生成 `drawableResourcePaths` 白名单，缺失白名单默认拒绝asset取值；MIME匹配与drawable授权必须同时成立，事实证明附件不能仅因出现在资源清单就被画进作品。

首版不支持本地修改 `affectsTiming:true` 的字段，连同事实同步间接影响的字段一起拒绝，提示使用 AI 改稿。没有明确的时间补偿规则时，不能只改一个时间点却留下旧音轨、转场或录屏区间。AI 修改仍受固定总帧数和完整音画验证约束。

**音频冻结：** AudioPlan 与冻结事件都使用稳定的 `eventId`，marker 通过 `audioEventId` 引用，不以数组下标定位。未合成事件允许缺音源与混音细节；进入资源清单的 `frozenAudioEvent` 必须显式提供音源、许可、半开帧区间、`sourceOffsetFrames`、`gainDb`、`fadeInFrames` 和 `fadeOutFrames`，零值不能靠实现方猜默认值。源内偏移和事件长度不得超过实际解码音源。可选 `gainAutomation` 是相对事件起点的整数 `frameOffset` 与相对基础 gainDb 的增量 dB；必须含 0 和事件长度两个端点、严格递增，按 linear-dB 插值。Ducking 编译为这些关键帧。淡入淡出使用线性振幅包络，与增益相乘；两段长度之和不能超过事件长度。

混音统一为 48 kHz、双声道；1 帧等于 1,600 个音频采样帧。最终 WAV 恰为 `totalFrames × 1600` 个采样帧，空白补静音，处理顺序与后处理由固定 `mixerVersion` 决定。`mixedAudio` 固定资源路径、真实 sha256、采样率、声道和 mixerVersion，必须解析到资源表中同路径/同 hash 的实际 WAV。可信解码观察 `audioMetadata` 按字节 hash 保存 sampleRate、channels、sampleFrames；校验音源为音频、源内时间范围及混音的采样率/声道/完整片长，不只检查清单自报值。

`audioHash = digest(audioIdentity(resourceManifest))`：保留事件顺序及音源、帧区间、偏移、增益、淡入淡出和自动化曲线，以及实际混音的路径、字节 hash、采样率、声道；排除 licenseRef、描述性 mark 和单纯 mixerVersion 元信息。静音只允许空事件表和 `mixedAudio:null`。预览与导出读取同一混音字节，可信观察记录须证明实际取用；编码阶段不临时改音量、重新 ducking 或重新混音。完整资源清单仍固定 mixerVersion，声音来源的授权链逐项保留。参考验证器核对可信解码/执行记录，实际解码、混音与试听仍按06验收。

`licenseRef` 指向服务端保存的不可变权利记录，不能填写“OFL”或“已获授权”代替。`resourceRightsErrors` 检查 workspace/project、实际素材字节、用途和证据；首次预览与商业冻结/编码/发布分别检查对应权限，缺失或范围不符就阻止输出。登记依据、客户声明和内置素材要求统一见[09](09-sources-and-licensing.md)。

补证据只新增登记版本，不换同一素材的 licenseRef；可信 assetBindings 检查是否被换绑。完整资源清单固定许可记录，resourceContentHash 只固定实际内容，避免补证据被算成一次创作。错误绑定的系统修复关联原 release 免费处理。

`targetId = presetId + ':' + aspectId`。服务器依据**快照固定的**rulesVersion读取合法配对、presetVersion、尺寸、安全区与编码；当前六平台七target。比例分别存在不代表配对有效，例如TikTok:square拒绝。加载不到固定规则版本则 PRESET_VERSION_UNAVAILABLE，不用当前配置代替。

候选可以只覆盖当前目标；购买冻结前必须有该规则版本全部合法 target 的源分支、资源、字体、音轨、coverFrame，以及有效的 Q0/Q1 关联、必要片段和事实复核。相同画幅只有源码、资源、声音、参数经验证等价才可共享，不按比例自动去重。准备状态独立于创作清单；全目标可冻结也不等于完整高清文件已经通过 Q2。

准备平台是显式prepare_targets操作，响应式语义布局优先，并仅对 Q1 失败镜头做 Agent 定点适配；按原revision/target去重和独立系统预算，不扣额外成功次数。同operation下全部target、attempt和子调用共同受美元上限约束，不能为每个目标重开一份无限预算。共享源码、布局规则、依赖、资源及每个target的覆盖项必须进入冻结身份，不能只保存一个可变规则名称。每新增构图的模型、CPU、字幕/字体、QA 和返工成本应计量，报告一次通过率与修复开销，不假设派生成本为零。它不能原地追加不可变revision；产出新的候选revision并CAS确认，保留原稿。改变原主目标风格或事实必须重新向用户确认，不能伪装成无变化准备。

目标 Q1 覆盖关键时点、转场和高风险动态片段，可用真实布局的低清取帧，不要求付款前全部高清编码。静态图不能替代时序 QA。渲染缓存按 targetId 隔离；同画幅不能自动证明绘制、字幕、音频和安全区等价。分别验证后，相同最终字节可按 sha256 共用物理对象，不承诺七目标恒为四份视频。

`POST .../export-snapshots`只冻结已经准备好的revision，缺目标/报告409 VARIANTS_NOT_READY；不会在请求内暗中做昂贵生成。付款冻结所有来源，首次只编码所选目标；后补平台仅运行被冻结源包，不再调用模型。系统缺陷以独立correction关联原release、免费且有审计，原文件不覆盖。

## 3 内容与产物指纹

规范实现唯一入口为 [packages/contracts](../../packages/contracts/index.mjs)，脚本和生产代码共同调用，不另抄算法。`canonical` 按 [RFC 8785/JCS](https://www.rfc-editor.org/rfc/rfc8785) 处理 JSON 数据域：对象键按 UTF-16 码元排序，数组保持声明顺序，采用 binary64 数字序列化，拒绝非有限数和孤立代理码元；入站原始 JSON 经 `parseCanonicalJson` 拒绝重复键。不对用户 Unicode 原文归一化。`digest` 计算规范 UTF-8 字节的 SHA-256；实际文件直接计算原始字节 SHA-256。

内容身份采用显式字段白名单，`identityVersion:1` 与请求协议版本分开。variants 按 UTF-16 targetId 排序；语义上无序的事实、绑定和 factIds 使用规范排序，音频事件等有序数组保留顺序。固定测试向量包含完整期望序列及摘要，包括纯字符串：`digest("abc")` 哈希的是含引号的 JSON 字符串，不是原始 abc 字节。金额、计数、帧索引等业务整数限制在安全整数范围；JCS 的 binary64 数字域不因此整体缩小。

| 身份 | 用途和边界 |
| --- | --- |
| factManifestHash | 仅在快照固定完整事实清单，包括确认与证据 |
| factContentHash | 只计事实文本与目标/帧区间绑定，不计确认、证据或记录版本 |
| resourceContentHash | 计资源路径、真实字节摘要、长度与媒体类型，不计许可记账字段 |
| compositionHash | 固定完整 Composition，用于源码关联和会话匹配 |
| contentHash | 按 contentIdentity 对同项目的创作内容去重；包含 runtime，不含 QA、确认、镜像、规则版本标签或 renderProfile |
| sourceHash / variantHash | 前者固定目标执行文件；后者再计布局、依赖、资源、声音、事实、seed 与帧数 |
| audioHash | 固定有序音频事件与混音字节，排除许可、描述和 mixerVersion 记账字段 |
| qaInputHash | 固定目标实际输出条件、封面、规则、事实与 QA 策略；不计 revisionId 或确认人/时间 |
| videoFingerprint / coverFingerprint | 固定实际渲染、编码和标记配置；封面另计 coverFrame，改封面可复用未变视频 |
| mappingFingerprint | 固定目标、规则及视频/封面指纹，不含短期 URL |

字段白名单以共享包的同名函数为准。完整收据摘要、创作内容摘要和输出指纹分别计算，不能互相替代。

`sourceHash = digest(targetSourceIdentity(build))`。可信构建器先解析目标依赖，再记录入口路径，以及实际执行所用的每个本地文件的路径、原始字节 SHA-256 和长度；必须包括 `values.json` 和共享依赖。文件按路径的 UTF-16 顺序排序，入口路径也参加摘要。同字节换入口、改参数或改共享文件都会改变对应摘要。`sourceFileDigests` 和 `targetSourceIdentity` 已可复用；依赖发现、沙箱构建和实际执行观察仍待实现，不能把调用方提交的文件列表当作可信构建结果。

`sourceArchiveHash = digest(sourceArchiveIdentity(files))` 固定完整源包的规范文件清单，每项包含路径、原始字节 SHA-256 和长度，按路径排序。它不是 ZIP 压缩字节的摘要；传输包可另校验字节 hash。可信 `sourceArchiveFiles` 必须由实际解包得到，并证明每个目标构建文件都属于该源包，`values.json` 的字节与构建读取的值完全一致。

内部源包路径须为合法 Unicode 且已经是 NFC，每段 UTF-8 不超过 255 字节；拒绝路径穿越、保留设备名、不可移植字符及末尾点/空格。整个文件树按保守的兼容字形与大小写比较规则拒绝文件、目录别名和文件/目录前缀冲突。只检测冲突，不静默重命名或归一化用户文本；仍满足当前规则的源包，摘要算法及 `identityVersion:1` 不变。路径接受范围已经收紧，不满足规则的未发布源包直接拒绝。路径校验由 `safePath`、`sourceFileDigests` 与两种源码身份入口共用。

冻结和正式预检把每个目标的摘要与可信构建记录核对，缺记录、源包不匹配、入口不一致或摘要过期都拒绝。构建记录还提供从源码读出的声明和值，用于检查事实绑定；这不代替像素和语音 QA。整个 `sourceArchiveHash` 保留在作品身份里，不塞进每个目标摘要。仅目标专有文件改变时可复用已证明不受影响的目标 QA；首版共享参数文件或全局事实内容变化会使所有相关目标失效，不按 Agent 自报的影响范围省略依赖。

QA、确认和授权证据、标记策略、采样配置、样式标签本身不增加成片次数。采样或标记改变时重算产物指纹并重检，已购快照保留原策略；系统修复关联原 release，免费生成新文件，原收据不覆盖。

`contentHash` 只用于同一项目的计费去重，不能用于授权或跨租户缓存。runtime 影响创作行为，仍属于内容身份；基础设施镜像、编码或检查策略只改变执行/产物身份。源码按确定方式打包，不混入时间戳、环境路径和日志；不尝试证明任意两份代码的视觉等价。平台迁移即使必须改源码或 identityVersion，也须关联原 release 的免费 correction 或明确迁移映射，不能按新 hash 再收费。哈希自指字段不得加入被哈希对象。

## 4 Snapshot、Release与账务身份

`UNIQUE(project_id,content_hash)`确定release；重新确认snapshot不重复扣次。已撤销授权不能通过重放恢复，需恢复审查时返回RELEASE_RESTORATION_REVIEW_REQUIRED，按05处理。请求仍检查当前权限，同幂等键不同摘要409。

发现同内容既有release时返回原release及其**原始snapshot/批次**，不能把本次新snapshot重贴到原输出。若另选平台，用独立补平台请求；不修改initialTargetIds。首次预留固定首批MP4、JPG与映射文件的逻辑集合；每个target均有video/cover/mapping记录，允许共享实际对象。全部就绪、预留/grant有效、项目未删除才原子ready+consume+published_at。

同一 release 同时最多有一个有效预留；并发请求复用它，只有旧预留释放后才可建立新的预留。中间文件不下载；最终失败释放预留，可在同 release 重试，consume 按 release 唯一，release 操作按 reservation 唯一。补平台不预留成片次数，不改变已交付状态；ZIP 派生失败免费重试，不决定首次消费。完整 Q2 发布前执行，video/cover 的 `qualityEvidenceRef` 解析到可信登记，绑定实际输出 ID、target、sha256、artifactFingerprint、QA 策略及检查版本；mapping 不借此冒充媒体检查。付款前报告不能替代成片检测。

快照保存全部目标来源、compositionHash、contentHash、事实/renderer、首次目标、usagePolicy、markingProfileVersion、qaProfileVersion、`confirmedAt` 和 `qualityAssociations`。冻结当下验证全部关联与豁免，固定实际使用的证据；自然到期的审核确认不会事后抹掉已购冻结收据。新冻结仍检查当前时间/成员权限，既有交付仍检查当前项目、有效权益及实际撤销。usagePolicy 固定条款/权利版本、商业导出用途及各 licenseRef 的历史记录，付款及05的条件满足后才授予使用权。ready artifact 必须有实际 sha256、正确指纹和冻结 target；首批输出不全不能发布。短期 URL 不入身份。

AI 标记和观众披露分开：可信 markingProfile 按09及实际用途分别确定 machineMarking、audienceDisclosure 为 required 或有依据的 not_applicable，并保存 decisionRef。付费视频/封面及可信预览截图/片段的标记证据绑定实际输出 ID、sha256、策略和作用域；导出另绑定 artifactFingerprint。`previewResult.mediaKind` 区分 screenshot 与 clip，片段须有自身 clipAssetId/clipSha256/clipMarkingEvidenceRef，截图不能代替片段证据。完整本地回放不是编码媒体合规证据。mapping 不能代替媒体标记，品牌水印也不能代替 AI 标记。实际检测与平台转码后的表现按09验收。

订单、退款、素材失效与恢复按[05](05-waffo-billing.md)。退出界面不取消已付款交付；有效作品所需的运行版本按 §10 保留。

Directions、Treatment、AudioPlan 和 `candidateResult` 的字段以 Schema 为准；可信层检查总帧、半开区间和关联。`runResult.outputStatus` 为 none/withheld 时结构上禁止携带方向、Treatment 或 AudioPlan；allowed 时生产校验还须匹配同一 `creative_plan` 正文身份的可信文本审核。计划、解读和摘要是过程证据，不单独改变 contentHash；真正修改执行源码、参数、事实、音频、资源或布局才改变创作内容。

Direction 的 palette 与可编辑颜色都使用小写六位十六进制；输入边界规范化颜色，不改变其他文字。

购买请求按[05](05-waffo-billing.md)检查资格与并发槽。`top_up_only` 不带 snapshot；`purchase_and_export` 必须绑定已准备的全部目标快照。商品可暂停新售，但不能因此阻断既有订单的付款确认、已购权益或重下。

## 5 RenderProtocol

可信控制器解析 revision/target、固定规则和 renderProfile 后建立短期 session；源码不能自选尺寸、快门、源包写入或支付/模型权限。生命周期为 created→initializing→idle→seeking→ready，后续 ready→seeking；本地改值进入 applying-values，成功返回可用状态，拒绝恢复上一版；活动态可 failed/disposed。init、set-values、seek/sample 与 inspect 共用串行画布，同一会话最多一个在途命令。默认 profile 为 standard；motion4/8 按 agent-policy 保持实验关闭，启用须由可信控制器验证实测预算，不能由 Agent 或浏览器自行升级采样。

命令和响应都带 protocolVersion、sessionId、requestId、sequence、revisionId 和 targetId；帧响应还回显帧号与 manifestHash。每次命令使用新 requestId 和递增 sequence。revision、target、profile 在会话内固定，变更后新建会话；旧会话、旧请求、已 dispose 的响应全部丢弃。`frameTimeout` 覆盖一帧的全部采样、合成和读回，不能逐样本重置。

本地会话从 `previewEpoch:0` 开始，`init` 可带 `valuesOverlay`。后续 `set-values` 提交完整覆盖表及 `requestedEpoch=appliedEpoch+1`；host 校验直接和间接绑定值，再用“冻结值 + 覆盖表”重新 prepare。成功发 `values-applied` 才推进 `appliedEpoch`；失败发 `values-rejected` 并保持上一版，修正后可用新 requestId/sequence 重试同一待应用 epoch。空表恢复冻结值。seek、inspect 及其响应携带实际应用的 `previewEpoch`，旧响应不能覆盖新画面；prepare 失败必须保留或恢复上一版可用状态。

临时覆盖只存在于本地会话，不写事实确认、正式身份、计费、QA 或导出。可信渲染拒绝 overlay 和本地 epoch。保存仍走 §1 的草稿 CAS；仅值变化且执行环境、源码逻辑不变时，可继续显示旧会话加已确认覆盖，待暂停或到期平滑换到新 revision 会话。新会话 ready 后才替换，不伪造旧会话的 revision/hash；源码变化或恢复操作必须新开会话。保存期间的后续输入和已删除字段的未保存文本须保留供用户处理。

`inspect` 显式提交 frameIndex 与归一化坐标 x01/y01，返回同帧 `hit-result` 或 hit:null。坐标可等于 1，但半开区域的右/下边界不命中；区域重叠按静态声明顺序取最后一个。结果只可引用静态 regionId；sourcePath/line 须与可信声明一致，不接受源码临时指定任意文件。无可检查区域时仍可保留画面坐标批注，不能伪造 DOM 定位。提交批注前先保存，绑定实际显示且已保存的 revision/frame；保存冲突保留批注，不自动换绑其他版本。

本地播放由 Studio 父页面持有时钟和混音播放器。`mixedAudioUrl` 与 `mixedAudioHash` 成对，URL 由当前任务的只读 broker 授权；源码不获得额外声音权限。自动播放受阻时显示播放按钮。低清回放只保留一个 seek 在途，按时钟追赶最新帧，允许跳过过时帧；可信导出仍逐帧完成。初始化、prepare、draw、缺视频帧、帧越界和命令冲突返回具体错误，不能以旧画面冒充就绪。

所有 `seekFrame(n)` 只收整数 `0 ≤ n < N`，名义时间为 n/30；N 为 450 或 900。当前合法 renderProfile 只有 `standard=(1,0°)`、`motion4=(4,180°)`、`motion8=(8,180°)`，Schema、类型和运行时计算一致；能通过结构校验不代表实验功能已获启用。单样本直接取 n/30，多样本按冻结配置的 M 和快门角 A 计算第 j 个样本（0≤j<M）的秒数：

```text
t = clamp((n + ((j + 0.5) / M - 0.5) * (A / 360)) / 30, 0, (N - 1) / 30)
```

`centered-box-v1` 在快门区间中点等距取样，`clamp-v1` 将首末名义帧外的样本固定到边界画面。时间以等值安全整数有理数传给 `draw(time)`，不向外开放任意小数 seek。内部 `sampleSubframe` 只接受可信 Renderer session，sampleIndex 必须小于冻结 M；逐样本完成资源屏障后回 `sample-ready`，全部样本在线性光空间等权平均，再发最终 `frame-ready`。单样本回执不能替代合成帧；成本按实际样本数计量。

| 用途 | API / Bridge 模式 | 回执与用途 |
| --- | --- | --- |
| 本地完整低清回放 | `local_full` 会话 → `local_preview` | `preview-frame-ready`；按名义时间单次绘制，motion 近似效果须标明 |
| 可信截图或短片段 | `preview_request` 的 `screenshot/clip` → `trusted_render` | 按冻结 profile 完成采样，再生成带证据的预览产物 |
| QA 与付费导出 | `trusted_render` | 完整采样后返回 `frame-ready`；本地回执不能代替它 |

创作模块静态声明 editables、markers、regions、videoUses 和 fonts；可信构建检查唯一 ID、区间和安全资源路径。`RuntimeContext.surface` 提供 host 创建的 root/canvas，width/height 始终是平台逻辑尺寸，DOM root 保持目标 CSS 逻辑尺寸，由外层 transform 缩放显示，指针坐标按相反变换映射回逻辑坐标；Canvas 缓冲尺寸显式乘以 pixelScale。本地预览不依赖设备 DPR，可信 Chromium 固定 DPR=1。`prepare` 固定输入和 tween 端点，`draw(time)` 完整重建该时间的像素/区域，不累积播放状态。禁止墙钟、未受控随机数、隐藏 CSS 时间、出网及采样时音效副作用；仿真可固定初态重放或预烘焙。画面采样不推进音频；冷/顺/逆序一致性与 WebGL 能力仍需真实验证。

录屏通过 `videoFrames.get(useId,time)` 读取；videoUses 固定资源、源起止、时间线起点和有理数 playbackRate，按包含目标源时间的 `[PTS,nextPTS)` 区间选择帧，最后一帧止于源时长。缺帧、越界或未验证代理映射须失败，不按墙钟或最近帧猜测。字体按平台登记的 fontId/registryVersion/字重/回退及实际字节冻结，同一fontId的多个字重注册为同一个CSS family，family身份绑定全部冻结face。`fonts.ready`只证明加载完成；`fonts.assertText(fontId,text,weight)`要求显式已登记的主字体字重，回退字体按CSS字重匹配选定face后检查cmap，不能合并不同字重的覆盖来放行。cmap检查不能证明复杂塑形或布局。当前仅有08的固定工程字库和PTS提帧实现，完整平台字体登记及上传处理仍待实施，P0不开放任意上传字体。

预览策略以 [preview.json](../../config/preview.json) 为准。`preview-sessions` 只分配本地会话，不自动启动云 QA。可信捕获在预留前检查路径项目、当前有效创作权益、费用预算、实际构建记录、事实确认和该目标有效 QA；调用方不能只传一个“已检查”布尔值。截图必须是单帧；clip 必须给出非空半开区间，且不超过当前片长、单次片段上限、项目窗口和原试用 claim 的累计请求/帧数。当前准入只接受 standard；motion4/8 须另行标定采样成本与上限。计数包含进行中的预留，费用和次数须同事务检查、预留并幂等提交。`trustedPreviewErrors` 与生产契约共同提供准入校验，不是实际调度器或额度数据库；上限未标定时保持 null 和关闭。

品牌水印位于内容外的 footer band：本地由 Studio 父页面在作品 iframe 之外绘制，编码预览由可信捕获合成器写入实际文件并检查可读性。干净内容 QA 和付费输出不带品牌水印；AI 标记另按 §4。低清和水印不保证防复制。

独立预览 origin 按任务隔离，不带主站 Cookie；精确校验 origin/source window/不可预测 nonce/消息 Schema。CSP 从 `default-src 'none'` 开始，仅给冻结 bundle 与任务 broker 开放实际必需的 script、style、connect、image/media/font 来源，禁止 object、base、form 和任意导航；不能以宽泛公网白名单代替资源代理。iframe 不授予 top-navigation、popup、download 等无关能力。CSP 不能单独证明所有出网路径已关闭；WebRTC 等通道及可信 Renderer 的网络隔离须在 M0b 实测。当前 previewOrigin:null 不表示接受 origin=null。只读审阅只给媒体投影，broker 权限可撤销。

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

费用事件使用 Schema 的 `costEvent`：chargeId 固定一个费用项，eventId/dedupKey 标识一次观察，usdMicros 是该项当前完整非负金额，状态为 estimated/actual/reconciled。已有成本项的结算或修正追加事件并提供 supersedesEventId/reason，不覆盖历史；汇总每条 charge 链最后有效观察，不能把估算与实收叠加。替代必须同 charge/同 scope 且线性唯一，幂等与原子仲裁在真实数据库实施。project/shared scope、模型/价格版本、operation/attempt、用量单位明确，未知 quantity 可为 null。

每次计费调用前，在 operation 已用及在途费用之外原子预留最坏成本，结束后结算实际 usage；未知结果继续占上限待对账。子模型、ASR、审核、多目标和修复共用 operation 上限，换 attempt 不重置。退次数不退系统费用；超额如实记录并停止新调用，不截掉账单。可选提示词审核的调用边界和数据处理见04/09及 [content-safety](../../config/content-safety.json)，默认关闭的参考适配不代表生产审核已经接通。

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
| 候选 | withheld→审核通过→ready | 只由可信审核结果解锁；失败、未知或覆盖不足不能展示与消费 |
| 候选 | ready→accept→accepted | §1 CAS、权限与输出审核同时验证；同请求同候选幂等 |
| 候选 | ready/withheld→reject→rejected | 不改当前稿；ready不返已交付成功次数，withheld未交付则释放未消费预留 |
| 候选 | ready/withheld→cancel→cancelled | 原稿不变，作废后续接受；终止原操作时释放未消费预留并阻止晚到结果，已交付成功次数不返还 |

冻结、付款、预留和交付发布按 §4 与[05](05-waffo-billing.md)执行。编码失败只重试失败指纹，最多 3 个真实编码 attempt；有效产物复用。源码修复与编码重试分别计数，共享累计费用上限。

终态不能通过普通resume重新活动；需要新的授权操作。长调用结束、消费、接受、发布均重查权限/generation/墓碑。移除发起成员取消未提交创作副作用，但已收款交付由项目权益继续驱动；删除项目/工作区撤销新授权、提升generation、取消作业并清理，晚到文件孤儿回收，不复活项目。退款只冻结关联grant及未发布预留，不能影响无关订单。

真实并发、故障和恢复验收按[06](06-testing-and-release.md)；内存状态测试不构成 D1 实现。

## 8 事实与QA授权

FactManifest 固定事实版本、原文、证据和确认人/时间。草稿允许确认字段同时为 null；本地候选可提示待确认，正式预检、可信 ready 预览与商业冻结必须已确认且有相应依据。绑定的 expectedText 必须与事实原文一致。仅确认或补证不改写既有 Composition；正文改变则按 §1 同步事实、参数和绑定，生成新 revision。构建检查只能证明已声明的 values 与事实一致，不能自动认出源码硬编码、纹理、Canvas 或旁白中的所有商业句子；这些仍需运行时、像素/语音检查及覆盖说明。

证据登记须绑定 workspace/project、来源字节和确认文案摘要。分类与撤销使用 `factVersionKey(projectId,fact)`，同时绑定 factId、版本和原文摘要，不能只按 factId 查找。新冻结检查当前事实；已购导出读取冻结的历史事实与证据。普通改稿不撤销旧作品，明确撤销才阻止相关输出。此机制核对来源和确认，不自动认证事实真伪。

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

输出审核须从可信回执及覆盖记录推导，不能传入单一 `safetyAllowed` 代替。候选按 target 使用 `candidateOutputIdentity`，同时固定可信内容摘要、意图解读与影响摘要；创作计划固定完整 directions/Treatment/AudioPlan；本地预览固定授权 revision 的 manifestHash，媒体预览和交付固定实际媒体字节摘要。只有不可变对象身份与策略仍一致，才可用可信 association 关联新的 operation/revision；当前撤销状态仍必查，改文字不能自行推定视觉、布局或音频未受影响。

覆盖清单的 `sourceRange` 固定 `kind`（video/image）、`sourceFrameCount` 和源时间线半开区间 `frameStart/frameEndExclusive`；纯文本为 null。候选和本地运行时预览覆盖实际 revision 的完整450/900帧，成片覆盖冻结 Composition 全片，封面覆盖实际 `coverFrame`，截图覆盖请求起点一帧，片段覆盖实际截取区间。视频 `frameCount` 为区间长度，`durationMs = ceil(frameCount × 1000 / 30)`；图片为1帧且时长为 null。清单内 `frames[].frameIndex` 相对本次输出从0开始，镜头标记从源绝对帧换算；不同区间即使帧数相同也不能互换。

最低采样由 [output-safety-sampling.json](../../config/output-safety-sampling.json) 登记，当前为 `output-sampling-v1`：首末帧、从输出第0帧起每30帧，以及范围内全部可信镜头标记。候选、本地预览和媒体共用此规则；调用方的 `requiredFrameIndices` 只能加密，未知版本拒绝。控制器从实际 revision/Composition 与目标源码的可信 `runtime_declarations.markers` 派生范围、片长和标记，缺记录时拒绝，不能复制待审回执或其策略自证。参考入口由 `scopedSafetyCoveragePolicy` 完成派生：Studio 使用 revision 记录中的 `runtimeDeclarationsByTarget`，媒体检查使用对应 Composition 的可信声明。1秒间隔只是最低覆盖，不证明能发现每一处不安全变化；实际模态观察、完整音频覆盖、审核结论和当前撤销状态仍须同时成立。

接入Agent前还须验收已准入文字绘制路径的可信时间轨迹，记录实际文字、出现区间和所选字体，并与实际输出关联，用于补充视觉采样。当前固定样例的DOM标签观察尚不是此能力；任意Canvas路径、图片内文字或短暂闪现也不能仅靠文字API hook证明已覆盖。未覆盖的内容如实标记，质量复核可按finding交有权用户处理，但用户确认或`qualityWaiver`不能豁免输出安全覆盖不足。

审核数据先限额再规范化、求摘要及完整 Schema 校验。`evidenceRefs` 最多128项、`textHashes` 最多1024项、`audioSegments` 和采样 `frames` 各最多900项；记录字节、节点、深度和字符串上限由同一配置与有界检查约束。共享 Schema 入口也先执行已声明的集合/字符串上限，避免超大数组在报错前进入 canonical 或 Ajv 的元素遍历。

`transition(validating, pass)` 的参考守卫要求真实候选和可信 `safetyContext`，核对 project/run/operation，并复用 `candidateSafetyErrors` 检查所有受影响目标。`creative_generate`、`agent_patch` 与 `prepare_targets` 使用同一入口；技术 QA、权限、generation 和审核必须全部通过才允许成功。该内存守卫不替代生产事务、审核提供方或执行隔离。

## 9 资源、输入与保存

任务隔离、调度和媒体清理按[04](04-architecture-and-data.md)，权益期限按[05](05-waffo-billing.md)，输入范围取 [input-capabilities](../../config/input-capabilities.json) 与[01](01-product-prd.md)，权利依据按[09](09-sources-and-licensing.md)。固定镜像不代表客户代码可信；实例名称也不能证明具备 GPU 或完整浏览器能力。真实隔离、恢复和性能须通过[06](06-testing-and-release.md)；首次执行 Agent 模块前还须满足[08 的源码准入要求](08-codex-execution.md#agent源码执行准入待实现)，包括模块求值前生效的时间、随机与执行限制。

## 10 协议与发布版本

普通参数编辑、AI 改稿和目标准备继承基线 revision 的 `runtimeVersion`、`dependencyManifestHash`、`presetRulesVersion`、`layoutRulesHash`、`rendererImageDigest`、`renderProfile` 和 `identityVersion`。`inheritRevisionEnvironment` 负责复制，`revisionEnvironmentErrors` 检查是否被替换。应用默认值升级只影响新作品，不能顺带改旧稿。恢复时从可信 `restoreFromComposition` 继承被恢复版本的执行环境，CAS 仍针对当前草稿；环境来源与并发基线不能混用。

必须升级旧作品时，另建明确的兼容修复或迁移记录，保留原内容、快照和 release 关联。仅镜像更新可保持内容 hash；runtime、源码或身份算法变化可能改变它，此时按原 release 免费修复或明确迁移映射，不能把新 hash 当作一次新购买。存在安全问题的旧镜像停止执行，已交付文件和原收据仍不可变；不能以兼容承诺要求继续运行不安全版本。

未发布且已替换的开发规格直接删除。首次生产冻结后，发布登记固定 Schema/validator、identity 算法、平台配置、QA/marking 策略、runtime 与镜像 digest。加载时核对登记摘要，不能拿当前文件冒充旧版本；有效购买或在途作业引用的版本须可安全执行或有明确迁移与免费修复路径。

平台执行规则改变必须更换 rulesVersion；仓库检查与[08](08-codex-execution.md)定义的最近可信成功 Git 基线比较，失败或取消的提交不推进基线，不能用同一次提交里互相匹配的版本表和文件证明不可变。正文来源日期或文案修正不强制改执行版本。跨版本解析按 discriminator 和明确协议版本分派，未知版本返回可定位错误，不尝试把任意旧请求当作当前结构。生产登记和旧版重放的真实实现、数据库迁移与恢复属于 M2，当前参考测试不宣称已具备这些服务。
