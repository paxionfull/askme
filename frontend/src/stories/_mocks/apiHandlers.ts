import type { FeedSchedulerConfig, LoginSessionStatus, SkillsCatalog } from "../../api";
import {
  SAMPLE_FEEDS,
  SAMPLE_GROUPS,
  SAMPLE_GROUP_ORDER,
  SAMPLE_SCHEDULER_EMPTY,
  SAMPLE_SCHEDULER_POPULATED,
  SAMPLE_SKILL_DETAIL,
} from "../_fixtures/catalog";

export type CatalogSchedulerMode = "empty" | "populated" | "loading";

export type CatalogApiOptions = {
  scheduler?: CatalogSchedulerMode;
};

declare global {
  interface Window {
    __ASKME_STORY_API__?: CatalogApiOptions;
  }
}

let schedulerState: FeedSchedulerConfig = structuredClone(SAMPLE_SCHEDULER_POPULATED);
const loginSessions = new Map<string, LoginSessionStatus>();
let installed = false;
let originalFetch: typeof fetch | null = null;

function options(): CatalogApiOptions {
  return window.__ASKME_STORY_API__ ?? {};
}

export function setCatalogApi(next?: CatalogApiOptions) {
  window.__ASKME_STORY_API__ = next ?? {};
  const mode = next?.scheduler ?? "populated";
  if (mode === "empty") {
    schedulerState = structuredClone(SAMPLE_SCHEDULER_EMPTY);
  } else if (mode === "populated" || mode === "loading") {
    schedulerState = structuredClone(SAMPLE_SCHEDULER_POPULATED);
  }
}

function pathnameOf(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, "http://storybook.local").pathname;
  } catch {
    return raw.split("?")[0] ?? raw;
  }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL) && "method" in input) {
    return (input.method || "GET").toUpperCase();
  }
  return "GET";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function skillsCatalog(): SkillsCatalog {
  return {
    discovery: [
      {
        id: SAMPLE_SKILL_DETAIL.id,
        name: SAMPLE_SKILL_DETAIL.name,
        category: "discovery",
        description: SAMPLE_SKILL_DETAIL.description,
        builtin: true,
      },
    ],
    digest: [
      {
        id: "tech-longform-digest",
        name: "AI_news",
        category: "digest",
        description: "Structured digest rule",
        builtin: true,
        is_default: true,
      },
    ],
    chat: {
      id: "askme-chat",
      name: "Ask",
      category: "chat",
      builtin: true,
    },
    other: [],
    default_digest_skill: "tech-longform-digest",
  };
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const path = pathnameOf(input);
  if (!path.startsWith("/api/")) return null;

  const method = methodOf(input, init);
  const mode = options().scheduler ?? "populated";

  if (path === "/api/feeds" && method === "GET") {
    return json({
      feeds: SAMPLE_FEEDS,
      groups: SAMPLE_GROUPS,
      group_order: SAMPLE_GROUP_ORDER,
      default_digest_skill: "tech-longform-digest",
    });
  }

  if (path === "/api/settings/feed-scheduler") {
    if (mode === "loading") {
      return new Promise(() => {});
    }
    if (method === "GET") {
      return json(schedulerState);
    }
    if (method === "PUT") {
      try {
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as { schedules?: FeedSchedulerConfig["schedules"] })
            : {};
        schedulerState = {
          ...schedulerState,
          schedules: body.schedules ?? schedulerState.schedules,
        };
      } catch {
        // keep prior
      }
      return json(schedulerState);
    }
  }

  if (path === "/api/settings/llm" && method === "GET") {
    return json({
      configured: false,
      persisted: false,
      model: "",
      embedding_model: "",
      api_key: "",
      api_base: "",
      max_tokens: 32768,
      thinking_style: "",
      embedding_api_key: "",
      embedding_api_base: "",
    });
  }

  if (path.startsWith("/api/articles/recent") && method === "GET") {
    return json({
      articles: [],
      context_text: "",
      truncated: false,
      article_count: 0,
      meta_count: 0,
      cached_count: 0,
      fetched_count: 0,
    });
  }

  if (path.startsWith("/api/rag/status") && method === "GET") {
    return json({ ready: false, chunk_count: 0, days: 1 });
  }

  if (path === "/api/skills" && method === "GET") {
    return json(skillsCatalog());
  }

  if (path === "/api/skills/digest" && method === "GET") {
    return json({
      skills: skillsCatalog().digest,
      default_digest_skill: "tech-longform-digest",
    });
  }

  if (path === "/api/settings/credentials" && method === "GET") {
    return json({ credentials: [], slots: [] });
  }

  if (path === "/api/settings/credentials" && method === "PUT") {
    return json({
      ok: true,
      credential: {
        id: "cred-demo",
        label: "Demo",
        slot: "x",
        slot_label: "X / Twitter",
        masked: "a=***",
      },
    });
  }

  if (path === "/api/settings/credentials/login-session" && method === "POST") {
    const id = `session-${Date.now()}`;
    const session: LoginSessionStatus = {
      session_id: id,
      slot: "x",
      login_url: "https://x.com/i/flow/login",
      label: "X / Twitter",
      status: "waiting_login",
      message: "Waiting for login…",
      done: false,
    };
    loginSessions.set(id, session);
    return json(session);
  }

  const sessionMatch = path.match(/^\/api\/settings\/credentials\/login-session\/([^/]+)(?:\/(cancel))?$/);
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1]);
    const cancel = Boolean(sessionMatch[2]);
    const existing = loginSessions.get(id);
    if (!existing) {
      return json({ detail: "session not found" }, 404);
    }
    if (cancel || method === "POST") {
      const cancelled: LoginSessionStatus = {
        ...existing,
        status: "cancelled",
        message: "Cancelled",
        done: true,
      };
      loginSessions.set(id, cancelled);
      return json(cancelled);
    }
    return json(existing);
  }

  if (path.startsWith("/api/sources/onboard/batch/")) {
    return json({ detail: "批量任务不存在或已结束" }, 404);
  }

  if (path === "/api/sources/auth-precheck" && method === "POST") {
    return json({ items: [], all_ready: true });
  }

  // Soft catch-all so providers don't throw mid-story
  return json({});
}

/** Install once for Storybook preview — stubs /api without a backend. */
export function installCatalogApiMock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  setCatalogApi({ scheduler: "populated" });
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const mocked = await handle(input, init);
    if (mocked) return mocked;
    return originalFetch!(input, init);
  };
}
