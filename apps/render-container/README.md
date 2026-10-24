# 隔离渲染服务

[`Dockerfile`](Dockerfile) 共用固定 Chromium、GSAP、FFmpeg、字体与运行时。仅在 GitHub Actions 构建/推送；`runtime` 是生产形态入口，`browser-test` 是离线工程检查入口。PID 1 只做分离 uid 的启动，随后降为 uid 10003；控制器 10001、Chromium 启动器/浏览器 10002，均无 capability。

固定 Chromium/GSAP 的下载及摘要核验在应用源码层之前；小幅运行时或文档修改可复用 Actions 的依赖层缓存，不重新下载同一浏览器与许可文件。字体仍按当前登记核验并构建，版本和沙箱检查不变。

控制器的私有端口 8080 接受不可变 `render_task`，完整结构见 [Schema](../../contracts/render-job.schema.json)。每实例仅绑定一个任务，broker 令牌只在可信控制器内存中。素材、视频帧和音轨从该任务的 broker 清单读取，原始字节按共享摘要校验；字体来自镜像内审核目录。Chromium 没有令牌，页面不能任意出网。

- **shard**：逐源帧 seek，CDP JPEG 92 直送 FFmpeg；保存 PNG 重叠/末帧、真实 CDP 阅读停留观测和回执。
- **assemble**：按序封装 closed-GOP Annex B，混入冻结 WAV；检查 CFR/PTS、GOP、颜色、AAC、时长、体积及滑动一秒码率，必要时整片重编码一次。纠正时用门槛 70% 的 maxrate 和 20% 的 VBV buffer 留出峰值余量，并记录纠正前后实测值；原一秒码率门槛不变，仍越界就失败。正常分段参数不变，封面来自实际帧。
- **audio**：从冻结 AudioPlan 合成一次，经两遍 loudnorm 和最终响度/真峰值测量；仅对实际越界者做一次补偿增益与过采样限幅并重测，门槛不变，合格母带字节不改；输出 48 kHz 双声道 PCM。
- **studio**：仅允许该任务列出的 still 帧；生命周期、清权和取消由 Worker/OperationDO 控制。

studio 的 `check` 对同一授权帧重新取 PNG 后读真实 CDP 文字/字体/布局；`benchmark` 只在校准操作中测 PNG、JPEG90/92/95 和解码后 RGB SSIM。seek、截图、观测的整个工具调用互斥，不允许并发请求把不同帧混在一份回执里。所有临时诊断文件在当前任务工作区内，结束即清理。成片仍固定 JPEG92；新增质量选项没有进入客户 FilmSpec 或渲染任务输入。

校准专用 `isolation` 使用[固定攻击项](../../tests/attacks/film-v1/isolation.json)，不接受调用者代码、命令、路径或主机。CSP 动态代码检查由普通同源脚本执行，不借 CDP 的字符串编译权限；仅在本次探针期间开放固定脚本路径，执行后移除脚本/临时结果。实际页面仍检查网络/存储/iframe/Worker、动态代码及引擎锁定，并检查外部、本地端口与文件图片均不可加载，保留实际 CSP 事件。

控制器先做 broker 正向/越权控制，再做 HTTP/HTTPS、DNS、TCP 故意断网请求，逐项保留状态和超时。uid 10002 启动器检查控制器 environ/mem 读取被拒、浏览器父进程环境白名单，并扫描每个可读 Chromium `environ` 的原始字节有无令牌。仅传一次性令牌的 SHA-256 指纹与长度给启动器，不传 bearer；子进程可能覆盖原始 environ 区域，不把其中的 argv 片段当作环境键。回执不返回指纹、环境值、内存、令牌或素材内容；不可读进程不记作无泄漏。它不代替 S2 的任意代码、资源耗尽或全部故障语料。

