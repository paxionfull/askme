import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("python", python);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("plaintext", plaintext);

const EXT_LANG: Record<string, string> = {
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  md: "markdown",
  txt: "plaintext",
};

export function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

interface CodeViewerProps {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
}

export default function CodeViewer({ code, language, filename, className = "" }: CodeViewerProps) {
  const lang = language ?? (filename ? languageFromPath(filename) : "plaintext");

  const highlighted = useMemo(() => {
    if (!code) return "";
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return hljs.highlight(code, { language: "plaintext" }).value;
    }
  }, [code, lang]);

  if (!code) return null;

  return (
    <div className={`code-viewer overflow-hidden rounded-lg border border-[var(--rule)] bg-[var(--paper)] ${className}`}>
      {filename && (
        <div className="border-b border-[var(--rule)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink-muted)]">{filename}</div>
      )}
      <pre className="code-viewer-pre m-0 overflow-x-auto p-4 text-xs leading-5">
        <code className={`hljs language-${lang}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
