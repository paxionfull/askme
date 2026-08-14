import {
  Children,
  cloneElement,
  isValidElement,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeViewer from "./CodeViewer";

export interface ArticleRef {
  feed_id: string;
  article_id: string;
  title: string;
  url: string;
}

export const ARTICLE_DRAG_MIME = "application/x-askme-article";
export const ARTICLE_GROUP_DRAG_MIME = "application/x-askme-article-group";
export const ARTICLE_DRAG_PREFIX = "askme-article:";
export const ARTICLE_GROUP_DRAG_PREFIX = "askme-article-group:";

export interface ArticleGroupDrag {
  label: string;
  articles: ArticleRef[];
}

export function writeArticleDragData(dataTransfer: DataTransfer, articleRef: ArticleRef) {
  const payload = JSON.stringify(articleRef);
  dataTransfer.setData(ARTICLE_DRAG_MIME, payload);
  dataTransfer.setData("text/plain", `${ARTICLE_DRAG_PREFIX}${payload}`);
  dataTransfer.effectAllowed = "copy";
}

export function writeArticleGroupDragData(dataTransfer: DataTransfer, group: ArticleGroupDrag) {
  const payload = JSON.stringify(group);
  dataTransfer.setData(ARTICLE_GROUP_DRAG_MIME, payload);
  dataTransfer.setData("text/plain", `${ARTICLE_GROUP_DRAG_PREFIX}${payload}`);
  dataTransfer.effectAllowed = "copy";
}

export function readArticleGroupDragData(dataTransfer: DataTransfer): ArticleGroupDrag | null {
  let raw = dataTransfer.getData(ARTICLE_GROUP_DRAG_MIME);
  if (!raw) {
    const plain = dataTransfer.getData("text/plain");
    if (plain.startsWith(ARTICLE_GROUP_DRAG_PREFIX)) {
      raw = plain.slice(ARTICLE_GROUP_DRAG_PREFIX.length);
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ArticleGroupDrag;
    const articles = (parsed.articles ?? []).filter(
      (item) => item?.feed_id && item?.article_id,
    ) as ArticleRef[];
    if (articles.length === 0) return null;
    return {
      label: String(parsed.label ?? "").trim() || "事件组",
      articles,
    };
  } catch {
    return null;
  }
}

export function readArticleDragPayload(
  dataTransfer: DataTransfer,
): { single?: ArticleRef; group?: ArticleGroupDrag } {
  const group = readArticleGroupDragData(dataTransfer);
  if (group) return { group };
  const single = readArticleDragData(dataTransfer);
  if (single) return { single };
  return {};
}

export function readArticleDragData(dataTransfer: DataTransfer): ArticleRef | null {
  let raw = dataTransfer.getData(ARTICLE_DRAG_MIME);
  if (!raw) {
    const plain = dataTransfer.getData("text/plain");
    if (plain.startsWith(ARTICLE_GROUP_DRAG_PREFIX)) {
      return null;
    }
    if (plain.startsWith(ARTICLE_DRAG_PREFIX)) {
      raw = plain.slice(ARTICLE_DRAG_PREFIX.length);
    }
  }
  if (!raw) return null;
  try {
    const article = JSON.parse(raw) as ArticleRef;
    if (!article.feed_id || !article.article_id) return null;
    return article;
  } catch {
    return null;
  }
}

export function acceptsArticleDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return (
    types.includes(ARTICLE_DRAG_MIME) ||
    types.includes(ARTICLE_GROUP_DRAG_MIME) ||
    types.includes("text/plain")
  );
}

function normalizeGroupLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();
}

interface AggregateGroup {
  label: string;
  links: Array<{ title: string; href: string }>;
}

