# PromoBento 云端动效管线改造方案（v3.0）

- 日期：2026-10-22（负责人批准；此后的修改直接在本文件进行，并在提交说明中写明改了什么）
- 状态：**已批准，尚未实施**。现有能力以[实施状态](../implementation-status.md)为准，本文描述的是目标，不是已有功能。
- 基准：`ten2ten2/promobento@a0ed296`（PRD v2.7、协议 2.7.0）；`alchaincyf/huashu-motion@4236053`（v0.2.0）
- 读者：执行改造的 Claude Code / Codex。实施时按第 13 节把结论写进对应的 PRD、契约、代码和实施状态；全部落地后，本文只保留尚未并入 PRD 的部分，最终删除。
- 前提：
  - **GSAP 已确定使用**：决定人 tianyu（tianyu@tinkerland.ai），2026-10-22。GSAP 字节随渲染镜像分发，决定按第 13 节写进 09。
  - **Cloudflare 账户已具备**，2026-10-22 已升级 Workers 付费计划。执行 Agent 需要的凭据和准备项见第 9.6 节。
  - **Chromium 沙箱已实测可用**：2026-10-22 在 Cloudflare Containers 上 3 次探针均为 SANDBOX_FULL（第 5.5 节）。
  - **按需调度已实测可用**：2026-10-22 本账户直接可用 `scheduling_policy: "durable_object"`，同一应用按次启动 standard-1（1 核、4.2 GiB）、standard-3（2 核、8.2 GiB）与自定义 1 vCPU/3 GiB 均生效，就绪 0.7–4.0 秒（第 9.1 节）。
  - **安全保留、确定性降级**：负责人 2026-10-22 决定（D4、第 5.6 节）。
  - **前置实测（2026-10-22）**：断网、broker、令牌隔离、页面攻击、取消、OOM、跨机器确定性、接缝容差、2D/3D 单帧耗时已在 Cloudflare 上实测，结论见附录 A，已据此修改正文。
  - **项目未上线，不考虑历史兼容。** 旧 profile、旧契约、本地 JSONL 研究链路和它们的测试、证据一律删除或重写，不保留冻结层或迁移路径。PRD 升到 **v3.0**，协议升到 **3.0.0**。

---

## 0. 目标与边界

**目标**：模型按 huashu-motion 的页面合同写作品（HTML/CSS/JS、SVG、Canvas、GSAP、OM 运行时、Three.js），PromoBento 在 Cloudflare 上用"可信导演 + 断网分段渲染容器 + 可信观测 + 接缝检查"完成以下环节：

- 创作、方向比较、改稿；
- 7 个目标的准备；
- 成片输出。

性能、成本、安全三项同时达标，并保持 PRD 的版本、计费、冻结和事实约束。

**不变的约束**：

- 15/30 秒、30 fps，`config/platform-presets.json` 的 6 个平台预设、7 个 `targetId`（`presetId:aspectId`，Instagram Feed 有 feed 与 square 两种画幅）与编码 profile；本文"目标"均指 `targetId`；
- 两类首发用户；Cloudflare 技术栈；
- PRD 14 的版本模型、CAS、`contentHash` 去重、冻结快照、费用账本；
- AGENTS.md 的工具链与提交规则。

**本方案不做**：网站页面、登录、Waffo 支付、邮件。这些按原 PRD 推进。本方案只提供它们要调用的创作与渲染后端 API，以及嵌入式预览播放器和评论采集组件。

**完成后的状态**：

- 作品只有一种形态：`browser-v1`。
- QuickJS、`canvas-commands-v1`、`canvas-media-v1`、几何和媒体准入链路、已审阅 fixture 宿主、GSAP-QuickJS 探针，全部从仓库删除（删除清单见第 3.3 节）。
- 本地开发与云端走**同一条代码路径**：`wrangler dev` 用本机 Docker 运行同一个 Container 镜像，D1、R2、Queues、DO 由 Miniflare 在本地提供。不再有单独的本地研究控制器。

---

## 1. 关键决策

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| D1 | 作品采用 huashu-motion 页面合同，capability profile 为 `browser-v1` | PRD 13 §1 的目标范围本来就是自由的 HTML/CSS/JS/WebGL。GSAP 可用后，上游的运行时、模板、经验和模型熟练度可以全部复用，不再翻译成绘图命令 |
| D2 | 执行单位是**渲染分段**：每段一台 Cloudflare Container 实例（每实例独立 Firecracker microVM），`enableInternet=false`，除本段 broker 令牌（只能读写本段声明的键，见第 9.2 节）外无任何凭据，只读输入，单次使用后销毁 | VM 级隔离加断网加无长期凭据，作品代码即使逃出 Chromium，也只能拿到本段已经可见的输入和本段的输出位置 |
| D3 | 导演 Agent 运行在可信层（Durable Object），通过**工具调用**操作工程和渲染；模型密钥只在 Worker | 与上游"Agent 写、看、改"的循环一致，又不把密钥放进执行作品代码的机器 |
| D4 | 确定性只做产品真正需要的部分：注入虚拟时钟和固定随机源、纯 seek；分段接缝用重叠帧比对；交付冻结成片字节，不要求日后重渲染出相同字节 | 负责人 2026-10-22 决定"安全保留、确定性降级"：接缝跳变用户看得见，必须查；跨机器逐像素复现、旧镜像重放和独立复核实例没有对应的用户价值 |
| D5 | 按帧段并行：段长为 15 帧的整数倍，闭合 GOP，各段同参数编码，`concat` 无重编码拼接；音轨只渲染一次 | 突破单实例 4 vCPU 的上限，30 秒片在 1–2 分钟内完成 |
| D6 | 可信观测：文字框、实际使用的字体、可点区域、安全区，全部由容器内的可信控制器经 CDP 读取，**不读作品自报** | 作品能改 DOM，但改不了 CDP 读到的实际布局和字体 |
| D7 | 交互预览在用户浏览器里运行：同一 bundle 放在跨源 sandbox iframe 中，CSP 只允许预览 origin 自身；运行时文件（含 GSAP、Three.js）、获准字体和素材由预览 origin 按 `runtimeVersion` 从 R2 提供（第 9.4 节 `runtime/`）；云端只产出关键帧、低清预览片和成片 | 实时预览零服务器成本，和上游 studio 同构；预览不作为 QA 证据（协议已规定） |
| D8 | 素材：Browser Run 抓取产品官网（`grab`），用户上传走 R2 预签名；统一进资产容器处理，负责人确认权利后按摘要登记 | 实现上游的"真实素材优先"，又守住 PRD 的授权规则 |
| D9 | 多目标：一份响应式源码读取 `__omTarget`，7 个目标确定性派生；只有 Q1 失败的目标才调用 Agent 定点修 | 避免上游 `fork` 每个画幅都要整轮 Agent 改稿的成本 |
| D10 | 许可：GSAP（负责人决定）、Three.js r186（MIT）、上游代码（MIT）、字体（OFL）、采样只用 CC0；不加片尾署名，不用作者形象 | 客户委托作品不能带第三方署名，也没有地方放 CC-BY 署名 |

**和此前建议的差异**：之前推荐过"CSS 当数据、作品留在 QuickJS"。在 GSAP 可用、目标是一次到最终版、并且有 D2 的 VM 级隔离和 D6 的 CDP 可信观测的前提下，D1 的上游保真度更高、工程量更小，安全由 D2、D6 和第 10 节保证。代价是确定性从"结构保证"变成"运行时约束加接缝检查"，强度见第 5.6 节。

---

## 2. 总体架构

```
浏览器（客户）
  └─ Studio 预览 iframe（独立 origin，CSP 禁网）── 运行同一 bundle，0.5 倍清晰度
        │ 评论、点选（regionId 来自预览 hit-test，提交前由云端用 CDP 复核）
        ▼
Worker  api.promobento（鉴权占位，按 12 接入）
  ├─ OperationDO（每个创作、改稿、准备操作一个）：导演 Agent 步进机、预算、账本、CAS
  ├─ RenderDO（每次渲染一个）：分段计划、派发、接缝检查、拼接、QA、发布
  ├─ AssetDO（每个素材处理一个）：抓取、上传后处理、ASR、权利状态
  ├─ Queues：outbox 派发（按 04），失败重试只由应用层控制
  ├─ D1：业务记录（第 9.3 节）
  ├─ R2（私有）：源码、素材、分段、成片、证据（第 9.4 节）
  └─ Containers（scheduling_policy = durable_object：DO 启动时按渲染器登记表指定镜像和实例规格）
       ├─ RenderContainer  固定版本 chrome-headless-shell（当前锁定 151.0.7922.34）、ffmpeg、控制器、motion-runtime、字体登记
       │     模式与规格：shard / still / check standard-3；audio standard-1；assemble standard-3（见第 5.2 节）
       └─ AssetContainer   standard-4：ffmpeg、whisper.cpp、图片处理、字体校验
              模式：probe | extract | proxy | asr | tts | fontcheck
外部
  ├─ 模型 API（Anthropic、OpenAI），只从 Worker 和 DO 调用
  └─ Browser Run：grab 抓取（可信端），只在 AssetDO 中使用
```

容器与外界唯一的通路是 `outboundByHost` 下的 `http://broker.internal`（明文 HTTP 只走 Cloudflare 内部出站处理器，不出公网，因此不开 `interceptHttps`，也不向镜像注入临时 CA）。处理函数运行在 Worker 里，校验任务令牌后，只放行这次任务声明过的 R2 读写。容器内看不到 R2 凭据，也看不到模型密钥。

---

## 3. 仓库改造

### 3.1 最终目录

```
apps/
  cloud/               Worker、OperationDO（导演）、RenderDO、AssetDO、协调 DO、Container 类、broker、
                       D1 迁移、wrangler 配置。导演 Agent 的全部逻辑在这里（src/director/**）
  render-container/    渲染容器：Dockerfile、HTTP 入口、浏览器控制器、CDP 观测、分段编码、
                       声音合成（creative-audio 迁入）、拼接、Q0 静态检查
  asset-container/     资产容器：Dockerfile、probe、extract、proxy、asr、tts、fontcheck、grab 后处理
packages/
  contracts/           重写：只含 v3.0 Schema 的校验、规范化、摘要与身份计算（canonical/digest/identity 等底层保留）
  motion-runtime/      vendor 上游 v0.2.0 的 runtime（om-engine、om.js、camera-rig、clip、three）加 PromoBento shim
  preview-player/      客户浏览器端的 iframe 宿主、bridge、评论采集，供将来的网站引用
  methods/             导演方法包（上游 v0.2.0 改写版，带版本与内容摘要）
  fonts/               字体登记目录与 WOFF/WOFF2 文件（渲染容器与预览共用）
contracts/
  （保留并按 v3.0 改写：m0a-economics.schema.json、production.schema.json、agent-api.json，
   以及仍描述 v3.0 结构的 *.example.json；只服务旧 profile 的 example 按第 3.3 节删除）
  browser-source.schema.json      browser-v1 源包清单
  render-job.schema.json          渲染任务、分段计划、分段回执、接缝报告
  frame-observation.schema.json   CDP 观测
  agent-tools.schema.json         导演工具的输入输出
  direction.schema.json           方向卡（按上次评审 A5 的字段）
  treatment.schema.json           节奏单、beat map、能量曲线、连续性链
  audio-plan.schema.json          声音计划（从 creative-audio Schema 改写）
  production.schema.json          按 PRD 14 v3.0 重写
  composition.d.ts                重写：只描述 browser-v1 页面合同（替代 composition-runtime.d.ts）
  render-protocol.d.ts            重写为 3.0.0：预览 bridge、分段 Seek/Sample、Observe 命令
research/
  m0a/                 重写为"云端管线对上游本地 skill"的对照（第 12.6 节）
scripts/
  sync-upstream.mjs    比较 vendor 与上游指定提交，输出逐文件 diff 与许可变化
  check-repo.mjs 等    保留并按新结构更新
```

