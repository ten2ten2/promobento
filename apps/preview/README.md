# Preview Worker

独立预览域的服务边界。当前只连接 Core 的 `PreviewGateway` 命名入口，所有资源均返回 404；能力令牌、manifest 文件授权和播放器随预览阶段实现。

- 只有 `PREVIEW_GATEWAY` 服务绑定，没有数据库、R2、队列、DO 或密钥。
- 仅转发 GET/HEAD，不传递网站 Cookie 或调用者自报身份；响应不设置 Cookie，强制 no-store、CSP sandbox 与 no-referrer。
- 生产与 staging 必须使用与主站不同的独立注册域。域名尚未配置，`workers.dev` 和版本预览 URL 均关闭。

本地多 Worker 测试见 [测试台](../cloud/test/fixtures/multi-worker.mjs)。未来实现须同时覆盖 [PRD 14 的预览授权](../../docs/prd/14-production-contracts.md#5-renderprotocol) 与 [独立域要求](../../docs/prd/04-architecture-and-data.md#元数据与安全)。
