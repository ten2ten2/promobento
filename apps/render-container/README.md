# 原生 huashu-motion 渲染容器

当前执行单元是一个完整的原生项目：`index.html`、`assets/`、`vendor/`。`NativeProject` 只记录文件路径、R2 身份和 15/30 秒、30 fps、平台画幅；页面使用原版 GSAP、Canvas、SVG、Three.js、OM/OM3。渲染调用固定上游的 `capture`、`render`、声音合成与媒体混音实现。

容器安装完整 huashu-motion `52467f99c602b76ba86d511d37acdfe93fa1e16e`（0.3.1），保留 CLI、Studio、运行时、模板、字体、示例和技能。构建校验 315 个原始 blob 后，修改六个 CLI 文件并加入一个可信 helper，七个适配文件均记录和核对 SHA-256；具体边界见[适配器](../../packages/native-motion/README.md)。原生 Studio 保留为本地工具，云端入口只提供帧预览和整片导出。

## 执行接口

`POST /task` 接收 `{taskId, renderId, mode, project, frames?, brokerToken}`，`mode` 为 `preview` 或 `export`。每个容器只接受一次任务；Cloudflare DO 在完成、取消或超时后停止这个容器。`GET /result` 返回 `running`、`succeeded`、`failed` 或 `cancelled`。`POST /cancel` 接受 JSON；DO 的物理停止仍是取消的最终保证。

| 模式 | 输出 |
| --- | --- |
| `preview` | 默认四张原生 PNG，时间为 0、1/3、2/3、末帧；也接受 1–12 个指定时间 |
| `export` | 原生整片 MP4，经一次可信 FFmpeg 输出规格归一；原生预览 PNG、实际成片解码 PNG、`rendered-project.json` 和实际工程文件一并保留 |

输出统一写入 `renders/<renderId>/attempts/<taskId>/out/`。每项包含 `name/key/sha256/byteLength/mediaType`；`report.json` 区分原 manifest 的 `projectHash`、输入 `index.html` 的 `inputSourceSha256` 和声音刷新后的 `renderedSourceSha256`。`report.frames` 为编码帧总数，预览为 0、15 秒为 450、30 秒为 900；预览时间单列在 `previewFrameTimes`。

`frames/*.png` 来自原生 HTML 捕获；`review-frames/*.png` 从最终 `film.mp4` 按 0、1/3、2/3、末帧真实解码，用于独立成片审查，对应 `reviewFrameTimes` 和 `reviewFramesSource: "film.mp4"`。四个静帧不替代正常速度观看或听觉验收。

`review-sheet.jpg` 将四张成片抽帧按行排为 2×2，每格等比缩至最长边 960 像素并填黑边；`reviewSheet` 记录帧号、时间与来源。独立审片可以每个画幅只发送一张接触表，以保留现有模型预算。

完整视频交付前核验真实 FFprobe 输出：尺寸、30 fps、连续帧时间、帧数、H.264 High/YUV420P、BT.709、GOP15、时长、50 MB 上限和 10 Mbps 一秒窗口上限。存在声音时输出 AAC-LC、48 kHz、双声道、128 kbps，并使用 -14 LUFS 的 FFmpeg 标准化目标。这些检查不等于平台上传认证或人工画质验收。

## 原生文件与修改

缺少的固定库会从上游安装补齐：GSAP、`om.js`、`camera-rig.js`、Three/OM3、完整 clip 库，以及 Noto Sans SC 500/900 与 Inter Variable。现有声明文件不被覆盖；原生声音刷新按上游行为更新运行时和音轨。导出后的 manifest 包含实际文件身份，可用于冻结和重现。

Linux 平台字体使用固定 `fonts-dejavu-core` / `fonts-dejavu-mono` 2.37-8 的 TTF，为 Chromium 提供可用的基础字体和通用族映射。上游 WOFF 保持原始字节，通过作品的 `@font-face` 加载，不作为 fontconfig 的系统字体目录。浏览器 fixture 除了检查标题尺寸非零，还用 CDP 查询实际字形来源，要求标题确实使用自定义 Inter；系统 fallback 存在不能代替这个检查。

