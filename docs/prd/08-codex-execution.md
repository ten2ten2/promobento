# 实施顺序与交付

先读 [AGENTS](../../AGENTS.md)、[PRD 索引](README.md)、01/03/05/10/12/13/14。目标是可运营产品，文档、参考页面和返回成功的空脚本不能替代实现。本章是里程碑与开发顺序的唯一来源。

## 1 里程碑

| 阶段 | 实施内容 | 退出条件 |
| --- | --- | --- |
| M0a 本地自由创作 | 核对上游来源，Director/Treatment、新镜头源码、真实关键帧、ABC/SFX、MP4/QA | 15/30 秒、两类素材、原创镜头、正常速度视听和实际成本/失败证据 |
| M0b Cloudflare 准入 | 同源包在目标实例验证构建/workerd、字体/seek/WebGL/FFmpeg/回收隔离；并行最小 Google/邮箱/Waffo test | 真实平台结果；无账户保持 NOT_TESTED，本地通过不能替代 |
| M1 Studio 与用户流程 | 上传事实、创意、隔离预览、点选/截图兜底、候选 patch、CAS/恢复、声音、合法目标、移动 UI | 两类用户能自助修改与恢复；混排、网站主题和实际音轨可用 |
| M2 可靠交付 | 完整 Schema/权限、D1 唯一性、运行/预算/队列、全目标冻结、Waffo 权益与延迟编码 | 编码、消费、补目标、退款、删除和版本化运行恢复实测 |
| M3 团队与运营 | 邀请、审阅、冲突、清理、成本/归因/质量面板与用途页 | 权限隔离、真实完整任务和可解释费用漏斗 |
| M4 生产上线 | 性能、安全、平台上传、收款退款、域名发信与回滚 | 06/12 外部门槛有真实结果，不虚构通过 |

M0a 也必须使用隔离测试素材与运行环境；M0b 未通过可继续无生产数据研究，不开放客户任意代码或收款承诺。基础认证、计量和权限必须在相应功能对用户开放前完成，不以表格阶段为理由延后安全。

## 2 代码与权威来源

应用责任划分为 web、api、jobs、agent-runner、renderer。按实际实现建立 packages：contracts、composition-runtime、creative-director、audio-engine、quality-engine、agent-orchestrator、platform-presets、billing、auth、db、ui、i18n、brand；不建空目录凑模块数，不擅自更换云或数据库。

project_revisions 为唯一版本，routes 为 URI 注册来源，agent-api 绑定 Schema，production.schema 定义传输结构，14 定义状态/hash/引用/计量，12 定义认证例外。候选与示例是正常工程输入，不代表运行成功；生产边界拒绝 exampleOnly。购买 snapshot、内容 identity 和首次交付集合不能混为一谈。

## 3 工具和当前命令

mise 管工具与任务，pnpm 冻结锁文件；部署支持→依赖兼容→兼容范围内正式版→精确锁定→目标实测。正常安装复现锁文件，不因文档修改升级工具。具体见 [依赖策略](../dependency-policy.md)。

| 命令 | 实际范围 |
| --- | --- |
| `mise run install` | pnpm 冻结安装 |
| `mise run check:repo` | 全部当前文档、引用、配置、路由、认证、主题与契约一致性 |
| `mise run check:contracts` | 正式 Schema 样例、语义/hash/合法目标和 API 清单 |
| `mise run test:contracts` | 协议反例、CAS、计量、状态与内容身份参考测试 |
| `mise run build:agent-reference` | 从当前模板、tokens、预设、配额生成离线 Studio 参考 |
| `mise run check:agent-reference` | 参考同步性、合法目标和样例边界 |

应用 dev/build/test:e2e/test:render/test:billing/test:auth/check:i18n/test:appearance/deploy/smoke 在真实实现时加入，不能用空脚本。Node 备用环境可运行兼容检查，但须报告版本，不能冒充固定 mise/Node/pnpm 验证。静态、实际 D1/浏览器/云、真实模型、邮件、支付和平台上传分别测试。

## 4 环境和交付

可信 appUrl、回调、发信与支持地址来自 brand/routes/auth；不从任意 Host/前端 origin 拼接。D1/R2/Queues/DLQ/DO/AI/EMAIL 以及新增计算类别同样受全局预算；Google/OTP/CSRF/Waffo/服务间和模型密钥只给可信 Worker，沙箱不带凭据。未配置真实模型、价格和预算则关闭执行。

完成报告列变更、真实命令/环境、成功与失败、未实现 P0、样片、费用、恢复及外部账户条件。进度仅在真实状态变化更新；普通检查记录在提交/CI，重要验收按证据规则。交付必须包括真实迁移、锁文件、部署运维、许可、安全与健康/回滚，不以规格完整声称产品可运行。

提交直接快进 remote main，推送前检查 expected head，不强推覆盖他人提交；清理工作树中的失效文档不等于改写 Git 提交历史或删除用户作品/财务版本数据。
