import type { AuthPrecheckItem, Feed, FeedGroup, FeedSchedulerConfig, SkillDetail } from "../../api";
import { UNGROUPED_GROUP_ID } from "../../utils/feedLayout";

export function noop() {}
export async function noopAsync() {}

export const SAMPLE_GROUPS: FeedGroup[] = [
  {
    id: "group-ai",
    name: "ai",
    feed_ids: ["feed-a", "feed-b"],
    digest_skill_id: "tech-longform-digest",
  },
  {
    id: "group-co",
    name: "ai公司",
    feed_ids: ["feed-c"],
    digest_skill_id: null,
  },
];

export const SAMPLE_FEEDS: Feed[] = [
  {
    id: "feed-a",
    name: "机器之心",
    cover: "",
    intro: "",
    entry_url: "https://example.com/a",
    sync_time: Date.now() / 1000 - 3600,
    group_id: "group-ai",
  },
  {
    id: "feed-b",
    name: "量子位",
    cover: "",
    intro: "",
    entry_url: "https://example.com/b",
    sync_time: Date.now() / 1000 - 7200,
    group_id: "group-ai",
  },
  {
    id: "feed-c",
    name: "Anthropic",
    cover: "",
    intro: "",
    entry_url: "https://example.com/c",
    sync_time: Date.now() / 1000 - 1800,
    group_id: "group-co",
  },
  {
    id: "feed-u",
    name: "Ungrouped demo",
    cover: "",
    intro: "",
    entry_url: "https://example.com/u",
    group_id: UNGROUPED_GROUP_ID,
  },
];

export const SAMPLE_GROUP_ORDER = ["group-ai", "group-co", UNGROUPED_GROUP_ID];

export const AUTH_ITEM: AuthPrecheckItem = {
  entry_url: "https://x.com/demo",
  requires_auth: true,
  platform: "x",
  slot: "x",
  slot_label: "X / Twitter",
  login_url: "https://x.com/i/flow/login",
  cookie_hint: "Paste full Cookie header…",
  configured: false,
  can_proceed: false,
};

export const SAMPLE_SKILL_DETAIL: SkillDetail = {
  id: "36kr-discovery",
  name: "36kr",
  category: "discovery",
  description: "Demo discovery skill",
  builtin: true,
  skill_md: "---\nname: 36kr\n---\n\n# 36kr\n\nFixture SKILL.md for catalog.",
  source_yaml: "feed_id: website:36kr\nentry_url: https://36kr.com\n",
  files: [{ path: "scripts/discover.py", content: "print('fixture')\n" }],
};

export const SAMPLE_SCHEDULER_POPULATED: FeedSchedulerConfig = {
  enabled: true,
  schedules: [
    {
      kind: "daily",
      hour: 8,
      minute: 0,
      second: 0,
      group_ids: ["group-ai"],
    },
    {
      kind: "interval",
      hour: 0,
      minute: 0,
      second: 0,
      every_hours: 6,
      group_ids: ["group-co"],
    },
  ],
  next_runs: [
    {
      kind: "daily",
      hour: 8,
      minute: 0,
      second: 0,
      group_ids: ["group-ai"],
      next_run: new Date(Date.now() + 3600_000).toISOString(),
    },
  ],
  refresh_running: false,
  last_run_at: Date.now() / 1000 - 7200,
  last_error: null,
  last_feed_count: 3,
  last_refresh_message: null,
  last_refresh_failed: [],
  last_refresh_cancelled: false,
};

export const SAMPLE_SCHEDULER_EMPTY: FeedSchedulerConfig = {
  enabled: true,
  schedules: [],
  next_runs: [],
  refresh_running: false,
  last_run_at: null,
  last_error: null,
  last_feed_count: 0,
  last_refresh_message: null,
  last_refresh_failed: [],
  last_refresh_cancelled: false,
};