[正式镜像隔离记录](../../docs/evidence/2026-10-24-s1-performance/README.md#正式镜像隔离通过)已在 `420e245` 的 2D standard-3 与 WebGL standard-4 实测通过上述固定项、完整沙箱与停止结算；不需要为后续素材/文档变更重复该场景。

review 保持同一 30 fps 源时间线，隔帧捕获完整逻辑尺寸的 JPEG92，由既有 FFmpeg scale 半尺寸编码为 15 fps；接缝/观测 PNG 由同一完整尺寸帧在主机用整数面积平均缩到半尺寸，不再使用浏览器的半比例截图。final 为既定 1080p/30 fps，原捕获路径不变。实验多采样 profile 尚未开放。视频由已授权的 PTS 帧清单取帧，不使用 `<video>`。

阅读停留帧由共享 `filmObservationFrames` 按整片镜头事件生成，再落入各分段；不含计划点的短分段保存空观测数组。Worker 校验每段应有的精确帧、render/画幅、字节身份及 BLOCK 项，不能以任意非空观测代替覆盖。动态/转场 QA 仍在 S2，不能把当前停留帧当作完整时间覆盖。

对比度按原方案的普通文字 **4.5:1**、大字 **3:1** 判断，不四舍五入。大字由 CDP 的实际字号/字重识别（24px，或至少 18⅔px 且字重 ≥700），不依赖作者标记或槽位 role；其余字体、裁切、安全区和遮挡判断不变。

`feature-grid@1` 的当前实现为 1.0.1：横屏上图卡片的下方 40% 文案区分为标题 22%、间隔 3%、副标题 15%，避免长标题与副标题重叠。无图卡片及其他画幅布局不变，历史 renderer release 保留原实现。实际失败源的[单帧回归入口](../../research/evals/README.md#只复验实际卡片的标题副标题碰撞)只检查这一组合，不重做完整矩阵。

`ui-showcase@1` 的 1.0.2 与 `ui-journey@1` 共用固定画布的 CPU 逆透视取样；showcase 的边框、阴影和 ROI 同样参与投影，入场缩放/纵向位移、文字和可信点选保留。静态图片与 ROI 都停稳时仅复用不变的像素，每帧仍写回；回跳到运动帧立即重新取样，视频不复用。源码与历史镜像分开冻结，实际回归范围见[导演证据](../../docs/evidence/2026-10-24-s1-director/README.md)。

WebGL 页面按需加载固定 Three.js 0.186.1；控制器通过 CDP 读取真实 WebGL2 context 的 renderer/vendor/version，逐次与环境锁的 SwiftShader renderer 核对，不匹配阻断为 `RENDER_ENVIRONMENT_MISMATCH`。studio ready 与分段回执保留实际字符串。初始化/单帧期限按共享策略分别使用 60/10 秒，2D 保持 30/5 秒；同一镜像内纯 2D 页面不加载 3D bundle。3D 资源在引擎 dispose 时释放，失去 context 明确失败，不悄悄重建。

输出先进入 `renders/<renderId>/attempts/<taskId>/…`；只有 Workflow 检查接缝、观测和 generation 后才发布引用，失败 attempt 不覆盖成功字节。实现与实际验证范围分开记在[实施状态](../../docs/implementation-status.md)。

拼接源下载及已允许的输出上传各最多 4 路 I/O，并保持原分段/输出引用顺序；首个失败后不派新项，等待在途请求结束再清理。仍逐对象核对字节身份和 broker 权限，音视频编码参数、观测/接缝、发布与停止/结算门槛不变。该优化不增加物理实例并发；正式性能另测，不按本地单元通过推断提速。

分段回执新增可选的 `timings.frameCaptureMs`，按实际编码的源帧顺序记录 seek、ready 确认与 JPEG 截图的毫秒耗时，排除编码器背压、QA 和额外接缝 PNG；历史回执不要求补值。`renderMs` 继续表示原分段阶段总耗时，不能当作逐帧分布。Cloudflare DO 另记录等名额和新实例启动至控制器健康响应的时间；原 `readyMs` 仍仅为 CDP 连接耗时。

内存峰值读取 cgroup v2 `memory.peak` 或同义的 v1 `memory.max_usage_in_bytes`；不会用控制器自身 RSS 或 0 冒充整个实例的峰值。接口均未暴露时，分段回执必须写 `peakMemoryMiB:null` 和 `peakMemoryUnavailableReason:"cgroup_peak_not_exposed"`，整片报告汇总为 `peakMemory.status:"unverified"`；继续内部出片与 S1 出口按[负责人决定](../../docs/evidence/2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)处理。权限错误或无效读数仍阻断。文件系统失败只保留受限系统路径与 syscall，不记录 broker 令牌或完整用户输入。取消/超时并发时，DO 原子固定同一 usage，D1 结算冲突检查与停止时间记录可重放。
