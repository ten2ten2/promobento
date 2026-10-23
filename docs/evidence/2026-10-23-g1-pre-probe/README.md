# 2026-10-23 G1 预探针

[云端动效管线改造方案](../../plans/cloud-motion-v3.md)在 S1 的 G1 之前，先在 Cloudflare 上实测风险最高的假设。结果支持方案的现行声明（见方案附录 C）。

## 运行

- **代码**：
  - [探针代码](../../../apps/render-container/probes/g1-pre/)：临时 Worker、容器与运行脚本；
  - [CI 工作流](../../../.github/workflows/g1-pre-probe.yml)。
  - 提交：`c5b9f0b` 为第一轮；`24fd48d` 为第二轮，补跑 standard-3 的 WebGL、standard-4 的 2D 捕获，以及不挂起 `monitor()` 的空闲测试。
- **GitHub Actions 运行**：
  - 第一轮：[39822899286](https://github.com/ten2ten2/promobento/actions/runs/39822899286)。
  - 第二轮：[39824977152](https://github.com/ten2ten2/promobento/actions/runs/39824977152) attempt 2。attempt 1 部署失败：第一轮遗留的容器应用处于 provisioning，wrangler 报 "Container application settings were not fully applied"。
- **原始报告**：
  - [run1-report.json](run1-report.json)、[run2-report.json](run2-report.json)；
  - 已把账户 ID 和 workers.dev 子域替换为占位符。
- **环境**：
  - wrangler 4.152.0；`compatibility_date` 2026-10-20；`scheduling_policy: "durable_object"`；DO 直接调用 `ctx.container`。
  - 镜像为 `node:22-bookworm-slim`，加 `chrome-headless-shell 151.0.7922.34`（归档 SHA-256 与 `apps/renderer/environment.lock.json` 相同）和 Debian 的 ffmpeg。
  - 内核 `6.18.54-cloudflare-microvm-2026.9.16`，CPU 为 AMD EPYC family 25 model 17。
- **测试页面**：上游 `alchaincyf/huashu-motion@4236053` 的 `kinetic-type`（2D）和 `object-3d`（Three.js），由上游引擎驱动；只把 5 秒的绘制等待上调到 120 秒，字体就绪等待上调到 120 秒。GSAP 字节的摘要与 `research/gsap-quickjs/probe.mjs` 中记录的一致。
- **清理**：每轮结束时删除 Worker 和容器应用。`webgl-s3` 留下的容器快照没有删除接口，30 天后过期。

## 结果

| 项目 | 结果 |
| --- | --- |
| 生产组合与 broker | `ctx.container` + `durable_object` + `interceptOutboundHttp('broker.internal', ctx.exports.Broker({props}))` 可用。带令牌读 200（约 100 ms）；无令牌、越权键、越权写前缀均为 403；`PUT` 写入 200 |
| 断网 | 外网 HTTP/HTTPS、DNS（`example.com`）、TCP 443、UDP 53 全部超时；直连 IP 立即 `ECONNRESET`；`broker.internal:8443` 超时。`dns.lookup('broker.internal')` 也超时，但对它的 HTTP 请求正常 |
| 令牌 | 启动环境变量里的令牌被控制器删除后，同 uid（10001）的进程仍能从 `/proc/<pid>/environ` 读到，也能读控制器内存；Chromium 的 uid（10002）读这两处都是 `EACCES`，全进程环境扫描无命中 |
| 沙箱与分离 uid | `SANDBOX_FULL_SEPARATE_UID`：渲染进程 seccomp 为 2，`NSpid` 三层，独立 user 命名空间，所有 Chromium 进程的 uid 为 10002，没有 `--no-sandbox` |
| 冷启动 | standard-3 就绪 7.3–15.7 s（新镜像首次拉取较慢）；standard-1 为 1.5–13.0 s；standard-4 为 1.7 s；从快照恢复 1.7–14.1 s |
| 停止与回收 | `destroy()` 223–525 ms，随后 `running:false`。`signal(15)` 后 378 ms 内停止，退出码 143。6 个实例并发启动、销毁，再并发启动 6 个，全部成功，没有数量上限错误 |
| 空闲 | 挂着 `monitor()` 时，设与不设 `setInactivityTimeout(30000)` 的实例空闲 150 s 后都仍在运行；不挂 `monitor()` 时，两者在 150 s 内都已停止。设定值本身的效果没有分离出来 |
| 快照 | `snapshotContainer` 5.3–6.0 s，约 26 MB；按文档只保存文件系统。恢复后 WebGL 加载 31 s、首帧 4.5 s、每帧 4.6 s，没有收益 |
| Workflows 链路 | `step.do` 让 DO 启动容器并派任务，`step.waitForEvent` 等 DO 的 `sendEvent`，整条链路 2.6 s 完成 |
| Ajv standalone | 完整 `production.schema.json` 预编译后 1.67 MB 源码，Worker 包 2.4 MB / gzip 227 KB；6 个 example 全部通过，删字段的样例被拒；在 workerd 内运行时编译报 `EvalError: Code generation from strings disallowed` |
| 接缝 | `kinetic-type` 第 59 帧冷 seek 与顺序帧的最大差 1 个色阶、0.0031% 像素；提前一帧 seek 为 0.0035%。都在容差内，与附录 A 一致 |

### 2D 捕获（`kinetic-type`，1920×1080，90 帧，CDP 直接截图写入 ffmpeg，控制器不解码）

| 实例 | PNG | JPEG 90 | JPEG 92 | JPEG 95 |
| --- | --- | --- | --- | --- |
| standard-3，ms/帧 | 192.7 | 172.1 | 168.1 | 182.5 |
| standard-4，ms/帧 | 172.7 | 145.9 | 135.7 | 163.9 |
| 相对 PNG 的 SSIM（3 个样本帧） | — | 0.9973–0.9980 | 0.9977–0.9984 | 0.9985–0.9990 |

seek 约 26–32 ms/帧，其余时间都在截图上。JPEG 92 比 PNG 快 13%（standard-3）和 21%（standard-4）。

### WebGL（`object-3d`，1080p）

| 配置 | 页面加载 | 首帧 | 之后每帧 p50 |
| --- | --- | --- | --- |
| standard-3，dpr 1 | 28.3 s | 3.8 s | 3.85 s |
| standard-3，dpr 0.75 | 26.8 s | 10.1 s | 4.23 s |
| standard-3，同一 profile 重启（dpr 1 / 0.75） | 23.2 / 34.2 s | 8.1 / 2.6 s | 3.93 / 4.54 s |
| standard-4，dpr 1 | 16.5 s | 2.4 s | 2.26 s |
| standard-4，同一 profile 重启 | 18.1 s | 2.1 s | 2.19 s |

- 附录 A 的"首帧约 31 秒"没有重现，固定成本主要在页面加载（场景建立）。
- 降低 dpr 和复用着色器缓存都没有稳定收益。
- standard-4 每帧约快 1.7 倍。
- 第一轮中，standard-3 因上游 15 秒的字体就绪等待超时而失败，第二轮放宽后成功。

## 未运行

- 部署或运行时重启时，正在流式的模型调用是否被中断、如何重试。
- Browser Run 抓取、Workers AI ASR。
- 真实作品的 30 秒整片分段渲染与拼接（S1 的 G1 再测）。
- 本机 Docker Desktop 默认的 seccomp 配置会拦截 user 命名空间，Chromium 沙箱在本机只能用 `--security-opt seccomp=unconfined` 运行。这只影响本地开发，Cloudflare 上不受影响。
