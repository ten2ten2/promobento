# 共享契约与原生工程身份

保留的业务辅助结构使用 **3.0.0**；原生渲染入口使用独立 **NativeProject 1.0.0**，其 JSON 只描述文件、固定环境与画幅。动画和声音的创作源是 `index.html` 与本地工程文件。

## 构建覆盖全部 Schema

```bash
pnpm run build:validators
```

所有 `contracts/*.schema.json` 预编译为 `generated/<name>.mjs` 与类型声明，Workers 导入 `@promobento/contracts/validators/<name>`，不在请求中编译 Ajv。原始 JSON 先用 `parseCanonicalJson` 拒绝重复键和非法 Unicode；`canonical` 实现 JCS，`digest` 用于规范 JSON，`sha256Bytes` 用于原始文件字节。

## 原生工程

[Schema](../../contracts/native-project.schema.json)与[共享断言](src/native-project.mjs)共同验证固定上游 commit、15/30 秒、30 fps、四个固定画幅，以及普通相对路径、文件冲突、单文件和工程体积限制。路径检查不代替实际文件系统的 symlink／realpath 检查，容器仍须重新核对全部输入字节。

`nativeProjectHash` 固定清单字段并按文件路径排序，绑定每个文件的 R2 key、SHA-256、长度及媒体类型。编辑基于显式 `baseRevision` 创建不可变新版本；不同画幅独立生成项目。上游补齐 vendor、字体或声音后，容器保存 `rendered-project.json` 和实际全部文件，分别记录输入身份与实际渲染工程身份。

```js
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {validate} from '@promobento/contracts/validators/native-project';
import {assertNativeProject, nativeProjectHash} from '@promobento/contracts/native-project';
const project = parseCanonicalJson(rawBody);
if (!validate(project)) throw Error('NATIVE_PROJECT_INVALID');
assertNativeProject(project);
const revisionId = await nativeProjectHash(project);
```

## 业务要求与历史边界

客户草稿、购买、冻结和交付服务仍未实现，要求见 [14](../../docs/prd/14-production-contracts.md)。原生链路不再携带旧 Composition、通用身份、Studio、预览及交易的参考 Schema／控制器；后续客户契约应直接围绕原生版本和真实业务事务实现。

历史数据库、不可变回执、费用和已发布环境继续保留；删掉未接入的参考校验不修改这些数据，也不提供旧执行器兼容服务。PNG 像素工具和视频帧包仍供素材处理使用；平台目标枚举由 [targets](src/targets.mjs) 提供，离线单位经济和默认关闭的提示词审核参考工具继续保留。

## 本地检查

`test:native` 检查真实共享校验、原生文件边界、离线导演／改稿、恢复与模型账本；`check:contracts` 使用 [当前配置检查](../../scripts/check-current-config.mjs)核对原生运行时、模型配置／授权及平台规则。真正的 Chromium／FFmpeg 验证由原生镜像执行，代码或 Schema 通过不能代替实际视频、云端隔离、客户权限或支付验收。