function extractAggregateGroupsFromMarkdown(content: string): AggregateGroup[] {
  const groups: AggregateGroup[] = [];
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const headerMatch = /^(\s*)- \*\*(.+?)\*\*\s*$/.exec(lines[i]);
    if (headerMatch) {
      const indent = headerMatch[1].length;
      const label = headerMatch[2].trim();
      const links: Array<{ title: string; href: string }> = [];
      i += 1;
      while (i < lines.length) {
        const nestedMatch = /^(\s*)- \[([^\]]+)\]\(([^)]+)\)\s*$/.exec(lines[i]);
        if (!nestedMatch || nestedMatch[1].length <= indent) {
          break;
        }
        links.push({ title: nestedMatch[2].trim(), href: nestedMatch[3].trim() });
        i += 1;
      }
      if (links.length > 0) {
        groups.push({ label, links });
      }
      continue;
    }
    i += 1;
  }
  return groups;
}

interface SectionBlock {
  key: string;
  label: string;
  level: 2 | 3;
  links: Array<{ title: string; href: string }>;
}

function collectLinksFromLines(
  lines: string[],
  startIndex: number,
  indent: number,
): { links: Array<{ title: string; href: string }>; nextIndex: number } {
  const links: Array<{ title: string; href: string }> = [];
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const h2Match = /^## (.+?)\s*$/.exec(line);
    const h3Match = /^### (.+?)\s*$/.exec(line);
    if (h2Match || h3Match) {
      break;
    }
    const aggMatch = /^(\s*)- \*\*(.+?)\*\*\s*$/.exec(line);
    if (aggMatch) {
      const aggIndent = aggMatch[1].length;
      if (aggIndent < indent) break;
      i += 1;
      while (i < lines.length) {
        if (lines[i].trim() === "") {
          i += 1;
          continue;
        }
        const nested = /^(\s*)- \[([^\]]+)\]\(([^)]+)\)\s*$/.exec(lines[i]);
        if (!nested || nested[1].length <= aggIndent) break;
        links.push({ title: nested[2].trim(), href: nested[3].trim() });
        i += 1;
      }
      continue;
    }
    const linkMatch = /^(\s*)- \[([^\]]+)\]\(([^)]+)\)\s*$/.exec(line);
    if (!linkMatch || linkMatch[1].length < indent) break;
    links.push({ title: linkMatch[2].trim(), href: linkMatch[3].trim() });
    i += 1;
  }
  return { links, nextIndex: i };
}

function sectionKey(parentH2: string, label: string): string {
  return normalizeGroupLabel(parentH2 ? `${parentH2} / ${label}` : label);
}

