# S1 评测输入

题目与使用范围以 [`topics.json`](topics.json) 为准。六张卡的既有功能/课程事实已按 2026-10-24 官方页面复核，原确认文案不变；三家产品的入口为：

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
