import type { DigestTree, DigestTreeSection } from "../api";
import type { Locale } from "../i18n/locale";
import { readStoredLocale } from "../i18n/locale";
import { formatMessage } from "../i18n/messages";

export type DigestExportMeta = {
  groupName: string;
  /** 展示用相对范围，如「今天」「近 3 天」 */
  rangeLabel: string;
  /** 天级别日期，如 `2026-08-03` 或 `2026-08-01～2026-08-03` */
  dayRange: string;
  ruleName: string;
};

function sectionArticleCount(section: DigestTreeSection): number {
  return section.events.reduce((sum, event) => sum + event.articles.length, 0);
}

function escapeMdLinkText(text: string): string {
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function articleLine(title: string, url: string, locale: Locale): string {
  const label = escapeMdLinkText(title.trim() || formatMessage(locale, "digestExportNoTitle", {}));
  const href = (url || "").trim() || "#";
  return `- [${label}](${href})`;
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 按「含今天在内的近 N 天」生成天级别日期范围（本地时区） */
export function formatDigestDayRange(days: number): string {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const span = Math.max(1, Math.trunc(days) || 1);
  if (span <= 1) return formatYmd(end);
  const start = new Date(end);
  start.setDate(start.getDate() - (span - 1));
  return `${formatYmd(start)}～${formatYmd(end)}`;
}

function sanitizeFilenamePart(value: string, locale: Locale): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned || formatMessage(locale, "digestExportBrief", {});
}

export function buildDigestExportFilename(
  groupName: string,
  dayRange: string,
  locale?: Locale,
): string {
  const loc = locale ?? readStoredLocale();
  const group = sanitizeFilenamePart(groupName, loc);
  const range = sanitizeFilenamePart(dayRange.replace(/～/g, "_"), loc);
  return `${group}_${range}.md`;
}

function headingLine(meta: DigestExportMeta, locale: Locale): string {
  const group = meta.groupName.trim() || formatMessage(locale, "digestExportBrief", {});
  const dayRange = meta.dayRange.trim();
  if (!dayRange) return `# ${group} · ${meta.rangeLabel}`;
  return `# ${group} · ${meta.rangeLabel}（${dayRange}）`;
}

function ruleLine(meta: DigestExportMeta, locale: Locale): string {
  return formatMessage(locale, "digestExportRuleLine", {
    rule: meta.ruleName.trim() || formatMessage(locale, "digestExportRuleUnbound", {}),
  });
}

/** 从结构化简报树生成 Markdown（对齐原型导出格式） */
export function buildDigestMarkdownFromTree(
  tree: DigestTree,
  meta: DigestExportMeta,
  locale?: Locale,
): string {
  const loc = locale ?? readStoredLocale();
  const lines: string[] = [headingLine(meta, loc), ruleLine(meta, loc), ""];

  const partitions =
    tree.partitions && tree.partitions.length > 0
      ? tree.partitions
      : tree.sections && tree.sections.length > 0
        ? [{ group_id: "", group_name: "", sections: tree.sections }]
        : [];

  for (const partition of partitions) {
    if (partitions.length > 1 && partition.group_name) {
      lines.push(`# ${partition.group_name}`, "");
    }
    for (const section of partition.sections || []) {
      if (sectionArticleCount(section) === 0 && section.kind !== "focus") {
        continue;
      }
      const topic = (section.name || "").trim();
      if (!topic) continue;
      lines.push(`## ${topic}`, "");
      for (const event of section.events || []) {
        const articles = event.articles || [];
        if (articles.length === 0) continue;
        const eventTitle = (event.title || "").trim();
        if (articles.length > 1 && eventTitle) {
          lines.push(`### ${eventTitle}`, "");
        }
        for (const article of articles) {
          lines.push(
            articleLine(article.title || article.article_id, article.url || "", loc),
          );
        }
        lines.push("");
      }
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

/** markdown 回退路径：带元信息头 + 原文 */
export function buildDigestMarkdownFromText(
  summary: string,
  meta: DigestExportMeta,
  locale?: Locale,
): string {
  const loc = locale ?? readStoredLocale();
  const body = summary.trim();
  const lines = [headingLine(meta, loc), ruleLine(meta, loc), "", body, ""];
  return lines.join("\n");
}

export function downloadMarkdownFile(filename: string, content: string) {
  downloadTextFile(filename, content, "text/markdown;charset=utf-8");
}

/** 与导出 Markdown 相同：触发浏览器传统下载 /「另存为」（可选下载、文稿、桌面等根目录）。 */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "application/octet-stream",
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
