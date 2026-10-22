# 写乐谱，冻结音轨

创作源码只提交有界 JSON、ABC 乐谱和事件。可信媒体容器负责乐谱演奏、音色、音效和混音；QuickJS 不加载合成器，不在 `draw()` 里播放声音。

## 先生成一支可听的 15 秒音轨

先按项目说明构建固定的 admission 镜像，然后在仓库根目录运行：

```sh
mise run creative:audio --catalog
mise run creative:audio --generate apps/renderer/src/creative-audio/examples/generate.json --output artifacts/audio-launch
```

输出目录必须为空。`mixed.wav` 是恰好 720,000 个采样帧的 48 kHz 双声道 PCM16 音轨；`report.json` 保存真实响度、真峰值、完整事件、音源摘要和权利链；`execution.json` 保存实际容器限制。30 秒使用 `totalFrames:900`。固定镜像不匹配、超时、取消或未取得完成回执都会失败，不切换宿主合成。

## 接入现有创作资源请求

在 `resources.json` 添加可选 `generatedAudio`，并用已有 `audioEvents.sourceId` 引用其 ID：

```json
{
  "schemaVersion":"2.7.0",
  "kind":"admission_resources",
  "resourceIds":["launch-score"],
  "generatedAudio":[{
    "id":"launch-score","kind":"abc_score","algorithmVersion":"huashu-audio-v1",
    "seed":12,"scoreId":"launch","marks":[]
  }],
  "audioEvents":[{
    "eventId":"music","kind":"music","sourceId":"launch-score",
    "frameStart":0,"frameEndExclusive":450,"sourceOffsetFrames":0,
    "gainDb":0,"fadeInFrames":3,"fadeOutFrames":15
  }]
}
```

运行 `render:admission` 即会合成并冻结同一条音轨，预览与导出继续使用同一 WAV。既有 `original-score`、`original-cue` 和静音请求不增加前置条件。

三种生成源均固定整片长度：

- **`abc_score`**：`scoreId:launch|lesson` 使用原创工程乐谱；或提供 `abc` 自由乐谱，二选一。`marks:[{name,frameIndex}]` 将 `!mark:name!` 对齐画面，报告会显示实际 tempo stretch。
- **`procedural_score`**：显式 `style`、`bpm`、`root`、`sections:[{id,frameIndex,energy}]` 和 `ending:ring|button|stop`。13 种基础曲式及 6 个变体覆盖 pulse、lofi、funk、trap、chiptune、ambient、piano、cinematic、pizzicato、acoustic、guofeng、synthwave、mallet。
- **`sfx`**：显式 `effect`、`kit`、`durationFrames`、`pitch`。23 种效果、5 种音色包从 `--catalog` 获取。音源从第 0 帧开始；`hitOffsetFrames` 表示设计中的落点偏移，不是测得的波形峰值。例如 riser 提前其持续帧数开始，结束时落到视觉标记。

程序曲式还可显式设 `channelEffects:true`，启用固定的分声部 EQ、chorus、delay、saturation 和房间混响链；默认保留较简洁的合成混音。

完整结构见[资源 Schema](../../../../contracts/admission-resources.schema.json)。生成 ID 不得覆盖现有目录，每个生成源必须被实际事件引用。音乐不能伪装成 `sfx`。Ducking 使用 `duckingAutomation()` 编译为既有 `gainAutomation` 整数帧、linear-dB 关键帧；不在冻结后暗改音量。

## 自由乐谱先核权利，再处理

自由 `abc` 必须另传可信的 `--audio-rights rights.json`。它不在候选源码包内，模型不能替用户审批。审批绑定完整生成请求、seed、marks 和片长，任何一项变化都会失效。

```js
import {generatedAudioRequestHash} from './apps/renderer/src/creative-audio/index.mjs';

// source 是已经人工核对过的那个 generatedAudio 条目。
const approval = {
  sourceId: source.id,
  requestHash: generatedAudioRequestHash(source, 450),
  basis: 'original_composition_reviewed',
  evidenceRef: 'project-score-review-1',
  reviewer: '实际审核人',
  allowedUses: ['process', 'mix', 'preview', 'export']
};
// 保存为 {schemaVersion:'2.7.0', kind:'admission_audio_rights', approvals:[approval]}。
```

