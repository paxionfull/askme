import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

interface CitationMarkdownProps {
  content: string;
  className?: string;
  onCitationClick?: (index: number) => void;
}

const CITATION_PATTERN = /\[(\d{1,2})\]/g;

function renderTextWithCitations(
  text: string,
  onCitationClick?: (index: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(CITATION_PATTERN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const index = Number(match[1]);
    nodes.push(
      <button
        key={`${match.index}-${index}`}
        type="button"
        onClick={() => onCitationClick?.(index)}
        className="ui-chip-btn mx-0.5 bg-[var(--warning-soft)] text-[var(--warning-text)] hover:bg-[color-mix(in_srgb,var(--warning-soft)_70%,var(--warning))]"
      >
        [{index}]
      </button>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function withCitationChildren(
  children: ReactNode,
  onCitationClick?: (index: number) => void,
): ReactNode {
  if (typeof children === "string") {
    return renderTextWithCitations(children, onCitationClick);
  }
  if (Array.isArray(children)) {
    return children.flatMap((child, idx) =>
      typeof child === "string"
        ? renderTextWithCitations(child, onCitationClick).map((node, nodeIdx) => (
            <span key={`${idx}-${nodeIdx}`}>{node}</span>
          ))
        : [child],
    );
  }
  return children;
}

export default function CitationMarkdown({
  content,
  className = "",
  onCitationClick,
}: CitationMarkdownProps) {
  if (!content) return null;

  const blockTags = ["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote"] as const;
  const components: Record<string, React.ComponentType<{ children?: ReactNode }>> = {};
  for (const tag of blockTags) {
    components[tag] = ({ children }) => {
      const Tag = tag;
      return <Tag>{withCitationChildren(children, onCitationClick)}</Tag>;
    };
  }

  return (
    <div className={`markdown-body text-sm leading-7 text-[var(--ink)] ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
