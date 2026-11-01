# 当前实施状态

当前 PRD **v3.1**、协议 **3.0.0**。**S0 完成；S1 未完成，不能进入 S2 或对客户开放。** 生产 `agent-policy.enabled=false`。本页只记实际能力、验证范围与阻塞事项；目标需求以 [PRD](prd/README.md) 为准，历史实验以 [原始证据](evidence/2026-10-24-s1-director/README.md) 为准。

## 代码与部署

| 层面 | 当前状态 | 缺口 |
| --- | --- | --- |
| 原生执行 | 主线固定 huashu-motion v0.3.1（commit `52467f99c602b76ba86d511d37acdfe93fa1e16e`）；完整 CLI、runtime、模板、字体及工具，原生 HTML/JS 为唯一影片源码 | 尚未在真实 Cloudflare 上验证新镜像 |
| 导演与版本 | 方法 **2.0.1**；真实三方向帧、选择、Brief/Treatment、最难镜头、原生编辑、`baseRevision` 分支；不支持旧方法/FilmSpec 重放 | v3.1 的参考片 Analysis、唯一 Script/语义事件、候选锁定与依赖复用尚未实现完整切片 |
| 预览与整片 | 四画幅 PNG；15 秒 450 帧、30 秒 900 帧 H.264/AAC MP4；最终编码帧与实际工程清单 | 实际云端性能、声音听感、完整动态 QA、负责人审片 |
| 控制与预算 | D1/R2、outbox、Workflow、容器物理停止、generation fence、模型费用实际/未知预留；阶段一的持久容量准入、事件唤醒、分离期限、未知结果恢复和租约/通知超时隔离已合入；阶段二代码改为流式 R2 校验写入、容器流式媒体传输与文件分块摘要、限制传输并行，记录 cgroup/进程/临时盘指标；内部 API | 新流式路径及资源采样**尚未真实 Cloudflare 验收**；内存峰值与吞吐仍为 `unverified`；租户 ACL、付费容量保护、正式冻结及购买结算未实现 |
| 客户产品 | 平台、品牌、UI/认证/购买配置种子 | Studio、Google/邮箱登录、工作区、上传/ASR、Waffo、成片交付和合规审核尚未接入 |

完整原生基线 [CI](https://github.com/ten2ten2/promobento/actions/runs/41277134140) 对提交 `1cab53699d12647bbf7f942eafc55a507f67aea8` 通过：契约/类型、原生单元测试、固定 Linux 镜像中的实际浏览器、四画幅、音视频导出及隔离探针。该结论**仅适用于所列 SHA 和覆盖范围**；后续提交及真实模型、Cloudflare、支付、用户使用均未由此验证。独立合成性能样本为 15 秒片原生渲染 46.4 秒、30 秒片 84.8 秒（不含最终转码），不是性能分布或服务承诺。

最后留证的 **staging 部署仍是旧引擎**：源码 `d8ce6903a1b8f65a6683c62f0934986df98bdb4b`，方法 1.19.0，镜像 `sha256:77da1a28945f82e18478e2a2ad9d6c47bba59d3a00793d3198641334d4c27761`（[部署检查](https://github.com/ten2ten2/promobento/actions/runs/41082629756)）。当时只验证只读健康/容量/预算，没有在新引擎运行影片。主线原生代码不代表 staging 已升级；旧 staging、真实素材、回执和费用数据不随代码清理删除。

## S1 作品与质量

- 验收覆盖仍为 **1/12 创作输入、2/24 最终片**，负责人自动作品质量未通过；同题改版和人工修订不增加覆盖。MiniMax、Duolingo 的镜头、接缝、字幕、冻结及音色问题在[导演证据](evidence/2026-10-24-s1-director/README.md)中逐项记录，不能折算为原生引擎的通过结果。
- 旧 standard-2 音频矩阵 28/28 已交付；2D 串行 p50 60.834 秒超过 60 秒目标，后来样本不足以建立新分布。内存峰值仍为 `unverified`。旧渲染链的数字只作历史诊断，见[性能证据](evidence/2026-10-24-s1-performance/README.md)。

## 有效授权与费用

- 原模型授权总额 $300，但历史供应商总账未核实：`openingMicros:null`、`openingConfirmed:false` 不变。最近已存快照（2026-10-30）为实际结算 **2,769,757**、15 笔未知 **1,052,499**，合计 **3,822,256 usd_micros**；这不是供应商账单确认。
- 曾批准的 $5 风险预留、最多 $10 新实际/未知占用的临时授权已于 **2026-10-31 上海时间过期**。任何新的付费模型调用须先对账或取得新授权；未知费用不补零、不自动重发，重复派发证据保留。内部单操作 $3 上限不等于重新获得授权。详细记录见[费用回执](evidence/2026-10-23-model-probe/README.md)与[导演证据](evidence/2026-10-24-s1-director/README.md)。

## 下一步与验收关口

1. 在受控授权、明确发布 SHA 和真实资源核对后部署原生 staging；验证新镜像完整任务、媒体字节、取消、物理停止、恢复、未知费用与补账。
2. 实现 v3.1 的参考视频理解、统一 Script/语义时间、素材候选锁定/复用，并对原生作品补齐 12 输入/24 最终片覆盖、音画同步与完整动态审核；负责人愿意按正常速度发布须不少于 4/6。
3. 用新引擎重测性能、隔离及声音；未满足 [06 性能与质量关口](prd/06-testing-and-release.md)前不进入 S2。再建设客户 Studio、身份/权限、上传、购买及冻结交付。

实施顺序见 [08](prd/08-codex-execution.md)，实现入口见[云端控制](../apps/cloud/README.md)、[容器](../apps/render-container/README.md)、[内部素材](../research/evals/README.md)。原始运行时和 staging 证据分别保留在 [runtime](evidence/2026-10-24-s1-runtime/README.md)、[staging](evidence/2026-10-24-s1-staging/README.md)；暂停私有检查点 `s1-paused-private-20261025`（`31cb416`）只按需取用，不整体合并。
