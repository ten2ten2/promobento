# 共享契约与原生工程身份

业务结构协议保持 **3.0.0**；新渲染入口使用独立 **NativeProject 1.0.0**，其 JSON 只描述文件、固定环境与画幅。动画和声音的创作源是 `index.html` 与本地工程文件，不再生成 FilmSpec、积木参数或 `PB.scene`。

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

## 历史与业务契约

`production.schema.json` 和通用身份／交易参考校验继续读取历史记录；客户冻结、购买和交付服务仍未实现。旧 `composition` 不能用于新创作写入，旧 film-v1 构建返回 `LEGACY_RENDERER_REQUIRED`，不把旧源码当作新原生项目。既有不可变回执、费用、数据库历史与发布环境不随源代码删除。

旧 FilmSpec、页面 bridge、分片任务、接缝验证和自写场景执行入口已退役，其原始版本可从 Git 历史取得。PNG 像素工具与视频帧包仍供素材处理使用，不属于分片协议。

## 本地检查

`test:native` 检查真实共享校验、原生文件边界、离线导演／改稿、恢复与模型账本；`check:contracts` 检查仍保留的业务参考契约。真正的 Chromium／FFmpeg 验证由原生镜像执行，代码或 Schema 通过不能代替实际视频、云端隔离、客户权限或支付验收。
