# G1 前置技术探针

2026-10-23临时Worker／容器的条件性证据，用于选型和安全规则，不是正式S1镜像或产品验收。正式结果见[性能／隔离](../2026-10-24-s1-performance/README.md)和[媒体／恢复](../2026-10-24-s1-staging/README.md)。

## 来源与环境

[探针代码](../../../apps/render-container/probes/g1-pre/)、[工作流](../../../.github/workflows/g1-pre-probe.yml)。[run1报告](run1-report.json)对应c5b9f0b／[39822899286](https://github.com/ten2ten2/promobento/actions/runs/39822899286)；[run2报告](run2-report.json)对应24fd48d／[39824977152 attempt2](https://github.com/ten2ten2/promobento/actions/runs/39824977152)。账户／Worker地址已脱敏。

当时为Node22 Debian镜像、Chromium151.0.7922.34、Debian FFmpeg、Wrangler4.152.0、compatibility_date2026-10-20，使用上游4236053的kinetic-type／object-3d及加长初始化等待，不等同当前正式媒体环境。每轮Worker／容器应用已删除；一份容器文件系统快照当时无删除接口，按平台30天过期记录，不宣称已主动删掉。

## 仍支撑设计的结果

| 项目 | 实际结果 |
| --- | --- |
| broker／断网 | ctx.container＋durable_object＋interceptOutboundHttp可用；授权读写200，越权403；公网HTTP(S)／IP／DNS／TCP／UDP不可达，broker HTTP正常但显式dns.lookup超时 |
| 令牌／uid／沙箱 | 删除环境变量仍可被同uid读出environ／内存；uid10002读取控制器均EACCES，独立namespace／seccomp完整。支持请求体传令牌而非“读后删环境” |
| 停止／空闲 | destroy223–525ms后stopped，signal15后378ms内停；12实例启停成功。monitor挂起时150秒仍运行，不挂时已停，不能依赖空闲超时收尾 |
| Workflow | step.do派发→waitForEvent←sendEvent，2.6秒；只证明该探针链路，不表示正式渲染已全改事件等待 |
| Ajv | standalone可在workerd运行；运行时编译EvalError。预编译是必要执行路径 |
| 接缝 | 冷／顺差最大1色阶、0.0031%像素，说明应使用已定义容差而非字节全同 |

### 捕获与WebGL选型

2D1080p的90帧CDP直送FFmpeg：standard-3 PNG192.7／JPEG92 168.1ms/帧，standard-4为172.7／135.7；JPEG92相对PNG三个样本SSIM0.9977–0.9984。它们是上游模板旧环境样本，不是当前整片分布。

object-3d：standard-3页面加载23–34秒、后续帧约3.9秒，standard-4约17秒／2.3秒；低dpr、着色器磁盘缓存和文件系统快照没有稳定收益。不再引用更早“首帧31秒”作当前负载数据。正式捕获／机型结论以S1证据为准。

未覆盖当前生产组合全流程、真实模型流中断、客户预览或完整攻击语料；后续补验状态只见实施状态，不在历史探针末尾复制“当前待验”清单。
