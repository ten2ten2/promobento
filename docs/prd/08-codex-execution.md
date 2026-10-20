# Codex 实施说明

v2.2 consistency-1。先读AGENTS、PRD索引、01/03/05/10/12/13/14。目标是可运营产品，不是返回成功的脚本或演示页。用户明确要求直接维护remote main时使用快进和预期SHA保护，不覆盖他人新提交。

## 1 里程碑与退出条件

| 阶段 | 实施 | 退出条件 |
| --- | --- | --- |
| M0a 本地创作切片 | 固定上游核对→Director/Treatment→新镜头源码→真实关键帧→ABC/SFX→MP4/QA | 15/30秒和两类素材、非模板运镜、正常速度视听、实际费用/失败证据 |
| M0b 云端最小准入 | 同一源包在Cloudflare构建/workerd/Container；字体/seek/WebGL/FFmpeg/回收隔离；并行最小Google/邮箱/Waffo测试 | 有实际平台证据，缺账户不标通过；本地成功不能替代 |
| M1 Agent Studio | 上传事实、方向、实时隔离预览、点选/坐标兜底、候选patch、CAS/恢复、声音和四构图 | 两类用户自助完成、旧稿不损坏，移动端与UI/混排可用 |
| M2 契约与可靠交付 | 完整Schema/语义/权限、D1唯一性、run/预算/队列、冻结全部target、Waffo权益和延迟编码 | 编码/消费/补平台/退款/删除/旧镜像并发恢复实际通过 |
| M3 团队与运营 | 成员邀请/审阅/冲突、保留清理、费用/来源/质量面板、用途页 | 工作区隔离、真人完整发布、清楚成本和行为漏斗 |
| M4 生产上线 | 性能/安全/真实平台上传/收款退款/域名/发信/回滚 | 06及12外部门槛有真实结果，无虚构成功 |

M0b未通过可继续不含生产用户资料的界面/本地研究，但不开放不可信客户代码或收费承诺。不能等Studio全做完才验证目标环境能力。

## 2 目录与唯一契约

Web/API/jobs/agent-runner/renderer保持独立责任。packages按实际代码建立：contracts、composition-runtime、creative-director、audio-engine、quality-engine、agent-orchestrator、platform-presets、billing、auth、db、ui/i18n/brand。不要建空模块凑数量，也不要引入另一数据库/云厂商解决可在既定栈验证的问题。

`project_revisions`是唯一版本实体。`config/routes.json`为路由唯一来源，`contracts/agent-api.json`绑定协议Schema，`contracts/production.schema.json`定义传输结构；14规定跨资源/状态/hash/账本语义，12保留认证例外。模板旧fixture可放legacy测试，不按旧类型拒绝新源码，也不把示例hash当真实素材。未上线storyboards/rewrites移除，无需发布兼容端点。

保留支付快照与初次批次的区别；不从Agent运行状态推断付款。付费冻结全部合法target源代码，MP4可延迟；补平台不得重新让模型创作。服务端从真实资源推导工作区，永不信任前端角色/金额/宽高/预算/来源。

## 3 mise、依赖与命令

工具版本和任务使用mise，pnpm冻结锁文件。版本选择顺序：部署支持与运行时能力→框架/SDK兼容→范围内正式版→精确锁定→实际平台验证；正常安装不自动升级。当前Node/pnpm pins不因本次文档修订改动；本地备用Node执行的测试须如实标记，不能冒充固定版本复现。

| 当前可运行命令 | 范围 |
| --- | --- |
| `mise run install` | 根据已有锁文件安装仓库依赖 |
| `mise run check:repo` | 文档链接、配置/路由/认证/主题及正式契约一致性 |
| `mise run check:contracts` | v2.2结构/语义/哈希引用/预设配对与API清单 |
| `mise run test:contracts` | 正反例、帧响应、CAS、计量与状态参考测试 |
| `mise run build:ui-reference` / `mise run check:ui-reference` | 原四页离线参考生成/一致性 |
| `mise run check:agent-reference` | 新Agent参考的结构和公开承诺边界 |

应用实现时再添加真实 init/dev/dev:renderer/check/test/test:e2e/test:render/test:billing/test:auth/check:i18n/test:appearance/build/deploy:preview/smoke:preview/deploy:production。不可用返回成功的空脚本充数。模型、真实D1/workerd、浏览器/GPU、Cloudflare、邮件/Waffo、平台上传需独立测试，不能只执行contracts单元测试。

## 4 可信配置与密钥

主站promobento.com，staging.promobento.com；回调沿用brand/routes/auth，不从Host或前端origin拼接。Google callback、Waffo webhook/successUrl、Email Sending发信域、支持邮箱继续12/05已登记值。网站i18n首发en、用户文案自由、System/Light/Dark和tokens仍按10/11。

D1/R2、业务Queues/DLQ、DO、AI、EMAIL与可选Analytics绑定独立；新增Composer/QA等调度同样受全局准入，不能越过4容器总数。Google、OTP/CSRF、Waffo与服务间密钥仅可信Worker持有；沙箱不要带云/模型/支付token。模型配置须有真实provider/model/价格版本/预算与准入结果，缺失时disabled而非猜模型或成本。

## 5 交付报告

列出实际修改、运行命令和环境、成功/失败及未实现P0、样片和关键外部证据、费用、恢复路径、剩余账户资料。只在实现或关键验证状态变化时更新进度；普通检查不新增冗余过程档案。最终交付包括锁文件、真实迁移、部署/运维、安全与许可清单、自动化、生产健康与回滚，而不是只给规格。
