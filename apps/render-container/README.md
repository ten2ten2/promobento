# 隔离渲染服务

[`Dockerfile`](Dockerfile) 共用固定 Chromium、GSAP、FFmpeg、字体与运行时。仅在 GitHub Actions 构建/推送；`runtime` 是生产形态入口，`browser-test` 是离线工程检查入口。PID 1 只做分离 uid 的启动，随后降为 uid 10003；控制器 10001、Chromium 启动器/浏览器 10002，均无 capability。

固定 Chromium/GSAP 的下载及摘要核验在应用源码层之前；小幅运行时或文档修改可复用 Actions 的依赖层缓存，不重新下载同一浏览器与许可文件。字体仍按当前登记核验并构建，版本和沙箱检查不变。

Chromium 使用 `--disable-dev-shm-usage`，将共享内存文件放到容器私有 `/tmp`，避免 64 MiB `/dev/shm` 在高图预处理时触发页面崩溃。该反例已用同一原规格复现：512 MiB 成功，64 MiB 崩溃，64 MiB 加该选项成功；浏览器仍以 uid 10002、完整 namespace/seccomp 沙箱运行，不使用 `--no-sandbox`。CI 浏览器入口与正式启动器共用此选项，云端成片另按实际回执判断。

控制器的私有端口 8080 接受不可变 `render_task`，完整结构见 [Schema](../../contracts/render-job.schema.json)。每实例仅绑定一个任务，broker 令牌只在可信控制器内存中。素材、视频帧和音轨从该任务的 broker 清单读取，原始字节按共享摘要校验；字体来自镜像内审核目录。Chromium 没有令牌，页面不能任意出网。

- **shard**：逐源帧 seek，CDP JPEG 92 直送 FFmpeg；保存 PNG 重叠/末帧、真实 CDP 阅读停留观测和回执。
- **assemble**：按序封装 closed-GOP Annex B，混入冻结 WAV；检查 CFR/PTS、GOP、颜色、AAC、时长、体积及滑动一秒码率。初始分段和必要的整片纠正均使用门槛 70% 的 maxrate、20% 的 VBV buffer，目标码率不高于该 maxrate，避免大储备反复触发第二次编码；平台预设的交付格式和一秒上限不变。拼接后仍实测滑窗，超过上限只纠正一次并记录前后值，仍越界就失败；封面来自实际帧。
- **audio**：从冻结 AudioPlan 合成一次，经两遍 loudnorm 和 WAV 母带响度/真峰值测量；仅对实际越界者做一次补偿增益与过采样限幅并重测，门槛不变，合格母带字节不改；输出 48 kHz 双声道 PCM。
- **studio**：仅允许该任务列出的 still 帧；生命周期、清权和取消由 Worker/OperationDO 控制。

