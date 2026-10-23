# S1 正式形态 staging：studio 通过，内存接口缺失

[Actions 39987356301](https://github.com/ten2ten2/promobento/actions/runs/39987356301) 部署 `3942ffc06162efd658cca757d1f7409a08ac2ded`；正式 runtime 镜像摘要 `sha256:c042583ad9ecdb58ea348e10bc55fe85da440fd1af89567b4346fcdf3bc4048c`，Worker 版本 `45749dc4-e696-4d5d-82bc-3434eced59bc`。不是临时探针，也不是完整 G1。

工具为 Node 26.12.0、pnpm 12.14.0、Wrangler 4.152.0、Chromium 151.0.7922.34。构建日志确认 FFmpeg 的 Ubuntu 包版本为 `7:6.1.1-3ubuntu5`，与环境锁一致；后续安装显式固定该版本，未因补记录重建相同媒体环境。

## 实际结果

- 真实 Worker → OperationDO → ShardDO → 独立容器 → broker/R2 → Chromium，studio 成功输出原创工程片的 45、375 帧。运行时执行了独立 uid 与 SANDBOX_FULL 自检；未运行完整攻击语料。
- 45→375→45 的两张 45 帧 PNG 完全相同：最大通道差 0、差异像素 0%。已查看实际开场和 CTA，两段文字清晰可读。这只覆盖该横屏逆序路径，不代替完整四画幅矩阵。
- [环境回执](environment.json)确认 cgroup v2 `memory.peak` 和两个 v1 `memory.max_usage_in_bytes` 路径均未暴露。任务明确阻断为 `RENDER_MEMORY_METRIC_UNAVAILABLE`；没有填 0、改用控制器 RSS 或放宽门槛。
- 在 studio 预检就发现问题，本轮未启动三个分段和声音任务，未重复编码整片。studio 关闭、操作取消、并发计数归还与一次性密钥删除均完成。
- [旧任务对账](reconciliation.json)：只对先前取消的 `smoke-546f411b83c7-39985471319` 再确认停止；补齐 1 条旧 attempt 的停止记录，无未结费用。不重启计算、不改写原结算、不清零未知费用。

截图、部署日志和报告在该轮 `s1-staging-deployment` 产物（artifact `12515579404`）；本机下载至 `artifacts/s1-staging-39987356301/`。素材仅为仓库原创 SVG 和虚构工程文案，未处理六题第三方素材，未调用模型。

## 下一条件

是否允许出片时把该内存指标显式记为未提供、保留 G1 此项未验证，已向负责人单独请求决定。决定前维持原门槛，不重复运行失败任务。官方 Anthropic 继续按负责人决定未接通；S1 仍未完成。
