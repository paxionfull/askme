"""产品 / Agent 用 prompt 真源目录。

角色可配置项仍在 skill（如 chat-rag）；硬规则与任务模板在此。

Catalog（改文案时先查这里）：
- chat.role              → skills/chat/chat-rag/SKILL.md
- chat.rag_rules         → chat_rag_citation_rules.md
- chat.scoped_rules      → chat_scoped_summarize_citation_rules.md
- chat.query             → query_system.md
- digest.classify        → digest_classify.md
- digest.cluster         → digest_cluster.md (+ digest_cluster_focus.md)
- onboard.create         → onboarding_create.md
- onboard.repair         → onboarding_repair.md
"""

from prompts.loader import load_prompt, render_prompt

__all__ = ["load_prompt", "render_prompt"]
