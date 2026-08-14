import {
  demoAnswerFor,
  demoArticleRefs,
  demoArticles,
  demoCitations,
  demoDigestTree,
  demoFeeds,
  demoGroups,
  demoQuestions,
  demoSkills,
  demoSummary,
} from "./demoFixtures";
import { isDemoMode } from "./demoMode";

const nativeFetch = window.fetch.bind(window);

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function demoJobStatus() {
  return {
    job_id: null,
    status: "idle",
    phase: "idle",
    message: "",
    error: null,
    result: null,
  };
}

function getPath(input: RequestInfo | URL): string {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href).pathname;
}

function readBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") return {};
  try {
    const parsed = JSON.parse(init.body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function streamEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const item of events) {
        await new Promise((resolve) => window.setTimeout(resolve, item.event === "token" ? 18 : 80));
        controller.enqueue(encoder.encode(streamEvent(item.event, item.data)));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

function tokenEvents(content: string) {
  const tokens: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (let index = 0; index < content.length; index += 12) {
    tokens.push({ event: "token", data: { content: content.slice(index, index + 12) } });
  }
  return tokens;
}

function demoStream(path: string, init?: RequestInit): Response {
  if (path === "/api/chat") {
    const body = readBody(init);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastMessage = [...messages].reverse().find((item) => {
      return item && typeof item === "object" && (item as { role?: string }).role === "user";
    }) as { content?: string } | undefined;
    const answer = demoAnswerFor(String(lastMessage?.content ?? demoQuestions[0]));
    return streamResponse([
      { event: "status", data: { phase: "planning_queries", message: "Analyzing your question…" } },
      { event: "status", data: { phase: "retrieving", message: "Retrieving relevant articles…" } },
      { event: "citations", data: { items: demoCitations } },
      { event: "status", data: { phase: "answering", message: "Writing an answer with citations…" } },
      ...tokenEvents(answer),
      { event: "done", data: {} },
    ]);
  }

  if (path === "/api/summarize") {
    return streamResponse([
      { event: "status", data: { phase: "prepare", message: "Preparing the brief…" } },
      { event: "status", data: { phase: "classify", message: "Classifying articles…" } },
      ...tokenEvents(demoSummary),
      { event: "done", data: {} },
    ]);
  }

  if (path === "/api/articles/recent") {
    return streamResponse([
      { event: "status", data: { phase: "loading_articles", message: "Loading sample articles…", article_count: demoArticles.length } },
      { event: "result", data: { articles: demoArticles, context_text: "", truncated: false, article_count: demoArticles.length, meta_count: demoArticles.length, cached_count: demoArticles.length, fetched_count: 0 } },
      { event: "done", data: {} },
    ]);
  }

  return streamResponse([{ event: "done", data: {} }]);
}

export function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isDemoMode()) return nativeFetch(input, init);

  const path = getPath(input);
  if (!path.startsWith("/api/")) return nativeFetch(input, init);

  const body = readBody(init);
  if (path === "/api/chat" || path === "/api/summarize" || (path === "/api/articles/recent" && body.stream === true)) {
    return Promise.resolve(demoStream(path, init));
  }

  if (path === "/api/feeds") {
    return Promise.resolve(jsonResponse({ feeds: demoFeeds, groups: demoGroups, group_order: ["ai-research"], default_digest_skill: "general-digest" }));
  }

  if (path === "/api/articles/recent") {
    return Promise.resolve(jsonResponse({ articles: demoArticles, context_text: "", truncated: false, article_count: demoArticles.length, meta_count: demoArticles.length, cached_count: demoArticles.length, fetched_count: 0 }));
  }

  if (path === "/api/rag/status") {
    return Promise.resolve(jsonResponse({ ready: true, chunk_count: 24, days: 1 }));
  }

  if (path === "/api/digest/summary") {
    return Promise.resolve(jsonResponse({ summary: demoSummary, article_count: demoArticles.length, truncated: false, updated_at: Date.now(), article_refs: demoArticleRefs, digest_tree: demoDigestTree }));
  }

  if (path === "/api/settings/llm") {
    return Promise.resolve(jsonResponse({ configured: true, persisted: true, model: "demo", embedding_model: "", api_key: "", api_base: "", max_tokens: 32768, source: "demo", thinking_style: "", embedding_api_key: "", embedding_api_base: "" }));
  }

  if (path === "/api/settings/feed-scheduler") {
    return Promise.resolve(jsonResponse({ schedules: [], enabled: false, refresh_running: false, next_runs: [], last_run_at: null, last_error: null }));
  }

  if (path === "/api/skills/digest") {
    return Promise.resolve(jsonResponse({ skills: demoSkills, default_digest_skill: "general-digest" }));
  }

  if (path === "/api/skills") {
    return Promise.resolve(jsonResponse({ digest: demoSkills, discovery: [], other: [], chat: demoSkills[0], default_digest_skill: "general-digest" }));
  }

  if (path.includes("/jobs/") || path.endsWith("/jobs/current")) {
    return Promise.resolve(jsonResponse(demoJobStatus()));
  }

  if (path.includes("/settings/cursor-api-key") || path.includes("/settings/zhihu-cookie")) {
    return Promise.resolve(jsonResponse({ configured: false, masked: "" }));
  }

  return Promise.resolve(jsonResponse({ ok: true }));
}
