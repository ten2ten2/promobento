# G1 性能矩阵与正式选型

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
