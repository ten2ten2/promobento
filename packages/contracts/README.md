# 在 Worker 中校验入站契约

先在构建环境运行 `mise run build:validators`，再按 Schema 名导入独立验证器。入站原始 JSON 先经过共同解析器，拒绝重复键、非法 UTF-8 和不合法的 Unicode。

```ts
import { parseCanonicalJson } from '@promobento/contracts/canonical';
import { validate } from '@promobento/contracts/validators/film';

const spec: unknown = parseCanonicalJson(await request.text());
if (!validate(spec)) {
  // 交给调用方映射为该 API 的公开错误，不将完整输入放进错误响应。
  throw new Error('FILM_SCHEMA_INVALID');
}
```

`validate` 返回 boolean，失败详情在 `validate.errors`；不强制转换、不补默认值、不删除未知字段，也不修改输入。结构通过后仍须按 [PRD 14](../../docs/prd/14-production-contracts.md) 从可信上下文检查权限、事实、素材许可、预算和跨字段约束。

## 构建覆盖全部 Schema

入口名为 `film`、`block`、`render-job`、`frame-observation`、`direction`、`audio-plan`、`audio-admission`、`asset-insight`、`director-analysis`、`agent-tools`、`model-config`、`model-spend`、`production`、`unit-economics`。每个入口由 [`build-validators.mjs`](scripts/build-validators.mjs) 生成 ESM 和 `.d.mts`，输出在被 Git 忽略的 `generated/`。新增 Schema 时同步构建清单和[结构用例](test/schema-vectors.json)；测试检查清单是否完整。

另从可信 `blockCatalog` 在构建时生成 `block-params` 验证器，Node 页面与 Worker 共用，不在运行时编译参数 Schema。

这些入口只依赖 Ajv 的运行时辅助函数和格式检查，不加载编译器。`createSchemaValidator` 留给 Node 工具使用；Worker 不导入它或在运行时编译 Schema。实现遵循 [Ajv standalone 的构建期生成方式](https://github.com/ajv-validator/ajv/blob/master/docs/standalone.md)。

## 本地检查

- `mise run check:repo`、`check:contracts` 及离线 Studio 的生成/核对入口会先预编译验证器；干净工作区不依赖之前测试留下的 `generated/`。
- `mise run test`：JCS 固定摘要向量、共享算法和所有 Schema 的正反例；预编译结果与完整 Ajv 对照，并在禁止字符串代码生成的 Node 子进程里运行公开入口。
- `mise run typecheck`：重新构建验证器，检查 Worker 和导入类型，包括非法 JSON 参数和不存在的 Schema 名。

## 新作品使用 film-v1，历史身份保持可重放

`createFilmComposition` 接收规范 `film.json`、冻结的资源/事实清单、依赖清单与固定平台配置，生成 `identityVersion:2`、`capabilityProfile:"film-v1"` 的 Composition。所有业务目标都引用同一 `film.json`；资源路径为 `r/<resourceId>`，不接受任意别名换绑。`filmBuildReceipt` 读取实际规范源字节，`filmBuildErrors` 核对可信构建记录和源包清单；它们不授予素材许可或事实确认。

[新 Composition](../../contracts/film-composition.example.json)、[冻结快照](../../contracts/film-release-snapshot.example.json)、[资源](../../contracts/film-resource-manifest.example.json)和[事实](../../contracts/film-fact-manifest.example.json)由 `tests/contracts/film-fixture.mjs` 构造，只作契约示例。共享参考校验覆盖缺 QA、许可或可信构建记录时拒绝冻结；真实客户冻结/账本服务仍按 M1/M2 实施。

旧 `identityVersion:1` 的入口、`values.json`、内容摘要与既有示例继续可读，不能把旧作品自动改成 v2 再收费。普通修订继承原身份和环境；迁移关联原 release 的免费 correction 或明确映射。新创作使用上述构造器；参考准入的可信 context 设置 `newCreativeWrite:true` 时拒绝旧形状。

v2 视频指纹按画幅、固定布局/编码、源、资源、声音、运行环境和标记共享；平台 mapping 仍含业务 targetId，QA/权益关联仍逐目标授权。帧协议新包络用 `aspectId`；Schema 保留旧 `targetId` 包络读取，两者不能混用，回执必须匹配原包络。渲染器和产品 Worker 的接入进度见[实施状态](../../docs/implementation-status.md)。

内部渲染入口为 `./film-source`（规范 FilmSpec 文件身份）、`./render`（任务/分段语义）及 `./seams`（可信 CDP PNG 解析、受限 RGBA 编码与原像素容差）；产品 Composition 使用 `./film-composition`。私有任务结构也由 `render-job` 预编译验证器覆盖；单个 filmSourceHash 只是产品身份的一部分，不替代完整 Composition/订单身份。

自写镜头另传 `customSources: Record<modulePath, sourceText>` 给 `createFilmComposition`/`filmBuildReceipt` 和对应检查 context。`./custom-source` 仅以 Acorn 解析源码，检查注册、引用和明确禁用项，按词法作用域区分受限全局与同名局部变量，不执行作者代码；真实执行与隔离见[运行时](../film-runtime/README.md)。完整源身份覆盖 `film.json` 与全部声明模块的原始字节，纯积木调用方式和既有身份不变。
