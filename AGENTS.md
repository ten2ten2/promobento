# PromoBento 协作说明

接手先读 [README](README.md)、[当前实施状态](docs/implementation-status.md) 和 [PRD 索引](docs/prd/README.md)。现行 **PRD v3.1 / 协议 3.0.0**；按 [08 实施顺序](docs/prd/08-codex-execution.md)从真实未完成阶段继续，不能把目标配置当成已上线能力。

## 技术与产品边界

- 完整 huashu-motion 原生 HTML/JS 工程是**唯一影片引擎**。Hypit 提供 Brief/Treatment、参考视频、语义时间、素材选择和编辑方法；不引入另一套 DSL、播放器或渲染 runtime。不要把花叔本人形象、头像或拟人角色用于客户产品。
- 保持软件及课程两类用户、15/30 秒、30 fps、平台预设、Google/邮箱、Cloudflare 与 Waffo。网站语言/主题不改变成片原文、视频计费或交付内容。购买创作额度与购买并导出是不同业务事务。
- 创作代码只在每任务独立、无公网的容器 Chromium 沙箱运行；Worker 不求值客户代码。broker、权限、取消、不可变版本、预算、付款、交付和验收按 PRD 04/05/14 的可信服务边界实现。镜像只通过 GitHub Actions 构建、发布。
- JSON 严格解析、JCS、哈希及预编译 Ajv 统一来自 `packages/contracts`；原生传输使用 `contracts/native-project.schema.json`，不重建 FilmSpec/场景语言。素材许可与来源证据必须跟随真实资产；上游版权不是本次引擎选型门槛。
- 不兼容尚未上市的旧 PromoBento 创作协议、旧方法版本或 Studio 执行入口。可删除无调用方代码；**真实素材、费用、未知用量、回执和已发布数据不能当作旧代码删除**。不要改写 Git 历史。

## 验证与提交

- 新环境先执行 `bash scripts/agent-setup.sh`；mise 与 pnpm 使用仓库固定版本及锁文件。命令须有实际功能，不能创建空成功脚本。
- 修改代码、配置或规则时同步检查所有相关非 PRD 文档与引用；能力变化更新[实施状态](docs/implementation-status.md)，长期证据按 PRD 06 归档，普通检查结果写在提交或 CI。
- 开发期间只运行必要的最小检查，避免重复或默认跑全套测试/CI；如复用先前结果，明确所适用的 SHA。未运行不写“通过”，离线测试不等于实际浏览器、云端、模型、权限、支付、邮箱或成片验收。缺外部密钥则完成不依赖它们的工作并说明阻塞。
- 除非另有要求，完成后直接**快进推送 remote `main`**。推送前确认远端提交；有新提交先整合核对，不强推。生产发布须核对最终 SHA 的必需检查；只有纯文档等无需 CI 的提交才可用 `[skip ci]`。Mac 大文件迁移推送可用 `git -c pack.useSparse=false push origin main`。
