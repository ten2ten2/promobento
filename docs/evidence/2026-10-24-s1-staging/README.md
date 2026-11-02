# S1 staging 媒体与恢复证据（历史）

以下是旧执行架构在内部 staging 的媒体/恢复实测，不代表最新原生分支已部署，也不是客户产品验收。原始回执固定当时源码和镜像；当前状态见[实施状态](../../implementation-status.md)。

## 实测结果

| 范围 | 原始证据 | 结论和限制 |
| --- | --- | --- |
| 15 秒 2D 导出、提交与私有下载 | [报告](film-success/smoke-report.json)、[CI 40040999452](https://github.com/ten2ten2/promobento/actions/runs/40040999452) | 1920×1080、30 fps、450 帧、AAC、5,320,462 字节；接缝零差异；当轮静音，非听感验收 |
| WebGL 四画幅冷/逆 seek | [报告](webgl/smoke-report.json)、[CI 40046230859](https://github.com/ten2ten2/promobento/actions/runs/40046230859) | 20 次比较零差异；是定点帧，不是完整多画幅影片 |
| 30 秒 WebGL、24 分段、配乐及下载 | [成片](webgl-film-success/smoke-report.json)、[费用](webgl-film-success/inspection.json)、[CI 40051873501](https://github.com/ten2ten2/promobento/actions/runs/40051873501) | 1920×1080、900 帧、AAC、14,681,738 字节，23 处接缝零差异；26 次计算停止/结算 **94,041 usd_micros**，未做负责人完整视听 |
| 取消、原生终止和整次重启拦截 | [恢复报告](recovery-attempt/recovery-report.json)、[只读检查](recovery-attempt/inspection.json)、[CI 40055971723](https://github.com/ten2ten2/promobento/actions/runs/40055971723) | generation fence、Workflow 原生终止、实际停止及结算被验证；父作业预检失败，不可把整轮记为成功 |
| 零付费预检与共享账本阻断 | [无密钥预检](director-preflight/director-preflight-report.json)、[预算阻断](gateway-director-preflight/director-preflight-report.json)、[密钥绑定](gateway-director-preflight/binding.json) | 测试不产生新模型/渲染费用；旧结果不能证明现行模型授权有效 |

计算金额是资源保守上界，不是供应商账单。失败也保留原始 [提交诊断](film-attempt/inspection.json)、[24 分段失败](webgl-film-attempt/smoke-report.json)和对应停止/费用证据，不用后来成功覆盖之前的负面结果。

## 数据边界

环境回执 [environment.json](environment.json)中内存高水位不可用，保持 `null`/`unverified`；不以 RSS 估算，具体见[内存证据](../2026-10-24-s1-performance/README.md#内存列为-s1-平台限制待实际数据补验)。

原始 JSON、私有媒体引用、源码身份和许可保留；当前 staging 部署状态见[实施状态](../../implementation-status.md)。
