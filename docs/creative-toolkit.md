# 用移植工具创作，而不是搬进任意网页

这批工具用于本地 M0a 的 `canvas-media-v1` 创作与改稿。创作源码仍在 QuickJS 容器执行；可信浏览器只消费经过校验的绘图数据。几何 profile、15/30 秒、30 fps 和既有平台预设不变。

## 入口和边界

| 工具 | 接入位置 | 使用方式 |
| --- | --- | --- |
| 导演与方法 | [本地导演](../apps/agent-runner/README.md) | 按任务、阶段和已准入能力选择方法，不整包塞入提示；格式和视觉语言是可组合参考，不是必选模板 |
| 动画、2D 相机与七类画面语法 | [创作 API](../contracts/composition-runtime.d.ts)、[组件用法](../packages/composition-runtime/MOTION_API.md) | 在 `draw` 中按绝对时间计算数值；不引入 DOM、系统时间、计时器或 GSAP |
| 绘图与文字 | [媒体命令 Schema](../contracts/admission-media-commands.schema.json) | 有界变换、路径/描边、渐变、裁剪、图片裁切和材质；选定字体的实际度量、显式换行/自动折行与目标安全区一起检查 |
| 字体 | [可信字体目录](../apps/renderer/src/admission-font-catalog.mjs) | 27 个 family 的 42 个 WOFF，含 25 个 Latin/display family 与两类中文字体；只把所选字体度量送入 VM，不依赖系统字体 |
| 配乐、音效与真实采样 | [可信声音实现](../apps/renderer/src/creative-audio/index.mjs) | 候选输出 `generatedAudio` 和事件；可信端合成 48 kHz 双声道，混音后冻结，再检查响度、真峰值和 AAC |
| 动作诊断 | [诊断实现](../apps/renderer/src/creative-diagnostics.mjs) | 出片后自动分析实际 MP4，报告单帧突变、硬切、静止段和逐秒运动曲线；都是人工复查提示，不自动否定有意停顿或切镜 |
| 配色比较 | `creative:tools palette` | 输入明确的颜色集合，输出可视色板和雷同提示；不从自由文字猜背景/前景角色 |
| 改稿图片 | [改稿捕获](../apps/renderer/src/edit-evidence.mjs) | 从已保存 MP4 的评论帧抽整图和点位 2× 细节图；绑定实际版本/目标/帧/媒体摘要后作为模型图片输入 |
| 并行捕获 | `render:admission --capture-workers 2` | 最多两帧在途，独立浏览器上下文、按帧序编码；默认仍为单路，命令检查与冷启像素检查不减少 |
| 偏好与经验 | [本地导演](../apps/agent-runner/README.md) | 显式启用、限定作用域、可查看/修改/删除/关闭；区分偏好、观察和有证据验证的经验 |
| 拍点、旁白与字幕辅助 | `creative:audio` | 对可信 PCM 找拍点/能量；分段、停顿、对齐和 SRT，标明插值时间，不自动下载或调用语音模型 |

### 比较明确的色板

将以下数据保存为 `palettes.json`：

```json
[
  {"id":"editorial","colors":["#F4F0E8","#162626","#C74A36"]},
  {"id":"technical","colors":["#101828","#E7EDF4","#68E0C2"]}
]
```

```sh
mise run creative:tools -- palette --input palettes.json --output-directory artifacts/palette-review
```

输出目录须为空。打开 `swatches.svg` 对看颜色，`diagnostics.json` 保留明确的重复色、暖色点缀雷同等提示。色板工具不声明文本对比度合格。

### 选择并行捕获

```sh
mise run build:admission
mise run render:admission -- --source SOURCE_DIRECTORY --capture-workers 2 --output-directory artifacts/parallel-render
```

两个捕获上下文共享原有容器资源上限，不创建无上限页面或按帧启动 Worker。报告记录实际并行度；是否更快以同输入实测为准，不把并行数当成速度保证。

### 给自由 ABC 乐谱提供独立权利记录

候选源码包不能自签音源授权。自由 ABC 需要操作者提供[音源权利记录](../contracts/admission-audio-rights.schema.json)，精确绑定该音源请求摘要、片长、用途、审核者和证据：

```sh
mise run render:admission -- --source SOURCE_DIRECTORY --audio-rights reviewed-audio-rights.json
```

预登记的原创工程乐谱、程序配乐/音效和固定 CC0 采样保留各自来源记录；算法采用 MIT 不等于合成录音或任意旋律被宣告为 CC0。实际音源权利记录进入 QA 身份。更换乐谱、seed、时长或请求内容后，旧审批不能复用。

运行 `mise run creative:audio -- --catalog` 查看已登记的乐谱、音色、风格和音效。`--generate`、`--analyze`、`--captions` 只接受受限数据；处理授权音频与生成字幕都在固定容器内进行，完整字段见[声音工具说明](../apps/renderer/src/creative-audio/README.md)。

## 保留许可，排除不适用依赖

移植固定到 huashu-motion `5f2608c2e12abcf518f74dde86093b19f7f88603`。各模块保留上游 MIT；clip/art-motion 的独立来源、字体 OFL 和采样 CC0 分开记录，不能用仓库总许可替代素材许可。

没有移植作者卡通形象、CC-BY 钢琴/电钢琴、未经核权利媒体、macOS 字体依赖、任意网页/本地服务执行路线、3D/WebGL 或旧子帧运动模糊。GSAP 保持独立加载研究，不作为本批能力的依赖。旁白辅助不自动安装 Kokoro/Whisper 或调用系统语音。

本批验证是本地技术准入。真实付费模型比较、负责人正常速度视听、独立目标用户盲审及 Cloudflare 目标环境仍按 [M0a/M0b](prd/08-codex-execution.md) 完成。
