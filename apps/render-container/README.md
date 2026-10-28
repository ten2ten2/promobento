# 隔离渲染服务

[`Dockerfile`](Dockerfile)固定Chromium、GSAP、FFmpeg、字体和运行时，仅通过GitHub Actions构建／推送。runtime为服务入口，browser-test为离线检查入口；实际部署和验收范围见[实施状态](../../docs/implementation-status.md)。

## 执行与隔离

PID1只分离uid后降为10003，控制器10001、Chromium启动器／浏览器10002，均无capability。每次加载作品前核对完整namespace／seccomp沙箱，不降级无沙箱。Chromium使用disable-dev-shm-usage，把共享内存文件落实例私有/tmp，避免64MiB/dev/shm引发页面崩溃；正式／CI共用，不能用此选项关闭沙箱。

私有8080端口接受不可变 [render_task](../../contracts/render-job.schema.json)，每实例一个任务。broker令牌只在可信控制器内存，不进环境／文件／Chromium；所有输入来自该task白名单，逐对象检查字节身份，字体只取镜像登记。页面／作者代码只在Chromium内执行。

## 四种模式

| 模式 | 行为 |
| --- | --- |
| shard | 逐源帧seek，CDP JPEG92直送FFmpeg；PNG重叠／末帧、可信阅读观测、动作姿势及真实回执 |
| assemble | 顺序封装closed-GOP Annex B，混入冻结WAV，检查CFR／PTS／GOP／色彩／音频／时长／体积／一秒码率，封面取真实帧 |
| audio | 冻结AudioPlan合成一次、两遍loudnorm和实际母带测量，48kHz双声道；越界者至多一次补偿／过采样限幅，合格字节不改 |
| studio | 只处理task允许的still／check帧，seek／截图／观测整次互斥；Worker管理许可／generation／关闭 |

分段和必要视频纠正使用平台一秒门槛70%的maxrate、20%的VBV buffer，目标码率不高于maxrate；仍实测滑窗，超标只重编码一次，复测失败阻断。不改变平台交付上限。

