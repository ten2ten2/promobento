# 生产契约：版本、状态、指纹与交付

本章规定产品规格 v3.0 / 协议 `3.0.0` 中影响保存、验证、计费和交付的共同规则。字段类型以 [业务 Schema](../../contracts/production.schema.json)与[原生工程清单](../../contracts/native-project.schema.json)为准，界面流程见[02](02-ux-and-ui.md)。

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

新内部创作使用 NativeProject 1.0.0：`index.html` 与普通本地工程文件、固定 huashu commit、15/30 秒、30 fps 和单画幅 composition。不同画幅独立生成、审片和导出；每个文件固定 path、R2 key、SHA-256、byteLength、mediaType。历史 CompositionManifest／identityVersion 1/2 保留读取与业务参考，不再接收新创作写入。客户 `project_revisions`、购买快照和完整冻结事务仍待接入，不能把内部工程清单当作已完成的客户冻结服务。

`createFilmComposition` 与 `filmCompositionErrors` 共用此结构；后者核对镜头参数实际引用的文字/事实区间和 `r/<resourceId>` 资源，不能用一个未引用的文字槽位给画面提供事实证明。负责人已批准 DOM/SVG/Canvas2D 自写镜头提前进入内部 S1，源码准入、隔离和实际帧要求见[实施范围](08-codex-execution.md#2-里程碑与退出关口)。构造与结构检查不代替成员、许可、确认、QA 或数据库冻结事务。

内部导演方法 `product-directing` 1.2.0 及后续版本的自写镜头，在每个 `readingHolds` 区间声明 `visibleTextSlots`：必须是本镜头已声明槽位的无重复数组，特意无字可用空数组；区间中点的可信 CDP 观测按实际镜头归属核对。不存在或裁切的指定槽位阻断；遮挡仍按原 REVIEW 规则处理，不能借此改写原 QA 等级。可信文字观测可携带所属 custom `sceneId`，旧观测仍有效。旧冻结方法及旧 `customScenePlan` 入口不增加这个前置，旧参数与源码身份不改写。

`resource_manifest` 保存实际素材的 path、sha256、byteLength、mediaType 和稳定 licenseRef。Asset broker 按 hash 解析不可变存储；可信构建/渲染记录实际访问的资源、音源和混音，与清单核对，不能只信 Agent 自报。源码包保存代码和静态创作声明，素材单独按资源 hash 引用；不包含自身 manifest、QA 输出、临时 URL 或日志。字体子集、塑形和回退配置一同冻结；按实际文字检查字素簇、塑形和回退，不能用 `document.fonts.ready` 证明无缺字。

原生 HTML/JS/CSS 是创作源，不再要求 `film.json`、`PB.scene` 或第二份可执行场景协议。Brief 和 Treatment 记录事实与导演决策，不用于宿主绘制。保存源文件原始 UTF-8 字节，不因 API 版本升级改写或归一化客户文案；源码修改由 baseRevision 约束并产生新版本。

历史 `identityVersion:1` 保留原入口和 `values.json` 读取：内容严格为 `{kind:"source_values",values:{...}}` 的 JCS UTF-8 字节，最多 1 MiB、256 项。它不携带请求协议版本；格式由固定的 runtime 和依赖解释，单纯升级 API 协议不能改写该文件。颜色按声明转成小写，其他用户原文不归一化。`sourceValuesBytes` 与 `parseSourceValues` 继续服务这些记录。

历史模块的静态 editables 只声明类型、范围、`affectsTiming` 和可选 `factId`，不保存第二份当前值；首版所有目标共享同一套声明和值。`type:'asset'`必须声明非空、无重复的`acceptedMediaTypes`，其他类型禁止该字段；可选值以Schema为准，保留图片和视频槽位，按可信资源登记的实际MIME匹配，不按扩展名推断。原浏览器创作API的目标 `.mjs` 入口默认导出 `CompositionDefinition`，HTML 外壳由宿主提供。参数文件参与源码摘要；可信检查与导出只读冻结值，本地未保存预览按 §5 使用临时覆盖。可绘资源由可信素材登记生成 `drawableResourcePaths` 白名单，缺失白名单默认拒绝asset取值；MIME匹配与drawable授权必须同时成立，事实证明附件不能仅因出现在资源清单就被画进作品。

首版不支持本地修改 `affectsTiming:true` 的字段，连同事实同步间接影响的字段一起拒绝，提示使用 AI 改稿。没有明确的时间补偿规则时，不能只改一个时间点却留下旧音轨、转场或录屏区间。AI 修改仍受固定总帧数和完整音画验证约束。

**音频冻结：** AudioPlan 与冻结事件都使用稳定的 `eventId`，marker 通过 `audioEventId` 引用，不以数组下标定位。未合成事件允许缺音源与混音细节；进入资源清单的 `frozenAudioEvent` 必须显式提供音源、许可、半开帧区间、`sourceOffsetFrames`、`gainDb`、`fadeInFrames` 和 `fadeOutFrames`，零值不能靠实现方猜默认值。源内偏移和事件长度不得超过实际解码音源。可选 `gainAutomation` 是相对事件起点的整数 `frameOffset` 与相对基础 gainDb 的增量 dB；必须含 0 和事件长度两个端点、严格递增，按 linear-dB 插值。Ducking 编译为这些关键帧。淡入淡出使用线性振幅包络，与增益相乘；两段长度之和不能超过事件长度。

内部导演的外部音乐准入见 [`audio-admission.schema.json`](../../contracts/audio-admission.schema.json)：音乐目录与图片分开，许可来自可信权利行而非模型创作源。ABC 除音源内容身份和许可外，还绑定负责人独立批准的 `digest({text,totalFrames})`，不同片长分别批准；带字节身份的新乐谱必须与送入合成器的文本一致。旧独立 AudioPlan 的 requestHash 批准入口保留，不因新增目录引入额外字节前置条件。许可在首次读/处理前及后续使用时检查；冻结仍须满足本节完整音频事件、混音和资源清单要求。

混音统一为 48 kHz、双声道；1 帧等于 1,600 个音频采样帧。最终 WAV 恰为 `totalFrames × 1600` 个采样帧，空白补静音，处理顺序与后处理由固定 `mixerVersion` 决定。`mixedAudio` 固定资源路径、真实 sha256、采样率、声道和 mixerVersion，必须解析到资源表中同路径/同 hash 的实际 WAV。可信解码观察 `audioMetadata` 按字节 hash 保存 sampleRate、channels、sampleFrames；校验音源为音频、源内时间范围及混音的采样率/声道/完整片长，不只检查清单自报值。

原生声音准备和混音可能派生新的音频文件或修改 HTML 引用，因此导出保存实际完整工程及 rendered-project manifest。输入 project hash、实际 HTML hash、实际工程 hash 和最终 MP4 字节 hash 分别记录，不能互相代替。业务音频冻结仍需绑定实际音源与混音字节。

`audioHash = digest(audioIdentity(resourceManifest))`：保留事件顺序及音源、帧区间、偏移、增益、淡入淡出和自动化曲线，以及实际混音的路径、字节 hash、采样率、声道；排除 licenseRef、描述性 mark 和单纯 mixerVersion 元信息。静音只允许空事件表和 `mixedAudio:null`。预览与导出读取同一混音字节，可信观察记录须证明实际取用；编码阶段不做创作性音量调整、重新 ducking 或重新混音。最终AAC须实测；仅为纠正编码引入的响度／真峰越界，可按固定renderer从同一冻结WAV做一次确定性补偿／限幅并重编码AAC，视频复制，冻结WAV及其身份不改。纠正前后数值和实际输出字节绑定Q2，复测仍越界阻断，不能覆盖母带或借纠正更换声音内容。完整资源清单仍固定 mixerVersion，声音来源的授权链逐项保留。参考验证器核对可信解码/执行记录，实际解码、混音与试听仍按06验收。

`licenseRef` 指向服务端保存的不可变权利记录，不能填写“OFL”或“已获授权”代替。`resourceRightsErrors` 检查 workspace/project、实际素材字节、用途和证据；首次预览与商业冻结/编码/发布分别检查对应权限，缺失或范围不符就阻止输出。登记依据、客户声明和内置素材要求统一见[09](09-sources-and-licensing.md)。

补证据只新增登记版本，不换同一素材的 licenseRef；可信 assetBindings 检查是否被换绑。完整资源清单固定许可记录，resourceContentHash 只固定实际内容，避免补证据被算成一次创作。错误绑定的系统修复关联原 release 免费处理。

`targetId = presetId + ':' + aspectId`。服务器依据**快照固定的**rulesVersion读取合法配对、presetVersion、尺寸、安全区与编码；当前六平台七target。比例分别存在不代表配对有效，例如TikTok:square拒绝。加载不到固定规则版本则 PRESET_VERSION_UNAVAILABLE，不用当前配置代替。

候选可以只覆盖当前目标；购买冻结前必须有该规则版本全部合法 target 的源引用、资源、字体、音轨、coverFrame，以及有效的 Q0/Q1 关联、必要片段和事实复核。原生同画幅目标只有在工程、环境、编码与声音完全相同时才可共享产物；实际布局、编码、运行环境及标记相同的视频指纹才共享。历史目标源码仍逐项验证，不按比例自动去重。准备状态独立于创作清单；全目标可冻结也不等于完整高清文件已经通过 Q2。

准备平台是显式prepare_targets操作，响应式语义布局优先，并仅对 Q1 失败镜头做 Agent 定点适配；按原revision/target去重和独立系统预算，不扣额外成功次数。同operation下全部target、attempt和子调用共同受美元上限约束，不能为每个目标重开一份无限预算。共享源码、布局规则、依赖、资源及每个target的覆盖项必须进入冻结身份，不能只保存一个可变规则名称。每新增构图的模型、CPU、字幕/字体、QA 和返工成本应计量，报告一次通过率与修复开销，不假设派生成本为零。它不能原地追加不可变revision；产出新的候选revision并CAS确认，保留原稿。改变原主目标风格或事实必须重新向用户确认，不能伪装成无变化准备。

目标 Q1 覆盖关键时点、转场和高风险动态片段，可用真实布局的低清取帧，不要求付款前全部高清编码。静态图不能替代时序 QA。原生渲染缓存按工程、画幅及完整产物指纹复用，QA 报告/权益/下载授权和 mapping 仍按 targetId 关联。编码、布局等条件分歧时拆分；不把比例相同当作共享证明。

`POST .../export-snapshots`只冻结已经准备好的revision，缺目标/报告409 VARIANTS_NOT_READY；不会在请求内暗中做昂贵生成。付款冻结所有来源，首次只编码所选目标；后补平台仅运行被冻结源包，不再调用模型。系统缺陷以独立correction关联原release、免费且有审计，原文件不覆盖。

## 3 内容与产物指纹

规范实现唯一入口为 [packages/contracts](../../packages/contracts/index.mjs)，脚本和生产代码共同调用，不另抄算法。`canonical` 按 [RFC 8785/JCS](https://www.rfc-editor.org/rfc/rfc8785) 处理 JSON 数据域：对象键按 UTF-16 码元排序，数组保持声明顺序，采用 binary64 数字序列化，拒绝非有限数和孤立代理码元；入站原始 JSON 经 `parseCanonicalJson` 拒绝重复键。不对用户 Unicode 原文归一化。`digest` 计算规范 UTF-8 字节的 SHA-256；实际文件直接计算原始字节 SHA-256。

内容身份采用显式字段与规范 JSON，协议和历史身份版本互不混淆。新原生 revision 使用 `nativeProjectHash`；历史 identityVersion 1/2 的已存摘要不重算。语义无序的文件按 UTF-16 路径排序，音频事件等有序数组保留顺序。`digest("abc")` 哈希含引号 JSON 字符串，原始媒体与源码用 `sha256Bytes`；金额、计数和帧索引仍限制为安全整数。

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

`nativeProjectHash` 绑定完整输入清单及每个不可变文件引用，实际输入读取再次核对字节与普通文件路径。`renderedProjectHash` 绑定上游补齐依赖／声音后的全部实际工程，回执连同文件存入私有 R2 后才可提交。旧 `targetSourceIdentity`、`sourceFileDigests` 仍供历史业务参考使用；旧 film-v1 构建返回 `LEGACY_RENDERER_REQUIRED`，不会自动切换到新原生引擎。

历史 `identityVersion:1` 的 `sourceArchiveHash = digest(sourceArchiveIdentity(files))` 固定完整源包的规范文件清单，每项包含路径、原始字节 SHA-256 和长度，按路径排序。它不是 ZIP 压缩字节的摘要；传输包可另校验字节 hash。可信 `sourceArchiveFiles` 必须由实际解包得到，并证明每个目标构建文件都属于该源包，`values.json` 的字节与构建读取的值完全一致。

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

旧页面命令、PB.scene 和 shard/assemble 协议已经退役。新内部渲染请求携带 operationId、generation、renderId、revisionId、rendererRelease、runtimeVersion 和 NativeProject；只有 `preview` 与 `export` 两种模式。请求先通过预编译 Schema，再核对路径、固定 composition、输入字节与实际 release。作品本身不能决定预算、存储权限、目标编码或付费动作。

`preview` 在同一任务实例调用上游 capture，默认四个实际时刻；指定时刻必须位于 `[0,(N-1)/30]`，总数不超过十二，N 为 450 或 900。`export` 原生逐帧渲染整片并混音，再执行交付编码校验。输出有原生预览 PNG、最终 MP4、最终 MP4 的解码抽帧／接触表、实际完整工程和 report，各自固定原始字节摘要；HTML 预览不能冒充已编码输出。

Worker 只有在所有报告和输出已写入 R2、hash／尺寸／帧时间／实际工程身份一致且 operation generation 有效后才原子提交。失败或取消先封锁后续 attempt，确认物理停止后结算和归还容量。新渲染不能借助旧 shard 回执通过校验。旧回执和发布镜像继续按原历史身份保留。

原生编辑允许明确的原文件替换或变量更新，必须携带 baseRevision／原生 baseToken；冲突保留原稿与修改建议，不能悄悄覆盖新的版本。时间批注固定保存时的版本、帧和可选 elementId。当前已实现内部改稿编排及不可变版本，客户实时播放器、点选和并发草稿 UI 尚未实现。

后续客户预览应在独立注册域名与 sandbox iframe 中使用冻结原生工程，且不携带主站 Cookie／管理凭据。客户原生 Studio 不能直接暴露上游 localhost HTTP 服务。预览策略、业务权益、事实确认、输出审核和品牌水印的产品要求仍由对应配置约束，接入客户服务前须单独实现和验证，不能把内部管理预览当作已授权公开入口。

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

冻结、付款、预留和交付发布按 §4 与[05](05-waffo-billing.md)执行。编码失败只重试失败指纹，最多 3 个真实编码 attempt；有效产物复用。源码修复与编码重试分别计数，共享累计费用上限。

终态不能通过普通resume重新活动；需要新的授权操作。长调用结束、消费、接受、发布均重查权限/generation/墓碑。移除发起成员取消未提交创作副作用，但已收款交付由项目权益继续驱动；删除项目/工作区撤销新授权、提升generation、取消作业并清理，晚到文件孤儿回收，不复活项目。退款只冻结关联grant及未发布预留，不能影响无关订单。

已失败/取消操作的对账只确认停止、补齐残留非终态记录并列出未结费用；不恢复 generation，不重启计算，不覆盖 passed 产物或原始失败原因。未知模型费用继续占预留。每个计算 attempt 的停止标记持久化，已确认停止后的晚到 execute 不得重新启动容器。

队列已发送不等于原生 Workflow 已创建或停止，须独立持久化实例身份、原 generation、平台状态和清理确认。取消先封锁操作，再终止已登记 Workflow 并确认物理实例停止；创建晚于取消返回时仍要停止。平台状态未知或停止失败保留未确认，不假定实例不存在。原生强制终止/出错由定期对账发现并落业务终态。有效检查点重放不重做付费阶段；清空检查点的整次 `restart()` 必须被持久执行 claim 阻断，转为清理和对账，不能当普通 resume。

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

任务隔离、调度和媒体清理按[04](04-architecture-and-data.md)，权益期限按[05](05-waffo-billing.md)，输入范围取 [input-capabilities](../../config/input-capabilities.json) 与[01](01-product-prd.md)，权利依据按[09](09-sources-and-licensing.md)。固定镜像不代表客户代码可信；实例名称也不能证明具备 GPU 或完整浏览器能力。真实隔离、恢复和性能须通过[06](06-testing-and-release.md)；首次执行自写镜头前还须满足[08 的执行隔离要求](08-codex-execution.md#自写镜头的执行隔离)，包括作品代码求值前生效的时间、随机与执行限制。

## 10 协议与发布版本

新原生改稿必须显式引用同工作区、同项目的 baseRevision，继承固定 runtime commit、合法画幅及实际素材，不从浮动默认环境重建旧稿。客户保存／恢复仍须在最终 `project_revisions` 服务实现 CAS；当前内部版本是不可变分支，没有假冒已实现的协作草稿头。历史 Composition 的 `inheritRevisionEnvironment` 与 `revisionEnvironmentErrors` 保留原参考语义；环境升级不得顺带改旧购买快照。

必须升级旧作品时，另建明确的兼容修复或迁移记录，保留原内容、快照和 release 关联。仅镜像更新可保持内容 hash；runtime、源码或身份算法变化可能改变它，此时按原 release 免费修复或明确迁移映射，不能把新 hash 当作一次新购买。存在安全问题的旧镜像停止执行，已交付文件和原收据仍不可变；不能以兼容承诺要求继续运行不安全版本。

未发布且已替换的开发规格直接删除。首次生产冻结后，发布登记固定 Schema/validator、identity 算法、平台配置、QA/marking 策略、runtime 与镜像 digest。加载时核对登记摘要，不能拿当前文件冒充旧版本；有效购买或在途作业引用的版本须可安全执行或有明确迁移与免费修复路径。

平台执行规则改变必须更换 rulesVersion；仓库检查与[08](08-codex-execution.md)定义的最近可信成功 Git 基线比较，失败或取消的提交不推进基线，不能用同一次提交里互相匹配的版本表和文件证明不可变。正文来源日期或文案修正不强制改执行版本。跨版本解析按 discriminator 和明确协议版本分派，未知版本返回可定位错误，不尝试把任意旧请求当作当前结构。生产登记和旧版重放的真实实现、数据库迁移与恢复属于 M2，当前参考测试不宣称已具备这些服务。
