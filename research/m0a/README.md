# M0a：把同一题目交给两条管线

`benchmark:m0a` 能实际调用已授权的模型、运行隔离的 huashu-motion 基线、汇总本地账本，并生成匿名视听材料。题目、模型创作、负责人验收和独立用户意见分别记录；缺一项不会用样例数据补成通过。

## 先确认题目和执行授权

[主题目卡](cases.json)是用户选择的 **DeepSeek-V4.1-Flash、MiniMax M3.1 Flash、GPT-6 Astra** 三个软件题目，以及 **Duolingo 语言、数学、音乐** 三个课程题目。每题各做 15、30 秒，共 12 组。Claude Opus 5.5 与 iPhone Duo 留作额外题目，不挤占这 12 组。

卡片引用官方功能来源，但商业事实仍须由作品负责人确认。产品名称是影片主题，**不是默认的创作模型选择**。官网图片、录屏、商标图形、音乐没有因此获得处理或再发布许可。先用原创示意图和已审核字体，不用官方视觉包装冒充真实界面。虚构的[六张工程卡](engineering-cases.json)另存，只用于技术测试。

```bash
mise run benchmark:m0a -- matrix
```

真实运行前，需要本地 Agent 的项目文件和授权配置：已确认事实与素材权利、实际模型账户、至少两种模型/设置、有效期和费用上限、已核验价格，以及明确的本地计算费率。项目和私有证据放受控目录，不提交凭据。`config/agent-policy.json` 的生产开关仍保持关闭；本地研究授权不打开免费云任务。

### 没有模型预算时，先看原创工程样片

```bash
mise exec -- node research/m0a/showcase.mjs --output-directory artifacts/m0a-showcase/run --duration 30
mise run render:admission -- --source artifacts/m0a-showcase/run/deepseek --output-directory artifacts/m0a-showcase/deepseek-render
mise run render:admission -- --source artifacts/m0a-showcase/run/duolingo-math --output-directory artifacts/m0a-showcase/math-render
```

生成器只写惰性源码，渲染在隔离容器执行；加 `--revision edited` 可生成只改标题的版本。这是本次编码会话原创的工程样片，供试听和检查画面，不计作已付费模型主矩阵，也不代替作品负责人的事实确认。

## 固定基线，不接入生产

