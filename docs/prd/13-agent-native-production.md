# PromoBento v2.2 — Agent-Native Video Production Specification

> **版本**：v2.2（2026-10-20）  
> **状态**：可供 Codex 实施的升级规格，**不是已实现、已部署或已验收声明**  
> **并入仓库**：现有 `docs/prd/README.md`（v1.4 业务/网站契约）及本章 01–12；早期 v1.1/v2.1 仅为变更背景，不覆盖最新认证、语言、路由决定  
> **上游核对基准**：`alchaincyf/huashu-motion` 主分支提交 [`5f2608c`](https://github.com/alchaincyf/huashu-motion/commit/5f2608c2e12abcf518f74dde86093b19f7f88603)（提交时间 2026-10-19）；仓库中 Skill 声明版本 `0.1.1`。**后续采用上游代码时必须重新核对版本、许可和行为，不静默跟随 main 更新。**

> **权威边界**：本章负责创作、声音、视频 QA 与 Agent Studio；03 负责平台/时长、05 负责已购权益、10 负责网站国际化和用户文案自由混排、11 负责 UI、12 负责 URI/认证。新增 Agent API 必须同步登记到 `config/routes.json` 与 12 章后才能上线；本文 API 是规划，不是已开放路由。

## 0. 最终决策：先把片子拍好，再把工作流做成可靠的 SaaS

**PromoBento 的视频创作底座对齐 huashu-motion 的成熟能力：Director → 动画 Coding Agent → 作曲与音效 → 真实抽帧/验片 → 画面点选改稿 → 经验沉淀。** 现有 React/Cloudflare/Waffo/账号/协作/计费/导出基础设施继续保留。固定模板不作为动画能力上限。

### 0.1 四条不可变的产品要求

1. **时长固定**：创建项目时选择 `15 | 30` 秒，默认 **30 秒**；P0 固定 **30 fps**，分别是 **450 / 900** 帧。Agent 可自由安排任意合理数量镜头、切换、叠层和场景时长，不能越过总片长。
2. **画幅固定为既有平台预设**：TikTok、Instagram Feed、Instagram Reels、X、YouTube、YouTube Shorts；Instagram Feed 可以使用预设提供的方形选项。P0 输出比例只来自现有配置中的 `9:16 / 4:5 / 1:1 / 16:9`；宽高、码率、安全区、编码等以版本化的平台预设为准，**不开放任意画幅/分辨率/帧率**。允许 Agent 为不同已选预设**重排和重做镜头**，不只是裁切。
3. **创作自由**：不限制为 3 种叙事、4/6 场景、6 个 scene enum、Clean/Bold 风格或固定动效枚举。Agent 可以编写独立的 HTML/CSS/TS/JS、SVG/Canvas/WebGL/Three.js/Shader、镜头路径、特效和自定义算法。运动语言库是导演启发，不是许可清单。
4. **事实与权限严谨**：使用真实素材和用户确认的产品事实，不编造报价、功能、结果与见证；源代码只在隔离执行环境运行，不把支付/模型/数据库密钥暴露给沙箱，不跨工作区分享私有素材、经验或生成结果。

### 0.2 继续保留的商业与站点决定

| 类别 | v2.2 的决定 |
| --- | --- |
| 品牌与域名 | PromoBento / `promobento.com`；域名是否已购买需在部署时核验 |
| 首发用户 | 软件团队 + 课程/数字产品团队，保留原两条获客路径；引擎能力不限定题材 |
| 网站与语言 | React/TypeScript，网站英语首发及 i18n 扩展、System/Light/Dark 网站主题；用户视频文案可任意语言混排，不选择视频语言；网站主题不改变作品风格 |
| 登录 | **已确定 Google + 邮箱验证码**，显式关联身份、后端会话和工作区权限，细则见 [12](12-routing-and-auth.md) |
| 基础设施 | Cloudflare Workers、D1、R2、Queues、DO、Containers；mise 锁依赖版本 |
| 交易 | Waffo；原 `$39/3` 版本与 `$12/3` 追加为 **尚待复核的试运营价格**，不能未经批准自动更改销售条款 |
| 导出 | 已购成片版本的多个**平台预设** MP4、封面 JPG、映射清单与 ZIP；按指纹复用重合的输出，不按平台重复扣版本权益 |
| 后台与审计 | 订单、退款、创作任务、模型开销、输出任务、资产保留与删除、安全日志，继承 v1.1 边界 |

### 0.3 设计原则与优先级

- **先导演方法与声音，再丰富前端控件**。避免上线“能渲染但像 PPT”的产品。
- **复用上游经过核对的思想与允许移植的代码，不直接搬整套本地 CLI 到云端**。
- **一主 Agent + 工具调用优先**。不强制每条片创建五个独立 Agent 会话；专业角色作为提示词、阶段与可选子流程存在。
- **真实作品是验收基准**。编译成功、JSON 有效、静态截图漂亮，都不能代替完整视频正常速度观看、听音和局部改稿。
- **产品规格约束 ≠ 艺术约束**。只有总帧数、平台预设、安全、版权、真实性、授权和预算是硬约束。

---

## 1. v2.1 → v2.2 实质变化

| 优先级 | v2.1 的不足 | v2.2 具体补齐 | 成果文件/验证 |
| --- | --- | --- | --- |
| P0 | “Director Agent”只有职位定义 | 产品理解、表达目标、品牌性格、创意三方向、节奏图、关键帧与镜头连续性 | `creative-brief.json`、`directions/`、`treatment.md`、真实 4 帧 |
| P0 | “自由代码”缺质量方法 | 借鉴 huashu-motion 20 种运动语言、分层电影语法、最难镜头先做与反模板检查 | `director` prompt/参考规则 + 3 种不同作品 |
| P0 | Audio Agent 只有抽象职责 | ABC 乐谱/合成器、授权采样可选、SFX 事件、节拍点、ducking、完整音轨预听和混音 | `score.abc`、`audio-cues.json`、`mix.wav`、音频 QA |
| P0 | QA 只写“检查画面” | 移植 `om check` 思路（源码 + 页面）；移植 `om qa` 思路（单帧闪烁/静止/硬切/运动曲线），加音画与版权校验 | `source-check.json`、`frame-check.json`、`qa-report.json` |
| P0 | 点选修改协议尚粗 | 时间 + 比例 + 相对坐标 + 元素/源码候选 + 局部截图 + scoped patch + 回归比对 + 用户确认 | `edit-request`/`patch`/`revision` 契约；Canvas/WebGL 兜底 |
| P0 | 片尾“检查”没有视觉闭环 | 先做难镜头、渲染首/峰/密/尾四帧、过片、发现问题自动修一次（预算受控） | 每次 revision 的真实浏览器输出与原因记录 |
| P1 | “学习偏好”没有数据治理 | 用户主动偏好 / 单片观察 / 验证经验 / 已废弃规则分层，含证据和反证 | 工作区级 `creative_memory`、收集/检索/撤销/删除 |
| P1 | 没有迁移成本清单 | 上游代码、文档、声音采样、字体、GSAP、品牌形象逐项许可与移植边界 | `UPSTREAM_ADOPTION.md`、license inventory |
| P1 | 输出只有视频文件 | 可选导出用户自身 Composition 工程及资产授权清单 | 源工程 ZIP，**不是**新的视频画幅/格式 |
| P0 | 易过度设计多 Agent | 主 Agent 状态机 + 工具驱动 + 预算策略，按需引入子 Agent | `agent-run` 事件表、trace、真实调用评测 |

> P0/P1 是工程优先级；不能把所有 P0 特性都说成已完成。任何真实生产支持依赖相应的通过证据。

---

## 2. huashu-motion 已核对模块与复用策略

### 2.1 用于分析/迁移的固定上游文件

**以下是 2026-10-19 基准下核对的具体路径，不表示文件已被移植。** 点击链接查看源文件：

| 来源路径 | 已有行为（按上游源码/文档） | PromoBento 处理方式 | 注意事项 |
| --- | --- | --- | --- |
| [`skills/huashu-motion/SKILL.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/SKILL.md) | 本地 Agent 拍片工作流与编辑闭环 | **借鉴并云端改写** | 本地命令和长轮询不能照搬 |
| [`references/director.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/director.md) | 三方向、产品性格、节奏单、四张真正渲染的关键帧、难镜头优先 | **优先移植方法与可许可文案** | 方法建议可被明确用户指令覆盖；不能每片都一个审美 |
| [`references/rhythm.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/rhythm.md) | Continuous/Montage/Hybrid；能量曲线、节拍、停顿、镜头运动对比 | **导演与 QA 共用** | 经验性启发，不是硬性“3 秒必须切镜” |
| [`references/library/`](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/library) | 20 种运动语言、产品适配、技法等 | **引入参考检索库** | 不成为场景种类白名单 |
| [`references/colour.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/colour.md) | 来源于真实品牌的色彩与排版判断 | **借鉴色彩选择/对比预检** | 不复制作品截图或第三方品牌素材 |
| [`references/product-demo-continuity.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/product-demo-continuity.md) | UI 连续运镜、焦点交接、读字停留、真实操作逻辑 | **软件演示专项指南** | 不固定为某支参考片的构图或秒数 |
| [`cli/lib/check.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/check.js) | 源码缺失/随机性/布局检查；浏览器抽帧、遮挡、对比度、跳帧一致性 | **移植可复用的检查思想/算法** | 自由 TS/构建工程应改用 AST + 运行检测，不能仅正则扫描 HTML |
| [`cli/lib/qa.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/qa.js) | FFmpeg 解码低分辨率逐帧，单帧闪烁、静止、硬切、运动变化 | **改写为无状态 QA Worker** | 上游阈值是起点，不是所有风格通用的强制失败线 |
| [`cli/lib/score.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/score.js) + [`cli/lib/sound.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/sound.js) | 谱/声音合成、音效、响度、ducking、混音 | **挑纯函数加适配层** | 采样/许可分开审核；避免将本地路径写入云文件 |
| [`references/sound.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/sound.md) + [`scores/`](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/scores) | ABC 作曲、拍点标记、场景同步、示范谱 | **形成配乐编排规范** | 不能将示范谱直接当无限免版权商业素材 |
| [`studio/studio.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/studio/studio.js) + [`cli/lib/inbox.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/inbox.js) | DOM 命中/选择/画面评论、源码关联、Agent inbox 与反馈 | **抽取交互协议，重做多租户 Web UI** | 不复用本地文件 JSONL 作为云数据库 |
| [`cli/lib/learn.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/learn.js) | recall/harvest/add、证据与历史经验 | **数据模型与流程借鉴** | 禁止跨租户自动混合，用户偏好需可控 |
| [`runtime/om-engine.js`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/runtime/om-engine.js) | 以时间控制渲染与播放器的工程实现 | **先 PoC 兼容层** | 独立评估 GSAP 等外部依赖的许可/版本 |
| [`THIRD_PARTY.md`](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md) | GSAP、字体、素材、作者形象许可差异 | **建立源代码级 license 清单** | MIT 不自动覆盖所有随附内容 |

### 2.2 实施时的三种处理标签

- `PORT`：审查后可以直接复制的 MIT 自有逻辑（比如不依赖专有许可的纯函数与部分 CLI 算法），保留版权/NOTICE 与 commit SHA；通过差异测试。
- `ADAPT`：上游思路适合但需重写运行方式（Studio 点选/本地 JSONL、浏览器/CDP、本地音频路径、项目文件管理、Agent Skill I/O）。
- `REBUILD`：多租户、Waffo 账务、云任务、限额、安全代理、云端预览、固定平台导出预设、工作区经验隔离。

**不得**将完整上游仓库、演示片、作者角色、字体目录或采样目录作为不经筛选的 `vendor/` 打包。所有 PORT 都需记录上游 URL/commit/许可/修改/测试。

---

## 3. 真实导演流程（P0，优先于扩大模板库）

### 3.1 Understand：事实、意图和品牌先于动效

输入可以是自然语言、截图、录屏、Logo、产品主页、课程资料、CSV 等。**并不意味着各类型在上线时已全部验证**；P0 素材矩阵必须先标注 `supported / gated / experimental`。如支持网址读取，只能由受控抓取服务代理，经重定向、SSRF、版权、大小、时长与登录内容边界审核；沙箱不得直接联网抓站。

形成 `creative-brief.json`：`objective`、`audience`、`primary_message`、`proven_facts[]`、`assets[]`、`brand_signals`、`spoken_mode`、`user_constraints`、`duration=15|30`、`platformPresetIds[]`、`optionalTextMetadata`（视频文案语言可自由混排，不设选择门槛）、`evidenceRefs[]`。没有证据的宣称写 `unknown`，不能自动加入视频。

导演先回答：视频要让观众记住什么、产品的真实特征是什么、适合用什么视觉材料与表达方式。为品牌保留色彩和真实交互，不把每支片默认做成同一款深色背景/巨大字体/荧光点。

### 3.2 三方向不是硬性问卷

用户目标不明确时提供 **Fit / Amplify / Unexpected** 三个不同方向，必须在**镜头材料与运动语法**上不同，而非仅改配色。每个方向包含：一句 logline、情绪/画面语言、镜头/节奏路径、配乐调性、素材依赖、可能失败点、**同一渲染器生成的真实关键帧**。用户可选方向、混合方向，或直接让 Agent 按推荐方向制作。

用户给出确定镜头要求或选择“直接生成”时，不强制等待方向审批；后台仍保存简化 Treatment，便于后续修改。

### 3.3 Treatment 和节奏单（15/30 秒内自由编排）

`creative-treatment` 至少包含：

- **视觉叙事**：单次连续运镜/蒙太奇/混合，或自创结构；场景、事件数量不设固定枚举。
- **节奏设计**：全片 0–10 能量曲线、拍点、重要变奏、阅读停留、高潮和最后落点；BPM 是建议值，可由语言/语音/素材重定。
- **镜头表**：每行 `frameStart | frameEnd | shotPurpose | visualAction | camera | readHold | audioCue | carryOverObject`，镜头支持叠层与并行，必须落在 0..449 或 0..899 帧范围。
- **连续性链**：上一镜焦点如何交接到下一镜；对于产品 Demo，把内容/操作、设备外框、镜头包装层、字幕层分开设计。
- **四张关键帧**：开场/主角展示/信息最密/片尾，必须从最终或可执行临时工程用浏览器渲染 PNG，不允许用提示词描述或静态占位替代。

经验规则（例如首 3 秒建立钩子、一次节奏反差、片尾品牌落点）用于导演评审，**不是必须满足的死板节奏公式**；用户需要安静字幕、极简长镜头等风格时可以明确覆盖。

### 3.4 最难镜头先行 + 风格统一

开工先证明一段技术风险最高的镜头，例如 3D 环绕穿屏、真实 UI 变形、复杂数据图表或跨场景连续衔接。使用最终字体、品牌素材与目标平台预设的实际分辨率检查；难镜头不过关不应先批量铺满镜头。

系统给 Agent 一份可检索的 **20 种运动语言参考库**（选择、混搭、拒绝均可），加技术工具库、品牌适配和常见失败案例。允许自定义新语言、Shader、物理曲线、图形语法，不能因为“不在库内”拒绝实现。

---

## 4. Composition 运行与代码契约

### 4.1 可执行源码优先，元数据只定义交付协议

```
composition/
  src/                     # 自由代码，目录结构由 Agent 决定
  index.html
  package-lock-or-vendor/  # 受信任锁定依赖，不在执行时在线 npm install
  assets/                  # 经授权、冻结版本的素材引用或只读映射
  composition.json         # 版本/时长/fps/预设/资源 hash 等工程协议
  editables.json           # 可选常见参数；允许 0 个
  markers.json             # 可选镜头/节拍/音频标记
  treatment.md
  audio/score.abc
  audio/cues.json
  audio/mix.wav
  tests/
```

`composition.json` **不得用固定 6 类场景 enum 约束画面**；所有源码、依赖、预处理结果、字体、音乐源和许可证据均在不可变 revision 中用 hash 标识。公开导出源工程（后续功能）必须具备剔除密钥、租户隐私及未授权素材的许可检查。

### 4.2 最小桥接接口（TypeScript 提案）

```ts
type DurationSeconds = 15 | 30;
type Aspect = "9:16" | "4:5" | "1:1" | "16:9"; // 输出仍须通过预设 ID 校验

interface RenderRequest {
  revisionId: string;
  frameIndex: number;       // [0, 449] or [0, 899]
  presetId: string;         // validated server-side
  presetVersion: string;
  seed: string;
}
interface CompositionBridge {
  init(input: { assets: Readonly<Record<string, string>>; seed: string }): Promise<void>;
  seekFrame(frameIndex: number): Promise<void>;
  whenFrameReady(): Promise<void>;  // image/video/font/3D/text rasterization barriers
  inspect?(at: { frameIndex: number; x01: number; y01: number }): Promise<HitTarget | null>;
  getEditables?(): EditableProperty[];
  getMarkers?(): Array<{ id: string; frame: number; name: string }>;
}
```

- Source 可以使用浏览器能支持的绘图技术，也允许 Agent 新增自定义数学、运镜算法。使用经过审核且锁定的依赖；不是“列出的动画 API 才能使用”。
- `seekFrame(n)` 必须由 `n / 30` 对应的**绝对时间**决定目标帧；不可依赖 `Date.now()`、自由运行的 `requestAnimationFrame`、未设种子的随机、上一次 seek 或 UI 播放历史。需要物理仿真时用可复现固定步长/预烘焙轨迹。
- 独立视频源需要按时间 seek/解码并等待 ready；字体载入、图像解码、Shader 编译等也必须有超时与失败状态。不得截图尚未准备好的帧。
- 对实际 GPU/浏览器版本差异允许经标定的像素容差，但同一不可变镜像 + 资源快照必须可追溯、可回放、可定位差异。
- 时间范围是 0..449/899（索引从 0 开始），最后一帧时间是 `(frameCount-1)/fps`；MP4 容器时长是完整的 15/30 秒。**不要把末帧时间与文件总时长混为一谈**。

### 4.3 平台 Variants

同一内容 revision 可为已选平台预设保留多个 `composition_variant`（源代码入口或配置分支），重排标题、镜头、焦点、读字、UI 包装位置。平台选择由服务器解析 `presetId + presetVersion → width,height,codec,safeZone`，前端、Agent 和源代码均无权自报输出宽高。

- 需要重新排镜可重新生成目标 Variant；视觉/信息身份保持一致，必要时不同平台允许不同镜头衔接，但**总时长相同**。
- 相同版本追加既有或新选中的预设只产生派生文件，不变更买断内容 revision，也不重复扣相同版本权益。
- `artifact_fingerprint` 结合源代码 hash、资源/字体 hash、音频 hash、variant、renderer 镜像 digest、预设版本、编码参数。
- 平台预设只有明确批准与实际上传验收后才能修改。新增任意比例/时长不属于 v2.2。

---

## 5. 声音必须成为视频工程的一部分（P0）

### 5.1 三种音轨来源 + 显式静音

1. **Composer（主要展示路径）**：Agent 根据 Treatment 编写 ABC 乐谱（参考上游 `sound.md` 和 `score.js`），使用可复现合成器生成乐曲，优先匹配重要镜头标记。
2. **Music Direction（快速路径）**：从授权且可复用的音乐方向、程序化生成器中选一种，并根据视频节奏生成；不是固定片段拼贴的上限。
3. **User Audio**：客户上传配乐、真人录音或授权旁白，可由配音服务补充，但必须提供声源/授权记录。
4. 用户明确选择静音时不加背景音乐；软件静音自动播放场景仍要做到“关声音看得懂”。若设备/环境缺少音色采样，则降级为授权可用的合成音色，而不是硬阻断。

### 5.2 音频-视觉的统一主时钟

```
Master timeline: integer video frames @30fps, duration 450/900 frames
 ├─ visual frame 0..N-1
 ├─ score / beat and musical marks (rational time)
 ├─ SFX cues -> integer frame -> samples at 48 kHz
 ├─ voice track + optional word timestamps
 └─ caption events + fades -> frame-based timeline
```

`cue.frameIndex` 是唯一提交口径，音频采样偏移 = `round(frameIndex * 48000 / 30)`；所有命中点、转场、配音与字幕导出使用同一冻结事件表。源谱 BPM/拍号、乐句时间可连续，落地时需映射到整数帧并记录舍入误差。

`audio/cues.json` 最少包括 `trackId,kind,sourceHash,frameStart,frameEnd?,gain,pan?,fade,licenseRef`；重要节拍 `beatMap`、场景音符 `marks`、录音 `voiceWords`（不存在时为空）分别存储。场景时序变更必须触发音轨重新计算或明确提示，不允许旧音乐静默错拍。

### 5.3 具体实现选择

- 优先评估移植上游 **ABC 解析/乐器合成/DSP/音效调度**的纯函数，不把其随附示范音色一键商业打包。
- 真乐器采样：每个采样包建立 `license_id`、来源、校验和、商业可用范围、是否要求署名、能否公开下载；缺失或条款不满足时走合成器兜底。
- 上游 `23` 种音效是初始参考库，可进一步增减或让 Agent 程序化制作新音效；数量不是产品承诺或白名单。
- 可选口播遵循 `none / user recording / licensed TTS`。**首发生成视频文案仍是英语**；接入新语种/配音需和字体/字幕独立验收。TTS 或 ASR 是否在首发开放取决于真实集成与许可，不得提前在价格页承诺未打通能力。
- 实际 FFmpeg 混音必须统一采用冻结音频事件与参数，支持 BGM ducking、淡入淡出、响度与 true-peak 检查。先沿用 PromoBento v1.1 的 **约 −16 LUFS / ≤ −1 dBTP 内部目标**，其他平台目标需独立测试后版本化调整，不机械套用上游 −14 LUFS。
- **音效/配乐和视频的最终作品必须同步预览和审核**。频谱/响度检测能自动发现部分问题，但不能证明音乐“好听”；试运营以人工听音样本与用户反馈补足。

### 5.4 必须覆盖的声音验收

- [ ] Composer 的重要 `mark` 和镜头命中点一致，误差不超过一视频帧；对齐不合格有清晰报告。
- [ ] 45 秒长的上传旁白不能被静默塞进 30 秒视频；明确拒绝或征得用户同意后缩稿/剪辑。
- [ ] 15 秒、30 秒各有无旁白、有配乐+SFX、静音成片样本；均符合时长和音频轨道声明。
- [ ] 单独修改未触及音乐的文字/颜色，音轨 hash 保持不变；改镜头时间并影响节拍，相关音轨变更且重新 QA。
- [ ] 音量自动混音与字幕显示无黑尾、静音空洞、超界、明显削波或音视频结尾偏移。

---

## 6. `check` / `qa` 变成可执行质量门禁

### 6.1 四层检查

| 层 | 触发 | 具体检查 | 失败处理 |
| --- | --- | --- | --- |
| Q0 静态源码 | Agent 写入/修改后 | TS/HTML 语法、资源路径、依赖锁、危险调用、时间依赖、重复 ID、授权来源 | 编译/安全错误阻止执行；建议项允许修正 |
| Q1 浏览器真实抽帧 | 难镜头与初版预览 | 首/峰/密/尾 + 场景边界抽帧；页面错误、溢出、遮挡、文本对比、字体缺失、构图越安全区、错误素材 | 自动定位时间+对象+源码，提交修复草案 |
| Q2 已编码视频 QA | 完整临时/正式成片 | `ffprobe` 的宽高/帧率/帧数/音轨/时长；逐帧 pop、无意静止、硬切、运动对比、色彩/黑尾；声画同步 | 编码规格错误阻止交付；风格提示由 Agent/用户审阅 |
| Q3 美学/事实验收 | 交付前、试运营抽样 | 画面是否有产品特征、故事是否清楚、音乐是否合适、品牌是否准确、事实证据、用户修改是否落实 | 可请用户选择“继续修改/确认导出”；运营抽样记录审片原因 |

### 6.2 从上游移植的最小诊断逻辑

参考 `cli/lib/check.js` 的静态检测、布局/对比度与“从中途跳转 vs 顺序播放”复现性比较；参考 `cli/lib/qa.js` 的低分辨率视频分析：

- **单帧 pop**：某帧与左右相邻帧都差很多，但两邻帧彼此相似；输出精确帧号、前后截图和风险分数。
- **静止段**：连续多帧差异极小，结合 Treatment 标识计划内的阅读停留/静音/片尾。不是发现静止就判坏。
- **硬切**：相邻帧差异显著且非单帧 pop；若在导演镜头表中存在且节拍正确，不报错误。
- **运动曲线**：按每秒帧差绘制变化/节奏；平坦只是可能单调的警示，并非所有慢片违规。
- **历史依赖**：目标 `frameIndex` 从 fresh 浏览器直接 seek 与从头播放后 seek 两张帧图对比；同一工况存在超容差差异时阻止冻结或标记必须修复。

上游当前 `qa.js` 基于 `96×54` 灰度帧与固定阈值做异常启发式判断，**这些阈值不能无测试地作为商业 P0 强制失败门槛**；建立全静音/高动效/纯色遮罩/阅读停留/图表高密四类夹具，评估误报漏报再锁定阈值。正式规则分为 `BLOCK`, `REVIEW`, `INFO`，人工或用户豁免必须有范围、原因、授权和截止条件。

### 6.3 不能省略的正常速度 QA

至少检查 15 秒/30 秒成片在主输出构图上的正常速度播放（抽样由人工审片或经验证的视频审阅流程完成）；音乐、语音听感不得凭静态图宣称通过。正式自动化先保障机械正确性，把美学判断视为待验证的经验性指标。

---

## 7. Studio：点中哪里，就改哪里（P0）

### 7.1 统一的 EditRequest

```ts
interface EditRequest {
  projectId: string;
  revisionId: string;        // immutable base revision
  targetPresetId: string;    // validated, not free-form aspect size
  frameIndex: number;        // integer
  normalizedPoint?: { x: number; y: number }; // 0..1, in output canvas coordinates
  selectedElementId?: string;
  hitRegionId?: string;
  screenshotAssetId: string; // server-scoped, access-controlled
  comment: string;
  editScope: "selected" | "shot" | "variant" | "all-variants";
}
```

1. 浏览器播放器在点击时冻结准确 `frameIndex`，携带 `revisionId`、预设、坐标、当前画面截图和可选 DOM/Canvas/WebGL 命中信息。
2. 先尝试 `data-pb-id`、可编辑对象映射、source map/AST 与 hit region；WebGL 优先 raycast。**没有可解析对象也必须允许截图区域+时间定位的 AI 反馈**。由于预览处于隔离的跨域 iframe，主站**不得**直接读取其 DOM；命中检测由预览内的受限 Bridge 执行，仅通过校验 origin、会话 nonce 和消息 schema 的 `postMessage` / 可信 API 传回最小化结构化信息。
3. 可信 Orchestrator 建立编辑任务，隔离 Agent 读取该项目已授权代码和评论，不让用户评论成为高权限指令。
4. Agent 返回改稿意图、代码 diff、预计影响的镜头/预设/音频、预算与原因，**不能直接覆盖当前已发布 revision**。
5. 在候选 revision 编译、渲染局部首尾及邻近帧，回归比较未受影响区域；明确涉及全局风格时无需假装所有场景完全不变，改动范围须先让用户知晓。
6. 展示修改前/后预览与影响摘要，通过才更新草稿指针；失败或用户拒绝时仍保留老 revision。再次反馈保留讨论上下文。

**属性直改**：文字、价格、品牌色、常见数字、背景图/素材焦点等有暴露变量时在前端操作且不调用 AI；客户商业事实修改时进入再确认。对没有可编辑变量的代码元素，AI 源码修改仍然可用。评论状态：`pending → claimed → patching → validating → ready → accepted/rejected/cancelled`，状态幂等可恢复。

### 7.2 协作与冲突

使用 `baseRevision` 乐观并发控制；同一项目编辑来自两名成员时不盲覆盖，提供差异和重新应用。代码补丁必须满足文件哈希和路径白名单校验；不能从另一个租户引入 assets 或源工程。Studio 只读分享链接无法发起高权限代码执行或修改。

### 7.3 改稿体验的最低标准

- 点击 DOM 文本 → 改字 → 当前时间位置无跳变，字幕/字号与其他文字完整。
- 点击 Canvas 对象（无 DOM id）→ 时间+坐标截图 → Agent 找到绘制段并改动 → 有可复现回归证据。
- WebGL 若无法射线定位，仍可用截图兜底修改镜头/材质。
- “第 8 秒把推进改成 180° 环绕，其他镜头别动” → Agent 自由写代码完成且回归比对周边画面。
- “把所有片头都改成白底” → 显式进入 `all-variants` 修改范围；不谎报局部改动。
- 修改失败和拒绝必须 0 破坏当前确认版本；回滚能恢复源码、音效、依赖和素材引用，而非只恢复文案。

---

## 8. 经验沉淀（P1）：学用户，而不是把客户当训练材料

参考 `om learn` 的 `recall / harvest / add / supersede` 思路，定义 `creative_memory`：

| 类型 | 记录内容 | 默认应用 |
| --- | --- | --- |
| `explicit_preference` | 用户主动提出的跨项目偏好（如“品牌片少用强闪烁”） | 用户明确启用/保存后在**当前工作区**默认应用 |
| `project_observation` | 单条片子中一次具体反馈及成效 | 仅当前项目，不自动推广为定律 |
| `validated_experience` | 有来源、至少一轮反证检查与适用范围的工程经验 | 可进入**产品级通用方法**；仅存去客户化结论/允许素材 |
| `superseded` | 被后续反馈推翻的旧经验 | 不再触发，保留必要版本历史及原因 |

字段建议：`workspaceId, scope, type, title, rule, situations, exclusions, evidenceRefs, confidence, author, createdAt, supersedesId, consent, retentionClass`。Agent 回忆时排序：本次用户明确要求 > 项目事实/素材证据 > 工作区明确偏好 > 已验证通用经验 > 上游方法启发。

所有跨项目偏好需可查看、编辑、关闭和删除；用户项目评论不能未经授权进入公共 prompt 训练库；不混用不同客户的私有素材、音乐、商业主张。通用经验进入全局资料库前必须去标识化并取得适用权限。

---

## 9. Agent Orchestrator：一主 Agent + 可审计工具

### 9.1 工具调用优先，不强制“五 Agent 链条”

逻辑阶段：`intake → direction → treatment → hardest-shot → build → compose-audio → inspect → repair? → studio-ready → export-ready`。复杂情况下主 Agent 可以委托导演/音频/审片子 Agent，但默认不因为阶段划分启动五次模型会话。

可信层提供以下**受控工具**（参数必须 JSON Schema / Zod 校验并鉴权）：

| 工具 | 输入 | 输出/副作用 |
| --- | --- | --- |
| `getProjectContext` | 项目 ID | 已确认事实、可用素材、时长与已选预设、用户偏好 |
| `listCreativeReferences` | 消息结构/品牌气质/风格关键词 | 与上游方法映射的导演知识片段及来源 |
| `writeCreativeTreatment` | 方向/事件/视觉目标 | 版本化 Treatment，不触发任意脚本 |
| `writeFiles` / `applyPatch` | Base revision / 文件路径 / diff | 沙箱内暂存，路径与体积受控 |
| `buildComposition` | Candidate revision | 构建日志 + 依赖/许可清单 |
| `renderStill` / `renderPreviewClip` | 帧号、预设、候选 revision | 真实静帧/片段到私有 R2 |
| `composeAudio` | score/音频 cue | 音频源文件、版权元信息、混音结果 |
| `runSourceCheck` / `runFrameCheck` / `runVideoQa` | Candidate + 预设 | 分级诊断含具体证据 |
| `proposeRevision` / `freezeRevision` | Candidate + 测试报告 | 只有通过授权与门禁后形成不可变版 |

工具输出和抓取内容都是不可信数据；Agent 不能直接调用 Waffo、管理云平台、任意出网或修改其他用户项目。工具至少保留执行 ID、工作区 ID、预算、输出 hash 和错误分类，日志不得包含原始商业素材/秘钥。

### 9.2 模型路由与成本

- **高能力模型**：方向取舍、自由代码生成、复杂镜头修复、音画审片；**轻量模型**：提取、标签、文案、普通重写；**无需模型**：参数更新、合法性检查、音频混合、ffprobe、绝大多数 QA 数值检测。
- 不预设“某个模型一定最好”。M0 收集同一批任务对至少两种模型/配置的有效视频生成率、修改完成率、费用、时间与盲审质量；模型 ID 走后台配置。
- 先构建一个**可测量的 Agent Run Budget**：输入/输出 token、执行分钟、采样片段、自动修复次数、音频合成分钟、上限金额。超限保存工作，用户可继续/付费追加/退出，不 silently truncate 成片。
- 自动修复预算可从“最多 2 次候选修复”作为**初始待测值**开始，真实压测后调；失败不无限递归，不通过用户付费权益为平台故障重复收费。

### 9.3 状态与重试原则

`agent_runs` 主状态使用 `queued/active/awaiting_user/validating/succeeded/failed/cancelled`，阶段和 attempt 独立记录。所有修改建立在 immutable base hash 上，长时间执行后重读权限/版本号。Queue 至少一次交付，因此创建版本、扣额、提交渲染、完成回调均必须幂等；超时/重启不会重复发放权益或覆盖已经确认的 revision。

---

## 10. 云端执行隔离与生产交付

### 10.1 在现有 Cloudflare 上做最小新增

```
PromoBento Studio (React)
      │ auth + workspace policy
Cloudflare Workers API ── D1 (projects, runs, revisions, billing, audit)
      │                     R2 (assets, source snapshots, stills, audio, outputs)
Trusted Agent Orchestrator ── Model Router (secrets stay trusted)
      │
Isolated Composer Sandbox (one trust boundary / task)
      │   build → browser seek/still → audio preview → check / QA
      └── candidate artifact manifest → immutable revision
      │
Queues + Durable Objects (lease + budget + idempotency)
      │
Version-pinned Renderer Container (Chromium + FFmpeg)
      └── R2 MP4/JPG/ZIP → signed download
```

- 隔离的 Composer Sandbox 用于写代码/构建/抽帧，Renderer Container 专做可复现成片。**Renderer 本身也会执行不可信 Composition 的代码**，因此必须按作业/租户划分隔离执行实例或等效经验证的强隔离边界；不能因 Renderer 镜像固定就将其视为可信。一个作业结束后销毁/完全回收执行环境，下一作业不得继承可读内存、文件或网络权限。可以复用只读基础镜像，**不能共享含用户代码的长期进程**。
- Cloudflare `default` Containers 调度适合固定镜像/统一服务；`durable_object` 调度支持按实例配置，但截至 2026-10-20 官方仍标 **Public Beta**。先实测沙箱重启、镜像版本、回收、构建时长、并发和 R2 恢复，不能仅凭 SDK 存在就宣称生产可用。[官方策略文档](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)。
- Sandbox SDK 文档/版本已经更新，应在实施当天选择官方受支持的稳定版或明确承担 preview 风险的版本，并将 package/image 版本一起锁定。不要硬编码已迁移或废弃的 SDK 0.x 方法。参见[当前 Sandbox 总览](https://developers.cloudflare.com/sandbox/)。
- 维持原 v1.1 D1/DO/Queues outbox、lease、generation 检查、三次实际执行尝试等账务与渲染原则；编排任务与计费原子性不可拆散。

### 10.2 安全底线

1. 不可信代码**绝不**在主 Workers API、支付 Worker、主域页面、带客户 Cookie 的 origin 中运行。
2. 沙箱无支付、模型、R2 管理、D1 或后台密钥；按任务通过有签名、可撤销的 asset broker 获取最小授权素材；资产代理拒绝任意路径和跨租户 ID。
3. 默认 `enableInternet=false`；有必要的网络访问只在可信中间层经完整域名/IP/重定向、响应大小、内容类型与出口策略批准。Cloudflare 官方说明仅靠 `deniedHosts` 在开启互联网时不能阻断所有端口。[官方出网文档](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)。
4. 沙箱与主应用使用不同 origin。预览使用独立 origin、短期访问授权、iframe 限权、受控 `postMessage`、CSP；URL 泄露后仍不能访问其他用户资源。不能把主站 Cookie 传入 iframe。
5. `npm install`、包生命周期脚本、动态导入、外部字体/脚本、CDN、原始 SVG/HTML 文档均视为执行风险；只允许受信任的依赖镜像和资源，新增依赖必须审查和锁定。
6. 设定 CPU/内存/磁盘/时间/最大并发/Shader 与视频内存/Agent 调用/音频大小预算；GPU 特性在 Cloudflare 环境能否稳定使用需实际验收，不能承诺所有 WebGL 扩展。
7. 文件系统快照是临时的；所有确定成果通过原子 manifest/hash 写 R2 和 D1。中断后在同 revision 继续，不从未知容器磁盘恢复“已付费文件”。
8. 用户素材的网页文字、注释、截图中的提示和 Agent 工具输出都不能升级为系统/管理员指令；恶意 prompt injection 必须有专项测试。

### 10.3 许可决策（上线门槛）

- huashu-motion 作者代码/文档有 MIT 授权；每份 PORT 文件保留 MIT attribution/来源和修改记录。上游媒体/角色/第三方内容不因仓库 MIT 自动获得商业权利。[第三方说明](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md)。
- **GSAP**：官方标准许可允许大量商业用途和 AI 生成代码，但对帮助用户以可视化方式构建与 Webflow 竞争的动画工具有约束。PromoBento 有可视化修改功能，**在取得许可确认前不得将 GSAP 设为默认内置可用依赖或复制打包上游自带 GSAP**。可先使用浏览器原生 API、已核准 MIT 库和自己的时间适配。链接：[GSAP 官方许可](https://gsap.com/community/standard-license/)。
- **字体与音色**：逐个核实 OFL、CC0、CC-BY 或其他来源及署名要求；业务输出需要附带归属时要能交付，否则不要加载。含作者角色的 `toon.js` / storytime 形象不可直接用于本产品公开样片或默认模板。
- **用户素材**：记录提交主体、版权声明、第三方来源与权限，不把公开网页随意当可商用授权图片库；抓取内容只用于有限范围的产品说明与事实佐证。
- **工程源码导出（P1）**：仅打包用户该项目独立源代码与有重新分发许可的资产。第三方字体/音色/音轨若仅授权在服务端使用，提供授权说明及可自行替换配置，而不是连同受限文件一起发出。

---

## 11. 数据、API 与计费改造

### 11.1 在原 schema 上新增的实体

| Entity | 必备字段（示例） |
| --- | --- |
| `creative_briefs` | `project_id,duration_seconds,platform_ids,language,confirmed_facts_hash,reference_hash` |
| `creative_directions` | `run_id,label,logline,style_ref,treatment_hash,keyframe_refs,choice_state` |
| `composition_revisions` | `project_id,parent_revision,base_hash,source_archive_hash,dependencies_hash,renderer_digest,audio_hash,created_by,status` |
| `composition_variants` | `revision_id,preset_id,preset_version,layout_code_hash,safe_zone_test,output_fingerprint` |
| `agent_runs` + `agent_run_steps` | `workspace_id,status,phase,model_id,tool,token_count,seconds,cost_usd,error_code,budget_id` |
| `audio_projects` + `audio_cues` | `revision_id,score_hash,bpm,marks,voice_refs,cues,license_refs,mix_hash` |
| `quality_reports` | `revision_id,variant_id,level,check_type,frame_from,frame_to,element_id,raw_evidence_ref,waiver` |
| `edit_requests` + `agent_patches` | `base_revision,preset,frame,point,comment,scope,diff_hash,new_revision,validation_state` |
| `creative_memory` | `workspace_id,scope,kind,rule,evidence,consent,superseded_by` |
| `source_adoptions` | `upstream_commit,path,license,modifications,tests,notice_ref` |

所有主键、数据访问、素材下载、图片预览和 patch 事件必须按 `workspace_id` 做服务端鉴权。源代码快照和敏感素材加密/访问边界与 R2 资产策略一致。模型 trace 不保存完整敏感 prompt 和客户源码至常规日志。

### 11.2 API 按资源设计（设计稿，实施时与当前 URI 合并）

```
POST   /api/projects/:id/directions             # create/list candidates via run
POST   /api/projects/:id/agent-runs              # start agent work with budget/idempotency
GET    /api/projects/:id/agent-runs/:runId       # progress/errors/summary
GET    /api/projects/:id/compositions/:rev       # immutable metadata + signed assets
POST   /api/projects/:id/previews                # request scoped still/clip
POST   /api/projects/:id/edit-requests           # comment at frame and coordinate
POST   /api/projects/:id/patches/:patchId/apply  # accept candidate after checks
POST   /api/projects/:id/revisions/:rev/restore # new draft pointing to old content
POST   /api/projects/:id/releases                # freeze entitled version & selected presets
GET    /api/projects/:id/quality-reports/:rev    # QA reports by preset
```

每个写操作包含 `idempotencyKey`，修改带 `baseRevision` / `If-Match`，授权失败不泄露资源存在性。支付/导出相关 API 不接受 agent sandbox 直接调用，只通过可信业务层。

### 11.3 创作权益与成片权益分离，定价先实验

- 一次可见的用户 AI 编辑操作在执行前展示预估/上限创作额度；普通属性变更无模型消耗，不扣 AI 额度。
- 已确认的“成片版本”冻结源代码、镜头、时长、音轨与各平台 Variant。相同已购版本跨多个**既有平台预设**导出仍沿用 v1.1 的“只消耗一个版本额度”语义。
- 已付费订单不能因为内网重试/编码器崩溃/重复 Queue 投递重复扣版本额度；模型出错未生成可用输出的用户权益处理需可审核，但运营成本如实入账。
- 原试运营 `$39` 与 `$12` 可以保留作**待核实假设**，在首轮真实 Agent Run 成本、沙箱开销、客户修改次数与退款率出现后再提出另一次定价决策。不要在升级引擎时擅自修改原合同或已购账户权益。

---

## 12. 实施顺序：垂直闭环优先，门槛驱动

### M0 — Creative Engine PoC：不做假片

任务：固定上游 commit 的审计、Director 规则、最难镜头、自由 Composition、真实帧截取、Score+SFX、check/qa 初版、单平台 MP4。无用户支付；环境可先在受控本地容器测试，但必须给出 Cloudflare 环境迁移与风险报告。

**退出条件**：两种时长都跑通；同一素材至少两支真正不同语言的作品；至少一支包含 Agent 编写的**库中没有的新镜头运动**；音效对齐、真实可播放；并有失败日志与验收文件。只画静态样片或固定六场景视为失败。

### M1 — Agent Studio & Patch

任务：浏览器预览、逐帧定位、点选评论/截图、HTML/Canvas/WebGL 兜底、patch/版本树、普通属性直改、改稿回归、导演画面审片、音频重编排。

**退出条件**：用户改动时间局部成功，未授权改变区域回归可查；拒绝 patch 不污染原版；不同平台预设可重新构图并继续按 15/30 秒出片。

### M2 — Cloud Security & Reliable Render

任务：Sandbox、可信 Orchestrator、R2 不可变归档、网络封禁、预览独立域、模型调用预算、并发和恢复、版权清单、正式音视频 QA 和版本锁定。

**退出条件**：跨租户访问、密钥读取、网络出口、恶意依赖、prompt injection、队列重投、沙箱崩溃和旧 revision 恢复均有真实测试报告。

### M3 — SaaS 端到端与试运营

任务：现有站点、两类入口、邮箱 + Google、协作、Waffo、项目包/追加包、平台预设导出、运营面板、分析与告警。P1 的工作区创作经验与“工程源码 ZIP”可在 M3 后按复购数据决定上架。

**退出条件**：至少软件及课程两类真实用户都能自行上传/生成/改稿/支付/导出；账务幂等、退款、保留/删除按 v1.1 用例完成。目标已付费有效输入的自动重试后成功率≥95%仅作为试运营门槛，记录样本数与置信限制；未经测量不得宣称达到。

---

## 13. 可执行测试与证据（给 Codex 使用）

所有测试记录 `{testId,commit,imageDigest,fixtureHash,modelConfig,duration,preset,runId,result,evidenceUri,measuredAt}`。演示 GIF、示例 JSON、单元 mock 不算生产测试。按项目 privacy scope 保存真实失败证据。

| ID | 夹具/操作 | 必须验证 |
| --- | --- | --- |
| D-01 | 同一软件截图做 15s 9:16 两版 | 镜头语言/节奏/视觉材质确实不同，非仅配色更换 |
| D-02 | 30s 16:9 产品发布片 | 一段库里没提供的自由镜头（如界面 3D 环绕穿屏），可渲染完整 |
| D-03 | 15s 4:5 数据故事 CSV（内部 PoC） | 数据含证据，图表动画与数字正确，不套固定 `facts` 枚举；上线公开入口前须单独完成 CSV 输入范围与隐私验收 |
| D-04 | 30s 9:16 课程推广 | 真实教材素材、课程承诺仅来自确认事实、可读字幕与品牌 |
| D-05 | 15s/30s 任意场景数 | 精确 450/900 帧，总时长 15/30，反例 45s 被拒绝 |
| D-06 | 给定预设外尺寸/codec | 服务端拒绝，无权由 Agent 修改预设或靠前端校验绕过 |
| D-07 | 多预设 9:16/4:5/1:1/16:9 | Agent 重新排版/运镜，安全区与读字可用，不得仅粗暴裁切 |
| A-01 | ABC score + SFX 对齐 | 音效与指定落点误差≤1视频帧，实际可听到且无削波 |
| A-02 | 上传录音 + BGM ducking | 人声可听，音乐让位、字幕可读、来源可追溯 |
| A-03 | 15s 静音片 | 用户明确选择静音后无空白假音轨，画面仍自解释 |
| A-04 | 音频不变只改颜色 | 音轨 hash 可复用；节拍改变会正确失效并重新混音 |
| Q-01 | 伪造单帧闪白、文字遮挡 | 精确标记帧号/位置并给修复建议 |
| Q-02 | 计划内阅读静止与故意硬切 | 诊断但不误当必修缺陷，豁免需可追溯 |
| Q-03 | seek 的历史依赖 bug | 冷启动 vs 顺序播放的同帧差异能检出并重现 |
| Q-04 | 15/30s 导出文件 | ffprobe 校验像素、30fps、450/900 帧、音轨和时长 |
| E-01 | DOM 文本点选改稿 | 无需重做全片，自动显示差异与编译/QA |
| E-02 | Canvas 无 DOM id 元素 | 坐标+截图兜底，找到源代码修改成功 |
| E-03 | WebGL 元素或相机路径 | 射线或截图定位 + scoped patch 完成，并保持可复现 |
| E-04 | 两人并发编辑同 revision | 冲突提示/可恢复，不覆盖另一人的更改 |
| E-05 | Patch 失败/用户拒绝 | 当前确认 revision 完整不变，可重试/回滚 |
| S-01 | 跨租户 assetId/previewId | 不能读到对方素材/源码/报告；拒绝不泄漏具体存在性 |
| S-02 | Agent 提示要求读取密钥 | sandbox 无法读取 Waffo/API/数据库等密钥 |
| S-03 | `fetch` 公网/内网元数据 + npm 生命周期脚本 | 出网、执行依赖边界按声明真正拦截 |
| S-04 | 上传 HTML/SVG 脚本和恶意网页文本 | 主 origin 不执行；抓取内容只作为数据；不提升权限 |
| R-01 | 中断作曲/构建/渲染，Queue 重投 | 恢复到同任务，来源/版本未污染，无重复扣额 |
| R-02 | 订单 webhook 乱序/重复、退款 | 不重复授予/扣减，退款影响符合 v1.1 规则 |
| L-01 | GSAP/示范谱/采样/字体/作者形象 | 许可报告与拒绝未授权材料的测试记录齐全 |
| U-01 | 软件与课程用户完成闭环 | 有真实用户或授权代测的完整操作与反馈证据 |
| M-01 | 两种以上模型配置对照 | 记录成功率/成本/修复轮次/盲审结果，不以单条样片下结论 |

**质量评审表（人工复核，5 分制）**：产品辨识度、镜头创意、节奏/阅读、声音/画面协同、真实素材使用、信息准确性、改稿满意度。分数只用于对比/实验，不生成“品质评分 90/100 已通过”之类虚构数据；客观编码与安全检查独立强制通过。

---

## 14. 目录结构和现有文档迁移

建议在原仓库新增/修改，**不能覆盖已经存在的 AGENTS.md 或在未查目录时按建议路径删文件**：

```
packages/
  creative-director/    # brief, reference retrieval, treatments, rhythm, color, continuity
  composition-contracts/# duration/preset validation + immutable revision types
  composition-runtime/  # seekFrame, frame-ready, bridge, hit target, source map
  audio-engine/         # ABC score, audio cues, DSP/mix & licensing
  quality-engine/       # static/build/browser/video/audio/fact QA
  agent-orchestrator/   # tools, budgets, model router, run state
  upstream-adapters/    # deliberately ported/rewritten OM logic with notices
apps/
  web/                 # Studio prompt/preview/point edit/revision compare
  api/                 # trusted auth/workspace/asset/agent/billing endpoints
  jobs/                # Queues/DO/outbox/scheduler
  agent-runner/         # isolated composer/build/preview sandbox image
  renderer/            # frozen Chromium+FFmpeg media image
config/
  platform-presets.json # pre-existing versioned presets, no new free-form aspect
  model-profiles.json   # benchmark-tested providers and cost budgets
docs/
  UPSTREAM_ADOPTION.md
  DIRECTOR_PLAYBOOK.md
  AUDIO_PIPELINE.md
  VIDEO_QA.md
  STUDIO_PATCH_FLOW.md
  EXECUTION_SECURITY.md
  MODEL_EVALS.md
  EVIDENCE_INDEX.md
```

### 对仓库当前 PRD v1.4 专章的修正映射

| 原章节 | 动作 | 不得误改 |
| --- | --- | --- |
| 01 产品需求 §5/§6 | P0 场景枚举、结构样式变为**参考**；增自由动画编码/导演/音频/点选 | §5 的两类客户、购买权益与已确认事实流程继续有效；时长固定 |
| 02 界面/流程 §3/§4 | 三方向真实预览、音效同步、Agent Studio、源码定点与版本对比 | 不强迫所有用户学代码；协作/评论继续受权限控制 |
| 03 平台预设 §2–§8 | 保留原 6 平台规格；加代码 Variant 多构图验收 | 不增加任意输出比例/分辨率/帧率 |
| 04 技术 §3/§5/§6/§9 | 与 huashu 关系、自由 Composition、Sandbox、Orchestrator、QA、音频 | 原 R2/D1/DO/Queues 账务/隔离/重试语义不能丢 |
| 05 Waffo/权益 | 区分 AI 创作成本与成片权益，并给定价实验建议 | 原已买项目权益不能被技术升级静默缩水 |
| 06 测试/发布 | 本文第 13 节的真实资产、视频/音频/安全/费用证据 | 禁止把仿真日志写作真实部署证据 |
| 07 GPT 获客实验 | 增加“真人改稿次数/满意度、真实可发布视频”的实验 | 保留原站点获客词、两类入口、隐私限制 |
| 10 语言主题 | 继续英语首发、站点 System/Light/Dark | UI 主题不改变成片，语言上线逐项验收 |

---

## 15. Codex 执行命令书（可直接复制）

> 你正在维护 PromoBento。先阅读 `AGENTS.md`、`docs/prd/README.md`、01–12 章及本 v2.2 升级规格，检查实际代码和仓库状态。以 **v2.2 对创作引擎、导演、声音、QA、Studio 的明确修订**覆盖旧的固定模板限制；其他已确认业务、价格、数据隔离和平台规则继续继承原文。**时长严格只有 15/30 秒，30 fps；画幅/分辨率/编码严格来自当前平台预设**。不能将 20 种运动语言或若干现成模板重新硬编码为动画白名单。
>
> 将 `alchaincyf/huashu-motion` 锁定在本方案已核对的 commit 起点，先做 `UPSTREAM_ADOPTION.md`，逐文件判定 PORT/ADAPT/REBUILD/许可与测试。不得直接搬运 GSAP、受限制的作者角色、未审查的字体/采样。
>
> **先实现 M0 的真实创作垂直切片**：Director/Treatment → 自由源码 → 可渲染关键帧 → ABC/音效 → `check`/`qa` → 15/30 秒合规 MP4。运行每项测试并留下机器可核验的证据。不要用无关截图、纯 JSON、固定 SceneDocument 渲染或模拟视频替代结果。M0 通过后做 M1 点选改稿/版本，再做 M2 云端隔离与恢复，最后 M3 SaaS 付费闭环。
>
> 实施中先同步修订原 PRD 对应章节，再提交模块实现；每个里程碑列出代码变更、真实运行命令、测试结果、缺陷、成本与剩余风险。不可声称未完成的 Cloudflare/Waffo 生产验收已通过。没有环境权限/商户密钥时完成可在本机验证的部分并清楚标出外部阻塞，不编造生产成功记录。

## 16. 参考与事实边界

### 上游源文件（截至指定提交；“存在/实现”仅为仓库可见事实）

- [huashu-motion README](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/README.md)
- [huashu-motion SKILL](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/SKILL.md)
- [Director](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/director.md)、[Rhythm](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/rhythm.md)、[Library](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/library)
- [Sound](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/skills/huashu-motion/references/sound.md)、[Composer code](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/score.js)、[Mix code](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/sound.js)
- [Check](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/check.js)、[QA](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/qa.js)
- [Studio](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/studio/studio.js)、[Inbox](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/inbox.js)、[Learn](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/cli/lib/learn.js)
- [Third-party and author-persona exclusions](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md)

### 外部官方文档（实施日重新核验）

- [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) 与 [Sandbox Security](https://developers.cloudflare.com/sandbox/concepts/security/)
- [Cloudflare Container scheduling](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)
- [Cloudflare Container outbound](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)
- [GSAP Standard License](https://gsap.com/community/standard-license/)

**本文属于设计与实施依据；所有可运行、成片质量、在线隔离、支付/退款、成本与性能结论需在项目环境中按第 13 节实测，不能把官方示范视频或本方案示例当作 PromoBento 的真实上线证据。**