assemble对**最终MP4的AAC解码信号**测响度／真峰／静音：任务从同一audio结果的受校验audio-report取得目标，历史直接assemble保持−14LUFS／−1dBTP默认。目标±0.5LU、真峰不高于上限；越界只从原WAV作一次补偿、4×过采样／延迟补偿限幅，再编码AAC、视频复制。余量按该次AAC相对WAV的峰值增量＋0.4dB，仍失败报OUTPUT_AUDIO_OUT_OF_RANGE。冻结母带不覆盖；media.audio保存最终与纠正前实测，reencoded仅指视频重编码。[实际超峰／云验](../../docs/evidence/2026-10-24-s1-director/README.md#当前修复所依据的反例)。

review 组装后另以 [huashu-motion@52467f99c602b76ba86d511d37acdfe93fa1e16e 的 `cli/lib/qa.js`](https://github.com/alchaincyf/huashu-motion/blob/52467f99c602b76ba86d511d37acdfe93fa1e16e/cli/lib/qa.js) 扫描实际 MP4 全部帧；Copyright (c) 2026 Huashu，[MIT 许可](../../packages/film-runtime/src/LICENSE.huashu)。解码适配为本服务有界、可取消的 FFmpeg 进程，输出 `media.motionAudit`。它按 96×54 灰度全画面报告近静止区间、单帧闪变、切点、每秒变化与开场线索，供 E 结合实际画面判断，不自动决定通过或阻断。小鼠标／局部 UI 动作可能漏检，阅读停留与片尾也可能有意静止；这不是音频或完整动态审核。诊断本身的解码／超时失败写 `unavailable`，不把诊断缺失当通过或改变原组装结果。旧的直接 `assemble()` 调用默认不执行此诊断，final 不增加该处理。

`tests/encoded-audio.render.test.mjs` 可在已有隔离镜像内单独运行实际AAC纠正专项；`tests/motion-audit.render.test.mjs` 检查实编码、旧组装接口和诊断失败／取消，随 browser/media CI 运行。它们不是普通文档修改的默认验证。完整音源／样本权利见 [audio NOTICE](../../packages/audio/src/NOTICE.md)。

## 取帧与可信观测

review保持30fps源时间轴，隔帧捕获完整逻辑尺寸JPEG92后由FFmpeg缩半尺寸／15fps；PNG由同一完整尺寸帧在宿主整数面积平均缩小，不用浏览器半比例截图。final为既定1080p／30fps；motion4/8未开放。视频只读授权PTS帧图，不使用video元素。

filmObservationFrames生成全片阅读计划，再落各分段；没有计划点的短段保存空数组。Worker核对精确帧、身份和BLOCK，不以“数组非空”代替覆盖。custom文字观测附sceneId，方法据此核对阅读窗口visibleTextSlots；旧观测合同保留。

filmMotionFrames保存接力落点／中途姿势、自写每秒／事件／交接，前两个自写事件加前后六源帧，review按15fps对齐。E/F另看第一画幅动作拼图，不减少各画幅阅读图。有限采样不是完整动态Q1/Q2或正常速度听感。

对比度普通字4.5:1、大字3:1，不四舍五入；大字按CDP实际≥24px，或≥18⅔px且字重≥700识别，不信作者role豁免。字体、裁切、安全区／遮挡分别保留发现。

WebGL只在3D页按需加载锁定Three.js0.186.1，CDP读取真实WebGL2 renderer/vendor/version，与环境锁核对，失配报RENDER_ENVIRONMENT_MISMATCH。初始化／单帧期限为60／10秒，2D为30／5秒；dispose释放资源，context丢失失败，不重建掩盖问题。

## 输出、费用与诊断

输出先进入 `renders/<renderId>/attempts/<taskId>/…`，Workflow验证后才发布引用，失败attempt不覆盖成功字节。授权输出上传／拼接源下载各至多四路，保序；首失败停派新项并排空在途后清理，不增加物理实例并发。

回执frameCaptureMs按实际编码源帧记录seek／ready／JPEG耗时，排除背压／QA／额外PNG；renderMs仍是分段总耗时，不能拿均摊值补造旧逐帧分布。readyMs仅CDP连接，DO的启动／等名额另计。

内存只取cgroup高水位，不用控制器RSS。接口缺失写peakMemoryMiB:null和cgroup_peak_not_exposed、汇总unverified；权限错误／无效读数阻断。[S1例外](../../docs/evidence/2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)只允许暂缓测量。取消／超时并发固定同一usage，结算冲突核对原记录，可重放不重复计费。

普通失败回执只有可信阶段、有限帧号、白名单系统码、媒体进程名／退出码／已知特征，不含原异常／堆栈／URL／请求头／stderr。无法归类的runtime_ready故障可在原attempt写私有private-failure.json，最多错误／cause各2048字符、替换令牌／Bearer，不含源文件或完整task；写入限三秒，不延长渲染或阻挡清理。普通报告只留私有引用。

初始化由可信控制器有界读取ready／boot-failure标志，不向作品注入RAF／eval轮询，取消或超时不接晚到ready。素材读取失败保留宿主首因，同时使页面请求失败，不能只留下泛化解码错误。

## 校准工具

benchmark只比较授权帧PNG／JPEG90/92/95及解码RGB SSIM，不向客户FilmSpec开放质量旋钮。isolation使用[固定攻击项](../../tests/attacks/film-v1/isolation.json)，不接受调用者代码／命令／主机。

CSP动态编译检查用普通同源脚本，不借CDP调试权限。控制器先检查broker正向／越权，再制造断网请求；uid探针只接一次性令牌指纹和长度，不接bearer，报告不返回指纹／环境值／内存。不可读进程不能记无泄漏，子进程argv残留不误认成环境键。[固定隔离证据](../../docs/evidence/2026-10-24-s1-performance/README.md#正式镜像隔离通过)不代替S2任意代码／耗尽语料。临时文件限本task工作区，用完清理。

可信积木参数／行为和定点CI选择统一见 [film-runtime](../../packages/film-runtime/README.md)，不在容器文档重复积木改版历史。
