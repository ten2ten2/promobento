# G1 性能、选型与隔离证据

当前 standard-2 音频完整矩阵 **28/28 部交付，但 2D 串行 p50 60.834 秒超过 60 秒目标**。后续 PNG／读取候选没有完整新分布，性能未通过。捕获／机型、固定隔离已通过；内存按下文平台限制暂缓。实际阶段和继续工作见[实施状态](../../implementation-status.md)。

## 当前资源：28 部交付，2D 时间未通过

[40156758448](https://github.com/ten2ten2/promobento/actions/runs/40156758448)，源码 `9dd8b36a8e304df9662cd718cf47632cc64772b6`；audio/assemble standard-2（1 vCPU）、2D 六段 standard-3、WebGL 24 段／相应段 standard-4。镜像身份、全部 28 部和失败 attempt 见[原始报告](current-resources/performance-report.json)。

| 30 秒片／负载 | 数量 | 墙钟 p50／p95 秒 |
| --- | ---: | ---: |
| 2D 串行 | 10 | 60.834／79.609 |
| 2D 四路并发 | 4 | 73.529／84.255 |
| WebGL 串行 | 10 | 73.597／121.208 |
| WebGL 四路并发 | 4 | 115.657／118.831 |

25,200 个实际捕获帧、392 处接缝全零差异；479 次计算（含三次恢复 attempt）均确认物理停止／结算，分配资源保守上界 **909,586 usd_micros**，无未结计算／lease，临时密钥回收。零模型调用，[模型账本](current-resources/model-budget.json)不变。420 个分段峰值为 null／cgroup_peak_not_exposed。

墙钟从客户端提交到首次读到 passed，含排队、注册和轮询；经验最近秩计算，四路 p95 即组最大值。逐帧计时只含 seek／ready ACK／JPEG92，不含编码背压、QA／额外 PNG；计算费是资源上界，不是账单。不同负载、旧资源、失败或不完整候选不混成一个分布。

## PNG／读取候选没有完整新分布

[40160712901](https://github.com/ten2ten2/promobento/actions/runs/40160712901)，源码 `fbf1a740f146f56efb7bb57314d7a8953ceec331`。[原始采样](qa-decoder-attempt/performance-report.json)前九部 2D 串行交付，45 处接缝全零；第十部 shard0 `INIT_TIMEOUT`，未继续四路并发，不计算完整分位数。

79 次计算均停止／结算 **149,511 usd_micros**，无遗留容量，密钥回收，零模型。[只读原生诊断](qa-decoder-attempt/native-inspection.json)确认初始化超时，但只有 Worker 日志，未定位容器初始化子阶段。该轮没有放宽期限或将其自动归为可重试基础设施故障。

当前 PNG 优化只计算实际行 predictor，字节相同也先完整解码一次核验；2D 观测／接缝读取有界两段并行并排空失败在途项，不减少有效性／容差检查。`g1-2d-performance` 可在需要时仅补受影响的十串行＋四并发，不能把 14 部称完整 28 部 G1。

## 正式捕获格式、机型与 studio 延迟通过

[40065497336](https://github.com/ten2ten2/promobento/actions/runs/40065497336)，源码 `7f615f95bc28ab864cff4d90d9862f48a48b120a`。[40 组样本](selection/selection-report.json)为 2D/WebGL×standard-3/4，每组授权帧轮换十次，共 160 次 PNG／JPEG90/92/95 捕获，RGB SSIM 对同帧 PNG。

| 画面／实例 | still p50／p95 ms | check p50／p95 ms | JPEG92 p50 ms | JPEG92 SSIM 范围 |
| --- | --- | --- | --- | --- |
| 2D／standard-3 | 429／709 | 434／486 | 110.75 | 0.994933–0.998587 |
| 2D／standard-4 | 395／701 | 404／457 | 106.57 | 0.994933–0.998587 |
| WebGL／standard-3 | 447／550 | 514／712 | 155.12 | 0.997547–0.997612 |
| WebGL／standard-4 | 396／516 | 426／472 | 120.90 | 0.997547–0.997612 |

保留 JPEG92、普通 studio standard-3、WebGL shard standard-4；PNG 用于接缝／观测。四次启动不是冷启动分布，不据静帧样本调整整片期限。真实 PNG 已看，普通评测越权入口被拒；[场景回执](selection/smoke-report.json)与[应用状态](selection/container-application.json)确认关闭／空容量，计算上界 **10,722 usd_micros**。不能用空 attempts 数组或费用已结推断 studio 物理停止。

## 正式镜像隔离通过

[40071258358](https://github.com/ten2ten2/promobento/actions/runs/40071258358)，源码 `420e245a72f7655bf3aa1b2a190be65ae95d2257`。[原始报告](isolation/isolation-report.json)覆盖 2D standard-3 和 WebGL standard-4：

- 各 14 项浏览器边界；普通同源脚本中的 eval／Function 为 EvalError；外网、本地端口与文件图片不可加载。
- 容器 HTTP(S)／IP／DNS／TCP 不可直达；broker 正向 200 且读完，缺／错令牌、越权读写均403。
- SANDBOX_FULL、uid10002、独立 namespace／seccomp；控制器 environ/mem 为 EACCES，父浏览器环境白名单和全部可读 Chromium 原始环境字节未发现令牌。
- 非校准／未授权帧拒绝，物理停止 true、lease 空、费用结算 **2,827 usd_micros**，临时密钥回收，[模型预算](isolation/model-budget.json)不变。

探针不传 bearer、不返回环境值／指纹；不可读进程不记作无泄漏。这里只覆盖固定 G1 隔离项，S2 任意代码／资源耗尽完整语料未完成。早期调试求值误用与环境字节误判保留在 [isolation-diagnosis](isolation-diagnosis/isolation-report.json)，不据修正方法删除原负面记录。

## 内存列为 S1 平台限制，待实际数据补验

cgroup 高水位接口未暴露；[40126364745](https://github.com/ten2ten2/promobento/actions/runs/40126364745)按完整矩阵时间窗只读查平台指标，权限与应用匹配，但[零条采样](memory/platform-metrics.json)。不将无数据填0、以控制器 RSS 代替或回填旧分段。

负责人批准[暂缓此项继续其余 S1](memory/owner-decision.json)。状态仍 **unverified**，null 和原因保留；平台有实际数据后补验。此例外只免除该项独立阻塞 S1，其他性能、安全、费用、时间、质量和生产门槛不变。

## 旧候选与反例索引

| 原始数据 | 仍有用的结论 |
| --- | --- |
| [旧 standard-1 完整矩阵](matrix/performance-report.json)，[40073832345](https://github.com/ten2ten2/promobento/actions/runs/40073832345) | 28/28，2D 串行 p50 51.861 秒；392 处接缝零差异、476 次计算停止结算。资源已变，不能据此称当前 2D 达标 |
| [基线](baseline/performance-report.json) | 十串行交付，p50 66.774 秒；并发仅3/4，WebGL未运行，不作完整矩阵 |
| [首片接缝阻断](first-attempt/performance-report.json) | CTA 边缘最大差36，虽仅0.0076195988%像素仍违反通道门槛，未交付 |
| [启动故障](startup-attempt/performance-report.json)、[原生步骤](startup-attempt/native-workflow.json) | 未 ready 不得派任务；无成片分布 |
| [I/O 候选](io-attempt/performance-report.json) | 仅三部有效样本；第四部首次探测前已耗尽启动窗口，不能归因控制器本身 |

上述已结束计算的原始停止／结算与失败仍保留；修复、局部检查和部署过程不在本页逐次复述。
