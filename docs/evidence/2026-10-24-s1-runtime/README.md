# 运行时与自写镜头证据（历史）

以下测试使用当时的可信积木/自写镜头宿主，**不是当前完整 huashu-motion 导演的成片质量证明**。原始报告和失败样本保留，现行引擎/验收见[实施状态](../../implementation-status.md)。

| 范围 | 原始证据 | 结论 |
| --- | --- | --- |
| 可信宿主定点像素、字体及沙箱 | [最终报告](report-40061965273.json)、[CI 40061965273](https://github.com/ten2ten2/promobento/actions/runs/40061965273) | 四画幅 72 次比较在既定容差内，36 次逆序零差异；非完整云端性能分布 |
| 自写 DOM/SVG/Canvas2D 的 seek 和隔离 | [报告](custom-report-40327334464.json)、[CI 40327334464](https://github.com/ten2ten2/promobento/actions/runs/40327334464) | 原生自写定点帧与阅读检查通过，Loop/初始化超时/分配失败可回收；非最终影片 |
| 私有 R2 源码与四画幅云端帧 | [云端报告](cloud-custom-report-40328040010.json)、[CI 40328040010](https://github.com/ten2ten2/promobento/actions/runs/40328040010) | 24 次比较零差异；八次计算结算上界 **5,163 usd_micros**，没有调用模型或生成整片 |

仍有价值的负面证据：

- [初始像素差异](report-40059971442.json)位于文字字形边缘；[will-change 对照](report-40061378758.json)更差。最终候选没有放宽像素容差。
- [动态 Function 绕过](custom-preseal-negative.json)表明只有 CSP 不足以封闭宿主 CDP 驱动；后续宿主封闭动态构造入口并只允许可信调用桥。该历史反例不能视为所有恶意 JS 都已通过。
- [死循环](custom-loop-40327334464.json)、[内存分配失败](custom-memory-40327334464.json)、[初始化超时](custom-init-loop-40327334464.json)证明受检资源故障可回收；没有实测 cgroup 内存峰值。
- 当时云端帧级检查保留文字遮挡 `REVIEW` 观察，不把局部可见性当整片无缺陷。真实媒体、成本及完整 S1 质量另有独立验收。

版本、镜像及时间可从原始报告和 CI 追溯。
