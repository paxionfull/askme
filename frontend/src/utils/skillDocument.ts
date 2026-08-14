export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\n/, "");
}

export function newDigestSkillMd(id: string): string {
  return `---
name: ${id}
description: 自定义摘要 skill
---

# 自定义摘要

你是资讯编辑。用户消息为 XML <文章集合>。

请生成中文 Markdown 摘要，要求：
1. 概括最值得关注的 3–5 条信息
2. 保留关键事实、数字与来源
3. 不臆测文中未提及的内容
4. 控制在 800 字以内
`;
}
