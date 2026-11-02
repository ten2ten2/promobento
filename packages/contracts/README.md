# 共享契约与原生工程身份

产品配置/业务协议 **3.0.0** 与内部 **NativeProject 1.0.0** 是独立版本域。NativeProject JSON 只描述文件、环境与画幅；原生 `index.html` 及本地文件才是动画和声音的源码。Worker `/healthz` 的 `nativeProjectSchema` 表示后者，不能当作产品版本。

## 构建覆盖全部 Schema

```bash
pnpm run build:validators
```

所有 `contracts/*.schema.json` 预编译为 `generated/<name>.mjs` 与类型声明，Workers 导入 `@promobento/contracts/validators/<name>`，不在请求中编译 Ajv。原始 JSON 先用 `parseCanonicalJson` 拒绝重复键和非法 Unicode；`canonical` 实现 JCS，`digest` 用于规范 JSON。原始文件和媒体的身份均来自这里的 `sha256Bytes`、`createSha256` 或 `sha256Stream`，流式和文件块校验不各自实现 SHA-256。

第一阶段导演新增三份产品协议 3.0.0 的独立契约：[参考片分析](../../contracts/reference-analysis.schema.json)绑定源 SHA、实际采样帧和可见观察；[权威 Script](../../contracts/native-script.schema.json)定义稳定 copy Segment、语义 Moment 和 authored/measured 时钟；[素材候选](../../contracts/material-selection.schema.json)将 Treatment 每次引用绑定到已授权候选与锁定意图。跨文档关系和已确认事实仍由 [生产文档断言](../methods/production-documents.mjs)核查，不以 Schema 验证替代身份检查。

## 原生工程

[Schema](../../contracts/native-project.schema.json)与[共享断言](src/native-project.mjs)共同验证固定上游 commit、15/30 秒、30 fps、四个固定画幅，以及普通相对路径、文件冲突、单文件和工程体积限制。可选 `timingEvidenceRef`（key、SHA-256、字节数）把逐词时间证据和媒体版本绑定在不可变 revision 中；跨操作改稿继承时仍校验 R2 实际身份。路径检查不代替实际文件系统的 symlink／realpath 检查，容器仍须重新核对全部输入字节。

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

## 使用边界

客户草稿、权限、购买与交付将以不可变 revision 和可信事务为基础，规则见[14](../../docs/prd/14-production-contracts.md)。

PNG 工具和视频帧包只服务内部真实素材采集，不能作为第二套影片播放器；[targets](src/targets.mjs) 仍供平台配置与离线经济分析。数据库迁移、真实素材、费用/用量及原始回执不因源码清理而删除。

## 本地检查

`test:native` 检查真实共享校验、原生文件边界、离线导演／改稿、恢复与模型账本；`check:contracts` 使用 [当前配置检查](../../scripts/check-current-config.mjs)核对原生运行时、模型配置／授权及平台规则。真正的 Chromium／FFmpeg 验证由原生镜像执行，代码或 Schema 通过不能代替实际视频、云端隔离、客户权限或支付验收。