基线为 [huashu-motion `5f2608c2e12abcf518f74dde86093b19f7f88603`](https://github.com/alchaincyf/huashu-motion/tree/5f2608c2e12abcf518f74dde86093b19f7f88603)，包版本 0.1.1，实际入口 `cli/om.js render`，GSAP 3.14.2。身份见 [baseline.json](baseline.json)。首次准备只下载源码，不在宿主执行安装脚本、上游 CLI 或作品：

```bash
git init artifacts/m0a-baseline/upstream
git -C artifacts/m0a-baseline/upstream remote add origin https://github.com/alchaincyf/huashu-motion.git
git -C artifacts/m0a-baseline/upstream fetch --depth=1 origin 5f2608c2e12abcf518f74dde86093b19f7f88603
git -C artifacts/m0a-baseline/upstream -c core.hooksPath=/dev/null checkout --detach FETCH_HEAD
```

固定版本[自有代码许可](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/LICENSE)为 MIT；[第三方清单](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/THIRD_PARTY.md)将 GSAP、字体和作者形象分开。研究不采用作者形象、示例影片、乐器包或声音模型，不分发上游运行库。

[附带的 GSAP 许可快照](https://github.com/alchaincyf/huashu-motion/blob/5f2608c2e12abcf518f74dde86093b19f7f88603/templates/blank/vendor/GSAP-LICENSE.html)最后修改于 2025-05-30，允许普通数字界面使用，限制竞争性的无代码视觉动画构建工具，并明确允许 AI 生成 GSAP 代码。本工具采用独立离线 CLI 对照，不开放上游 Studio、不向客户提供 GSAP 功能、不逆向、不将它作为生产依赖。2026-10-22 核对时[官方在线许可入口](https://gsap.com/community/standard-license/)暂时跳转到论坛离线页，因此保存固定版本的许可身份；新增版本或使用范围另行核对。生产禁入规则仍按 [09](../../docs/prd/09-sources-and-licensing.md#2-视频创作上游)。

### 先跑独立工程烟测

```bash
mise run benchmark:m0a -- baseline-smoke \
  --upstream artifacts/m0a-baseline/upstream \
  --output artifacts/m0a-baseline/smoke-run
```

它只处理[原创几何](smoke/index.html)，输出 15 秒、1080×1080、30 fps、450 帧 MP4。没有模型调用和商业主张，不能计作主矩阵作品。

`baseline-runner.mjs` 核对实际镜像 ID、Linux/amd64 和来源标签，复用该镜像的固定 Node、完整 Chrome 归档及 FFmpeg。研究脚本只读挂到 `/harness`，上游与源包也只读挂载；作品复制到容器 tmpfs 后运行。容器无网络、非 root、只读根、无 capability、禁止提权，限 2 vCPU、3 GiB 内存、256 进程、2 GiB tmpfs；宿主总期限最多 600 秒。Chrome 的内部 sandbox 在此容器环境禁用，隔离边界是整个 Docker 容器，不是宿主浏览器。

实际命令为 `node /upstream/cli/om.js render /tmp/project --format mp4 --fps 30 --workers 1 --frames png --silent`。`--silent` 关闭无音轨提示，不删除已经冻结的授权音轨。结果通过有界固定路径读取取回；不挂可写宿主输出目录。结束、取消或失败均回收本次随机名称容器。报告记录镜像、源码、实际编码、媒体许可和六帧正序/逆序/重复/冷启抽查；它不是全片逐帧倒序检查，也不代替内容审核。

## 实际双臂运行与一次等范围改稿

请求文件只引用现有项目和授权配置，例如：

```json
{
  "directory": "study",
  "projectFile": "deepseek-15.project.json",
  "configFile": "model-a.config.json",
  "modelKey": "candidate-a",
  "upstreamDirectory": "upstream"
}
```

所有路径相对请求文件。每个项目 `caseId` 对应矩阵中的 `<topicId>-15` 或 `<topicId>-30`；`direct:true`，首轮用一个合法目标。同一研究的全部题目、模型、失败和改稿必须使用同一个 `directory`，共享账本及预算。工具拒绝中途换事实、预算或授权；新授权应先核对原账本未结算费用，不以换目录清零费用。整个 pair 使用独立 `.benchmark-lock` 排他锁，避免两次 CLI 在两臂之间交错覆盖研究登记；崩溃留下锁时，负责人确认原进程和容器已结束、账本已保留后才移除该锁，工具不猜测“过期”。

```bash
mise run benchmark:m0a -- run-pair --request pair-request.json
```

第一臂调用本地导演和 `renderAdmission`；第二臂用同一模型设置、项目输入与 operation 上限生成原始 HTML，再进入固定 huashu-motion 容器。上游不接受模型安装依赖。两臂使用同一获准资源池和冻结声音准备器，均最多两次内部内容修复；基线修复沿用同一 operation、预算和账本，不以新任务换取免费重试。许可、预算、未知用量、取消或隔离环境错误不自动重试。源码、每次响应、真实请求用量、预留/结算、失败和渲染墙钟都留在研究目录。公开 CLI 只返回稳定错误码；原始未审核诊断放在受控的 `error.private.json` 或操作 attempt 目录，不交给盲评者。

运行结束只产生待负责人检查的作品。用本地 Agent 的 `status` 获取 `subjectHash`，正常速度观看并核对事实、权利、安全、声音及静音可读性后，通过其 `review` 命令提交真实回执。PromoBento 候选还需 `accept`，才能作为改稿基线。Agent 不替负责人填写同意。

一次等范围改稿使用同一请求，另加 `basePairDirectory`（初稿命令返回的目录）和 `commentsFile`（契约中的 `editComment[]`）。两臂读取各自原稿，接受同一组批注；失败保留旧稿。每个模型按“初稿→负责人确认→改稿”完成后再切换模型，避免把另一模型当前接受稿误作改稿基线；工具会拒绝这种冲突。改稿也须正常速度检查并记录回执。新的 result 汇总该题/该模型/该臂的全部历史操作，不能漏掉失败费用。基准要求有绑定初稿、实际改变产物的一次配对改稿；只有初稿不通过这一项。

## 汇总和盲评

汇总清单 `kind:"m0a_benchmark"`、`version:1` 包含：

- `caseSetFile`：主六题卡；`selectedModelKey`：事先选择的主比较设置。
- `modelCandidates`：至少两项 `{key,provider,id,settingsHash}`，读取真实 `result.json` 的请求模型身份，不手填用量。每种设置都跑同一 12 组、同预算。实际返回版本另从操作的 `returnedModels` 读取并显示；同一设置跨双臂、题目、初稿和修复发生 snapshot 漂移时拒绝比较，不能把同名 alias 当作版本一致。
- `producerIds`：所有参与制作和修复的人员，包括负责人。
- `runs`：每项 `{caseId,modelKey,arm,file}`，`arm` 为 `promobento` 或 `huashu-motion`，`file` 指向该臂最新改稿 `result.json`。
- `blindReview`：尚未开展时为 `null`；完成后引用 `{mappingFile,registryFile,ballotsFile}`。
- `economicsFiles`：尚未标定时为 `[]`；否则每个文件按[经济输入 Schema](../../contracts/m0a-economics.schema.json)提供真实费用和明确情景。最终标定须覆盖所选 `modelKey` 的 15、30 秒各一个完整七目标组合；单目标成本可以记录，但不能冒充全批次成本。

路径相对汇总清单。工具读取同一研究的实际操作、登记和共享账本，不允许拼接多个研究目录来重置总预算；校验媒体/报告身份，拒绝缺配对、不同输入/预算、漏掉失败、未结算费用、未审核文件和过期盲评映射。PromoBento 的实际候选、目标、源码/QA 身份、MP4 摘要和帧数逐项绑定；基线绑定负责人审核的 `researchArtifact`、源码、实际尺寸、时长和文件，不能拼接别的通过报告与另一支片。

经济分组的 `modelSettingId` 等于所选 `modelKey`。每类实际单价的 `evidenceRefs` 是该分组全部实际操作的 `operation:<operationId>`；`chargeRefs` 为其最新账本费用的 `operation:<operationId>/charge:<chargeId>`。工具从账本重算总额、未结算额、attempts 和可用结果数，拒绝遗漏失败和跨类别重复费用。整片/改稿含各自内部修复、预览和渲染，其初始项目目标须属于该组；`targetBatches` 只使用新增 `prepare_targets` 操作，以实际 `preparedTargetIds` 及成功候选的完整目标集合匹配，不沿用项目最初的单目标。当前没有可独立归因的 `asset_processing` 或 `render_release` 观测时，对应资产/增量交付单价保持 `null`，成本验收为 incomplete，不从整片费用再拆出一份重复相加，也不填假零。

```bash
mise run benchmark:m0a -- summarize --manifest study/benchmark.json
mise run benchmark:m0a -- blind-pack --manifest study/benchmark.json --output study/review-pack
```

盲评包只包含匿名命名的 MP4 与可离线打开的 `index.html`。A/B 顺序随机且两臂各占六次 A 位；映射另存为包外的 `*-organizer-private.json`，**不要交给评审者**。每位评审正常速度看完，分别回答两片是否愿意公开发布，再下载自己的 JSON。真人收集者将这些数组合并为 `ballotsFile`，不得用 Agent 生成投票。

评审登记格式为 `{kind:"m0a_independent_reviewers",recruitment,biases,reviewers:[...]}`。每人记录 `reviewerId`、`kind:"human"`、`role:"target_user"`、`audiences:["software"|"course"]`、`participatedInProduction:false`、`verificationEvidenceRef`。证据引用应指向受控招募/身份记录，不能提交个人身份材料。制作人员、模型身份、错误人群、重复票、不同包和只看一臂的票均拒绝。代码能验证登记及配对，真人身份与独立性由招募负责人核实。

每组过半有效评审愿意发布才算该组认可；至少 8/12 组，且全部配对投票的认可率不低于基线。结果同时保留人数、逐组票数、招募方式和偏差。这个小样本只用于工程准入。

`summarize` 未达门槛返回 exit 2 和具体 blockers。`benchmarkPassed` 只表示这一对照基准，不代替全部 M0a 的目标准备、源码/媒体验收或后续 Cloudflare/支付准入；`productionEligible` 始终为 false。费用情景单列通常使用、用满权益及试用转付费，未知费用不记作 0；真实商户和市场队列没有观测时明确保留缺项。
