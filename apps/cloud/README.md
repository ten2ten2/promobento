# 内部 staging 创作与渲染

`/healthz` 之外的入口要求 `S1_ENABLED=internal_eval` 和独立 `EVAL_API_KEY`；production 为 off。此控制面只供持有评测密钥的负责人使用，没有客户登录／租户成员权限，不能接为客户API。实际部署、作品和费用状态见[实施状态](../../docs/implementation-status.md)，本文说明当前用法及恢复边界。

## 内部入口

根路径 `/internal/s1/`。原始请求先经共享严格JSON解析，私有传输使用完整预编译Schema；处理前从D1核对权利并引用私有R2证据，不信素材JSON自报清权。

| 入口 | 用途 |
| --- | --- |
| `objects/evals/…`、`rights` | 不可变输入／证据上传与逐操作权利登记 |
| `operations`、`creative`、`renders` | 创建内部操作、导演或实际渲染 |
| `releases`、`releases/<id>` | 登记／只读核对精确镜像；登记取实际容器元数据，不信调用方imageDigest，旧记录不覆盖 |
| `operations/<id>/events`、`frames/<frame>` | SSE进度和任务授权帧 |
| `operations/<id>/studio/check/<frame>` | 同一授权帧PNG及可信CDP阅读观测，不是完整动态Q1 |
| `operations/<id>/cancel`、`reconcile`、`recovery` | 取消、终态清理／对账、实际停止和费用回执 |
| `operations/<id>/review-draft` | 仅指定质量退出分支的未验收草稿；failed不变，candidate仍404 |
| `artifacts/<key>` | 当前许可有效的已发布输出／方向帧或已登记草稿媒体；不开放一般失败／取消／陈旧代际 |

benchmark／isolation仅供calibration，拒绝普通evaluation。所有studio工具重新检查generation、许可、原task允许帧并串行执行seek／截图／观测，不能靠诊断扩大权限。

## 渲染、并发与提交

RenderWorkflow编排分段、声音、精确阅读计划／接缝、拼接及generation-fenced提交；ShardDO每attempt一个禁网容器；CoordinatorDO管理物理lease；OperationDO管理操作studio和SSE。audio/assemble为standard-2（1vCPU／6GiB、一个FFmpeg线程），普通shard/studio为standard-3，WebGL shard为standard-4。计算按分配CPU／内存／磁盘×实际运行时间结算保守上界，不冒充账单。

满载在原绝对期限内等待，未拿lease不启动／预留计算费；声音与24段WebGL共用工作区24名额。先在未分配实例的DO注册broker（最多30秒），重查取消后再启动。控制器ready限45秒，单探测最多5秒；不ready不发task、晚到ready不接受，页面初始化另按2D30秒／WebGL60秒。注册／排队完整计入墙钟。

纯2D 15/30秒均六段，final为75/150源帧；review仍用30fps源时间轴、30源帧切点，半尺寸15fps。review180秒是内部止损，不是性能达标值；完整阶段期限取 [agent-policy](../../config/agent-policy.json)。

只有RenderWorkflow调度基础设施重试，原生计算step重试零。明确容量／连接、注册超时和控制器健康超时白名单，须确认旧实例物理停止／无未结预留后才按15/60秒换新attempt，最多三次。generation、总预算和绝对期限不变；未知停止／费用、INIT_TIMEOUT、作品／QA／许可／预算／deadline不重试。每attempt保留首因，清理失败不覆盖它。

状态 `queued→sharding→verifying→assembling→passed`，失败／取消为blocked／cancelled。准备输入也在失败处理内。复合Workflow值用共享canonical文本持久化／parseCanonicalJson恢复，确定性提交不自动重试。验证按整片计划检查各段应有的精确帧，允许无计划点的短段为空；实际媒体与outbox原子提交，通知可独立重试，不能回滚成功或覆盖旧字节。

