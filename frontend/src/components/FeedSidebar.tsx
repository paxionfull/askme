import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { Feed, FeedGroup } from "../api";
import {
  UNGROUPED_GROUP_ID,
  buildSections,
  moveFeedInLayout,
  reorderGroups,
  sectionsToLayout,
  type FeedSection,
} from "../utils/feedLayout";

interface FeedSidebarProps {
  feeds: Feed[];
  groups: FeedGroup[];
  groupOrder: string[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onRefreshAll: () => void;
  refreshingAll: boolean;
  onAddSource?: () => void;
  onManageGroups?: () => void;
  onDeleteFeed?: (feedId: string) => void;
  onLayoutChange?: (groups: FeedGroup[], groupOrder: string[]) => void | Promise<void>;
}

type DragKind = "group" | "feed";

interface DragPayload {
  kind: DragKind;
  groupId: string;
  feedId?: string;
}

interface DropTarget {
  kind: DragKind;
  groupId: string;
  feedId?: string;
}

function FeedRow({
  feed,
  active,
  onSelect,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: {
  feed: Feed;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  isDragOver: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex items-center gap-1 rounded-lg ${
        isDragOver ? "bg-blue-50 ring-1 ring-blue-200" : ""
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`min-w-0 flex-1 cursor-grab rounded-lg px-2 py-2 text-left text-sm active:cursor-grabbing ${
          active ? "bg-slate-100 font-medium" : "hover:bg-slate-50"
        }`}
      >
        <span className="block truncate">{feed.name}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          title="从列表移除（保留 skill）"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded px-1.5 py-1 text-xs text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function FeedSidebar({
  feeds,
  groups,
  groupOrder,
  selectedId,
  loading,
  onSelect,
  onRefreshAll,
  refreshingAll,
  onAddSource,
  onManageGroups,
  onDeleteFeed,
  onLayoutChange,
}: FeedSidebarProps) {
  const sections = useMemo(
    () => buildSections(feeds, groups, groupOrder),
    [feeds, groups, groupOrder],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  useEffect(() => {
    setDragging(null);
    setDropTarget(null);
  }, [groups, groupOrder, feeds]);

  function toggleSection(sectionId: string) {
    setCollapsed((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  }

  function parsePayload(event: DragEvent): DragPayload | null {
    const raw = event.dataTransfer.getData("application/x-askme-feed-layout");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  }

  function setDragData(event: DragEvent, payload: DragPayload) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-askme-feed-layout", JSON.stringify(payload));
    setDragging(payload);
  }

  function handleDragEnd() {
    setDragging(null);
    setDropTarget(null);
  }

  async function applyLayout(nextSections: FeedSection[]) {
    const layout = sectionsToLayout(nextSections);
    await onLayoutChange?.(layout.groups, layout.group_order);
  }

  function handleGroupDrop(activeGroupId: string, overGroupId: string) {
    if (activeGroupId === overGroupId || overGroupId === UNGROUPED_GROUP_ID) return;
    const nextOrder = reorderGroups(groupOrder, activeGroupId, overGroupId);
    void applyLayout(buildSections(feeds, groups, nextOrder));
  }

  function handleFeedDrop(payload: DragPayload, target: DropTarget) {
    if (!payload.feedId) return;
    const beforeFeedId =
      target.kind === "feed" && target.feedId !== payload.feedId ? target.feedId : undefined;
    const nextGroups = moveFeedInLayout(
      groups,
      payload.feedId,
      target.groupId,
      beforeFeedId,
    );
    void applyLayout(buildSections(feeds, nextGroups, groupOrder));
  }

  function allowDrop(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function renderSection(section: FeedSection) {
    const isCollapsed = collapsed[section.id] ?? false;
    const isGroupDragOver =
      dropTarget?.kind === "group" && dropTarget.groupId === section.id && dragging?.kind === "group";
    const isFeedGroupDragOver =
      dropTarget?.kind === "group" && dropTarget.groupId === section.id && dragging?.kind === "feed";

    return (
      <section key={section.id}>
        <div
          draggable={!section.isSystem && Boolean(onLayoutChange)}
          onDragStart={(event) => {
            if (section.isSystem || !onLayoutChange) return;
            setDragData(event, { kind: "group", groupId: section.id });
          }}
          onDragEnd={handleDragEnd}
          onDragOver={(event) => {
            if (!onLayoutChange) return;
            allowDrop(event);
            const payload = dragging ?? parsePayload(event);
            if (!payload) return;
            if (payload.kind === "group" && !section.isSystem) {
              setDropTarget({ kind: "group", groupId: section.id });
            } else if (payload.kind === "feed") {
              setDropTarget({ kind: "group", groupId: section.id });
            }
          }}
          onDrop={(event) => {
            if (!onLayoutChange) return;
            event.preventDefault();
            event.stopPropagation();
            const payload = dragging ?? parsePayload(event);
            if (!payload) return;
            if (payload.kind === "group") {
              handleGroupDrop(payload.groupId, section.id);
            } else if (payload.kind === "feed") {
              handleFeedDrop(payload, { kind: "group", groupId: section.id });
            }
            handleDragEnd();
          }}
          className={`flex items-center justify-between rounded-md px-2 py-1 ${
            isGroupDragOver || isFeedGroupDragOver ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"
          } ${section.isSystem ? "" : "cursor-grab active:cursor-grabbing"}`}
        >
          <button
            type="button"
            onClick={() => toggleSection(section.id)}
            className="flex min-w-0 flex-1 items-center justify-between text-left text-xs font-medium text-slate-500"
          >
            <span>
              {section.name} ({section.feeds.length})
            </span>
            <span>{isCollapsed ? "▸" : "▾"}</span>
          </button>
        </div>

        {!isCollapsed && (
          <ul className="mt-1 space-y-1">
            {section.feeds.map((feed) => (
              <li key={feed.id}>
                <FeedRow
                  feed={feed}
                  active={selectedId === feed.id}
                  onSelect={() => onSelect(feed.id)}
                  onDelete={onDeleteFeed ? () => onDeleteFeed(feed.id) : undefined}
                  isDragOver={
                    dropTarget?.kind === "feed" &&
                    dropTarget.feedId === feed.id &&
                    dragging?.kind === "feed"
                  }
                  onDragStart={(event) => {
                    if (!onLayoutChange) return;
                    setDragData(event, {
                      kind: "feed",
                      groupId: section.id,
                      feedId: feed.id,
                    });
                  }}
                  onDragOver={(event) => {
                    if (!onLayoutChange) return;
                    allowDrop(event);
                    const payload = dragging ?? parsePayload(event);
                    if (payload?.kind === "feed") {
                      setDropTarget({
                        kind: "feed",
                        groupId: section.id,
                        feedId: feed.id,
                      });
                    }
                  }}
                  onDrop={(event) => {
                    if (!onLayoutChange) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const payload = dragging ?? parsePayload(event);
                    if (!payload?.feedId || payload.kind !== "feed") return;
                    handleFeedDrop(payload, {
                      kind: "feed",
                      groupId: section.id,
                      feedId: feed.id,
                    });
                    handleDragEnd();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">数据源</h1>
          <p className="text-xs text-slate-500">共 {feeds.length} 个网站源</p>
        </div>
        <button
          type="button"
          onClick={onAddSource}
          className="mt-2 w-full rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white hover:bg-slate-700"
        >
          添加数据源
        </button>
        <button
          type="button"
          onClick={onManageGroups}
          className="mt-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50"
        >
          管理分组
        </button>
        <button
          type="button"
          disabled={feeds.length === 0 || refreshingAll}
          onClick={onRefreshAll}
          className="mt-2 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshingAll ? "更新中..." : "更新全部"}
        </button>
        {onLayoutChange && feeds.length > 0 && (
          <p className="mt-2 text-[11px] leading-4 text-slate-400">
            拖动分组或数据源可调整顺序；将数据源拖到其他分组可变更归属。
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-sm text-slate-500">加载中...</p>
        ) : feeds.length === 0 ? (
          <p className="px-2 py-4 text-sm text-slate-500">暂无数据源</p>
        ) : (
          <div className="space-y-3">{sections.map((section) => renderSection(section))}</div>
        )}
      </div>
    </aside>
  );
}
