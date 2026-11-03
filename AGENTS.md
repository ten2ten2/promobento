# PromoBento 协作说明

接手先读 [README](README.md)、[实施状态](docs/implementation-status.md) 和 [PRD](docs/prd/README.md)。按 [实施顺序](docs/prd/08-codex-execution.md)继续；配置中的目标功能不等于已上线。

## 技术与产品边界

- 完整 huashu-motion HTML/JS 工程是**唯一影片引擎**；借鉴 Hypit 的导演、参考、素材和编辑方法。不引入第二套视频 DSL/渲染引擎；客户产品不得使用花叔本人形象、头像或拟人角色。
- 保持软件及课程两类用户、15/30 秒、30 fps、平台预设、Google/邮箱、Cloudflare 与 Waffo。网站语言/主题不改变成片原文、视频计费或交付内容。购买创作额度与购买并导出是不同业务事务。
- 创作代码只在任务独立、无公网的 Chromium 容器沙箱执行；Worker 不执行作品代码。权限、取消、版本、费用和交付按 PRD 04/05/14 实现；镜像仅通过 GitHub Actions 构建、发布。
- JSON 严格解析、JCS、哈希及预编译 Ajv 统一来自 `packages/contracts`；原生传输使用 `contracts/native-project.schema.json`，不重建影片 DSL。素材许可与来源证据跟随真实资产。
- 无须兼容尚未上市的旧创作协议。可删无调用方代码，但保留真实素材、权利、费用、未知用量、回执和已发布数据；不改写 Git 历史。

## 验证与提交

- 新环境先执行 `bash scripts/agent-setup.sh`；mise 与 pnpm 使用仓库固定版本及锁文件。命令须有实际功能，不能创建空成功脚本。
- 修改代码、配置或文档后检查相关文档是否过时、重复或冲突；能力变化更新[实施状态](docs/implementation-status.md)，重大实测证据按 PRD 06 归档，普通检查结果留在提交或 CI。
- 开发期间只运行必要的最小检查，避免重复或默认跑全套测试/CI；如复用先前结果，明确所适用的 SHA。未运行不写“通过”，离线测试不等于实际浏览器、云端、模型、权限、支付、邮箱或成片验收。缺外部密钥则完成不依赖它们的工作并说明阻塞。
- 默认快进推送 `main`；明确要求 PR 时更新指定分支/PR。提交前核对远端新变更，不强推。发布核对最终 SHA 的必需检查；仅纯文档等无需 CI 时可用 `[skip ci]`。
