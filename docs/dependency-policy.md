# 依赖与可复现策略

工具和任务由mise管理，包由pnpm管理。当前精确配置在 `.mise.toml` 和 `package.json`，锁文件为 `pnpm-lock.yaml`；文档不声称其中版本是此刻最新发布。

版本选择：目标平台/运行时支持 → 依赖兼容 → 范围内正式发布 → 精确锁定 → 目标环境验证。初始化或主动升级时查官方兼容性，不能用“本机恰好装有”作依据；普通文档/业务修改不自动升级。采用非稳定SDK需说明原因、风险、实际验收与替换条件。

| 环境 | 验证要求 |
| --- | --- |
| 本地/CI | 实际OS/架构、mise及Node/pnpm版本、冻结安装和检查，不把备用Node冒充固定工具链 |
| Workers Builds | 显式同步工具安装路径/变量，干净检出可构建，不假定平台自动读取mise |
| workerd | 固定compatibility_date/flags/bindings；真实SSR、认证、签名与存储/队列，不以Node engines代替运行验证 |
| Composer/Renderer | 实际目标Linux架构、基础/应用镜像digest、Node/Chromium/FFmpeg/字体/系统库；M0b实测复杂片与隔离 |
| 客户浏览器 | 当前支持范围内真实UI、hydration、字体、预览与帧协议；设备差异明确报告 |

直接依赖、基础镜像和执行资源可追溯，不用浮动latest重放已购源包。新增依赖在可信构建流程离线审核、锁版本、检查生命周期脚本和许可证；任意动画代码不获得任意安装或网络权限。媒体/字体/采样重新分发许可单独核实。

依赖升级的当前选型与例外写在对应模块配置/说明，保留来源和可复现限制；真实关键兼容验证按[证据规则](evidence/README.md)记录，不设一份不断堆积的文档迁移日志。部署源于实际服务配置和绑定，不源于历史运行摘要。

官方实施入口：[mise](https://mise.jdx.dev/configuration.html)、[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[compatibility](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Node APIs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[Containers](https://developers.cloudflare.com/containers/get-started/)。实施日核实，不凭链接存在声称当前环境兼容。
