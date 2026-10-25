# S1 评测输入

题目与使用范围以 [`topics.json`](topics.json) 为准。六张卡的既有功能/课程事实与确认文案保留；2026-10-25 再次核对 Duolingo、IELTS Ready、Marugoto 和 Hugging Face 的原官方页面，原功能、课程及学习基础陈述仍有依据。IELTS 本次可读到公开页面文字，但原浏览器采集的 403 记录及第三方截图许可限制不因此改变。三家产品的入口为：

- [DeepSeek](fact-cards/deepseek.json)：网页对话、API 平台与文档入口；主画面优先官网和无私人内容的初始界面。
- [MiniMax](fact-cards/minimax.json)：以 MiniMax Code 为软件题目，展示 agent 工作流和 Coding/Work 模式；不引用价格、速度排名或成本节省比例。
- [Duolingo](fact-cards/duolingo.json)：短课、读写听说与个性化练习；官方入门文章含可定位的产品界面截图。

负责人已确认六张卡中的官网功能/课程内容陈述用于 **S1 首次内部评测**，确认范围与事实 ID 保存在卡片中；不含虚构业绩，也不授权公开成片。2026-10-24 已为六题逐张查看并在私有 staging R2 入库 **9 张**素材：五题的 8 张来源图片，以及经负责人批准的 IELTS Ready 原创事实图。源 URL、实际字节身份、尺寸和 D1 权利证据引用见 [`materials.json`](materials.json)；图片不进 Git，不对外发布。每次真实评测前仍核对事实和权利记录，品牌页面发生变化时复核。

负责人于 2026-10-23 确认将三门虚构课程替换为真实公开课程，仅限内部评测：

- [IELTS Ready](fact-cards/ielts-ready.json)：British Council 的练习、短课与专家 webinar；不承诺提分，不把 Premium 条件省掉。
- [Marugoto](fact-cards/marugoto.json)：日本国际交流基金的日语沟通课程；不是 JLPT N2 冲刺班，不使用合格率。
- [Hugging Face LLM Course](fact-cards/hf-llm-course.json)：Transformer、微调、Datasets 与 Tokenizers；保留 Python 学习基础要求。课程材料复用按其 Apache-2.0 许可保留通知，商标与肖像单独处理。

