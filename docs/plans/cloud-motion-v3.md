# PromoBento 云端动效管线改造方案（v3.1）

- 日期：v3.0 于 2026-10-22 经负责人批准。2026-10-23 按负责人指示修订为 v3.1，改动如下：
  - 作品改为"片子规格 + 镜头积木 + 自写镜头"；
  - 导演改为分阶段流水线；
  - 按切片实施，且终版能力一次规划、一次实施；
  - 修正 v3.0 的事实错误。

  此后的修改直接在本文件进行，并在提交说明中写明改了什么。
- 状态：**已批准，S0 已完成，S1 实施中**。页面运行时、九个可信积木和内部渲染/云端编排代码已加入，范围见[实施状态](../implementation-status.md)；S1 其余能力及后续切片仍是目标。
- 基准：
  - PromoBento：`ten2ten2/promobento@1faef1c`（PRD v2.7、协议 2.7.0）。
  - huashu-motion：`alchaincyf/huashu-motion@4236053`（v0.2.0）。它是方法和代码的固定参考，本方案不追随它后续的版本。
- 读者：执行改造的 Claude Code / Codex。
  - 实施时按第 13 节把结论写进 PRD、契约、代码和实施状态。
  - 全部落地后，本文只保留尚未并入 PRD 的部分，最终删除。
- 范围原则（负责人 2026-10-23 决定）：**终版要有的能力，在本方案中一次规划、一次实施。**
  - 第 14 节的切片只决定实施顺序和检查点，不把任何能力留到"以后的版本"。
  - 产品上需要开关或计费规则的能力，代码与测试在本方案内完成，开关按 PRD 默认关闭。
- 前提：
  - **GSAP 已确定使用**：决定人 tianyu（tianyu@tinkerland.ai），2026-10-22。
    - GSAP 字节随渲染镜像分发。负责人已确认本产品可以使用 GSAP（2026-10-23 再次确认），这一决定即 PRD 09 要求的许可结论，不再另设外部输入。
    - 积木和自写镜头都可以用 GSAP（负责人 2026-10-23 决定）。确定性靠静默 seek 和第 4.3、5.6 节的检查保证。
  - **Cloudflare 账户已具备**：2026-10-22 已升级 Workers 付费计划。凭据和准备项见第 9.8 节。
  - **Chromium 沙箱已实测可用**：2026-10-22 在 Cloudflare Containers 上做了 3 次探针，均为 SANDBOX_FULL（第 5.5 节）。
  - **按需调度已实测可用**：2026-10-22 本账户可以直接使用 `scheduling_policy: "durable_object"`（仍为 public beta）。
    - 同一应用按次启动 standard-1、standard-3 与自定义 1 vCPU/3 GiB，均生效，就绪 0.7–4.0 秒。
    - 该策略下不能使用 `@cloudflare/containers` 的 `Container` 类（第 9.1 节）。2026-10-23 的 G1 预探针已用生产组合（`ctx.container` + `interceptOutboundHttp` broker）实测通过（附录 C）。
  - **安全保留、确定性降级**：负责人 2026-10-22 决定（D4、第 5.6 节）。
  - **前置实测**（2026-10-22）：见附录 A。探针和结果目前只在负责人本机，G1 用正式镜像复测，并按 06 写入 `docs/evidence/`。
  - **项目未上线，不考虑历史兼容。**
    - 旧 profile、旧契约、本地 JSONL 研究链路和 M0a 双臂研究，连同它们的测试和证据，一律删除或重写，不保留冻结层或迁移路径。
    - PRD 升到 **v3.0**，协议升到 **3.0.0**。

---

## 0. 目标与边界

**目标**：把 huashu-motion 的核心能力搬到 Cloudflare，为软件团队和课程/数字产品团队制作宣传片。

- 搬什么：导演方法、浏览器运行时与画面语法、QA 规则和声音。
- 以什么形态：片子规格 + 镜头积木 + 自写镜头（第 4 节）。
- 产出什么：15/30 秒、4 种画幅（对应 7 个目标）的宣传片。
- 怎样算达标：成本、性能、安全、效果同时达到第 1 节的目标。
- 不追求什么：逐模板还原上游。

覆盖的环节：素材理解、创作（含方向比较）、改稿、变体、目标准备、成片输出。

**不变的约束**：

- 15/30 秒，30 fps。
- `config/platform-presets.json` 的 6 个平台预设和编码 profile；7 个 `targetId`（`presetId:aspectId`）；4 种画幅（`aspectId`）。本文"目标"指 `targetId`，"画幅"指 `aspectId`。
- 两类首发用户（`software`、`course`）；Cloudflare 技术栈。
- PRD 14 的版本模型、CAS、`contentHash` 去重、冻结快照和费用账本；PRD 05 的计次与权益。
- AGENTS.md 的工具链与提交规则。

**本方案不做**：

- 网站页面、登录、Waffo 支付、邮件、多品牌管理，这些按原 PRD 推进。
- 工程 ZIP 对外交付（PRD 01 的 P1，涉及把运行库随源码交给客户，另行规划）。

本方案只提供它们要调用的创作与渲染后端 API、嵌入式预览播放器和评论采集组件。

**完成后的状态**：

- 作品只有一种形态：`film-v1`（第 4 节）。
- 以下内容全部从仓库删除（删除清单见第 3.3 节）：
  - QuickJS、`canvas-commands-v1`、`canvas-media-v1`；
  - 几何和媒体准入链路、已审阅 fixture 宿主、GSAP-QuickJS 探针；
  - 本地 JSONL 控制器、M0a 双臂研究。
- 本地开发与云端走**同一条代码路径**：
  - `wrangler dev` 用本机 Docker 运行同一个容器镜像；
  - D1、R2、Queues、DO、Workflows 由 Miniflare 在本地提供；
  - Workers AI 与 Browser Run 在本地走远程绑定，测试中用 mock。

---

## 1. 设计目标

### 1.1 单位成本

负责人 tianyu（tianyu@tinkerland.ai）于 2026-10-23 确认以下目标。它们是各切片的验收门槛，修改须经负责人确认。

| 操作 | 模型费用 | 计算费用 | 范围 |
| --- | --- | --- | --- |
| 一次创作（含 3 张方向卡） | p50 ≤ $1.00，p95 ≤ $2.00 | ≤ $0.15；含 WebGL 镜头时 ≤ $0.50 | 素材理解、方向、规格、自写镜头、review、冷审、内部修复，以及一个画幅的成片 |
| 一轮改稿 | p50 ≤ $0.15，p95 ≤ $0.50 | ≤ $0.10 | 能直接改值的评论，模型费用为 0 |
| 准备全部目标（4 个画幅） | p50 $0，p95 ≤ $0.30 | ≤ $0.20；含 WebGL 时 ≤ $0.80 | 只有自写镜头 Q1 失败时才调用模型 |
| 一次免费试用（1 次创作 + 2 轮改稿） | p95 ≤ $2.50 | — | 单独监控 |

**依据**：

- 权益（`config/agent-policy.json`）：
  - 免费试用含 1 次创作和 2 轮改稿；
  - $39 项目包含 5 次创作和 15 轮改稿。
- 按 v3.0 估算，模型费用会吃掉收入：
  - v3.0 的单一长循环：Opus 5.5，约 50 次调用，平均上下文 9 万 token，整文件重写。
  - 一次创作约 $4–8，一轮改稿约 $0.5–1.5。
  - 按 10% 的试用转付费率，每个付费客户要分摊 $50–110 的试用成本，超过首单收入。
- 按上表估算：
  - 项目包典型用量（2 次创作、6 轮改稿）约 $3；全部用满时 p50 约 $7，p95 约 $17.5；
  - 试用分摊到每个付费客户约 $13–25。

计算费用相比模型费用可以忽略（第 11 节），所以渲染侧优先优化时间，不优化费用。

**止损上限与目标的关系**：

- 第 6.12 节已批准的 `cost` 上限只是止损，不是设计目标。
- S2 结束后，按实测提议把止损上限收紧到目标 p95 的约 2 倍，经负责人确认后生效。
- 单位成本是第 14 节各切片的出口门槛，超标视同功能未完成。先按第 6.11 节的手段优化；仍不达标时，由负责人决定调整价格、权益或目标。

### 1.2 时间

以下为 p50 目标，S1、S2 实测后复标。

| 环节 | 目标 |
| --- | --- |
| 开始创作到 3 张方向卡（含关键帧） | ≤ 2 分钟 |
| 选定方向到浏览器里可播放的完整草稿（积木版） | ≤ 3 分钟 |
| 选定方向到候选完成（含自写镜头、review、冷审、成片与 QA） | ≤ 10 分钟；p95 ≤ 18 分钟 |
| 定点改稿到候选 | ≤ 3 分钟 |
| `still`（studio 实例已就绪） | ≤ 3 秒 |
| `review`（30 秒低清全片加发现） | ≤ 30 秒 |
| 成片 30 秒（纯 2D） | ≤ 60 秒；15 秒 ≤ 45 秒 |
| 成片 30 秒（WebGL 帧占比 ≤ 30%） | ≤ 180 秒；整片 3D ≤ 300 秒 |
| 准备 4 个画幅（纯 2D） | ≤ 3 分钟 |