有许可的已有作品使用 `licensed_composition_reviewed` 并保留真实授权依据。换名、换 seed 或写“原创”不能替代核验。新增生成音轨登记为 `LicenseRef-PromoBento-Generated-Audio`，分别保存乐谱依据、MIT 算法与 CC0 采样；不会把 MIT 代码的许可偷换成音乐的 CC0 声明。现有独立的事实和内容审核仍适用。

## ABC 的表达力和限额

支持多声部、调号和拍号、变速、升降号、八度、时值、休止、和弦、连音、三连音、一次反复、力度/渐强渐弱、踏板、延长、呼吸、ritardando，以及 `mark`、`hit`、`rise`、`filter`、`stop`、`stutter`。声部可写 `inst=piano role=melody gain=0.8 transpose=0`。不读取 HTML，也不接 MIDI 文件或任意 JS 回调。

限额为每片 8 个生成源、每份 ABC 16,384 字符、16 声部、1,024 音符、256 个四分音符长度，tempo 为 40–240 QPM；单源演奏总音符秒数含尾音不超过 180 秒。谱面内的 tempo 不会绕开演奏时长和任务资源上限。未知乐器、越界音高、无匹配的场景标记、重复 ID、无穷时值和异常反复均拒绝。

合成 piano、rhodes、弦乐、管乐、吉他等始终使用固定算法。真实采样必须显式选择 `vsco_violin`、`vsco_flute`、`vsco_horn`、`vsco_harp`、`vsco_marimba`、`vsco_snare`，音域见 catalog。这是 6 个固定原始 WAV 的轻量集合，每个有音高的样本允许上下一个八度；越界拒绝，不替换成合成音、不读取机器缓存。保持原始立体声，运行时使用固定 PCM 解码和插值。

上游三份较长的 ABC 示例保留在 [examples](examples/)：`first-light.abc`、`four-rooms.abc`、`signal.abc`。它们展示编曲技法；用于 15/30 秒目标时需选择声部、重排长度和对齐标记，再走上述具体乐谱审批。

## 给已获许可的音轨找拍点

```sh
mise run creative:audio --analyze approved-48k-stereo.wav --rights file-rights.json --output artifacts/audio-analysis
```

输入只接受最多 30 秒的规范 48 kHz 双声道 PCM16 WAV。`file-rights.json` 按[文件权利 Schema](../../../../contracts/admission-audio-file-rights.schema.json)提供实际字节 `sourceHash`、许可依据、审核人和 `process/analyze` 用途，首次解码前核对。

结果有 BPM、拍点、强拍、段落、能量、drop 候选和 **confidence**。`pulseReliable:false` 时不得把推测拍点当成精准切镜依据；强拍明确假设 4/4。`activeAudio` 是能量阈值测得的活跃区间，不是语音识别或词边界。

## 从已确认的稿件生成字幕

```sh
mise run creative:audio --captions apps/renderer/src/creative-audio/examples/captions.json --output artifacts/captions
```

输入包含 `scriptConfirmed:true`、原稿、实际片长和已确认的 `speechSpans`；可附人工/上游可信分析提供的字符时点 `characterAnchors`。输出 `captions.srt` 及完整报告，保留原文标点。报告区分已观察锚点与插值字符，所有词时点仍标为 `interpolated`，需人工复核。不会下载 ASR/TTS 模型、调用系统配音或自动引入口播音轨。

## 来源和验收

来源、修改范围、上游版权与明确排除项见 [NOTICE](NOTICE.md)，采样逐文件来源和证据见 [catalog.json](assets/catalog.json)。`mise run test` 覆盖有界解析、全部曲式/音效、样本身份、确定性、权利绑定、DSP 数值、拍点及字幕；`mise run test:creative-audio` 验证实际隔离工具，创意媒体验收另将工程采样谱与画面渲染到 MP4。正常速度试听、音乐表达与客户成片内容由负责人验收。