### 3.2 移植上游 v0.2.0（`packages/motion-runtime/vendor/huashu-motion/`）

1. 按 `4236053` 原样复制以下文件，保留根目录 `LICENSE`、`THIRD_PARTY.md` 和 `runtime/clip/NOTICE.md`、`runtime/clip/LICENSE`、`runtime/three/LICENSE`：
   - `runtime/om.js`、`runtime/camera-rig.js`；
   - `runtime/clip/**`，但 `lib/toon.js` 和 `grammars/y4_storytime.js` 除外，见第 2 条；
   - `runtime/three/**`（three r186，即 0.186.1 的 bundle，以及 `om-three.js`）；
   - `runtime/om-engine.js` 只作为参考复制，**不在页面中加载**。它依赖真实的 `setTimeout`、rAF 和 `performance.now()`，并把 `tl.seek(t, false)` 写死在 seek 里，与第 4.2 节的 shim 冲突。可信引擎由 PromoBento 自写（第 5 条）；
   - `templates/**` 中除 `storytime` 外的 11 个模板，作为导演的起步参考和 `test:browser` 的对照语料，仅放在 vendor 目录，不进作品可见的 `/runtime/` 路径。
2. **`toon.js` 与 storytime**。上游 THIRD_PARTY 写明，"豆子花叔"形象是作者本人的卡通肖像，不在 MIT 范围内；而 `keynote-ui`、`whiteboard`、`kinetic-type`、`finance-chart`、`vox-collage`、`kurzgesagt`、`math-3b1b`、`storytime` 8 个模板都加载 `toon.js`。处理方式：
   - 新建 `packages/motion-runtime/src/toon.js`，**仍是经典脚本**，挂到 `window.TOON` 全局，加载顺序与上游一致（在 `clip.js` 和 grammar 之前）。收录上游 `toon.js` 的通用部分：`flat`、`glow`、`vgrad`、`circle`、`ellipse`、`env`、`mouth`、`poseAt`、`blinkAt`、`alive`、`sweat`、`mark`，以及它们依赖的 `TOON.POSES`（上游第 35–42 行）和 `LINE` 常量（第 34 行）。删除角色绘制函数 `TOON.bean`（第 43 行起）及其专属代码。
   - 新写原创中性角色 `TOON.figure(c, o)`，参数对象和返回值与 `TOON.bean(c, o)` 相同（`o` 含 `x`、`y`、`s`、`pose`、`expr`、`mouth`、`blink`、`squash` 等，返回 `{hl, hr, head}`）。形象要求：几何化，无标志性服饰和配饰，配色取自项目品牌色。
   - 不复制 `grammars/y4_storytime.js`，改写为 `packages/motion-runtime/src/grammars/y4_storytime.js`，调用 `TOON.figure`；自写 `storytime` 模板。
   - Q0 增加规则 `third-party-likeness`：源码里出现 `TOON.bean` 或引用上游 `toon.js` 即 BLOCK。
3. 字体别名：上游代码里的字体族名在 `packages/fonts` 的登记表里映射到实际文件。例如上游 `fonts/LICENSES.md` 写明，代码里的 `PuHui-*` 就是 Noto Sans SC 500–900 的子集，所以 `PuHui-Black` 映射到 Noto Sans SC 900，其他同理按字重对应。映射表进入 `runtimeVersion` 身份；作品不能引用登记表以外的字体。
4. GSAP 3.14.2 的 `gsap.min.js` **不纳入 Git**，仓库只保存锁定项：`apps/render-container/environment.lock.json` 的 `gsap` 项记录下载地址与完整 SHA-256（实施时从上游 `templates/blank/vendor/` 的同版本文件计算完整 64 位摘要，本文的 `c174bfce…8280` 只是缩写，不能直接用作校验值），附带 `GSAP-LICENSE.html` 和 `GSAP-LICENSE.txt`。构建时下载、校验摘要后放入镜像的 `/runtime/gsap.min.js`；`cloud:deploy` 把同一份已校验字节和许可文件上传到 R2 `runtime/<runtimeVersion>/`，供预览 origin 分发（D7）。`.gitignore` 排除下载缓存目录。
5. PromoBento 自己的运行时代码放在 `packages/motion-runtime/src/`，不改 vendor 文件：
   - `shim.js`：页面最先执行的初始化脚本，内容见第 4.2 节；
   - `engine.js`：可信引擎，以上游 `om-engine.js` 为参考改写（保留 MIT 来源说明）。提供与上游相同的 `window.__omEngine` 接口（`seek`、`duration`、`media`、`setFrames` 等），使 `om.js`、`om-three.js` 和模板无需修改；内部使用 shim 交出的私有真实计时器，seek 时调用 `tl.seek(t, true)`；并实现 `RendererCompositionBridge`；
   - `signature-off.js`：强制 `data-om-signature="off"`；
   - `target.js`：注入 `__omTarget`；
   - `extras.js`：`packages/composition-runtime` 中与 `om.js` 不重复、仍有价值的纯函数。
6. 方法包 `packages/methods/`：先从现有 `apps/agent-runner/methods/`（基于 `5f2608c`）复制，再重建到 `4236053`，补入 v0.2.0 的 `skills/huashu-motion/references/depth.md`、`provenance.md` 和 SKILL.md 的变化（一句话需求流程、开头力度、真实素材优先、3D 默认方向）。不收录：`about-author.md`，签名和 `om share` 段落，macOS 专属条目，HyperFrames 历史。经验条目里提到 GSAP 的部分全部保留。
7. 字体 `packages/fonts/`：从 `packages/composition-runtime/vendor/huashu-motion/fonts/`（42 个 WOFF 与 `registry.json`）和 `apps/renderer/src/admission-font-catalog.mjs` 迁出，再与上游 v0.2.0 的 `fonts/` 对齐。每个文件都按上游 `fonts/LICENSES.md` 核对许可。同时生成 WOFF2 版本。渲染容器与预览都通过 `/f/<fontId>/<weight>.woff2` 加载同一份 WOFF2 字节，保证两边字形一致；WOFF 原件只作为来源与度量依据保留。两种格式的摘要都登记，WOFF2 摘要进入 `runtimeVersion` 身份。
8. 声音：`apps/renderer/src/creative-audio/**` 迁入 `apps/render-container/src/audio/`，并把它对 `contracts/admission-resources`、`admission-audio-rights`、`admission-audio-file-rights`、`creative-audio-tools.schema.json` 的引用改到新的 `audio-plan.schema.json`。`OM.music`、`OM.sfx`、`om-score` 的声明由可信端解析（第 8.2 节）。

### 3.2a 可复现的镜像构建（渲染与资产容器共用规则）

交付冻结的是成片字节（D4），不要求不同镜像版本渲染出相同像素，所以这里只要求"可追溯、尽量稳定"，不要求逐包可复现：

- 基础镜像写成 `ubuntu:24.04@sha256:<digest>`，digest 记录在 `environment.lock.json`。
- Chromium 归档、Node、npm 依赖（lockfile）、GSAP、whisper.cpp 模型按摘要下载校验；apt 包不强制锁版本，可以用 `snapshot.ubuntu.com` 固定时间点，但不是门禁。
- 构建后导出 `dpkg-query -W` 包清单，摘要和镜像 digest 一起写进渲染器登记表和每份分段回执，用于排查"换镜像后画面变了"，不做两次构建一致的 CI 检查。
- 网络适配只通过构建参数传入，不写进镜像层：`HTTP(S)_PROXY`（Docker 预定义参数，不进入构建缓存键）和可选的 `APT_MIRROR`。2026-10-22 实测负责人本机经代理访问 archive.ubuntu.com 约 6 KB/s，清华镜像约 500 KB/s。
- **镜像推送在 CI 完成**：2026-10-22 从负责人本机向 `registry.cloudflare.com` 推送约 1.5 GB 镜像时，200 MB 以上的层反复 `broken pipe`（关闭代理也一样），所以 `cloud:deploy` 只在 GitHub Actions 运行，本机只做 `cloud:dev`。

### 3.3 删除清单（不保留兼容层；可复用的部分先迁移，再删除）

删除前，对每个被删路径执行一次全仓库 `grep`，把所有引用方一并改掉或删掉。

| 删除 | 先迁出的部分 |
| --- | --- |
| `apps/renderer/` 整个目录，包括 `docker/`、`environment.lock.json`、`admission.*.json`、`fontconfig.conf` | `frame-capture.mjs`、`ordered-capture.mjs`（截图与按序编码）、`audio.mjs`、`media-assets.mjs`（PTS 选帧）、`woff-metrics.mjs`、`admission-font-catalog.mjs`（并入 `packages/fonts`）、`creative-audio/**`、`creative-diagnostics.mjs`、`render-diagnostics.mjs`、`edit-evidence.mjs`、`browser-bundle.mjs` 与 `environment.mjs`（浏览器归档校验）、`environment.lock.json`（改写为新镜像的锁文件）迁入 `apps/render-container/`，按新结构改写 |
| `apps/agent-runner/` 整个目录 | `methods/**` 迁入 `packages/methods`；`costs.mjs`、`model-call.mjs`、`openai.mjs`、`method-library.mjs`、`experience.mjs`、`edit-evidence.mjs`、`audio-binding.mjs` 迁入 `apps/cloud/src/director/`；`store.mjs` 不迁，改为 D1 实现 |
| `packages/composition-runtime/` 整个目录 | `vendor/huashu-motion/fonts/**` 迁入 `packages/fonts`；与 `om.js` 不重复的纯函数迁入 `packages/motion-runtime/src/extras.js` |
| `contracts/admission-*.json`、`composition-runtime.d.ts`、`composition.example.json`、`creative-audio-tools.schema.json` 以及只为旧 profile 服务的 example 文件 | 仍有用的字段在新 Schema 中重写；在新 Schema 就位、引用方改完之后才删 |
| `research/gsap-quickjs/`、`tests/research/` | 无 |
| `tests/fixtures/admission/`、`tests/fixtures/render/` 以及依赖它们的测试 | 无，用第 12.2 节的语料替代 |
| 引用上述路径的脚本与测试：`scripts/prepare-render-ci.mjs`、`scripts/refresh-fixture-hashes.mjs`、`scripts/check-repo.mjs`（第 44、105 行等）、`scripts/check-production-contracts.mjs`（`globalContainers` 断言）、`scripts/output-safety.test.mjs`、`scripts/preview-policy.mjs` 与其测试、`scripts/production-contracts.test.mjs`、`scripts/repo-documentation.mjs` 与其测试、`tests/m0a/benchmark.test.mjs` | 按新结构改写；纯粹服务旧链路的直接删除 |
| `package.json` 与 `.mise.toml` 中的 `render:fixture`、`test:render`、`build:admission`、`render:admission`、`test:admission`、`test:admission-media`、`agent:local`、`creative:tools`、`creative:audio`、`test:creative`、`test:creative-audio`、`install:renderer` | 替换为第 13 节的新任务 |
| CI 的 `render`、`admission`、`media-output`、`creative` job | 替换为 `browser`、`cloud-local` 两个 job |
| PRD 与文档中描述上述内容的段落，`docs/creative-toolkit.md` | 按第 13 节重写 |
| `quickjs-emscripten` 依赖 | 无 |

---

## 4. browser-v1 作品合同

### 4.1 源包

