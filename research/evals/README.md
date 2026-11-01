# 内部素材与原生导演评测

六题的真实材料、事实卡、来源、既有批准记录和历史费用证据继续保留。题目及素材范围以 [topics.json](topics.json)、[materials.json](materials.json) 和 [fact-cards](fact-cards/) 为准；实际完成度、有效预算与部署范围见[实施状态](../../docs/implementation-status.md)。准备文件、离线 fixture 或原生导出代码存在，都不计作真实作品验收。

## 当前原生导演

方法 2.0.1 直接生成完整 huashu-motion HTML/JS 工程：真实素材观察→三方向原生预览→选择→Brief/Treatment→最难镜头→逐画幅创作、审片与导出。改稿基于不可变 `baseRevision` 和精确文件补丁；横竖画幅分别制作。

创作、方向选择、候选及工程查询使用[内部 API](../../apps/cloud/README.md#内部-api)。这是主线源码入口，实际 staging 版本仍须按实施状态核对。

`contextKey` 指向本次操作的私有输入。创作输入保留确认事实、真实素材、语言、CTA、15/30 秒、平台画幅和固定 renderer release。改稿使用 `baseRevisions: {landscape: "<revisionId>", ...}` 与 `comments: [{text,frame?,elementId?}]`；单画幅也接受 `baseRevision`。基线必须属于同一 workspace/project。已用原生版本及素材不可变，不覆盖旧文件。

模型调用继续受共享账本、原始回执、阶段/操作额度与未知费用预留约束。未知请求不自动重发；生产执行开关与研究授权不会因代码迁移而打开。本次没有新增自动付费 runner。

## 离线准备六题

```sh
mise exec -- node research/evals/prepare-inputs.mjs \
  artifacts/native-eval-inputs renderer-<已部署源码SHA前12位>
```

这条命令只准备文件，不上传、不创建操作、不调用模型或渲染。输出 `manifest.json` 为 `prepared_not_executed`；每题生成 15/30 秒上下文，保留原语言、事实 ID、CTA、来源及本题素材选择。新的 `runtimeVersion` 固定为 huashu-motion `52467f99c602b76ba86d511d37acdfe93fa1e16e`。已存在的输出目录拒绝覆盖；旧 prepared 目录仍是历史输入。

字体由原生 runtime 提供本地 Inter 与 Noto Sans SC；其他实际字体须作为固定文件纳入本项目 manifest，不能引用任意远端 CDN。

## 素材采集与保存

现有采集工具继续用于指定的内部题目。它们保留源文件、字节摘要、来源、派生关系、人工审看和既有批准记录；不是已完成的客户上传或任意网站采集服务。

| 需要 | 工具 |
| --- | --- |
| 页面截图与图片/logo/视频、颜色及字体候选 | [capture-materials.mjs](capture-materials.mjs)，可加 `--grab` |
| 选择已观察材料 | [select-materials.mjs](select-materials.mjs) |
| 指定本地项目文件候选 | [discover-local-materials.mjs](discover-local-materials.mjs)，支持 `--readme`、`--styles`、`--fonts` |
| 已登记网页原图 | [capture-approved-web-images.mjs](capture-approved-web-images.mjs) |
| 已登记本地 PNG/JPEG/WebP | [capture-local-materials.mjs](capture-local-materials.mjs) |
| SVG、ICO、ICNS、静态 GIF/AVIF 的离线栅格化 | [approved-artwork.mjs](approved-artwork.mjs)，也支持 `--web`、`--inline` |
| 实际视频或动态图及源时间证据 | [approved-video.mjs](approved-video.mjs)，支持 `--web` |
| 已审看材料入私有 R2、保留来源证据 | [ingest-materials.mjs](ingest-materials.mjs) |

```sh
mise exec -- node research/evals/capture-materials.mjs artifacts/eval-materials-current
mise exec -- node research/evals/select-materials.mjs artifacts/eval-materials-current
mise exec -- node research/evals/ingest-materials.mjs artifacts/eval-materials-current
```

每条采集入口仍按自身参数检查限定题目、来源和精确字节，不执行目标项目的代码。未审看文件保持待选状态；旧图、原视频和已记录证据不被新一轮采集覆盖。针对现有 WebP 帧包输入，原生导演从绑定证据读取实际原视频及海报；不会运行旧分片/帧包播放器。海报只说明首帧，不能用它推断后续动作。

实际词级对齐证据通过 `timingEvidence` 输入，绑定真实来源的 SHA-256、测得时长和按时间排序的 `words`；没有这类证据就用作者明确写出的事件时间，不伪造旁白词时间戳。自动 ASR 与完整参考片理解仍是待实现功能。

## 查看已经生成的媒体

原生 export 的最终 MP4 附带四张从该 MP4 抽取的帧和 `review-sheet.jpg`，用于独立冷审。原生 HTML capture 与编码后的实际帧在报告中明确区分。它们不能代替正常速度、有声音的人工观看；候选仍保留 `ownerNormalSpeedReview: pending`。

固定安装的 [Hypit 媒体工具](hypit/media.sh)可以离线探测、切片和抽帧既有 MP4：

```sh
mkdir -p artifacts/native-review
bash research/evals/hypit/media.sh <带FFmpeg的已固定镜像> \
  <已有影片.mp4> artifacts/native-review tile \
  --start 0 --end 12 --every 1 --columns 4 --cell 360 --to /out/overview.jpg --json
```

工具只读挂载指定影片及安装内容，断网运行，不提供凭据，也不执行作品组件。Hypit 的导演方法见[方法来源](../../packages/methods/NOTICE.md)，其生产 runtime 未接入 SaaS。

旧链路的 13 种配乐试听与[负责人决定](../../docs/evidence/2026-10-24-s1-audio-review/owner-decision.json)已归档；当前原生配乐使用 huashu 的声音工具，不再提供旧试听页打包脚本。

## 旧执行器与历史证据

FilmSpec、旧分片 runner 和旧 Studio 已删除，历史执行语义可查[归档提交](https://github.com/ten2ten2/promobento/tree/c78a51fa748b3029058119b00874b9043f499da0/research/evals)，不可发送给原生 Worker。

原始回执、源文件、素材索引和[导演证据](../../docs/evidence/2026-10-24-s1-director/README.md)保留不变。[recover-case.mjs](recover-case.mjs)仅核对/清理**已终止**操作的真实资源和未知费用，不能启动旧导演、模型或渲染。
