# Discovery skill 参考目录（动态）

接入未知站时：**必须**从下表按 name/description 选出 ≥2 个形态最接近的 skill，
再打开其 `path` 下的 `scripts/discover.py` 与 `source.yaml` 学习结构；
**禁止** `ls` 全目录碰运气，**禁止**照搬 URL/字段。

| name | description | path |
| --- | --- | --- |
| anthropic-3-discovery | Discovers articles from Anthropic Research (anthropic.com/research) via static HTML parsing. Use when fetching updates from anthropic.com/research. | skills/discovery/anthropic-3-discovery/ |
| cato-2-discovery | Discovers articles from Cato Institute (cato.org) via Algolia search (Blog, Commentary, Study, Publications, News Releases) and article HTML. Requires Incapsula session Cookie (auth_slot=cato). Use when fetching updates from www.cato.org site-wide content. | skills/discovery/cato-2-discovery/ |
| cato-discovery | Discovers articles from Cato Institute Cato at Liberty blog (cato.org/blog) via static HTML parsing. Requires Incapsula session Cookie (auth_slot=cato). Use when fetching updates from cato.org blog only. | skills/discovery/cato-discovery/ |
| jiqizhixin-discovery | Discovers articles from 机器之心 (jiqizhixin.com) via the official article library JSON API. Returns title, URL, publish time, author, tags, and summary. Use when fetching updates from jiqizhixin.com or 机器之心 only. | skills/discovery/jiqizhixin-discovery/ |
| openai-discovery | Discovers OpenAI News pages from OpenAI sitemap and fetches article HTML. | skills/discovery/openai-discovery/ |
| qbitai-discovery | Discovers articles from 量子位 (qbitai.com) via WordPress REST API. Use when fetching updates from qbitai.com or 量子位 only. | skills/discovery/qbitai-discovery/ |
| reddit-platform-discovery | Discovers Reddit subreddit posts via arctic-shift / pullpush public archive (optional login Cookie for www.reddit.com JSON). One skill covers all subs; account_key is the subreddit name from feed_registry.platform_accounts. | skills/discovery/reddit-platform-discovery/ |
| x-platform-discovery | Discovers X (Twitter) user original posts only (no replies, retweets, or quote tweets) via logged-in GraphQL (Cookie auth_token+ct0), with FxEmbed / syndication / Nitter fallback. One skill covers all accounts; screen_name from feed_registry.platform_accounts. Use when fetching updates from x.com profiles. Requires X Cookie (auth_slot=x). | skills/discovery/x-platform-discovery/ |
| zhihu-platform-discovery | Discovers Zhihu user/org articles via official API. One skill covers all accounts; params from feed_registry.platform_accounts. Requires Zhihu Cookie (d_c0 + z_c0 login). Use when fetching updates from zhihu.com people/org pages. | skills/discovery/zhihu-platform-discovery/ |
