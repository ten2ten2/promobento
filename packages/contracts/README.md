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

入口名为 `film`、`block`、`render-job`、`frame-observation`、`direction`、`audio-plan`、`asset-insight`、`director-analysis`、`agent-tools`、`model-config`、`production`、`unit-economics`。每个入口由 [`build-validators.mjs`](scripts/build-validators.mjs) 生成 ESM 和 `.d.mts`，输出在被 Git 忽略的 `generated/`。新增 Schema 时同步构建清单和[结构用例](test/schema-vectors.json)；测试检查清单是否完整。

另从可信 `blockCatalog` 在构建时生成 `block-params` 验证器，Node 页面与 Worker 共用，不在运行时编译参数 Schema。

这些入口只依赖 Ajv 的运行时辅助函数和格式检查，不加载编译器。`createSchemaValidator` 留给 Node 工具使用；Worker 不导入它或在运行时编译 Schema。实现遵循 [Ajv standalone 的构建期生成方式](https://github.com/ajv-validator/ajv/blob/master/docs/standalone.md)。

## 本地检查

- `mise run test`：JCS 固定摘要向量、共享算法和所有 Schema 的正反例；预编译结果与完整 Ajv 对照，并在禁止字符串代码生成的 Node 子进程里运行公开入口。
- `mise run typecheck`：重新构建验证器，检查 Worker 和导入类型，包括非法 JSON 参数和不存在的 Schema 名。

`production` 当前保留原 Manifest 数据形状；S1 会与 PRD 14、共享身份函数和使用方一起切换到 film-v1。渲染器和产品 Worker 的接入进度见[实施状态](../../docs/implementation-status.md)。

内部渲染的新增入口为 `./film-source`（规范 FilmSpec 文件身份）、`./render`（任务/分段语义）及 `./seams`（可信 CDP PNG 容差）。私有任务结构也由 `render-job` 预编译验证器覆盖；它们不替代产品 Composition/订单身份。
