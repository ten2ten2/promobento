# 工具链与指引调整验证

日期：2026-10-19，Asia/Shanghai。基线提交：`76d557e4c6084cc5c41ff319fa2078bada1ffb0b`。

本次修改精简 AGENTS.md，确认 mise 为主要入口，采用部署兼容范围内优先最新正式版的依赖政策。版本选择及官方来源见 [依赖策略](../dependency-policy.md)。

## 实际执行结果

环境：Linux x86_64。使用 mise 官方 `v2026.10.13` Linux x64 发布包，下载内容的 SHA-256 与官方 release asset digest 一致：`58abd84793a61d56545d7ed1c752eec5a0e3a784f557d0a58a810d780507bbee`。工具安装使用独立目录，未替换系统工具。

| 命令 | 结果 |
| --- | --- |
| `mise --version` | `2026.10.13 linux-x64 (2026-10-17)` |
| `mise trust .mise.toml` | 通过，信任本次已审阅的项目配置 |
| `mise install` | 成功安装 Node `26.12.0` 与 pnpm `12.14.0` |
| `mise exec -- node --version` | `v26.12.0` |
| `mise exec -- pnpm --version` | `12.14.0` |
| `mise exec -- pnpm install --lockfile-only --ignore-scripts --offline` | 通过，由 pnpm 生成本次升级的锁文件 |
| `mise run install` | 通过，实际执行 `pnpm install --frozen-lockfile` |
| `mise run check:repo` | 通过，实际执行仓库 Node 检查脚本 |

以上命令退出码均为 `0`。升级时的锁文件生成命令不是日常安装步骤；日常使用冻结安装复现已提交版本。

再次执行冻结安装后，锁文件的 SHA-256 保持不变。pnpm 12 生成的两个 YAML document 分别记录包管理器环境和项目依赖，完整保留工具输出；结构与 [pnpm 官方锁文件说明](https://pnpm.io/lockfile) 一致。

仓库检查输出：

```text
Repository check passed.
node: v26.12.0
prdDocuments: 11
localFileLinks: 57
seedJson: 7
messages: 105
contrastPairs: 68
```

`AGENTS.md` 从 68 行精简为 41 行。只读交叉复核确认：README、接手指南与 PRD 08 的命令一致；两类首批用户、六个平台、英语首发、主题能力及既定技术栈保持在 PRD 中；详细计费规则继续以 PRD 05 为准。

## 验证范围

当前应用尚未初始化。本轮不包含真实 Cloudflare Workers Builds、Worker、Container、Waffo 或平台上传验证；这些分别作为 M0–M4 的实际出口保留。旧的 [仓库整理记录](repository-check.md) 记录上一轮工具环境，不作为当前版本的验证证据。
