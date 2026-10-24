# G1 性能矩阵与正式选型

正式捕获/机型/studio 选型、正式镜像固定隔离项和 **28 部成片性能矩阵**已通过。当前 2D 串行 p50 **51.861 秒** / p95 **70.572 秒**，达到原 60 秒 p50 目标；WebGL 串行 p50 **67.844 秒** / p95 **102.814 秒**。两类各 4 路并发全部交付。G1 峰值内存仍待验；当前所选网关模型有独立小探针，真实导演及六题指标仍待验。[完整矩阵](#28-部完整矩阵通过2d-p50-达到-60-秒目标)和历史反例分别保留，不混合不同候选的墙钟样本。

[40062546825](https://github.com/ten2ten2/promobento/actions/runs/40062546825) 在 `6102f1191eb224cccba41f9e3f501410e57aa596` 构建/部署正式 staging 镜像 `sha256:1de988bf29842bc9cbfb6aa0af1b58de4cb25230ce6944ccdfafe6d8f49029f5`，Worker `256b6203-c3dd-496e-8a02-f3f9cd6d1db3`。工具仍为 Node 26.12.0、pnpm 12.14.0、Wrangler 4.152.0、Chromium 151.0.7922.34。

## 首片失败，后续采样没有继续

[完整原始报告](first-attempt/performance-report.json)保留首部 30 秒原创 2D 片的输入、6 个分段、900 个实际逐帧计时、声音、物理状态及费用。6 段和声音均计算成功，前 4 处接缝完全一致；第 749 帧的 CTA 接缝违反原门槛，未拼接/提交成片。

只读下载该接缝两张原始 R2 PNG 后，测得最大通道差 **36**、差异像素 **0.0076195988%**。158 个差异像素全部在 CTA 圆角图形边缘（x=95–159、y=140–204）；文字与其他画面相同。即使差异像素比例低，最大通道差仍超过 ≤2 的原门槛，未放行。

7 个实例均已物理停止、持久结算，分配资源保守上界共 **16,053 usd_micros**；操作取消/对账、lease 归还和本轮内部密钥删除成功。没有调用模型，[历史预算](first-attempt/model-budget.json)保持未确认，不能把这部失败片当作成片 p50/p95 样本。未继续运行剩余 27 部。

修复沿用标题反例的结论：停稳后的位移、缩放或旋转为恒等变换时，恢复 `transform:none`，不保留只影响栅格缓存的绘制表面。相同规则应用到 CTA 图形/标题、静止产品面板和其余入场卡片/文字；几何与动画过程不变。实际复验结果另记，不因代码修改先记通过。

## 修复后一次采样被启动故障阻断

[40063578112](https://github.com/ten2ten2/promobento/actions/runs/40063578112) 在 `ed62c2a37734b71444a19613287daf1341cc9199` 部署镜像 `sha256:cf3c140d45d53a935f93b260bf0b4c3f85f1bc896e22343b603b0bfd294ce476`、Worker `89b32bea-4ef2-4792-a46d-934ce1693913`。首片没有取得计算回执，渲染落 `RENDER_INTERNAL_ERROR`。已有启动循环在控制器健康未成功时仍尝试发任务，错误被归为通用内部错误。

只读 Wrangler 查询的[原生步骤](startup-attempt/native-workflow.json)定位两个分段为 `The container is not listening in the TCP address 10.0.0.1:8080`；其余步骤因失败清理/取消而终止，不能把它们解释为各自计算失败。尚未证明是启动耗时还是进程退出，先读已有日志，不重跑成片，也不增加期限。

[原始状态与费用](startup-attempt/performance-report.json)确认 7 个实例最终全部停止结算，分配资源上界 **17,506 usd_micros**，没有未结费用；内部密钥已删除。原 `stopPending:true` 是失败时的状态，随后清理已确认，不能据此说仍有实例运行。此次未验证 CTA 接缝修复，仍无有效成片分位数样本。

[只读诊断 40064813399](https://github.com/ten2ten2/promobento/actions/runs/40064813399) 成功查询历史日志，但名称过滤只返回 140 条 Worker HTTP 事件，未取得容器 stdout/stderr，不能据此判断进程正常。原始产物保留在该 run 与本机 `artifacts/s1-inspect-40064813399/`，未把请求 IP 等无关字段加入仓库。下一次查询保留原失败窗口、去掉名称过滤，不启动计算。

`ShardDO` 已修复健康检查失败仍发 `/task` 的缺陷：沿用原 30 秒/操作期限，每个探测有界，启动超时与 monitor 提前结束分别记录明确代码及探测状态，再走既有停止/结算。新增单项回放通过（Node 26.12.0，408 ms），没有重跑成片或全套测试；云端启动结果仍待实际验证。

## 正式捕获格式、机型与 studio 延迟通过

[40065497336](https://github.com/ten2ten2/promobento/actions/runs/40065497336) 在 `7f615f95bc28ab864cff4d90d9862f48a48b120a` 部署镜像 `sha256:f40aecc2c5d2b343bcc9c84b03dd22732e72967ac4174d848390fac919670501`，Worker `662e6f5f-dfd0-4886-8547-4426a45069a8`。[40 组原始样本](selection/selection-report.json)为 2D/WebGL × standard-3/4，每个 studio 的 45/165/375 帧轮流采样 10 次；四种捕获格式共 160 次。分位数使用经验最近秩，不把这 4 个实例当作启动分布。

| 画面 / 实例 | still p50 / p95 ms | check p50 / p95 ms | JPEG92 捕获 p50 ms | JPEG92 SSIM 范围 |
| --- | --- | --- | --- | --- |
| 2D / standard-3 | 429 / 709 | 434 / 486 | 110.75 | 0.994933–0.998587 |
| 2D / standard-4 | 395 / 701 | 404 / 457 | 106.57 | 0.994933–0.998587 |
| WebGL / standard-3 | 447 / 550 | 514 / 712 | 155.12 | 0.997547–0.997612 |
| WebGL / standard-4 | 396 / 516 | 426 / 472 | 120.90 | 0.997547–0.997612 |

SSIM 比较各 JPEG 与同帧 PNG 解码后的 8-bit RGB 像素。WebGL standard-4 的 JPEG92 捕获中位耗时比 standard-3 低约 22%；2D 的差别小。本组 2D PNG 并未比 JPEG92 慢，WebGL standard-4 的 PNG 中位数为 132.32 ms；JPEG95 质量稍高但字节更多。保留当前 JPEG92、普通 studio standard-3、WebGL 分段 standard-4，PNG 继续用于无损接缝/观测，不据静帧样本调整段数或整片期限。

4 次控制器 ready 分别为 28,718 / 1,745 / 1,592 / 1,698 ms；首个新实例接近原 30 秒门槛，仍未证明上一轮端口失败的原因。本轮全部启动通过，真实 WebGL2/SwiftShader 匹配锁定环境，已查看实际 2D/WebGL PNG。普通评测的 standard-4/benchmark、未授权 check 帧均在预期边界拒绝。

[场景回执](selection/smoke-report.json)耗时 147,025 ms；四次关闭均成功，lease 为空，计算已结算 **10,722 usd_micros** 保守上界，[模型账本](selection/model-budget.json)未变化，本轮密钥已删除。结束后经已批准 Wrangler 连接[只读核对容器应用](selection/container-application.json)，active/starting 均为 0。studio 不创建成片 attempt 行，不能把原报告空的 attempts 数组当物理状态证据；恢复查询现已按计算预留 ID 增补实际状态，后续探针要求返回 true，不用结算值代替停止。

## 隔离探针首次未取得可判定结果

[40066303079](https://github.com/ten2ten2/promobento/actions/runs/40066303079) 在 `8259a3da1fe1c594394b08e4149f208f17fb85ff` 部署镜像 `sha256:afab60ab9694b1b8ac474beb95c196efad343f8cf26510ee382cefb7e3cf36a2`、Worker `6b36ca3b-daab-4999-b086-c45c20c259d7`。[原始报告](isolation-attempt/isolation-report.json)中的 2D studio 已 ready（控制器 20,798 ms），但工具请求返回通用 `TASK_INVALID`，没有保留 page/host/uid 的具体失败阶段；不能算隔离通过或确定为某个安全漏洞，后续 WebGL 未运行。

本轮普通评测拒绝校准入口，且零计算；失败实例原生 `physicallyStopped:true`，已结算 **2,180 usd_micros** 保守上界，无未结费用，lease 和临时密钥已回收。固定探针随后改为逐阶段保留状态和有界、去令牌错误，下一轮诊断见下文。成片性能走独立路径，复用这次已部署镜像继续，未为该诊断重做格式/延迟样本。

## 首个完整性能样本定位等待与 I/O

复用 `8259a3d` 的 [40066875785](https://github.com/ten2ten2/promobento/actions/runs/40066875785) 首部 2D 片已完成 900 帧、AAC 和交付，五处接缝全为零差异，包含此前失败的 749 帧。[原生阶段](baseline/first-native-workflow.json)与[实际回执](baseline/first-attempts.json)显示：

- 数据库创建到完成为 **81.153 秒**；创建到原生 Workflow 开始为 **11.162 秒**，包含 outbox 与平台排队。
- 六个控制器 ready 为 **16.356–17.498 秒**，实际分段捕获为 **16.694–20.114 秒**；分段原生步骤为 **42.797–48.062 秒**，还包括初始化、上传、轮询和停止/结算。
- 接缝/观测校验 **5.030 秒**，拼接步骤 **13.956 秒**；原视频未重编码，峰值一秒码率 **8,969,632 bit/s**。

此样本高于原 60 秒初值，完整分布继续收集，不据一部片计算 p50/p95。新候选针对源码中串行的 broker 输出写入和拼接源读取，改为最多 4 路并保序、失败后排空在途操作；并行读取每对接缝，FilmSpec 直接解析已校验字节。outbox 的批等待从平台默认 5 秒明确设为 1 秒（[配置语义](https://developers.cloudflare.com/queues/configuration/configure-queues/)），不将整段排队都归因于它。物理实例上限、原始校验、截止时间和交付参数不变。

I/O 并发/顺序/失败排空的单项检查通过（18 ms）；阶段诊断保留错误及去令牌的单项检查通过（10 ms）。这些检查不计作原生提速或隔离通过，实际结果另记。

### 完整 2D 串行基线与并发故障

该轮[完整原始报告](baseline/performance-report.json)最终保留 10 部串行全部通过（p50 **66,774 ms**、p95 **97,384 ms**）。随后 4 路并发中 3 部交付、1 部失败；三部耗时为 76,351 / 89,109 / 75,255 ms，不当作完整的四路分布。后续 14 部 WebGL 没有运行。13 部成功片共 **65 处接缝全部零差异**、11,700 个真实捕获帧；已查看首片实际 MP4 的封面，媒体留在该 run 与私有 R2，不进 Git。

失败子操作的[原生步骤](baseline/failed-native-workflow.json)同时记录 `Network connection lost.` 与 `There is no container instance that can be provided to this Durable Object, try again later`。没有取得该片计算回执；清理再次报错会覆盖原始异常。新候选已保留 attempt 首因，区分资源不可用及启动/派发/执行阶段断开，清理失败不释放名额或未知预留。新增单项检查通过（249 ms）：原生容量错误后清理断开仍保留首因，之后仅在停止确认时归还名额并结算，不重新启动计算。

本轮 **111 次计算全部确认停止并结算**，合计 **179,597 usd_micros** 保守上界，其中失败操作 **4,611 usd_micros**，没有未结费用；本轮内部密钥已删除。首次原始 `stopPending:true` 之后已清理，不能误报仍在运行。有效串行基线和三部并发结果完整保留，不把父 job 失败抹成“没有结果”；优化候选因 I/O/排队路径改变，尚不能复用旧墙钟数值作为新候选达标证据。

## 阶段诊断定位三处探针问题

[40068792245](https://github.com/ten2ten2/promobento/actions/runs/40068792245) 在 `28ce2e0d41a3182b7a079f79431a28a199d61c75` 部署镜像 `sha256:956a8cc6993bdd5ea60b8fccf050f218569332c9a8608df7c17bca118f6347d4`、Worker `a173baf4-eef0-4263-94b7-100021870919`。[原始诊断](isolation-diagnosis/isolation-report.json)确认 2D capture、SANDBOX_FULL、控制器 environ/mem 的 EACCES、shim 与图片 CSP 检查通过；动态代码与进程环境的探针判定需修正，host 请求超时，WebGL 未运行。

- 调试求值中的 `eval`/`Function` 返回 ALLOWED；改由普通同源脚本测试，仍要求 `EvalError`，不将调试权限当作品运行权限。
- 子进程 `environ` 读到 `headless`、argv 片段等，原检查误当成环境键。保留父浏览器真实白名单检查；另以令牌指纹检查所有可读进程原始字节，连不含 `=` 的片段也扫描，既不把未知字节当环境键，也不漏过其中的令牌。启动器不接收 bearer，报告不含指纹或原始字节。新增单项检查通过（16 ms），覆盖正常白名单与覆盖记录中的真实泄漏判定。
- host 的统一超时没有保留具体请求结果。现逐项记录状态/失败，读取完小型 probe 响应而非取消代理 R2 流，先完成 broker 正向/越权控制再制造断网请求，避免故意失败的连接污染正向控制。单请求上限不增加；整个 broker 检查有 15 秒预算，未运行项明确标记。

该轮实例已确认停止并结算 **2,704 usd_micros** 保守上界，无未结费用，密钥已删除。方法修改后的实际隔离结果见下一节；I/O 提速仍待验。

## 正式镜像隔离通过

[40071258358](https://github.com/ten2ten2/promobento/actions/runs/40071258358) 在 `420e245a72f7655bf3aa1b2a190be65ae95d2257` 部署镜像 `sha256:9bfd46ae79e01615b8519e6319ba03f183cfef8f8617011c06b3a3788b34ce84`、Worker `8feebf5f-6d56-41fc-a84a-d68d766a7429`。[原始报告](isolation/isolation-report.json)的 2D standard-3 和 WebGL standard-4 均通过：

- 各 14 项浏览器边界与引擎锁定按预期；普通同源脚本里的 `eval` / `Function` 均为 `EvalError`。外部、本地端口与文件图片不可加载，保留实际 CSP 事件。
- 容器 HTTP/HTTPS、直连 IP、DNS 和 TCP 均不可直达；授权 broker 读取 200 且实际读完 1,905 / 1,534 字节，缺令牌、错令牌、越权读、越权写均为 403。
- SANDBOX_FULL 的 uid 10002、独立 user/pid namespace、seccomp 均成立。控制器 environ/mem 读取为 EACCES；父浏览器仅四个允许环境键，分别 8 个 Chromium 进程的全部可读原始环境字节未发现令牌；没有把子进程 argv 片段误当环境键，也未传出 bearer、指纹或原始字节。
- 非校准操作被拒且零计算；未授权帧被拒。两实例原生停止为 true，费用全部结算，lease 为空，[模型预算](isolation/model-budget.json)未变化，本轮临时密钥删除成功。

[场景回执](isolation/smoke-report.json)共 48,020 ms；控制器 ready 为 13,626 / 1,476 ms，保守计算上界合计 **2,827 usd_micros**。本轮只验证固定 G1 隔离项，没有重复成片、选型或声音样本；S2 任意代码、资源耗尽等完整故障语料仍待实现，I/O 性能收益仍须实测。

## 并发故障补入有界基础设施重试

基线暴露的容量/连接失败此前只能停止整片。新候选按 PRD 04 的 15/60 秒、最多 3 次执行补上应用调度，仅允许明确容量/断连码；确认旧 DO 已物理停止、预留已结算，才创建独立新 ID。失败结果和重试 ID 分别持久化，原生 step 保持零重试；generation、素材许可、原始绝对期限和累计预算逐次重查。未知停止/费用、作品/QA/许可/预算错误不重试，失败首因和已产生的费用均保留。

Node 26.12.0 下新增回放通过（116 ms）：容量失败后新尝试成功、检查点重放零重复、15/60 秒与最多 3 次、三类清理不确定不重发、确定性错误不重发、退避期间取消、截止时间不足及实际预算累计拒绝。原成功成片提交回放（262 ms）和汇总（233 ms）通过，TypeScript 7.0.2 通过。汇总保留全部失败尝试/费用与完整客户端墙钟，仅用最终成功分段统计逐帧分布，不把无回执的失败计为零。这些本地检查不等于原生并发可靠性通过。

## I/O 候选留下三部样本，启动前等待仍会阻断

[40072684396](https://github.com/ten2ten2/promobento/actions/runs/40072684396) 在 `582b8426ef9b214c972eee6ea6c0b98278cc1ad5` 只部署 Worker，[复用](io-attempt/renderer-reuse.json) `420e245` 的已验证镜像，未重建镜像。[原始报告](io-attempt/performance-report.json)保留 3 部成功 2D 串行片：98,493 / 56,123 / 55,911 ms；15 处接缝均零差异。第四部的首因是 `RENDER_STARTUP_TIMEOUT`：39,953 ms、`probeCount:0`、monitor 仍 pending。启动前的持久化/注册等待已耗尽健康窗口，没有证明控制器接受过健康探测；随后三个容量错误可能与失败清理相连，不能据此当作三个独立的账户容量不足。

31 次计算最终均确认停止并结算，共 **59,895 usd_micros** 保守上界，无未结费用，密钥已删除；未继续其余矩阵。三部有效样本不构成完整分位数，也不能作为后续改变启动路径候选的墙钟分布。

新修复将 broker 注册移到分配实例之前，单独 30 秒有界；[API 允许启动前注册](https://developers.cloudflare.com/containers/api/durable-object-container/#interceptoutboundhttp)。实际启动仍保留 30 秒健康窗口，alarm/轮询/重试共用原始绝对期限；注册耗时单列且完整计入客户端墙钟。已确认停止/结算的注册或健康超时可走同一有界基础设施重试，未知停止仍不能重发。一次受影响的 5 项定点回放通过（1.75 秒），含注册期间不分配实例、挂起超时、取消栅栏和既有健康/首因处理；TypeScript 7.0.2 通过。后续完整原生结果见下节；先采 WebGL 再采 2D，28 部门槛不变。

## 28 部完整矩阵通过，2D p50 达到 60 秒目标

[40073832345](https://github.com/ten2ten2/promobento/actions/runs/40073832345) 在 `257ca1b6babdf12adc4d5e81b0b839fdadd9d7d8` 只部署 Worker，版本 `56bcc368-3474-4173-9eab-470d080774db`；[复用](matrix/renderer-reuse.json) `420e245` 的镜像 `sha256:9bfd46ae79e01615b8519e6319ba03f183cfef8f8617011c06b3a3788b34ce84`，没有重建镜像。Node 26.12.0、pnpm 12.14.0、Wrangler 4.152.0、Chromium 151.0.7922.34 不变。

[原始报告](matrix/performance-report.json)保留每部输入、900 帧的真实捕获计时、成片/封面引用、全部 attempt、原生停止和费用。先做 WebGL 10 串行 + 4 并发，再做 2D 同组；两类均为 30 秒、1920×1080、30 fps、有 AAC 的实际交付。

| 片型 / 负载 | 部数 | 墙钟 p50 / p95 秒 | 逐帧捕获 p50 / p95 ms | 单片计算上界 p50 / p95 USD |
| --- | ---: | ---: | ---: | ---: |
| 2D 串行 | 10 | 51.861 / 70.572 | 115.110 / 177.289 | 0.009715 / 0.013609 |
| 2D 四路并发 | 4 | 55.153 / 76.416 | 112.078 / 151.385 | 0.009538 / 0.009752 |
| WebGL 串行 | 10 | 67.844 / 102.814 | 115.393 / 185.937 | 0.037497 / 0.066444 |
| WebGL 四路并发 | 4 | 101.524 / 106.862 | 111.676 / 134.873 | 0.030718 / 0.041308 |

分位数为经验最近秩；4 部并发的 p95 即该组最大值。墙钟从客户端 POST 到首次读到 passed，包含排队、broker 注册与 1 秒轮询。逐帧只含 seek/ready ACK/JPEG92，不含编码器背压、QA 或额外接缝 PNG。费用为已持久结算的分配资源保守上界，不是供应商账单或模型费用。

### 启动、隔离、接缝与回收

- 新实例启动到控制器健康响应的 p50 / p95：2D 串行 **1,405 / 6,896 ms**，并发 **1,355 / 1,561 ms**；WebGL 串行 **1,811 / 11,950 ms**，并发 **1,307 / 9,960 ms**。这里不表示 Chromium 页面已完成握手。
- 476 次 broker 注册 p50 **1 ms**、p95 **2 ms**、最大 **15 ms**，在分配实例前完成。WebGL 并发分段等待名额 p50 **13,585 ms**、p95 **35,537 ms**；24 个工作区名额未增加，等待完整计入墙钟。
- **25,200 帧 / 392 处接缝**全部取得；接缝均零差异，无需容差。分段跨三种 CPU flags 摘要，全部使用同一镜像；真实 SwiftShader 回执保留在报告。
- **476/476 次计算首次成功并确认物理停止、费用结算**；28 个操作清理均 confirmed，lease 为空，无未结费用。总保守计算上界 **686,346 usd_micros（$0.686346）**。本轮临时密钥已删除；[模型预算](matrix/model-budget.json)没有新增费用或预留，历史开账仍未确认。
- 两类首部实际 MP4 和封面保留在该 run 的 `s1-staging-deployment` 产物及私有 R2；已查看两类实际封面。图片/视频不进 Git、不公开。整个[场景](matrix/smoke-report.json)为 **1,536,843 ms**，不把整组时间误作单片延迟。

### 保留当前规格和目标，峰值仍待验

本候选 2D 串行 p50 低于原 60 秒目标；相较旧基线 66.774 秒的改善来自包含 I/O、队列和启动修复的整体候选，不作单项消融归因。WebGL 全片使用 24 个 standard-4 分段，也低于原整片 3D 300 秒目标。保留 JPEG92、2D 6 段、WebGL 24 段与当前实例规格，不再重做已通过的选型、隔离或 13 种配乐。

两类各 12,600 个捕获帧的 p99 为 **208.863 / 225.209 ms**，乘 1.5 为 **313.2945 / 337.8135 ms**。这只标定了两条原创校准片的捕获部分；未包含编码背压、素材准备和 QA，因此保留现有每段基数及启动/整片绝对期限，不把该值直接替换为完整分段预算。六题真实输入的模型/草稿/成片时间和模型成本仍未测。

420 个分段的峰值内存均为 `null`，原因 `cgroup_peak_not_exposed`；该指标仍为 **unverified**，S1 出口处理见下节。当前步骤已改为有历史小探针的网关 Opus/DeepSeek；真实长提示/导演质量、六题成片和 4/6 负责人评判仍是 S1 未完成项，官方备用不再是必需绑定。

### 内存列为 S1 平台限制，待实际数据补验

容器未暴露 cgroup 高水位接口；[40126364745](https://github.com/ten2ten2/promobento/actions/runs/40126364745)按[官方 GraphQL 指标](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-container-metrics/)只读查询上述矩阵的完整时间窗，接口有权限、staging 应用匹配，但[返回零条采样](memory/platform-metrics.json)，0 模型/渲染。无数据不记为内存为零，也不回填旧分段回执。

负责人于 2026-10-25 明确回复「允许暂缓这一项，继续完成其余 S1 验收」，[决定原文与范围](memory/owner-decision.json)已留存。内存峰值作为 **S1 已知平台限制**暂缓，不再单独阻止 S1 出口；测量状态仍为 unverified，平台提供真实数据后补验。其他性能、安全、费用、时间和成片门槛不变，生产仍关闭。