cgroup峰值不可见时必须null＋cgroup_peak_not_exposed、整片unverified；权限错误／无效读数仍阻断，不用RSS或0代替。[S1平台限制例外](../../docs/evidence/2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)不改变其他门槛。

## 研究模型共用一份预算

MODEL_LEDGER独立D1由staging／production共享；各环境DB保留自己的操作、素材和计算账本。迁移目录 `model-ledger-migrations`。授权身份、起算和已花费用不因部署、目录、换绑、新操作或取消重置。

- `GET model-budget` 返回历史确认／未知和新调用已结／预留；`POST model-budget/import` 只接纳 [model-spend](../../contracts/model-spend.schema.json) 不可变清单。
- 历史128次／14次未知保持openingMicros:null、openingConfirmed:false；默认未对账不派付费请求。当前临时历史风险放行的范围／有效期／占用只见[实施状态](../../docs/implementation-status.md#有效授权与费用)和model-authorization，不能另开预算。
- 取得完整历史账单后，上传 `kind:model_spend_confirmation` 证据到objects/evals，再 `POST model-budget/confirm` 传 `{evidenceKey}`。必须绑定当前授权／清单摘要和授权以来全部历史totalUsdMicros、实际来源；不只填114笔目录估算。确认只能幂等重放，不能覆盖金额。
- 每次先共享D1原子预留，再过本地操作／阶段／次数门槛。只在能证明未派发时释放零；已派发而usage未知继续预留。已解析到终态的原始SSE与回执、usage、价格／汇率先存不可变私有R2，再解析结果／结算，补账按原callId，不重发／重计新价。流解析失败、断线或超限的原始字节目前不保留；旧回执也不能补出原始SSE。
- HTTP／传输失败仅存去敏request-failure诊断，无usage不是免费。length／refusal保留partial和后到usage但不缓存；坏工具参数保存原arguments及MODEL_TOOL_JSON_INVALID，完整用量已结后才允许一次结构纠正。反馈含有界previousOutput，作为数据而非指令。
- 网关隐藏输入按配置额外预留128k token风险空间；旧独立付费探针归档不可继续运行，后续探针必须进共享账本。模型接口语义见 [models](../../packages/models/README.md)。

## 导演与离线回放

`mise run test:cloud-local` 用真实OperationWorkflow、两种SSE适配器、SQLite预算SQL和内存R2回放A–C/E/F：三方向、等待、纠正／修复／冷审、取消、许可／密钥／能力拒绝及未知预留。无网络／真密钥／镜像，不能代替实际模型或媒体；官方适配器只在独立mock bundle回放，不改部署verified=false。

B只写三张精简方向卡与骨架，可信宿主按原事实／主图／色板／纵深生成静音hero，再由真实studio取图；优先产品镜头，用产品名作带图标题，不把完整事实挤进小卡。已有完整keyframeFilm严格复用；最终完整FilmSpec只交C。

完整输出结构失败时，A／每素材／B／F最多一次纠正，C最多两次；仍受各阶段原总次数／金额／期限。有效结果缓存按请求、模型、目录和工作区／项目／用途隔离，只收已结响应；旧缓存经同范围已结原回执重新准入，不再付一次，也不复活旧操作。原回执缺失时停止，不为相同内容悄悄再付一次；完整但无用量的结果只允许原 callId 回放，不能跨操作复用，缺响应的未知请求不重发。新操作的首次模型派发仍须单独授权并预留费用；未知、网络或截断不进入纠正。

自写镜头的网关 Opus 请求在明确 HTTP 502 或 SSE 内数值 502 时，可切换一次网关 DeepSeek `deepseek-v4.1-flash-1017`；仅限有 `edit_file` 的 scenes 请求。先持久保存原始响应／故障回执，Claude 无 usage 的预留不释放；备用调用使用独立 callId、`none` effort 和命名 `edit_file`，与原调用共用同镜头次数／金额、操作预算及期限。备用结果仍走相同源码准入和实际帧检查；其他失败不触发切换，同 callId 恢复不重发。配置不代表备用模型已证明成片质量。

同工作区／项目／用途内，针对上述支持切换的 Claude scenes 请求及其 DeepSeek 备用调用，本地账本以原子准入阻止相同请求身份的未结调用被新操作重复派发；其他模型或场景不因此改变既有调用条件。两个历史未知请求仍须对账，不能凭新 operationId 重发。具体事故见[导演证据](../../docs/evidence/2026-10-24-s1-director/README.md#方法-190自写镜头试片在-d-中断)。

新操作遇到相同未结 Claude 请求时，只有原操作已终止、同一作用域与请求身份匹配、原不可变回执或核验字节身份的原始 SSE 明确记载 502，才记录来源并以新的 DeepSeek 调用继续；不重启旧操作或释放旧预留。旧流缺失、证据不符、其他未知失败或相同请求仍在进行时停止。备用调用仍独立计费、受新操作预算与相同未结请求防重发限制。

准入限制当前真实能力：texture=none、无布局覆盖／素材裁剪、精确获准字体face；staging有四种转场，源码另支持 `fade-through`，部署情况见[实施状态](../../docs/implementation-status.md)。复用页面生成器只处理JSON并丢弃HTML，不在Worker求值作品。三张卡先汇总错误再启动studio。模型调用前还核对后续密钥／能力、release／实际镜像、沙箱、字体、broker和PNG；成功健康缓存10分钟，换镜像／过期／跨用户等待重查，探针费计当前操作。

E/F按画幅取得全部阅读PNG拼图和源引用、第一画幅动作姿势；逐图核对身份、拒绝空／重复／混尺寸／超限。片外帧标签／空格不算影片内容。E 还接收低清全片运动线索及其局限，见[渲染服务](../render-container/README.md#四种模式)；该改动已部署内部 staging，尚未经过真实 E 评测。每秒画面、声音曲线和完整Q1/Q2尚未接齐，有限姿势和低分辨率差异不能代替正常速度视听。

E/F带原briefContext、方向、事实和当前媒体，F不带D/E对话。E可write_spec／限定源码编辑，F用恰好一个submit_cold_review，16k输出。F的BLOCK可触发一次C修正，再走E、全画幅重渲和第二次F；无变化／再次BLOCK／用尽额度停止。E/F共用两次internalRepairs，不各自重置。

质量修复耗尽时，review-draft绑定最后实际渲染的规格／媒体、首因、未应用建议及冷审状态；下载重查generation／许可，不增加次数或绕过F。此分支仍缺真实云端交接证据；当前作品验证见实施状态。

## 导演选择结构，D 实现自写镜头

新creative冻结 [product-directing](../../packages/methods/directing.ts) 的版本／摘要，进入缓存、费用及候选／草稿身份；旧空directing_method_key仍走原积木路径，不改付费检查点。源码当前方法1.10.0，旧冻结方法的顺序／前置不追溯新增；实际部署见[实施状态](../../docs/implementation-status.md)。

B定信息形态／运动语言，C定Treatment、完整结构／时间和最多两个custom；hero只是可信积木构图预览。D按hardest顺序只写本scene模块，静态解析不求值。当前C/D用网关Opus，D显式asset-insights，只取得A按resourceId／sha256绑定的真实观察，不发图片、不改Claude vision:false。默认images模式仍要求vision，缺观察／能力就停止，不降级。

先create静态底稿，再按阅读窗口分至多三个动作补丁；每次原子修改需覆盖该窗口的状态／可见性／动作，后续保留既有实现，最后核对全部事件和署名。布局16,384／动作32,768输出token，每镜头共用12次／$0.35，静态稿不交片。Claude不强制命名工具，已测DeepSeek images路线保留none／命名edit_file。

edit_file使用自包含Schema，path必须当前模块字符串，首次仅create，之后唯一匹配str_replace／insert；不给非字面量ctx.asset(key)／ctx.text(id)放行，helper接已解析handle。源码反馈带code/path和有界行。文字父框有正宽高，隐藏槽位也须拟合；竖屏独立重排，按变换后安全区验，ctx.text().mount返回元素的内联颜色要在该元素修改，不只改父级。

两个custom时先验最难镜头，无画面占位只参与可归因、无其他镜头重叠的提前探针；所有真实模块完成后，仍在每请求画幅独立studio检查事件／首尾／阅读窗口、逆序和新实例冷seek。1.2及后续方法按visibleTextSlots和sceneId核对阅读点；每模块冻结原始字节，proof不借提前探针代替。

方法1.6可为自写镜头声明 `assetChecks:[{frame,assetKeys}]`，各帧为镜头局部整数、不能与其他镜头重叠，且与事件／阅读点共用24帧上限。C应对关键DOM图片选择需要实际出现的帧；D的受检素材须以 `ctx.asset(key).url` 绑定的DOM图片出现。可信CDP只检查所属镜头、可见样式、裁切及命中，缺失／无法确认时保留实际帧并停止，不自动付费修复。它不证明图片可读、动作完整或作品质量；未声明的素材和Canvas绘制仍依赖E/F与人工审片，不改变原有Canvas调用条件。取不到可靠坐标时C应选择无需该坐标的设计；D不能靠空值或静态占位冒充完成。声明检查时先探测所用renderer的素材观测能力，不支持则在D调用前停止。

方法1.6的CTA入场使用cut或 `fade-through`：先淡出上一镜头，再淡入CTA，不改变旧 `crossfade` 的叠化语义；使用新转场时先探测实际renderer是否支持。自写镜头内自行绘制的文字交接仍需实际审片。

方法1.7可选择可信 `component-relay`，将第一张静态素材的已观察矩形区域作为副本抬起，再接力到其他真实页面。C 必须把该素材按字节身份绑定的 A 阶段 `regions[].box` 原样放入对应资产 `roi`；缺少匹配观察或区域越界即拒绝，不猜坐标。A 的区域是模型观察，不是人工测量或质量证明；E/F 和负责人仍需检查实际动作与内容。选用该镜头时先以当前清权素材探测实际 renderer 支持；旧冻结方法不提供该积木。镜头不处理录屏，不代替自写镜头，也不保证特定视觉风格。

方法1.8要求 C 显式选择 `componentBehavior`：仅属于源页面的对象选择 `return-to-source`，页面切换前归位；`carry` 要求对后续每个页面都有实际叙事关系，宿主还核对该区域标签是否出现在每张素材各自的 A 阶段观察中。标签匹配只是模型观察，不证明实际语义关系；E/F 仍须检查。使用该字段时预检实际 renderer 是否支持；旧冻结方法和未带字段的既有影片保留原 `carry` 行为及原预检。

方法1.9强调基于产品设计构图、主体比例和镜头接力：当积木不能表达所选编排，C 可指定自写镜头，E 也可在具体视觉缺陷需要时把受影响积木换成自写镜头，由 D 编写并经既有沙箱检查后重渲。旧方法的请求与执行路径不变。方向图仍是可信积木生成的静态近似，不是已实现的自写镜头；是否真正改善画质须以实际作品和正常速度视听判定。

方法1.10在审片修改已有自写镜头的规格时，让 D 对该镜头现有源码做范围内编辑，实施新旧规格的实际差异，而不从静态底稿重新分段编写。改后仍按全部声明、目标画幅和完整帧检查，模型输出无效或结果无法通过时停止；旧冻结方法仍使用原路径。此优化不延长活动上限，也不保证实际调用一定更快或画面合格。

Studio 容器启动失败时，源码会尽力将探针诊断写入操作私有的 `studio-diagnostics/<taskId>.json`，因为 Studio 没有渲染分片的 attempt 行；诊断写入失败不覆盖原始启动错误，也不重试模型。

当前 E 的规格改写是创作过程内的自动审片修复；用户对已生成影片提交批注并创建新候选的改稿入口尚未实现。具体产品改稿和版本规则见[13](../../docs/prd/13-agent-native-production.md#7-定点编辑和协作)与[14](../../docs/prd/14-production-contracts.md)。

失败证据绑定sourceHash／scene／aspect，保留阶段／帧／CDP／像素比较及实际PNG。studio关闭确认且错误为可归因CUSTOM_QA_BLOCK／CUSTOM_HOLD_TEXT_MISSING／CUSTOM_SEEK_MISMATCH时，每镜头最多一次D定点修复，共用原次数／金额／期限；重叠无法归因、未知消费、Q0／权限／平台或停止未确认直接失败。看图模式给真实失败图，文本模式只给实际观测／比较，不冒称看过帧。

仅staging/evaluation/internal_eval_only、冻结方法≥1.5.0且实际custom可用30分钟活动上限；原起点、方向等待扣除、修复不重置，其他仍20分钟。[期限与配置来源](../../docs/plans/cloud-motion-v3.md#611-预算限制与-effort)。

## 导演使用已批准的音乐

context.resources放图片；context.audioSources最多四项音乐，独立kind=score／upload、resourceId、sha256、私有key、byteLength，ABC另含scoreRef，不送看图模型。[完整音乐准入契约](../../contracts/audio-admission.schema.json)。

先上传不可变源／证据，再登记rights。证据须含audio_source_rights、当前operationId、匹配resourceId／sha256／licenseRef、internal_eval_only、owner批准、source／basis。ABC还需负责人独立批准 `scoreApprovals:[{totalFrames,requestHash}]`，其中requestHash=digest({text,totalFrames})，严格UTF-8原谱、450／900帧分别批准，不从模型FilmSpec推导。

预检先许可再读源：ABC≤16KiB，WAV≤8MiB，mono/stereo PCM16/24、44.1/48kHz、最长30秒且覆盖全片，不循环／补静音。FilmSpec只选已批准源，宿主生成AudioPlan及输入，容器复核身份／谱／片长；音源进入任务权利清单，下载重新核对撤销。旁白须另经转写／字幕准入，不能借此入口上传；方向卡静音。实际ABC／WAV完成范围只见[实施状态](../../docs/implementation-status.md)。

## 部署

镜像只通过 [cloud-deploy.yml](../../.github/workflows/cloud-deploy.yml) 在Actions冻结安装、预编译、迁移两套D1、构建／推送／部署，Mac不构建推送。通常从checks调用，选择一个场景，不自动追加其他job：

```sh
gh workflow run checks.yml --ref main -f suite=staging -f staging_scenario=deploy-only
```

默认engineering跑一次15秒原创工程闭环；deploy-only只读health／容量／预算。Actions生成遮蔽EVAL_API_KEY，经stdin绑定；结束确认停止／lease／费用后删本轮密钥，不删D1/R2证据。普通部署保留既有模型secret；人工内部操作另绑定临时密钥，不贴值。

| 可选参数 | 使用条件／行为 |
| --- | --- |
| `staging_sha=<已部署完整SHA>` | 只修harness，跳过构建／迁移／部署；报告区分harness与部署SHA |
| `staging_renderer_sha=<镜像源码SHA>`、`staging_renderer_digest=sha256:…` | Worker-only部署。镜像来源须当前祖先、真实registry摘要，守卫确认所有容器输入未变；不传本地image ID |
| `staging_inspect_run=<run ID>` | 只读原Workflow／D1／费用，不部署、不绑定密钥、不启动计算 |
| `staging_inspect_operation=<该run子操作ID>` | 连同原staging_sha定位矩阵子操作及有限去敏日志；只有Worker日志不能判容器没有错误 |
| `staging_reconcile_operation=<已终态ID>` | 只重做停止／费用对账，不重启、不改generation、不覆盖passed或原首因、不清零未知 |

镜像复用守卫仅排除未被容器导入的供应商／授权／model-config、模型适配器、纯单测与容器README；agent-policy仅允许已登记的模型标签、director.steps和Worker-only review总限等差异，其余渲染／预算／环境必须不变。精确白名单以工作流脚本为准，不手动绕过。

鉴权传播只对接纳任务前确切404 Not found有界等待；模型／媒体／未知超时不重发。Wrangler上传后应用设置未完成时，用cloud-account-check的 `scope=container-deployment` 和精确version_id只读诊断，不反复构建已推镜像。恢复部署不删除数据库或回滚DO迁移。

### 模型绑定与平台指标

已有Actions模型密钥通过以下维护入口绑定Worker，不构建／上传代码／调用模型，不覆盖现有绑定；与staging部署互斥，拒绝活动会话／未结计算：

```sh
gh workflow run model-runtime-key.yml --ref main
```

仅核对secret名称／health，不读回值；未知写入不盲重试／删除。人工回收新增绑定前确认无其他活动操作。现有网关Claude／DeepSeek共用MODEL_COMPAT_API_KEY，官方备用不因此接通。

`gh workflow run cloud-account-check.yml --ref main -f scope=container-metrics` 只读既有G1矩阵时间窗，不部署／计算／调用模型。平台采样最大值不等于cgroup生命周期峰值，数据缺失保留未验证；默认prerequisites场景的实际行为不同，不能当零消费入口。

## 原生 Workflow 中断后只清理，不猜测重跑

pipeline_workflows持久登记派发、创建、平台状态和清理。每分钟有界扫描最多20条，errored／terminated或完成未提交时落失败并停止计算，`POST workflows/reconcile` 可立即用同一入口；recovery中的physicallyStopped读取失败为null，不能假定已停。

取消先推进generation，再分别终止原生和停止物理计算／studio；状态查询失败不跳过清理，迟到创建仍停。停止标记持久且不可复活，仅running时destroy，再确认停止后归还lease／结算；清理失败保留句柄／名额／预留。studio没有成片attempt行，恢复需按计算预留ID查物理状态，空数组／费用已结都不是停止证据。

首步claim-execution只领一次；正常检查点重放复用，整次restart重领拒绝并清理，不生成新attempt／模型请求。业务结果和成功通知原子提交，中间SSE仅尽力通知，查询是权威。通知／停止重试不重捕获媒体；清理专用检查点可重试，首因不改。

## 选择必要的云验场景

通过 `-f staging_scenario=<场景>` 选择；每次仍须具体资源／模型授权，不因有命令就自动执行。

| 场景 | 实际范围 |
| --- | --- |
| engineering | 一部15秒原创2D闭环 |
| webgl-studio | device-3d四画幅顺／逆／冷seek、真实context、关闭 |
| custom-studio | 原创DOM/SVG/Canvas2D源码传输、四画幅seek／CDP；零模型／声音／影片 |
| webgl-film | 一部30秒24段WebGL＋程序配乐／lead-in，工作区名额仍24 |
| lifecycle-recovery | 本轮新校准操作中途取消、原生terminate、restart无重复计算 |
| director-preflight | 仅在未确认历史且无临时放行时验证消费前拒绝；准入已开则拒绝派发 |
| g1-performance | 先WebGL再2D，各十串行＋四并发，共28部；不追加工程片／模型 |
| g1-2d-performance | 只测受影响2D十串行＋四并发，不称完整28部 |
| g1-selection | 2D/WebGL×standard-3/4，授权帧各十组，PNG/JPEG90/92/95、RGB SSIM、still/check |
| g1-isolation | 两类studio的固定攻击／broker／uid／沙箱／停止检查，不接受调用方代码 |

performance-report按负载分经验最近秩，含全部失败attempt、真实逐帧、启动／排队、停止和费用。只下载每类首部媒体，其余保留不可变R2引用；首失败不自动整片重跑，结束停止／结算和密钥回收。当前性能缺口、固定隔离和内存例外见[性能证据](../../docs/evidence/2026-10-24-s1-performance/README.md)。