```
source/
  index.html          唯一入口；根元素带 data-composition-id、data-width、data-height（取 __omTarget 的值）
  *.js / *.css / *.svg / *.json    作者文件；不超过 64 个，合计 ≤ 8 MiB，不含二进制
  values.json         可编辑值（`SourceValues` 规范在 v3.0 契约中重写，语义不变）
```

- 运行时库不由作者打包，由可信宿主在固定路径提供：
  - `/runtime/gsap.min.js`、`/runtime/om.js`、`/runtime/three.min.js`、`/runtime/om-three.js`、`/runtime/toon.js`、`/runtime/clip/*`。
  - `shim.js`、`engine.js`、`target.js`、`signature-off.js` 由控制器注入，作品不能引用，也不能覆盖。
  - 版本由 `runtimeVersion` 决定，进入源码身份。
- 素材只能用 `/r/<resourceId>` 引用，视频抽帧由 `OM` 通过 `/r/<resourceId>/frames/<n>.webp` 读取（对应 R2 `frames/<sha256>/<n>.webp`），字体只能用 `/f/<fontId>/<weight>.woff2`。宿主按 `resources.json` 与项目权利放行，其他路径一律 404。
- 允许：DOM、SVG、Canvas2D、WebGL1/2（SwiftShader）、内联与外部脚本、CSS 动画（由引擎接管时间）、GSAP 全部核心插件（以随镜像分发的为准）、Three.js。
- 禁止。渲染时由运行时 shim 报错（Q0 静态检查只作提示）；网络另由容器断网兜底。CSP 主要用于客户浏览器里的预览 iframe（那里有网络），渲染页面同样带上。2026-10-22 本地实测：CSP 能拦下全部外部请求、`eval`、`new Function`、WASM，但**拦不住** `localStorage`、IndexedDB、cookie，这三项必须由 shim 禁用：
  - 网络：`fetch`、XHR、WebSocket、EventSource、`navigator.sendBeacon`，以及外部的 `<img src>`、`url()` 和 `@import`；
  - `Worker`、`SharedWorker`、`ServiceWorker`、`WebAssembly`；
  - `eval` 和 `new Function`（CSP 不加 `unsafe-eval`）；
  - 存储：`localStorage`、IndexedDB、cookie；
  - 音频播放：`AudioContext`，声音全部走声明式（第 8.2 节）；
  - `<video>`，视频只能通过 `OM` 的抽帧显示接口使用。
  - `<iframe>`（含 `srcdoc`）：2026-10-22 实测 CSP 下 `srcdoc` iframe 里的脚本仍会执行，且不受作品主时间轴控制。shim 禁止创建，Q0 判为 BLOCK。
- `values.json` 与 `data-composition-variables` 必须一致。可编辑类型沿用 `EditableProperty`（text、number、color、asset、boolean、enum、data，以及 group 和 `affectsTiming`）。
- 点选：用 `data-om-id` 和 `OM.region` / `OM3.region`；场景用时间轴标签 `scene:<id>`。
- 时长：根元素必须有 `data-duration`，取值为 15 或 30，与项目一致。场景标签落在片长之后时报 `scene-after-end`（页面层检查，见第 7 节 Q1）。

### 4.2 运行时保证（`shim.js`，通过 `Page.addScriptToEvaluateOnNewDocument` 在任何作者脚本之前执行；`engine.js` 紧随其后注入）

shim 分两个阶段生效：

- **加载阶段**：从页面创建到引擎宣布就绪（`init` 完成）。three.js 的加载器等库代码需要真实计时器，所以这一阶段 `setTimeout` 和 rAF 照常可用。时钟仍然是虚拟的。
- **渲染阶段**：`init` 之后，下面的限制全部生效。

具体规则：

- **私有真实计时器**：shim 在覆盖全局之前，先把真实的 `setTimeout`、`clearTimeout`、`requestAnimationFrame`、`performance.now` 保存在闭包里，只交给随后注入的 `engine.js` 一次（交接后删除交接口）。引擎用它们做绘制等待和超时，作者代码拿不到。
- **时间**：两个阶段都生效。`Date`、`Date.now`、`performance.now`、`performance.timeOrigin` 返回虚拟时间 `T`；加载阶段 `T = 0`，渲染阶段由引擎在每次 seek 时设置。
- **rAF**：渲染阶段的 `requestAnimationFrame` 回调进入队列，seek 后由引擎以时间戳 `T` 刷新，至多 2 轮（对应上游的 `paintWaits` 默认值 2）。
- **绘制等待**：seek 后等待绘制的上限取 `frameTimeoutMs`，不能沿用上游 `om-engine` 写死的 5 秒。2026-10-22 实测 `object-3d` 在 standard-3 上首帧绘制约 31 秒、之后每帧 3.5–4.5 秒，5 秒上限会稳定报"rAF never fired"。
- **定时器**：渲染阶段调用 `setTimeout`、`setInterval` 即抛 `RUNTIME_TIMER_FORBIDDEN`。
- **随机**：`Math.random` 替换为新定义的 `random-seq-v1`：以项目 seed 和调用序号做哈希（算法写进契约并附固定向量；它不同于按字符串键取值的 `random-at-v1`）。调用序号依赖执行顺序，所以**每次 seek 前把序号重置为 0**，同一时刻的调用序列因此一致。`crypto.getRandomValues` 抛错。`om.js` 自带的种子随机不受影响。
- **GSAP**：
  - `gsap.ticker.lagSmoothing(0)`，并移除自动 ticker；
  - 所有在 `__timelines` 注册的时间轴 `pause()`；
  - 引擎调用 `tl.seek(t, true)`，抑制回调，从源头消除带状态 `onUpdate` 造成的历史依赖（上游用 `seek(t, false)`）；
  - `OM.clock(tl, draw)` 不受影响：它通过代理对象的属性 setter 驱动 `draw`，静默 seek 也会触发。引擎**不再额外调用** `draw(t)`，否则每帧会画两次。
