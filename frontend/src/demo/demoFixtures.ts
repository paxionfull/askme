import type {
  CitationItem,
  DigestTree,
  Feed,
  FeedGroup,
  RecentArticle,
} from "../api";

const DEMO_DATE = "2026-08-12T08:00:00.000Z";

export const demoFeeds: Feed[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    cover: "",
    intro: "Research and product updates from Anthropic.",
    entry_url: "https://www.anthropic.com/news",
    sync_time: Date.parse(DEMO_DATE),
    status: 1,
  },
  {
    id: "openai",
    name: "OpenAI",
    cover: "",
    intro: "OpenAI research and product announcements.",
    entry_url: "https://openai.com/news/",
    sync_time: Date.parse(DEMO_DATE),
    status: 1,
  },
  {
    id: "google-ai",
    name: "Google AI",
    cover: "",
    intro: "AI research and developer news from Google.",
    entry_url: "https://blog.google/technology/ai/",
    sync_time: Date.parse(DEMO_DATE),
    status: 1,
  },
  {
    id: "hugging-face",
    name: "Hugging Face",
    cover: "",
    intro: "Open models, datasets, and tooling.",
    entry_url: "https://huggingface.co/blog",
    sync_time: Date.parse(DEMO_DATE),
    status: 1,
  },
  {
    id: "latent-space",
    name: "Latent Space",
    cover: "",
    intro: "A newsletter about the AI engineering ecosystem.",
    entry_url: "https://www.latent.space/",
    sync_time: Date.parse(DEMO_DATE),
    status: 1,
  },
];

export const demoGroups: FeedGroup[] = [
  {
    id: "ai-research",
    name: "AI Research",
    feed_ids: demoFeeds.map((feed) => feed.id),
    digest_skill_id: "general-digest",
    auto_refresh: true,
  },
];

export const demoArticles: RecentArticle[] = [
  {
    id: "claude-agentic-workflows",
    title: "Building reliable agentic workflows",
    url: "https://www.anthropic.com/news",
    published_at: DEMO_DATE,
    author: "Anthropic",
    feed_id: "anthropic",
    feed_name: "Anthropic",
    has_body: true,
  },
  {
    id: "openai-reasoning-models",
    title: "Reasoning models move closer to everyday developer tools",
    url: "https://openai.com/news/",
    published_at: "2026-08-11T08:00:00.000Z",
    author: "OpenAI",
    feed_id: "openai",
    feed_name: "OpenAI",
    has_body: true,
  },
  {
    id: "google-agent-tools",
    title: "New building blocks for AI agents",
    url: "https://blog.google/technology/ai/",
    published_at: "2026-08-11T06:00:00.000Z",
    author: "Google AI",
    feed_id: "google-ai",
    feed_name: "Google AI",
    has_body: true,
  },
  {
    id: "hf-open-models",
    title: "Open models are becoming easier to deploy",
    url: "https://huggingface.co/blog",
    published_at: "2026-08-10T08:00:00.000Z",
    author: "Hugging Face",
    feed_id: "hugging-face",
    feed_name: "Hugging Face",
    has_body: true,
  },
  {
    id: "latent-space-memory",
    title: "Memory and evaluation are the next agent bottlenecks",
    url: "https://www.latent.space/",
    published_at: "2026-08-09T08:00:00.000Z",
    author: "Latent Space",
    feed_id: "latent-space",
    feed_name: "Latent Space",
    has_body: true,
  },
];

function treeArticle(article: RecentArticle) {
  return {
    feed_id: article.feed_id,
    article_id: article.id,
    title: article.title,
    url: article.url,
  };
}

export const demoDigestTree: DigestTree = {
  version: 1,
  partitions: [
    {
      group_id: "ai-research",
      group_name: "AI Research",
      sections: [
        {
          id: "focus",
          name: "Worth your attention",
          kind: "focus",
          events: [
            {
              title: "Agents are moving from demos to dependable workflows",
              articles: [treeArticle(demoArticles[0]), treeArticle(demoArticles[4])],
            },
            {
              title: "Developer tooling is the new model battleground",
              articles: [treeArticle(demoArticles[1]), treeArticle(demoArticles[2])],
            },
          ],
        },
        {
          id: "models",
          name: "Models and infrastructure",
          kind: "category",
          events: [
            {
              title: "Open models are becoming easier to deploy",
              articles: [treeArticle(demoArticles[3])],
            },
          ],
        },
      ],
    },
  ],
};

export const demoSummary = `# AI Research Brief

## Worth your attention

- **Agents are moving from demos to dependable workflows**
  - [Building reliable agentic workflows](https://www.anthropic.com/news)
  - [Memory and evaluation are the next agent bottlenecks](https://www.latent.space/)

## Models and infrastructure

- **Open models are becoming easier to deploy**
  - [Open models are becoming easier to deploy](https://huggingface.co/blog)
`;

export const demoCitations: CitationItem[] = [
  {
    index: 1,
    id: "citation-1",
    title: demoArticles[0].title,
    feed_name: demoArticles[0].feed_name,
    published_at: demoArticles[0].published_at,
    url: demoArticles[0].url,
    feed_id: demoArticles[0].feed_id,
    article_id: demoArticles[0].id,
    chunk_index: 0,
    char_start: 0,
    excerpt: "Reliable agent workflows need explicit evaluation, clear tool boundaries, and observable intermediate steps.",
    score: 0.94,
  },
  {
    index: 2,
    id: "citation-2",
    title: demoArticles[4].title,
    feed_name: demoArticles[4].feed_name,
    published_at: demoArticles[4].published_at,
    url: demoArticles[4].url,
    feed_id: demoArticles[4].feed_id,
    article_id: demoArticles[4].id,
    chunk_index: 0,
    char_start: 0,
    excerpt: "Memory and evaluation remain practical bottlenecks when teams move an agent from a prototype into a repeatable workflow.",
    score: 0.89,
  },
  {
    index: 3,
    id: "citation-3",
    title: demoArticles[2].title,
    feed_name: demoArticles[2].feed_name,
    published_at: demoArticles[2].published_at,
    url: demoArticles[2].url,
    feed_id: demoArticles[2].feed_id,
    article_id: demoArticles[2].id,
    chunk_index: 0,
    char_start: 0,
    excerpt: "The most useful agent primitives are becoming easier to compose, test, and connect to existing developer workflows.",
    score: 0.86,
  },
];

export const demoQuestions = [
  "What are the most important AI agent updates?",
  "Which developments matter most for developers?",
  "What should I keep watching next week?",
] as const;

export function demoAnswerFor(prompt: string): string {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("developer")) {
    return "The biggest developer-facing shift is that model capability is moving into tooling: better agent primitives, clearer evaluation loops, and easier deployment of open models [1][3]. The practical advantage will come from workflow reliability, not from model demos alone.";
  }
  if (normalized.includes("watch") || normalized.includes("next week")) {
    return "Keep watching three signals: whether agent memory becomes measurable, whether evaluation moves into everyday development workflows, and whether open models become simple enough to deploy without a specialist team [1][2][3].";
  }
  return "The clearest signal is a shift from impressive agent demos toward dependable workflows. Teams are focusing more on evaluation, tool boundaries, memory, and observability than on raw model novelty [1][2].";
}

export const demoArticleRefs = demoArticles.map((article) => ({
  feed_id: article.feed_id,
  article_id: article.id,
  title: article.title,
  url: article.url,
}));

export const demoSkills = [
  {
    id: "general-digest",
    name: "General Brief",
    description: "Prioritize, group, and summarize the latest articles.",
    builtin: true,
    readonly: true,
  },
];

