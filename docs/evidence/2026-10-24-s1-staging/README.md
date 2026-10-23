# S1 正式形态 staging：工程片出片通过，峰值内存未提供

[Actions 39987356301](https://github.com/ten2ten2/promobento/actions/runs/39987356301) 部署 `3942ffc06162efd658cca757d1f7409a08ac2ded`；正式 runtime 镜像摘要 `sha256:c042583ad9ecdb58ea348e10bc55fe85da440fd1af89567b4346fcdf3bc4048c`，Worker 版本 `45749dc4-e696-4d5d-82bc-3434eced59bc`。不是临时探针，也不是完整 G1。

工具为 Node 26.12.0、pnpm 12.14.0、Wrangler 4.152.0、Chromium 151.0.7922.34。构建日志确认 FFmpeg 的 Ubuntu 包版本为 `7:6.1.1-3ubuntu5`，与环境锁一致；后续安装显式固定该版本，未因补记录重建相同媒体环境。

## 实际结果

- 真实 Worker → OperationDO → ShardDO → 独立容器 → broker/R2 → Chromium，studio 成功输出原创工程片的 45、375 帧。运行时执行了独立 uid 与 SANDBOX_FULL 自检；未运行完整攻击语料。
- 45→375→45 的两张 45 帧 PNG 完全相同：最大通道差 0、差异像素 0%。已查看实际开场和 CTA，两段文字清晰可读。这只覆盖该横屏逆序路径，不代替完整四画幅矩阵。
- [环境回执](environment.json)确认 cgroup v2 `memory.peak` 和两个 v1 `memory.max_usage_in_bytes` 路径均未暴露。任务明确阻断为 `RENDER_MEMORY_METRIC_UNAVAILABLE`；没有填 0、改用控制器 RSS 或放宽门槛。
- 在 studio 预检就发现问题，本轮未启动三个分段和声音任务，未重复编码整片。studio 关闭、操作取消、并发计数归还与一次性密钥删除均完成。
- [旧任务对账](reconciliation.json)：只对先前取消的 `smoke-546f411b83c7-39985471319` 再确认停止；补齐 1 条旧 attempt 的停止记录，无未结费用。不重启计算、不改写原结算、不清零未知费用。

截图、部署日志和报告在该轮 `s1-staging-deployment` 产物（artifact `12515579404`）；本机下载至 `artifacts/s1-staging-39987356301/`。素材仅为仓库原创 SVG 和虚构工程文案，未处理六题第三方素材，未调用模型。

## 负责人决定与后续范围

2026-10-24 负责人允许峰值内存显式记为未提供，继续本次内部出片，G1 此项保留未验证。后续回执使用 `peakMemoryMiB:null` 与 `peakMemoryUnavailableReason:"cgroup_peak_not_exposed"`，不改写本轮实际阻断结果。媒体、隔离和预算门槛不变；已通过的 studio 帧路径复用证据。官方 Anthropic 继续按负责人决定未接通；S1 仍未完成。

## 继续出片：计算成功，提交失败

[40038946955](https://github.com/ten2ten2/promobento/actions/runs/40038946955) 部署 `860df139a6d40053860462cb22f93a79f4b2286b`，镜像 `sha256:8c0a1c628e582578ae2914e9bf79cf0b70957dc82e6cb1513e7bf597ae0a80d9`，Worker `a2740a18-bfc8-47c7-b527-05628aa7e546`。三个分段、声音及拼接均成功，峰值回执正确为 null 加原因；约 99.47 秒生成 450 帧、1920×1080/30 fps、AAC 的 15 秒工程片（5,318,671 bytes，一秒峰值码率 8,490,632 bit/s）。两处接缝均完全一致。计算保守费用上界合计 12,998 usd_micros，五笔均已结算并停止。

该轮**没有提交或交付成功**：`commit-render` 的首次错误为 `NOT_JSON`，默认重试随后把它掩盖成 `RENDER_DEADLINE`；harness 在 240 秒超时后取消操作。D1 初次只读查询 [40040029787](https://github.com/ten2ten2/promobento/actions/runs/40040029787)确认计算成功；补读 Workflow 的 [40040227722](https://github.com/ten2ten2/promobento/actions/runs/40040227722)定位了原始错误。[完整只读回执](film-attempt/inspection.json)保留步骤、结果引用与结算，未再次渲染。

修复将复合步骤值改为共享规范 JSON 文本边界，并禁止最终提交默认重试。Node 26.12.0 下只运行了一次实际提交代码的回执回放（392 ms，通过），没有重跑媒体或导演套件。

## 修复后：真实云端出片、提交与下载通过

[40040999452](https://github.com/ten2ten2/promobento/actions/runs/40040999452) 在 `f5b431a4f2729326048acf1563c93c4b05d76f13` 通过。只部署 Worker（版本 `391d6c84-7f8b-43d4-a789-09b1f8021094`），确认渲染输入未变化后[复用上述镜像](film-success/renderer-reuse.json)，未重建或推送容器。事实卡、真实模型、配乐风格、九积木帧图和完整 G1 均未重跑。

[原始出片报告](film-success/smoke-report.json)：

- Worker → Workflow → 三个独立分段、声音 → 接缝/观测 → 拼接 → generation-fenced 提交 → 私有下载全部通过；harness 总计 113.865 秒，包含准备/上传/轮询/下载，不作任务 p95。
- 15 秒、450 帧、1920×1080、30 fps、AAC，5,320,462 bytes，一秒滑动峰值码率 8,487,520 bit/s，未触发整片重编码。这是按输入要求静音的工程片，不是配乐试听或六题作品。
- 149、299 两处 PNG 接缝均完全一致；三个分段的内存均为 `null` 加 `cgroup_peak_not_exposed`，汇总为 `unverified`，不计 G1 内存通过。
- 影片与封面已下载至本机 `artifacts/s1-staging-40040999452/`，Actions 产物名 `s1-staging-deployment`。已查看实际封面，并用独立临时 Chrome 155.0.8059.85 解码 MP4 的 45、165、375 帧，开场、产品图和 CTA 清晰；未将该查看记作完整正常速度视听验收。
- 成片提交时 lease 已清空；结束取消与临时密钥删除成功。此轮未单独采集账单金额，不纳入成本分位基准。先前失败轮的结算见上一节，不能混作本轮费用。

云端渲染仍为 Chromium 151.0.7922.34、FFmpeg `7:6.1.1-3ubuntu5`、Node 26.12.0；部署工具 Wrangler 4.152.0、pnpm 12.14.0。峰值内存契约只跑一次定点检查（20.6 ms，通过），最终提交只跑上述一次本地回放；两次出片之间先读取原始错误修复，未反复运行完整 CI。S1 出口仍缺完整 G1、生产 Manifest 迁移、六题真实评测及负责人试听；官方 Anthropic 继续按负责人决定保留未验证。
