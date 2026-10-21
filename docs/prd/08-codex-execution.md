# 实施顺序与交付

先读 [AGENTS](../../AGENTS.md)、[PRD 索引](README.md)和[实际进度](../implementation-status.md)，从尚未完成的阶段继续。本章规定实施顺序、工具链和交付要求。

## 1 接手与当前命令

新工作区：

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
bash scripts/agent-setup.sh
mise run check:repo
mise run test
```

已有工作区先保留未提交改动，再同步 remote main。配置或契约变更须同步使用它们的代码与文档；参考页模板、tokens 或商品配置变化后，运行 `mise run build:agent-reference`。

setup 用 mise 安装精确版本并冻结安装依赖；没有 mise 时只接受 PATH 中相同的 Node/pnpm，缺工具先给明确提示。工具来源为 [mise 官方](https://mise.jdx.dev/getting-started.html)、[Node 官方发行](https://nodejs.org/en/download)及 [pnpm 官方安装](https://pnpm.io/installation)，也可使用已核验的内部镜像；不因某个沙箱下载方便而接受第三方重打包二进制。无 mise 时使用相同版本执行 `pnpm install --frozen-lockfile`、`pnpm run check:repo` 和 `pnpm run test`，其他已登记任务对应 `pnpm run <任务名>`。已预置工具和缓存的环境可设置 `PROMOBENTO_SETUP_OFFLINE=1`，缓存位置用 `PROMOBENTO_PNPM_STORE_DIR`；缺项明确报错，不自动改用系统版本。其他 Node 可用于诊断，但不能据此宣称通过固定工具链验收。

| 任务 | 实际范围 |
| --- | --- |
| `install` | pnpm 冻结安装 |
| `check:repo` | 当前文档链接、锚点和变量；配置、路由、认证、主题、平台规则版本；提前核对 Renderer Node/Playwright 与工具链、包声明一致；并执行契约与离线参考检查 |
| `check:contracts` | Schema 样例、语义、摘要、合法目标与 API 清单 |
| `test` | 运行 scripts、packages、apps、tests 中的 `*.test.{mjs,js,cjs,ts,mts,cts}`，排除 `*.render.test.*`；不支持的测试后缀报错。原生 TS 执行不代替类型检查 |
| `build:agent-reference` / `check:agent-reference` | 生成并核对离线 Studio 参考 |
| `install:renderer` | 获取并校验完整 Chrome for Testing 固定归档，保存到私有缓存 |
| `render:fixture` | 只渲染已审阅样例；默认30秒`media`、`output`模式，记录出片和媒体检查；另可选择静音`square`/`inplace`及完整`regression` |
| `test:render` | 独立媒体回归：15/30秒MP4、模式像素一致、正/逆序/重复/乱序及冷启、真实字体/VFR取帧/冻结音轨、编辑保存与区域定位、截图片段及故障检查 |
| `build:admission` | 构建固定Linux/amd64的受限源码执行与可信绘制镜像，记录实际imageId及sourceTreeHash |
| `test:admission` | 在真实Docker容器验证受限源码、网络/文件/资源限额、超时/取消/回收，并生成30秒几何样片；缺Docker或匹配镜像明确失败 |
| `render:admission` | `--source DIRECTORY`读取有界单模块源包，运行canvas-commands-v1及必需确定性检查，生成静音MP4、封面和输入绑定报告 |

检查范围是 Git 跟踪文件和未被忽略的新文件。渲染产物放 `artifacts/`；不能让生成的报告进入文档遍历，也不把媒体文件读成文本。新增 package/app 时同步其依赖和 lockfile；媒体测试使用 `*.render.test.*` 并由 `test:render` 运行；外部集成测试随模块加入独立命令和 CI。新增根级 package script 同步登记 mise task，仓库检查自动核对，不创建空脚本占位。

## 2 里程碑与退出关口

| 阶段 | 实施内容 | 退出条件 |
| --- | --- | --- |
| M0a 本地自由创作 | GSAP-free 绝对时间运行时、AI 导演、声音、改稿和 MP4，与 huashu-motion 本地基线对照 | 下述真实作品、盲审、确定性和费用基准通过 |
| M0b Cloudflare 准入 | 同源包的目标环境渲染、隔离与回收；并行最小 Google/邮箱/Waffo test | **G1**：M0a 与真实目标实例通过，预算和反滥用有效；缺外部账户的项保持未验证 |
| M1 Studio 与用户流程 | 试用/先购、素材事实、方向、本地预览、多批注改稿、恢复、声音、目标和移动 UI | 两类用户可自助完成流程，02 的 UI-01–UI-08 通过 |
| M2 可靠交付 | D1、账本/队列、冻结、Waffo 权益、延迟编码和发布版本登记 | 真实并发、计量、补目标、退款、删除与旧版重放通过 |
| M3 团队与运营 | 邀请、审阅、冲突、清理、成本/归因/质量面板与用途页 | **G2**：M1–M3 的真实集成验收通过，费用可对账 |
| M4 生产上线与有限试运营 | 性能、安全、平台上传、正式收款退款、域名发信、政策及回滚 | 06/12 的发布条件通过；达到下述 **G3** 才扩大获客 |

**M0a 分四步，后一步使用前一步的真实产物：**

| 顺序 | 随实现交付 | 通过条件 |
| --- | --- | --- |
| 1. 源码到15秒 MP4 | `packages/composition-runtime`、`apps/renderer` 的最小实现；一个合法目标、standard profile；自制且许可明确的图片/文字样例放 `tests/fixtures/render/`；提供 `test:render`，产物放 `artifacts/m0a/<runId>/` | 可播放的450帧文件；固定环境中冷启、正序、逆序和重复 seek 得到相同帧；尺寸与总长正确 |
| 2. 30秒与真实媒体 | 沿用首片，补冻结 WAV、视频 PTS、字体、可编辑项、区域定位、可信截图/片段和 QA；固定录屏/音频样例沿用相同素材目录 | 900帧音画一致；本地改值立即可见，保存与冻结一致；缺字、越界、缺帧和时序不同步可被发现 |
| 3. 两个题目到自由创作 | 先通过本章的Agent源码执行准入；准备软件及课程题目卡、模型候选、预算和许可方案，接通导演、原创镜头、声音、改稿及全目标准备；清单放 `research/m0a/` | 每题有成片、报告、一次改稿和完整 costEvent；真实商业事实、素材权利与正常速度试听经责任人确认 |
| 4. 对照与准入判断 | 扩为下述12组；提供实际运行的 `benchmark:m0a`、输入引用、费用和盲审材料 | 质量、确定性和费用达到门槛；未参与制作的目标用户盲审，Agent 不代投票 |

上述包、命令和测试素材在对应步骤实现时加入。先完成 standard；motion4/8 的质量与成本单独实验，不阻塞首片，也不默认启用。

**作品基准：** 6 个题目（软件3、课程/数字产品3）×15/30秒，共12组。同一组使用相同素材、模型候选和费用上限，对比固定 huashu-motion 本地 GSAP 基线与 PromoBento GSAP-free 管线，必要时各做一轮相当范围的改稿。基线仅限隔离研究。目标用户按“愿意公开发布”盲审，记录人数及偏差；暂定至少8/12组获认可，认可率不低于基线。这个小样本只用于工程准入。

**费用基准：** 按[07](07-growth-and-experiments.md)记录全流程费用，估算通常使用、用满权益和不同试用转付费情景；商户费用取实际账单，新增构图另记边际成本。超预算时先按07优化，再提出价格或权益调整，不在实现中自行改变商品规则。

**G1：** 开放免费云任务前，实测身份与素材权限、一次试用领取、费用预留、预算、限流和暂停/恢复。未知价格或限额保持关闭。M0b 在 2–4 vCPU 目标实例验证06；缺账户时继续本地实现。

**G3：** 两类用户各至少3个独立、非赠送的付费交付。用户样本观察满30天后，扣除实际成本和剩余付费权益的预计成本，贡献达到事前目标，试用损失不超预算，作品质量和可靠性达标。试运营前确定负责人、样本窗口与止损条件。未达到时停止扩大新增成本，保留查询、退款、既有下载和已收款任务恢复。G1/G2 不要求尚不存在的市场数据。

### 外部输入何时阻塞

| 所需输入 | 责任角色 | Agent 先交付什么 |
| --- | --- | --- |
| 商业事实与客户素材权利 | 产品/素材提供者 | 题目卡、待核实事实和许可清单；先用明确标注的虚构工程样例 |
| 每题预算与模型账户 | 项目负责人、账户持有人 | 模型/方法候选、费用上限和最小凭据需求，已有授权直接沿用 |
| Cloudflare、域名发信、Google/Waffo | 相应账户持有人 | 可用配置、隔离测试与最小绑定清单，不索取无关权限 |
| 实际主体、市场、合同与审核方案 | 经营负责人 | 政策草稿、具体待补事实和可演示流程 |
| 正常速度试听与目标用户盲审 | 作品负责人、独立目标用户 | 可播放作品、对照材料、评分说明和已测费用 |

缺输入时，交付已有代码/样片、可复跑命令、缺项和恢复步骤；在实施状态中标明受影响任务。只暂停依赖缺项的部分，不伪造人工确认、凭据或外部验收。客户及受限素材本体放仓库外受控存储，清单只保存摘要、来源和授权引用，不链接个人机器路径；自制且可公开的测试素材可入库。

## 3 代码责任与可复现工具链

应用按 web、api、jobs、agent-runner、renderer 分工；共享类型、运行时、音频、QA、账本、数据库和 UI 按实际依赖组织为 packages，不建空模块。规则归属见 [PRD 索引](README.md)，共享算法只保留一份。

mise 管理工具与任务，pnpm 管理依赖。精确版本在 `.mise.toml`、`package.json`，安装使用冻结 lockfile。初始化或主动升级时核对目标平台、官方兼容性与实际运行结果；普通文档/业务修改不自动升级，也不把本机版本当作选型依据。新增依赖锁版本，核查安装脚本和许可证；创作代码不能任意安装或联网。

### M0a 渲染环境

`render:fixture` 的入口是默认导出 `CompositionDefinition` 的 ES 模块，HTML 外壳由宿主提供；实际阶段状态见[实施状态](../implementation-status.md)。该命令只接受仓库中经审阅的`square`/`inplace`/`media`样例，不接收任意路径、URL或Agent源码。当前浏览器以`chromiumSandbox:false`启动；私有目录、CSP及请求拦截不构成客户代码隔离。未知源码另走下述[受限几何入口](#本地canvas-commands-v1入口)，不扩展fixture白名单。浏览器和编码器环境约定见 [environment.lock.json](../../apps/renderer/environment.lock.json)，固定 Linux x64 / Ubuntu 24.04、Node、Playwright、Chrome for Testing 和 FFmpeg 的版本及浏览器/编码器文件摘要。

Linux x64 / Ubuntu 24.04 的运行步骤：

```bash
bash scripts/agent-setup.sh
mise exec -- pnpm --filter @promobento/renderer exec playwright-core install-deps chromium
sudo apt-get update
sudo apt-get install --no-install-recommends --allow-downgrades ffmpeg=7:6.1.1-3ubuntu5
mise run install:renderer
mise run test:render
```

30秒真实媒体样例运行`mise run render:fixture -- --fixture media --mode output`；完整回归可选`--mode regression`，15秒静音方形用`--fixture square`，30秒静音DOM/SVG/Canvas用`--fixture inplace`。`--output-directory`只改变产物目录，不改变输入或校验。默认产物位于`artifacts/m0a/<runId>/`，包含MP4、封面、环境及报告；`media`另有冻结WAV、真实资源/PTS清单、可信截图/两秒片段和媒体QA，完整回归还保存编辑参数及预览/高清对照图。

| 模式 | 两者共同执行 | 额外检查 |
| --- | --- | --- |
| `output` | 同一正序全帧捕获与编码；按`fixture-determinism-v1`做重复、乱序和新进程冷启抽查；核对编码、帧数/时长、色块及文件摘要；`media`检查字体/布局、冻结声音、实际MP4音画落点与同区间片段 | 无全片倒序和故障探针；未运行项明确记为空或零 |
| `regression` | 与`output`相同 | 全帧倒序、非法帧/已释放会话、原生动画拒绝及减少动态设置；`media`另验改值、失败回滚、缺字、溢出、epoch、区域和保存/冻结重放 |

两种模式都不能关闭必需校验，也都只用于固定工程样例。`output`包含当前样例的媒体处理和工程QA开销，尚未接入生产输出审核、AI标记、计费预留或发布QA。完整回归的额外时间不计为客户处理目标，生产测量口径见06。

Node从固定白名单的`*.declarations.json`读取静态声明，使用共享JSON解析和完整Schema校验，不为提取声明导入作品模块。声明文件与实现一同进入源码快照及摘要；浏览器在`prepare`前核对模块实际声明与这份输入一致。此时浏览器模块已求值，仍只适用于经审阅样例，不构成任意源码执行前的安全检查。

报告`timings`按不重叠的墙钟阶段累计：`prepareMs`准备环境与样例，`captureEncodeMs`全帧捕获及流水编码，`determinismChecksMs`复取/乱序/冷启检查，`regressionChecksMs`额外回归，`outputChecksMs`产物检查，`cleanupMs`回收。捕获与编码有重叠，不能拆成两段再相加；阶段之和应与从准备到清理结束的`totalMs`一致，仅有毫秒取整误差。依赖安装和浏览器下载属于环境准备，不混入这次样例计时。单次结果不能推导p95。

`capture.diagnostics`仅汇总正序捕获：宿主seek、截图、PNG写入/解码、像素摘要、光学/文字QA、编码器管道等待和最终结束等待分别计时。`browserWithinSeek`记录draw、区域检查与绘制稳定等待，已包含在宿主seek内；其中`resourceWaitMs`只统计draw内`videoFrames.get`调用区间的并集，不含prepare的字体加载，不能再与draw相加。编码器等待不是其总CPU耗时。每帧p50/p95用于定位本次瓶颈，不代表生产任务p95；先据实测定位，再决定并行或编码优化。

`execution.json`及报告`execution`记录实际CPU型号、逻辑核、可用并行度、可见cgroup配额/内存限制和缓存状态；未暴露的限制及不可安全表示的内存哨兵值保留null。`standard`是采样/质量配置，不是机器规格。比较耗时须同时核对运行资源、输入、模式与校验范围。

系统依赖安装只在准备阶段进行。`PROMOBENTO_BROWSER_DIR` 指定当前用户拥有、非符号链接且权限为 0700 的归档缓存目录，内含 `browser.zip`；可用 `PROMOBENTO_BROWSER_ARCHIVE` 从已取得的官方归档导入，仍核对锁定的完整 SHA-256。镜像来源只允许相同官方字节，不接受其他版本。每次渲染都复制并复核归档，在新的私有目录完整解压，拒绝特殊文件并校验可执行文件；不复用只检查过主程序的解压目录。测试结束清理临时解压和原始帧。

浏览器继续由空字体目录的Fontconfig隔离系统字体；模板与实际私有路径配置分别记录摘要，并实查Chromium不能使用宿主字体。`media`通过[固定字体登记](../../tests/fixtures/render/media-assets.json)加载Geist Sans/Mono的确切OFL字节及回退，处理前核对来源/许可摘要，读取实际WOFF cmap并按14的字重选择规则检查绘制文字。只覆盖已登记Latin字形和回退，不代表CJK/RTL/复杂塑形已认证。`square`保留自制SVG字形。FFmpeg使用Ubuntu的GPL/libx264构建，以本地/CI进程执行，仓库不分发二进制；未来交付容器或二进制时按09另核对分发义务。

`media`的虚构应用录屏由自制几何图形生成，实际H.264源包含交替10/30、20/30秒的PTS间隔。FFprobe核对PTS，FFmpeg逐帧提取PNG；浏览器以BigInt有理数按包含区间取帧，验证资源hash后解码，ImageBitmap缓存最多8帧/1,843,200字节。实际原生视频解码探针独立记录，无论支持与否均使用同一可信PNG路径；缺帧、坏字节、越界和未声明资源直接失败。故障测试通过浏览器策略阻断原生解码验证回退，不能据此声称所有客户端codec已验收。

声音使用首次处理前已核对CC0依据的原创程序音源，按稳定eventId、偏移、增益/自动化与淡入淡出生成48kHz双声道PCM16 WAV，30秒恰为1,440,000采样帧。自制录屏和音源均先核对已审阅许可文本的固定SHA-256、`CC0-1.0`标识与生成器适用范围；仅出现“CC0”字样不能放行。冻结前只施加一次恒定响度增益，浏览器解码、全片AAC与片段均读取同一WAV。报告记录真实响度/真峰值、AAC前导/尾部及有效播放区间；声音起点与编码后MP4像素检测到的三次视觉脉冲比较。片段`[270,330)`同步使用WAV采样`[432000,528000)`；截图、片段和QA绑定源码、资源、参数、编码与实际环境摘要。工程QA不代替内容审核或人工试听。

参数和区域通过经审阅样例的串行直接API实现，尚非完整跨源消息桥接。本地0.5倍预览先准备新画面再提交epoch，失败保留旧画面；类型、事实绑定、时序限制和规范参数字节与Studio共用。保存参数后验证同分辨率本地重放，以及三个高清冻结帧的冷重放；本地与高清之间核对逻辑布局，不要求重采样边缘像素相同。可信渲染拒绝overlay，区域仅引用静态声明。当前真实DOM文字按每秒及末帧检查边界/溢出，覆盖不足的其他绘制文本仍需另行QA。

当前截图路径准入绝对时间DOM/SVG更新、Canvas2D完整重绘及上述已验证媒体资源。宿主在绘制前后拒绝原生CSS/WAAPI动画；截图使用`animations:'allow'`、`reducedMotion:'no-preference'`。字体加载、PTS资源解码和draw完成后，通过显示状态失效处理重建保留SVG图层，再由截图完成合成与读回；它不能作为任意动画、原生视频seek或WebGL的通用屏障。增加创作能力前，必须加入普通样例并完成冷启、顺逆序和重复取帧验证。

整帧宿主deadline覆盖`draw`、资源/绘制屏障与截图；超时终止BrowserServer进程组，不等待排在挂起或死循环绘制之后的`dispose`。编码器写入和结束另有60秒宿主期限，超时SIGKILL并等待进程关闭；媒体子进程同样有硬期限。诊断只在内存保存摘要和少量必要帧；正序原始PNG写临时目录，逆序/重复/冷启逐帧比较，用后清理，保留实际覆盖与失败诊断。归档、主程序、系统库和成片的SHA-256用固定64KiB缓冲分块计算。报告的Node最大RSS不包含浏览器与编码器，不能作为生产总内存结论。

每次媒体测试记录实际系统库、输入文件、启动参数和解码像素摘要，保存样片、封面及报告。严格比较同次固定环境的帧；系统库记录不等于已经证明跨机器像素一致。后续扩展继续固定：

- 操作系统/架构与主机类型、Chromium 构建及启动参数、绘制后端、FFmpeg 构建与系统库；容器使用实际镜像 digest。
- 字体文件、字形处理和回退配置的摘要；图片/视频的解码方式；帧就绪条件与截帧路径。仅调用 `gl.finish()` 或等待字体加载不能代替完整帧验收。
- 输入颜色解释、RGB 到 YUV 的转换、范围及输出标记，用色块样例验证；不能仅添加 BT.709 标签而不核对转换。
- `randomAt` 使用 UTF-8 字节长度的 uint32 小端前缀分别编码 seed/key，经 FNV-1a 与 fmix32 混合，将 uint32 除以 2³² 得到 [0,1)；固定向量和统计回归检查输入边界及相邻键，不以它生成凭据。预览与可信渲染共用实现。

同一固定环境内比较解码后的帧像素；不同环境单独设定观感/布局容差。本地浏览器预览不承诺与可信输出逐像素一致，交付文件另外保存实际字节摘要。启用 motion4/8 前再固定线性光采样合成、alpha、舍入和各配置超时。

### Agent源码执行准入

以下条件须在第三步首次执行模型源码前完成，包含模块加载和求值，不能等到首帧`seek`才检查：

- 控制进程通过有界静态数据取得声明，不导入作品、依赖或执行构建脚本来提取元数据；需要执行的构建与模块求值一同进入隔离。资源授权、实际字节摘要、执行期限和可信回执由作品无法改写的外部宿主管理；同一JavaScript域内冻结对象或比对声明不能建立这个边界。
- 作品只使用宿主传入的绝对时间和`randomAt`；真实墙钟、随机源、计时器及自行调度的动画循环不得改变作品状态。限制在模块求值前生效，不能靠生成提示或事后抽样约束。
- 宿主使用独立的真实单调时钟控制加载、准备、逐帧和任务总期限；作品不能修改该时钟、延长期限或阻止回收。
- 只开放已验收的绘制与媒体能力。图片解码、字体字形、视频PTS取帧各有就绪条件，并绑定实际资源字节；缺失或未准入能力直接拒绝，不能沿用旧画面。WebGL另行准入。
- 在实际受限环境中验证无业务凭据、外网及宿主非授权资源不可达；素材只读且按任务授权，临时目录隔离，CPU/内存/磁盘/进程数量与总时长有硬上限。API替换、CSP和`getAnimations()`不代替隔离。
- 候选按版本化策略与正序基准做重复、乱序和冷启复取，结论绑定`qaInputHash`所覆盖的源码、资源、目标、环境与输出配置；失败为Q0 BLOCK。新增能力补对应样例，抽样一致不证明任意程序确定性或安全。

`render:fixture`及`fixture-determinism-v1`继续只验证经审阅浏览器样例。新增源码入口按能力profile分别验收；一个profile通过不能放行其他绘制API、资源或执行环境。实际验收进度见[实施状态](../implementation-status.md)。

#### 本地canvas-commands-v1入口

先运行有明确来源的[原创几何样例](../../tests/fixtures/admission/composition.mjs)：

```bash
mise run build:admission
mise run test:admission
mise run render:admission -- --source tests/fixtures/admission
```

宿主须有可用的Docker Engine或Docker Desktop，能运行`linux/amd64`、执行默认seccomp策略并落实cgroup v2限额；非x64宿主还须具备相应仿真能力。构建阶段从官方来源取得固定Ubuntu、Node、依赖、Chrome及FFmpeg；版本与字节身份见[admission.environment.json](../../apps/renderer/admission.environment.json)、[Dockerfile](../../apps/renderer/docker/Dockerfile)和既有渲染环境锁。执行阶段无下载、安装或联网。Docker、镜像或实际限额不可用时命令失败，不退回宿主Node、浏览器执行或无隔离模式。

`build:admission`记录`artifacts/admission-image.json`，绑定构建输入的`sourceTreeHash`和Docker实际`imageId`；运行前重新核对当前输入、镜像身份及标签。镜像包含的代码、契约、配置、依赖或测试素材改变后须重建，不能复用旧回执。检查日志和生成的媒体产物不写入该源码身份。

`--source`只接受一个扁平目录，必须包含以下四个文件，可另带`LICENSE.txt`；拒绝额外文件、子目录、符号链接、无效UTF-8和超限输入：

- `candidate.json`：按[源码清单Schema](../../contracts/admission-source.schema.json)指定`canvas-commands-v1`、合法target、15/30秒及seed；尺寸和编码由既有平台配置推导。
- `composition.mjs`：无需构建的自包含ES模块，默认导出[CommandCompositionDefinition](../../contracts/composition-runtime.d.ts)。不允许import、依赖安装、构建脚本或宿主API。
- `declarations.json`：完整`runtime_declarations`，与模块声明一致；此profile要求fonts/videoUses为空，不接asset和事实绑定参数或音频事件。
- `values.json`：沿用14的规范`source_values`封装和共享校验，不能以清单中的任意字段替代参数文件。

宿主先静态解析和校验源包，不导入作品；源码随后进入独立Docker任务内的`quickjs-emscripten` 0.32.0。QuickJS的独立VM承载模块求值、同步`prepare/draw/dispose`，作品只取得冻结参数、绝对有理时间及共享`randomAt`，无真实时钟、随机源、计时器、网络、文件或进程接口；异步结果和待执行任务直接拒绝。引擎内存预算是整个WASM线性内存的硬上限，包含VM开销，不等于可用作品堆大小。内存、栈、每次调用、输出，以及容器CPU/内存/进程/临时磁盘、传输和总时长上限统一见[admission.policy.json](../../apps/renderer/admission.policy.json)，由外部宿主管理。

`draw`只返回[几何JSON](../../contracts/admission-commands.schema.json)：带显式颜色和透明度的矩形/圆角矩形、圆及多边形，可附已声明区域的边界。命令数、点数、坐标、半径和字节均有上限，未知字段及伪造就绪/身份字段拒绝。共享`parseCanonicalJson`、完整Ajv和`checkedRegions`分别处理入站文本、结构及区域语义；源码不能选择任意Canvas方法、SVG、CSS或URL。字体、图片、视频、声音、DOM、原生动画和WebGL尚未进入此profile，现有媒体fixture不因此获得未知源码执行许可。

每个执行阶段新建非root容器，根文件系统只读、网络关闭、不继承业务凭据，撤销Linux capabilities并启用no-new-privileges。首次容器运行正序、重复和乱序命令，第二个全新容器验证冷启；可信宿主绑定返回帧序号并比较命令数据。另一个可信捕获容器只读取这些JSON，不接收创作源码；固定浏览器重绘450/900帧，再按`admission-determinism-v1`比较重复、乱序及重启浏览器后的冷启像素。`test:admission`还实测资源耗尽、模块/prepare/draw/dispose挂起、越权能力、外网和元数据地址、只读挂载及容器回收。

CLI收到SIGINT/SIGTERM、超过宿主期限或发生错误时，外部控制器强制移除本次创建的容器并清理临时数据；不等待作品释放自己，也不停止其他任务。回收失败须按报告中的容器名处理，不能记作完成。输出默认在`artifacts/admission/<runId>/`，可用`--output-directory`指定空目录。成功保留MP4、poster、环境、实际限额、逐帧命令摘要及像素hash、捕获报告和总报告；执行失败写`failure.json`并以BLOCK退出，源包或镜像预检失败直接报错。总报告以共享`qaInputIdentity`绑定源码、参数、目标、空资源/声音、镜像、配置和验证策略，保留`productionEligible:false`。

这是几何源码的本地技术执行入口。真实模型创作仍须按第三步补商业事实与权利、内容审核、所需媒体能力和预算；客户本地播放器、生产QA关联及Cloudflare目标环境分别按M1/M2/M0b推进。几何样例的点阵字形不等于文字轨迹或安全审核通过。QuickJS及其WASM封装均采用MIT许可，来源见[QuickJS官方](https://bellard.org/quickjs/)、[quickjs-emscripten仓库](https://github.com/justjake/quickjs-emscripten)、[封装许可证](https://github.com/justjake/quickjs-emscripten/blob/main/LICENSE)及[API文档](https://github.com/justjake/quickjs-emscripten/blob/main/doc/packages.md)；依赖许可不授予候选源码或客户素材使用权。

### 媒体验证与结果交接

`test:render` 先校验环境，再产片和检查；缺浏览器、编码器或所需字体时明确失败，不采用宿主的浮动默认值。有容器能力时使用固定镜像；没有时采用已验证的预装环境，或把可信渲染交给 CI/专用 runner，本地继续纯代码工作并注明媒体未验证。必需的 CI 媒体门禁不能把环境不可用记为 skip 后通过。安装/下载放所选 Agent 环境允许的准备阶段，不假定所有沙箱支持 Docker 或相同网络策略。

| 环境 | 另需验证 |
| --- | --- |
| 本地/CI | 工具实际版本、冻结安装；运行真实 `test:render`及独立Docker `test:admission`，分别保留样片、环境与验证报告 |
| Workers Builds | 显式安装工具并设置路径，干净检出可构建，不假定平台读取 mise |
| workerd | compatibility_date/flags/bindings；SSR、认证、签名、存储和队列 |
| Cloudflare Renderer | 06 的复杂片、媒体、隔离与回收，镜像可重复获取 |
| 客户浏览器 | 支持范围内的 UI、hydration、字体、本地预览和帧协议 |

CI 支持手动`workflow_dispatch`，可选择实验分支运行完整检查。[工作流](../../.github/workflows/checks.yml)的`contracts`通过后，`render`、`media-output`和`admission`在独立job执行。`render`运行完整`test:render`；`media-output`运行真实30秒`media --mode output`，单独记录工程出片时间，不混入倒序/故障回归。这两项把`artifacts/m0a/`上传为artifact，名称含精确commit SHA、run ID/attempt和模式，保留30天；`ci-context.json`补充任务与锁定浏览器归档身份，报告另存实际机器资源。只缓存以完整SHA-256为key的官方归档，每次仍校验字节并私有解压。

`admission`使用Ubuntu 24.04 runner，job期限35分钟，冻结安装后依次运行`build:admission`、`test:admission`。它单独验收真实容器隔离、恶意模块、限额、取消/回收与30秒几何出片，不沿用fixture结果。无论成功或失败，上传已有的`artifacts/admission-tests/`与`artifacts/admission-image.json`，artifact名为`m0a-admission-<commit SHA>-<run ID>-<attempt>`，保留30天。镜像构建时间包含在job期限内，不计入单次作品捕获耗时。

长期准入证据按06移到受控存储。Agent无法读取CI时，由有权限的执行方交回精确commit SHA、run ID/attempt、各job结果，以及关联的报告、样片和环境文件；核对环境/镜像/浏览器摘要和实际覆盖，不能仅凭“已通过”的文字结论。拿不到结果就保留受影响的媒体或源码准入项未验证，不改lock绕过环境校验。确定性样例可重新生成，模型作品或盲审材料不能只留命令/hash；受跟踪文档不链接仅本地存在的产物。

首次生产冻结时按14建立发布版本登记；当前未发布草稿直接更新，不建 legacy 目录。已购作品的环境继承、修复和保留按14执行，不用浮动 latest 重放。媒体许可见09，关键实测按06留证，不另写迁移日记。

官方入口：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[compatibility date](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Containers](https://developers.cloudflare.com/containers/get-started/)、[浏览器截图差异](https://playwright.dev/docs/test-snapshots)、[浏览器容器版本](https://playwright.dev/docs/docker)。实施日重新核对。

## 4 环境与交付

各模块随实现提交请求/响应契约、权限和错误测试、运行配置；数据库模块同时提交 migrations 和真实 D1 并发验证。首个云模块提供可用的 `.dev.vars.example` 和 wrangler 配置，列明实际绑定、变量用途及环境来源。认证、发信和支付区分本地 mock、真实 test 与 production，不提交密钥，也不用 mock 通过代替集成验收。

appUrl、回调、发信和支持地址取 brand/routes/auth。密钥只交给需要它的可信服务，沙箱不带凭据；新增服务纳入费用预算。完成报告写清变更、实际验证、未实现项、样片/费用和外部条件；仅在能力变化时更新实施进度。

CI 验证当前提交的完整代码树；被新提交替代的检查可以取消，最终远端 SHA 必须获得所需检查结果。平台规则比较使用 main 上相同检查工作流中、按 Git 祖先距离最近的成功提交；运行时间不决定距离，失败/取消不推进基线。选择器先从一页成功历史发现候选，再对候选与 HEAD 之间的祖先逐 SHA 分批核验，避开全局筛选列表上限及旧提交反复重跑的排序问题；最多128次请求、总期限60秒，单次请求最多30秒且不能超过剩余期限，Git子进程共用总期限。超预算明确失败，不将已找到但未证实最近的候选当作基线；PR 使用其 base SHA。

只有 API 明确返回零成功历史时，`ten2ten2/promobento` 才可使用脚本内固定的初始基线 `a55939e4e080b4a0731b0b43315b22d0ad7ec902`，且该提交必须为 HEAD 的严格祖先。不得用环境变量替换初始 SHA。API/网络失败、异常响应、已有成功历史却无合格祖先均阻断，不退回 `event.before`、HEAD 或全零 SHA。CI 显式基线必须为严格祖先；本地允许用 `origin/main=HEAD` 比较尚未提交的改动。默认比较已获取的上游，无上游时才按工作区状态比较 HEAD/HEAD^；可用 `PROMOBENTO_BASE_REF` 显式指定已核实基线。

失败先区分代码错误与 runner/网络故障；前者修复或安全 revert，后者修复环境后重跑。接入生产部署时，只部署该 SHA 必需检查全部成功的产物；被取消不算成功。推送方式及远端前移处理统一按 AGENTS，并行工作汇总后推送。
