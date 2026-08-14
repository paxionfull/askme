import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import CodeViewer from "./CodeViewer";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export default function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  if (!content) return null;

  return (
    <div className={`markdown-body text-sm leading-7 text-slate-800 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="markdown-table-wrap my-3 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          th: ({ children, style, ...props }) => (
            <th {...props} style={{ ...style, textAlign: "left" }}>
              {children}
            </th>
          ),
          td: ({ children, style, ...props }) => (
            <td {...props} style={{ ...style, textAlign: "left", verticalAlign: "top" }}>
              {children}
            </td>
          ),
          pre: ({ children }) => <div className="my-3">{children as ReactNode}</div>,
          code: ({ className, children, ...props }) => {
            const code = String(children).replace(/\n$/, "");
            const match = /language-(\w+)/.exec(className || "");
            if (match || code.includes("\n")) {
              return <CodeViewer code={code} language={match?.[1]} className="my-0" />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
