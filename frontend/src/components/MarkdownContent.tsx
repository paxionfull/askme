import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import CodeViewer from "./CodeViewer";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export default function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
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
    }),
    [],
  );

  if (!content) return null;

  return (
    <div className={`markdown-body text-sm leading-7 text-slate-800 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
