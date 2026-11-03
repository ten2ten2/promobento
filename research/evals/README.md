# 内部素材与导演评测

六题真实素材、事实卡、授权、原始回执和费用证据继续保留；题目及文件以 [topics.json](topics.json)、[materials.json](materials.json)、[fact-cards](fact-cards/) 为准。准备文件或离线 fixture **不算真实作品通过**；覆盖、预算和部署状态见[实施状态](../../docs/implementation-status.md)。

## 原生评测输入

方法 2.1.0 以完整 huashu-motion HTML/JS 工程制作三方向预览、Treatment、Script、各画幅原生影片及改稿，使用[内部 API](../../apps/cloud/README.md#内部-api)，不是已上线的 Studio。输入 `contextKey` 指向私有 JSON，包含确认事实、素材、授权、语言、CTA、15/30 秒、平台预设和固定 renderer release。

改稿以 `baseRevisions: {landscape: "<revisionId>", ...}`、`comments: [{text,frame?,elementId?}]` 指定；单画幅也接受 `baseRevision`。父版本必须属于同一 workspace/project，不能覆盖已付费或已生成的历史版本。共享模型账本保留未知费用预留；此前临时授权过期，当前不提供自动付费 runner。

离线准备六题：

```sh
mise exec -- node research/evals/prepare-inputs.mjs \
  artifacts/native-eval-inputs renderer-<已部署源码SHA前12位>
```

输出 `manifest.json` 标记 `prepared_not_executed`；不会上传、创建操作、调用模型或渲染。命令拒绝覆盖已存在目录，保留原语言、事实、来源和素材选择；`runtimeVersion` 固定 huashu commit `52467f99c602b76ba86d511d37acdfe93fa1e16e`。字体使用原生 Inter/Noto Sans SC，其他实际字体须纳入工程 manifest，不能依赖 CDN。

## 采集、选择与入库

这些工具只用于登记的内部题目；每个来源先人工审看，不构成客户上传或任意网站抓取能力。
本地素材浏览器默认使用 macOS Chrome；Linux CI 通过 `PROMOBENTO_EVAL_CHROME_PATH` 指向固定 Chromium。`pnpm test` 执行不依赖浏览器的素材验证，PR CI 的浏览器任务另行验证真实解码和渲染。

| 用途 | 工具 |
| --- | --- |
| 网页截图、图片/logo/视频和颜色/字体候选 | [capture-materials.mjs](capture-materials.mjs)，可用 `--grab` |
| 人工筛选已观察的素材 | [select-materials.mjs](select-materials.mjs) |
| 已登记本地项目文件 | [discover-local-materials.mjs](discover-local-materials.mjs)，可用 `--readme`、`--styles`、`--fonts` |
| 已批准网页图片、本地图片 | [capture-approved-web-images.mjs](capture-approved-web-images.mjs)、[capture-local-materials.mjs](capture-local-materials.mjs) |
| SVG/ICO/ICNS/GIF/AVIF 栅格化 | [approved-artwork.mjs](approved-artwork.mjs) |
| 视频/动态图和原始时间证据 | [approved-video.mjs](approved-video.mjs) |
| 审看通过的素材及授权证据入 R2 | [ingest-materials.mjs](ingest-materials.mjs) |

```sh
mise exec -- node research/evals/capture-materials.mjs artifacts/eval-materials-current
mise exec -- node research/evals/select-materials.mjs artifacts/eval-materials-current
mise exec -- node research/evals/ingest-materials.mjs artifacts/eval-materials-current
```

重新筛选单一题目时，先在内存中完成全部采集，再以内容哈希文件名保存并一次性提交 `selected.json`；网络中断或某项选择失败不会删掉原来已审看的清单。官方 PNG 若单边超过 4096px、但仍在有界原图范围内，使用禁用网络的 Chromium 画布按完整画面等比缩小，保留原 PNG、输入输出哈希及尺寸衍生记录；入库时重新验证并同时上传原件。批准网页图片的同源缓存重定向会逐跳重新校验 DNS，不接受跨域跳转。

上传原文件、衍生物、授权证据及 manifest 时按**实际发送字节**核对 SHA-256。入库前检查 staging 运行中租约和排队是否为空；异常时停止，不接管其他评测。未审看素材不自动采用，旧源文件和历史证据不覆盖。WebP 视频帧包通过授权证据映射回原视频与海报；海报不代表整片动作，也不会启用旧帧包播放器。

视频帧包的 `samplingRule` 随新版 manifest 和素材来源记录，用于固定 Chromium 抽帧时点及呈现顺序。旧版未标记的审核帧包仍以当时的抽帧方式逐字节复验；不为通过验证而覆盖既有帧包或授权记录。

真实词级时间证据可通过 `timingEvidence` 绑定来源 SHA-256、时长与排序后的 `words`。缺失时只使用导演明确给出的事件时间，不伪造 ASR 时间戳；自动转写与完整参考片理解仍未实现。

## 查看已经生成的媒体

最终 MP4 的四张解码帧、`review-sheet.jpg` 与原生 HTML 预览分别留证，不能代替有声正常速度人工观看；`ownerNormalSpeedReview` 仍为 `pending`。已生成的影片还可用固定 [Hypit 媒体脚本](hypit/media.sh)只读抽帧：

```sh
mkdir -p artifacts/native-review
bash research/evals/hypit/media.sh <带FFmpeg的已固定镜像> \
  <已有影片.mp4> artifacts/native-review tile \
  --start 0 --end 12 --every 1 --columns 4 --cell 360 --to /out/overview.jpg --json
```

[recover-case.mjs](recover-case.mjs)用于检查或清理**已终止**的操作；即使临时密钥写入后 CLI 未收到确认，也会尝试撤销并记录结果。作品、费用和质量原始证据见[导演评测](../../docs/evidence/2026-10-24-s1-director/README.md)。
