# 隔离渲染服务

[`Dockerfile`](Dockerfile) 共用固定 Chromium、GSAP、FFmpeg、字体与运行时。仅在 GitHub Actions 构建/推送；`runtime` 是生产形态入口，`browser-test` 是离线工程检查入口。PID 1 只做分离 uid 的启动，随后降为 uid 10003；控制器 10001、Chromium 启动器/浏览器 10002，均无 capability。

控制器的私有端口 8080 接受不可变 `render_task`，完整结构见 [Schema](../../contracts/render-job.schema.json)。每实例仅绑定一个任务，broker 令牌只在可信控制器内存中。素材、视频帧和音轨从该任务的 broker 清单读取，原始字节按共享摘要校验；字体来自镜像内审核目录。Chromium 没有令牌，页面不能任意出网。

- **shard**：逐源帧 seek，CDP JPEG 92 直送 FFmpeg；保存 PNG 重叠/末帧、真实 CDP 阅读停留观测和回执。
- **assemble**：按序封装 closed-GOP Annex B，混入冻结 WAV；检查 CFR/PTS、GOP、颜色、AAC、时长、体积及滑动一秒码率，必要时整片重编码一次；封面来自实际帧。
- **audio**：从冻结 AudioPlan 合成一次，经两遍 loudnorm 和最终响度/真峰值测量；仅对实际越界者做一次补偿增益与过采样限幅并重测，门槛不变，合格母带字节不改；输出 48 kHz 双声道 PCM。
- **studio**：仅允许该任务列出的 still 帧；生命周期、清权和取消由 Worker/OperationDO 控制。

review 保持同一 30 fps 源时间线，隔帧捕获、半尺寸编码为 15 fps；final 为既定 1080p/30 fps。实验多采样 profile 尚未开放。视频由已授权的 PTS 帧清单取帧，不使用 `<video>`。

输出先进入 `renders/<renderId>/attempts/<taskId>/…`；只有 Workflow 检查接缝、观测和 generation 后才发布引用，失败 attempt 不覆盖成功字节。实现与实际验证范围分开记在[实施状态](../../docs/implementation-status.md)。
