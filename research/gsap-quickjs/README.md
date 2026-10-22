# GSAP 普通对象动画在近似加固 QuickJS 中的探针

私有固定时钟与空计时器封装支持了所附实验的普通对象动画；真实准入环境尚未验证。生产 GSAP-free 门禁和用途许可判断仍按 [09](../../docs/prd/09-sources-and-licensing.md#2-视频创作上游) 执行。

## 所附实验观察到了什么

[result.json](result.json) 保留用户提供的第二份补丁中的实验数值和原始摘要，本次只补充来源与精度字段，未独立重跑 GSAP。它不是本次容器复验产物。样点为 `[秒, x, y, r, updates]`；`x/y/r` 经 `toFixed(4)` 舍入，以下一致性仅指这些四位小数样点。

| 用例 | 所附结果 |
| --- | --- |
| 不加封装，直接加载 UMD 包 | 初始化失败：`cannot read property 'now' of undefined`（ticker 读取 `Date.now`） |
| 封装后：绝对终值，时间轴位置 `"-=0.2"` | 乱序 seek（0→0.5→1.2→0.3→1.2→1.3 秒），两次 1.2 秒的舍入值一致 |
| 封装后：属性相对值 `x:"+=100"`，正序与先跳到末尾 | 0、0.5、1、1.5、2 秒的已记录样点全部一致 |
| 默认 `seek(t)` 时的带状态 `onUpdate` | 回调未执行 |
| `seek(t,false)` 时的带状态 `onUpdate` | 本例的计数器从 0 增至 1、2，随调用历史变化 |

原始摘要只比较了相对值用例在 1 秒的结果。当前 [summary.mjs](summary.mjs) 比较全部对齐样点，并在缺失、重复、失败或畸形用例时拒绝生成结论；对所附数据的可信单测得到相同摘要。属性相对值在这个新建时间轴、单一目标对象中未见顺序依赖，其他初始化和调用历史仍需实验。

## 与真实准入环境的差异

- 所附版本：GSAP 3.14.2（`dist/gsap.min.js` SHA-256 `c174bfce…8280`，探针核对确切字节）、renderer 固定的 `quickjs-emscripten` 0.32.0、Node 26.12.0。
- 近似加固：不安装原生 `Date` intrinsic；`Math.random` 调用即抛错；计时器、`window`、`self`、`console` 等指定全局被设为不可写、不可配置的 `undefined`。**没有冻结整个 `globalThis`，也没有深冻结内建对象及其原型**。
- 封装：固定时钟 `{now:()=>0}` 和两个永不触发的计时器作为函数参数传入，不写回全局；UMD 走 CommonJS 分支。每个用例使用新的 runtime。
- 未覆盖真实 admission bootstrap、ES 模块求值、WASM 线性内存上限、中断器、`prepare/draw` 接口及全帧逆序命令比对。外层 Docker 限额不能替代这些检查。所附原始记录也没有容器隔离验收证据。

时间轴位置（如 `"+=0.2"`、`"-=0.2"`、标签）与属性相对值不同：前者安排片段的时间，后者从目标的起点值计算属性。若未来获准接入，须分别验证，不因本实验直接放行任一写法。带状态的回调可累积历史；本例默认 `seek` 抑制回调，可信封装是否统一禁止或抑制事件仍是接入研究项。全帧逆序命令比对能检出正、逆序两条执行轨迹产生的差异，不是对所有调用历史的证明。

## 在隔离容器复现

先按 [M0a 研究入口](../m0a/README.md)取得固定上游 checkout，核对独立 GSAP 许可及研究用途。runner 要求 checkout 位于 `5f2608c2e12abcf518f74dde86093b19f7f88603` 且干净，不下载或执行安装脚本。准备符合 [08](../../docs/prd/08-codex-execution.md#本地canvas-commands-v1入口) 的 Linux/cgroup v2 Docker daemon 后：

```bash
mise run build:admission
mkdir -p artifacts/gsap-quickjs
mise exec -- node research/gsap-quickjs/run.mjs \
  --upstream artifacts/m0a-baseline/upstream \
  > artifacts/gsap-quickjs/reproduction.json
```

只运行这个可信宿主入口；`probe.mjs` 是容器内部程序，不能在宿主直接执行。runner 通过现有 `verifiedAdmissionImage` 核对当前源码与不可变镜像 ID，不改变正式镜像或准入流程。每次只读挂载探针与摘要脚本，以及固定上游的 `gsap.min.js`、`GSAP-LICENSE.html`、`GSAP-LICENSE.txt`；不挂载整仓库、Docker socket、凭据或可写宿主目录。

容器断网、非 root、只读根、撤销 capabilities、禁止提权，限 1 vCPU、256 MiB 内存（禁用额外 swap）、32 进程及 32 MiB tmpfs。宿主在启动前检查实际配置；从暂存输入到结果检查共用 60 秒期限，另有最多 30 秒的强制回收期限。正常结束、失败、超时或 SIGINT/SIGTERM 取消均回收本次随机名称容器；镜像/宿主预检使用既有有界命令。结果记录实际镜像、上游 commit、限额与时间，不覆盖所附原始实验。

容器复现入口、实际限额及取消回收尚待真实环境验收。[可信摘要与 runner 参数单测](../../tests/research/gsap-quickjs.test.mjs)不加载 GSAP/QuickJS，不代替实际运行。

GSAP 字节不纳入 Git 或生产镜像；运行时保留其独立许可。本目录原创代码和说明按仓库 MIT 许可。