2026-10-24 正式 G1 的[完整 28 部矩阵](../evidence/2026-10-24-s1-performance/README.md#28-部完整矩阵通过2d-p50-达到-60-秒目标)测得：2D 串行 p50 51.861 秒，WebGL 串行 67.844 秒；各四路并发也全部交付。保留上表目标，不以此前 66.774 秒的旧基线调宽门槛；方向、草稿和真实六题时间仍待验。

### 1.3 效果

- **评测集**：评测集的主体是负责人选定的内部评测题目（第 12.5 节），只用于内部评测。PRD 01 要求的首发至少 6 个自有或获授权样片（覆盖软件发布、功能更新、App、课程招生、模板上新和会员权益）另行制作，同样按本节判断。
- **负责人试听**：按正常速度试听，判断"愿意发布"。初值如下：
  - S1 出口：不少于 4/6；
  - 完成标准：不少于 5/6，且软件、课程各至少 2 个。
- **真实目标用户盲审**：按 06/07 另行组织。
- **持续评测**：改方法包、积木、运行时、提示或模型时都跑一遍评测集；费用、时间、QA 通过率和评分不得回退。

### 1.4 安全

- 不可信代码只在断网、无长期凭据的 microVM 里执行：
  - 成片的每个分段用一台新实例，用完即销毁；
  - studio 实例只服务一个操作。
- QA 只用可信观测，不读作品自报。
- 预览在独立注册域名下跨源隔离。
- 第 10 节逐项列出，全部要有自动测试。

---

## 1a. 关键决策

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| D1 | 作品由三部分组成：`film.json`（可信数据，Schema 校验）、镜头积木（PromoBento 维护的可信代码）、自写镜头（不可信代码，huashu-motion 页面合同的镜头级子集）。capability profile 为 `film-v1` | 模型主要输出几 KB 的规格，不必写整页代码。文字、事实、画幅、可编辑项和音画落点都变成数据。质量下限由测过的积木保证，自写镜头保留自由创作。上游的 `clip-spec`（JSON 驱动画面语法）就是这个思路，只是覆盖不全 |
| D2 | 执行单位分两种：成片按渲染分段，每段一台新 microVM；still、check、review 用每个操作一台常驻 studio 实例，操作结束即销毁。两者都断网，都只持有作用域受限的 broker 令牌（第 9.2 节） | 分段隔离不变。studio 实例让 Chromium、字体和 WebGL 只初始化一次，工具调用从十几秒降到秒级。同一操作里都是同一作者的代码，隔离边界不变 |
| D3 | 导演是分阶段流水线（第 6 节），由 Workflows 编排。每个阶段用新上下文，按阶段选模型和 effort；模型密钥只在 Worker | 单一长循环的费用随轮数和上下文增长。分阶段后输出小、上下文小、可以并行，费用可预测 |
| D4 | 确定性只做产品真正需要的部分：虚拟时钟、固定随机源、纯 seek；分段接缝用重叠帧比对；交付冻结成片字节 | 负责人 2026-10-22 决定"安全保留、确定性降级"。接缝跳变用户看得见，必须查；跨机器逐像素复现没有对应的用户价值 |
| D5 | 按帧段并行：段长为 15 帧的整数倍，闭合 GOP，各段同参数编码，Annex B 首尾拼接。段长按镜头代价分配，WebGL 帧切得更细。音轨只合成一次 | 突破单实例的 CPU 上限。规格知道每一帧属于哪个镜头，能把贵的帧分得更细 |
| D6 | 可信观测：文字框、实际使用的字体、可点区域、安全区，全部由控制器经 CDP 读取，不读作品自报。积木的文字槽位是观测重点，自写镜头里的额外文字单独报告 | 作品能改 DOM，但改不了 CDP 读到的实际布局和字体 |
| D7 | 交互预览在用户浏览器里运行：同一页面放在独立注册域名下的 sandbox iframe 中，CSP 禁网；视频镜头用代理 MP4 近似 seek。预览只用于制作和审阅，QA 以成片为准 | 实时预览零服务器成本，和上游 studio 同构 |
| D8 | 素材：上传走 R2 预签名；网址抓取用 Browser Run；视频与图片在断网的资产实例里处理；ASR 用 Workers AI。每个素材生成一次"素材理解"，按摘要缓存 | 实现上游的"真实素材优先"。导演读素材摘要，不反复看原图 |
| D9 | 多目标按画幅渲染：7 个目标对应 4 个画幅。`__omTarget` 只给画幅与安全区，不给 targetId；同画幅的目标共用同一份成片字节。积木天然适配 4 种画幅，只有 Q1 失败的自写镜头才调用模型 | 6 个预设共用 `mp4_h264_1080_v1`，安全区按画幅定义。将来某平台的安全区不同时再拆开 |
| D10 | 许可：GSAP 按负责人决定使用，随镜像分发，积木和自写镜头都可以用。Three.js r186 为 MIT；上游代码为 MIT；字体用 OFL；采样只用 CC0；不采购曲库，程序配乐用第 8.3 节的 CC0 采样包。不加片尾署名，不用作者形象 | 客户委托作品不能带第三方署名 |
| D11 | 上游关系：以 `4236053` 为固定参考，把需要的方法、画面语法和检查规则改写进 PromoBento 自己的代码，保留 MIT 来源说明。不 vendor 整个上游，也不追求模板逐帧对等 | 上游 2026-10-18 才发布 0.1.0，只在 macOS 上测试过，现在已有 v0.3.x。逐模板对等会把我们绑在一个快速变化的项目上 |
| D12 | 新代码使用 TypeScript（strict）。Workers 内的 Schema 校验只用 Ajv standalone 预编译的验证器 | Workers 禁止 `new Function`，现有 `packages/contracts` 在运行时编译 Schema。类型检查能拦下 Agent 写代码时的常见错误 |

**和 v3.0 的差异**：

- 不变的部分：浏览器运行时、隔离和渲染管线。
- v3.0 的做法：让模型按上游页面合同写整个 `index.html`；导演是一个最多 80 次工具调用的单一循环。
- v3.1 的改动：
  - 把作品拆成规格、积木和自写镜头；
  - 把导演拆成阶段；
  - 修正了第 9.1 节的 Container API、第 6.12 节的价格、第 5.3 节的单帧耗时、第 12.2 节的帧摘要比较等事实错误。

---

## 2. 总体架构

```
浏览器（客户）
  └─ Studio 预览 iframe（独立注册域名，CSP 禁网）── 运行同一页面，0.5 倍清晰度，视频用代理
        │ 评论、点选（regionId 来自预览 hit-test，提交前由云端用 CDP 复核）
        ▼
Worker  api.promobento（鉴权占位，按 12 接入）
  ├─ Workflows
  │    ├─ OperationWorkflow（每个创作、改稿、准备、变体操作一个）：导演阶段 A–F（第 6 节）
  │    ├─ RenderWorkflow（每次渲染一个）：分段计划、派发、接缝检查、拼接、QA、发布
  │    └─ AssetWorkflow（每个素材处理一个）：权利确认后处理、ASR、素材理解
  ├─ Durable Objects（SQLite 存储）
  │    ├─ OperationDO：本操作的 studio 实例、still/check 执行入口、向 Studio 推送进度
  │    ├─ ShardDO（每个分段 attempt 一个）：启动并看管一台分段实例，完成后向 RenderWorkflow 发事件
  │    ├─ AssetDO：启动并看管资产实例
  │    └─ CoordinatorDO：全局与工作区实例许可计数
  ├─ BrokerEntrypoint（WorkerEntrypoint）：容器唯一出口，校验令牌后读写 R2
  ├─ Queues：只用于 outbox 派发（创建 Workflow 实例）
  ├─ D1：业务记录与账本（第 9.3 节）
  ├─ R2（私有）：源包、素材、分段、成片、证据（第 9.4 节）
  ├─ Workers AI：ASR（whisper-large-v3-turbo）
  └─ Containers（scheduling_policy = durable_object，DO 用 ctx.container 启动）
       ├─ render 镜像  固定版本 chrome-headless-shell（当前锁定 151.0.7922.34）、ffmpeg、控制器、film-runtime、积木、字体登记
       │     模式：shard（standard-3；含 WebGL 的段用 standard-4）、studio（standard-3）、
       │           assemble（standard-3）、audio（自定义 1 vCPU / 3 GiB）
       └─ asset 镜像   standard-4：ffmpeg、图片处理、字体校验、Kokoro TTS
              模式：probe | normalize | proxy | extract | image | fontcheck | tts
外部
  ├─ 模型 API（OpenAI 兼容接口或 Claude API，按配置切换），只从 Worker 调用
  └─ Browser Run：网址抓取（可信端）
```

- **容器的唯一出口**是 `http://broker.internal`。
  - DO 用 `ctx.container` 的 `interceptOutboundHttp`，把它转给 `BrokerEntrypoint`。
  - 明文 HTTP 只走 Cloudflare 内部的出站处理，不出公网；因此不拦截 HTTPS，也不向镜像注入 CA。
- **令牌**：处理函数校验任务令牌后，只放行本次任务声明过的 R2 读写。容器内看不到 R2 凭据和模型密钥。

---

## 3. 仓库改造

### 3.1 最终目录

```
apps/
  cloud/               Worker、三个 Workflow、四类 DO、BrokerEntrypoint、D1 迁移、wrangler 配置。
                       导演逻辑在 src/director/**，账本与存储在 src/store/**
  render-container/    render 镜像：Dockerfile、控制器（HTTP 入口、Chromium 管理、沙箱自检、CDP 捕获与观测、
                       分段编码、拼接、声音合成、Q0 静态检查）、probes/（G1 探针脚本）
  asset-container/     asset 镜像：Dockerfile、probe、normalize、proxy、extract、image、fontcheck、tts
packages/
  contracts/           v3.0 Schema 的预编译校验、规范化、摘要与身份计算（canonical/digest/identity 底层保留）
  film-runtime/        页面生成器、shim、engine、转场、积木 API、自写镜头 API、OM 兼容层、clip 画面语法、OM3（Three.js）
  blocks/              镜头积木库（第 4.3 节）：每个积木含参数 Schema、四画幅布局、黄金帧
  audio/               声音引擎（程序配乐、ABC 作曲、音效、混音、响度）、拍点网格计算、CC0 采样包清单
  preview-player/      客户浏览器端的 iframe 宿主、bridge、评论采集，供网站引用
  methods/             导演方法包（从上游 4236053 改写，英文优先，补课程类目），带版本与内容摘要
  fonts/               字体登记目录与 WOFF/WOFF2 文件（渲染与预览共用）
contracts/
  film.schema.json               FilmSpec（第 4.2 节）
  block.schema.json              积木清单：参数 Schema、画幅、事件、区域、代价等级
  render-job.schema.json         渲染任务、分段计划、分段回执、接缝报告
  frame-observation.schema.json  CDP 观测
  agent-tools.schema.json        导演各阶段工具的输入输出
  direction.schema.json          方向卡
  audio-plan.schema.json         声音计划（从 creative-audio Schema 改写）
  asset-insight.schema.json      素材理解
  production.schema.json         按 PRD 14 v3.0 重写
  unit-economics.schema.json     由 m0a-economics.schema.json 改名并按 v3.0 改写
  film-runtime.d.ts              积木与自写镜头 API（替代 composition-runtime.d.ts）
  render-protocol.d.ts           3.0.0：预览 bridge、分段 seek/capture、observe
  agent-api.json 与仍描述 v3.0 结构的 *.example.json
research/
  evals/               评测集、运行器与报告（替代 research/m0a，第 12.5 节）
scripts/
  upstream-diff.mjs    比较固定参考提交与上游新提交：逐文件 diff、方法与许可变化。只供人工吸收，不是门禁
  check-repo.mjs 等    按新结构更新
```

### 3.2 从上游和现有代码吸收什么

详细取舍见附录 B。

1. **上游代码**（`4236053`，MIT）改写进 `packages/film-runtime`。保留根目录 `LICENSE`、`THIRD_PARTY.md`、`runtime/clip/NOTICE.md`、`runtime/clip/LICENSE`、`runtime/three/LICENSE` 等来源说明。
   - `runtime/om.js` 中自写镜头需要的 API 都吸收：
     - `OM.clock`、`OM.region`；
     - `OM.cue`、`OM.words`；
     - `OM.sfx`、`OM.music`（只作声明，第 8.2 节）；
     - `OM.beat`、`OM.spring`、`OM.random`、`OM.camera`、`OM.space`。

     `OM.vars` 由 `film.json` 取代。
   - `runtime/clip/**` 的全部 8 种画面语法及 lib，作为积木实现的基础，也开放给自写镜头：t1_3b1b、t2_keynote_ui、t3_finance_chart、y1_kurzgesagt、y2_vox、y3_whiteboard、y4_storytime、y5_kinetic_type。
     - 上游语法默认中文文案，`pace` 比实际节奏快 2.5–3 倍。改写时改为英文优先，`pace` 由规格给出。
   - `runtime/three/**`（three r186，即 0.186.1 的 bundle，以及 `om-three.js`），用于 3D 积木和自写镜头（第 4.6 节）。
   - 只参考、不吸收的：
     - `runtime/om-engine.js`：它依赖真实计时器，并把 `tl.seek(t, false)` 写死在 seek 里，与第 4.5 节冲突；可信引擎自写。
     - `runtime/camera-rig.js`：上游没有任何地方引用，不吸收。
   - `templates/**` 只作积木设计参考和冒烟测试语料（第 12.2 节），不进作品可见的路径。
   - `cli/lib/check.js` 改写为 Q0 规则，`cli/lib/qa.js` 改写为 Q2 运动诊断。
   - `cli/lib/beats.js` 用于用户配乐的拍点分析；上游没有把它接入任何命令。
2. **`toon.js` 与作者形象**：上游 THIRD_PARTY 写明，"豆子花叔"形象是作者本人的卡通肖像，不在 MIT 范围内。而 `keynote-ui`、`whiteboard`、`kinetic-type`、`finance-chart`、`vox-collage`、`kurzgesagt`、`math-3b1b`、`storytime` 8 个模板都加载 `toon.js`。处理方式：
   - `film-runtime` 的 `toon.js` 只保留通用部分：`flat`、`glow`、`vgrad`、`circle`、`ellipse`、`env`、`mouth`、`poseAt`、`blinkAt`、`alive`、`sweat`、`mark`，以及 `TOON.POSES`（上游第 35–42 行）和 `LINE` 常量（第 34 行）。删除角色绘制函数 `TOON.bean`（第 43 行起）及其专属代码。
   - 新写原创中性角色 `TOON.figure(c, o)`，参数对象和返回值与 `TOON.bean(c, o)` 相同：`o` 含 `x`、`y`、`s`、`pose`、`expr`、`mouth`、`blink`、`squash` 等，返回 `{hl, hr, head}`。形象几何化，没有标志性服饰和配饰，配色取自风格 tokens。y4_storytime 改为调用 `TOON.figure`。
   - Q0 增加规则 `third-party-likeness`：出现 `TOON.bean` 或引用上游 `toon.js` 即 BLOCK。
3. **方法包** `packages/methods/` 从上游 `skills/huashu-motion/SKILL.md` 与 `references/**` 重建。现有 `apps/agent-runner/methods/catalog.mjs` 是为 canvas 命令写的卡片，已删去 GSAP、DOM 和 3D 内容，不能直接复制。
   - 按阶段拆分：
     - 方向：director、visual-direction、colour，以及 library 的语言与格式；
     - 规格：rhythm、craft、product-demo-continuity、depth、sound；
     - 自写镜头：contract 的镜头级子集、grammars、techniques，以及 experience 中的 GSAP 陷阱（负 position 平移整条时间轴、`fromTo` 提前渲染起始状态）；
     - 审查：verification、provenance、检查规则说明。
   - 英文优先。补课程类目（上游 `product-fit.md` 的 48 个案例没有教育类），包括：
     - 招生、模块揭示、讲师介绍、学习成果；
     - 学员评价：按 FTC 规则绑定事实，并给出典型结果说明；
     - 报价与截止。
   - 不收录：`about-author.md`，签名和 `om share` 段落，macOS 专属条目，HyperFrames 历史，以及 `experience.md` 中用 yt-dlp 和浏览器 cookie 抓取的技巧。
   - 方法包带版本和内容摘要，进入成本事件和评测报告。
4. **字体** `packages/fonts/`：
   - 迁入以下来源：
     - `packages/composition-runtime/vendor/huashu-motion/fonts/`：42 个 WOFF 与 `registry.json`；
     - `apps/renderer/src/admission-font-catalog.mjs` 的登记；
     - `tests/fixtures/render/fonts/` 的 Geist Sans/Mono：它是品牌 UI 字体，也是软件宣传等宽字体的首选，v3.0 的删除清单漏掉了它。
   - 每个文件都按上游 `fonts/LICENSES.md` 或原始来源核对许可，并生成 WOFF2 版本。
     - 渲染与预览加载同一份 WOFF2 字节；WOFF 原件只作来源与度量依据。
     - 两种格式的摘要都登记，WOFF2 摘要进入 `runtimeVersion` 身份。
   - 别名：上游代码里的 `PuHui-*` 实为 Noto Sans SC 500–900 子集，按字重映射。映射表进入 `runtimeVersion` 身份。
   - 补齐覆盖：
     - 英文优先的默认字体组合；
     - Noto Color Emoji；
     - GB2312 子集以外的 CJK（简繁中文、日文、韩文）。

     客户视频的文字可以任意语言混排（PRD 10）。缺字由 Q1 报 `FONT_GLYPH_MISSING`，不回退系统字体。
5. **声音**：`apps/renderer/src/creative-audio/**` 迁入 `packages/audio`。
   - 它已包含：ABC 解析与演奏、13 种程序风格、37 种合成音色、CC0 的 VSCO 采样、23 种音效、混音与响度。
   - 响度目标改为读预设的 `loudnessTarget`；现在代码里硬编码的是 −16 LUFS。
   - 对 `contracts/admission-*` 和 `creative-audio-tools.schema.json` 的引用改到 `audio-plan.schema.json`。
6. **契约核心**：`packages/contracts` 的 canonical、digest、identity 底层保留；validation 改为 Ajv standalone 预编译（D12）。
7. **账本、改稿证据与经验**：`apps/agent-runner` 的语义在 `apps/cloud` 中用 D1/R2 **重写**。原实现依赖 Node 文件系统、子进程和 OpenAI 的计价语义，不能直接迁入。保留的语义：
   - 费用链：estimated → actual → reconciled；未知用量保留最坏值；重试和新操作不清零累计费用；
   - 公开错误码白名单，私有诊断单独保存；
   - 操作幂等重放，并核对请求一致；
   - 可控经验：用户选择启用，每次修改都核对当前代数，证据分类型；
   - 改稿证据：从成片抽取精确帧，加上点击处的 2× 放大，按摘要绑定版本、画幅、帧和评论。
8. **GSAP**：3.14.2 的 `gsap.min.js` **不纳入 Git**。
   - 完整 SHA-256 已在 `research/gsap-quickjs/probe.mjs` 第 9 行，由上游 `templates/blank/vendor/gsap.min.js` 计算，但没有独立复现。
   - S0 删除该目录前，把这个值迁入 `apps/render-container/environment.lock.json`；构建时重新下载并核对摘要，附 `GSAP-LICENSE.html` 和 `GSAP-LICENSE.txt`。
   - `cloud:deploy` 把同一份已校验的字节和许可文件上传到 R2 `runtime/<runtimeVersion>/`，供预览 origin 分发。

### 3.2a 镜像构建（render 与 asset 共用规则）

交付冻结的是成片字节（D4），不要求不同镜像版本渲染出相同像素。所以这里只要求"可追溯、尽量稳定"，不要求逐包可复现：

- **基础镜像与锁定**：
  - 基础镜像写成 `ubuntu:24.04@sha256:<digest>`，digest 记录在 `environment.lock.json`。
  - Chromium 归档、Node、npm 依赖（lockfile）、GSAP、Three、字体和 Kokoro 模型，都按摘要下载并校验。
  - apt 包不强制锁版本；可以用 `snapshot.ubuntu.com` 固定时间点，但不是门禁。
  - 构建后导出 `dpkg-query -W` 包清单。它的摘要和镜像 digest 一起写进渲染器登记表和每份分段回执。
- **网络**：只通过构建参数适配，不写进镜像层。
  - 参数：`HTTP(S)_PROXY`（Docker 预定义参数，不进入构建缓存键）和可选的 `APT_MIRROR`。
  - 2026-10-22 实测负责人本机经代理访问 archive.ubuntu.com 约 6 KB/s，清华镜像约 500 KB/s。
- **镜像推送在 CI 完成**：
  - 2026-10-22 从负责人本机向 `registry.cloudflare.com` 推送约 1.5 GB 镜像时，200 MB 以上的层反复 `broken pipe`，关闭代理也一样。所以 `cloud:deploy` 只在 GitHub Actions 运行，本机只做 `cloud:dev`。
  - CI 构建用 buildx 层缓存（GitHub Actions cache），只在 Dockerfile、锁文件或运行时代码变化时重建。现有 CI 每次从零构建两次镜像，约 35 runner 分钟。
- **登记**：`durable_object` 策略只接受 Cloudflare registry 中按摘要固定的镜像引用，不能引用 Docker Hub 等外部仓库；每个应用最多 100 个具名镜像。镜像大小受实例磁盘限制，standard-3 为 16 GB。
- asset 镜像不再包含 whisper.cpp 和它约 500 MB 的模型，因为 ASR 改走 Workers AI。

### 3.3 删除清单

删除前，对每个被删路径执行一次全仓库 `grep`，把所有引用方一并改掉或删掉。可复用的部分先迁出，再删除，不保留兼容层。

| 删除 | 先迁出的部分 |
| --- | --- |
| `apps/renderer/` 整个目录，包括 `docker/`、`environment.lock.json`、`admission.*.json`、`fontconfig.conf` | 声音迁入 `packages/audio`；字体登记迁入 `packages/fonts`。以下文件按新结构改写进 render-container 与 asset-container：`media-assets.mjs`（PTS 选帧）、`woff-metrics.mjs`、`creative-diagnostics.mjs`、`render-diagnostics.mjs`、`browser-bundle.mjs` 与 `environment.mjs`（浏览器归档校验）、`environment.lock.json`。`frame-capture.mjs`、`ordered-capture.mjs` 只作参考，新控制器改为 CDP 直连 JPEG 捕获 |
| `apps/agent-runner/` 整个目录 | 第 3.2 节第 7 条的语义（重写）；方法卡不迁 |
| `packages/composition-runtime/` 整个目录 | 字体迁入 `packages/fonts`；`motion-tools` 中与上游 clip 不重复的纯函数迁入 `film-runtime` |
| `contracts/admission-*.json`、`composition-runtime.d.ts`、`composition.example.json`、`creative-audio-tools.schema.json`，以及只为旧 profile 服务的 example 文件 | 仍有用的字段在新 Schema 中重写；新 Schema 就位、引用方改完之后才删 |
| `research/gsap-quickjs/`、`research/m0a/`、`tests/research/`、`tests/m0a/` | GSAP 摘要迁入锁文件；`m0a-economics` 的计算改名为 `unit-economics` |
| `tests/fixtures/admission/`、`tests/fixtures/render/`（字体先迁出），以及依赖它们的测试 | 用积木黄金帧和第 12 节语料替代 |
| 引用上述路径的脚本与测试：`scripts/prepare-render-ci.mjs`、`scripts/refresh-fixture-hashes.mjs`、`scripts/check-repo.mjs`（第 44、105 行等）、`scripts/check-production-contracts.mjs`（`globalContainers` 断言）、`scripts/output-safety.test.mjs`、`scripts/preview-policy.mjs` 与其测试、`scripts/production-contracts.test.mjs`、`scripts/repo-documentation.mjs` 与其测试、`scripts/benchmark-m0a.mjs`、`scripts/m0a-economics.mjs` 与其测试、`packages/contracts/test/` 中读取 `composition.example.json` 的测试（`canonical`、`identity`、`source`） | 按新结构改写；纯粹服务旧链路的直接删除 |
| `package.json` 与 `.mise.toml` 中的 `render:fixture`、`test:render`、`build:admission`、`render:admission`、`test:admission`、`test:admission-media`、`agent:local`、`creative:tools`、`creative:audio`、`test:creative`、`test:creative-audio`、`install:renderer`、`benchmark:m0a` | 替换为第 13 节的新任务 |
| CI 的 `render`、`admission`、`media-output`、`creative` job | S0 即删除，替换为 `browser`、`cloud-local` |
| PRD 与文档中描述上述内容的段落，`docs/creative-toolkit.md` | 按第 13 节重写 |
| `quickjs-emscripten` 依赖；不再有引用的 `pngjs` | 无 |

---

## 4. 作品：`film-v1`

### 4.1 源包

```
source/
  film.json                                FilmSpec（第 4.2 节），唯一入口
  scenes/<sceneId>/*.js|*.css|*.svg|*.json  自写镜头文件（可选），每个镜头一个目录
```

- **大小**：作者文件合计不超过 64 个、8 MiB，不含二进制；素材只经 `film.json` 的 `assets` 引用 R2 资源。
- **页面不由作者编写**：可信的页面生成器按 `film.json` 生成 `index.html`，按固定顺序注入：
  1. shim；
  2. engine；
  3. token CSS 与字体；
  4. 所用积木；
  5. 自写镜头模块。
- **运行库由可信宿主在固定路径提供**，版本由 `runtimeVersion` 决定，并进入源码身份：
  - `/runtime/film-runtime.js`、`/runtime/blocks/<blockId>@<version>.js`、`/runtime/clip/*`；
  - `/runtime/gsap.min.js`：所用积木或自写镜头需要时加载；
  - `/runtime/three.min.js` 与 `/runtime/om-three.js`：只有含 3D 积木或 3D 自写镜头的页面加载。
- **素材与字体路径**：
  - 素材只能经 `/r/<resourceId>` 引用。
  - 视频在渲染端经 `/r/<resourceId>/frames/<n>.webp` 取逐帧图，在预览端经 `/r/<resourceId>/proxy.mp4` 取代理。
  - 字体只能经 `/f/<fontId>/<weight>.woff2`。
  - 宿主按资源清单与项目权利放行，其他路径一律 404。

### 4.2 `film.json`（`contracts/film.schema.json`）

```
FilmSpec {
  specVersion: "film-v1",
  audience: "software" | "course",
  durationSeconds: 15 | 30, fps: 30, totalFrames: 450 | 900,
  style: {
    palette: { roles: { bg, surface, ink, muted, accent, accent2, ... }, sources: {...} },  // 每个颜色写明来源
    type: { display, text, mono?, scale },                                                  // 引用字体登记
    motion: { language, energy: 1..5, easing, transitions },                                // 语言来自方法包
    texture?: {...}
  },
  audio: {
    music: { kind: "procedural", style, bpm, ... } | { kind: "score", scoreRef }
         | { kind: "upload", resourceId } | { kind: "none" },
    voice?: { resourceId, transcriptId } | { tts: { voiceId, transcriptId } },
    sfx: "auto" | [ { at: { sceneId, event } | { frame }, id, gain? } ],
    captions: "auto" | "off"
  },
  texts: { [slotId]: { text, role: "headline" | "body" | "label" | "number" | "quote" | "caption" | "cta",
                       factIds: [...], lang?, maxLines? } },
  assets: { [assetKey]: { resourceId, roi?: [...], crop?: {...} } },
  scenes: [ {
    id, start, end,                                   // 整数帧，半开区间；转场处允许重叠
    kind: "block", block: "<blockId>@<major>", params: {...}       // 按该积木的参数 Schema 校验
      | kind: "custom", module: "scenes/<id>/index.js", brief, params: {...},
    layout?: { [aspectId]: {...} },                   // 只覆盖积木声明为可覆盖的布局项
    transitionIn?: { type, frames },
    purpose, focusFrom?, focusTo?                     // 镜头目的与视线衔接（Treatment）
  } ],
  treatment: { message, hook, energyCurve, holds, continuity }
}
```

**`film.json` 身兼三职**：

- Treatment（PRD 13 §3）；
- 可编辑值，取代 `values.json` 与 `data-composition-variables`；
- 音画落点的来源。

**可编辑项**：由文字槽位、风格 tokens、素材槽位和积木参数中标为 editable 的字段派生，沿用 `EditableProperty` 的类型（text、number、color、asset、boolean、enum、data、group）和 `affectsTiming` 语义。

**校验**在 Worker 内完成，不用容器：

- Schema 校验。
- 镜头覆盖 `[0, totalFrames)`，没有空洞；只有转场处允许重叠，场景与转场帧数要合法。
- 商业主张：每个文字槽位里的商业主张都绑定已确认的 factId（PRD 14 §8）。
- 引用：积木、字体、素材都存在，且素材已获权利。
- 拍点：蒙太奇切点距拍点超过 ±1 帧时报 REVIEW。
- 规格层素材规则：没有用到任何真实素材报 `no-real-material`，只用了 Logo 报 `only-logo`，两者都是 REVIEW。

**所有上屏文字都来自槽位。**

- 自写镜头只能通过 `ctx.text(slotId)` 显示文字。
- Q1 发现槽位以外的可见文字时报 `unbound-text`；文字含数字、货币或百分比时为 BLOCK。

### 4.3 镜头积木（`packages/blocks`）

**积木的形态**：

- 积木是可信代码，由 `defineBlock({ id, version, params, aspects, editable, cost, build(ctx, params) })` 定义。
  - `params` 是 JSON Schema；
  - `build` 返回 `{ render(localTime), events, regions }`。
- `render` 必须是时间的纯函数：同一时刻无论从哪一帧 seek 过来，画面都相同，不读真实时钟。
  - 可以用 GSAP 时间轴（暂停，由引擎 `seek(t, true)` 驱动）、移植的 clip lib 或自写补间。
  - 用 GSAP 时不能依赖回调里累积的状态（`onUpdate` 改写外部变量等）。
  - 由黄金帧测试保证：每个积木在四种画幅下做顺序、乱序和冷启动 seek，结果必须一致（容差同第 5.6 节）。

**每个积木都必须做到**：

- 四种画幅各自排版，遵守安全区（PRD 03）。
- 文字自动适配：
  - 字号下限：竖版、方版、Feed 的关键字 ≥ 36 px、CTA ≥ 32 px；横版分别为 32 px 和 28 px。
  - 文案超长时先换行，再缩字到下限；仍放不下时报 `TEXT_FIT_FAILED`，交给导演改文案。
- 对比度达标（正文 4.5:1）。
- 声明事件点，例如"落字""推近到位"，供音效自动对位。
- 声明可点区域和每帧代价等级；WebGL 积木为高代价。
- 有四画幅黄金帧回归，并有负责人审美签字。

**积木库**：全部在本方案内实现，S1 先做标 ★ 的 9 个。

| 类别 | 积木 | 主要来源 |
| --- | --- | --- |
| 开场与文字 | ★ `hook-title`（大字开场、逐词砸字、色带擦除），`kinetic-list`，`quote-card` | y5 kinetic-type、keynote-ui |
| 软件产品 | ★ `ui-showcase`（真实截图或录屏、设备框、推近、高亮、光标），★ `ui-journey`（CSS-3D 分层界面、`OM.space` 摆镜、一镜到底穿过多个界面），★ `feature-grid`，`cursor-demo`（光标操作演示），`card-montage`（卡片蒙太奇），`before-after`，`code-snippet`（等宽字体） | ui-space、keynote-ui、product-demo-continuity |
| 数据与证据 | ★ `metric`（大数字计数），`chart`（柱、线、占比；涨跌配色可配置，不默认红涨绿跌），`logo-wall`，`testimonial`（绑定事实与授权），`evidence-collage` | t3 finance-chart、y2 vox |
| 课程 | ★ `talking-head`（口播素材、名牌、关键词、章节卡），★ `curriculum`（模块揭示），`outcomes`，`instructor-intro`，`offer-deadline`（报价、优惠、截止，全部绑定事实），`whiteboard-explainer`，`math-explainer`，`illustrated-explainer`，`story-figure`（原创角色叙事） | talking-head、y3 whiteboard、t1 3b1b、y1 kurzgesagt、y4 storytime |
| 3D（WebGL） | `device-3d`（截图上设备、景深、摇臂），`logo-3d`（真实 SVG 挤出成立体），`product-stage`（摄影棚弧幕与灯光） | object-3d、OM3 |
| 收尾与全局 | ★ `cta-endcard`，★ `captions`（口播字幕层，内容来自已确认转写稿），`brand-sting` | — |
| 转场 | cut、crossfade、push、whip（S1），wipe、zoom-through、match handoff | — |

### 4.4 自写镜头（不可信代码）

- **入口**：`scenes/<id>/index.js` 调用 `PB.scene('<id>', (ctx) => ({ timeline, regions?, events? }))`。
- **`ctx` 提供**：
  - `root`：按画幅尺寸的镜头容器；
  - `target`：画幅、宽高、安全区；
  - `style`：风格 tokens；
  - `text(slotId)`、`asset(key)`；
  - `frames`：本镜头的起止帧；
  - `beats`：本镜头内的拍点帧；
  - `OM`、`CLIP`；启用 3D 时另有 `OM3`。
- **时间**：
  - 返回暂停的 GSAP timeline，由引擎 `seek(localTime, true)`；或者用 `OM.clock(tl, draw)` 驱动 Canvas。
  - 一镜到底时，一个自写镜头可以覆盖整片。
- **允许使用**：
  - DOM、SVG、Canvas2D；
  - WebGL1/2（经 OM3 或直接用 Three.js）；
  - GSAP 全部核心插件，以随镜像分发的为准；
  - CSS 动画（由引擎接管时间）；
  - clip 画面语法、`OM.camera`、`OM.space`。
- **禁止使用**：
  - 网络：`fetch`、XHR、WebSocket、EventSource、`navigator.sendBeacon`，以及外部的 `<img src>`、`url()` 和 `@import`；
  - `Worker`、`SharedWorker`、`ServiceWorker`、`WebAssembly`；
  - `eval` 和 `new Function`；
  - 存储：`localStorage`、IndexedDB、cookie；
  - 音频播放 `AudioContext`：声音全部走声明式（第 8.2 节）；
  - `<video>`：视频只能通过 `OM` 的取帧接口；
  - `<iframe>`，含 `srcdoc`；
  - 绕过 `ctx.text` 直接写文字。
- **执行与兜底**：
  - 渲染时由运行时 shim 报错；Q0 静态检查只作提示；网络另由断网兜底。
  - CSP 在预览端和渲染端都带上。
  - 2026-10-22 本地实测：CSP 能拦下全部外部请求、`eval`、`new Function`、WASM，但拦不住 `localStorage`、IndexedDB、cookie，这三项必须由 shim 禁用。
  - CSP 下 `srcdoc` iframe 里的脚本仍会执行，所以 shim 禁止创建 iframe，Q0 判为 BLOCK。
- **点选**：用 `data-om-id` 和 `OM.region` / `OM3.region`。

### 4.5 运行时保证

`shim.js` 通过 `Page.addScriptToEvaluateOnNewDocument` 在任何脚本之前执行；`engine.js` 紧随其后注入。

**shim 分两个阶段生效**：

- **加载阶段**：从页面创建到引擎宣布就绪（`init` 完成）。three.js 的加载器等库代码需要真实计时器，所以这一阶段 `setTimeout` 和 rAF 照常可用；时钟仍然是虚拟的。
- **渲染阶段**：`init` 之后，下面的限制全部生效。

**具体规则**：

- **私有真实计时器**：
  - shim 在覆盖全局之前，先把真实的 `setTimeout`、`clearTimeout`、`requestAnimationFrame`、`performance.now` 保存在闭包里。
  - 这些计时器只交给随后注入的 `engine.js` 一次，交接后删除交接口。引擎用它们做绘制等待和超时，作者代码拿不到。
- **时间**：两个阶段都生效。
  - `Date`、`Date.now`、`performance.now`、`performance.timeOrigin` 返回虚拟时间 `T`。
  - 加载阶段 `T = 0`；渲染阶段由引擎在每次 seek 时设置。
- **rAF**：渲染阶段的 `requestAnimationFrame` 回调进入队列，seek 后由引擎以时间戳 `T` 刷新，至多 2 轮。
- **绘制等待**：
  - seek 后等待绘制的上限取 `frameTimeoutMs`，不沿用上游写死的 5 秒。
  - 2026-10-22 实测 `object-3d` 在 standard-3 上首帧约 31 秒，5 秒上限会稳定报"rAF never fired"。
- **定时器**：渲染阶段调用 `setTimeout`、`setInterval` 即抛 `RUNTIME_TIMER_FORBIDDEN`。
- **随机**：
  - `Math.random` 替换为新定义的 `random-seq-v1`：以项目 seed 和调用序号做哈希。算法写进契约并附固定向量。
  - 调用序号依赖执行顺序，所以每次 seek 前把序号重置为 0，同一时刻的调用序列因此一致。
  - `crypto.getRandomValues` 抛错。`OM.random(seed)` 不受影响。
- **合成**：
  - 引擎按帧确定活跃镜头（含转场重叠），调用积木的 `render(localTime)`，或 seek 自写镜头的时间轴。
  - 引擎管理镜头可见性、转场和画幅布局。
- **GSAP**（积木与自写镜头）：
  - `gsap.ticker.lagSmoothing(0)`，并移除自动 ticker；
  - 所有在 `__timelines` 注册的时间轴都 `pause()`；
  - 引擎调用 `tl.seek(t, true)` 抑制回调，从源头消除带状态的 `onUpdate` 造成的历史依赖。上游用 `seek(t, false)`。
  - `OM.clock(tl, draw)` 通过代理对象的属性 setter 驱动 `draw`，静默 seek 也会触发。引擎不再额外调用 `draw(t)`，否则每帧画两次。
- **CSS 动画**：
  - 每次 seek 时，对 `document.getAnimations()` 的每一项执行 `pause()`，并设 `currentTime = T*1000`。
  - `transition` 在 Q0 中报 REVIEW（`css-transition`）；渲染阶段检测到 `transitionrun` 事件即报错。
- **字体**：
  - 容器内的 fontconfig 只包含字体登记目录。
  - `document.fonts.ready` 之后才视为就绪；等待超时由引擎用私有真实时钟计算。
- **视频**：
  - 渲染端用抽帧方式：由资产实例预先抽帧（第 8.1 节），页面通过 `OM` 拿到对应 PTS 的帧图；缺帧即 `VIDEO_FRAME_UNAVAILABLE`。
  - 预览端用代理 MP4 近似 seek。
- **目标**：`window.__omTarget = { aspect, width, height, safeInsets, fps: 30, totalFrames }`，不含 targetId（D9）。
- **签名**：引擎强制 `data-om-signature="off"`。上游会在 ≥ 4 秒的片子的最后 1.2 秒画出 "Made with huashu-motion"。

### 4.6 WebGL 与 3D

- **环境**：
  - Chromium 启动参数 `--use-angle=swiftshader --enable-unsafe-swiftshader`。
  - 2026-10-22 探针在 Cloudflare standard-3 上实测，沙箱开启时 WebGL 2.0 可用，渲染器为 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`。
  - 渲染器登记表记录 `webgl: 'swiftshader'` 和该渲染器字符串，控制器每次启动都核对，不一致即 `RENDER_ENVIRONMENT_MISMATCH`（平台错误）。
- **只能用 CPU**：2026-10-23 核对，Cloudflare Containers 没有 GPU 实例，也没有公布计划，3D 一律按 CPU 渲染规划。
- **代价**（附录 C，`object-3d` 1080p）：页面加载（场景建立）standard-3 约 23–34 秒、standard-4 约 17 秒；之后每帧 standard-3 约 3.9 秒、standard-4 约 2.3 秒。附录 A 的"首帧约 31 秒"在附录 C 中没有重现（首帧 2–10 秒），固定成本主要在页面加载。
- **对策**：
  1. **规格层**：3D 积木声明为高代价。导演在规格阶段看到 3D 镜头的时长预算：默认单片 WebGL 帧占比 ≤ 30%，超出要写明理由，并按第 1.2 节的 3D 时间目标执行。
  2. **分段**：按代价分配段长（第 5.2 节）；含 WebGL 的段用 standard-4（4 vCPU），实测每帧比 standard-3 快约 1.7 倍（附录 C）。每段要付一次约 17 秒的页面加载，所以 WebGL 段不宜切得太短。
  3. **初始化**：
     - OM3 的环境贴图预先烘焙为素材，不在运行时生成；
     - 附录 C 实测：复用着色器磁盘缓存没有稳定收益；容器快照只保存文件系统、不保存进程，恢复后加载与首帧都没有变快。两者都不采用。
  4. **内部分辨率**：附录 C 实测 dpr 0.75 每帧没有变快（瓶颈不在像素填充），所以不做 `renderScale`；改为由 3D 积木控制场景代价（后期效果、阴影、几何），积木的代价等级按 studio 实测标定。
  5. **studio 实例**：WebGL 只初始化一次，still/check 不重复付出首帧代价。

S1 当前代码先接入原创 `device-3d@1` 与固定 Three.js 0.186.1，不包含上游设备模型或作者形象。仅 3D 页面加载独立 bundle；BlockInstance 的可选 ready/dispose 管理纹理与 context 生命周期。共享分段器自动识别该积木，按 15 帧单元的 6:1 初始代价分配分段（review 30 帧），含其画面或接缝帧的分段用 standard-4；初始化/逐帧期限和整次期限读取 agent-policy。尚未实测的完整 G1 不由这些代码标记替代，当前范围见[实施状态](../implementation-status.md)。

### 4.7 握手

页面就绪需要同时满足：

- `__omReady` 为 true；
- `fonts.ready` 完成；
- 所有 `OM3.ready` 和图片解码完成；
- 未超过 `initTimeoutMs`。

随后控制器发 `init`，再逐帧发 `seek`。每帧时限为 `frameTimeoutMs`，取值见第 5.3 节。

---

## 5. 渲染管线

### 5.1 渲染任务（`render-job.schema.json`）

```
RenderJob {
  renderId, operationId, revisionId?, candidateId,
  sourceHash, runtimeVersion, rendererRelease,       // 渲染器登记表中的精确镜像 ID
  aspectId, durationSeconds, totalFrames,
  quality: 'still' | 'review' | 'final',              // review = 0.5 倍像素、无运动模糊
  renderProfile: RenderProfile,                        // standard；motion4/8 按 PRD 03 默认关闭
  resources: [{resourceId, sha256, kind}],
  audioPlanHash?, frozenAudioHash?,
  frames?: number[], crops?: [...],                    // 仅 still
  reuse?: [{shardKey, renderId, shardIndex}]           // 增量渲染复用的分段（第 5.7 节）
}
```

### 5.2 步骤

RenderWorkflow 驱动这些步骤。每步结果写入 D1 和 R2 之后才推进，可以幂等重放。

1. **准备**（Worker 内完成，无容器）：
   - 校验源包；计算 `sourceHash`；确认资源权利和摘要；查询渲染器登记表。
   - 按第 11 节的估算预留费用，取最坏值。
2. **声音**（audio 模式，standard-2：1 vCPU / 6 GiB，固定一个 FFmpeg 线程）：
   - 按冻结的 AudioPlan 合成 48 kHz 双声道 WAV。
   - 检查响度（预设的 `loudnessTarget`）和真峰值。
   - 同一 `audioPlanHash` 复用。
   - 2026-10-25 将实际派发从只有 0.5 vCPU 的 standard-1 对齐至一核，采用已有标准规格，不引入自定义计价；权威规格见 [Cloudflare 表](https://developers.cloudflare.com/containers/platform/limits/)。前一版的 G1 音频样本仍属于 standard-1，新的资源规格另作原生验证，期限与并发名额不变。
3. **分段计划**：
   - 每帧代价来自积木声明和 studio 实测；WebGL 帧和运动模糊的子帧按倍数计。
   - 按代价切段，段长为 15 帧的整数倍，目标每段墙钟 30–40 秒。
   - 纯 2D：30 秒片 6 段（每段 150 帧），15 秒片 3 段。正式 G1 的 28 部矩阵已达到原 2D p50 目标，保留 JPEG92、2D 6 段与 WebGL 24 段/standard-4，不增加物理并发；实测见第 1.2 节。
   - review 质量走同一流程，源时间轴按 30 帧单元切分，编码为 15 fps 闭合 GOP。纯 2D 保留 15 秒 3 段、30 秒 6 段，给冷启动与拼接留出原 90 秒期限内的余量；WebGL review 仍将段数减半。该内部修正来自实际 MiniMax 冷启动/重试耗尽期限的反例，不提高物理并发上限或改动最终片分段。
   - 段数受 `limits.shardsPerRender` 与工作区、全局并发的约束。
4. **分段渲染**（shard 模式，standard-3；含 WebGL 的段用 standard-4；各段并行）：
   1. 启动固定版本的 Chromium，沙箱自检通过（第 5.5 节）后，从 broker 读取源包，生成页面，完成握手。
   2. 除第一段外，每段先冷启动 seek 到重叠帧 `a-1`，用 PNG 截图并记录摘要，不编码；然后顺序渲染 `[a, b)`。每段的末帧 `b-1` 也另存 PNG。
      - 运动模糊时，每帧按 `centered-box-v1` 采 N 个子帧，在控制器内以浮点平均。
   3. **捕获**：
      - CDP `Page.captureScreenshot` 取 JPEG，质量 92，开启 `optimizeForSpeed`。字节直接写入 ffmpeg（`-f image2pipe -c:v mjpeg`），控制器不解码。
      - `frame-digests.json` 记录每帧 JPEG 字节的 sha256，仅作诊断。
      - 附录 C 实测（`kinetic-type` 1080p）：CDP 直送、不在 JS 里解码时，PNG 每帧 193 ms（standard-3）/ 173 ms（standard-4），JPEG 92 为 168 / 136 ms，相对 PNG 的 SSIM 0.998。收益主要来自去掉 JS 解码和 Playwright 截图开销（附录 A 为 0.28–0.63 秒/帧）；JPEG 本身再快 13–21%。
   4. 在观测帧集合（第 7 节 Q1）上执行 CDP 观测；观测帧另取 PNG。
   5. **编码**：x264 参数与最终 profile 相同，所有分段完全一致。
      - 宽高、`yuv420p`、BT.709、profile 与 level 一致；
      - `-g 15 -keyint_min 15 -sc_threshold 0`，闭合 GOP；
      - **`-bf 0`**：不用 B 帧，避免拼接处 DTS 不单调；
      - `-threads` 等于实例的 vCPU 配额（standard-3 为 2，standard-4 为 4），不按 VM 内看到的 `nproc`；
      - VBV 按 `maxVideoBitrate`；**无音频**；
      - 输出 Annex B 裸流 `shard.h264`，不封装成 mp4。
   6. **输出**：`shard.h264`、`frame-digests.json`、`seam-frames/*.png`、`observations.json`、`receipt.json`。回执包括：
      - 镜像 ID、Chromium 版本；
      - CPU 型号与 `cpuFlagsHash`（`/proc/cpuinfo` 完整 flags 排序后的摘要）；
      - 沙箱状态（seccomp、命名空间、uid 的实测值）、`--disable-skia-runtime-opts` 状态；
      - 捕获格式、计时和内存峰值。新的 `timings.frameCaptureMs` 按实际编码源帧记录 seek/确认/CDP 捕获毫秒序列，排除编码背压、QA 与接缝 PNG；旧回执可缺该字段。DO 另外记录等待名额和新实例启动到控制器健康响应的耗时，不改写原 CDP `readyMs` 的意义。
      - 2026-10-24 内部评测例外：负责人确认 Cloudflare 未暴露 cgroup 峰值接口时，可写 `peakMemoryMiB:null` 并附 `peakMemoryUnavailableReason:"cgroup_peak_not_exposed"` 继续出片，G1 该指标保留未验证；不得填 0 或改用控制器 RSS，其他门槛不变。
   7. 完成后控制器上报结果。ShardDO 立即停止实例，确认状态变为停止，再归还并发许可。
5. **接缝检查**（Worker 内，无容器）：见第 5.6 节。
6. **拼接**（assemble 模式，standard-3）：
   - 按顺序把各段 Annex B 裸流首尾相接，以 `-r 30` 一次封装成 mp4，同时混入冻结音轨（AAC-LC 48 kHz 双声道 128 kbps），开启 `faststart`。
   - 用 ffprobe 核对：总帧数、PTS 连续且单调、CFR、每 15 帧一个关键帧、宽高、像素格式与色彩。
   - 码率：分段各自满足 VBV，不等于整条码流满足。拼接后按 1 秒滑动窗口计算整片码率；超过 `maxVideoBitrate` 时，在 assemble 内对整片重编码一次（同参数、整片 VBV），回执中记录 `reencoded:true`。
   - 生成 poster 和关键帧 PNG。每个目标的封面按 PRD 03 从真实帧中选择。
7. **QA**：见第 7 节。
8. **发布**：
   - 结果写入 R2 `renders/<renderId>/out/`，D1 记录 `renders.status = passed | blocked`；结算费用，并通知 OperationWorkflow。
   - 同画幅的各目标共用这份 `film.mp4` 字节。交付和订单绑定它的字节摘要；之后的下载、补平台都用这份字节，不重新渲染。

### 5.3 期限

全部写入 `config/agent-policy.json` 新的 `render` 段，替代原来单一的 600 秒。

| 阶段 | 期限 |
| --- | --- |
| 分配实例到控制器健康 ready | `containerStartupMs`：45 秒，并受整次渲染剩余绝对期限约束。2026-10-24 MiniMax 实际出现 25.812/29.381 秒就绪及一次 30 秒超时，随后重试耗尽 review；据此留出冷启动余量，未据三个样本估计分位数。broker 注册仍先于分配、单独最多 30 秒，不重置整片期限 |
| 沙箱页面初始化与握手 | `startupMs`：30 秒；页面用到 WebGL 时 `startupWebglMs`：60 秒。参考值（2026-10-23，1.05 GB 镜像、standard-3、25 个新实例，[前置探针](../evidence/2026-10-23-pre-s1-probe/README.md)）：控制器就绪 p50 1.24 秒、p95 8.95 秒；沙箱内 Chromium 启动约 0.85 秒，2D 页面首帧合计 p50 2.07 秒；从发起启动到首帧 p50 3.8 秒、p95 11.9 秒。WebGL 首帧约 31 秒。该历史探针不代表当前较大镜像的控制器冷启动分布 |
| 每帧 | `frameTimeoutMs`：2D 5 秒；用到 WebGL 时 10 秒（实测最慢一帧 4.5 秒）。运动模糊时乘以子帧数 |
| 每段 | `段帧数 × 每帧基数 + 30 秒`。每帧基数初值：2D 1.0 秒，WebGL 6 秒。G1 后按实测 p99 × 1.5 复标 |
| 拼接（只封装和混音） | 60 秒 |
| 拼接（含整片重编码） | `总帧数 × 0.2 秒 + 60 秒` |
| 整次渲染 | 纯 2D：成片 30 秒 240 秒，成片 15 秒 150 秒，review 90 秒。含 WebGL 时，取按代价估算的最长段期限再加 120 秒。运动模糊按子帧数放大。超时记为 `RENDER_DEADLINE`，不交给模型修 |

首轮正式 G1 两类各 12,600 帧的 seek/ready/JPEG92 捕获 p99 为 208.863/225.209 ms。该计时不含编码器背压、素材准备和 QA，不能将 p99 × 1.5 直接当作完整分段期限；本轮保留上表基数与绝对期限，真实六题的完整负载仍待验。启动前 broker 注册单独有界并计入原操作绝对期限，不占用实际分配实例后的健康窗口；[原始测量与决定](../evidence/2026-10-24-s1-performance/README.md#28-部完整矩阵通过2d-p50-达到-60-秒目标)。

v3.0 这一节前后不一致：一处写单帧 PNG 截图 50–140 毫秒，附录 A 实测却是截图 125–300 毫秒加解码 50–100 毫秒，合计 0.28–0.63 秒/帧，超过了当时 0.6 秒/帧的期限基数。上表已按附录 A 的实测改正。

模型调用和工具执行的期限分开计算，不共用一个计时器。

- 模型调用的期限 `requestTimeoutMs` 新增到 `config/agent-policy.json`。
- v3.0 写的是"沿用"，但这个字段只存在于要删除的 `apps/agent-runner/src/schema.mjs` 中。

### 5.4 失败分类（白名单，替代当前的黑名单正则）

**作品错误**，作为工具结果返回给导演修复：

- `film.json` 或源包校验失败、积木参数不合法；
- Q0 规则命中；
- `RUNTIME_*`：定时器、网络、存储、eval 等被拦截；
- `INIT_TIMEOUT`、`FRAME_TIMEOUT`、`DRAW_FAILED`、`PREPARE_FAILED`；
- `RENDER_SEAM_BLOCK`；
- 字体回退或缺字（`FONT_FALLBACK_USED`、`FONT_GLYPH_MISSING`）、`TEXT_FIT_FAILED`；
- 文字裁切、遮挡、越出安全区、对比度不足、`unbound-text`；
- 内存超限（`RENDER_OOM`）、页面崩溃：
  - 控制器检测到的渲染进程 OOM 或崩溃，直接归入此类；
  - 整台实例被重启或消失时（Cloudflare 的 OOM 会重启实例，宿主维护也会停止实例，两者无法从外部区分），先按平台错误换新实例重试一次；同一分段再次发生才判为 `RENDER_OOM`；
- 运动诊断中标为 BLOCK 的项。

**积木内部错误** `BLOCK_INTERNAL_ERROR`：这是可信代码的缺陷。按平台错误处理，不交给模型；告警，并记录积木版本。

**环境或平台错误**，不调用模型，直接按 04 的应用重试策略处理或停止：

- 实例无法启动、镜像不匹配、`RENDER_ENVIRONMENT_MISMATCH`、`RENDER_SANDBOX_UNAVAILABLE`；
- broker 拒绝；R2、D1 或 Workers AI 不可用；
- 控制器自身异常、ffmpeg 异常；
- 拼接失败、`RENDER_DEADLINE`；
- 预算、取消、授权、清理问题。

每类各有固定错误码，补测试逐项覆盖。

**环境预检**：第一次付费模型调用之前，先确认以下各项：

- 渲染器登记表；
- 镜像可启动：每次部署做一次健康探针，结果缓存 10 分钟；
- broker、R2 和 Workers AI 可用。

预检失败时，不发出付费模型请求。实际镜像健康探针的容器计算费用计入当前操作预算与账本；成功结果缓存 10 分钟，不以缓存掩盖更换镜像或过期结果。

### 5.5 Chromium 启动参数与沙箱

启动参数固定在控制器代码里，作品不能改：

```
--no-first-run --disable-background-networking
--disable-component-update --disable-sync --disable-extensions --disable-default-apps
--mute-audio --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none
--disable-lcd-text --disable-skia-runtime-opts --disable-partial-raster
--use-angle=swiftshader --enable-unsafe-swiftshader
--js-flags=--max-old-space-size=2048
```

- **不使用 `--deterministic-mode`**：它会打开 BeginFrame 控制，帧、rAF 和截图只能由 `HeadlessExperimental.beginFrame` 推进，与本方案的截图和绘制等待方式不兼容。
- **Chromium 沙箱必须开启**。
  - 2026-10-22 探针：`chrome-headless-shell 151.0.7922.34`、standard-3、断网、3 个新实例、内核 `6.18.54-cloudflare-microvm`，3 次均为 SANDBOX_FULL：
    - 渲染进程有 seccomp-BPF（`Seccomp: 2`）；
    - 有嵌套 PID 命名空间（`NSpid` 3 层）；
    - 有独立 user 命名空间（`uid_map` 为 `10001 10001 1`）。
  - 关闭沙箱的对照组三项都没有。
- **控制器与 Chromium 用不同的用户**：
  - 控制器为 uid 10001，Chromium 为 uid 10002。
  - 入口进程以 root 启动，只做两件事：以 uid 10001 运行控制器，以 uid 10002 运行 Chromium 启动器。之后入口进程只转发信号，不保留任何 capability。
  - 这样即使渲染进程逃出沙箱，也读不到控制器的内存和环境。
  - G1 验证分离 uid 下仍为 SANDBOX_FULL。
- **启动自检**：控制器在每次启动后、加载作品前，检查全部 `--type=renderer` 进程。Chrome 会改写进程标题，参数可能以空格而不是 NUL 分隔。
  - 检查项：seccomp 为 2；`NSpid` 多于一层；`uid_map` 与 browser 进程不同；进程 uid 为 10002。
  - 任一不满足即 `RENDER_SANDBOX_UNAVAILABLE`。这是平台错误，**不得降级为无沙箱**，也不调用模型。
- **页面 CSP**：

  ```
  default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:; font-src 'self'; media-src 'none'; connect-src 'none'; worker-src 'none'
  ```

  - 允许内联脚本，因为作品代码本来就整体不可信；CSP 在这里的作用是禁网和禁 eval，不是区分脚本来源。
  - 预览端额外允许 `media-src 'self'`，用于代理 MP4。

### 5.6 确定性：运行时约束加接缝检查

按负责人 2026-10-22 的决定（D4），只检查用户看得见的问题。

- **运行时约束**：
  - 照常执行第 4.5 节的虚拟时钟、`random-seq-v1`、计时器禁用和静默 seek。
  - Q0 的 `random`、`clock`、`raf`、`interval` 规则提示导演改写。
  - 积木经黄金帧测试保证是时间的纯函数，接缝问题主要来自自写镜头。
- **接缝检查**：对每个接缝 `a`，比较两张 PNG：上一段顺序渲染得到的末帧 `a-1`，和下一段冷启动渲染的重叠帧 `a-1`。
  - 摘要相同：通过。
  - 摘要不同：做容差比对，要求逐通道最大差 ≤ 2、差异像素 ≤ 0.1%。
    - 这是常态而不是例外：2026-10-22 实测，`kinetic-type` 冷启动帧与顺序渲染帧的摘要从不相同，差异都是最大 1 个色阶、0.003–0.010% 像素的抗锯齿噪声，预渲染若干帧也不能消除；3D 模板实测则完全相同。
    - 通过时记录 `seamTolerance:true` 和两段的 `cpuFlagsHash`。
    - 不通过判为 `RENDER_SEAM_BLOCK`。这是作品错误，说明作品有历史依赖；连同两张 PNG 和所在镜头返回导演。
- **不再做**：
  - 独立复核实例、随机抽帧乱序复核、按 CPU 特性分类的判定、旧镜像重渲染冻结快照；
  - 段内的历史依赖：段内本来就是顺序渲染，和上游 `om render` 一致。
- **预览与成片**：只要求"看起来一致"。QA 和交付只以成片为准。

接缝检查不需要额外实例，每段只多渲染一帧，成本可以忽略。

### 5.7 增量渲染（改稿与准备）

- **分段键**：`H(runtimeVersion, rendererRelease, aspectId, renderProfile, 段区间, 该区间内活跃镜头的规格与代码摘要, 全局风格与音频摘要, 资源与字体摘要)`。
- **复用规则**：
  - 改稿后只重渲键变化的段，其余段复用已通过接缝检查的 `shard.h264`。
  - 复用段与新段之间照常做接缝检查。
  - 自写镜头是不可信代码，可能读取其他镜头的状态。所以复用段在拼接前，额外冷渲染首尾两帧核对摘要（不一致时按第 5.6 节的容差比对）；仍不一致就放弃复用，整段重渲。
- 被候选引用的分段保留到候选过期（第 9.4 节）。

---

## 6. 导演流水线

### 6.1 形态

- **一个操作一个工作流**：每个操作（创作、改稿、准备、变体）是一个 `OperationWorkflow` 实例，实例 ID 等于 operationId，由 D1 outbox 派发（第 9.6 节）。
  - 每个阶段是一组 `step.do`。
  - 等待用户（方向选择、事实确认）用 `step.waitForEvent`；等待渲染用"启动任务 + `waitForEvent`"。
- **`OperationDO`**（每个操作一个）：
  - 持有本操作的 studio 实例，执行 still/check 工具；
  - 用可休眠的 WebSocket 向 Studio 推送进度和关键帧；
  - 不再实现自己的步进机。
- **记账**：每次模型调用之前，按 PRD 14 §6 原子预留最坏费用，结束后按 usage 结算。
  - 模型调用 step 的平台自动重试设为 0。失败后是否重试由流水线逻辑决定，避免同一次付费调用被平台自动重放；每次 attempt 单独记账。
  - 部署或运行时重启（约每天 1–2 次）会中断进行中的调用。已发出的调用按未知用量保留最坏值，直到对账。
- **模型接入**：两种适配器，换供应商只改配置、不改代码（负责人 2026-10-23 要求，配置见第 6.12 节）：
  - `openai-compatible`：OpenAI 兼容的 Chat Completions 接口（`POST {baseUrl}/chat/completions`），`baseUrl`、密钥和模型名都来自配置，可接任何兼容此接口的服务。
  - `anthropic`：Claude Messages API。
  - 两者共用一个接口：消息与图片、函数工具、结构化输出、流式、token 预估、预留、usage 结算、未知用量保留最坏值。导演各步骤只认这个接口和第 6.11 节的步骤绑定，不认具体供应商。
  - 各供应商能力不同，按模型登记的能力降级，不写死某一家的特性：

    | 能力 | `anthropic` | `openai-compatible` | 模型不支持时 |
    | --- | --- | --- | --- |
    | 工具调用 | `tools` | `tools`（function） | 不能绑定到需要工具的步骤 |
    | 结构化输出 | `output_config.format` 或 `strict` 工具 | `response_format`（`json_schema`） | 用工具参数输出，本地校验，不合格时把错误结构化返回并重试一次 |
    | 推理强度 | `output_config.effort` | `reasoning_effort` | 忽略 |
    | 看图 | base64 图片块 | `image_url`（data URL） | 不能绑定到需要看图的步骤 |
    | 提示缓存 | 显式 `cache_control`（1 小时） | 服务的自动前缀缓存 | 只靠前缀稳定 |
    | 拒答 | `stop_reason: "refusal"` | `finish_reason: "content_filter"` | 统一为 `MODEL_REFUSED`，照常记账 |

  - 无论供应商是否保证结构化输出，所有模型输出都在本地按 Schema 校验后才使用。
  - 不假定任何供应商支持强制 `tool_choice`。Claude 的其他约束（Opus 5.5、Sonnet 5.5 不能关闭思考等）以实施时 Anthropic 的文档为准。
- **缓存**：
  - 方法包、积木目录和工具定义组成静态前缀，放在最前且字节稳定。`anthropic` 用 1 小时显式缓存；`openai-compatible` 依赖服务的自动前缀缓存。
  - 绑定到同一模型的步骤用同一份工具列表和静态前缀，步骤说明放在前缀之后，这样可以共享缓存。
  - 缓存命中的 token（`cache_read_input_tokens` 或 `prompt_tokens_details.cached_tokens`）进入成本事件；模型登记为支持缓存、重复前缀的命中却为 0 时告警。
- **编辑自写镜头的工具**：两种适配器都用同一个自定义函数工具 `edit_file`，语义与 Anthropic 文本编辑工具相同（view、create、str_replace、insert）。
  - 在 R2 工作区上实现，路径限定在 `scenes/<id>/`。
  - 不再整文件重写：输出 token 是最贵的计价项。
  - `anthropic` 适配器可以把它映射到 Anthropic 定义的 `text_editor_20250728`，由评测决定是否开启。

### 6.2 阶段 A：理解

- **模型**：事实整理用步骤绑定 `facts`（纯文本）；素材理解用 `assets`（看图）。见第 6.11 节。S1 验证 `assets` 所绑模型的看图质量，不达标时换绑更强的模型。
- **事实整理**：从用户确认的事实和输入中整理出可用卖点、受众、CTA 和缺失项。缺失的不补造（PRD 13 §3）。
- **素材理解**：每个已获权利的素材做一次，按 sha256 加提示版本缓存（`asset-insight.schema.json`）。
  - 内容：描述、关键区域框（按钮、价格、图表等）、主色、适合的积木；
  - 图中文字只作内容，不作指令；
  - 录屏另附关键时刻。
- **工作区经验**：用户启用时读取（PRD 13 §8）。
- **输出**：结构化的 `ProjectBrief`，供后续阶段使用。

### 6.3 阶段 B：方向

- **模型**：步骤绑定 `directions`，一次结构化调用（纯文本；素材以阶段 A 的文字摘要提供）。
- **3 张方向卡**（Fit / Amplify / Unexpected），字段按上游 director §4：
  - 视觉语言；
  - 色板：每个颜色写明来源；
  - logline；
  - 感受：路线、BPM、每小节事件数；
  - 声音、风险；
  - 各自的风格 tokens 和镜头骨架：3–8 个镜头的积木选择和关键文案。

  至少一个方向使用纵深（`ui-journey` 或 3D 积木）。
- **关键帧**：
  - 每个方向用积木渲染 1 张英雄帧，在 studio 实例上以主画幅渲染；
  - 并排生成色板图，对应上游 `om swatch`。
- S1 的 B 只输出精简卡和骨架；可信宿主按卡片色板/纵深、原事实及真实素材生成静音积木 hero，冻结后再由 studio 截图。完整影片只在 C 生成，避免一次生成三份完整规格挤占输出上限。历史已有的完整 keyframeFilm 仍校验后复用。
- **展示前审核**：方向卡和关键帧先过输出审核（PRD 13 §3），然后进入 `waitForEvent('direction_selected')`。
- **用户选择**：可以按层混合，构图、配色、节奏、声音各自取自不同方向。
- 直接制作模式跳过本阶段。

### 6.4 阶段 C：规格

- **模型**：步骤绑定 `spec`（全流程中唯一用最强模型的步骤）。
- **输入**：
  - 所选方向、`ProjectBrief`、素材理解；
  - 积木目录：每个积木的参数 Schema 和示意图摘要；
  - 音乐的拍点网格：由所选音乐确定性计算；
  - 方法包中的节奏规则。
- **输出**：完整的 `film.json`，按方法包规则编排：
  - 3 秒（90 帧）内有起点；
  - 在全片 30–60% 处安排一段能量高点；
  - 英雄镜头落在最强的音乐点上；
  - 除计划停顿外，不连续两小节以上没有新事件；
  - 每个转场写明视线如何衔接。
- **自写镜头**：只用于积木无法表达的标志性镜头，每片一般 1–2 个，并写清 `brief`。
- **校验**（第 4.2 节）：失败时把错误结构化返回，最多修正 2 次。
  - 当前 C 已对完整响应的 JSON、Schema 与跨字段错误保存持久反馈，换新 callId 纠正；无效响应照常计费但不缓存/渲染。网络、截断和未知消费不进入纠正循环，原 3 次/阶段费用/绝对期限不变。
  - C/E 的提示 Schema 枚举当前 `id@major` 积木引用与已确认的事实 ID，并明确 CTA、数值、引语等槽位的事实绑定规则；积木实现的补丁版本不能写成 FilmSpec 引用。执行准入仍以完整 Schema 与跨字段校验为准。
- **通过后**：
  1. 生成积木版草稿，自写镜头先用简报卡占位。
  2. 审核文字槽位后，草稿即可在浏览器播放。
  3. 同时启动声音合成。

### 6.5 阶段 D：自写镜头

- **模型**：步骤绑定 `scenes`（看图、工具）。S2 用评测集比较候选绑定，按每个可用结果的费用选定。
- **并行**：每个自写镜头一个子流程，并行执行。上下文只有：
  - 本镜头的 brief；
  - 相邻镜头的首尾帧；
  - 风格 tokens；
  - 相关槽位和素材理解；
  - 方法包的镜头级子集。
- **工具**：文本编辑工具、`still`、`check`。
- **上限**：每个镜头最多 12 次模型调用，费用见第 6.11 节。
- **完成判据**：
  - Q0 无 BLOCK；
  - 镜头首尾与相邻镜头的衔接帧通过；
  - Q1 无 BLOCK。

  完成后替换草稿中的占位。

### 6.6 阶段 E：整片 review

- **模型**：步骤绑定 `review`（看图、工具）。
- **`review` 工具**一次返回：
  - 0.5 倍全片的每秒缩略图拼图，每个画幅一张；
  - Q0–Q2 的发现，结构化并按严重度排序；
  - 运动与能量曲线；
  - 声音落点表。
- **修改方式**：只用 `spec_patch`（JSON Patch，校验后应用）和对自写镜头的文本编辑。
- **轮数**：最多 2 轮（`maxInternalRepairs`）。

当前 S1 将已捕获的全部阅读停留 PNG 按画幅拼图，并绑定格子/source/frame 与实际成片引用，不再只截前 12/16 张。每秒图、完整 Q1/Q2 发现与运动/声音曲线仍按本节目标接齐；实际范围见[实施状态](../implementation-status.md)。

### 6.7 阶段 F：冷审与提交

- **冷审**：步骤绑定 `coldReview`（看图；宜与导演用不同的模型家族），独立上下文，不带导演的对话。
  - 只给以下材料：
    - 需求；
    - 成片的每秒缩略图拼图和关键帧；
    - 所选方向；
    - `film.json` 的 treatment；
    - 上屏文字出处表；
    - 需核实的事实。
  - 必须回答两个问题：从第几秒开始走神？换成别的产品名是否一样成立？
  - 报告绑定成片摘要。BLOCK 项触发一轮修复，计入 internal_repair。
  - 当前实现中 E/F 共用两次内部修复额度；F 最多触发一次 C 修正，再重走 E、全画幅重渲和第二次 F。未改规格、再次 BLOCK 或额度耗尽则停止，不覆盖已有成片、不重置费用或期限。
- **提交** `submit_candidate(note)`：冻结工作区为候选，触发成片渲染与 QA。`note` 是给用户的改动说明。

### 6.8 工具（`agent-tools.schema.json`）

每次调用都计费并写账本；工具错误以结构化结果返回模型。

| 工具 | 阶段 | 执行位置 | 作用 | 对应上游 |
| --- | --- | --- | --- | --- |
| `brief_context` | A–F | Worker | 题目、已确认事实（带 factId）、受众、目标、片长、获准资源与字体、品牌色、声音选择、已确认转写稿 | SKILL 第 1 步 |
| `asset_insights` | A–F | Worker + R2 | 素材理解（缓存） | `materials.md` |
| `method_recall(topics[], stage)` | B–E | Worker | 按题目和阶段召回方法正文，不整包注入 | references |
| `block_catalog(filter)` | B–E | Worker | 积木参数 Schema 与示意 | templates |
| `submit_directions(cards[3])` | B | Worker | 方向卡，Schema 校验后渲染关键帧 | 三方向 |
| `write_spec(film)`、`spec_patch(ops)` | C、E | Worker | 写入或修补 `film.json`，返回校验结果 | treatment |
| `edit_file` | D、E | Worker + R2 | 编辑 `scenes/<id>/` 下的文件 | 编辑文件 |
| `check(scope)` | D、E | studio 实例 | Q0 静态规则，加指定帧的 Q1 观测 | `om check` |
| `still(frames[], aspect, scale, crop?)` | B–E | studio 实例 | 返回帧图；`crop` 用于 2× 局部放大 | `om still`、`om look` |
| `review()` | E | RenderWorkflow（review 质量） | 第 6.6 节 | `om render` + `om qa` |
| `audio_plan(plan)` | C、E | audio 实例 | 校验并合成 AudioPlan，返回事件表、拍点和响度 | `om sound` |
| `submit_candidate(note)` | F | Worker | 冻结候选 | `om done --note` |

### 6.9 改稿（agent_patch）

1. **一轮的范围**：一轮可以包含多条钉在画面上的评论，上限沿用 `maxCommentsPerRound` 5 条、总计 4,000 code points，只计一次。每条评论携带：
   - 版本、画幅、帧号、坐标；
   - 云端用 CDP 复核过的 `regionId`；
   - 所在镜头和当前值。
2. **分流**：用步骤绑定 `triage`（纯文本）把每条评论归为三类之一：
   - **直接改值**：改文字、颜色、替换素材、改可编辑参数。生成 `spec_patch`，不调导演。涉及事实的文字按 PRD 13 §7 重新确认。
   - **镜头内修改**：只加载该镜头的积木参数或自写镜头文件、评论帧和 2× 局部图、相邻镜头的首尾帧，用阶段 D 的模型修改。
   - **结构或全局修改**：节奏、镜头增删、风格变化。走阶段 C、E 的修补流程，并先向用户展示影响范围（PRD 13 §7）。
3. **修改后**：
   1. 针对评论帧运行 `check` 和 `still`；
   2. 增量渲染（第 5.7 节）并做 QA；
   3. `submit_candidate(note)`，`note` 写明 Agent 对每条评论的理解。
4. **follow-up**：用户回"不太对"时，作为同一线程的 follow-up 处理；是否计次按 05 的产品决定。

### 6.10 准备全部目标与变体

**准备（prepare_targets）**：

- 对缺少成片的画幅，并行做成片渲染，不调用模型。
- 画幅适配由积木保证。只有 Q1 出现 BLOCK 的自写镜头，才启动镜头内修改。
- 修改后的源码，按增量方式重渲所有已准备画幅中受影响的段；分段键不变的画幅保持就绪。

**变体**：

- 对应 PRD 01 的 P1 批量变体。`config/agent-policy.json` 的开关默认关闭，计次规则在 05 定义之后才开放。
- 从同一份 `film.json` 派生：
  - 30 秒剪成 15 秒：按镜头重要度删减，音乐按剪辑点重切；
  - 换开场；
  - 换 CTA。
- 确定性的部分不调用模型；需要改写文案或镜头时，走阶段 C 的修补流程。

### 6.11 预算、限制与 effort

写入 `config/agent-policy.json`。下表为初值，S1、S2 实测后由负责人复核。

每个步骤单独绑定模型。初始绑定由负责人 2026-10-23 指定：能力探针证实 DeepSeek V4.1 Flash 1017 可以看图、调用工具，所以凡它能做的步骤都用它；最关键的一步（规格）用 Claude Opus 5.5。2026-10-24 负责人指明网关 Claude 共用 `MODEL_COMPAT_API_KEY`；按[网关文档](https://api.modelswitch.org/docs)，C 恢复网关 Opus（纯文本），F 改用已验证看图的网关 DeepSeek，与 C 不同家族。官方模型只保留未绑定备用，不再要求添加官方密钥。网关 Claude 的旧视觉失败不撤销；Gemini 3.8 Flash 不再使用（慢、工具参数丢失）。

| 步骤 | 绑定名 | 需要的能力 | 初始模型 | 推理强度 | 调用上限 | 费用上限 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 事实整理 | `facts` | JSON | `deepseek-v4.1-flash-1017` | low | 2（含一次结构纠正） | $0.01 |
| A2 素材理解 | `assets` | 看图、JSON | `deepseek-v4.1-flash-1017` | low | 每个素材 2 次（含一次结构纠正） | $0.04 |
| B 方向 | `directions` | JSON | `deepseek-v4.1-flash-1017` | high | 3 | $0.40 |
| C 规格 | `spec` | JSON、强推理 | `modelswitch/claude-opus-5-5` | high | 3 | $0.40 |
| D 每个自写镜头 | `scenes` | 看图、工具、写代码 | `deepseek-v4.1-flash-1017` | medium | 12 | $0.35 |
| E 整片 review | `review` | 看图、工具 | `deepseek-v4.1-flash-1017` | low（内部候选） | 6 | $0.30 |
| F 冷审 | `coldReview` | 看图、JSON | `modelswitch/deepseek-v4.1-flash-1017` | low（内部候选） | 2 | $0.05 |
| 改稿分流 | `triage` | JSON | `deepseek-v4.1-flash-1017` | low | 1 | $0.01 |

- 步骤绑定只描述能力要求；绑定到哪个供应商的哪个模型由 `config/model-providers.json` 决定（第 6.12 节）。费用上限与供应商无关，换绑后评测集必须仍满足第 1.1 节。
- 2026-10-24 实际 E 在 medium 与 low 请求下均耗尽 8,192 token，尚未完成工具调用；F 曾在 1,024 token 截断。当前内部候选请求 E/F low，E 输出放宽为适配器已有上限 16,384、F 为 8,192，并明确只返回工具/完整 verdict，实际质量仍待评测和负责人复核；不改次数、阶段金额或质量标准。[DeepSeek 官方说明](https://api-docs.deepseek.com/guides/thinking_mode/)将 medium 映射为 high，但网关是否完整转发仍未验证，不据此宣称已测得真实推理强度。
- A/B/E/F 的完整 JSON/工具/契约错误在实际 usage 已结算时可反馈一次纠正，使用新 callId 并保留原始响应/usage；不能丢弃多余字段或补造工具参数后冒充通过。A 的总调用限额包含这次纠正，B/E/F 沿用原总调用上限，全部阶段金额不提高；F 总调用已用尽时不再花 C 的费用尝试无法复审的修复。未知消费、终态截断与传输错误不重发。
- A 的事实/素材 JSON 输出空间为 4,096；响应 Schema 与纠正所需的完整契约同时出现在用户消息，不仅依赖 system 提示。该调整针对 MiniMax 的实际散文回答及 1,024-token 纠正截断，不提高原 $0.01/$0.04 阶段金额。
- B（方向）是创意上影响最大的步骤之一，按"纯文本用 DeepSeek"的原则初始绑到 DeepSeek。S1 评测时与 Opus 5.5 做对照，效果明显落后时换绑。
- D、E 写代码和看整片的质量直接决定成片，DeepSeek 在这两步的效果未经验证。S2 按每个可用结果的费用和负责人评分做对照；只有负责人日后选择直连官方 Sonnet 时才另存 `ANTHROPIC_API_KEY`，不是当前网关路线的前置。
- F 用与写规格 C 的 Opus 不同家族的 DeepSeek，保持独立上下文，不带导演对话。当前只用已实测可看图的线路；网关 Claude 的图片恢复需要真实复测后才能再用于 F。
- 改稿中的镜头内修改用 `scenes`，结构修改沿用 `spec` 和 `review`。

- **墙钟上限**：创作 20 分钟，改稿 8 分钟，准备 8 分钟。
- **阶段上限用尽时**：结构化返回"预算用尽"，流水线按规则降级（例如自写镜头改用最接近的积木），不追加调用。
- **时间期限**：上次评审 P1 的约定仍然有效——`BUDGET` 一词不再用于时间期限（用 `RENDER_DEADLINE`、`FRAME_TIMEOUT`）。
- **单位成本超标时**，按以下顺序优化：
  1. 缓存命中与前缀稳定性；
  2. 减少自写镜头的数量和调用轮数；
  3. 降低推理强度；
  4. 把 `scenes`、`review` 等步骤换绑到更便宜的模型；
  5. 扩充积木的覆盖范围。

### 6.12 模型、价格与预算授权

负责人 tianyu 于 2026-10-22 批准，2026-10-23 修正；2026-10-24 明确继续使用已有 ModelSwitch 密钥调用 Claude。

**模型配置** `config/model-providers.json`（新增，进仓库，不含密钥）。负责人 2026-10-23 要求：默认走 OpenAI 兼容接口，随时可以换供应商，也要能换成 Claude API。换供应商或模型只改这个文件和对应的 Worker secret，不改代码。

当前选定的 OpenAI 兼容服务是模幻空间（ModelSwitch，`https://api.modelswitch.org/v1`）。2026-10-24 已按负责人提供的[文档](https://api.modelswitch.org/docs)核对 `Authorization: Bearer` 与 `/v1/chat/completions`，Claude 同样使用已有 `MODEL_COMPAT_API_KEY`。价格以平台额度标示，[模型页](https://api.modelswitch.org/models)明确"$1 额度 = ¥1"，所以按人民币记录并用登记汇率换算美元；本次 Default 三个现用模型价格与原目录数值相同。API 密钥必须固定在 Default，不能选 Auto（按实际路由分组计费，价格不固定）。

当前完整价格、能力与步骤绑定以 [`config/model-providers.json`](../../config/model-providers.json) 为准，不另复制一份会漂移的目录。

- 价格单位为每百万 token 的整数 micros，币种取供应商的 `currency`；按登记汇率换算为 USD micros（向上取整）。费用回执同时保存原币金额、汇率、价格与 `catalogVersion`。
- **能力以最新实测为准**（[四轮原始证据](../evidence/2026-10-23-model-probe/README.md)）：网关 Claude 的工具调用在第三、四轮已恢复，但两轮均丢图，视觉不可用；Opus 小请求的输入计数最高约 11 万 token。第一、二轮“工具不可用、视觉可用”只作历史记录。
- DeepSeek V4.1 Flash 的看图、工具、缓存及流式已测；`reasoning_effort` 仅确认接口接受，未证明真实推理强度改变。网关均未遵守所测 `json_schema`，须本地完整校验；Gemini 因延迟、参数丢失及后续 502 不再使用。
- 当前 C 走网关 Opus，A/B/E/F 等走网关 DeepSeek，共用已绑定的 `MODEL_COMPAT_API_KEY`。官方备用未绑定且 `verified:false`；当前全部步骤仍在首个付费请求前检查所需密钥、实测能力和历史费用，不消费一半后才发现不可用。
- 原未计入统一预算的独立探针 Actions 已停用。后续换绑的真实探针也必须走共享预算预留/结算；当前不从归档脚本继续调用。
- **换供应商**：
  1. 在 `providers` 填 `baseUrl`、币种和汇率，用 `wrangler secret put` 写入密钥；
  2. 在 `models` 登记模型、价格和实测能力；
  3. 在授权文件中加入这些模型，然后改 `steps` 的绑定；
  4. 跑评测集（第 12.5 节），第 1.1 节的单位成本和第 1.3 节的效果不回退才算换绑完成。
- **校验**（`check-production-contracts.mjs` 与运行时都做）：
  - 每个步骤绑定的模型都已登记、能力声明满足该步骤（第 6.11 节）；关闭执行时可保存待验证绑定，启用和实际调用必须已验证；
  - 价格字段齐全；没有价格的模型不能被绑定，也不能被调用；
  - 绑定的模型在授权文件中；
  - 模型绑定、价格或能力目录改动更新 `catalogVersion`，成本事件记录它；临时历史风险放行不重开目录或授权身份。
- **计价**：
  - `anthropic`：普通输入、5 分钟缓存写、1 小时缓存写、缓存读和输出五种计价，以返回的 usage 为准。
  - `openai-compatible`：`prompt_tokens` 中扣除 `prompt_tokens_details.cached_tokens` 的部分按输入价，缓存命中部分按 `cacheRead`（未登记时按输入价），`completion_tokens`（含推理 token）按输出价。服务另收缓存写或分档计价时，在模型登记中写明并按它计算。
  - 每月用平台的"使用统计"与账本对账一次，差异超过 5% 时排查计价规则。
  - usage 缺失或字段不全时保留最坏预留：全部输入按普通输入价计，输出按上限计。
  - 现有 `usageCost` 是按单一供应商语义写的，不迁入。
- **模幻空间的风险**（2026-10-23 查看）：
  - 可用性：状态页显示 26 个模型中 20 个可用、可用率 73.69%，Claude 5.5 的健康检查耗时 141 秒。第 1.2 节的时间目标要在它上面实测。
  - 它是第三方转售网关，价格约为官方的一成；数据保留条款未公开，也无法核实背后的模型。客户素材、文案和画面会经过它。负责人 2026-10-23 决定接受用它处理客户数据；面向客户使用前，仍须按 04 和 09 在隐私政策中披露这条数据流（服务方、传输内容、保留未知）。
  - 因此 `anthropic` 适配器和官方价格一直保留，作为随时可切换的备用线路。
- **数据处理**：新增任何供应商前，都按 04 和 09 补充数据流与隐私披露。
- 2026-10-23 的修正：Sonnet 5.5 的官方缓存读价格是 $0.20/M（v3.0 写成 $0.10/M）。原 `config/model-prices.json` 并入本文件，不再单独存在。

**止损预算**：写入 `config/agent-policy.json` 的 `cost` 段，单位 USD micros。

| 字段 | 值 |
| --- | --- |
| `catalogVersion` | `"models-2026-10-24"` |
| `maxMicrosPerCreativeRun` | 10000000（$10） |
| `maxMicrosPerPatch` | 3000000（$3） |
| `maxMicrosPerTargetPreparation` | 3000000（$3） |
| `maxMicrosPerQualityReview` | 1000000（$1） |
| `dailySoftAlertMicros` | 50000000（$50） |
| `maxDailyFreeMicros` | 0（内测期不开放免费用户） |
| `maxMicrosPerUserWindow` | 30000000（$30） |
| `maxMicrosPerProjectWindow` | 20000000（$20） |

- 这些是止损上限，设计目标见第 1.1 节。其余仍为 `null` 的费用字段保持 `null`，对应功能保持关闭。
- `maxDailyFreeMicros: 0` 过不了现有的 `hasCalibratedCostLimits` 检查。S0 改写校验，让"0 = 明确关闭"成为合法值。

**研究授权** `config/model-authorization.json`：新增并进仓库，不含任何密钥。

```json
{
  "purposes": ["calibration", "evaluation"],
  "models": ["modelswitch/deepseek-v4.1-flash-1017", "modelswitch/claude-sonnet-5-5",
             "modelswitch/claude-opus-5-5", "anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5"],
  "catalogVersion": "models-2026-10-24",
  "approvedBy": "tianyu (tianyu@tinkerland.ai)",
  "approvedAt": "2026-10-22T18:12:00+08:00",
  "expiresAt": "2026-12-31T23:59:59+08:00",
  "maxUsdMicros": 300000000
}
```

- 模幻空间的模型由负责人 2026-10-23 指定加入（Gemini 3.8 Flash 经探针后不再使用）。
- 用途名随里程碑调整：原来的 `m0b_calibration`、`m0a_comparison` 对应切片 S1–S3 的标定和第 12.5 节的评测。额度、期限和批准人不变；模型改用 `供应商/模型` 的形式登记。
- 换到 OpenAI 兼容服务时，负责人把对应的 `供应商/模型` 加入 `models`；`maxUsdMicros` 按全部供应商累计。
- **每次付费调用前同时检查**：
  - 授权未过期；
  - 累计实际与未结算费用，加上本次预留，不超过 `maxUsdMicros`；
  - 模型在授权列表中；
  - 模型配置版本一致，且该模型已登记价格。

  任一项不满足即停止，不调用模型。
- 累计额由独立共享 D1 `MODEL_LEDGER` 原子准入：历史确认额 + 各环境的实际/未结预留；本地 `DB` 继续执行操作/阶段/次数门槛。授权身份不随价格目录或绑定变化重置。
- 四轮探针的 128 次请求已有不可变清单；114 次有 usage/目录价，估算共 255,521 usd_micros，另 14 次未知。负责人暂无完整供应商统计，历史总额仍未确认。2026-10-24 负责人要求「放开一点预算门槛，继续 S1」：在原授权内暂留 $5 历史风险预留，允许 staging 新增模型实际/未知预留累计最多 $10，至 2026-10-31 上海时间结束；配置见 `unreconciledHistoryAllowance`。原清单、确认空值、$300 授权和阶段/次数/期限不变，不把风险预留当成已对账金额。无有效放行时仍拒绝未确认历史的新请求。
- 原始模型响应先写私有 R2，再解析/结算，保存原币、汇率与价格。已保存响应可补账而不重发；响应丢失或 usage 未知时保留预留，不能通过重启、换操作或重部署清零。入口与确认契约见 [cloud README](../../apps/cloud/README.md#研究模型共用一份预算)。
- `agent-policy.json` 的 `enabled` 仍为 `false`：授权只开放负责人发起的研究调用，不开放给其他用户。
- 本方案不做登录，所以预发布环境用 Cloudflare Access 保护 `api` 路由，只允许负责人的身份。OperationWorkflow 和 OperationDO 以 Access 签发、并经 Worker 校验的身份断言识别请求者，不信任请求体里自报的身份。正式登录按 12 接入后改用会话身份。

**新建凭据由负责人在供应商控制台完成**；既有凭据沿批准渠道复用，执行 Agent 不读取或索取其值：

1. 为预发布与生产分别创建 API Key；供应商支持时设月度消费上限（例如 $350），作为授权总额之外的最后一道兜底，并设置提醒。用 Claude 时，在 Claude Console 新建 Workspace `promobento-staging` / `promobento-prod` 再建 Key。
2. 网关（包括其中的 Claude）写 `MODEL_COMPAT_API_KEY`；只有直连 Anthropic 才写 `ANTHROPIC_API_KEY`。现有 Actions 网关密钥已通过[专用维护工作流](../../.github/workflows/model-runtime-key.yml)经 stdin 绑定到 staging Worker，不要求负责人重复添加。

---

## 7. QA

| 层 | 检查 | 实现 | 级别 |
| --- | --- | --- | --- |
| Q0 静态 | **规格层**：`film.json` 校验（第 4.2 节）。**自写镜头源码**：取上游 `check.js` 中不需要执行页面的规则——`random`、`clock`、`raf`（只允许经 `OM.clock`）、`interval`、`infinite-repeat`、`css-transition`、`layout-motion`、`missing-file`、`outside-project`、`duplicate-id`、`font-not-shipped`、`script-syntax`、`placeholder`；新增 `third-party-likeness`、禁用 API（第 4.4 节）、`direct-text`（绕过 `ctx.text` 写文字）。**级别**：缺文件、越出工程、语法错误、禁用 API、第三方形象为 BLOCK，其余为 REVIEW。`random`、`clock`、`raf`、`interval`、`infinite-repeat`、`css-transition` 在上游是警告，这里定为 REVIEW，对应的运行时调用在渲染阶段由 shim 直接报错 | `apps/render-container/src/check/**`，基于 AST（acorn）和 HTML/CSS 解析，不执行源码 | BLOCK / REVIEW |
| Q1 观测 | **观测帧**：关键帧、每个镜头的首尾、每秒 1 帧。**CDP 读取**：`DOM.getBoxModel` 得到文字框；`CSS.getPlatformFontsForNode` 得到实际字体，检测回退和缺字；对比度（WCAG 4.5:1，大字 3:1）；文字是否越出安全区。**报告项**：`text-cut`、`text-clipped`、`text-covered`、`text-overlap`、`blank-frame`、`low-contrast`、`unbound-text`；可点区域（供点选）。作者可用上游的 `occlusion` 豁免属性声明有意的遮挡 | `apps/render-container/src/observe/**`，在分段和 studio 实例内对实际帧执行 | BLOCK / REVIEW |
| Q2 运动 | 迁入的诊断：单帧突变、硬切、静止段、逐秒运动曲线。另加 v0.2.0 的两条，与上游一样只对 ≥ 6 秒的片子生效：开头平淡（前 5 秒最强的一秒 < 1.5，或有 ≥ 1.5 秒的静止）；全片几乎不动（均值 < 0.6 且每分钟切换 < 3 次）。阈值沿用上游（由作者签字认可的 15 部片子定出），再用评测集复标 | `apps/render-container/src/diagnostics/**` | REVIEW（导演必须处理或写明理由） |
| Q2 声音 | 响度按预设的 `loudnessTarget`（现有 6 个预设都为 −14 LUFS），真峰值 ≤ −1 dBTP；音画落点 ±1 帧。有旁白时，音乐按词压低约 10 dB，并在 2 kHz 附近让出约 5 dB。整个混音都要归一到目标响度：上游代码中有旁白的混音不做整体归一（读代码所得，未实测），这一点不照搬 | `packages/audio` | BLOCK / REVIEW |
| Q2 Treatment | 对照 `film.json` 与实际运动曲线：3 秒内有起点；30–60% 处有能量高点；除计划停顿外，不连续两小节以上没有新事件；每个转场都写明视线衔接 | `apps/cloud/src/director/treatment-check.ts` | REVIEW |
| Q2 静音可读 | 信息流目标：核心卖点和 CTA 有上屏文字；有旁白时必须有 `captions` 层，内容来自已确认的转写稿 | 规格加 Q1 | BLOCK |
| Q2 事实 | 槽位里的商业主张绑定已确认的 factId（PRD 14 §8）；`unbound-text` 中含数字、货币或百分比的即 BLOCK | 规格加 Q1 | BLOCK |
| Q3a 冷审 | 第 6.7 节 | `apps/cloud/src/director/cold-review.ts`，计入 internal_repair 预算 | BLOCK 项触发一轮修复 |
| Q3b 人工 | 用户或负责人按 05 和 14 的审核回执 | 审核回执（语义沿用原本地实现，存入 D1） | — |

- **QA 自检**：`tests/qa-mutants/` 放故意破坏的作品，每条规则都必须检出对应样例，否则判为 CI 失败。样例包括：
  - 缺字、越界、定时器、网络请求；
  - 历史依赖（接缝）、开头静止；
  - 未绑定事实的价格、绕过槽位的文字；
  - 超长文案（积木应报 `TEXT_FIT_FAILED`）。
- **输出审核**：方向卡、草稿、候选在展示前，按 PRD 13 §3 与 `config/output-safety-sampling.json` 审核。
  - 积木版草稿只需审核文字槽位：素材已准入，积木是可信代码。
  - 含自写镜头的版本按抽帧配置审核。

---

## 8. 素材与声音

### 8.1 素材（AssetWorkflow、AssetDO 与资产实例）

- **先核验权利，再做任何处理**（AGENTS：素材第一次处理前就核验许可，包含免费预览）。
  - 上传只校验大小和 MIME。
  - 解码、转写、送模型等处理，都在权利确认之后进行。
  - v3.0 先在 `quarantine/` 里处理、再确认权利，顺序有误。
- **上传**：R2 预签名 PUT 到 `quarantine/`，按 `config/input-capabilities.json` 限定大小和 MIME。
- **网址抓取**（PRD 01 的 P1"受控网址提取"）：
  - `input-capabilities.json` 的 `fetch` 默认为 false，实现后由负责人按 PRD 开放。
  - Browser Run 打开用户给出的产品网址，抓取以下内容，写入 `quarantine/`，状态为 `pending_rights`：
    - 1920×1080 与 1080×1920 两种视口的截图；
    - Logo：SVG，或最大的 favicon 与 og:image；
    - 计算样式里的主色和字体名称。
  - SSRF 防护：只允许公网 http(s)，禁止私网、链路本地和元数据地址，限制重定向次数并逐跳复核。
  - 网页上的文字只当内容。
  - 检查抓取到的正文是否有效：有的站点在无头浏览器里前端报错，返回 200 却没有正文（2026-10-23 实测 deepseek.com）。无效时提示用户上传截图或粘贴文字，不把报错页当作素材或事实来源。
- **权利确认**：沿用项目 `rights` 结构。上线前由负责人确认，上线后按 09 由用户提供依据。
  - 确认后，素材从 `quarantine/` 移入 `res/<sha256>` 并登记进 `resources`。
  - 字体的 `projectApproved` 由此产生。
- **处理**（资产实例，断网）：
  - `probe`：用 ffprobe 检查 VFR、HDR（拒绝 HDR）、时长和编码。
  - `normalize`：录屏转为 CFR 30 fps 的 H.264 母版，保留原始 PTS 映射。
  - `image`：图片转为 sRGB；长边超过 3840 像素时缩到 3840。
  - `proxy`：0.5 倍的预览代理 MP4，供预览端的视频镜头使用。
  - `extract`：按 PTS 抽帧成无损 WebP 序列，附索引，供渲染端使用。
  - `fontcheck`：
    - 校验 OFL 字体；
    - 客户字体（PRD 01 的 P1"经许可审核的客户字体上传"，`customFontUpload` 默认 false）：核对授权证据，检查 cmap 覆盖，并子集化。
  - `tts`（PRD P1，`input-capabilities.json` 增加 `tts.enabled`，默认 false）：
    - 用 Kokoro（Apache-2.0，模型按摘要下载）生成旁白；
    - 上游注明 Kokoro 读中文没有声调、难以听懂，所以不对中文开放；
    - 合成后用 ASR 取得逐词时间，不用插值。
- **ASR**：用 Workers AI 的 `@cf/openai/whisper-large-v3-turbo`，带逐词时间戳，约 $0.0005/分钟。把 brief 中已确认的产品名和术语作为 `initial_prompt` 传入。2026-10-23 用合成口播实测（[前置探针](../evidence/2026-10-23-pre-s1-probe/README.md)）：英文 WER 0；中文 CER 0.09–0.12、日文 CER 0.08–0.19，残余错误主要是同音字和 N2 这类缩写。`deepgram/nova-3` 不支持中文，不作备选。
  - 生成的转写稿状态为 `pending_confirmation`。用户确认后（流程同事实确认），才能用于字幕、`OM.cue` 锚点和事实绑定。
  - 超过 1.2 秒的词标记为待复核。
  - 这条数据流按 09 和 04 补充披露。
- **素材理解**：见第 6.2 节，结果存 `insights/<sha256>/<promptVersion>.json`。
- **解码预算**：按素材的实际尺寸和帧数计算，取消固定的 320×180 上限。

### 8.2 声音

- **AudioPlan 的生成**：由可信端确定性生成，不经模型。来源包括：
  - `film.json` 的 `audio` 部分；
  - 积木事件；
  - 自写镜头声明的 `OM.sfx`、`OM.music` 和 `<script type="text/vnd.abc" id="om-score">`：在 check 阶段用一次专用的 0 帧观测读出。

  页面内的 `AudioContext` 一律禁用。
- **音乐来源**（第 4.2 节的 `music` 字段）：
  - `procedural`：13 种程序风格；
  - `score`：ABC 作曲，用上游 composer 的方言与扩展；
  - `upload`：用户提供的授权配乐，拍点用 beats 分析；
  - `none`。
- **音效**：`sfx: "auto"` 时，按积木事件和转场自动对位（上游每种 cue 都有默认音效）。共 23 种合成音效、5 种音色组；大音效出现时音乐让位。
- **旁白**：来自用户上传或 TTS。转写稿确认后生成 `captions` 层；混音按第 7 节 Q2 声音执行。
- **片长**：精确到 N/30 秒。
  - 音乐不向上取整到整小节，余音在片长内收尾。
  - 时序变化后的重算走无模型路径。
- **采样许可**：
  - 只用 CC0 子集；上游采样包里 CC-BY 的 Salamander 钢琴和 Wurlitzer 不用。每个事件都带 `licenseRef`。
  - 自由 ABC 乐谱需要单独的音源权利记录。`audio-plan.schema.json` 固定源身份和事件；`audio-admission.schema.json` 单独固定内部准入目录与负责人按实际谱文本、片长批准的 requestHash，不能由模型自报清权。当前导演接入范围见[内部音乐入口](../../apps/cloud/README.md#导演使用已批准的音乐)。

### 8.3 CC0 采样包（不采购曲库）

负责人 2026-10-23 决定不采购曲库。现有代码和上游都不带成品配乐，配乐全部由程序生成；质量差距主要在真实乐器采样，所以改为补齐 CC0 采样。

- **来源**：沿用上游 `cli/lib/samples-build.js` 按固定提交拉取的 CC0 库：
  - VSCO 2 CE、VCSL（Versilian Studios）：弦乐声部、圆号、竖琴、木琴等；
  - Karoryfer：二胡、身体打击乐、Unruly Drums、Big Rusty Drums；
  - FreePats：合成打击乐、西班牙古典吉他、指弹贝斯。
- **排除**：上游的 Salamander 三角钢琴和 Greg Sullivan Wurlitzer 是 CC-BY-3.0，需要署名，不用。先在上述 CC0 库中找钢琴替代；找不到时用合成钢琴，并在试听时单独评估。
- **构建**：在镜像构建时按固定提交下载、核对摘要、裁剪并重采样（上游做法），清单与每个文件的来源、许可、摘要写进 `packages/audio` 的采样清单；每个音频事件带 `licenseRef`。Versilian 要求不单独转售采样，只用于成片渲染不受影响。
- **验收**：S1 用每种程序风格各渲染一段 30 秒样曲，由负责人按正常速度试听。达不到要求的风格调整配器或停用；整体仍不满意时由负责人重新决定是否采购。

---

## 9. Cloudflare 部署

### 9.1 Containers

以下按 2026-10-23 的 Cloudflare 官方文档核对。

**应用与调度策略**：

- 两个 Container 应用 `render`、`asset`，都用 `scheduling_policy: "durable_object"`（public beta）。
  - 策略创建后不可修改，改策略等于新建应用。
  - 该策略要求 DO 使用 SQLite 存储。
- 退路：该策略若不可用，按实施当天的文档选择替代方案。`Container` 类只维护到 2026-12-31，不能作为长期退路。

**不使用 `@cloudflare/containers` 的 `Container` 类**：

- 迁移指南写明，该类不支持 `durable_object` 策略；`Container` 类和旧的 `Sandbox` 类到 2026-12-31 只做维护。
- DO 直接使用 `this.ctx.container`，具体签名以实施当天的 [DO 容器 API](https://developers.cloudflare.com/containers/api/durable-object-container/) 为准：
  - **启动**：`start({ image, instance, enableInternet: false, entrypoint?, containerSnapshot?, labels })`。
    - 只要传入选项，`enableInternet` 就是必填项。
    - `start()` 在容器就绪前返回；控制器的 `/ready` 探测通过才算启动完成，这段时间计入第 5.3 节的冷启动期限。
  - **出站**：用 `interceptOutboundHttp`，把发往 `broker.internal` 的 HTTP 请求转给 `BrokerEntrypoint`。
    - 不拦截 HTTPS，不设兜底放行。
    - 断网时，其他端口被阻断，DNS 只解析被拦截的名字。
    - 拦截在实例运行期间不能撤销，每个实例最多 128 条。
  - **生命周期**：用 `setInactivityTimeout()`。shard 设为期限加 60 秒，studio 设为 10 分钟。任务完成后由 DO 主动停止实例，并确认状态。
  - **不要让 `monitor()` 一直挂着**：附录 C 实测挂着 `monitor()` 的实例空闲 150 秒后仍在运行（无论是否设了 `setInactivityTimeout`），不挂时 150 秒内停止。DO 只在有任务时等待 `monitor()`，并以显式 `destroy()` 为准（实测 0.2–0.5 秒停止）。
  - **部署**：上一个同名容器应用还在 provisioning 时，`wrangler deploy` 会报设置未完全应用；CI 部署前确认应用状态，失败时重试。
- **v3.0 的写法作废**：v3.0 第 9.1 节在该策略下用的 `static { this.outboundByHost = … }`、`sleepAfter`、`ContainerProxy` 都属于 `Container` 类。`ctx.container` 的写法已于 2026-10-23 实测通过（附录 C）。

**规格**（[限额](https://developers.cloudflare.com/containers/platform-details/limits/)）：

| 类型 | vCPU | 内存 | 磁盘 |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |
| 自定义 | 1–4 | 每 vCPU 至少 3 GiB，最多 12 GiB | 最多 20 GB |

- 该策略不接受 `basic`。
- v3.0 第 0 节把 standard-1 写成"1 核、4.2 GiB"，那是 VM 内看到的值。配额和计费以上表为准，`-threads` 和期限都按配额计算。

**各模式用途**：

- shard、studio：standard-3；含 WebGL 的 shard 用 standard-4，G1 对比后定。
- assemble：standard-3。
- audio：自定义 1 vCPU / 3 GiB，2026-10-22 已实测可以启动。
- 资产处理：standard-4。

**控制器与实例管理**：

- **处理 SIGTERM**：控制器是容器里的 1 号进程（或由最小 init 转发信号），**必须显式处理 SIGTERM**。
  - 实测未处理时，`stop()` 后 20 秒任务仍在运行、状态仍为 healthy；处理后 48 毫秒内中止。
  - 宿主维护会先发 SIGTERM，最多 15 分钟后发 SIGKILL。
- **就绪探测**：平台会先向端口发就绪探测，探测请求不能触发退出；实测会导致 "Container suddenly disconnected"。
- **DO ID**：
  - 每个渲染分段使用新的 DO ID `render:<renderId>:shard:<n>:<attempt>`，保证不复用实例；
  - studio 实例的 DO ID 为 `studio:<operationId>`。
- **渲染器登记表**：D1 `renderer_releases` 记录镜像键与摘要、Chromium、ffmpeg、GSAP、Three、`runtimeVersion`、字体登记版本、积木库版本，以及状态（active / retired / revoked）。
  - 交付冻结的是成片字节，所以旧镜像在没有进行中的渲染、也没有被复用分段引用之后，即可改为 `retired`。

### 9.2 broker（`apps/cloud/src/broker.ts`，`BrokerEntrypoint`）

- **令牌**：HMAC 签名，不含 R2 凭据。载荷包括：
  - renderId 或 operationId；
  - 实例角色：shard、studio、audio 或 asset；
  - 允许读的 R2 键列表、允许写的键前缀；
  - 过期时间：期限加 60 秒。
- **令牌不经环境变量传递**：
  - DO 在实例就绪后，把任务和令牌放在第一个任务请求的请求体里发给控制器。
  - 令牌只留在控制器内存里，不写文件，也不传给 Chromium。
  - 原因：2026-10-23 本地验证（`ubuntu:24.04` 容器），进程删除环境变量后，它仍在 `/proc/<pid>/environ` 里，所以 v3.0 的"读后删除"做法不可靠。
- **读请求**：`GET http://broker.internal/r/<key>`，校验令牌与键白名单后，从 R2 流式返回。
- **写请求**：`PUT http://broker.internal/w/<key>`，校验前缀、大小和内容类型。
  - 大小上限：`shard.h264` ≤ 40 MB，单张 PNG ≤ 12 MB，JSON ≤ 4 MB，`film.mp4` ≤ 50 MB。
  - 同一令牌的写入次数有上限。
- **日志**：请求日志写入成本和审计计数。

### 9.3 D1

在 PRD 14 的数据库约束清单之上，增加以下表。字段与 14 冲突时以 14 为准，并同步修改 14。

- 操作与费用：`operations`、`operation_steps`（逐步记录每次模型调用和工具调用，以及费用引用）、`cost_events`（沿用 `costEvent` 结构）。
- 候选：`candidates`、`candidate_files`（指向 R2）、`directions`、`audio_plans`。
- 渲染：`renders`、`render_shards`（含分段键，供增量复用）、`render_seams`、`observations`（摘要与 R2 指针）。
- 素材：`resources`、`resource_rights`、`asset_jobs`、`asset_insights`、`transcripts`。
- 评论：`comment_threads`、`comments`（含 `followUpOf`）。
- 其他：`renderer_releases`、`experience_entries`（PRD 13 §8，按工作区存放，用户选择启用）。

导演的账本、预留与结算、审核回执、CAS、操作幂等重放，按原有语义在 D1 上重写，代码在 `apps/cloud/src/store/`。不保留 JSONL 实现；本地开发由 Miniflare 提供 D1。

### 9.4 R2 键

```
src/<sourceHash>/{film.json,scenes/...}       不可变源包
res/<sha256>                                  已确认素材
quarantine/<assetJobId>/...                   待确认（生命周期 7 天）
frames/<sha256>/<n>.webp                      渲染端视频帧
proxy/<sha256>.mp4                            预览端视频代理
insights/<sha256>/<promptVersion>.json        素材理解
audio/<audioPlanHash>.wav
renders/<renderId>/shards/<n>/{shard.h264,frame-digests.json,seam-frames/*.png,observations.json,receipt.json}
renders/<renderId>/seams.json
renders/<renderId>/out/{film.mp4,poster.png,keyframes/*.png,report.json}
stills/<sourceHash>/<aspectId>/<frame>@<scale>.{jpg,png}
runtime/<runtimeVersion>/...                  预览 origin 分发的运行库、积木与字体
```

**生命周期**：

- 预览和 still 保留 72 小时（`temporaryPreviewHours`）。
- `renders/<renderId>/shards/` 是中间产物，保留 7 天；被候选引用的分段保留到候选过期（用于增量复用）。
- `quarantine/` 保留 7 天。
- 被快照、订单或 `docs/evidence/` 引用的对象不过期：
  - 引用登记在 D1；R2 生命周期规则只作用于未被引用的前缀。
  - 每日任务把被引用的对象复制到不过期的 `retained/` 前缀，然后才允许原对象过期。

### 9.5 并发

`config/agent-policy.json` 的 `limits` 用以下字段替代 `globalContainers: 4` 等旧字段：

| 字段 | 初值 | 说明 |
| --- | --- | --- |
| `globalShardInstances` | 64 | |
| `workspaceShardInstances` | 24 | 4 个画幅 × 6 段 |
| `shardsPerRender` | 6 | 含 WebGL 时最多 24 |
| `globalStudioInstances` | 32 | |
| `globalAssetInstances` | 8 | |

- 含 WebGL 的单次渲染可以占满一个工作区的 24 个名额，此时 4 个画幅的准备按画幅排队。
- v3.0 的 16 个名额容不下一次 WebGL 渲染（24 段），也容不下 7 个目标的准备。
- 64 个 standard-3 约 128 vCPU、512 GiB，远低于账户上限（1,500 vCPU、6 TiB 内存、30 TB 磁盘）。
- CoordinatorDO 以实例的实际状态计数，超出时排队，不报错。
  - 探针曾观察到空闲实例不按超时释放，并占满名额，导致新请求返回 "Maximum number of running container instances exceeded"。
  - 所以许可只在确认实例已停止之后才归还。

### 9.6 Workflows 编排

- **三个工作流**：`OperationWorkflow`、`RenderWorkflow`、`AssetWorkflow`。Workflows 已 GA，平台限额如下：
  - 每个实例默认 1 万步；
  - 每步返回值 ≤ 1 MiB；
  - 实例状态 ≤ 1 GB；
  - `waitForEvent` 默认超时 24 小时，最长 365 天。
- **长任务用官方模式**：
  1. 用一个幂等的 `step.do` 启动任务，例如让 ShardDO 启动实例；
  2. 再用 `step.waitForEvent` 等待；
  3. DO 完成时调用实例的 `sendEvent`。

  不让一个 step 持续几分钟地等容器。官方建议单步超时不超过 30 分钟。
- **并行**：同一阶段里互相独立的 step（各分段、各自写镜头）并发执行。
- **派发**：
  - 实例 ID 等于 operationId、renderId 或 assetJobId。
  - D1 事务里同时写入预留、运行记录和 outbox。Queues 消费 outbox 并创建 Workflow 实例；只有成功查询原生状态才能把创建错误认作重复。已发送 outbox 不代表实例已创建，实例登记单独持久化。
- **取消与平台恢复**：先推进操作 generation，再终止原生 Workflow 并由 DO 确认物理实例停止/结算；迟到创建也要停止。原生状态未知时保持未确认，物理清理独立继续。每分钟有界扫描未对账登记，修复原生 errored/terminated 或完成但未业务提交的记录；不自动重启付费阶段。
- **重放与整次重启**：正常恢复复用有效 Workflow 检查点；第一步在 D1 单次领取执行 claim。平台 `restart()` 清空检查点后不能重领，落失败并清理旧计算，保留未知模型预留。不能通过重启、更换 generation 或新建操作绕过模型账本。原生语义见 [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)。
- **保留期**：以实施时的文档为准（限额页写 30 天，2026-09-10 的变更日志写新付费 Workflow 默认 7 天）。需要长期留存的记录写 D1 或 R2，不依赖 Workflows 的历史。

### 9.7 wrangler 配置要点（`apps/cloud/wrangler.jsonc`）

- Worker：`compatibility_date` 用实施当天的日期，开启 `nodejs_compat`。
- 绑定：
  - 存储与消息：环境 D1 `DB` 与跨环境共享研究预算 `MODEL_LEDGER`；R2 `BUCKET`（私有）；Queues `OUTBOX`。
  - Workflows：`OPERATION_WORKFLOW`、`RENDER_WORKFLOW`、`ASSET_WORKFLOW`。
  - DO：`OperationDO`、`ShardDO`、`AssetDO`、`CoordinatorDO`。
  - 平台服务：Workers AI `AI`；Browser Run `BROWSER`；服务入口 `BrokerEntrypoint`。
  - Secrets：`BROKER_SIGNING_KEY`，以及 `config/model-providers.json` 中实际使用的供应商密钥（`MODEL_COMPAT_API_KEY`、`ANTHROPIC_API_KEY`）。
- 用 Containers 的 `images` 登记镜像；用 `wrangler types` 生成绑定类型。
- 参考实现：Cloudflare 于 2026-10 开源的 Streamline，一个由 Workers、DO 和 FFmpeg 容器组成的视频管线。

### 9.8 账户准备

由负责人在 Cloudflare 控制台完成，执行 Agent 不接触控制台。

1. **Workers 付费计划**：已于 2026-10-22 完成。
2. **平台能力**：Containers 与 `scheduling_policy: "durable_object"` 已于 2026-10-22 实测可用。Workers AI 已于 2026-10-23 由 [cloud-account-check 工作流](../../.github/workflows/cloud-account-check.yml)用部署 Token 实际调用成功。Browser Run 的 REST 接口（`/browser-rendering/`）同日用部署 Token 抓取 5 个公开页面成功（[前置探针](../evidence/2026-10-23-pre-s1-probe/README.md)）。
3. **资源**：创建预发布与生产两套 D1 数据库、R2 桶（私有）和 Queues，名称写入 `wrangler.jsonc` 的两个环境。2026-10-23 已由 [cloud-resources 工作流](../../.github/workflows/cloud-resources.yml)创建（名称见 `apps/cloud/resources.json`，可重复运行），并在 `apps/cloud/wrangler.jsonc` 的 `staging`、`production` 环境绑定为 `DB`、`MEDIA`、`OUTBOX`。
4. **部署用 API Token**：已于 2026-10-22 创建，含 Containers、D1、Queues、R2、Browser Run、Workers Observability 的 Edit 权限，限本账户与 `promobento.com`。缺少 Workers AI 和 Workflows 权限时补上，权限项名称以创建页面为准。
5. **凭据放置**：
   - `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`：放在 GitHub Actions 的仓库 secrets，已于 2026-10-22 写入；本地开发放在 shell 环境变量。**不写进仓库，不贴进对话或模型上下文。**
   - 运行时密钥：用 `wrangler secret put` 分别写入预发布和生产 Worker。
6. **预览 origin**：
   - 独立注册域名 `promobentousercontent.com`（不是 promobento.com 的子域）已于 2026-10-23 在本账户生效。`config/preview.json` 记录生产 `https://p.promobentousercontent.com` 与预发布 `https://staging-p.promobentousercontent.com`；DNS 与 Worker 路由在 S2 部署预览播放器时配置，部署用 Token 的区域权限届时加入这个域名。
   - 预发布环境的 API 用独立域名或 `workers.dev` 子域。

---

## 10. 安全清单

全部要有自动测试。

1. **断网**：渲染、studio 和资产实例都设 `enableInternet:false`，唯一出口是 `broker.internal`；另做 DNS 外泄测试。
2. **令牌**：实例内没有任何长期密钥；令牌只在控制器内存中（第 9.2 节）。测试项：
   - 作品和 Chromium 进程读取环境变量、`/proc/*/environ`、文件系统，都看不到令牌；
   - 令牌只能访问本段或本操作的键；
   - 以 uid 10002 运行的旁路进程（模拟逃出沙箱）读不到控制器的内存和环境。
3. **实例不复用**：每个分段用新实例；studio 实例只服务一个操作，结束即销毁；实例之间没有共享磁盘。控制器结束前清除临时文件，清除失败时由实例销毁兜底。
4. **沙箱**：Chromium 沙箱开启，并通过第 5.5 节的启动自检（分离 uid 下仍为 SANDBOX_FULL），否则拒绝运行。测试关闭沙箱启动时，自检能报出 `RENDER_SANDBOX_UNAVAILABLE`。
5. **攻击语料** `tests/attacks/film-v1/`，每条都要求得到预期的错误码：
   - 外部 `fetch` 与 `img`：渲染时由断网兜底，预览时由 CSP 拦截；
   - Worker、WASM、eval；
   - `localStorage`、IndexedDB、cookie：CSP 拦不住，必须由 shim 报错；
   - `<iframe>` 与 `srcdoc`；
   - 定时器、无限循环与内存耗尽：由期限和内存上限兜底，控制器能收到渲染进程的 crash 事件（2026-10-22 已实测）；
   - 试图改写 `__omEngine` 或伪造就绪握手；
   - 绕过 `ctx.text` 写文字，试图读取其他镜头或积木的内部状态；
   - WebGL 资源耗尽：超大纹理、着色器死循环。
6. **QA 不读作品自报**：文字、字体、区域、对比度全部来自 CDP；点选的 `regionId` 由云端用 CDP 复核后才写入评论。
7. **预览 iframe**：
   - 独立注册域名，`sandbox="allow-scripts"`，没有主站 cookie，CSP 禁网；
   - bridge 校验 origin、source、nonce、session 和 schema。
8. **模型输出只作数据**：
   - `film.json` 和工具参数全部经 Schema 校验；
   - 素材、网页和图中的文字只当内容（PRD 13 §3）；
   - 素材理解的输出 Schema 不含任何指令性字段。
9. **网址抓取**：按第 8.1 节的 SSRF 防护执行。
10. **成本**：每次模型调用和工具调用之前先预留；未知用量保留最坏值；预算耗尽立即停止，不调用模型修复。
11. **动态代码**：Workers 内只用预编译的验证器，没有 `new Function`；测试覆盖。

### 10a. 可观测性

- **结构化日志**：
  - Worker、Workflows、各 DO、broker 和容器控制器的每条日志都带 `operationId`、`renderId`、`shard`、`attempt`、`rendererRelease`、`stage`；
  - 容器日志经 Workers Logs 汇集；
  - 日志中不出现令牌、密钥、用户素材内容或提示词正文。
- **指标**（Workers Analytics Engine）：
  - 实例：启动数、运行中实例数、冷启动耗时、握手耗时、单帧耗时分布（2D、WebGL 分开）；
  - 渲染：分段与整次的墙钟、接缝检查结果、各错误码计数；
  - 模型：各阶段的模型费用、token 与缓存命中率；
  - 时间节点：方向卡就绪、草稿可播放、候选就绪、成片就绪；
  - 单位成本与第 1.1 节目标的对照。
- **告警**：
  - 运行中实例数超过对应上限，或 `stop()` 后 60 秒实例仍在运行；
  - `RENDER_SANDBOX_UNAVAILABLE`、`RENDER_ENVIRONMENT_MISMATCH`、`BLOCK_INTERNAL_ERROR`，任意一次即告警；
  - 每日费用超过 `dailySoftAlertMicros`；
  - 滚动窗口内单位成本 p95 超过目标；
  - 重复前缀的缓存命中为 0；
  - `RENDER_SEAM_BLOCK` 的比例突增。
- 第 1、11、12 节的 p50、p95 和费用都从这些指标计算，不另做临时统计。

---

## 11. 计算费用估算

设计目标见第 1 节；本节只估算计算费用，各切片用真实账单校准，写入 `unit-economics` 结构。

**Cloudflare Containers 价目**（2026-10-05）：按运行时间以 10 毫秒为单位计费。

| 计价项 | 单价 | 计费口径 |
| --- | --- | --- |
| CPU | $0.000020/vCPU·秒 | 只计实际使用 |
| 内存 | $0.0000025/GiB·秒 | 按分配量 |
| 磁盘 | $0.00000007/GB·秒 | 按分配量 |

Workers 付费计划每月含 375 vCPU·分钟、25 GiB·小时、200 GB·小时。

**估算**：

- **standard-3 分段，约 40 秒**：CPU 最多 2 × 40 × 0.00002 = $0.0016，内存 8 × 40 × 0.0000025 = $0.0008，磁盘约 $0.00004，合计约 $0.0025。冷启动另计，可以忽略。
- **纯 2D 的 30 秒成片**：6 个分段、1 次拼接、1 次声音，约 **$0.02**；4 个画幅约 **$0.08**。
- **WebGL 帧**：在 standard-4 上每帧约 2.3 秒，约 $0.00026/帧；每段的页面加载约 17 秒，约 $0.002/段（附录 C）。WebGL 帧占 30% 的 30 秒片：
  - 每个画幅约 $0.10–0.15；
  - 4 个画幅约 $0.4–0.6。

  按 S1 的整片实测更新。
- **studio 实例**：每个操作约 15 分钟，约 $0.03。
- **其他平台费用**：Workflows、DO、D1、R2、Queues 和 Workers AI（ASR 约 $0.0005/分钟）在这个规模下可以忽略，但都要进入成本事件。

---

## 12. 测试与验收

### 12.1 单元测试（`mise run test`）

- **契约与规格**：
  - 新 Schema（含 `film.json`）的正例与反例；规范化和摘要的固定向量。
  - 规格校验：覆盖、空洞、转场、事实绑定、拍点对齐。
  - 失败分类：覆盖每个错误码。
- **渲染计划**：
  - 分段计划：按代价切段，任意时长和段数下都是 15 的倍数，覆盖完整，没有重叠。
  - 分段键与增量复用。
- **broker 与存储**：
  - broker 令牌：越权键、过期、写入超限。
  - D1 迁移与查询在 Miniflare 上测试：CAS 冲突、操作重放、未知用量的预留与对账。
- **QA 规则**：Q0 每条规则一个正例和一个反例；Treatment 检查；冷审输入的构造。
- **费用与路由**：
  - 预算的预留与结算；两种适配器的 usage 计价（含字段缺失时的最坏预留、人民币换算）；模型配置校验（步骤能力、验证状态、价格、授权）。
  - AudioPlan 的生成与拍点网格。
  - 改稿分流路由（mock）。

### 12.2 本地容器测试（`mise run test:browser`；CI job `browser`）

- **测试环境**：通过 `wrangler dev` 用本机 Docker 运行与云端**同一个镜像**，走同一套 Worker、Workflows、DO 和 broker 代码。CI 中同样如此（Linux runner 带 Docker）。
- **积木**：
  - 每个积木四种画幅的黄金帧：同一镜像内要求逐像素一致，跨镜像用接缝容差比较。
  - 文字适配的边界情况、对比度、安全区。
- **自写镜头合同**：样例镜头覆盖 GSAP、经 `OM.clock` 的 Canvas、经 `OM.space` 的 CSS-3D、经 OM3 的 Three.js。
- **分段与整片对比**：
  - 分段渲染与单段整片渲染的编码前帧，逐帧比较，**按第 5.6 节的容差判定**，不要求摘要相同。附录 A 实测冷启动帧与顺序帧的摘要从不相同，v3.0 要求的"摘要完全相同"必然失败。
  - 编码后的成片只核对帧数、PTS、GOP。
- **接缝检查**：故意写入历史依赖的变异样例必须判为 `RENDER_SEAM_BLOCK`。
- **增量渲染**：改一个镜头，只重渲受影响的段，复用段通过接缝检查；读取其他镜头状态的变异样例能被发现。
- **捕获格式**：输出 PNG 与 JPEG 的耗时和 SSIM 报告。
- **上游模板冒烟**：上游 12 个模板（storytime 改为原创角色版）改写为整片自写镜头后都能成片，QA 能运行。不与上游 CLI 做 SSIM 对等比较（D11）。
- **其他**：
  - 攻击语料（第 10 节第 5 项）、QA 变异样例（第 7 节）；
  - 运动模糊：8 子帧的 30 秒片，记录耗时倍数；
  - WebGL：3D 积木成片、渲染器字符串核对、期限。

### 12.3 Cloudflare 验收（`mise run test:cloud`；G1 是 S1 中的首轮）

缺少账户时标为未验证。运行时先 `wrangler deploy` 到预发布环境，再执行以下检查：

1. **生产组合重测**：`ctx.container` + `durable_object` + `interceptOutboundHttp` broker + 令牌经请求体传递 + 分离 uid 的沙箱自检。
2. **隔离**：攻击语料中的网络、环境变量和令牌越权项。
3. **性能**：10 次串行加 4 路并发的 30 秒成片，纯 2D 和含 WebGL 各一组；记录 p50 与 p95 墙钟、冷启动、单帧耗时分布和费用。
4. **方案选型实测**：
   - 捕获格式：PNG、JPEG 90/92/95；
   - WebGL 实例规格：standard-3 对比 standard-4；
   - `renderScale`、着色器缓存、容器快照：附录 C 已测，均无收益，不再测。
5. **接缝**：统计摘要不一致和需要容差的比例，记录 `cpuFlagsHash` 分布。
6. **取消**：渲染中途取消，确认所有实例停止、R2 只有已提交的对象、费用已结算。
7. **沙箱**：生产镜像复现探针的 SANDBOX_FULL，并记录到证据。
8. **回收**：停止后确认实例状态，并发计数正确。
9. **studio 实例**：still/check 的延迟分布；操作结束后确认已销毁。
10. **模型能力探针**：对 `config/model-providers.json` 中每个被绑定的模型，实测工具调用、看图、JSON Schema、推理强度、缓存命中字段、流式、首 token 与整体延迟，并用一次已知 token 数的调用核对计价。结果写回模型登记（`verified`），不合格的按第 6.12 节换绑。这一项不需要 Cloudflare 资源，有模型密钥即可在 CI 中运行。

结果按 06 写入 `docs/evidence/`。探针脚本入库到 `apps/render-container/probes/`，不再只存在于负责人本机。

### 12.4 导演（离线 mock 加真实调用）

- mock provider 按阶段回放固定输出，两种适配器的请求与响应格式各有一套，覆盖：
  - 方向、规格、镜头编辑、review 修复、冷审、改稿分流；
  - 失败分类下的修复与不修复。
- 真实调用按第 6.12 节的授权与价格表执行，累计费用由 D1 成本账本计算。授权过期、额度用尽，或负责人尚未在 Console 写入密钥时，不调用。

### 12.5 评测集与成本验收（替代 M0a；`research/evals/`；`mise run eval`）

- **题目**：
  - 主体：下面的内部评测题目。它们只用于内部评测，不能作为 PRD 01 要求的首发样片；首发样片另用有真实素材授权的自有或合作产品制作。
  - 补充：覆盖两类人群各种任务的合成题，用虚构品牌和原创素材。
  - 每题做 15 秒和 30 秒，横竖两种画幅。
  - 2026-10-23 负责人确定的题目见 [`research/evals/topics.json`](../../research/evals/topics.json)：软件 DeepSeek、MiniMax、Duolingo；课程为公开真实的 IELTS Ready、Marugoto Japanese Online Course 和 Hugging Face LLM Course；六张官网事实卡已由负责人确认为本次内部评测使用。2026-10-24 已逐项查看并将 9 张素材及许可证据入私有 staging R2，IELTS 采用负责人批准的原创事实图，第三方截图许可限制不变；iPhone Duo 不属于两类首发用户，只作边界题，不计入 S1 的 4/6。
  - 真实品牌的截图、录屏和 Logo 只用于内部评测：存放在预发布 R2，不进 Git；成片不发布、不对外展示，也不作为营销样片。事实在每次运行前由负责人确认。
- **指标**：
  - 每个可用结果的模型与计算费用，按阶段拆分；
  - 第 1.2 节的各时间节点；
  - QA 通过率与修复次数；改稿成功率；
  - 负责人评分：愿意发布或不愿意发布，以及原因；
  - 评分模型的分数：先用负责人的评分校准，偏差超过阈值时以人为准。
- **运行**：
  - 改方法包、积木、运行时、提示或模型时都要跑；
  - 每次运行有费用上限；离线评分调用在供应商支持时用批处理接口；
  - 报告写入 `docs/evidence/` 或 CI 产物。
- **真人**：真实目标用户盲审按 06/07 小规模做一次绝对质量判断（愿意发布的比例），不做双臂对照。

### 12.6 预览播放器

`packages/preview-player` 用 Playwright 在 Chromium、Firefox、WebKit 下加载 iframe，测试以下项目：

- seek；
- `film.json` 值覆盖；
- hit-test；
- 代理视频的 seek。

预览结果不作为 QA 证据。

---

## 13. 文档与配置更新清单

AGENTS 要求每次修改都检查文档冲突，所以 PRD 和配置随对应的切片一起改，不集中到最后。

| 文件 | 修改 | 切片 |
| --- | --- | --- |
| `README.md`、`AGENTS.md` | 改为新结构与命令入口。AGENTS："创作代码只能在隔离环境运行"改写为分段与 studio 实例规则；契约入口改为 `contracts/film-runtime.d.ts`、`contracts/render-protocol.d.ts`；增加"Workers 内只用预编译验证器"；删除与旧 profile 相关的维护规则 | S0 |
| PRD 索引与全部 PRD 的版本行 | 改为 v3.0、协议 3.0.0；删除描述 QuickJS、`canvas-*` profile、准入链路、fixture 宿主和本地研究控制器的段落，不留"已废弃"说明 | S0 |
| [13](../prd/13-agent-native-production.md) §1、§3–§6 | §1：作品形态为 film-v1（规格 + 积木 + 自写镜头）；删去"生产运行时不依赖 GSAP"，写明积木与自写镜头都可用 GSAP（由负责人决定），WebGL 按 CPU 渲染。§3：方向卡与 Treatment 落在 `film.json`。§4：分阶段导演与模型分工，沿用"事实整理、意图分类、素材摘要可用经过验证的便宜模型"的原则。§5：有旁白时必须有来自已确认转写稿的字幕层，由 Q2 静音可读 BLOCK。§6：改为第 7 节的 Q0–Q3 | S1–S2 |
| [14](../prd/14-production-contracts.md) §2、§5、§7 | §2：新建 Manifest 使用 film-v1/identityVersion 2；历史 v1 入口与身份保留读取/重放，迁移不重复收费。§5：RenderProtocol 3.0.0 新包络按画幅，旧 targetId 包络互斥兼容；包括分段、接缝、增量复用。§7：渲染状态机增加 sharding、verifying、assembling | S1 |
| [04](../prd/04-architecture-and-data.md) | 第 2 节的架构图；Workflows 与 DO 的分工、`ctx.container`、broker、D1 表、R2 键、Workers AI 数据流 | S1 |
| [03](../prd/03-platform-presets.md) §1–§2 | 7 个目标对应 4 个画幅渲染，同画幅共用成片字节 | S2 |
| [06](../prd/06-testing-and-release.md) §3、§4 | §3：混音响度由"约 −16 LUFS"改为按预设的 `loudnessTarget`（−14 LUFS）。§4：性能与成本门槛换成第 1 节 | S1 |
| [07](../prd/07-growth-and-experiments.md) §4 | `m0a-economics` 改名为 `unit-economics`；单位成本目标引用第 1 节 | S1 |
| [08](../prd/08-codex-execution.md) | 里程碑改为第 14 节的 S0–S3 与 G1；命令表换成新任务；Chromium 沙箱降级必须有书面决定 | S0 |
| [09](../prd/09-sources-and-licensing.md) §1–§2 | S0：GSAP 的使用决定（负责人决定，即许可结论；版本 3.14.2 与摘要；进镜像不进 Git）；上游固定参考改为 `4236053`；Three.js r186 为 MIT；不加署名；作者形象不采用，用原创角色替代。S3：CC0 采样包的来源、固定提交与许可（排除 CC-BY 钢琴与 Wurlitzer）；不采购曲库；Workers AI 与 Browser Run 的数据流 | S0、S3 |
| `docs/creative-toolkit.md` | 删除，内容并入 13 和 `packages/methods/README.md` | S0 |
| [实施状态](../implementation-status.md) | 每个切片结束时，按实际具备和尚未验证的能力重写 | 每个切片 |
| [agent-policy.json](../../config/agent-policy.json) | 新增 `render` 期限段、`limits` 新字段、阶段预算与 effort、`requestTimeoutMs`、变体开关；`cost` 段按第 6.12 节填写；`schemaVersion` 改为 3.0.0 | S0、S1 |
| `config/model-providers.json`、`config/model-authorization.json` | 新增，内容按第 6.12 节；`check-production-contracts.mjs` 校验它们与 `agent-policy.json` 一致 | S0 |
| [platform-presets.json](../../config/platform-presets.json) | 在 `presets[]` 每一项增加 `loudnessTarget`（单位 LUFS，现有 6 个预设都为 −14）；编码 profile 仍共用 `mp4_h264_1080_v1` | S0 |
| [input-capabilities.json](../../config/input-capabilities.json) | `fetch` 和 `customFontUpload` 保持 false，直到对应能力实现、并由负责人按 PRD 开放；增加 `tts.enabled`（false）。v3.0 的 D8 和 §8.1 与这两个字段矛盾，第 13 节也没有列出本文件 | S0、S3 |
| [preview.json](../../config/preview.json) | `previewOrigin` 写入独立注册域名；增加视频代理与 `film.json` 值覆盖 | S2 |
| `.mise.toml`、`package.json` | S0：`test`、`typecheck`、`build:validators`，删除第 3.3 节的旧任务，锁定 TypeScript 与 wrangler 的精确版本。其余任务 `build:containers`、`test:browser`、`cloud:dev`、`cloud:deploy`、`test:cloud`、`eval`、`upstream:diff` 随 S1–S3 的真实实现加入，不建空命令 | S0–S3 |
| `.github/workflows/checks.yml` | job 改为：`contracts`（check:repo 加单元测试）、`browser`（buildx 层缓存）、`cloud-local`（`cloud:dev` 全流程 mock）；另设 `deploy`，手动或 main 触发，构建并推送镜像，部署预发布 | S0、S1 |

---

## 14. 实施切片

**原则**：

- 终版能力全部在本方案内实现，切片之间不留"以后再做"；切片只决定顺序和检查点。
- 先建新的、迁移引用，再删旧的。配置、`check-*` 脚本和使用它们的代码，放在同一次提交里修改。
- 保留现有检查契约，每个切片结束时如实更新实施状态。开发期间非必要不跑测试或反复触发 CI；必须验证时只运行一次最小检查，复用已有适用结果，已知失败和未运行项不能记为通过（见 [AGENTS](../../AGENTS.md)）。生产发布的必需检查保持不变。
- **并行开发**：S0 定义好契约后，积木、渲染、导演、声音、资产和预览可以在各自的 worktree 里，由多个 Agent 同时实现。
  - 工作流之间的接口只通过 `contracts/` 改动。
  - 改动契约时，要同时更新所有使用方。

### S0 清场与契约（不调用付费模型）

1. **清场**：删除第 3.3 节的旧代码和 CI job。删除前先用 `git mv` 迁出可复用的部分：
   - 字体（含 Geist）；
   - 契约底层；
   - 声音实现；
   - GSAP 摘要。
2. **骨架**：建立 TypeScript 工具链，以及 `apps/cloud` 和两个容器应用的骨架；`wrangler.jsonc` 配置 `ctx.container`、Workflows 和各绑定。
3. **新契约**：
   - Schema：`film`、`block`、`render-job`、`frame-observation`、`agent-tools`、`direction`、`audio-plan`、`asset-insight`、`production` v3.0、`unit-economics`；
   - 类型：`film-runtime.d.ts`、`render-protocol.d.ts` 3.0.0；
   - Ajv standalone 预编译和固定向量。
4. **配置与文档**：完成第 13 节中标 S0 的各项。

**出口**：

- `check:repo` 和 `test` 通过。
- `check:repo` 增加"旧标识符不得出现"的检查：QuickJS、`canvas-commands-v1`、`canvas-media-v1`、admission、fixture 宿主、JSONL 控制器。

**S0 完成情况（2026-10-23）**：

- 规格与协议已升到 v3.0 / 3.0.0。`production.schema.json` 只升了版本号，Manifest 改为引用 film-v1 的语义变更放在 S1，与 PRD 14 §2 一起改。
- 声音实现（`creative-audio`）和 `motion-tools` 没有在 S0 迁出：S1 从 Git 历史（提交 `1faef1c`）按 `packages/audio`、`packages/film-runtime` 的新结构改写。S0 只迁出了 CC0 采样和字体。
- `apps/cloud` 只有健康检查路由；容器应用的骨架随 S1 的真实实现加入，不建空模块。
- 全部 11 个 Schema 已有预编译 ESM、TypeScript 导入入口及固定结构回归用例；Node 禁运行时代码生成的测试覆盖所有入口。JCS 固定摘要向量保留，页面与 film-v1 源码身份向量随 S1 的页面生成器加入。导入与构建方式见[共享契约库](../../packages/contracts/README.md)。

### S1 一条龙：真实题目从需求到成片

1. **film-runtime**：
   - 页面生成器、shim、engine；
   - 转场：cut、crossfade、push、whip；
   - OM 兼容层、clip lib 与通用 toon；
   - 第 4.3 节标 ★ 的 9 个积木，四种画幅都有黄金帧。
2. **渲染容器**：
   - 控制器：Chromium 管理、沙箱自检、分离 uid、CDP JPEG 捕获直送 ffmpeg、PNG 接缝帧、CDP 观测；
   - shard、assemble、audio、studio 四种模式；
   - 非 root 运行的 Dockerfile 与锁文件；`build:containers`。
3. **云端**：
   - Worker 路由、RenderWorkflow、ShardDO、CoordinatorDO；
   - OperationDO：studio 实例与进度推送；
   - broker、D1 迁移与账本、R2 键；
   - `cloud:dev`，以及在 CI 中运行的 `cloud:deploy`。
4. **G1 云端检查点**（未通过不进入 S2）：
   - 在预发布账户上，执行第 12.3 节第 1–9 项的首轮，覆盖纯 2D 和一个 3D 积木。
   - 据此修订第 1.2 节的时间目标、第 5.3 节的期限、第 5.2 节的捕获格式与段数，以及 WebGL 的实例规格。
5. **导演**：
   - 阶段 A–C 与 E（不含自写镜头），以及冷审 F；
   - `openai-compatible` 与 `anthropic` 两种适配器、缓存、预算、授权检查、离线 mock；
   - OperationWorkflow，含方向选择的 `waitForEvent`。
6. **声音**：程序配乐与 ABC 作曲、CC0 采样包（第 8.3 节）、音效自动对位、响度；每种风格各渲染一段 30 秒样曲供负责人试听。
7. **评测集首轮**：真实题目，每题做 15 秒和 30 秒，横竖两种画幅。

**出口**：

- 单位成本：积木版创作的模型费用 p50 ≤ $0.70、p95 ≤ $1.20（不含自写镜头）。
- 时间：方向卡、积木版草稿、成片 30 秒（纯 2D）达到第 1.2 节的目标。
- G1 全部通过。
- 负责人按正常速度试听，愿意发布的不少于 4/6。
- 文档：完成第 13 节中标 S1 的各项。

### S2 自写镜头、QA 与改稿

1. **自写镜头**：
   - 自写镜头合同和 Q0 静态规则；
   - 阶段 D：并行子流程，配文本编辑工具；
   - 阶段 E 完整版；
   - 用评测集实测选定阶段 D 的模型。
2. **QA**：
   - Q1（CDP）；
   - Q2：运动、声音、Treatment、静音可读、事实；
   - QA 变异样例；
   - 接入输出审核，用于渐进预览。
3. **改稿**：分流、直接改值、镜头内修改、结构修改、增量渲染、改稿证据。
4. **准备与变体**：准备 4 个画幅；变体派生（开关默认关闭）。
5. **预览**：`packages/preview-player`；预览 origin 定为独立注册域名。
6. **攻击与 3D**：
   - 攻击语料；
   - 3D 积木：`device-3d`、`logo-3d`、`product-stage`；
   - Three.js 自写镜头。
7. **评测集第二轮**。

**出口**：

- 第 1.1 节的单位成本和第 1.2 节的时间目标全部达标，含自写镜头、改稿和准备。
- 攻击语料和 QA 变异样例全部按预期报错。
- 负责人愿意发布的不少于 5/6。
- 按实测提议收紧止损上限（第 1.1 节）。

### S3 素材、其余能力与上线准备

1. **素材**：
   - AssetWorkflow、AssetDO；
   - 资产实例：probe、normalize、proxy、extract、image、fontcheck、tts；
   - Workers AI ASR 与转写确认；
   - 素材理解完整版；
   - 网址抓取。
2. **其余能力**：
   - 第 4.3 节未标 ★ 的全部积木和转场；
   - 课程类方法与格式；
   - 可控经验（PRD 13 §8）。
3. **配乐调整**：按 S1 试听意见调整各风格的配器，停用不合格的风格。
4. **可观测与验收**：
   - 可观测性与告警（第 10a 节）；
   - `test:cloud` 全量（第 12.3 节）；
   - 证据入库。
5. **文档**：完成剩余各项，按实际能力重写实施状态。

**出口**：即下面的完成标准。

### 完成标准

- **旧链路清空**：仓库中不再有 QuickJS、`canvas-*`、admission、fixture 宿主、本地 JSONL 控制器和 M0a 双臂的代码、契约、任务和文档描述。
- **检查与 CI**：
  - `mise run check:repo`、`mise run test`、`mise run test:browser` 通过；有授权时 `mise run eval` 也通过；
  - CI 的 `contracts`、`browser`、`cloud-local` 三个 job 通过。
- **积木与模板**：第 4.3 节的全部积木，四种画幅的黄金帧都通过，并有负责人的审美签字；上游模板改写为整片自写镜头后都能成片。
- **攻击与变异**：攻击语料和 QA 变异样例全部按预期报错。
- **全流程**：`cloud:dev` 和预发布环境各完成一次全流程，账本可对账。流程为：创作 → 选方向 → 成片 → 改稿 → 准备 4 个画幅 → 变体。
- **目标达标**：第 1 节的单位成本、时间和效果目标在评测集上达标，结果写入 `docs/evidence/`。
- **文档**：文档与配置按第 13 节更新完毕。`implementation-status.md` 如实标注未验证项，例如真实用户盲审。

### 需要外部提供的输入

缺失时只暂停依赖它的部分，不阻塞其余代码。

| 输入 | 提供方 | 何时需要 |
| --- | --- | --- |
| 模幻空间的 API Key：存为 GitHub secret `MODEL_COMPAT_API_KEY`，分组固定为 Default；平台为预充值，余额即消费上限（第 6.12 节） | 负责人 | S1 开始前 |
| 4–6 个有真实素材授权的自有或合作产品，及其已确认的事实 | 负责人 | S1 |
| 按正常速度试听各程序风格的 30 秒样曲 | 负责人 | S1 |
| 预览用的独立注册域名 | 负责人 | S2 |
| Cloudflare 控制台准备（第 9.8 节） | 负责人 | S1 |
| 真实目标用户盲审 | 负责人 | S3 之后 |

---

## 附录 A：2026-10-22 前置实测

在负责人的 Cloudflare 账户上用临时实验测得。实验条件：standard-3、断网、非 root、沙箱开启；使用上游 `4236053` 的 `kinetic-type` 与 `object-3d` 模板，以及虚拟时钟加静默 seek 的简化 shim。实验分支与云端资源测后已删除。

| 项目 | 结果 | 对正文的影响 |
| --- | --- | --- |
| 跨机器确定性（2D） | `kinetic-type` 在 3 台实例上整片 240 帧逐帧摘要完全相同，其中两台 CPU 不同（AMD family 25 的 model 1 与 model 17） | 第 5.6 节去掉按 CPU 分类的判定是安全的 |
| 接缝 | 冷启动帧与顺序帧的摘要从不相同，差异最大 1 个色阶、≤ 0.010% 像素，全部在容差内；3D 模板完全相同 | 第 5.6 节容差比对是常态路径；第 12.2 节的分段对比用容差，不要求摘要相等 |
| 拼接 | 4 段 Annex B 拼接后为 240 帧，PTS 单调，每 15 帧一个关键帧，无 B 帧 | 第 5.2 节方案成立 |
| 2D 单帧耗时 | seek 约 35 毫秒；PNG 截图 125–300 毫秒；JS 解码 PNG 50–100 毫秒；model 1 主机约慢一倍；60 帧一段 17–38 秒 | 测的是 PNG 加 JS 解码；JPEG 直送 ffmpeg 未测，由 G1 测（第 5.2 节） |
| 3D 单帧耗时 | 首帧绘制约 31 秒，之后每帧 3.5–4.5 秒（1080p、SwiftShader） | 附录 C 未重现 31 秒首帧；第 4.6 节按附录 C 修改 |
| 断网 | 外网 HTTP/HTTPS、直连 IP、DNS、TCP、UDP 全部超时失败 | 第 10 节第 1 项成立 |
| broker | 正确注册后 `GET /r/…` 返回 200，其他请求由处理函数返回 403 | 用的是 `Container` 类的 `outboundByHost`；生产组合已在附录 C 实测通过 |
| 令牌隔离 | 控制器删除自身环境中的令牌后再启动 Chromium，7 个 Chromium 进程的环境中都没有令牌，页面没有 `process` | 删除后令牌仍在控制器的 `/proc/<pid>/environ` 里，所以第 9.2 节改为经请求体传递 |
| 页面攻击（带 CSP） | 外部请求、Worker、WASM、eval、`new Function` 被拦；`localStorage`、IndexedDB、cookie 和 `srcdoc` iframe 里的脚本没有被拦 | 第 4.4 节：存储与 iframe 由 shim 禁止 |
| 崩溃与死循环 | 内存炸弹约 4.7 秒后渲染进程崩溃，控制器收到 crash 事件，浏览器存活；死循环可由期限中止 | 第 5.4 节的分类成立 |
| 控制器 OOM | 容器被直接终止，Worker 收到 "Container suddenly disconnected" | 按平台错误处理（第 5.4 节） |
| 取消 | 处理 SIGTERM 后，`stop()` 48 毫秒内中止任务，状态变为 stopped | 第 9.1 节已写明 |
| 并发 | `max_instances` 为 14 时，同时约 11 个任务即报 "no Container instance available"，旧实例仍占名额 | 协调 DO 以实例的实际状态计数（第 9.5 节、第 10a 节告警） |
| 镜像 | 约 1.55 GB；本机推送大层反复失败，GitHub Actions 构建并推送约 3 分钟 | 第 3.2a 节：只从 CI 部署 |

探针脚本与结果目前只在负责人本机的 `~/Downloads/sandbox-probe-results/`。G1 用正式镜像复测，并按 06 写入 `docs/evidence/`；探针脚本入库到 `apps/render-container/probes/`。

---

## 附录 C：2026-10-23 G1 预探针

用临时 Worker 与容器在 Cloudflare 上实测（[证据与原始报告](../evidence/2026-10-23-g1-pre-probe/README.md)，[探针代码](../../apps/render-container/probes/g1-pre/)）。

| 项目 | 结果 | 对正文的影响 |
| --- | --- | --- |
| 生产组合与 broker | `ctx.container` + `durable_object` + `interceptOutboundHttp` + `ctx.exports.Broker({props})` 可用；带令牌读写正常，无令牌、越权键、越权前缀均为 403 | 第 9.1、9.2 节成立 |
| 断网 | 外网 HTTP/HTTPS、DNS、TCP 443、UDP 53 超时，直连 IP 被重置，非 80 端口不通；`dns.lookup('broker.internal')` 超时，但对它的 HTTP 请求正常 | 第 10 节第 1 项成立；控制器访问 broker 不要先做显式 DNS 查询 |
| 令牌与分离 uid | 同 uid 进程能读到已删除的环境变量令牌和控制器内存；uid 10002 读不到；Chromium 以 uid 10002 运行仍为 SANDBOX_FULL | 第 5.5、9.2 节成立 |
| 停止与回收 | `destroy()` 0.2–0.5 秒后 `running:false`；`signal(15)` 0.4 秒内停止；12 个实例并发启停无数量上限错误 | 第 9.1、9.5 节成立 |
| 空闲 | 挂着 `monitor()` 时空闲 150 秒仍在运行；不挂时 150 秒内停止 | 第 9.1 节：不长期挂 `monitor()`，以显式 `destroy()` 为准 |
| 快照 | 只保存文件系统；恢复后 WebGL 加载与首帧没有变快 | 第 4.6 节不采用 |
| Workflows 链路 | `step.do` → DO 启动容器 → `step.waitForEvent` ← DO `sendEvent`，2.6 秒完成 | 第 9.6 节成立 |
| Ajv standalone | 完整 `production.schema.json` 预编译 1.67 MB，Worker 包 gzip 227 KB；workerd 内运行时编译报 `EvalError` | D12 成立 |
| 2D 捕获 | JPEG 92 每帧 168 ms（standard-3）/ 136 ms（standard-4），PNG 193 / 173 ms；SSIM 0.998 | 第 5.2 节锁定 JPEG 92；第 5.2 节 30 秒片 6 段的初值可行（约 25 秒/段） |
| WebGL | 页面加载 standard-3 23–34 秒、standard-4 17 秒；每帧 3.9 / 2.3 秒；dpr 0.75 与着色器缓存无收益 | 第 4.6 节：WebGL 段用 standard-4，不做 `renderScale` |
| 接缝 | 冷 seek 与顺序帧差 1 个色阶、0.003% 像素 | 第 5.6 节成立 |

未测：部署或运行时重启时正在流式的模型调用如何中断与重试；Browser Run 抓取；Workers AI ASR；真实作品的 30 秒整片分段渲染与拼接。

---

## 附录 B：上游 v0.2.0 能力取舍

| 上游能力 | 处理 |
| --- | --- |
| SKILL.md 的工作流：理解 → 三方向 → treatment → 最难镜头 → QA 循环 → 声音 → 交付 | 拆成第 6 节的阶段；"最难镜头先做"变为方向关键帧和自写镜头优先 |
| `references/`：director、rhythm、colour、depth、craft、visual-direction、product-demo-continuity、verification、provenance、sound、grammars、contract、talking-head、library | 重建为 `packages/methods`，按阶段召回；补课程类目 |
| `about-author.md`、签名、`om share`、macOS 专属条目、yt-dlp 与 cookie 抓取 | 不吸收；签名由引擎强制关闭 |
| `runtime/om.js` | 吸收为自写镜头 API；`OM.vars` 由 `film.json` 取代 |
| `runtime/om-engine.js` | 只作参考；自写可信引擎（静默 seek、私有计时器、可配置的绘制等待） |
| `runtime/clip/**`：8 种画面语法与 lib | 全部吸收，作为积木的基础，并开放给自写镜头；删除 `TOON.bean`，用原创的 `TOON.figure` 替代 |
| `runtime/three/**`（OM3） | 吸收，用于 3D 积木与自写镜头 |
| `runtime/camera-rig.js` | 不吸收（上游未使用） |
| `templates/`：12 个模板，全部为 1920×1080、7–12 秒的演示 | 作为积木设计参考和整片自写镜头的冒烟测试；storytime 用原创角色改写 |
| `om check` | Q0（规格与自写镜头）和 Q1（CDP） |
| `om qa` | Q2 运动诊断 |
| `om still`、`om look` | `still` 工具，含 2× 局部 |
| `om render`：JPEG 管道、多 worker、运动模糊 | 分段渲染：JPEG 直送 ffmpeg、跨实例并行、子帧模糊 |
| `om sound`，以及 score、composer、dsp、fx、samples | 已移植的部分迁入 `packages/audio`；补齐上游的 CC0 采样（第 8.3 节） |
| `cli/lib/beats.js`（上游未接入任何命令） | 用于用户配乐的拍点分析 |
| `om voice`：say/Kokoro TTS、whisper.cpp | TTS 用资产实例里的 Kokoro；ASR 用 Workers AI |
| `om grab` | 用 Browser Run 抓取（含 SSRF 防护），另有上传 |
| `om studio`、`inbox`、`look`、`done` | PromoBento Studio、预览播放器和评论流程 |
| `om learn` | 可控经验（PRD 13 §8），按工作区存放，用户选择启用 |
| `om fork --size` | 由积木的四画幅适配，加自写镜头的定点修改取代 |
| `om swatch` | 方向阶段的色板图 |
| `om export html` | 不吸收 |

## 参考

- **Cloudflare Containers**：
  - [限额](https://developers.cloudflare.com/containers/platform-details/limits/)
  - [价格](https://developers.cloudflare.com/containers/pricing/)
  - [调度策略](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)
  - [迁移到 durable_object 策略](https://developers.cloudflare.com/containers/guides/migrate-to-durable-object-scheduling-policy/)
  - [DO 容器 API](https://developers.cloudflare.com/containers/api/durable-object-container/)
  - [出站流量](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)
  - [FAQ](https://developers.cloudflare.com/containers/faq/)
- **Cloudflare Workflows**：
  - [限额](https://developers.cloudflare.com/workflows/reference/limits/)
  - [事件与参数](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
  - [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- **Cloudflare 其他服务**：
  - Workers AI：[价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)
  - Browser Run：[价格](https://developers.cloudflare.com/browser-run/pricing/)、[限额](https://developers.cloudflare.com/browser-run/limits/)
  - Durable Objects：[限额](https://developers.cloudflare.com/durable-objects/platform/limits/)
- **huashu-motion v0.2.0**（`4236053`）：
  - `skills/huashu-motion/SKILL.md`、`skills/huashu-motion/references/**`
  - `THIRD_PARTY.md`、`fonts/LICENSES.md`
  - `runtime/om-engine.js`、`runtime/om.js`、`runtime/clip/**`、`runtime/three/om-three.js`
  - `cli/lib/check.js`、`cli/lib/qa.js`、`cli/lib/beats.js`、`cli/lib/render-om.js`、`cli/lib/sound.js`
- **PromoBento（改造前）**：
  - [04](../prd/04-architecture-and-data.md)、[08](../prd/08-codex-execution.md)、[13](../prd/13-agent-native-production.md)、[14](../prd/14-production-contracts.md)
  - [渲染协议](../../contracts/render-protocol.d.ts)
  - [Agent 策略](../../config/agent-policy.json)