function extractSectionsFromMarkdown(content: string): SectionBlock[] {
  const sections: SectionBlock[] = [];
  const lines = content.split("\n");
  let currentH2 = "";
  let currentH2Block: SectionBlock | null = null;
  let currentH3Block: SectionBlock | null = null;
  let i = 0;

  const flushH3 = () => {
    if (!currentH3Block || currentH3Block.links.length === 0) {
      currentH3Block = null;
      return;
    }
    sections.push(currentH3Block);
    if (currentH2Block) {
      const seen = new Set(
        currentH2Block.links.map((link) => `${link.title}::${link.href}`),
      );
      for (const link of currentH3Block.links) {
        const dedupeKey = `${link.title}::${link.href}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        currentH2Block.links.push(link);
      }
    }
    currentH3Block = null;
  };

  const flushH2 = () => {
    flushH3();
    if (!currentH2Block || currentH2Block.links.length === 0) {
      currentH2Block = null;
      return;
    }
    sections.push(currentH2Block);
    currentH2Block = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const h2Match = /^## (.+?)\s*$/.exec(line);
    const h3Match = /^### (.+?)\s*$/.exec(line);
    if (h2Match) {
      flushH2();
      currentH2 = h2Match[1].trim();
      currentH2Block = {
        key: sectionKey("", currentH2),
        label: currentH2,
        level: 2,
        links: [],
      };
      i += 1;
      continue;
    }
    if (h3Match) {
      flushH3();
      const label = h3Match[1].trim();
      currentH3Block = {
        key: sectionKey(currentH2, label),
        label,
        level: 3,
        links: [],
      };
      i += 1;
      const collected = collectLinksFromLines(lines, i, 0);
      currentH3Block.links = collected.links;
      i = collected.nextIndex;
      continue;
    }
    if (currentH3Block) {
      const collected = collectLinksFromLines(lines, i, 0);
      if (collected.links.length > 0) {
        currentH3Block.links.push(...collected.links);
        i = collected.nextIndex;
        continue;
      }
    } else if (currentH2Block) {
      const collected = collectLinksFromLines(lines, i, 0);
      if (collected.links.length > 0) {
        currentH2Block.links.push(...collected.links);
        i = collected.nextIndex;
        continue;
      }
    }
    i += 1;
  }

  flushH2();
  return sections;
}

function resolveLinksToRefs(
  links: Array<{ title: string; href: string }>,
  resolveRef: (href?: string, children?: ReactNode) => ArticleRef | null,
): ArticleRef[] {
  const seen = new Set<string>();
  const refs: ArticleRef[] = [];
  for (const link of links) {
    const ref = resolveRef(link.href, link.title);
    if (!ref) continue;
    const key = `${ref.feed_id}:${ref.article_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

function buildSectionRefLookup(
  content: string,
  resolveRef: (href?: string, children?: ReactNode) => ArticleRef | null,
): Map<string, ArticleRef[]> {
  const map = new Map<string, ArticleRef[]>();
  for (const section of extractSectionsFromMarkdown(content)) {
    const refs = resolveLinksToRefs(section.links, resolveRef);
    if (refs.length > 0) {
      map.set(section.key, refs);
    }
  }
  return map;
}

function buildGroupRefLookup(
  content: string,
  resolveRef: (href?: string, children?: ReactNode) => ArticleRef | null,
): Map<string, ArticleRef[]> {
  const map = new Map<string, ArticleRef[]>();
  for (const group of extractAggregateGroupsFromMarkdown(content)) {
    const refs = resolveLinksToRefs(group.links, resolveRef);
    if (refs.length > 0) {
      map.set(normalizeGroupLabel(group.label), refs);
    }
  }
  return map;
}

function isHtmlTag(child: ReactElement, tag: string): boolean {
  return child.type === tag;
}

function walkReactElements(
  node: ReactNode,
  visitor: (element: ReactElement) => boolean,
): boolean {
  let found = false;
  Children.forEach(node, (child) => {
    if (found) return;
    if (!isValidElement(child)) return;
    if (visitor(child)) {
      found = true;
      return;
    }
    const element = child as ReactElement<{ children?: ReactNode }>;
    if (element.props?.children && walkReactElements(element.props.children, visitor)) {
      found = true;
    }
  });
  return found;
}

function findStrongText(children: ReactNode): string | null {
  let text: string | null = null;
  walkReactElements(children, (child) => {
    if (!isHtmlTag(child, "strong")) return false;
    const strong = child as ReactElement<{ children?: ReactNode }>;
    text = extractLinkText(strong.props.children);
    return true;
  });
  return text;
}

function hasNestedList(children: ReactNode): boolean {
  return walkReactElements(children, (child) => isHtmlTag(child, "ul"));
}

function replaceStrongWithDraggable(
  children: ReactNode,
  label: string,
  articles: ArticleRef[],
  onAddArticles?: (articles: ArticleRef[]) => void,
): ReactNode {
  return Children.map(children, (child, index) => {
    if (!isValidElement(child)) return child;
    if (isHtmlTag(child, "strong")) {
      return (
        <DraggableAggregateHeading
          key={`agg-strong-${index}`}
          label={label}
          articles={articles}
          onAddArticles={onAddArticles}
        />
      );
    }
    const element = child as ReactElement<{ children?: ReactNode }>;
    if (!element.props?.children) return child;
    return cloneElement(
      element,
      { key: element.key ?? `agg-wrap-${index}` },
      replaceStrongWithDraggable(element.props.children, label, articles, onAddArticles),
    );
  });
}

function extractLinkText(children?: ReactNode): string {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children).trim();
  }
  if (Array.isArray(children)) {
    return children.map(extractLinkText).join("").trim();
  }
  if (typeof children === "object" && "props" in children) {
    const node = children as { props?: { children?: ReactNode } };
    return extractLinkText(node.props?.children);
  }
  return String(children).trim();
}

interface SummaryMarkdownProps {
  content: string;
  articleRefs?: ArticleRef[];
  className?: string;
  onAddArticle?: (article: ArticleRef) => void;
  onAddArticles?: (articles: ArticleRef[]) => void;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = path;
    const host = parsed.hostname.replace(/^www\./, "");
    return `${parsed.protocol}//${host}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function buildRefLookup(refs: ArticleRef[]) {
  const byUrl = new Map<string, ArticleRef>();
  const byTitle = new Map<string, ArticleRef>();
  for (const ref of refs) {
    if (ref.url) {
      byUrl.set(normalizeUrl(ref.url), ref);
    }
    if (ref.title) {
      byTitle.set(ref.title.trim(), ref);
    }
  }
  return (href?: string, children?: ReactNode): ArticleRef | null => {
    if (href) {
      const match = byUrl.get(normalizeUrl(href));
      if (match) return match;
    }
    const title = extractLinkText(children);
    if (title) {
      return byTitle.get(title) ?? null;
    }
    return null;
  };
}

function AddToChatButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="ml-1.5 inline-flex shrink-0 items-center rounded border border-[color-mix(in_srgb,var(--accent)_30%,var(--rule))] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--accent-soft)_80%,white)] group-hover/item:opacity-100"
    >
      加入对话
    </button>
  );
}

function DraggableAggregateHeading({
  label,
  articles,
  onAddArticles,
}: {
  label: string;
  articles: ArticleRef[];
  onAddArticles?: (articles: ArticleRef[]) => void;
}) {
  return (
    <span className="group/item inline-flex max-w-full items-center gap-0.5">
      <strong
        draggable
        title={`拖动到右侧对话区，一次性添加 ${articles.length} 篇文章`}
        className="cursor-grab rounded px-0.5 text-[var(--ink)] hover:bg-[var(--accent-soft)] active:cursor-grabbing"
        onDragStart={(event) => {
          writeArticleGroupDragData(event.dataTransfer, { label, articles });
        }}
      >
        {label}
      </strong>
      {onAddArticles ? (
        <AddToChatButton
          label={`将 ${articles.length} 篇文章加入对话`}
          onClick={() => onAddArticles(articles)}
        />
      ) : null}
    </span>
  );
}

function DraggableSectionHeading({
  level,
  label,
  articles,
  onAddArticles,
}: {
  level: 2 | 3;
  label: string;
  articles: ArticleRef[];
  onAddArticles?: (articles: ArticleRef[]) => void;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  const baseClass =
    level === 2
      ? "markdown-body mt-6 mb-3 text-lg font-semibold text-[var(--ink)]"
      : "markdown-body mt-5 mb-2 text-base font-semibold text-[var(--ink)]";
  return (
    <Tag className={`${baseClass} group/item flex max-w-full flex-wrap items-center gap-1`}>
      <span
        draggable
        title={`拖动到右侧对话区，一次性添加「${label}」下 ${articles.length} 篇文章`}
        className="cursor-grab rounded px-0.5 hover:bg-[var(--accent-soft)] active:cursor-grabbing"
        onDragStart={(event) => {
          writeArticleGroupDragData(event.dataTransfer, { label, articles });
        }}
      >
        {label}
      </span>
      {onAddArticles ? (
        <AddToChatButton
          label={`将「${label}」下 ${articles.length} 篇文章加入对话`}
          onClick={() => onAddArticles(articles)}
        />
      ) : null}
    </Tag>
  );
}

function DraggableArticleLink({
  href,
  children,
  articleRef,
}: {
  href?: string;
  children?: ReactNode;
  articleRef: ArticleRef | null;
  onAddArticle?: (article: ArticleRef) => void;
}) {
  if (!articleRef) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent)] no-underline hover:text-[var(--ink)]">
        {children}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      draggable
      title="按住拖动到右侧对话区，可添加文章并生成摘要或限定提问"
      className="cursor-grab rounded px-0.5 text-[var(--accent)] no-underline hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] active:cursor-grabbing"
      onDragStart={(event) => {
        writeArticleDragData(event.dataTransfer, articleRef);
      }}
    >
      {children}
    </a>
  );
}

export default function SummaryMarkdown({
  content,
  articleRefs = [],
  className = "",
  onAddArticles,
}: SummaryMarkdownProps) {
  const resolveRef = useMemo(() => buildRefLookup(articleRefs), [articleRefs]);
  const groupByLabel = useMemo(
    () => buildGroupRefLookup(content, resolveRef),
    [content, resolveRef],
  );
  const sectionByKey = useMemo(
    () => buildSectionRefLookup(content, resolveRef),
    [content, resolveRef],
  );
  const headingContextRef = useRef({ h2: "" });

  const components = useMemo(
    () => ({
      table: ({ children }: { children?: ReactNode }) => (
        <div className="markdown-table-wrap my-3 overflow-x-auto">
          <table>{children}</table>
        </div>
      ),
      th: ({ children, style, ...props }: { children?: ReactNode; style?: React.CSSProperties }) => (
        <th {...props} style={{ ...style, textAlign: "left" }}>
          {children}
        </th>
      ),
      td: ({ children, style, ...props }: { children?: ReactNode; style?: React.CSSProperties }) => (
        <td {...props} style={{ ...style, textAlign: "left", verticalAlign: "top" }}>
          {children}
        </td>
      ),
      pre: ({ children }: { children?: ReactNode }) => <div className="my-3">{children}</div>,
      code: ({
        className: codeClassName,
        children,
        ...props
      }: {
        className?: string;
        children?: ReactNode;
      }) => {
        const code = String(children).replace(/\n$/, "");
        const match = /language-(\w+)/.exec(codeClassName || "");
        if (match || code.includes("\n")) {
          return <CodeViewer code={code} language={match?.[1]} className="my-0" />;
        }
        return (
          <code className={codeClassName} {...props}>
            {children}
          </code>
        );
      },
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <DraggableArticleLink
          href={href}
          articleRef={resolveRef(href, children)}
        >
          {children}
        </DraggableArticleLink>
      ),      h2: ({ children }: { children?: ReactNode }) => {
        const label = extractLinkText(children);
        headingContextRef.current.h2 = label;
        const articles = sectionByKey.get(sectionKey("", label));
        if (!articles?.length || !label) {
          return <h2>{children}</h2>;
        }
        return (
          <DraggableSectionHeading
            level={2}
            label={label}
            articles={articles}
            onAddArticles={onAddArticles}
          />
        );
      },
      h3: ({ children }: { children?: ReactNode }) => {
        const label = extractLinkText(children);
        const articles = sectionByKey.get(
          sectionKey(headingContextRef.current.h2, label),
        );
        if (!articles?.length || !label) {
          return <h3>{children}</h3>;
        }
        return (
          <DraggableSectionHeading
            level={3}
            label={label}
            articles={articles}
            onAddArticles={onAddArticles}
          />
        );
      },
      li: ({ children, ...props }: { children?: ReactNode }) => {
        const label = findStrongText(children);
        const articles =
          label && hasNestedList(children)
            ? groupByLabel.get(normalizeGroupLabel(label))
            : undefined;
        if (!articles?.length || !label) {
          return <li {...props}>{children}</li>;
        }
        return (
          <li {...props}>
            {replaceStrongWithDraggable(children, label, articles, onAddArticles)}
          </li>
        );
      },
    }),
    [groupByLabel, onAddArticles, resolveRef, sectionByKey],
  );

  if (!content) return null;

  headingContextRef.current.h2 = "";

  return (
    <div className={`markdown-body text-sm leading-7 text-[var(--ink)] ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
