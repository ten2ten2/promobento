# FilmSpec 到可信逐帧页面

S1 的首批运行时实现：`hook-title`、`ui-showcase`、`cta-endcard` 三个积木，四种画幅，以及 cut、crossfade、push、whip 转场。积木使用原创 DOM/CSS 和按时间计算的补间；尚未接入上游 clip、OM、GSAP 或 3D。

## 构建和调用

```sh
mise run build:film-runtime
```

这是构建入口；开发期间不默认跑测试或 CI，确有必要时只运行一次最小检查，规则见 [AGENTS](../../AGENTS.md)。

Node 构建端调用 `generateFilmPage(rawJson, options)`（[`src/page.ts`](src/page.ts)）：先经共享解析器、完整 Ajv 和 FilmSpec 跨字段校验，再生成 HTML、CSP 和 PagePlan。`options` 由可信宿主提供画幅、seed、事实确认集合、已清权素材/字体及期限，不接受客户自报清权状态。页内只加载固定 `/runtime/` 脚本、`/r/<resourceId>` 图片和 `/f/<fontId>/<weight>.woff2`。

输出文件在被忽略的 `dist/`，HTML 由后续控制器提供。`PagePlan.manifestHash` 当前仅为规范 FilmSpec 的摘要，供页面握手校对；生产 Manifest、源包身份、冻结与计费尚未迁移到 film-v1，不能拿这个值替代 Composition 的身份。

控制器先用 CDP `Page.addScriptToEvaluateOnNewDocument` 注入构建后的 `shim.js`，再导航到页面；页面就绪后按 [RenderProtocol](../../contracts/render-protocol.d.ts) 发送 `init`、串行 `seek`/`sample`、`inspect`、`dispose`。当前只接受 `trusted_render`、standard 单采样。Shim 的真实绘制时钟只向引擎交接一次，页面使用虚拟时间和每次 seek 重置的 `random-seq-v1`。镜头时间为本镜头起点后的秒数，积木事件与区域函数使用镜头内帧号。

## 浏览器检查只在 CI 容器中运行

`mise run test:browser` 是容器内入口，本机直接运行会明确失败。CI 的 `browser` job 构建 [`tests/Dockerfile`](../../apps/render-container/tests/Dockerfile)，不推送镜像、不部署服务；测试包含四画幅的顺序、逆序及冷 seek 像素容差比较、实际文字安全区和 webfont、桥接、虚拟时间/随机源、API 禁用和超长文本失败。截图与报告随 `film-runtime-browser` artifact 提供。

启动器使用方案规定的固定栅格化参数；日志管道使用带 `pipefail` 的 Bash，容器失败会使 job 失败。比较失败时保留具体画幅、帧号及对比 PNG，报告记录已完成的比较和失败状态；容差仍为最大通道差 ≤2、差异像素 ≤0.1%。当前实际通过范围和待验证问题见[实施状态](../../docs/implementation-status.md)。

测试容器 `--network none`，控制器 uid 10001、Chromium uid 10002。CI 启动器短暂使用 root 分离 uid；Docker 外层放开 seccomp，并加载仅用于该测试容器的命名 AppArmor profile 来允许嵌套用户命名空间（[Chromium 说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)）。子进程丢弃 capability，断言 renderer 的 seccomp、NoNewPrivs 和嵌套 PID namespace。该 CI 配置只执行仓库内的可信积木，Cloudflare 正式隔离仍需 G1 实测。

自写镜头、视频取帧、纹理、布局覆盖、本地预览改值、音频合成、完整字体登记/缺字检查、其余六个 ★ 积木和生产渲染控制器继续按 S1/S2 实现。未实现的页面能力明确拒绝；页面不播放音轨。当前截图回归不能代替 Q1/Q2、成片验收或负责人的审美签字。
