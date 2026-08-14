---
name: zhihu
description: 知乎数据源接入适配器，用于抓取知乎用户主页文章列表与文章正文，需携带有效 Cookie 通过 zse-ck 反爬验证。
---

# Zhihu (知乎) 数据源接入

## 概述
- **Feed ID**: `website:zhihu`
- **Entry URL**: `https://www.zhihu.com/people/Khazix`
- **Base URL**: `https://www.zhihu.com`
- **列表机制**: 从主页 HTML 的初始 State 数据或 `/api/v4/members/{url_token}/articles` 接口获取，分页依赖 `offset` 参数。
- **正文机制**: 请求文章 URL（`/p/{article_id}`）抓取 HTML 页面，从内嵌初始 State 数据或正文 DOM 节点提取完整 `content_html`。

## 必要请求头
请求知乎资源时必须包含以下 Headers：
- `User-Agent`: 标准浏览器 UA。
- `Referer`: 建议设置为知乎主页或对应文章页 URL。
- `Cookie`: 必须注入真实用户 Cookie。

## 站点特性与反爬
- **403 反爬验证**: 未携带有效 Cookie 或触发反爬机制时，HTTP 请求将返回 403 状态码。响应体可能为包含 `<meta id="zh-zse-ck">` 的占位 HTML，或 JSON 格式错误（`code: 40352`），并附带 `redirect` 字段指向 `/account/unhuman?type=...` 安全验证页面。
- **zse-ck 脚本**: 页面包含 zse-ck 反爬脚本，在无浏览器环境执行该脚本将无法通过动态验证，必须依赖有效 Cookie 绕过。
- **时间戳处理**: 列表及正文中返回的时间戳多为 Unix 毫秒格式，需手动转换为 ISO8601 格式（时区设为 `Asia/Shanghai`）。
- **图片资源域名**: 正文内的图片等静态资源使用多域名前缀分发，处理时需兼容 `pica.zhimg.com`, `pic1.zhimg.com`, `pic2.zhimg.com` 等。

## 验证指南
1. **Cookie 有效性检测**: 请求 `https://www.zhihu.com/people/Khazix` 或 `https://www.zhihu.com/api/v4/members/Khazix/articles`，若返回 403 且匹配到 `zse-ck` 或 `/account/unhuman` 重定向，说明 Cookie 失效或未携带。
2. **列表数据验证**: 携带有效 Cookie 请求列表 API 或用户主页，确保能解析出文章条目（`expected_min_items: 1`）。
3. **正文抓取验证**: 抽取列表中的文章 ID，请求 `https://www.zhihu.com/p/{article_id}`，确认能从初始 State 或 DOM 中提取出完整正文 HTML。
