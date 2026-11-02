# G1 性能与隔离证据（历史）

本页索引旧分段/标准实例架构的实测数据，**不作为当前完整 huashu-motion 引擎的性能分布或 SLA**。现行代码与验收缺口见[实施状态](../../implementation-status.md)，原始报告不改写。

## 历史 30 秒矩阵

[原始报告](current-resources/performance-report.json)（[CI 40156758448](https://github.com/ten2ten2/promobento/actions/runs/40156758448)，源码 `9dd8b36a`）共交付 28/28 部；2D 串行 p50 **60.834 秒**，超过旧 60 秒目标。

| 负载 | 数量 | 墙钟 p50 / p95 |
| --- | ---: | ---: |
| 2D 串行 | 10 | 60.834 / 79.609 秒 |
| 2D 四路并发 | 4 | 73.529 / 84.255 秒 |
| WebGL 串行 | 10 | 73.597 / 121.208 秒 |
| WebGL 四路并发 | 4 | 115.657 / 118.831 秒 |

25,200 帧、392 处接缝检查全零差异；479 次计算（含恢复 attempt）确认停止/结算，资源保守上界 **909,586 usd_micros**，无未结租约或模型调用。这里的墙钟含排队和轮询；计算上界不是账单。其他候选不能混入上述分位数：

- [PNG/读取候选](qa-decoder-attempt/performance-report.json)：九部有效，第十部 `INIT_TIMEOUT`，不生成完整新分布。
- [捕获格式/机型](selection/selection-report.json)：2D/WebGL、standard-3/4 的 PNG/JPEG 静帧采样；[回执](selection/smoke-report.json)不证明整片吞吐。
- [旧 standard-1 矩阵](matrix/performance-report.json)、[早期基线](baseline/performance-report.json)、[I/O 候选](io-attempt/performance-report.json)：不同资源或不完整样本，只用于复现旧反例。

## 隔离与真实停止

[隔离报告](isolation/isolation-report.json)（[CI 40071258358](https://github.com/ten2ten2/promobento/actions/runs/40071258358)）覆盖无公网、进程 UID/namespace/seccomp、浏览器动态执行限制、Broker 授权读写、真实物理停止、租约释放和费用结算；原始失败诊断见[隔离反例](isolation-diagnosis/isolation-report.json)。当轮计算结算上界 **2,827 usd_micros**，不代表整个恶意代码语料已经验收。

## 内存列为 S1 平台限制，待实际数据补验

cgroup 高水位未暴露；[平台查询](memory/platform-metrics.json)返回零条实际峰值样本，故内存为 **`unverified`**。不能填 0、使用控制器 RSS 替代，也不能反推当前原生容器峰值。[历史豁免证据](memory/owner-decision.json)只对应该测量项，不覆盖其他性能、安全、费用或成片关口。

所有原始成功/失败/费用报告留在本目录；此 README 不再维护选型、逐轮优化和部署更新记录。