**IELTS Ready 已改用原创事实图**：负责人于 2026-10-24 批准只画已确认的练习、短课与专家直播，不仿造课程界面。1600×1000 原创图已查看并入库；PNG、可编辑 SVG 源稿及权利证据均在私有 R2，原事实确认不变。原页面的 403 和[官网图片许可缺口](https://www.britishcouncil.org/terms)仍保留在卡片：公开官方备选不等于可复用图片。脚本只按原图 ID、事实 ID 和负责人批准放行原创图，仍拒绝该站截图/图片，不把 Premium 手册当免费套餐界面。

## 用私有素材清单准备评测

`materials.json` 的每项提供 `resourceId`、`key`、`sha256`、`byteLength`、尺寸、`licenseRef` 与 `evidenceKey`；字节只在 staging R2。新评测操作先按 cloud 内部 `rights` 入口为自己的 operationId 重新登记同一证据，再将素材加入 `context.resources`。题目用 `materialIds` 选择素材，不能因为同一目录有其他品牌的图就串用。Hugging Face 图附原课程仓库 Apache-2.0 通知及署名；这批素材整体仍限内部评测，不作为免署名商用素材包。

DeepSeek 只留首页的交互/产品入口区域，排除未确认成本/速度公告与登录二维码。MiniMax 取官网下载页发布的原始桌面示例图，账号标签属于官方演示，不是私人账户。Duolingo 取官方入门文章的三种练习与学习路径示例，保留原图。Marugoto 取官方 Minato/课程界面组合。Hugging Face 课程图以原 1816×529 尺寸栅格化，排除页面广告、视频和作者肖像。IELTS 图用原创几何图标和文字，保留免费套餐限定、来源和内部评测标记。9 图合计 976,951 bytes；新操作复用原 8 图字节，仅新增 IELTS PNG 与 SVG 源稿并重登记权利。入库未调用模型或启动渲染，操作已关闭、临时密钥已删除。

### 将六题准备为实际导演输入

```sh
mise exec -- node research/evals/prepare-inputs.mjs \
  artifacts/s1-eval-inputs renderer-257ca1b6babd
```

第二个参数必须固定为将要执行的 renderer release；上例是本轮 G1 的旧镜像版本，不自动追随最新部署。镜像更新后须用新发布 SHA 前 12 位（`renderer-<12位SHA>`）重新准备输入，不能把旧 release 改绑新镜像。脚本已用真实卡片和素材实际生成 **12 份** context：每题 15/30 秒各一份，每份含横竖两画幅，共对应 24 部最终影片。保留卡片原语言、CTA、事实 ID、来源、限定条件和确认记录，素材只取本题 `materialIds`，不改变原文字或推导业绩。

输出 `manifest.json` 标为 `prepared_not_executed`，每例包含 context 文件与 `rightsAdmissions`。真实执行时，为该例创建内部评测操作，先在 `rights` 入口登记其证据，再上传 context，并向既有 `creative` 入口提交 `{operationId,contextKey}`。模型密钥、能力与历史费用门槛仍由服务端检查；准备脚本不上传、不创建云操作、不调用模型/渲染，不代替六题实际评测。

卡片 `facts` 是确认过的证据，不强制把来源长句逐字做成大标题。C 可忠实压缩未定稿文案，仍须保留产品声明归属、限定条件与 factId；固定名称、CTA/URL 和明确提供的最终上屏文字不改。原事实卡、来源与确认记录保持不变。

### 一次执行一份真实导演输入

确认当前 Actions 部署完成、`wrangler whoami` 为项目账户且 staging 没有其他内部会话后，执行：

```sh
mise exec -- node research/evals/run-case.mjs \
  artifacts/s1-eval-inputs-2026-10-24 deepseek-15 artifacts/s1-deepseek-15
```

先读取固定 release，缺失时把该 release 对应的完整 Git 提交及其环境锁存入私有 R2，并通过既有登记入口绑定实际部署镜像；执行脚本的提交另行记录，不能把后续文档或 harness 提交冒充镜像源码。已存在的登记不可覆盖，当前镜像与登记不符就停止。之后只创建该例一个评测操作，重登记自己的素材权利，再调用真实 A/B/C/E/F；模型 secret 留在 Worker。新增费用受共享临时上限和原阶段/次数/期限约束，未知消费保留预留，不重发同一次请求。输出目录存在时拒绝重跑，失败先读 `report.json` 和 `operation.json`。

到 `awaiting_visual_direction_choice` 后查看 `direction-fit.png`、`direction-amplify.png`、`direction-unexpected.png` 及 `directions.json`。据实际画面选择，把 `choice.example.json` 的 key、绑定摘要和具体 reason 保存为同目录 `choice.json`；脚本才向原 Workflow 发送选择，不默认为 fit。成功后 `index.html` 提供横竖两部实际 MP4 的正常速度播放器，候选/冷审、全部费用与未知项保留在 JSON。负责人视听仍记为 pending，程序成功不代替 4/6 评判。

结束时核对物理计算停止、容量和费用，并删除本次临时内部密钥；已成功候选保持 succeeded 和原 generation。失败/中断才取消未结束操作并对账，不删除素材、成片或账本。首次仅运行一题，确认真实模型/媒体结果后再推进其余输入。

与 Actions harness 一样，密钥更新后的相邻请求可能仍看到旧绑定；仅对路由/调度前确切 `404 Not found` 等待最多 30 秒，并记录 `authPropagationRetries`。资源本身不存在、模型/媒体错误及未知超时不重发；一次 capacity 鉴权成功也不假定后续请求已全部传播。

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

仅接纳完整、未截断/拒绝的原始回执；C 的单一 JSON 围栏由同一共享解析器处理，不补造工具或改写 FilmSpec。仅允许程序配乐/无音乐，使用本题同一私有素材、字体、seed 与新的固定 release。经既有 `renders` 入口实际执行横屏低清 review、音频、接缝/原观测、拼接、提交与私有下载；服务端仍执行原绝对期限。`review-render.json` 保留源回执、计划、期限及媒体结果，MP4/封面仅留本机私有忽略目录。与单帧模式共用许可登记、容量/费用核对和密钥回收，`review_render_validated` 不计入导演成功、最终片或 4/6；一个样本也不代表 p50/p95。

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

旧虚构课程卡及其编造的价格、提分率和学员结果已退出评测集。六题实际模型成片与负责人视听验收仍未完成。代码回归另用 [`filmFixture`](../../packages/film-runtime/test/fixture.mjs) 和原创无字界面。

## 先试听已经生成的 13 种配乐

[40059971442 的 `film-runtime-browser` 产物](https://github.com/ten2ten2/promobento/actions/runs/40059971442)保存完整 13 段合格母带及 `audio-samples/index.json`；该 run 整体因 2D seek 失败，不影响这 13 段的独立 `rendered` 结果。不要重新合成，下载后打包原 WAV 即可：

```sh
gh run download 40059971442 --name film-runtime-browser --dir artifacts/s1-audio-source
mise exec -- node research/evals/prepare-audio-review.mjs \
  artifacts/s1-audio-source/audio-samples artifacts/s1-audio-review 40059971442
open artifacts/s1-audio-review/index.html
```

试听页可离线播放，保留每段原字节、风格、30 秒时长、响度和来源回执；目标目录存在时拒绝覆盖。已实际生成并查看播放器，Chrome 155.0.8059.85 读到 13 段均为 30 秒、默认 1×，首段播放前进且无解码错误。负责人在正常速度试听请求下回复「保留」，[现有 13 种全部保留](../../docs/evidence/2026-10-24-s1-audio-review/owner-decision.json)。重新打包时仅对来源 run 和对应样本计划都匹配的材料沿用该决定，其他材料仍待试听。六题实际成片的视听与 4/6 评判另行进行。
