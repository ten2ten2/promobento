# 仓库接手指南

先读 [AGENTS](../AGENTS.md)、[实施状态](implementation-status.md)、[PRD索引](prd/README.md)，以及 [13](prd/13-agent-native-production.md) 的创作方法和 [14](prd/14-production-contracts.md) 的机器/业务协议。

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
mise trust
mise install
mise run install
mise run check:repo
mise run check:contracts
mise run test:contracts
mise run check:ui-reference
mise run check:agent-reference
```

已有克隆先保留本地改动再同步main。mise管理工具和任务，pnpm冻结安装；不手改lockfile或用本地旧Node替换部署兼容版本。具体 [依赖政策](dependency-policy.md) 不变，Workers Builds、workerd、renderer镜像分别验证，不能以本地Node替代Cloudflare验收。

## Codex任务

使用 [v2.2任务入口](v2.2-CODEX_START.md)，按照 [08](prd/08-codex-execution.md) 的M0a/M0b–M4推进。15/30秒、30fps、原平台预设固定；镜头与动画代码自由。Google+邮箱验证码、现有Waffo权益、Cloudflare、网站en/视频混排、原网站主题/视觉均保留。

先实现真实自由创作与音频/QA，再做Cloudflare最小真机准入，不以静态图/JSON/离线参考冒充视频。没有外部账号可继续无生产数据的本地开发，但M0b保持未验证。所有API输入和路由与config/schema同步，不建立第二套release/restore URI或revision表。

文档/契约检查已是可执行工具，不是空成功脚本。未来dev/build/test:auth/test:billing/deploy任务随真实实现加入。框架/模型/供应商版本主动变更时核实兼容性；普通安装复现锁文件。

## 提交与证据

完成修改直接快进remote main，先核对远端HEAD，发生并发先读并整合。运行受影响检查，明确测试环境/失败/未运行事项；不得编造生产成功。更新 [决策](implementation-decisions.md) 和 [进度](implementation-status.md) 的实际变化；常规检查不要求新增过程日记，关键集成和人工/性能验收遵循 [证据规则](evidence/README.md)。
