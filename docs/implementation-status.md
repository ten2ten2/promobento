# 当前实施状态

**PRD v3.1 / 协议 3.0.0。S0 完成，S1 尚未通过；不能进入 S2 或开放客户使用。** 生产 `agent-policy.enabled=false`。本页只记录已实现的代码、验收证据和缺口；需求见 [PRD](prd/README.md)，组件用法见下方链接。

## 当前代码

| 范围 | 已实现 | 仍未完成或验证 |
| --- | --- | --- |
| 原生引擎与隔离 | 完整 huashu-motion v0.3.1（`52467f99c602b76ba86d511d37acdfe93fa1e16e`）作为唯一影片引擎；独立容器、私有 Broker、固定文件身份与版本 | 新镜像尚未在真实 Cloudflare 完整验收；任意客户代码的安全评估未结束 |
| 导演 | 方法 2.0.1；真实素材观察、三方向预览与选择、Brief/Treatment、原生改稿和多画幅制作；独立素材／方向阶段单操作最多两路并行 | 参考片完整 Analysis、统一 Script／语义事件、候选锁定与依赖复用；模型全局 RPM/TPM |
| 渲染 | 15/30 秒、30 fps、四种画幅的 PNG 预览和 H.264/AAC MP4；最终文件、实际工程及审片帧核验；合规视频流可直接复制，否则转码 | 云端 CPU/费用节省、听感、完整动态作品质量未实测达标 |
| 控制、恢复与费用 | D1/R2、持久准入（全局 4 容器／工作区 1）、generation/lease fence、Queue/Workflow 恢复、物理停机和费用回执；流式媒体 I/O 与资源采样；授权撤销和未知用量安全阻断 | 真实云端高并发、内存峰值与吞吐仍未验证；挂载文件系统增量不是任务目录精确用量 |
| 客户产品 | 品牌、平台、路由和交易规则配置种子 | Studio、登录、上传/ASR、权限、Waffo、冻结交付与正式购买结算尚未接入 |

恢复只补建从未领取执行权的原生实例；已经开始或无法证明未开始的付费步骤不得重放。取消或失败后须确认 Workflow、计算、租约与回执，未知物理状态或费用保留待核查。授权在素材读取和最终提交时重查；模型 SSE 的部分 usage 不作为最终账单。具体实现及接口见[云端控制](../apps/cloud/README.md)、[渲染容器](../apps/render-container/README.md)、[模型适配](../packages/models/README.md)。

## 验证与部署

- [PR #4 CI](https://github.com/ten2ten2/promobento/actions/runs/41407139188) 在提交 `8fd60e9a7b55ce061499cc197fc0369ee7c1059a` 上通过：契约/类型、原生专项测试、固定 Linux 容器中的真实 Chromium、四画幅、15/30 秒导出与隔离检查。**只证明该 SHA 和测试覆盖范围**；不等于 Cloudflare 部署、真实模型、客户权限或收费验收。
- 独立合成样本：15 秒原生渲染 46.4 秒、30 秒 84.8 秒（不含最终处理），不是性能分布或 SLA。不同执行架构下的[旧 G1 矩阵](evidence/2026-10-24-s1-performance/README.md)不能用于判定新引擎达标。
- **最后留证的 staging 还是旧引擎**：源码 `d8ce6903a1b8f65a6683c62f0934986df98bdb4b`、方法 1.19.0、镜像 `sha256:77da1a28945f82e18478e2a2ad9d6c47bba59d3a00793d3198641334d4c27761`（[部署检查](https://github.com/ten2ten2/promobento/actions/runs/41082629756)）。那轮只核对健康/容量/预算，不代表 PR #4 已部署。历史数据库、素材及回执不随重构删除。

## S1 作品与质量

- 覆盖仍为 **1/12 创作输入、2/24 最终片**，负责人未接受自动作品的整体质量；同题改版和人工稿不增加覆盖。MiniMax/Duolingo 的画面、接缝、字幕及声音问题见[导演证据](evidence/2026-10-24-s1-director/README.md)。
- 内存峰值仍为 `unverified`；历史 G1 的截图/指标与负责人批准的暂缓决定见[性能证据](evidence/2026-10-24-s1-performance/README.md)，不能回填为 0 或用 RSS 代替。

## 有效授权与费用

- 原始模型授权上限 **$300**，历史供应商总账尚未确认：`openingMicros:null`、`openingConfirmed:false`。最近留存快照（2026-10-30）为已结 **2,769,757**、15 笔未知预留 **1,052,499**，合计 **3,822,256 usd_micros**；不是供应商正式账单。
- 临时 $5 历史风险预留及最多 $10 新费用占用的放行已于 **2026-10-31（上海时间）过期**。新付费调用须先对账或取得新授权；未知费用不补零、不自动重发。单操作预算不构成额外授权。详见[模型费用证据](evidence/2026-10-23-model-probe/README.md)与[导演回执](evidence/2026-10-24-s1-director/README.md)。

## 下一步

1. 对账并取得有效授权后，按固定源码/镜像 SHA 部署原生 staging，实测素材、取消、物理停止、恢复、费用与高并发。
2. 完成 v3.1 导演缺口，补足 12 输入/24 最终片、声音和正常速度人工审片；负责人发布意愿至少 4/6。
3. 重测性能与隔离，通过 [S1 验收门槛](prd/06-testing-and-release.md)后再进入 S2；客户产品按 [实施顺序](prd/08-codex-execution.md)继续。

历史证据见 [runtime](evidence/2026-10-24-s1-runtime/README.md) 与 [staging](evidence/2026-10-24-s1-staging/README.md)。
