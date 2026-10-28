# S1 评测输入

六题仅用于获准的内部S1评测，不公开素材／成片，也不作为营销样片。当前完成度、有效预算和继续条件统一见[实施状态](../../docs/implementation-status.md)。

题目与使用范围以 [`topics.json`](topics.json) 为准。六张卡的既有功能/课程事实与确认文案保留；2026-10-25 再次核对 Duolingo、IELTS Ready、Marugoto 和 Hugging Face 的原官方页面，原功能、课程及学习基础陈述仍有依据。IELTS 本次可读到公开页面文字，但原浏览器采集的 403 记录及第三方截图许可限制不因此改变。三家产品的入口为：

- [DeepSeek](fact-cards/deepseek.json)：网页对话、API 平台与文档入口；主画面优先官网和无私人内容的初始界面。
- [MiniMax](fact-cards/minimax.json)：以 MiniMax Code 为软件题目；当前改片展示官方 pocket-pet CLI 的计时、暂停和庆祝案例，保留一般功能事实，不引用价格、速度排名或成本节省比例。
- [Duolingo](fact-cards/duolingo.json)：短课、读写听说与个性化练习；官方入门文章含可定位的产品界面截图。

负责人已确认六张卡中的官网功能/课程内容陈述用于 **S1 首次内部评测**，2026-10-26 又批准 MiniMax 官方演示画面及对应案例事实；当前确认范围与事实 ID 保存在卡片中，不含虚构业绩，也不授权公开成片。现有 **13 张**已查看素材在私有 staging R2，含原十项及三张 pocket-pet 官方演示裁帧。源 URL、实际字节身份、尺寸和 D1 权利证据引用见 [`materials.json`](materials.json)；图片不进 Git，不对外发布。每次真实评测前仍核对事实和权利记录，品牌页面发生变化时复核。

三门课程仅限获准的内部评测：

- [IELTS Ready](fact-cards/ielts-ready.json)：British Council 的练习、短课与专家 webinar；不承诺提分，不把 Premium 条件省掉。
- [Marugoto](fact-cards/marugoto.json)：日本国际交流基金的日语沟通课程；不是 JLPT N2 冲刺班，不使用合格率。
- [Hugging Face LLM Course](fact-cards/hf-llm-course.json)：Transformer、微调、Datasets 与 Tokenizers；保留 Python 学习基础要求。课程材料复用按其 Apache-2.0 许可保留通知，商标与肖像单独处理。

