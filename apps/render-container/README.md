# 原生渲染容器

**一个任务、一个完整 huashu-motion HTML/JS 工程、一个隔离容器**。只运行 `preview` 或 `export`；NativeProject 1.0.0 管文件身份与交付规格，不定义镜头或新动画语言。引擎版本、补丁及固定文件校验见[原生适配器](../../packages/native-motion/README.md)；上游本地 Studio 不对外提供多租户 API。

## 接口与产物

| 接口 | 行为 |
| --- | --- |
| `POST /task` | `{taskId, renderId, mode, project, frames?, brokerToken}`；每容器只接一次 |
| `GET /result` | `running / succeeded / failed / cancelled` |
| `POST /cancel` | 请求退出；以 Durable Object 确认的物理停止为准 |

- `preview` 返回四个默认时刻（首帧、1/3、2/3、末帧）的 PNG，或 1–12 个指定帧。
- `export` 返回 `film.mp4`、从最终 MP4 解码的四张 `review-frames`、`review-sheet.jpg`、`rendered-project.json` 和实际使用的项目文件。15/30 秒分别是 450/900 帧、30 fps；原生预览和最终编码审片不可混淆。
- 输出限定到 `renders/<renderId>/attempts/<taskId>/out/`；R2 key、SHA-256、字节数、媒体类型以及输入清单、输入 HTML、声音刷新后 HTML 和实际渲染清单的身份都记录在回执中。

素材下载和结果上传以有界文件流及共享 SHA-256 验证，每方向最多两个并行文件；不把整部媒体缓存为 Buffer。容器采样 cgroup 内存高水位/OOM/CPU、控制器 RSS/FD 和任务挂载文件系统用量，缺测填 `null`。**文件系统已用量增量不是 `/jobs` 目录精确大小**，控制器 RSS 也不能代替容器内存峰值；真实云端数据仍待验收。

## 编码与核验

受检上游 `deliveryH264` 生成逐行扫描、H.264 High/YUV420P、BT.709、15 帧 GOP、无 B 帧的候选。最终处理验证解码帧/PTS、码率和音视频属性：合规时复制视频流并封装 faststart MP4；不合规则以 `libx264` 重编码，隔行视频先用 `bwdif` 去隔行。失败的复制结果同样回退转码，不能跳过最终校验。

音频仍归一到约 -14 LUFS、编码 AAC-LC 48 kHz 立体声；短音轨补静音、长音轨截断至视频时长。两条视频处理路径均再次检查画幅、30 fps、450/900 帧、15/30 秒、音轨和 50 MB 上限，并从**最终 MP4** 解码审片图。回执记录 `media.videoEncoding`（`stream_copy`/`transcoded`）、处理时间和复制拒绝原因。流复制的本地功能已有验证，云端 CPU/费用节省尚无实测结论。

## 文件与沙箱

- `index.html` 的 composition root 须声明 ID、尺寸、时长、帧率；实际 DOM 和 `window.__timelines[rootId]` 的暂停/时长重新验证。编辑使用原生 `readSource/setVariables/writeSource` 与乐观 `baseToken`。
- 固定 GSAP、OM/OM3、Three、camera rig、clip、Inter 和 Noto Sans SC 从原生上游安装，预存同名文件必须字节一致；浏览器实际字体也受测试。Linux 系统 fallback 不可冒充已加载的项目字体。
- controller 为 UID **10001**，Node/Chromium 为 **10002**，PID 1 为 **10003**。任务专用 broker token 只在可信 controller 内存；原生进程无业务密钥。容器断网，Broker 只按本次授权清单读写，客户源码只在保留 Chromium 沙箱的浏览器执行。
- 当前工程使用受检的虚拟 HTTP origin 与 CSP，阻止外网、`file://`、iframe、Worker、对象嵌入及任意主机命令；复核真实路径、symlink、媒体头和 FFmpeg demuxer，超时清理进程树。这些是明确的隔离措施，**不等于任意恶意代码的全面安全认证**。客户影片不得引入花叔本人形象。

## 验证与部署

本地边界检查：`node --test packages/native-motion/test/*.test.mjs apps/render-container/tests/io.test.mjs`。包含真实 FFmpeg、Chromium、四画幅、原生编辑、15/30 秒视频/声音和越权探针的固定 Linux 镜像测试：

```bash
docker build --target browser-test -f apps/render-container/Dockerfile -t promobento-native-test .
sudo apparmor_parser -r apps/render-container/tests/apparmor.profile
docker run --rm --network none \
  --security-opt seccomp=unconfined --security-opt apparmor=promobento-browser-test \
  --cpus 4 --memory 6g --shm-size 1g --pids-limit 512 promobento-native-test
```

CI 还在相同固定浏览器镜像中运行审批素材 SVG/图标、视频/动态图和网页观察测试；只挂载只读源码及临时测试目录，断网且不调用模型。CI 不自动部署；实际 Cloudflare Broker/D1/R2、物理停止、高并发、客户权限和作品视听仍须分别验收。已验证 SHA 见[实施状态](../../docs/implementation-status.md)。
