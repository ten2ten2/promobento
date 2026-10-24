# FilmSpec 到可信逐帧页面

S1 运行时已有九个核心积木、额外的真实 WebGL `device-3d`、四种画幅，以及 cut、crossfade、push、whip 转场。`hook-title` 使用暂停的 GSAP 时间轴；其余积木按镜头时间绘制。已接入固定版本的 OM/clip 通用辅助函数和 CSS-3D 界面旅程，不包含上游作者形象。实际通过范围见[实施状态](../../docs/implementation-status.md)。

## 构建和调用

```sh
mise run build:film-runtime
```

这是构建入口；开发期间不默认跑测试或 CI，确有必要时只运行一次最小检查，规则见 [AGENTS](../../AGENTS.md)。

Node 构建端调用 `generateFilmPage(rawJson, options)`（[`src/page.ts`](src/page.ts)）：先经共享解析器、完整 Ajv 和 FilmSpec 跨字段校验，再生成 HTML、CSP 和 PagePlan。`options` 由可信宿主提供画幅、seed、事实确认集合、已清权素材/字体及期限，不接受客户自报清权状态。页内只加载固定 `/runtime/` 脚本、`/r/<resourceId>` 图片、`/frames/<resourceId>/<index>.webp` 视频帧和 `/f/<fontId>/<weight>-<style>.woff2`。视频按 PTS 取帧，有有界位图缓存；缺帧明确失败。

输出文件在被忽略的 `dist/`，HTML 由后续控制器提供。`PagePlan.manifestHash` 当前仅为规范 FilmSpec 的摘要，供页面握手校对；内部渲染另用共享 `filmSourceHash` 固定规范 `film.json` 文件身份，并绑定 seed、资源、字体和运行环境。产品 Composition 已有 film-v1 构造器和冻结参考校验；真实客户冻结与计费服务仍未实现，不能拿 PagePlan 摘要替代完整 Composition 身份。

控制器先用 CDP `Page.addScriptToEvaluateOnNewDocument` 注入构建后的 `shim.js`，再导航到页面；页面就绪后按 [RenderProtocol](../../contracts/render-protocol.d.ts) 发送 `init`、串行 `seek`/`sample`、`inspect`、`dispose`。当前只接受 `trusted_render`、standard 单采样。Shim 的真实绘制时钟只向引擎交接一次，页面使用虚拟时间和每次 seek 重置的 `random-seq-v1`。镜头时间为本镜头起点后的秒数，积木事件与区域函数使用镜头内帧号。

## 浏览器检查只在 CI 容器中运行

`mise run test:browser` 是容器内入口，本机直接运行会明确失败。CI 的 `browser` job 构建 [`Dockerfile`](../../apps/render-container/Dockerfile) 的 `browser-test` target，不推送镜像、不部署服务；检查包含真实 JPEG→H.264 分段→接缝→混音→MP4、九积木四画幅帧集，以及既有顺序/逆序/冷 seek、文字安全区与字体、桥接、时钟、API 禁用和超长文本失败。另生成 13 种程序风格各 30 秒的试听 WAV。截图与报告随 `film-runtime-browser` artifact 提供。

只修复逐帧运行时时，使用 `gh workflow run checks.yml --ref main -f suite=runtime`：在同一个隔离镜像中执行四画幅 seek/布局/桥接检查，含 CSS-3D 界面旅程在推入转场和移动中的顺序/逆序/冷 seek、最终片与 review 两种捕获比例；不重新出片或合成配乐。报告中媒体与试听项为 `not_run`，不会冒充通过；默认完整入口不变。

启动器使用方案规定的固定栅格化参数；日志管道使用带 `pipefail` 的 Bash，容器失败会使 job 失败。比较失败时保留具体画幅、帧号及对比 PNG，报告记录已完成的比较和失败状态；容差仍为最大通道差 ≤2、差异像素 ≤0.1%。当前实际通过范围和待验证问题见[实施状态](../../docs/implementation-status.md)。

测试容器 `--network none`，控制器 uid 10001、Chromium uid 10002。CI 启动器短暂使用 root 分离 uid；Docker 外层放开 seccomp，并加载仅用于该测试容器的命名 AppArmor profile 来允许嵌套用户命名空间（[Chromium 说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)）。子进程丢弃 capability，断言 renderer 的 seccomp、NoNewPrivs 和嵌套 PID namespace。该 CI 配置只执行仓库内的可信积木，Cloudflare 正式隔离仍需 G1 实测。

九积木为 `hook-title`、`ui-showcase`、`cta-endcard`、`feature-grid`、`curriculum`、`ui-journey`、`metric`、`captions`、`talking-head`。后两者消费已清权、已确认的素材/字幕；数值和 CTA 必须绑定事实。字体由镜像转换并登记 cmap，宿主补齐覆盖范围；缺字和实际字体回退分别由静态检查与 CDP 检查。

`device-3d@1` 用 Three.js 0.186.1 将已清权静态截图/SVG 贴到原创设备几何，正文仍经 `ctx.text` 呈现；不接受视频纹理。仅含该积木的页面加载 `blocks-3d.js`，纯 2D 不加载 Three.js。相机/模型姿态只由镜头时间决定，不创建动画循环；初始化等待图片、纹理和首帧，销毁时释放几何、材质、纹理与 WebGL context。`BlockInstance.ready`/`dispose` 为可选资源生命周期，旧积木不需改写。来源与 MIT 通知见[积木许可](../blocks/NOTICE.md)。

自写镜头、全局纹理效果、布局覆盖和本地改值预览仍明确拒绝。当前阅读停留观测不等于 S2 的完整动态 Q1/Q2，也不能替代负责人正常速度试听及审美签字；页面本身不播放音轨。

卡片与名牌可通过 text-slot mount 的 `maxFontSize` 保持层级；自动适配仍受角色最小字号约束，不拆开单词或截断原文来伪装适配成功。退场界面在整段旅程结束时真正隐藏，可信点选只查询画面内的交集；越界文字仍会记录 BLOCK。
