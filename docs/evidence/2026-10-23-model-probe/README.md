# 2026-10-23 模型能力探针（模幻空间）

实测[云端动效管线改造方案](../../plans/cloud-motion-v3.md)第 6.11 节绑定的模型，经模幻空间（`https://api.modelswitch.org/v1`，OpenAI 兼容接口）实际支持哪些能力。

## 运行

- **代码**：[探针](../../../research/model-probe/probe.mjs)，[CI 工作流](../../../.github/workflows/model-probe.yml)。密钥来自仓库 secret `MODEL_COMPAT_API_KEY`，报告里不含密钥。
- **第一轮**：GitHub Actions [39904369687](https://github.com/ten2ten2/promobento/actions/runs/39904369687)，提交 `fa296fb`，测 4 个模型。报告：[run1.json](run1.json)。
- **第二轮**：[39904908372](https://github.com/ten2ten2/promobento/actions/runs/39904908372)，提交 `805bc4c`。只测 Sonnet 5.5 和 DeepSeek，补测更简单的工具调用（不传 `tool_choice`、简单 Schema）和 `json_object` 模式。报告：[run2.json](run2.json)。
- **测法**：
  - 工具调用：要求模型调用一个给定函数，核对函数名和参数。
  - 看图：一张左红右蓝的 96×96 PNG（data URL），要求按顺序说出两种颜色。
  - JSON Schema：`response_format: json_schema`（`strict`），要求输出一个片子规格。
  - 推理强度：传 `reasoning_effort: "low"`，看是否被接受。
  - 缓存：约 4.5k token 的相同前缀连发两次，读第二次的 `prompt_tokens_details.cached_tokens`。

## 结果

| 能力 | deepseek-v4.1-flash-1017 | gemini-3.8-flash | claude-sonnet-5-5 | claude-opus-5-5 |
| --- | --- | --- | --- | --- |
| 基本调用耗时 | 4.5 s | 51.7 s | 2.3 s | 2.3 s |
| 流式首 token | 2.1 s | 25.0 s | 2.3 s | 2.0 s |
| 流式中返回 usage | 是 | 是 | 是 | 是 |
| 工具调用 | ✅ 两种写法都正确 | ⚠️ 调用了函数但参数为空 `{}` | ❌ 502（两种写法都是） | ❌ 502 |
| 看图 | ✅ | ✅ | ✅ | ✅ |
| `json_schema` 强约束 | ❌ 被忽略，输出 Markdown | ❌ 被忽略 | ❌ 被忽略 | ❌ 被忽略 |
| `json_object` 模式 | ✅ | 未测 | ✅ | 未测 |
| `reasoning_effort` | 接受 | 接受 | 接受 | 接受 |
| 缓存命中字段 | ✅ 4096 / 4336 | ❌ 未返回 | ✅ 6580 / 7235 | ✅ 19885 / 21075 |
| 隐藏提示 token | 无（"pong" 计 27 token） | 无（计 6 token） | **约 6.5k**（"pong" 计 6533 token） | **约 6.8k**（计 6799 token） |

## 结论

- 网关的 Claude 线路**不支持工具调用**，所以 D（自写镜头）、E（整片 review）这类需要工具的步骤不能绑到网关的 Claude 上。
- 网关的 Claude 线路在每次调用前**注入约 6.5–6.8k token 的隐藏提示**，按输入计费（多数会被缓存），内容不明，可能影响模型行为；这也说明网关的 Claude 很可能不是直连官方 API。
- **没有一个模型遵守 `json_schema`**。结构化输出一律用 `json_object` 或提示约束，再在本地按 Schema 校验（方案第 6.1 节的降级路径）。
- **DeepSeek V4.1 Flash 能看图**，工具调用正确，缓存生效，速度快，价格最低。
- **Gemini 3.8 Flash 很慢**（首 token 25 秒、单次 50 秒），工具参数丢失，缓存字段不返回，不适合本管线。
- 每个模型都接受 `reasoning_effort`，但没有验证它是否真的改变了推理强度。

## 未测

真实提示长度下的质量、长输出的稳定性、并发限流、成本对账（需要在平台"使用统计"中核对）。
