import type { DigestTree, DigestTreeArticle, DigestTreeSection } from "../api";

export type BriefInboxSelection =
  | { kind: "brief" }
  | { kind: "article"; article: DigestTreeArticle; sectionName?: string; eventTitle?: string };

export type BriefInboxRow = {
  id: string;
  article: DigestTreeArticle;
  sectionName: string;
  eventTitle?: string;
  isHighlight: boolean;
};

function articleRowId(article: DigestTreeArticle): string {
  const url = article.url?.trim();
  if (url) return `u:${url}`;
  return `id:${article.feed_id}:${article.article_id}`;
}

function dedupeArticles(articles: DigestTreeArticle[]): DigestTreeArticle[] {
  const seen = new Set<string>();
  const out: DigestTreeArticle[] = [];
  for (const article of articles) {
    const key = articleRowId(article);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(article);
  }
  return out;
}

function rowsFromSection(section: DigestTreeSection): BriefInboxRow[] {
  const isHighlight = section.kind === "highlight" || section.kind === "important";
  const rows: BriefInboxRow[] = [];
  for (const event of section.events) {
    for (const article of dedupeArticles(event.articles)) {
      rows.push({
        id: articleRowId(article),
        article,
        sectionName: section.name,
        eventTitle: event.title?.trim() || undefined,
        isHighlight,
      });
    }
  }
  return rows;
}

/** Flatten digest tree into Reader-style inbox rows (section order preserved). */
export function flattenDigestInbox(tree: DigestTree): BriefInboxRow[] {
  const sections: DigestTreeSection[] = [];
  if (tree.sections?.length) {
    sections.push(...tree.sections);
  }
  for (const partition of tree.partitions ?? []) {
    sections.push(...partition.sections);
  }
  return sections.flatMap(rowsFromSection);
}

export function domainFromUrl(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function selectionMatchesRow(
  selection: BriefInboxSelection,
  row: BriefInboxRow,
): boolean {
  if (selection.kind !== "article") return false;
  return articleRowId(selection.article) === row.id;
}

export function selectionId(selection: BriefInboxSelection): string {
  return selection.kind === "brief" ? "brief:daily" : articleRowId(selection.article);
}
