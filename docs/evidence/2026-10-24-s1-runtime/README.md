# 2D 四画幅 seek 与干净环境入口修复

最终 [40061965273](https://github.com/ten2ten2/promobento/actions/runs/40061965273) 在 `38e6b25d8ae9db6893c83962ac09fb0fafc20ef3` 通过，只运行 `suite=runtime`，没有重做媒体、13 风格或导演。

## 像素反例与修复

| 提交与实际报告 | 120 帧逆序结果 | 决定 |
| --- | --- | --- |
| `804dca7`，[原始报告](report-40059971442.json) | 最大通道差 1，差异像素 0.2827449846% | 原门槛失败；5,863 个差异像素均位于标题字形边缘 |
| `aa1e705`，[will-change 候选](report-40061378758.json) | 最大通道差 34，差异像素 0.9683641975% | 候选使问题更大，撤回 |
| `38e6b25`，[最终报告](report-40061965273.json) | 完全一致 | 标题停稳时使用 `transform:none`，移除无位移的独立绘制路径 |

四画幅各检查 0、12、45、120、132、165、330、342、375 帧，随后逆序及逐帧独立冷启动。72 次比较通过：71 次完全一致，横屏冷 132 帧为最大通道差 1、差异像素 0.0142746914%，在原有 ≤2 / ≤0.1% 容差内。36 次逆序比较全部零差异，未放宽门槛。

真实字体、安全区、CTA/URL 点选、虚拟时钟/随机数、禁止 API、过期 session、dispose、超长文字失败和 30 秒末帧边界均通过。renderer uid 10002，seccomp 2、NoNewPrivs 1、嵌套 PID 深度 3，容器断网。Chromium 151.0.7922.34、Node 26.12.0。

已查看横屏 120、竖屏 45、feed 165、square 375 的实际 PNG，标题、产品与 CTA 可读。截图与环境包在该轮 `film-runtime-browser`（artifact `12547303453`）；报告保留在本目录。这是可信积木运行时检查，G1 云端性能另行采样。

## 干净环境的原入口恢复可用

原合并 CI 的 `contracts` 在生成验证器前就导入共享 film-v1 契约，报 `ERR_MODULE_NOT_FOUND`；不是 Schema 本身失败。`check:repo`、`check:contracts` 和离线 Studio 生成/核对现在自动预编译，不新增手工前置步骤。Node 26.12.0 下当前仓库、契约样例和 Studio 同步检查通过；未重跑全量 Node、类型或完整 CI。合并 CI 中已通过的离线导演及媒体子项继续按其原提交范围复用。


## DOM/SVG/Canvas2D 自写镜头通过正式镜像定点验证

[40327334464](https://github.com/ten2ten2/promobento/actions/runs/40327334464) 在 `9562707e2875289dc65be4ec3d3ccb25cd6336a7` 通过 `suite=runtime,runtime_case=custom`。[原始报告](custom-report-40327334464.json)覆盖原创自写 DOM/SVG/Canvas2D、暂停 GSAP/OM.clock 的四画幅 72 次逆序/独立冷 seek 比较、阅读停留 CDP 检查，以及旧可信积木经新宿主调用桥的实际取帧。实际 PNG 已下载并查看竖屏 180 帧；这是工程夹具，不是 MiniMax 成片或负责人质量验收。

[修复前的真实反例](custom-preseal-negative.json)中，帧比较通过，但间接 Function 在宿主 CDP 驱动的回调里未被 CSP 阻断。修复为在任何库/作品脚本载入前封闭 eval/Function 及普通、async、generator、async-generator 原型上的动态构造入口；可信宿主改用直接 CDP 调用桥，作品拿不到该句柄，不再依赖页面的 eval/Function。正式镜像中网络、存储、iframe、定时器及五种动态执行入口共九项均被阻断。

资源故障分容器执行：[绘制死循环](custom-loop-40327334464.json)在 3 秒宿主期限后约 4,013 ms 完成回收；[内存分配失败](custom-memory-40327334464.json)在 58 ms 返回 RangeError；[初始化死循环](custom-init-loop-40327334464.json)在 2 秒期限后约 2,096 ms 回收。内存项验证的是实际分配失败的受控退出，不代表测得 cgroup 峰值或完整 OOM 语料。Chromium 151.0.7922.34、Node 26.12.0，断网、独立 uid 与 Chromium 沙箱沿用正式隔离路径。未重做媒体/配乐/G1 分布或全量测试。


### 云端源码传输与四画幅 studio 已通过

[40328040010](https://github.com/ten2ten2/promobento/actions/runs/40328040010) 在 `3aaa64692f11b1c6a004f77bee2ea360f4cba6dd` 由 Actions 构建/推送镜像 `sha256:5d32d143cb98ab946bde9f0bdaf3724df68536d83739e6bcab791ff5d6d7f28c` 并部署 staging。运行时输入沿用上一节的已验证实现；本提交另外修复新导演系统提示与自写代码禁令的冲突，并让 D 接收本镜头实际使用的已清权图片，相关 D/E 回放与 cloud 类型检查通过。

[原始云端报告](cloud-custom-report-40328040010.json)：八个独立 studio 实例，四画幅的 0/36/180/330/449 帧逆序及新实例冷 180 帧共 24 次比较全零差异，原始模块经私有 R2/broker 传输并核对源码身份。实际阅读停留没有 BLOCK；四画幅各保留一条 text-covered REVIEW，实际 PNG 中可见文字未被遮住，未将该观察删除或改为零发现。已看真实竖屏 180 帧。

八次计算均已关闭并[结算](cloud-custom-costs-40328040010.json)，资源保守上界共 **5,163 usd_micros**，没有未结计算；容量为空，操作已取消，Actions 临时内部密钥已回收。这轮不调用模型、不合成声音或生成影片，不能据此增加真实创作通过数；峰值仍未测得。
