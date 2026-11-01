# 原生 huashu-motion 渲染容器

**一个任务 = 一个完整原生 HTML/JS 工程 = 一个隔离容器**，只运行 `preview` 或 `export`。NativeProject 1.0.0 负责固定文件、字节身份、15/30 秒、30 fps 与四种画幅；动画、Three.js/Canvas/SVG、GSAP、OM/OM3、声音与整片渲染仍由完整 huashu-motion 实现，不存在 FilmSpec、分片组装或另一套播放器。

固定上游 **v0.3.1** commit `52467f99c602b76ba86d511d37acdfe93fa1e16e`，包含 CLI、Studio、模板、字体、示例和方法参考。构建先验证 315 个原始文件，然后对六个 CLI 文件施加受检云端补丁并安装一个可信 helper，七个改动文件的 SHA-256 在运行时核对。原生 Studio 只保留为上游本地工具，未作为云端多租户 API。适配逻辑见[原生引擎包](../../packages/native-motion/README.md)。

## 容器接口和产物

| 接口 | 行为 |
| --- | --- |
| `POST /task` | `{taskId, renderId, mode, project, frames?, brokerToken}`，每容器仅一次 |
| `GET /result` | `running / succeeded / failed / cancelled` |
| `POST /cancel` | 请求进程退出；DO 确认**物理停止**才完成止损 |

`preview` 默认生成 0、1/3、2/3、末帧四张原生 PNG；可指定 1–12 个合法时刻。`export` 运行完整电影和声音处理，输出 `film.mp4`、原生帧、从最终 MP4 真实解码的四张 `review-frames`、2×2 的 `review-sheet.jpg`、`rendered-project.json` 及实际使用的项目文件。

所有输出写入 `renders/<renderId>/attempts/<taskId>/out/`，以 key、SHA-256、字节数和媒体类型绑定。报告分别记录输入清单 hash、原 `index.html` 摘要、声音刷新后的实际源码摘要，以及 `timelineDurationSeconds` / `timelinePaused`。预览的 `frames` 计数为 0；整片 15/30 秒分别为 **450/900** 帧。`reviewFramesSource` 明确为 `film.mp4`；静帧与拼图不能替代正常速度视听验收。

导出通过实际 FFprobe/帧时序核验：目标画幅、30 fps、15/30 秒、450/900 帧、H.264 High/YUV420P、BT.709、GOP 15、50 MB 上限和一秒窗口 10 Mbps。存在音频时为 AAC-LC、48 kHz、双声道、128 kbps，并按 -14 LUFS 目标归一。成功的回执仍须由 Worker 复验私有 R2 字节后提交。

## 原生文件和隔离

- `index.html` 的 composition root 声明 `data-composition-id/width/height/duration/fps`；容器核对浏览器实际值及 `window.__timelines[rootId]` 的暂停和精确时长。源代码改稿使用上游 `readSource/setVariables/writeSource`、`baseToken` 和历史；模型不能越过原生工程清单调用主机命令。
- 缺失的固定 vendor/字体由上游安装：GSAP、OM、camera rig、Three/OM3、clip 库、Inter Variable、Noto Sans SC。Linux 使用固定 DejaVu TTF 作系统 fallback；上游 WOFF 仍通过项目 `@font-face` 加载。浏览器验证真实 Inter 字形，不只检查存在 fallback。
- controller UID **10001**，原生 Node/Chromium UID **10002**，PID 1 UID **10003**。broker token 仅在 controller 内存；原生进程没有业务密钥，外层 `enableInternet=false`，broker 只读授权文件并只写本任务前缀。
- 页面在受检**虚拟 HTTP origin** 加载当前目录的真实字节，不运行任意本机 HTTP 服务；CSP 禁止外源、`file://`、iframe、Worker、对象嵌入和表单。允许本地脚本与 Canvas/WebGL，保留 Chromium 沙箱，拒绝 `--allow-file-access-from-files`。
- 容器再次核对所有文件字节、真实路径、符号链接、媒体头和 FFmpeg demuxer；禁止 HLS/concat/SDP 等间接资源访问。仅可信应用/上游 JS 在 Node 执行；客户 JS/HTML 只能在浏览器。超时清理进程树，最终以 DO 停止容器为准。

这些是源码与镜像中的限制，**不是任意恶意代码的安全认证**。上游模板或个人资料不会自动变成客户影片；花叔本人形象、头像和作者片尾露出不得进入客户作品。

## 验证与部署

本地边界测试：`node --test packages/native-motion/test/*.test.mjs apps/render-container/tests/io.test.mjs`。固定 Linux 镜像的真实浏览器/视频验收：

```bash
docker build --target browser-test -f apps/render-container/Dockerfile -t promobento-native-test .
sudo apparmor_parser -r apps/render-container/tests/apparmor.profile
docker run --rm --network none \
  --security-opt seccomp=unconfined --security-opt apparmor=promobento-browser-test \
  --cpus 4 --memory 6g --shm-size 1g --pids-limit 512 promobento-native-test
```

测试覆盖四画幅、15/30 秒整片、真实字形/编辑/声音，以及目录外文件、本地 HTTP、broker、外网、Worker 的负向探针；不通过测试时不能跳过 Chrome 或使用 `--no-sandbox`。CI 不自动部署，真实 Cloudflare broker/D1/R2、物理停止、性能和客户权限须另行验收。现行能力见[实施状态](../../docs/implementation-status.md)。