- **CSS 动画**：每次 seek 时，对 `document.getAnimations()` 的每一项执行 `pause()` 并设 `currentTime = T*1000`。`transition` 在 Q0 中报 REVIEW（`css-transition`），渲染阶段检测到 `transitionrun` 事件即报错。
- **字体**：容器内的 fontconfig 只包含字体登记目录。页面用 `@font-face` 指向 `/f/...`。`document.fonts.ready` 后才视为 ready，等待超时由引擎用私有真实时钟计算；页面设置的回退字体不能突破登记范围。
- **视频**：上游 `extract` 模式。抽帧由资产容器预先完成（第 8.1 节），页面通过 `OM` 拿到对应 PTS 的帧图；缺帧即 `VIDEO_FRAME_UNAVAILABLE`。
- **目标**：`window.__omTarget = {id, width, height, aspect, safeInsets, fps:30, totalFrames}`，作者必须据此布局，构图只看这一个对象。
- **WebGL**：Chromium 启动参数 `--use-angle=swiftshader --enable-unsafe-swiftshader`。2026-10-22 探针在 Cloudflare standard-3 上实测：沙箱开启时 WebGL 2.0 可用，渲染器为 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`。渲染器登记表记录 `webgl: 'swiftshader'` 和该渲染器字符串，控制器每次启动核对，不一致即 `RENDER_ENVIRONMENT_MISMATCH`（平台错误）。

### 4.3 握手

页面就绪的条件：`__omReady` 为 true，fonts.ready 完成，所有 `OM3.ready` 和图片解码完成，且未超过 `initTimeoutMs`。随后控制器发 `init`，再逐帧发 `seek`，每帧时限为 `frameTimeoutMs`，沿用 `config/agent-policy.json`。

---

## 5. 渲染管线

### 5.1 渲染任务（`render-job.schema.json`）

```
RenderJob {
  renderId, operationId, revisionId?, candidateId,
  sourceHash, runtimeVersion, rendererRelease,      // 渲染器登记表中的精确镜像 ID
  targetId, durationSeconds, totalFrames,
  quality: 'still' | 'preview' | 'final',            // preview = 0.5 倍像素、无运动模糊
  renderProfile: RenderProfile,                       // final 时可为 sampleCount 4|8、shutterAngle 180
  resources: [{resourceId, sha256, kind}],
  audioPlanHash?, frozenAudioHash?,
  frames?: number[]                                    // 仅 still/check
}
```

### 5.2 步骤（RenderDO 驱动；每步结果写 D1 和 R2 后才推进，可幂等重放）

1. **准备**（Worker 内完成，无容器）：校验源包 Schema；计算 `sourceHash`；确认资源权利和摘要；查询渲染器登记表；预留费用（按第 11 节的估算取最坏值）。
2. **声音**（RenderContainer `audio`，启动时指定 standard-1）：按冻结的 AudioPlan 合成 48 kHz 双声道 WAV，检查响度和真峰值。只做一次，同一 `audioPlanHash` 复用。
3. **分段计划**：
   - 段长 `L = 15·k`。15 秒片默认 4 段（120/105/105/120 帧，均为 15 的倍数），30 秒片默认 8 段（每段约 112 帧，取 15 的倍数后为 105 或 120）。
   - preview 质量减半段数。
   - 段数上限受 `limits.shardsPerRender` 与工作区并发约束。
4. **分段渲染**（RenderContainer `shard`，启动时指定 standard-3，并行）：
   1. 启动固定版本的 Chromium，加载 bundle（来自 broker），完成握手；
   2. **冷启动 seek 到段首帧**，然后顺序渲染 `[a, b)`。运动模糊时每帧按 `centered-box-v1` 采 N 个子帧，在控制器内以浮点平均；
   3. 每帧：取截图 → 解码 RGBA → 计算 `sha256(RGBA)` → 送入 ffmpeg。除第一段外，每段在渲染 `[a, b)` 之前先冷启动 seek 到重叠帧 `a-1`，只记录摘要并另存无损 PNG，不编码；每段的末帧 `b-1` 也另存无损 PNG（第 5.6 节）；
   4. 在观测帧集合（第 7 节 Q1）上执行 CDP 观测；
   5. 编码：与最终 profile 相同的 x264 参数，且所有分段完全一致：宽高、`yuv420p`、profile 与 level、`-g 15 -keyint_min 15 -sc_threshold 0`、闭合 GOP、**`-bf 0`**（不用 B 帧，避免拼接处 DTS 不单调）、`-threads` 固定为实例 vCPU 数、VBV 按 `maxVideoBitrate`，**无音频**。输出为 Annex B 裸流 `shard.h264`，不封装成 mp4；
   6. 输出：`shard.h264`、`frame-hashes.json`、`seam-frames/*.png`（重叠帧与末帧）、`observations.json`、`receipt.json`。回执包括镜像 ID、Chromium 版本、CPU 型号与 `cpuFlagsHash`（`/proc/cpuinfo` 完整 flags 排序后的摘要）、宿主位置、沙箱状态（seccomp 与命名空间实测值）、`--disable-skia-runtime-opts` 状态、计时和内存峰值；
   7. 完成后控制器上报结果，RenderDO 立即对该实例调用 `stop()` 并丢弃其 DO，不等待 `sleepAfter`。
5. **接缝检查**（RenderDO 内，无容器）：按第 5.6 节比对相邻分段的末帧与重叠帧。
6. **拼接**（RenderContainer `assemble`，启动时指定 standard-3；standard-1 只有 0.5 vCPU，不足以在期限内完成下面的整片重编码兜底）：
   - 按顺序把各段 Annex B 裸流首尾相接（同参数、闭合 GOP、无 B 帧，可以直接拼接），以 `-r 30` 一次封装成 mp4，同时混入冻结音轨（AAC，按 profile），`faststart`。
   - 用 ffprobe 核对：总帧数、PTS 连续且单调、CFR、每 15 帧一个关键帧、宽高与像素格式。
   - 码率：分段各自满足 VBV 不等于整条码流满足。拼接后按 1 秒滑动窗口计算整片码率，超过 `maxVideoBitrate` 时在 assemble 内对整片重编码一次（同参数、整片 VBV），并在回执中记录 `reencoded:true`。
   - 生成 poster 和关键帧 PNG。
7. **QA**（第 7 节）：Q1 观测汇总，Q2 运动诊断，片长 ≤ 30 秒，文件 ≤ 50 MB。
8. **发布**：结果写入 R2 `out/`，D1 记录 `renders.status = passed | blocked`，结算费用，通知 OperationDO。交付和订单绑定 `film.mp4` 的字节摘要；之后的下载、交付都用这份字节，不重新渲染。派生其他目标是新的渲染，按 QA 判定，不与原片比像素。

### 5.3 期限（全部写入 `config/agent-policy.json` 新的 `render` 段，替代单一的 600 秒）

| 阶段 | 期限 |
| --- | --- |
| 容器冷启动加握手 | 30 秒；页面用到 WebGL 时 60 秒（实测 WebGL 首帧绘制约 31 秒）（探针实测：沙箱开启时浏览器启动 1.4–2.9 秒，另加实例冷启动） |
| 分段：每帧 | `frameTimeoutMs`（2D 5 秒；用到 WebGL 时 10 秒，实测最慢一帧 4.5 秒），运动模糊时乘以子帧数 |
| 分段：整段 | `段帧数 × 0.6 秒 + 30 秒`，运动模糊时按子帧数放大。探针实测 1080p 单帧 PNG 截图 50–140 毫秒（首帧 110–180 毫秒，简单页面），0.6 秒/帧为复杂页面、观测和编码留出余量，M0b 用模板语料复标 |
| 拼接（只封装和混音） | 60 秒 |
| 拼接（含整片重编码兜底） | `总帧数 × 0.2 秒 + 60 秒`（30 秒片 240 秒），只在码率窗口超限时使用 |
| 整次渲染 | `基础期限 × max(1, sampleCount / 2)`；基础期限为 final 30 秒片 300 秒、final 15 秒片 180 秒、preview 120 秒；运动模糊时同时把段数加倍（受 `shardsPerRender` 限制）；触发整片重编码兜底时，整次期限顺延该项期限。超时标为 `RENDER_DEADLINE`，不交给模型修 |

各项期限在 M0b 用探针和实测的单帧耗时复标（第 12.3 节）。

模型调用和工具执行的期限分开计算（第 6 节），不共用一个计时器。

### 5.4 失败分类（白名单，替代当前的黑名单正则）

- **作品错误**，作为工具结果返回给导演修复：
  - Schema 或源包校验失败；
  - Q0 规则命中；
  - `RUNTIME_*`（定时器、网络、存储、eval 等被拦截）；
  - `INIT_TIMEOUT`、`FRAME_TIMEOUT`、`DRAW_FAILED`、`PREPARE_FAILED`；
  - `RENDER_SEAM_BLOCK`；
  - 字体回退或缺字（`FONT_FALLBACK_USED`、`FONT_GLYPH_MISSING`）；
  - 文字裁切、遮挡、越出安全区、对比度不足；
  - 内存超限（`RENDER_OOM`）、页面崩溃。控制器检测到的渲染进程 OOM 或崩溃直接归入此类；整台实例被重启或消失（Cloudflare 的 OOM 会重启实例，宿主维护也会停止实例，两者无法从外部区分）先按平台错误换新实例重试一次，同一分段再次发生才判为 `RENDER_OOM`；
  - 运动诊断中标为 BLOCK 的项。
- **环境或平台错误**，不调用模型，直接按 04 的应用重试策略处理或停止：
  - 容器无法启动、镜像不匹配、`RENDER_ENVIRONMENT_MISMATCH`（WebGL 渲染器等与登记表不符）、`RENDER_SANDBOX_UNAVAILABLE`（沙箱自检失败）；
  - broker 拒绝、R2 或 D1 不可用；
  - 控制器自身异常、ffmpeg 异常；
  - 拼接失败、超出整次渲染期限；
  - 预算、取消、授权、清理问题。
- 每类各有固定错误码。补测试逐项覆盖，包括上次评审 P1 表里的全部情况。
- **环境预检**：第一次付费模型调用之前，先确认渲染器登记表、容器镜像可启动（每个部署做一次健康探针并缓存 10 分钟）、broker 与 R2 可用。预检失败时一分钱不花就停止。

### 5.5 Chromium 启动参数（固定在控制器代码里，作品不能改）

```
--no-first-run --disable-background-networking
--disable-component-update --disable-sync --disable-extensions --disable-default-apps
--mute-audio --hide-scrollbars --force-color-profile=srgb --font-render-hinting=none
--disable-lcd-text --disable-skia-runtime-opts --disable-partial-raster
--use-angle=swiftshader --enable-unsafe-swiftshader
--js-flags=--max-old-space-size=2048
```

- 不使用 `--deterministic-mode`：它会打开 BeginFrame 控制，帧、rAF 和截图只能由 `HeadlessExperimental.beginFrame` 推进，与本方案的截图和绘制等待方式不兼容。确定性由第 4.2 节的 shim 和第 5.6 节的接缝检查保证。
- **Chromium 沙箱必须开启**（Playwright `chromiumSandbox: true`）。Dockerfile 以非 root 用户（uid 10001）运行控制器和 Chromium，不加任何 capability。2026-10-22 探针（`chrome-headless-shell 151.0.7922.34`、standard-3、断网、3 个新实例，内核 `6.18.54-cloudflare-microvm`）3 次均为 **SANDBOX_FULL**：渲染进程有 seccomp-BPF（`Seccomp: 2`）、嵌套 PID 命名空间（`NSpid` 3 层）和独立 user 命名空间（`uid_map` 为 `10001 10001 1`）；关闭沙箱的对照组三项都没有。所以沙箱降级不再是待决事项。
- 控制器在每次启动后、加载作品前做同样的自检：找到全部 `--type=renderer` 进程（Chrome 会改写进程标题，参数可能以空格而非 NUL 分隔），确认 seccomp 为 2、`NSpid` 多于一层、`uid_map` 与 browser 进程不同。任一不满足即 `RENDER_SANDBOX_UNAVAILABLE`，属于平台错误，**不得降级为无沙箱**，也不调用模型。
- 页面 CSP：`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; media-src 'none'; connect-src 'none'; worker-src 'none'`。允许内联脚本，因为作品代码本来就整体不可信，CSP 在这里的作用是禁网和禁 eval，不是区分脚本来源；上游模板都使用内联脚本。

### 5.6 确定性：运行时约束加接缝检查

按负责人 2026-10-22 的决定（D4），只检查用户看得见的问题：

- **运行时约束**：第 4.2 节的虚拟时钟、`random-seq-v1`、计时器禁用和静默 seek 照常执行；Q0 的 `random`、`clock`、`raf`、`interval` 规则提示导演改写。
- **接缝检查**：每个接缝 `a`，比对上一段顺序渲染得到的末帧 `a-1` 与下一段冷启动渲染的重叠帧 `a-1`：
  - 摘要相同：通过。
  - 摘要不同：用两张无损 PNG 做容差比对（逐通道最大差 ≤ 2，差异像素 ≤ 0.1%）。这是常态而不是例外：2026-10-22 实测 `kinetic-type` 冷启动帧与顺序渲染帧摘要从不相同，差异都是最大 1 个色阶、0.003–0.010% 像素的抗锯齿噪声，预渲染若干帧也不能消除；3D 模板实测则完全相同。通过时记录 `seamTolerance:true` 和两段的 `cpuFlagsHash`；不通过判为 `RENDER_SEAM_BLOCK`（作品错误，说明作品有历史依赖），连同两张 PNG 返回导演。
- **不再做**：独立复核实例、随机抽帧乱序复核、按 CPU 特性分类的判定、旧镜像重渲染冻结快照。段内的历史依赖不检查：段内本来就是顺序渲染，和上游 `om render` 一致。
- 预览与成片只要求"看起来一致"：预览是 0.5 倍、可能在不同机器上，QA 和交付只以 final 成片为准。

接缝检查不需要额外实例；每段多渲染一帧，成本可以忽略。

---

## 6. 导演 Agent

### 6.1 形态

- 一个操作对应一个 OperationDO，内部是可持久化的步进机，每一步执行"一次模型调用"或"一次工具执行"。每步的输入、输出和费用写入 D1，DO 重启后从最后一步续跑。
- 模型适配器提供 `anthropic`（Messages API，原生 tool use）与 `openai`（Responses API，由现有适配器改写并补 tool calling），共用由 `model-call.mjs` 改写的接口：精确 token 预估、预留、usage 结算、未知用量保留最坏值。
- 方法包作为可缓存的静态前缀。Anthropic 用 `cache_control` 标记，OpenAI 利用自动前缀缓存。缓存命中写入成本事件的 `cachedInputTokens`。
- 结构化输出：最终提交的方向卡、Treatment、AudioPlan 通过 `submit_*` 工具传入，工具参数由 JSON Schema 约束（`agent-tools.schema.json`）。

### 6.2 工具（`agent-tools.schema.json`；每次调用都计费并写账本，工具错误以结构化结果返回模型）

| 工具 | 执行位置 | 作用 | 对应上游 |
| --- | --- | --- | --- |
| `project_context` | DO | 返回题目、已确认事实（带 factId）、受众、目标、片长、获准资源与字体清单（附缩略图）、品牌色、声音选择、v0.2.0 一句话需求的默认值 | SKILL 第 1 步 |
| `method_recall(topics[], stage)` | DO | 按题目和阶段召回方法正文，不整包注入 | references |
| `fs_write / fs_read / fs_list / fs_delete` | DO + R2 | 读写候选工作区，限制见第 4.1 节 | 编辑文件 |
| `check(target?)` | RenderContainer `check` | Q0 静态规则，加 12 帧 0.5 倍清晰度的 Q1 观测；返回 findings | `om check` |
| `still(times[] \| frames[], target, scale, crop?)` | RenderContainer `still` | 返回 PNG 给模型，crop 用于局部放大（2 倍） | `om still`、`om look` |
| `preview(target)` | RenderDO（preview 质量） | 低清全片，返回 Q2 运动曲线、每秒缩略图拼图和 findings | `om render` + `om qa` |
| `palette(sets[])` | DO（纯 JS） | 色板与雷同提示 | `om swatch` |
| `sound_plan(plan)` | RenderContainer `audio` | 校验并合成 AudioPlan，返回事件表、拍点网格、响度 | `om sound` |
| `voice_align(resourceId)` | AssetContainer `asr` | 对已确认的旁白返回逐词时间（超过 1.2 秒的词标记待复核） | `om voice` |
| `materials()` | DO | 列出获准素材（含 grab 结果），附尺寸、主色和缩略图 | `materials.md` |
| `submit_directions(cards[3])` | DO | 方向卡，Schema 校验后触发关键帧渲染 | 三方向 |
| `submit_treatment(treatment)` | DO | 节奏单，同时运行 Treatment 检查（第 7 节） | rhythm |
| `submit_candidate(note)` | DO | 冻结工作区为候选，触发 final 渲染、接缝检查与 QA；`note` 是给用户的改动说明 | `om done --note` |

### 6.3 流程

**创作（探索模式）**

1. `project_context` → `materials` → `method_recall`。
2. 写 3 个方向的最小工程，各自只做最难的一个镜头。
3. 对每个方向用 `still` 取 4 张关键帧。
4. `submit_directions`，状态变为 `awaiting_user`。
5. 用户选择方向，可以按层混合：构图、配色、节奏、声音各自取自不同方向。
6. `submit_treatment` → 完整工程，循环执行 `check`、`still`、`preview`、修改。
7. `sound_plan`。
8. 冷审（第 7 节 Q3a）。
9. `submit_candidate`。

**直接制作**：省略第 2–5 步。

**改稿**

1. 一轮可以包含多条钉在画面上的评论（上限沿用 `maxCommentsPerRound` 5 条、4,000 code points），只计一次。
2. 每条评论携带帧号、坐标、云端用 CDP 复核过的 `regionId`、场景、当前变量。
3. Agent 读源码和评论后修改，执行 `check` 和 `still`（针对评论帧）。
4. `submit_candidate(note)`：note 写明 Agent 对每条评论的理解。
5. 用户回"不太对"时作为同一线程的 follow-up 处理，是否计次按 05 的产品决定。

**准备 7 个目标**

1. 无模型的确定性渲染：对每个缺失目标并行执行 final 渲染。
2. 只对 Q1 有 BLOCK 的目标启动 Agent 修复。修复后的源码必须重新渲染全部已准备目标的关键帧：摘要不变的目标保持就绪，摘要变化的目标重跑 Q1。
3. 费用上限为 `maxMicrosPerTargetPreparation`。

### 6.4 预算与限制（写入 `agent-policy.json`；费用值按第 6.5 节填写，下列次数和墙钟为初值；全部在 M0b 实测后由负责人复核修订。`enabled` 保持 `false`，研究调用只按第 6.5 节的授权放行）

- 每个操作：最多模型调用次数、最多工具调用次数（建议初值为创作 80、改稿 30、目标修复 15）、墙钟上限（创作 25 分钟，改稿 10 分钟）、费用上限（沿用现有字段）。
- 模型调用单独计时，`requestTimeoutMs` 沿用；工具按第 5.3 节的期限执行。
- 上次评审 P1：作品错误回给模型，环境错误不回模型，`BUDGET` 一词不再用于时间期限（`RENDER_DEADLINE`、`FRAME_TIMEOUT`）。

### 6.5 模型、价格与预算授权（负责人 tianyu 已于 2026-10-22 批准）

**模型**：导演用 `claude-opus-5-5`；冷审（Q3a）和不需要强推理的工具辅助调用用 `claude-sonnet-5-5`。适配器保留 OpenAI，但本次授权不包括 OpenAI 的调用。

**价格表** `config/model-prices.json`（新增，进仓库；单位为每百万 token 的整数 USD micros；`priceVersion` 进入每条成本事件）：

```json
{
  "priceVersion": "anthropic-2026-10-22",
  "source": "https://platform.claude.com/docs/en/models/opus-5-5/overview ; https://platform.claude.com/docs/en/models/sonnet-5-5/overview",
  "checkedAt": "2026-10-22",
  "models": {
    "claude-opus-5-5":   {"input": 4000000, "cacheWrite5m": 5000000, "cacheWrite1h": 8000000, "cacheRead": 200000, "output": 20000000},
    "claude-sonnet-5-5": {"input": 2000000, "cacheWrite5m": 2500000, "cacheWrite1h": 4000000, "cacheRead": 100000, "output": 10000000}
  }
}
```

费用计算必须区分普通输入、缓存写和缓存读三种计价，以供应商返回的 usage 为准；usage 缺失时保留最坏预留（按全部输入计普通输入价、输出按上限）。

**预算**：写入 `config/agent-policy.json` 的 `cost` 段（单位 USD micros）。

| 字段 | 值 |
| --- | --- |
| `priceVersion` | `"anthropic-2026-10-22"` |
| `maxMicrosPerCreativeRun` | 10000000（$10） |
| `maxMicrosPerPatch` | 3000000（$3） |
| `maxMicrosPerTargetPreparation` | 3000000（$3） |
| `maxMicrosPerQualityReview` | 1000000（$1） |
| `dailySoftAlertMicros` | 50000000（$50） |
| `maxDailyFreeMicros` | 0（内测期不开放免费用户） |
| `maxMicrosPerUserWindow` | 30000000（$30） |
| `maxMicrosPerProjectWindow` | 20000000（$20） |

其余仍为 `null` 的费用字段保持 `null`，对应功能保持关闭。这些值是标定前的起点，M0b 跑完后按实测账单修订，修订须经负责人确认。

**研究授权** `config/model-authorization.json`（新增，进仓库，不含任何密钥）：

```json
{
  "purposes": ["m0b_calibration", "m0a_comparison"],
  "providers": ["anthropic"],
  "models": ["claude-opus-5-5", "claude-sonnet-5-5"],
  "priceVersion": "anthropic-2026-10-22",
  "approvedBy": "tianyu (tianyu@tinkerland.ai)",
  "approvedAt": "2026-10-22T18:12:00+08:00",
  "expiresAt": "2026-12-31T23:59:59+08:00",
  "maxUsdMicros": 300000000
}
```

- 导演每次付费调用前，同时检查：授权未过期、累计实际与未结算费用加本次预留不超过 `maxUsdMicros`、模型在授权列表中、价格版本一致。任一不满足即停止，不调用模型。
- 累计额按 D1 成本账本计算，跨操作、跨重试、跨部署环境累加，不因新建操作或重新部署而清零。
- `agent-policy.json` 的 `enabled` 仍为 `false`：授权只开放负责人发起的研究调用，不开放给其他用户。本方案不做登录（第 0 节），所以预发布环境用 Cloudflare Access 保护 `api` 路由，只允许负责人的身份；OperationDO 以 Access 签发并经 Worker 校验的身份断言识别请求者，不信任请求体里的自报身份。正式登录按 12 接入后改用会话身份。
- M0a 基线臂（第 12.6 节）由本地 coding agent 驱动，同样不持有 Anthropic 密钥：它通过预发布 Worker 的受控模型代理调用，代理执行同样的授权检查、预留和 D1 记账。

**负责人在 Claude Console 完成**（执行 Agent 不接触）：

1. 新建 Workspace `promobento-staging`（之后生产另建 `promobento-prod`），月度消费上限设为 $350，作为授权总额之外的最后一道兜底，并设置提醒。
2. 在该 Workspace 下创建 API Key，用 `wrangler secret put ANTHROPIC_API_KEY` 写入预发布 Worker。

---

## 7. QA

| 层 | 检查 | 实现 | 级别 |
| --- | --- | --- | --- |
| Q0 静态 | 上游 `check.js` 中不需要执行页面的源码规则：`random`、`clock`、`raf`（只允许经 `OM.clock`）、`interval`、`infinite-repeat`、`css-transition`（这 6 条在上游是警告，这里定为 REVIEW；对应的运行时调用在渲染阶段由 shim 直接报错）、`layout-motion`、`missing-file`、`outside-project`、`duplicate-id`、`font-not-shipped`、`script-syntax`、`no-root`、`root-size`、`several-compositions`、`placeholder`、`no-real-material`、`only-logo`、`no-materials-list`；以及本方案新增的 `third-party-likeness`、禁用 API（第 4.1 节）。级别：缺文件、越出工程、语法错误、无根元素、禁用 API、第三方形象为 BLOCK，其余为 REVIEW | `apps/render-container/src/check.mjs`，基于 AST（acorn）加 HTML/CSS 解析，不执行源码 | BLOCK / REVIEW |
| Q1 观测 | 观测帧集合：关键帧、每个场景标签首尾、每秒 1 帧。CDP 读取以下内容：`DOM.getBoxModel` 得到文字框、`CSS.getPlatformFontsForNode` 得到实际字体（检测回退和缺字）、元素背景与前景色得到对比度（WCAG 4.5:1 / 大字 3:1）、文字是否越出安全区；按上游命名报 `text-cut`、`text-clipped`、`text-covered`、`text-overlap`、`blank-frame`、`low-contrast`；页面层规则 `scene-after-end`（读取时间轴标签）；`data-om-id` 的可见区域（供点选）。作者可用上游的 `occlusion` 豁免属性声明有意的遮挡 | `apps/render-container/src/observe.mjs`，在分段容器内对实际帧执行 | BLOCK / REVIEW |
| Q2 运动 | 迁入的诊断（单帧突变、硬切、静止段、逐秒运动曲线），**加上 v0.2.0 的两条**（与上游一样，只对 ≥ 6 秒的片子生效）：开头平淡（前 5 秒最强一秒 < 1.5，或有 ≥ 1.5 秒的静止）、全片几乎不动（均值 < 0.6 且每分钟切换 < 3 次）。阈值沿用上游标定，在 M0b 用 PromoBento 的样片复标 | `apps/render-container/src/diagnostics.mjs` | REVIEW（导演必须处理或写明理由） |
| Q2 声音 | 响度按平台预设的 `loudnessTarget`（默认 −14 LUFS，现有 6 个预设都用默认值），true peak ≤ −1 dBTP；音画落点；频谱空洞 | 迁入的声音实现，响度目标从预设读取 | BLOCK / REVIEW |
| Q2 Treatment | 3 秒（90 帧）内有起点；30–60% 处有一段能量高点；除计划停顿外，不连续两小节以上没有新事件；每个转场都写明连续性链 | `apps/cloud/src/director/treatment-check.mjs`，对照实际运动曲线 | REVIEW |
| Q2 静音可读 | 信息流目标（TikTok、Reels、X 等）：关键信息有上屏文字；有旁白时必须有字幕轨，内容来自已确认的转写稿 | Q1 观测文字与 Treatment 对照 | BLOCK |
| Q2 事实 | 上屏文字和旁白中的商业主张，必须绑定已确认的 factId（按 14 §8） | 观测文字对照事实清单 | BLOCK |
| Q3a 冷审 | 独立模型调用，不带导演上下文。只给：需求、成片的每秒缩略图拼图和关键帧、选定方向、Treatment、上屏文字出处表、需核实事实。必答"从第几秒开始走神"。报告绑定成片摘要 | `apps/cloud/src/director/cold-review.mjs`，计入 internal_repair 预算 | BLOCK 项触发一轮修复 |
| Q3b 人工 | 用户或负责人按 05 和 14 的审核回执 | 审核回执（语义沿用原本地实现，存入 D1） | — |

**QA 自检**：`tests/qa-mutants/` 放故意破坏的作品，包括缺字、越界、定时器、网络请求、历史依赖、开头静止、未绑定事实的价格。每条规则都必须能检出对应样例，否则判为 CI 失败。

---

## 8. 素材与声音

### 8.1 素材（AssetDO 加 AssetContainer）

- **grab**：AssetDO 调用 Browser Run，打开用户给出的产品网址（只允许负责人填写的域名），抓取以下内容，写入 R2 `quarantine/`，状态为 `pending_rights`：
  - 1920×1080 和 1080×1920 两种视口的截图；
  - logo，取 SVG 或最大的 favicon 与 og:image；
  - 计算样式里的主色和字体名称。
- **上传**：R2 预签名 PUT 到 `quarantine/`，限定大小和 MIME。
- **处理**（AssetContainer，断网）：
  - `probe`：ffprobe，检查是否 VFR、是否 HDR（HDR 拒绝）；
  - `extract`：按 PTS 抽帧成无损 WebP 序列加索引，即上游的 `frames.js` 方案；
  - `proxy`：生成 0.5 倍预览代理；
  - 图片转为 sRGB，保留原尺寸，长边超过 3840 像素时缩到 3840；
  - 字体：校验 OFL 或用户上传字体的授权证据，做 cmap 覆盖检查并子集化；
  - `asr`：whisper.cpp（固定模型摘要）生成带逐词时间的转写稿，状态为 `pending_confirmation`。
- **权利确认**：负责人确认来源、用途、证据（沿用项目 `rights` 结构）后，素材从 `quarantine/` 移入 `res/<sha256>`，登记进 `resources`。字体的 `projectApproved` 由此产生。
- 解码预算按素材实际尺寸和帧数计算，取消固定的 320×180 上限（上次评审 P3.2）。

### 8.2 声音

- 作品中的 `OM.music(...)`、`OM.sfx(name, at)`、`<script type="text/vnd.abc" id="om-score">` 只是声明。可信端在 `check` 阶段，用一次专用的 0 帧观测读出声明，生成 `AudioPlan`，由 RenderContainer `audio` 合成。页面内的 `AudioContext` 一律禁用。
- 采样只用 CC0 子集，每个事件都带 `licenseRef`。自由 ABC 乐谱需要单独的音源权利记录，结构写进 `audio-plan.schema.json`（由原 `admission-audio-rights` 的字段改写）。
- 片长精确到 N/30 秒：配乐不向上取整到整小节，余音在片长内收尾；时序变化后的重算走无模型路径。
- 旁白：用户上传，ASR 转写稿由用户确认（流程同事实确认），然后用于字幕轨、`OM.cue` 锚点和事实绑定。TTS（Kokoro）作为可选的 AssetContainer 模式 `tts`，由 `config/input-capabilities.json` 开关控制，默认关闭。

---

## 9. Cloudflare 部署

### 9.1 `apps/cloud/wrangler.jsonc`（要点）

- Worker：`compatibility_date` 用实施当天的日期，`nodejs_compat`。
- 绑定：D1 `DB`；R2 `BUCKET`（私有）；Queues `OUTBOX`；DO：`OperationDO`、`RenderDO`、`AssetDO`、协调 DO；Browser Run `BROWSER`；Secrets：`ANTHROPIC_API_KEY`、`BROKER_SIGNING_KEY`。`OPENAI_API_KEY` 只在 OpenAI 获得授权后才写入，当前不设置（第 6.5 节）。
- Containers（按 2026-10-22 的 Cloudflare 文档核对：[调度策略](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)）：
  - 两个 Container 应用 `RenderContainer`、`AssetContainer`，都用 `scheduling_policy: "durable_object"`（beta）。镜像在 `images` 中登记，例如 `"images": {"render-r1": {"dockerfile": "../render-container/Dockerfile"}}`；已发布版本改用摘要固定的 `registry.cloudflare.com/<ACCOUNT_ID>/<repo>@sha256:<digest>`，每个应用最多 100 个具名镜像。
  - 这种策略下 wrangler 的 `instance_type` 与 `max_instances` 都不生效。DO 调用 `this.ctx.container.start({ image: this.ctx.container.images[<release>], instance: 'standard-3', enableInternet: false })`；`start()` 在容器就绪前返回，控制器的 `/ready` 探测通过后才算启动完成（计入第 5.3 节的 30 秒冷启动期限）。规格：shard / still / check / assemble 用 standard-3（2 vCPU、8 GiB、16 GB），audio 用 standard-1，资产处理用 standard-4（4 vCPU、12 GiB）。
  - 并发上限不再由 `max_instances` 兜底，只由第 9.5 节的协调 DO 计数保证。
  - 调度策略创建后不可修改，改策略等于新建应用。2026-10-22 已在本账户实测可用（无需另行申请）；新建 `apps/cloud` 应用时直接用此策略。若日后不可用，退路是每种规格各建一个 Container 类（同一镜像、不同 `instance_type`）。
  - 渲染器登记表（D1 `renderer_releases`）记录每个版本对应的 `images` 键和镜像摘要；交付冻结的是成片字节，旧镜像在没有进行中的渲染后即可下线（登记表状态改为 `retired`）。
- Container 类设置：
  - 类属性 `enableInternet = false`，启动时再次显式传 `enableInternet: false`；不开 `interceptHttps`（第 2 节）；
  - `outboundByHost = { 'broker.internal': brokerHandler }`，必须在 `static { this.outboundByHost = … }` 中赋值（经库的静态 setter 注册）；写成 `static outboundByHost = …` 类字段不会注册，实测请求被代理以 520 "Origin is disallowed" 拒绝。不设 `allowedHosts`，也不设兜底 `outbound`，其他一律拒绝；Worker 入口模块按 `@cloudflare/containers` 的要求重新导出 `ContainerProxy`；
  - `sleepAfter` 只是兜底（设为 `30s`）：分段完成后由 RenderDO 主动调用 `stop()`，不依赖空闲超时。控制器是容器里的 1 号进程，**必须显式处理 SIGTERM**（否则信号被忽略）：实测未处理时 `stop()` 后 20 秒任务仍在运行、状态仍为 healthy；处理后 48 毫秒内中止、状态变为 stopped。
  - 控制器只在真正的任务请求结束后退出；平台会先向端口发就绪探测，探测请求不能触发退出（实测会导致"Container suddenly disconnected"）。
- 每个渲染分段使用新的 DO ID（`render:<renderId>:shard:<n>:<attempt>`），保证不复用实例。

### 9.2 broker（`apps/cloud/src/broker.mjs`）

- RenderDO 为每个分段签发令牌：HMAC，载荷为 renderId、shard 编号、允许读的 R2 键列表、允许写的键前缀、过期时间（期限加 60 秒）。令牌经容器启动环境变量传入。令牌本身不含 R2 凭据。
- 读请求：`GET http://broker.internal/r/<key>`，校验令牌与键白名单，从 R2 流式返回。
- 写请求：`PUT http://broker.internal/w/<key>`，校验前缀、大小上限（分段裸流 `shard.h264` ≤ 40 MB，单张接缝 PNG ≤ 12 MB，JSON ≤ 4 MB，成片 `film.mp4` ≤ 50 MB）和内容类型。
- 请求日志写入成本和审计计数。同一令牌的写入次数有上限。

### 9.3 D1

在 PRD 14 的数据库约束清单之上增加以下表。字段与 14 冲突时以 14 为准，并同步修改 14：

- `operations`、`operation_steps`（模型调用和工具调用的逐步记录、费用引用）、`cost_events`（沿用 `costEvent` 结构）
- `candidates`、`candidate_files`（指向 R2）、`directions`、`treatments`、`audio_plans`
- `renders`、`render_shards`、`render_seams`、`observations`（摘要与 R2 指针）
- `resources`、`resource_rights`、`asset_jobs`、`transcripts`
- `comment_threads`、`comments`（含 `followUpOf`）
- `renderer_releases`：镜像 ID、Chromium、ffmpeg、GSAP、Three、runtimeVersion、字体登记版本、状态（active / retired / revoked）

导演的账本、预留与结算、审核回执、CAS、操作幂等重放，按原有语义在 D1 上重写（`apps/cloud/src/store/`）。不再保留 JSONL 实现；本地开发由 Miniflare 提供 D1。

### 9.4 R2 键

```
src/<sourceHash>/...            不可变源包
res/<sha256>                    已确认素材
quarantine/<assetJobId>/...     待确认（生命周期 7 天）
frames/<sha256>/<n>.webp        视频抽帧
audio/<audioPlanHash>.wav
renders/<renderId>/shards/<n>/{shard.h264,frame-hashes.json,seam-frames/*.png,observations.json,receipt.json}
renders/<renderId>/seams.json
renders/<renderId>/out/{film.mp4,poster.png,keyframes/*.png,report.json}
stills/<sourceHash>/<target>/<frame>@<scale>.png
```

预览和 still 的生命周期为 72 小时（`temporaryPreviewHours`）。`renders/<renderId>/shards/` 是中间产物，保留 7 天（用于排查）；`quarantine/` 7 天。被快照、订单或 `docs/evidence/` 引用的对象不过期：引用登记在 D1，R2 生命周期规则只作用于未被引用的前缀，由每日任务把被引用对象复制到不过期的 `retained/` 前缀后再允许过期。

### 9.5 并发

`config/agent-policy.json` 的 `limits` 用以下字段替代 `globalContainers: 4`：

- `globalShardInstances`、`workspaceShardInstances`、`shardsPerRender`、`globalAssetInstances`。
- 初值分别为 64 / 16 / 8 / 8，M0b 实测后调整。64 个 standard-3 分段约 128 vCPU、512 GiB，远低于账户默认的并发上限（1,500 vCPU、6 TiB 内存，可申请提高）；运动模糊段数加倍时同样受这些字段限制。

RenderDO 获取全局许可时由一个全局协调 DO 计数，超出时排队，不报错。

---

### 9.6 账户准备（负责人在 Cloudflare 控制台完成，执行 Agent 不接触控制台）

1. Workers 付费计划（Containers 只在付费计划上可用）。已于 2026-10-22 完成。
2. Containers 与 `scheduling_policy: "durable_object"` 已于 2026-10-22 实测可用；Browser Run 待 AssetDO 实施时确认。
3. 创建预发布与生产两套 D1 数据库、R2 桶（私有）、Queues，名称写入 `apps/cloud/wrangler.jsonc` 的两个环境。
4. 创建一个 API Token 给部署用：从 "Edit Cloudflare Workers" 模板开始，补上 D1、R2、Queues、Containers、Browser Rendering 的编辑权限，只限这一个账户。具体权限项名称以创建页面为准，按最小够用原则勾选。 2026-10-22 已创建（含 Containers、D1、Queues、R2、Browser Run、Workers Observability 的 Edit 权限，限本账户与 `promobento.com`）。
5. 凭据放置位置：
   - `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 放在 GitHub Actions 的仓库 secrets（供 `cloud:deploy` 与 `test:cloud`），本地开发放在 shell 环境变量，**不写进仓库、不贴进对话或模型上下文**； 两者已于 2026-10-22 写入 `ten2ten2/promobento` 的 Actions secrets。
   - 运行时密钥（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`BROKER_SIGNING_KEY`）用 `wrangler secret put` 分别写入预发布和生产 Worker。
6. 预发布环境用独立的域名或 `workers.dev` 子域，预览 iframe 使用独立 origin（按 14 的 preview 配置）。

## 10. 安全清单（全部要有自动测试）

1. 渲染与资产容器：`enableInternet=false`；只有 `broker.internal`；DNS 外泄测试（解析任意域名应失败或只到 Cloudflare DNS，且无法携带数据出去）。
2. 容器内没有任何长期密钥。分段令牌只在控制器进程内存中：控制器启动后读取并立即从自身环境删除，启动 Chromium 时传入白名单环境（不含令牌），令牌也不写入文件系统。测试：作品尝试读取环境变量、`/proc/self/environ`、`/proc/<控制器pid>/environ`、文件系统，**看不到令牌**；令牌只能访问本分段的键。
3. 每个分段用新实例；分段之间无共享磁盘；控制器结束前清除临时文件。即使清除失败，也由实例销毁兜底。
4. Chromium 沙箱开启并通过第 5.5 节的启动自检，否则拒绝运行；测试用关闭沙箱的启动确认自检能报 `RENDER_SANDBOX_UNAVAILABLE`。
5. 攻击语料 `tests/attacks/browser-v1/` 只保留关键项：外部 `fetch` 与 `img`（渲染时由容器断网兜底，预览时由 CSP 拦截）、Worker、WASM、eval、`localStorage`/IndexedDB/cookie（CSP 拦不住，必须由 shim 报错）、定时器、无限循环与内存耗尽（期限和内存上限兜底，控制器能收到渲染进程 crash 事件，2026-10-22 本地已实测）、试图改写 `__omEngine` 或伪造就绪握手。每条都要求得到预期错误码。DOM 爆炸、超大 canvas 不单列，由期限和内存上限覆盖。
6. QA 不读作品自报：文字、字体、区域、对比度全部来自 CDP；点选 `regionId` 由云端用 CDP 复核后才写入评论。
7. 预览 iframe：独立 origin（按 14 的 preview 配置）、`sandbox="allow-scripts"`、无主站 cookie、bridge 校验 origin、source、nonce、session、schema。
8. 模型输出只作为数据写入工作区；工具参数全部经 Schema 校验；外部素材和网页中的文字只当内容（按 13 §3）。
9. 成本：每次模型调用和工具调用之前先预留，未知用量保留最坏值；预算耗尽立即停止，不调用模型修复。

---

### 10a. 可观测性

- 结构化日志：Worker、各 DO、broker 和容器控制器的每条日志都带 `operationId`、`renderId`、`shard`、`attempt`、`rendererRelease`，容器日志经 Workers Logs 汇集；日志中不出现令牌、密钥、用户素材内容或提示词正文。
- 指标（Workers Analytics Engine）：实例启动数与运行中实例数、冷启动耗时、握手耗时、单帧耗时分布、分段与整次墙钟、接缝检查结果、各错误码计数、每次渲染与每个操作的费用。
- 告警：运行中实例数超过 `globalShardInstances` 或在 `stop()` 后 60 秒仍为 running（探针曾观察到空闲实例不按 `sleepAfter` 释放）；`RENDER_SANDBOX_UNAVAILABLE`、`RENDER_ENVIRONMENT_MISMATCH` 任意一次；每日费用超过 `dailySoftAlertMicros`；`RENDER_SEAM_BLOCK` 比例突增。
- 第 11 节与第 12.3 节的 p50、p95 和费用都从这些指标计算，不另做临时统计。

## 11. 性能与成本目标（M0b 必须实测；未达到时调整段数或实例规格，并更新本节数值）

**墙钟目标（p50）**：

| 任务 | 目标 |
| --- | --- |
| final 30 秒 1080p（8 段） | ≤ 90 秒 |
| final 15 秒（4 段） | ≤ 60 秒 |
| preview 30 秒 | ≤ 45 秒 |
| `still` 4 帧 | ≤ 15 秒 |
| 7 个目标准备（各目标并行） | ≤ 6 分钟 |
| 含 3D（SwiftShader）的 30 秒片 | ≤ 300 秒。实测每帧 3.5–4.5 秒、首帧绘制约 31 秒，900 帧约需 3,300 秒 CPU 时间，需 24 段左右（`shardsPerRender` 对 WebGL 作品提到 24）；计算费用约 $0.2/片。180 秒目标在无 GPU 的 standard-3 上做不到 |

**计算成本估算**（Cloudflare Containers 价目：CPU $0.00002/vCPU·秒，只按实际使用计；内存 $0.0000025/GiB·秒）：

- 每个 standard-3 分段约 50 秒：CPU 按实际使用计，最多 2 × 50 × 0.00002 = $0.002；内存与磁盘按**已分配**量计，内存 8 × 50 × 0.0000025 = $0.001，磁盘 16 × 50 × 0.00000007 ≈ $0.00006。合计约 $0.003。冷启动（典型 1–3 秒）的分配时间另计，约 $0.0001；分段完成即 `stop()`，没有空闲时间。每个实例还对应一个 Durable Object，其请求与时长费用另计，量级可忽略但要进入成本事件。
- 30 秒 final：8 个分段、1 次拼接、1 次声音，约 **$0.03**（不再有复核实例）。
- 7 个目标约 **$0.2**。

模型费用另计，由第 6.4 节的预算约束。目标在 M0b 用真实账单校准，写入 `m0a-economics` 结构。

---

## 12. 测试与验收

### 12.1 单元测试（`mise run test`）

- 新 Schema：正例与反例；规范化和摘要的固定向量。
- 分段计划：任意时长和段数下都是 15 的倍数、覆盖完整、无重叠。
- 失败分类：覆盖每个错误码。
- broker 令牌：越权键、过期、写入超限。
- 存储：D1 迁移与查询在 Miniflare 上测试，覆盖 CAS 冲突、操作重放、未知用量预留与对账。
- Q0 规则：每条一个正例和一个反例。
- Treatment 检查、冷审输入构造、预算预留与结算。

### 12.2 本地容器测试（新增 `mise run test:browser`；CI 新 job `browser`）

- 通过 `wrangler dev` 用本机 Docker 运行与云端**同一个镜像**，走同一套 Worker、DO 和 broker 代码。CI 中同样如此（Linux runner 带 Docker）。
- 渲染上游 v0.2.0 的 11 个模板（blank、finance-chart、keynote-ui、kinetic-type、kurzgesagt、math-3b1b、object-3d、talking-head、ui-space、vox-collage、whiteboard），以及自写的 storytime 模板，每个模板的 15 秒和 30 秒。
- 上游模板要先经过机械适配脚本 `packages/motion-runtime/scripts/adapt-upstream-template.mjs`，对照时两边用同一份适配结果：
  - `vendor/gsap.min.js`、`vendor/om.js`、`vendor/clip/...` 改为 `/runtime/...`；`toon.js` 改为 PromoBento 的 `/runtime/toon.js`；
  - `assets/fonts/*.woff` 改为 `/f/<fontId>/<weight>.woff2`，素材登记为测试资源并改为 `/r/<resourceId>`；
  - 根元素补 `data-duration`（15 或 30）；
  - `talking-head` 的 `<video>` 改用抽帧显示接口。
  - 上游模板把画幅写死为 1920×1080，所以对照只在 landscape 目标上进行；其他画幅只检查能否成片与 QA。
- 检查：
  1. 分段渲染与单段整片渲染的**编码前**逐帧 RGBA 摘要（`frame-hashes.json`）完全相同；编码后的成片只核对帧数、PTS、GOP；
  2. 接缝检查通过（含故意写入历史依赖的变异样例能被判为 `RENDER_SEAM_BLOCK`）；
  3. **与上游 `om render` 的对照**：同一份适配后的模板、同时长，用上游 CLI 渲染，逐帧比对 SSIM ≥ 0.98。上游 CLI 及其依赖装在单独的研究镜像 `render-container:research` 中（`FROM` 生产镜像，只加研究层），生产镜像与渲染器登记表都不包含它。偏差超过阈值的帧附截图进报告，由负责人判断差异是否来自有意的行为改动（例如回调抑制）。
- 攻击语料（第 10 节第 5 项）。
- QA 变异样例（第 7 节）。
- 运动模糊：8 子帧的 30 秒片，记录耗时倍数。

### 12.3 Cloudflare 验收（新增 `mise run test:cloud`，需要账户，缺账户时标为未验证）

- `wrangler deploy` 到预发布环境，运行以下检查：
  1. 隔离：攻击语料中的网络、环境变量和令牌越权项；
  2. 10 次串行加 4 路并发的 30 秒 final，记录 p50 和 p95 墙钟、冷启动、费用；
  3. 接缝：统计接缝摘要不一致和需要容差的比例，记录 `cpuFlagsHash` 分布；
  4. 取消：渲染中途取消，确认所有分段实例停止、R2 只有已提交对象、费用已结算；
  5. Chromium 沙箱状态：生产镜像复现探针的 SANDBOX_FULL，并记录到证据；
  6. 实例回收：分段完成后调用 `stop()`，确认实例状态变为 inactive。探针观察到两个空闲实例在 `sleepAfter = 2m` 之后 15 分钟仍为 running，并占满 `max_instances` 导致新请求返回 "Maximum number of running container instances exceeded"，所以并发计数必须以 `stop()` 后的实际状态为准，不能假定空闲超时会释放名额。
- 结果按 06 写入 `docs/evidence/`。

### 12.4 导演（离线 mock 加可选真实调用）

- mock provider 回放固定的工具调用脚本：创作、改稿、准备、冷审，以及失败分类下的修复和不修复。
- 真实调用按第 6.5 节已批准的 `config/model-authorization.json` 与 `config/model-prices.json` 执行；授权文件在仓库，累计费用由 D1 成本账本计算。授权过期、额度用尽或负责人尚未在 Console 写入密钥时不调用。

### 12.5 预览播放器

- `packages/preview-player` 用 Playwright 在 Chromium、Firefox、WebKit 下加载 iframe，测试 seek、变量覆盖和 hit-test。预览结果不作为 QA 证据。

### 12.6 M0a 对照（重写 `research/m0a/`）

- 对照的问题改为：**PromoBento 云端管线（导演 + 渲染 + QA）做出的片子，是否达到上游作者本地工作流的水平。**
  - 基线臂：上游 `4236053` 的 skill 加 `om` CLI，由同一模型驱动的本地 coding agent 执行，在研究镜像 `render-container:research` 中渲染，模型调用经第 6.5 节的受控代理记账。
  - PromoBento 臂：`cloud:dev` 完整流程。
  - 两臂共用同一个费用账本（D1），共用修复上限和题目。
- 题目：软件 3 个、课程 3 个，各做 15 秒和 30 秒，共 12 组。至少 4 组使用有真实素材授权的自有产品。依赖音符事件的题目（例如 Duolingo Music）必须在声音目录里提供音符事件，否则替换。
- 盲评：每组至少 5 人，软件和课程两类受众分别达到下限，人数不足时汇总返回 blocker。
- 记录：费用、墙钟、改稿轮数、失败点、每增加一个目标的费用和时间、静音可读、事实覆盖。
- 退出条件："愿意发布"比例不低于基线臂。
- 旧的 `run-pair.mjs`、`baseline-*.mjs` 等按新流程重写，不保留旧格式的报告兼容。

---

## 13. 文档与配置更新清单（与代码同一次改动完成）

| 文件 | 修改 |
| --- | --- |
| 全部 PRD | 版本升到 v3.0、协议升到 3.0.0；删除描述 QuickJS、`canvas-*` profile、准入链路、fixture 宿主和本地研究控制器的段落，不留"已废弃"说明 |
| `docs/prd/13-agent-native-production.md` §1、§4、§5、§6 | §1 删去"生产运行时不依赖 GSAP"，写明 browser-v1 的页面合同与运行时保证；§5 已要求信息流目标无声可看懂卖点和 CTA，补充"有旁白时必须有来自已确认转写稿的字幕轨"，并写明它由 Q2 静音可读检查 BLOCK；§6 改为第 7 节的 Q0–Q3 |
| `docs/prd/09-sources-and-licensing.md` §2 | GSAP 使用决定（决定人 tianyu，2026-10-22；版本 3.14.2 与摘要；分发方式：进镜像不进 Git；产品含可视化改稿，决定人已知悉 GSAP 标准许可的相关条款并决定使用）；上游固定提交升级到 `4236053`；Three.js r186 MIT；CC0 采样；不加署名；"豆子花叔"不采用及原创替代角色 |
| `docs/prd/04-architecture-and-data.md` | 第 2 节架构图；分段容器、broker、`scheduling_policy`、D1 表、R2 键 |
| `docs/prd/14-production-contracts.md` | 按 v3.0 重写 §2（Manifest 与 capability profile 只有 browser-v1）、§5（RenderProtocol 3.0.0，分段与接缝语义）、§7（渲染状态机增加 sharding、verifying、assembling） |
| `docs/prd/08-codex-execution.md` | 里程碑改为：M0（本方案完成，本地 `cloud:dev` 全流程）、M0b（Cloudflare 验收，第 12.3 节）、M0a（第 12.6 节对照）；命令表换成新任务；Chromium 沙箱降级必须有书面决定 |
| `docs/prd/06-testing-and-release.md` §4 | 性能和成本门槛换成第 11 节 |
| `docs/creative-toolkit.md` | 删除；内容并入 13 和 `packages/methods/README.md` |
| `docs/implementation-status.md` | 按新结构重写，只描述现在实际具备和尚未验证的能力 |
| `config/agent-policy.json`、`config/model-prices.json`、`config/model-authorization.json` | agent-policy 新增 `render` 期限、`limits` 并发字段、导演工具次数上限，`cost` 段按第 6.5 节填写，`schemaVersion` 3.0.0；新增价格表与研究授权文件，并在 `check-production-contracts.mjs` 中校验三者一致 |
| `config/platform-presets.json` | 在 `presets[]` 每一项增加 `loudnessTarget`（单位 LUFS，现有 6 个预设都为 −14）；编码 profile 仍共用 `mp4_h264_1080_v1` |
| `.mise.toml`、`package.json` | 新任务：`build:containers`、`test`（单元）、`test:browser`、`cloud:dev`（`wrangler dev` 加本机 Docker）、`cloud:deploy`、`test:cloud`、`sync:upstream`；重写已有的 `benchmark:m0a`；删除第 3.3 节列出的旧任务 |
| `.github/workflows/checks.yml` | job：`contracts`（check:repo + 单元测试）、`browser`（第 12.2 节）、`cloud-local`（`cloud:dev` 全流程 mock） |
| `README.md`、`AGENTS.md` | 新结构与命令入口；AGENTS 的"创作代码只能在隔离环境运行"改写为分段实例规则；删除与旧 profile 相关的维护规则 |

---

## 14. 实施顺序（一次完成；按 AGENTS.md 提交，每次提交都要让当时仓库里存在的检查和测试通过）

原则：**先建新的、迁移引用，最后删旧的**。配置、`check-*` 脚本和使用它们的代码放在同一次提交里修改，不在后面单独补。

1. **契约与配置**：第 3.1 节的新 Schema 与 d.ts；`packages/contracts` 的校验、规范化、摘要入口；`config/agent-policy.json` 的 `render` 期限、新 `limits` 字段和导演工具上限；`config/platform-presets.json` 的 `loudnessTarget`；同时修改 `scripts/check-production-contracts.mjs`（不再断言 `globalContainers`）与相关测试。旧 Schema 暂时保留。
2. **字体与方法包**：从旧位置复制到 `packages/fonts`、`packages/methods`，与上游 v0.2.0 对齐，单测。旧位置暂时保留。
3. **motion-runtime**：vendor 上游 v0.2.0（第 3.2 节第 1 条的范围）；`toon.js` 拆分、原创角色与 `y4_storytime` 改写；字体别名；`shim.js`、`engine.js`、`target.js`、`signature-off.js`、`extras.js`；GSAP 锁定与下载校验；模板适配脚本。纯逻辑部分写 Node 单测。
4. **渲染容器**（`apps/render-container`）：迁入第 3.3 节列出的模块，把声音代码的 Schema 引用改到 `audio-plan.schema.json`；HTTP 入口；加载、握手、seek、截图、RGBA 摘要、子帧平均、CDP 观测、分段编码、回执、声音合成、拼接、Q0 检查；非 root 的 Dockerfile 与 `environment.lock.json`；`build:containers`。镜像构建完成后，在固定版本的 Chromium 中逐项验证 shim 的拦截。
4a. **云端检查点 G1（未通过不进入第 5 步）**：只用第 4 步的渲染容器加一个最小 Worker/DO（可在第 6 步中重写），在预发布账户上对上游 `kinetic-type`（GSAP + DOM）与 `object-3d`（Three.js + WebGL）两个模板各渲染 30 秒 landscape：
    - 分段加重叠帧渲染，接缝检查通过；另在 3 个独立实例上整片渲染，记录 `cpuFlagsHash` 分布与跨实例摘要是否一致（只作参考数据，不是门禁）；
    - Annex B 拼接后 ffprobe 检查帧数、PTS、GOP；
    - 实测真实镜像的大小、首次调度到新宿主的冷启动、握手、单帧截图（PNG 默认与 `optimizeForSpeed`、无损 WebP 对比）与每段墙钟，据此修订第 5.3 节期限、第 11 节目标和截图格式；
    - 实例在 `stop()` 后确实释放，并发计数正确；沙箱自检为 SANDBOX_FULL。
    - 结果按 06 写入 `docs/evidence/`。接缝不一致时先修 shim/engine，再继续。
    - 2026-10-22 已用简化实验预跑过一遍（附录 A），G1 仍须用第 4 步的正式渲染容器和完整 shim 重跑，并补上 30 秒时长与 3D 整片。
5. **资产容器**（`apps/asset-container`）：probe、extract、proxy、asr、tts、fontcheck；Dockerfile。
6. **云端**（`apps/cloud`）：Worker 路由、OperationDO、RenderDO、AssetDO、协调 DO、broker、Container 类、Queues outbox、D1 迁移、R2 键；分段计划模块 `src/render/plan.mjs`；接缝检查；失败白名单；环境预检；`cloud:dev`。
7. **导演**（`apps/cloud/src/director`）：迁入第 3.3 节列出的模块；Anthropic 适配器与 OpenAI tool calling；工具实现；探索、直接制作、改稿、准备、冷审流程；D1 上的预算与账本；离线 mock provider。
8. **QA**：Q1 观测汇总、Q2（含 v0.2.0 两条）、Treatment、静音可读、事实；QA 变异样例。
9. **预览播放器**：`packages/preview-player`。
10. **删除旧代码**：按第 3.3 节删除旧目录、旧契约、旧任务、旧 CI job、旧测试和引用它们的脚本；`check:repo` 增加"旧标识符不得出现"的检查。
11. **测试与 CI**：`test:browser` 全量（模板对照、攻击、变异、运动模糊）；`cloud-local`；`checks.yml` 改为三个 job。
12. **M0a 对照工具**（第 12.6 节）。
13. **文档**（第 13 节中的 PRD、README、AGENTS、实施状态）。
14. **云端验收**：有账户时运行 `test:cloud` 并写入证据；没有账户时在实施状态中列为未验证。

### 完成标准

- 仓库中不再有 QuickJS、`canvas-*`、admission、fixture 宿主和本地 JSONL 控制器的代码、契约、任务和文档描述（`check:repo` 增加一条检查：搜索这些标识符，命中即失败）。
- `mise run check:repo`、`mise run test`、`mise run test:browser` 全部通过；CI 的 `contracts`、`browser`、`cloud-local` 三个 job 通过。
- 上游 11 个模板和自写 storytime 模板经 PromoBento 管线成片，与上游对照 SSIM 达标；偏差帧都有书面结论。
- 攻击语料与 QA 变异样例全部按预期报错。
- `cloud:dev` 完成一次"创作 → 选方向 → 成片 → 改稿 → 准备 7 个目标"的 mock 全流程，账本可对账。
- 文档与配置按第 13 节更新，`implementation-status.md` 如实标注未验证项：Cloudflare 实测、真实模型、正常速度视听、盲评。

### 需要外部提供、缺失时不阻塞代码的输入

- 已具备：Cloudflare 账户（2026-10-22 已升级 Workers 付费计划，Containers 已可部署）；GSAP 使用决定；模型与预算授权（第 6.5 节）。
- 负责人待操作：Claude Console 的 Workspace、消费上限与 API Key（第 6.5 节末尾），Cloudflare 控制台准备（第 9.6 节）。
- 已实测：Chromium 沙箱在 Cloudflare Containers 上完整可用（第 5.5 节），无需降级决定。探针结果保存在负责人本机 `~/Downloads/sandbox-probe-results/`，M0b 时用生产镜像复测并按 06 写入 `docs/evidence/`。

---

## 附录 A：2026-10-22 前置实测

在负责人的 Cloudflare 账户上用临时实验（standard-3、断网、非 root、沙箱开启、上游 `4236053` 的 `kinetic-type` 与 `object-3d` 模板、虚拟时钟加静默 seek 的简化 shim）测得。实验分支与云端资源测后删除。

| 项目 | 结果 | 对正文的影响 |
| --- | --- | --- |
| 跨机器确定性（2D） | `kinetic-type` 在 3 台实例上整片 240 帧逐帧摘要完全相同，其中两台 CPU 不同（AMD family 25 model 1 与 model 17） | 第 5.6 节去掉跨 CPU 分类判定是安全的 |
| 接缝 | 冷启动帧与顺序帧摘要从不相同，差异最大 1 个色阶、≤ 0.010% 像素，全部在容差内；3D 模板完全相同 | 第 5.6 节容差比对是常态路径 |
| 拼接 | 4 段 Annex B 拼接后 240 帧、PTS 单调、每 15 帧一个关键帧、无 B 帧 | 第 5.2 节方案成立 |
| 2D 单帧耗时 | seek 约 35 毫秒，PNG 截图 125–300 毫秒，JS 解码 PNG 50–100 毫秒；model 1 主机约慢一倍；60 帧一段 17–38 秒 | 0.6 秒/帧期限够用；`optimizeForSpeed` 使解码快约 30%、摘要不变，默认开启 |
| 3D 单帧耗时 | 首帧绘制约 31 秒，之后每帧 3.5–4.5 秒（1080p、SwiftShader） | 第 4.2 节绘制等待、第 5.3 节期限、第 11 节 3D 目标已改 |
| 断网 | 外网 HTTP/HTTPS、直连 IP、DNS、TCP、UDP 全部超时失败 | 第 10 节第 1 项成立 |
| broker | 正确注册后 `GET /r/…` 返回 200，其他请求由处理函数返回 403 | 第 9.1 节注册方式已写明 |
| 令牌隔离 | 控制器删除自身环境中的令牌后启动 Chromium，7 个 Chromium 进程环境中都没有令牌，页面无 `process` | 第 10 节第 2 项成立 |
| 页面攻击（带 CSP） | 外部请求、Worker、WASM、eval、`new Function` 被拦；`localStorage`、IndexedDB、cookie、`srcdoc` iframe 脚本未被拦 | 第 4.1 节：存储与 iframe 由 shim 禁止 |
| 崩溃与死循环 | 内存炸弹约 4.7 秒后渲染进程崩溃，控制器收到 crash 事件，浏览器存活；死循环可由期限中止 | 第 5.4 节分类成立 |
| 控制器 OOM | 容器被直接终止，Worker 收到 "Container suddenly disconnected" | 按平台错误处理（第 5.4 节） |
| 取消 | 处理 SIGTERM 后，`stop()` 48 毫秒内中止任务，状态变为 stopped | 第 9.1 节已写明 |
| 并发 | `max_instances` 14 时同时约 11 个任务即报 "no Container instance available"，旧实例仍占名额 | 协调 DO 以实例实际状态计数（第 9.5 节、第 10a 节告警） |
| 镜像 | 约 1.55 GB；本机推送大层反复失败，GitHub Actions 构建并推送约 3 分钟 | 第 3.2a 节：只从 CI 部署 |

## 参考

- Cloudflare Containers：[限额](https://developers.cloudflare.com/containers/platform/limits/)、[价格](https://developers.cloudflare.com/containers/pricing/)、[出站流量](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)、[概念（每实例独立 VM）](https://developers.cloudflare.com/containers/concepts/)、[架构与生命周期](https://developers.cloudflare.com/containers/concepts/architecture/)
- Cloudflare Browser Run：[限额](https://developers.cloudflare.com/browser-rendering/limits/)、[自定义字体](https://developers.cloudflare.com/browser-run/features/custom-fonts/)
- huashu-motion v0.2.0：`skills/huashu-motion/references/contract.md`、`skills/huashu-motion/references/depth.md`、`THIRD_PARTY.md`、`fonts/LICENSES.md`、`runtime/om-engine.js`、`runtime/om.js`、`runtime/clip/lib/toon.js`、`cli/lib/check.js`、`cli/lib/qa.js`
- PromoBento（改造前）：`docs/prd/04`、`08`、`13`、`14`，`contracts/render-protocol.d.ts`，`config/agent-policy.json`
