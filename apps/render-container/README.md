# 隔离渲染服务

[`Dockerfile`](Dockerfile) 共用固定 Chromium、GSAP、FFmpeg、字体与运行时。仅在 GitHub Actions 构建/推送；`runtime` 是生产形态入口，`browser-test` 是离线工程检查入口。PID 1 只做分离 uid 的启动，随后降为 uid 10003；控制器 10001、Chromium 启动器/浏览器 10002，均无 capability。

固定 Chromium/GSAP 的下载及摘要核验在应用源码层之前；小幅运行时或文档修改可复用 Actions 的依赖层缓存，不重新下载同一浏览器与许可文件。字体仍按当前登记核验并构建，版本和沙箱检查不变。

控制器的私有端口 8080 接受不可变 `render_task`，完整结构见 [Schema](../../contracts/render-job.schema.json)。每实例仅绑定一个任务，broker 令牌只在可信控制器内存中。素材、视频帧和音轨从该任务的 broker 清单读取，原始字节按共享摘要校验；字体来自镜像内审核目录。Chromium 没有令牌，页面不能任意出网。

- **shard**：逐源帧 seek，CDP JPEG 92 直送 FFmpeg；保存 PNG 重叠/末帧、真实 CDP 阅读停留观测和回执。
- **assemble**：按序封装 closed-GOP Annex B，混入冻结 WAV；检查 CFR/PTS、GOP、颜色、AAC、时长、体积及滑动一秒码率，必要时整片重编码一次；封面来自实际帧。
- **audio**：从冻结 AudioPlan 合成一次，经两遍 loudnorm 和最终响度/真峰值测量；仅对实际越界者做一次补偿增益与过采样限幅并重测，门槛不变，合格母带字节不改；输出 48 kHz 双声道 PCM。
- **studio**：仅允许该任务列出的 still 帧；生命周期、清权和取消由 Worker/OperationDO 控制。

studio 的 `check` 对同一授权帧重新取 PNG 后读真实 CDP 文字/字体/布局；`benchmark` 只在校准操作中测 PNG、JPEG90/92/95 和解码后 RGB SSIM。seek、截图、观测的整个工具调用互斥，不允许并发请求把不同帧混在一份回执里。所有临时诊断文件在当前任务工作区内，结束即清理。成片仍固定 JPEG92；新增质量选项没有进入客户 FilmSpec 或渲染任务输入。

校准专用 `isolation` 使用[固定攻击项](../../tests/attacks/film-v1/isolation.json)，不接受调用者代码、命令、路径或主机：实际页面检查网络/存储/iframe/Worker、动态代码及引擎锁定，并测 CSP 拦截外部、本地端口与文件图片；控制器测 HTTP/HTTPS、DNS、TCP 与 broker 越权；uid 10002 启动器检查控制器 environ/mem 读取被拒及可读 Chromium 环境的键白名单。回执只有状态、错误码与键名，不返回环境值、内存、令牌或素材内容。它不代替 S2 的任意代码、资源耗尽或全部故障语料。

review 保持同一 30 fps 源时间线，隔帧捕获、半尺寸编码为 15 fps；final 为既定 1080p/30 fps。实验多采样 profile 尚未开放。视频由已授权的 PTS 帧清单取帧，不使用 `<video>`。

阅读停留帧由共享 `filmObservationFrames` 按整片镜头事件生成，再落入各分段；不含计划点的短分段保存空观测数组。Worker 校验每段应有的精确帧、render/画幅、字节身份及 BLOCK 项，不能以任意非空观测代替覆盖。动态/转场 QA 仍在 S2，不能把当前停留帧当作完整时间覆盖。

WebGL 页面按需加载固定 Three.js 0.186.1；控制器通过 CDP 读取真实 WebGL2 context 的 renderer/vendor/version，逐次与环境锁的 SwiftShader renderer 核对，不匹配阻断为 `RENDER_ENVIRONMENT_MISMATCH`。studio ready 与分段回执保留实际字符串。初始化/单帧期限按共享策略分别使用 60/10 秒，2D 保持 30/5 秒；同一镜像内纯 2D 页面不加载 3D bundle。3D 资源在引擎 dispose 时释放，失去 context 明确失败，不悄悄重建。

输出先进入 `renders/<renderId>/attempts/<taskId>/…`；只有 Workflow 检查接缝、观测和 generation 后才发布引用，失败 attempt 不覆盖成功字节。实现与实际验证范围分开记在[实施状态](../../docs/implementation-status.md)。

拼接源下载及已允许的输出上传各最多 4 路 I/O，并保持原分段/输出引用顺序；首个失败后不派新项，等待在途请求结束再清理。仍逐对象核对字节身份和 broker 权限，音视频编码参数、观测/接缝、发布与停止/结算门槛不变。该优化不增加物理实例并发；正式性能另测，不按本地单元通过推断提速。

分段回执新增可选的 `timings.frameCaptureMs`，按实际编码的源帧顺序记录 seek、ready 确认与 JPEG 截图的毫秒耗时，排除编码器背压、QA 和额外接缝 PNG；历史回执不要求补值。`renderMs` 继续表示原分段阶段总耗时，不能当作逐帧分布。Cloudflare DO 另记录等名额和新实例启动至控制器健康响应的时间；原 `readyMs` 仍仅为 CDP 连接耗时。

内存峰值读取 cgroup v2 `memory.peak` 或同义的 v1 `memory.max_usage_in_bytes`；不会用控制器自身 RSS 或 0 冒充整个实例的峰值。负责人已允许本次内部评测在接口均未暴露时继续出片：分段回执必须写 `peakMemoryMiB:null` 和 `peakMemoryUnavailableReason:"cgroup_peak_not_exposed"`，整片报告汇总为 `peakMemory.status:"unverified"`，G1 此指标仍待验。权限错误或无效读数仍阻断。文件系统失败只保留受限系统路径与 syscall，不记录 broker 令牌或完整用户输入。取消/超时并发时，DO 原子固定同一 usage，D1 结算冲突检查与停止时间记录可重放。
