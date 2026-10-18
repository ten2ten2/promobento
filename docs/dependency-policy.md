# 依赖版本与部署兼容策略

更新日期：2026-10-19，Asia/Shanghai。mise 已确定为本项目的工具版本与任务入口，pnpm 负责包依赖。本文件定义版本选择流程；实际固定版本以 `.mise.toml`、各 package 配置、锁文件和 renderer 镜像记录为准。

## 1 版本选择顺序

按以下顺序选型和升级：**目标平台支持与运行时能力 → 框架和 SDK 的兼容范围 → 范围内最新正式版 → 精确锁定 → 目标环境验证。**

- 新增依赖、初始化应用或主动升级时，查询官方发布记录和兼容要求，优先选择最新正式稳定发布；不把 alpha、beta、RC、canary 或 nightly 当作默认值。
- 明确的平台限制、peer dependency 冲突、SDK 要求或已复现的兼容问题，可以作为采用较旧版本的理由。选择满足这些条件的最新受支持版本，记录来源、受影响范围和重新评估条件。
- 当前环境“恰好安装了某版本”不是选型理由；笼统的“旧版更稳”也不能代替兼容证据。
- Node 的 Current 与 LTS 是不同支持阶段。按目标用途的支持策略选择；本地工具、构建工具和生产容器分别记录，不能用一处成功推断另一处已兼容。
- 日常安装复现已提交的版本。普通文档或业务修改不自动升级全仓依赖；有意升级时再重新查询、验证和更新锁文件。

## 2 本次仓库工具链

本次核查到的正式发布为 mise `2026.10.13`、Node `26.12.0`（Current）、pnpm `12.14.0`。`.mise.toml` 对 mise 声明最低版本，对 Node/pnpm 精确固定；这些是仓库工具的配置，应用的构建与运行兼容状态单独验收。

来源：[mise 发布](https://github.com/jdx/mise/releases/tag/v2026.10.13)、[Node 发布](https://nodejs.org/en/blog/release/v26.12.0)、[pnpm 发布](https://github.com/pnpm/pnpm/releases/tag/v12.14.0)。实际执行结果见 [本次工具链验证](evidence/toolchain-2026-10-19.md)。版本核查日期不意味着未来仍是最新版。

## 3 Cloudflare 必须分别验证的环境

| 环境 | 版本和能力由什么决定 | M0 必须证明什么 |
| --- | --- | --- |
| 本地与 CI 构建工具 | mise 中的 Node/pnpm、框架工具和包锁文件 | 冻结安装、构建、相关检查在明确的 OS/架构上通过 |
| Cloudflare Workers Builds | 构建镜像、安装步骤与构建环境变量 | 实际日志中的版本符合项目配置；从干净检出可以安装、构建和部署 |
| Cloudflare Workers | `workerd`、已固定的 `compatibility_date`、flags 和绑定能力 | SSR、鉴权、存储、队列，以及 Waffo 签名与验签在目标 Worker 中运行 |
| Cloudflare Containers | Dockerfile、镜像架构、镜像内的 Node/Chromium/FFmpeg/字体与 digest | 在实际 Container 完成启动、解码、字体、逐帧截图及编码，并得到合格视频 |
| 用户浏览器 | React、播放器代码、浏览器 API 和支持范围 | 两类用户流程、主题、SSR hydration、播放器和布局在目标浏览器验证 |

### Workers Builds 的版本同步

本次官方构建镜像文档列出的默认值为 Node `24.18.0`、pnpm `10.11.1`。默认值不是支持上限；文档允许用 `NODE_VERSION`、`PNPM_VERSION` 覆盖，Node 也可由根 `.nvmrc` 或 `.node-version` 指定。官方没有把 `.mise.toml` 列为自动识别来源，不能假定提交它就会让平台自动使用相同工具链。[官方构建镜像说明](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)

实施部署流水线时以 mise 为版本来源，明确选定并记录一种安装路径：由平台安装工具时，同步并校验对应构建变量；由 mise 安装时，先引导 mise，再执行 `mise install`、`mise run install` 和真实构建任务，处理平台自动依赖安装的顺序。官方的 `SKIP_DEPENDENCY_INSTALL` 可用于关闭该自动步骤。不能把两种安装路径无序叠加，也不能在平台变量中长期保留另一套未核对的版本。

本次尚未创建 Cloudflare 项目或设置这些变量。M0 验收前，记录真实平台配置、工具版本日志和构建结果；本地通过仍保持为本地证据。

### Workers 的 Node 兼容范围

Wrangler 官方支持 Node Current、Active 和 Maintenance 版本，但部署后的 Worker 运行于 `workerd`。安装 SDK 时满足 Node 的 `engines` 只说明一部分要求，不能代替实际 Worker API 能力。[Wrangler 支持范围](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

在应用配置中固定经过验证的 `compatibility_date`，按该日期适用的官方规则配置 Node compatibility。部分 API 可能只有有限实现或导入占位，必须实际执行 Waffo 使用的签名、验签及相关调用；SDK 文档写 Node 支持并不自动意味着支持 `workerd`。更改兼容日期或 flags 时执行受影响检查。[兼容日期](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)、[Node API 支持](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

### Renderer 容器

容器依赖按目标 Linux 镜像和架构解析并锁定。Cloudflare 当前要求镜像支持 `linux/amd64`；构建机的 Node、浏览器中的 JavaScript 和镜像内 Node 的版本不能互相替代。M0 生成真实镜像后，记录 Node、Chromium、FFmpeg、系统库和字体版本，并固定镜像 digest。[Containers 要求](https://developers.cloudflare.com/containers/get-started/)

## 4 可复现与升级记录

`.mise.toml` 保存工具精确版本；`packageManager`、`engines` 和锁文件与它保持一致。直接依赖在选定后固定解析版本，CI 使用冻结锁文件。容器基础镜像与应用镜像使用可追踪的固定版本和 digest；正式部署不依赖浮动 `latest` 标签。

兼容例外写入 `docs/implementation-decisions.md`，至少包括：期望采用的最新版、实际采用版本、限制来自哪个平台或依赖、来源或复现结果、实际验证环境、解除限制后的升级条件。平台默认版本与已验证的兼容上限要分别记录。

后续 `dev`、`check`、`test`、`build`、`deploy:*` 等命令通过 mise 暴露，随真实实现加入。mise 管工具和任务，pnpm 管依赖，Cloudflare 运行配置仍由对应配置文件、资源和实际部署结果决定。
