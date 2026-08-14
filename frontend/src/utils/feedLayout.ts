import type { Feed, FeedGroup } from "../api";

export const UNGROUPED_GROUP_ID = "__ungrouped__";

export interface FeedSection {
  id: string;
  name: string;
  feeds: Feed[];
  isSystem?: boolean;
}

export function orderGroups(groups: FeedGroup[], groupOrder: string[]): FeedGroup[] {
  const map = new Map(groups.map((group) => [group.id, group]));
  const ordered: FeedGroup[] = [];
  for (const groupId of groupOrder) {
    const group = map.get(groupId);
    if (group) {
      ordered.push(group);
      map.delete(groupId);
    }
  }
  for (const group of map.values()) {
    ordered.push(group);
  }
  return ordered;
}

export function buildSections(
  feeds: Feed[],
  groups: FeedGroup[],
  groupOrder: string[],
): FeedSection[] {
  const orderedGroups = orderGroups(groups, groupOrder);
  const groupedIds = new Set(orderedGroups.flatMap((group) => group.feed_ids));

  const sections: FeedSection[] = orderedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    feeds: group.feed_ids
      .map((feedId) => feeds.find((feed) => feed.id === feedId))
      .filter((feed): feed is Feed => Boolean(feed)),
  }));

  sections.push({
    id: UNGROUPED_GROUP_ID,
    name: "未分组",
    feeds: feeds.filter((feed) => !groupedIds.has(feed.id)),
    isSystem: true,
  });

  return sections;
}

export function sectionsToLayout(
  sections: FeedSection[],
  previousGroups: FeedGroup[] = [],
  visibleFeedIds?: Set<string>,
): {
  groups: FeedGroup[];
  group_order: string[];
} {
  const previousById = new Map(previousGroups.map((group) => [group.id, group]));
  const visible = visibleFeedIds ?? new Set(sections.flatMap((section) => section.feeds.map((feed) => feed.id)));

  const groups = sections
    .filter((section) => section.id !== UNGROUPED_GROUP_ID)
    .map((section) => {
      const currentIds = section.feeds.map((feed) => feed.id);
      const currentSet = new Set(currentIds);
      // 保留「分组里有、但当前 feeds 列表尚未加载」的 id，避免拖拽保存时把刚接入的源丢掉
      const preserved = (previousById.get(section.id)?.feed_ids ?? []).filter(
        (feedId) => !visible.has(feedId) && !currentSet.has(feedId),
      );
      const prev = previousById.get(section.id);
      return {
        id: section.id,
        name: section.name,
        feed_ids: [...currentIds, ...preserved],
        digest_skill_id: prev?.digest_skill_id ?? null,
        auto_refresh: prev?.auto_refresh ?? true,
      };
    });
  return {
    groups,
    group_order: groups.map((group) => group.id),
  };
}

export function countUngroupedFeeds(feeds: Feed[], groups: FeedGroup[]): number {
  const groupedIds = new Set(groups.flatMap((group) => group.feed_ids));
  return feeds.filter((feed) => !groupedIds.has(feed.id)).length;
}

export function reorderGroups(
  groupOrder: string[],
  activeGroupId: string,
  overGroupId: string,
): string[] {
  if (activeGroupId === overGroupId) return groupOrder;
  const order = [...groupOrder];
  const from = order.indexOf(activeGroupId);
  const to = order.indexOf(overGroupId);
  if (from < 0 || to < 0) return groupOrder;
  order.splice(from, 1);
  order.splice(to, 0, activeGroupId);
  return order;
}

export function moveFeedInLayout(
  groups: FeedGroup[],
  feedId: string,
  toGroupId: string,
  beforeFeedId?: string,
): FeedGroup[] {
  const next = groups.map((group) => ({
    ...group,
    feed_ids: group.feed_ids.filter((id) => id !== feedId),
  }));

  if (toGroupId === UNGROUPED_GROUP_ID) {
    return next;
  }

  const target = next.find((group) => group.id === toGroupId);
  if (!target) return next;

  let insertAt = target.feed_ids.length;
  if (beforeFeedId) {
    const index = target.feed_ids.indexOf(beforeFeedId);
    if (index >= 0) insertAt = index;
  }
  target.feed_ids.splice(insertAt, 0, feedId);
  return next;
}
