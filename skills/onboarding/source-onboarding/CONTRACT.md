# Discovery skill 契约（强制）

所有 `*-discovery` / `*-platform-discovery` 的 `scripts/discover.py` 必须遵守本契约，才能被 `website_feed` / `feed_client` / `discovery_validate` 复用。

后端 Protocol 对照：`backend/feed/website_feed_adapter.py`。

## 产物文件

| 文件 | 要求 |
|------|------|
| `scripts/discover.py` | 实现下方全部接口；仅标准库 + `skills/discovery/_lib`；**禁止** `import backend` |
| `source.yaml` | 站点元数据；登录墙见下文 |
| `SKILL.md` | frontmatter `name` + `description`（description 收窄到**本站**，勿写成通用 website discovery） |

平台 skill 额外要求见主 skill「平台 skill」一节。

## WebsiteFeedAdapter 接口

| 符号 | 说明 |
|------|------|
| `FEED_ID` | 站级：`website:{slug}`；平台占位另有约定 |
| `FEED_META` | `mpName`、`entryUrl` 等 |
| `REFRESH_DEFAULTS` | 可选刷新默认参数 |
| `fetch_list_page(page, per)` | 拉一页原始 payload |
| `list_items(payload)` | 从 payload 抽出条目 list |
| `has_next_page(payload)` | 是否还有下一页 |
| `normalize_list_item(item)` | 统一元数据（至少含稳定 `id`；尽量含 `url` / `title` / `published_at`） |
| `fetch_article_detail(article_id, **hints)` | 含 `content_html`（或等价正文字段） |
| `normalize_article_body` | 可选；可用 `_lib/content_utils` |

- 不要用 markdown 代码块包裹整个 `discover.py` 文件本身再写入磁盘
- `published_at` 使用 **ISO8601 Asia/Shanghai**

## 列表范围：主帖 / 原文（强制）

微博客、论坛、社交平台时间线类源，**列表只收录作者原创主帖 / 原文**：

- **排除**：reply / comment / 楼中楼；转推（RT / retweet）；引用转发（QT / quote）
- **可保留**：作者自己撰写的原创主帖（非转发、非跟帖）
- **实现**：在 `list_items` / normalize 阶段按平台字段过滤（如 X 的 `in_reply_to_*`、`retweeted_status*`、`is_quote_status`）；不要依赖「带回复时间线」再事后靠标题猜测
- **禁止**：为凑条目数去抓 `/with_replies`、评论 API、conversation 会话、或把 RT/QT 当原创
- 站级长文源（新闻站、博客）通常无此问题；多账号平台 skill 必须遵守

## HTTP（强制）

- 所有对外 HTTP 必须经 `_lib/http_client.py`：`fetch_text` / `fetch_json` / `fetch_bytes` 等
- **禁止** `urllib.request.urlopen` 与自定义 `timeout=`
- 统一超时 5s；失败自动重试；对 429/502/503 退避
- 脚本内分页循环须 `sleep_between_pages()`
- `discovery_validate.py` 会拒绝未走 http_client 的实现

```python
from http_client import fetch_json, fetch_text, sleep_between_pages
```

## 正文 pipeline 与 hints（强制）

```text
fetch_list_page → normalize_list_item
→ fetch_article_detail(article_id, **hints)  # hints 来自列表已入库元数据
→ normalize_article_body（可选）→ html_to_text → cache
```

```python
from detail_hints import pick_hints, resolve_detail_url

def fetch_article_detail(article_id: str, **hints) -> dict:
    meta = pick_hints(**hints)
    url = resolve_detail_url(article_id, **hints) or ...
```

- 签名必须含 `**hints`（或 `**kwargs`）
- **禁止**为查 url/title 再拉整表列表或 sitemap 线性扫描
- **禁止**仅靠首页第一页做 `id -> path` 映射
- 大列表用 `_lib/list_index.ListByIdIndex`（`rebuild` / `clear`+`put`，`get` 读取）
- validate 会对带 `url` 的列表项用 hints 实测详情；**已提供 hints.url 时若仍调用 `fetch_list_page` 会直接失败**

## 登录墙 / Cookie

若必须登录才能拉列表（401/403、跳转登录页、「请先登录」、空列表且明显为登录墙）：

1. `source.yaml`：

```yaml
discovery:
  requires_cookie: true
  auth_slot: <稳定 id；未知站用域名 slug 如 example-com>
  login_url: <能产出 discover 所需 Cookie 的登录/业务页>
  required_token: <必填 Cookie 键，如 session_id=>
  cookie_hint: <完整 Cookie 须含什么；访客/追踪字段不算>
```

2. `from auth_cookie import get_request_cookie(auth_slot)`，slot 与 yaml 一致，放入请求头 `Cookie`
3. 缺 Cookie / 缺必填字段 / 仅访客 Cookie：
   - **不要伪造数据**；**不要**当代码 bug 死循环修改
   - 报错以 `ASKME_AUTH_REQUIRED:slot=<auth_slot>` 开头，写清缺什么
   - 区分：未登录 / 令牌可刷新 / 验证码风控 / 已登录无数据（后两类勿死循环要授权）
4. **禁止** RSS/Atom 绕过登录墙
5. 非 Cookie 鉴权须标明可能无法稳定接入；可跟 Set-Cookie 刷新，仍失败再抛 AUTH_REQUIRED

不适合全自动接入：强设备指纹且无法导出 Cookie、复杂验证码无法粘贴会话、鉴权不在 Cookie。

## 验证

```bash
python skills/discovery/_lib/discovery_validate.py {slug}
```

失败则按报错修 `discover.py` / `source.yaml`（平台 skill 可改对应 `_lib/*_common`），直到通过。