**IELTS Ready 已改用原创事实图**：负责人于 2026-10-24 批准只画已确认的练习、短课与专家直播，不仿造课程界面。1600×1000 原创图已查看并入库；PNG、可编辑 SVG 源稿及权利证据均在私有 R2，原事实确认不变。原页面的 403 和[官网图片许可缺口](https://www.britishcouncil.org/terms)仍保留在卡片：公开官方备选不等于可复用图片。脚本只按原图 ID、事实 ID 和负责人批准放行原创图，仍拒绝该站截图/图片，不把 Premium 手册当免费套餐界面。

## 本机产物只保留可继续使用的部分

`artifacts/` 保留当前审片、重要横竖成片版本、手工改稿、已选 13 首配乐、原谱／母带和素材许可来源。当前审片入口为 `artifacts/s1-minimax-method150-2026-10-27/index.html`，播放真实 MiniMax Code 操作、演示估价和预订确认的 1080p 横屏稿；完整输入、源码、时间映射和检查在同目录 `manual-revision-agent-credited/`。来源教程和本片均有剪辑，不能据此推断生成耗时；上一版 Agent 稿和已拒绝的计时器稿仍可从审片页打开。横屏画面按负责人提出的出处标注条件通过，音乐实际听感待确认，具体范围见[导演证据](../../docs/evidence/2026-10-24-s1-director/README.md#方法-150横屏低清审片已生成e-无用量截断)。既有配乐试听和手工改稿入口保持原路径。

旧轮次的原始 JSON 回执、冻结输入与源码集中在 `artifacts/history/<原目录名>/`。这里不是完整下载包，不保留历史播放器、逐帧截图、H.264 分段或重复 WAV；历史媒体和图片按各轮回执中的 R2／Actions 引用查找。费用未知项和许可记录不能作为临时输出删除。

临时下载与诊断用完即删；不要把同一轮完整 CI 产物和已整理的试听／成片各留一份。依赖及编译缓存继续使用既有目录，不纳入媒体清理。

## 用私有素材清单准备评测

`materials.json` 的每项提供 `resourceId`、`key`、`sha256`、`byteLength`、尺寸、`licenseRef` 与 `evidenceKey`；字节只在 staging R2。新评测操作先按 cloud 内部 `rights` 入口为自己的 operationId 重新登记同一证据，再将素材加入 `context.resources`。题目用 `materialIds` 选择素材，不能因为同一目录有其他品牌的图就串用。Hugging Face 图附原课程仓库 Apache-2.0 通知及署名；这批素材整体仍限内部评测，不作为免署名商用素材包。

DeepSeek 只留首页的交互/产品入口区域，排除未确认成本/速度公告与登录二维码。MiniMax 使用官网下载页发布的原始桌面示例图与真实透明 Logo，账号标签属于官方演示，不是私人账户；2026-10-26 再核对官网的产品名、Coding/Work 与 agent／多媒体陈述，原事实不变。Duolingo 取官方入门文章的三种练习与学习路径示例，保留原图。Marugoto 取官方 Minato/课程界面组合。Hugging Face 课程图以原 1816×529 尺寸栅格化，排除页面广告、视频和作者肖像。IELTS 图用原创几何图标和文字，保留免费套餐限定、来源和内部评测标记。

完整十三项清单合计 **1,690,855 bytes**，私有 manifest 为 `evals/materials-20261026-pocket-demo/manifest.json`。官方 Logo 及三张新裁帧分别采用[单项负责人批准](fact-cards/minimax.json#/materialApprovals)；其余十项复用原字节、重登记许可，IELTS PNG／SVG、HF 通知及 Duolingo 原图引用保留。路径派生图仍为未裁剪的 1893×4096，原 2340×5064 图不删除。入库无模型或渲染调用，操作已关闭并回收临时密钥。

三张新图来自[固定官方版本的演示](https://github.com/MiniMax-AI/minimax-code/blob/da22f11c55d4748155d7162c1030414228a00565/docs/demo.md)，分别取 1／19／28 秒的准备、暂停和庆祝状态，裁为 640×800，保留真实设备与可见的十秒演示标记；源视频身份、时间点和裁剪范围随清权证据保存。它们是动效改片用的状态图，不是连续操作录屏。成片须保留 CLI 案例与维护者完成视觉设计的署名，不把演示计时当生成速度、不称从零生成完整视觉设计。根 MIT 通知只作为来源材料保留，不当作所有视频素材的使用许可。

### 将六题准备为实际导演输入

```sh
mise exec -- node research/evals/prepare-inputs.mjs \
  artifacts/s1-eval-inputs-current renderer-6204a149bc68
```

第二个参数必须固定为将要执行的 renderer release；上例对应已部署的 `6204a14` 镜像，不自动追随新部署。镜像更新后须用新发布 SHA 前 12 位（`renderer-<12位SHA>`）重新准备输入，不能把旧 release 改绑新镜像。脚本已用真实卡片和素材实际生成 **12 份** context：每题 15/30 秒各一份，每份含横竖两画幅，共对应 24 部最终影片。保留卡片原语言、CTA、事实 ID、来源、限定条件和确认记录，素材只取本题 `materialIds`，不改变原文字或推导业绩。

输出 `manifest.json` 标为 `prepared_not_executed`，每例包含 context 文件与 `rightsAdmissions`。真实执行时，为该例创建内部评测操作，先在 `rights` 入口登记其证据，再上传 context，并向既有 `creative` 入口提交 `{operationId,contextKey}`。模型密钥、能力与历史费用门槛仍由服务端检查；准备脚本不上传、不创建云操作、不调用模型/渲染，不代替六题实际评测。

卡片 `facts` 是确认过的证据，不强制把来源长句逐字做成大标题。C 可忠实压缩未定稿文案，仍须保留产品声明归属、限定条件与 factId；固定名称、CTA/URL 和明确提供的最终上屏文字不改。原事实卡、来源与确认记录保持不变。

### 一次执行一份真实导演输入

确认当前 Actions 部署完成、`wrangler whoami` 为项目账户且 staging 没有其他内部会话后，执行：

```sh
mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-current minimax-15 artifacts/s1-minimax-15-new
```

先读取固定 release，缺失时把该 release 对应的完整 Git 提交及其环境锁存入私有 R2，并通过既有登记入口绑定实际部署镜像；执行脚本的提交另行记录，不能把后续文档或 harness 提交冒充镜像源码。已存在的登记不可覆盖，当前镜像与登记不符就停止。之后只创建该例一个评测操作，重登记自己的素材权利，再调用真实 A/B/C/E/F；模型 secret 留在 Worker。新增费用受共享临时上限和原阶段/次数/期限约束，未知消费保留预留，不重发同一次请求。输出目录存在时拒绝重跑，失败先读 `report.json` 和 `operation.json`。

到 `awaiting_visual_direction_choice` 后查看 `direction-fit.png`、`direction-amplify.png`、`direction-unexpected.png` 及 `directions.json`。据实际画面选择，把 `choice.example.json` 的 key、绑定摘要和具体 reason 保存为同目录 `choice.json`；脚本才向原 Workflow 发送选择，不默认为 fit。成功后 `index.html` 提供横竖两部实际 MP4 的正常速度播放器，候选/冷审、全部费用与未知项保留在 JSON。负责人视听仍记为 pending，程序成功不代替 4/6 评判。

自动审片耗尽修改额度时，脚本按[内部审片退出规则](../../docs/plans/cloud-motion-v3.md#66-阶段-e整片-review)下载 `review-draft.json` 与其绑定的现有影片，生成标明「待人工审片／自动质量审查未通过」的私有 `index.html`，提供从头有声 1× 播放。报告状态为 `review_draft_delivered_pending_owner_review`，`countsTowardAcceptance:false`；云端操作仍为 `failed`，原失败码和未解决的冷审保留。E 停止时可能只有横屏低清片，不补造竖屏或最终片；新的修改建议尚未应用，不重新付费渲染。本地正常交接不代表作品通过。

结束时核对物理计算停止、容量和费用，并删除本次临时内部密钥；已成功候选保持 succeeded 和原 generation。失败/中断才取消未结束操作并对账，不删除素材、成片或账本。每次仅运行获具体授权的一题，已有未知消费先保留／核对，不因准备好输入自动批量派发。

与 Actions harness 一样，密钥更新后的相邻请求可能仍看到旧绑定；仅对路由/调度前确切 `404 Not found` 等待最多 30 秒，并记录 `authPropagationRetries`。资源本身不存在、模型/媒体错误及未知超时不重发；一次 capacity 鉴权成功也不假定后续请求已全部传播。

客户端只对主循环的只读操作快照 GET 最多额外尝试两次，并记录 `operationReadTransportRetries`；不会重发 POST、模型/渲染请求、HTTP 错误或超时。超过上限仍走原取消、停止/结算和密钥回收，不能把断连当成创作失败或未知调用可重发的依据。

若原操作已失败/取消，但客户端清理超时导致 `report.json` 缺物理停止/费用回执，先读错误，再只恢复该已结束操作的清理：

```sh
mise exec -- node research/evals/recover-case.mjs artifacts/s1-minimax-15/report.json
```

该入口拒绝活动操作与其他内部会话，不创建操作、不触发模型或渲染，仅调用既有的终态 reconcile 与回执读取。原失败原因、generation、已发布媒体和未知模型费用保留；新回执写回同一私有报告，临时密钥独立绑定/回收。普通执行也逐步保存已取回的清理证据；`cleanupStatus:unconfirmed`、`cleanupError` 与密钥回收状态分开记录，清理错误不覆盖原模型/渲染失败。物理停止或费用仍未知时不得开始下一题。

### 只复验实际卡片的标题/副标题碰撞

新渲染镜像部署并重新准备输入后，可用已完成的 `write_spec` 回执复现同一 FilmSpec、素材、字体和 seed，只取横屏 270 帧并读 CDP：

```sh
mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-current minimax-15 artifacts/s1-card-layout \
  --check-card-layout \
  docs/evidence/2026-10-24-s1-director/minimax-second-attempt/review-1-response.json
```

该模式不调用模型或编码影片，不要求模型密钥。仍先核对当前固定镜像、重新登记自己的素材许可；实际创作页面只在渲染容器执行。`layout-check.json` 要求三组标题/副标题都存在、实际盒子间隔不少于 4 px、原帧观测无 BLOCK；`layout-landscape.png` 留在本机忽略目录，不上传第三方素材图片到 Git/Actions 产物。结束时关闭 studio、取消仅用于单帧的操作、确认物理停止/费用后回收密钥。`layout_validated` 只表示此回归通过，不计入六题候选或 4/6 视听结果。

### 只复验 review 冷启动、分段与交付

需要修复媒体基础设施时，沿用已付费完成的纯积木 `write_spec`，或 C 直接返回完整 FilmSpec 的原始回执，不重新调用 A/B/C/E：

```sh
mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-current minimax-15 artifacts/s1-review-render \
  --check-review-render \
  docs/evidence/2026-10-24-s1-director/minimax-second-attempt/review-1-response.json
```

仅接纳完整、未截断/拒绝的原始回执；C 的单一 JSON 围栏由同一共享解析器处理，不补造工具或改写 FilmSpec。原程序配乐／无音乐用法保持不变。复验已批准的 ABC／WAV 时，在 `--check-review-render <回执>` 或 `--check-final-render <回执>` 后追加 `--score <私有 ABC>`／`--music <私有 WAV>`；仍先核对批准的字节与时长、重登记许可，并复用导演同一音频计划构造器。指定音源必须与原 FilmSpec 完全一致，不静音、不替换选择器。使用本题同一私有素材、字体、seed 与实际部署的固定 release。经既有 `renders` 入口实际执行横屏低清 review、音频、接缝/原观测、拼接、提交与私有下载；服务端执行[当前批准的绝对期限](../../docs/plans/cloud-motion-v3.md#53-期限)。`review-render.json` 保留源回执、计划、期限及媒体结果，MP4/封面仅留本机私有忽略目录。与单帧模式共用许可登记、容量/费用核对和密钥回收，`review_render_validated` 不计入导演成功、最终片或 4/6；一个样本也不代表 p50/p95。

只核对当前最终编码与耗时时，将同一命令改为 `--check-final-render`，例如用 [`minimax-15/review-0-response.json`](../../docs/evidence/2026-10-24-s1-director/minimax-15/review-0-response.json)。它仍不调用模型，但请求横屏最终质量，按服务端 1080p/30 fps 与原期限交付；回执及原始 MP4 为 `final-render.json` / `final-film.mp4`。这是同一付费规格在新固定镜像下的原生回归，不替代完整 A–C/E/F 或负责人验收；原 review 命令、参数和输出名保持不变。

### 仅在确需更新素材时采集

这些脚本只为已批准题目准备首轮内部输入，不是客户网址抓取或 AssetWorkflow：

```sh
mise exec -- node research/evals/capture-materials.mjs artifacts/eval-materials-2026-10-24
mise exec -- node research/evals/select-materials.mjs artifacts/eval-materials-2026-10-24
```

采集使用独立临时 Chrome 配置，不登录、不下载应用。`selected.json` 初始为 `pending_visual_selection`；**查看实际 PNG**，排除人物肖像、私人内容、未确认业绩和不完整/源码画面后，记录 `approved_for_internal_eval_by_codex` 与 `reviewedAt`，再入库。不能把截图文件存在当作通过。全量采集拒绝覆盖旧文件；需要补某一题时用新目录或题目参数，避免重做已选图片。

确认 `wrangler whoami` 为项目账户且没有其他 staging 内部会话后执行：

```sh
mise exec -- node research/evals/ingest-materials.mjs artifacts/eval-materials-2026-10-24
```

入库使用已有 Wrangler 连接和 stdin 临时密钥，不读取或导出凭据；已有 `EVAL_API_KEY` 时拒绝覆盖。它核对当前图片与复用回执，原字节已入库时只为新操作重登记证据，不重复上传。仅对调度前确切 `404 Not found` 等待密钥传播；不重试未知超时或素材错误。完成或失败均取消该无计算操作、对账并删除自己的临时密钥。结果先写被 Git 忽略的 `ingestion.json`；仅在真实入库后更新仓库素材索引和事实卡状态。部分成功保留已有 R2 字节与权利记录，不删除或覆盖。

原创事实图另在 `selected.json` 标记 `origin:"original_factual_diagram"`、`factIds`、`originalSourceFile` 与卡片的 `approvalRef`，随已查看的 PNG 一起提交无脚本/外链的 SVG 源稿。负责人批准只适用于该原创图，不撤销第三方截图的许可限制。源稿和逐项批准引用随权利证据保存，不能把来源网页标成截图授权。

后来单独批准的素材可在事实卡 `materialApprovals[素材 ID]` 记录负责人批准日期、内部使用和 staging R2 范围，在 `selected.json` 用 `approvalRef` 指向该条。入库证据沿用这次具体批准，不把新素材回填成旧的通用批准日期；没有单项记录的既有素材继续原用法，IELTS 的第三方截图限制也不改变。

当前完整覆盖及负责人视听只见[实施状态](../../docs/implementation-status.md)，prepared_not_executed不算执行。代码回归另用 [`filmFixture`](../../packages/film-runtime/test/fixture.mjs) 和原创无字界面。

## 先试听已经生成的 13 种配乐

[40059971442 的 `film-runtime-browser` 产物](https://github.com/ten2ten2/promobento/actions/runs/40059971442)保存完整 13 段合格母带及 `audio-samples/index.json`；该 run 整体因 2D seek 失败，不影响这 13 段的独立 `rendered` 结果。本机已经整理好原 WAV 和播放器，不必重新下载或合成：

```sh
open artifacts/s1-audio-review-2026-10-24/index.html
```

试听页可离线播放，保留每段原字节、风格、30 秒时长、响度和来源回执；目标目录存在时拒绝覆盖。已实际生成并查看播放器，Chrome 155.0.8059.85 读到 13 段均为 30 秒、默认 1×，首段播放前进且无解码错误。负责人在正常速度试听请求下回复「保留」，[现有 13 种全部保留](../../docs/evidence/2026-10-24-s1-audio-review/owner-decision.json)。重新打包时仅对来源 run 和对应样本计划都匹配的材料沿用该决定，其他材料仍待试听。六题实际成片的视听与 4/6 评判另行进行。

另有[原创 ABC 与派生 WAV 的 15/30 秒内部测试批准及源母带身份](../../docs/evidence/2026-10-24-s1-audio-review/original-score-test-clearance.json)。原谱和WAV保持私有，不沿用13风格保留结论；ABC已有一次15秒实际review，完整路径的范围见[音乐证据](../../docs/evidence/2026-10-24-s1-director/README.md#abc-15-秒实际-review-已通过音乐全链路未完成)。有对应有效授权时复用已批准原谱和母带，不重新合成源母带；以下仅为命令用法：

```sh
mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-current duolingo-15 artifacts/s1-duolingo-15-score \
  --score artifacts/s1-original-music/s1-original.abc

mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-current duolingo-30 artifacts/s1-duolingo-30-upload \
  --music artifacts/s1-audio-source-proposal/out/30/mixed.wav
```

`--score` / `--music` 先核对批准的字节身份与时长，再为本次操作登记许可，随后交给真实导演；音源使用私有固定键，许可仍逐操作登记。导演须返回指定且未静音的音乐选择，脚本不改写其 FilmSpec；最终候选不匹配即失败。15/30 秒各自取批准的谱长或对应 WAV，以上两个命令只是用法示例，不代表四种组合均已验收。

### 导演参考不是固定分镜

MiniMax 当前事实卡已移除指定积木/三张截图/固定秒数的方案，只保留目标、已确认事实、素材权利、负责人反馈与必须保留的文案/声音。导演按信息形态选择语言和路线，先写 Treatment，再由 D 实现积木不能表达的自写镜头。参考样片不要求复刻相同镜数、BPM 或对象。

旧 `prepared_not_executed` 目录是不可变历史输入，可能仍含三段 `ui-showcase` 和旧 renderer；不要把它改写或作为本轮新创作输入。新自写 renderer 经 Actions 构建/部署并登记后，用现有 `prepare-inputs.mjs` 生成新目录。原已付费规格的工程回归继续保留旧输入，不据此复验创意质量。