assemble 对实际 MP4 的 AAC 解码信号测响度／真峰。新云端任务通过同一 audio 结果的受校验 `audio-report` 引用传入冻结响度目标、真峰上限和静音状态；历史直接 assemble 用法保持原 −14 LUFS／−1 dBTP 默认，不新增必填参数。有声结果须在响度目标 ±0.5 LU 内、真峰不高于原上限，非预期静音阻断。合格文件不重写；越界时只从原 WAV 做一次补偿增益、4× 过采样和带延迟补偿的限幅，再编码 AAC，视频直接复制。限幅余量依据本次 AAC 相对 WAV 的实测峰值增量加 0.4 dB，复测仍不合格则以 `OUTPUT_AUDIO_OUT_OF_RANGE` 阻断；失败回执保留数值，不交给模型改片。`media.audio` 记录最终实测及必要的纠正前值；`reencoded` 仍只表示视频重编码。实现依据见 [FFmpeg limiter](https://ffmpeg.org/ffmpeg-filters.html#alimiter)，[原始超标反例](../../docs/evidence/2026-10-24-s1-director/README.md#音效增益修复已云验编码后的音频峰值仍不合格)不改记通过。

`tests/encoded-audio.render.test.mjs` 可在已有隔离镜像内单独执行，覆盖实际合成音频的 AAC 超峰、一次纠正、合格字节不改、纠正失败阻断、静音和无音轨；同一用例接入既有媒体检查，不重做 13 种配乐或浏览器矩阵。

FFmpeg 线程按实例的整数 CPU 配额设置：standard-2 为 1、standard-3 为 2、standard-4 为 4；音频固定为 1。拼接实际使用 standard-2，不再沿用分段的双线程默认值。

studio 的 `check` 对同一授权帧重新取 PNG 后读真实 CDP 文字/字体/布局；活动 custom 镜头的文字观测附带所属 `sceneId`，用于按[阅读窗口契约](../../docs/prd/14-production-contracts.md#2-manifest目标与冻结准备)区分同槽位的重叠镜头，旧观测仍有效。`benchmark` 只在校准操作中测 PNG、JPEG90/92/95 和解码后 RGB SSIM。seek、截图、观测的整个工具调用互斥，不允许并发请求把不同帧混在一份回执里。所有临时诊断文件在当前任务工作区内，结束即清理。成片仍固定 JPEG92；新增质量选项没有进入客户 FilmSpec 或渲染任务输入。

校准专用 `isolation` 使用[固定攻击项](../../tests/attacks/film-v1/isolation.json)，不接受调用者代码、命令、路径或主机。CSP 动态代码检查由普通同源脚本执行，不借 CDP 的字符串编译权限；仅在本次探针期间开放固定脚本路径，执行后移除脚本/临时结果。实际页面仍检查网络/存储/iframe/Worker、动态代码及引擎锁定，并检查外部、本地端口与文件图片均不可加载，保留实际 CSP 事件。

控制器先做 broker 正向/越权控制，再做 HTTP/HTTPS、DNS、TCP 故意断网请求，逐项保留状态和超时。uid 10002 启动器检查控制器 environ/mem 读取被拒、浏览器父进程环境白名单，并扫描每个可读 Chromium `environ` 的原始字节有无令牌。仅传一次性令牌的 SHA-256 指纹与长度给启动器，不传 bearer；子进程可能覆盖原始 environ 区域，不把其中的 argv 片段当作环境键。回执不返回指纹、环境值、内存、令牌或素材内容；不可读进程不记作无泄漏。它不代替 S2 的任意代码、资源耗尽或全部故障语料。

[正式镜像隔离记录](../../docs/evidence/2026-10-24-s1-performance/README.md#正式镜像隔离通过)已在 `420e245` 的 2D standard-3 与 WebGL standard-4 实测通过上述固定项、完整沙箱与停止结算；不需要为后续素材/文档变更重复该场景。

review 保持同一 30 fps 源时间线，隔帧捕获完整逻辑尺寸的 JPEG92，由既有 FFmpeg scale 半尺寸编码为 15 fps；接缝/观测 PNG 由同一完整尺寸帧在主机用整数面积平均缩到半尺寸，不再使用浏览器的半比例截图。final 为既定 1080p/30 fps，原捕获路径不变。实验多采样 profile 尚未开放。视频由已授权的 PTS 帧清单取帧，不使用 `<video>`。

阅读停留帧由共享 `filmObservationFrames` 按整片镜头事件生成，再落入各分段；不含计划点的短分段保存空观测数组。Worker 校验每段应有的精确帧、render/画幅、字节身份及 BLOCK 项，不能以任意非空观测代替覆盖。动态/转场 QA 仍在 S2，不能把当前停留帧当作完整时间覆盖。

带 Logo 的节拍接力另由 `filmMotionFrames` 采集每次落点和相邻落点中间的实际 PNG，存入 `motion-frames/`，不对运动期文字误用停留 QA。E/F 单独接收第一画幅的关键姿势拼图；各画幅的原阅读拼图不缩小、不减少，旧无动作图的回执仍保留原范围。关键姿势不是完整运动或听感验收。

对比度按原方案的普通文字 **4.5:1**、大字 **3:1** 判断，不四舍五入。大字由 CDP 的实际字号/字重识别（24px，或至少 18⅔px 且字重 ≥700），不依赖作者标记或槽位 role；其余字体、裁切、安全区和遮挡判断不变。

`hook-title@1` 1.0.1 按实际适配后的标题/副标题高度居中成组，不再将副标题固定在安全区底部。`feature-grid@1` 与 `curriculum@1` 1.0.1 的纯文字组合按实际内容收紧为居中的排版带，去掉空图片卡片的外框，标题/补充说明保留间距；不靠重复一张截图填空。原参数的槽位文字、字号下限、音效事件及四画幅方向不变，历史 renderer release 保留原实现。

`feature-grid@1` 1.1.0 可用 `beatFrames`（6–60 个源帧）将每项停稳间隔与音乐整拍对齐；首项在局部第 15 帧停稳，末项须在镜头结束前。自动音效逐项跟随停稳事件，最后一项仍用 `feature-land`，不重复播放。可再传清权的 `logoKey`：单个 Logo 随各项停稳依次移动，横屏在标题上方、其余画幅在左侧；此时只用文字项，不与重复截图混排。未提供新参数的旧用法保持原行为。CI `suite=runtime / runtime_case=relay` 只检查四画幅的 Logo 解码、落点、布局及顺序／逆序／冷 seek，不重跑成片或 13 种配乐。

feature-grid 带图卡片沿用既有布局：横屏下方 40% 文案区分为标题 22%、间隔 3%、副标题 15%，避免长标题与副标题重叠。[实际单帧回归入口](../../research/evals/README.md#只复验实际卡片的标题副标题碰撞)保留。CI 的 `suite=runtime / runtime_case=typography` 只检查改变的开场与纯文字网格，不重跑旅程、showcase、媒体或配乐。

`ui-showcase@1` 的 1.0.3 与 `ui-journey@1` 共用固定画布的 CPU 逆透视取样。showcase 的静态入场先合成面板/图片与 ROI 的端点纹理，按预乘透明度仅融合有差异的像素，每帧只投影一次；停稳底图仍取原全分辨率采样，ROI 同样只融合差异像素。静态图片与 ROI 全部停稳后复用完成像素，每帧仍写回；回跳到运动帧重新取样，视频沿用逐帧原路径。边框、阴影、入场缩放/纵移、文字、点选和历史 renderer release 保留；实际回归范围见[导演证据](../../docs/evidence/2026-10-24-s1-director/README.md)。

WebGL 页面按需加载固定 Three.js 0.186.1；控制器通过 CDP 读取真实 WebGL2 context 的 renderer/vendor/version，逐次与环境锁的 SwiftShader renderer 核对，不匹配阻断为 `RENDER_ENVIRONMENT_MISMATCH`。studio ready 与分段回执保留实际字符串。初始化/单帧期限按共享策略分别使用 60/10 秒，2D 保持 30/5 秒；同一镜像内纯 2D 页面不加载 3D bundle。3D 资源在引擎 dispose 时释放，失去 context 明确失败，不悄悄重建。

输出先进入 `renders/<renderId>/attempts/<taskId>/…`；只有 Workflow 检查接缝、观测和 generation 后才发布引用，失败 attempt 不覆盖成功字节。实现与实际验证范围分开记在[实施状态](../../docs/implementation-status.md)。

拼接源下载及已允许的输出上传各最多 4 路 I/O，并保持原分段/输出引用顺序；首个失败后不派新项，等待在途请求结束再清理。仍逐对象核对字节身份和 broker 权限，音视频编码参数、观测/接缝、发布与停止/结算门槛不变。该优化不增加物理实例并发；正式性能另测，不按本地单元通过推断提速。

分段回执新增可选的 `timings.frameCaptureMs`，按实际编码的源帧顺序记录 seek、ready 确认与 JPEG 截图的毫秒耗时，排除编码器背压、QA 和额外接缝 PNG；历史回执不要求补值。`renderMs` 继续表示原分段阶段总耗时，不能当作逐帧分布。Cloudflare DO 另记录等名额和新实例启动至控制器健康响应的时间；原 `readyMs` 仍仅为 CDP 连接耗时。

内存峰值读取 cgroup v2 `memory.peak` 或同义的 v1 `memory.max_usage_in_bytes`；不会用控制器自身 RSS 或 0 冒充整个实例的峰值。接口均未暴露时，分段回执必须写 `peakMemoryMiB:null` 和 `peakMemoryUnavailableReason:"cgroup_peak_not_exposed"`，整片报告汇总为 `peakMemory.status:"unverified"`；继续内部出片与 S1 出口按[负责人决定](../../docs/evidence/2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)处理。权限错误或无效读数仍阻断。文件系统失败只保留受限系统路径与 syscall，不记录 broker 令牌或完整用户输入。取消/超时并发时，DO 原子固定同一 usage，D1 结算冲突检查与停止时间记录可重放。

内部失败回执补充可信阶段（浏览器启动、seek、截图、编码写入、观测、拼接／声音或上传）、有限帧号及白名单系统码。媒体诊断只保留进程名、退出码／信号和已知错误特征；不序列化原始异常消息、堆栈、URL、请求头或 FFmpeg stderr。最内层阶段随原错误保留，不更改重试类别、预算、期限或停止／结算规则。

对于仍无法分类的 `runtime_ready / RENDER_INTERNAL_ERROR`，控制器另经原 attempt 的 broker 写入私有 `private-failure.json`，最多保存各 2,048 字符的错误消息及直接 cause，替换 broker 令牌和 Bearer 值，不存堆栈、请求头、源文件或完整任务。普通回执仅返回私有对象引用；该对象不进入公开 GitHub／Actions 产物。写入最多 3 秒，失败不覆盖原故障或阻挡清理，也不延长原渲染期限。

初始化的就绪等待由可信控制器定时读取 runtime 的 ready／boot-failure 数据标志，不在作品页面注入 Playwright 的 RAF／eval 轮询。单次 CDP 读取仍受原初始化总期限约束，超时／取消不会接受晚到 ready；页面的网络、计时器与 CSP 限制不变。

浏览器素材服务遇到读取错误时，页面仍收到失败响应，可信控制器同时保留原错误作为首因；不再只留下随后泛化的图片解码失败。诊断输出仍只有白名单字段，不包含原消息或素材内容。
