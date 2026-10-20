# 接手指南

先读根 [AGENTS](../AGENTS.md)、[PRD索引](prd/README.md)和[实际进度](implementation-status.md)，按[08](prd/08-codex-execution.md)的真实未完成阶段推进。

```bash
git clone https://github.com/ten2ten2/promobento.git
cd promobento
mise trust
mise install
mise run install
mise run check:repo
mise run check:contracts
mise run test:contracts
mise run check:agent-reference
```

已有工作区先保留未提交改动并同步remote main，不覆盖他人的提交。工具策略见[依赖政策](dependency-policy.md)；固定版本未安装时，能执行的兼容本地检查可先跑，但要明确实际Node版本和缺少的完整工具链验证。

交给Codex的任务：阅读01/03/04/05/08/10/12/13/14；保留15/30秒、固定平台、自由创作、Cloudflare/Waffo/双登录与混排；从M0a真实原创动画、声音和MP4开始，同时准备M0b真实Cloudflare能力/隔离验证。不要把离线Studio、JSON或本地内存参考测试标为生产实现。

普通结果记录在提交或CI；当前状态变化更新实施进度。修改文档、配置、测试与UI引用时同步消费者。经检查的改动直接正常快进推送main；远端前移时读取整合后重试，不使用强制覆盖。