`packages/native-motion` 的 `editNativeProject` 直接调用上游 `readSource`、`setVariables`、`writeSource`，要求 `baseToken`，沿用 `.om/history`。模型只修改原生页面文件，不产生另一套场景或镜头协议。根元素必须明确声明 `data-composition-id`、`data-width`、`data-height`、`data-duration` 和 `data-fps`；容器还核对浏览器实际读到的值，以及注册在 `window.__timelines[rootId]` 的暂停状态和实际 `duration()`。实际时间线必须与根声明同长，不能靠 `data-duration` 静默截断一条更长时间线。报告记入 `timelineDurationSeconds` 和 `timelinePaused`。

## 隔离

控制器为 UID 10001，原生 Node/Chromium 为 UID 10002，PID 1 为 UID 10003。broker bearer 只在控制器内存，绝不写进任务文件、子进程环境或命令行。原生 launcher 使用 Unix socket，Chromium 通过 CDP pipe 受控，保留 Chrome 沙箱。外层容器必须 `enableInternet=false`；非虚拟资源请求还受不可达代理限制。

作品不再以 `file://` 页面运行。云端补丁使用固定虚拟 HTTP origin，CDP Fetch 只从当前工程目录供给真实字节，不打开 HTTP 服务端口。响应带有 CSP，禁止其他源、`file://`、iframe、Worker、对象嵌入、外部 base 和表单；允许本地脚本、Canvas/WebGL 和内联数据。移除原生 Chrome 的 `--allow-file-access-from-files`。只有原生生成的 `.om/cache/frames` 可作为内部媒体缓存读取，历史目录不对页面供给。

文件按 manifest 的字节数和 SHA-256 校验，拒绝路径穿越、符号链接与特殊文件。原生音视频和 voice 路径在进入 Node 读取或 FFmpeg 前做项目根目录的真实路径检查；FFmpeg 输入按文件头限定 demuxer，拒绝 HLS、concat、SDP 等可间接打开其他文件的清单，MOV 外部数据引用显式关闭。支持普通 MP4/MOV、WebM、WAV/MP3/AAC、FLAC/Ogg、GIF/APNG 等文件，不接受远程媒体或播放清单。

只执行应用和受检上游的 Node 模块，模型提供的 `.js` 或 HTML 从不作为 Node 模块加载。上游源码检查仅编译语法，不在可信进程求值作品。超时先发 SIGTERM，让原生 renderer 释放浏览器，再清理进程树；Chrome 会创建独立进程组，因此 DO 的物理停止是最终边界，不能用“Node 已退出”代替确认容器停止。

上述限制是源码中的隔离机制，不是对任意恶意代码安全性的认证。媒体验证、普通帧渲染通过都不能替代文件/网络负向探针、云端 UID/broker/物理停止验收和持续的浏览器漏洞维护。原生 Studio 没有被直接开放为多租户服务。

## 验证

不调用模型的本地边界检查：

```bash
node --test packages/native-motion/test/*.test.mjs apps/render-container/tests/io.test.mjs
```

真实原生预览、3D、直接修改、声音和整片导出检查在固定 Linux 镜像运行：

```bash
docker build --target browser-test -f apps/render-container/Dockerfile -t promobento-native-test .
sudo apparmor_parser -r apps/render-container/tests/apparmor.profile
docker run --rm --network none \
  --security-opt seccomp=unconfined --security-opt apparmor=promobento-browser-test \
  --cpus 4 --memory 6g --shm-size 1g --pids-limit 512 promobento-native-test
```

测试覆盖四种平台画幅的原生帧，以及 15 秒横屏、30 秒竖屏的真实完整 MP4；还请求同 UID 可读但在工程外的 canary、系统文件、实际本地 HTTP canary、broker 和外网地址，并检查 Worker 被阻止。测试失败不跳过 Chrome、不使用 `--no-sandbox`。可将可写目录挂载到 `/artifacts` 取得 MP4、PNG 和 `native-smoke-report.json`。CI 只构建和检查，不自动部署。云端 broker、D1/R2 与 Cloudflare 的物理停止必须另做真实环境验收。

## 当前边界

这次切换接入原生创作、帧预览和整片导出。公开 Studio、静态 HTML 分享服务、客户身份/计费、原生批注的云端会话，以及 Linux 可用的旁白提供方仍须接入。完整上游语音工具保留，但构建不会自动下载 TTS 模型、调用付费服务或使用 macOS `say`。
