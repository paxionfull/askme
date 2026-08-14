import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type { Feed, FeedGroup } from "../api";
import {
  UNGROUPED_GROUP_ID,
  buildSections,
  moveFeedInLayout,
  reorderGroups,
  sectionsToLayout,
  type FeedSection,
} from "../utils/feedLayout";
import { formatFeedSyncTime } from "../utils/formatSyncTime";

interface FeedSidebarProps {
  feeds: Feed[];
  groups: FeedGroup[];
  groupOrder: string[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onRefreshAll: () => void;
  onRefreshGroup?: (groupId: string, groupName: string, feedIds: string[]) => void;
  onLoadGroupBodies?: (groupId: string, groupName: string, feedIds: string[]) => void;
  refreshingAll: boolean;
  refreshing?: boolean;
  refreshingGroupId?: string | null;
  loadingBodies?: boolean;
  loadingBodiesGroupId?: string | null;
  onAddSource?: () => void;
  onManageGroups?: () => void;
  onDeleteFeed?: (feedId: string) => void;
  onRenameFeed?: (feedId: string, name: string) => void | Promise<void>;
  onLayoutChange?: (groups: FeedGroup[], groupOrder: string[]) => void | Promise<void>;
}

type DragKind = "group" | "feed";

interface DragPayload {
  kind: DragKind;
  groupId: string;
  feedId?: string;
}

type DropTarget =
  | { type: "group-reorder"; groupId: string }
  | { type: "feed-to-group"; groupId: string };

function sortFeedsByName(feedList: Feed[]): Feed[] {
  return [...feedList].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function DropdownMenu({
  trigger,
  items,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => onOpenChange(!open)}>{trigger}</div>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[9rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                onOpenChange(false);
                item.onClick();
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger
                  ? "text-red-600 hover:bg-red-50"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedRow({
  feed,
  active,
  canDrag,
  onSelect,
  onDelete,
  onRename,
  onStartRename,
  onRenameChange,
  onConfirmRename,
  onCancelRename,
  onDragStart,
  onDragEnd,
  renameDraft = "",
  renaming = false,
  savingRename = false,
}: {
  feed: Feed;
  active: boolean;
  canDrag: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => void | Promise<void>;
  onStartRename?: () => void;
  onRenameChange?: (value: string) => void;
  onConfirmRename?: () => void;
  onCancelRename?: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  renameDraft?: string;
  renaming?: boolean;
  savingRename?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasActions = Boolean(onRename || onDelete);
  const draggable = canDrag && !renaming;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={draggable ? "按住拖动到上方分组可变更归属" : undefined}
      className={`group flex items-center gap-0.5 rounded-lg ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {renaming ? (
        <div className="min-w-0 flex-1 rounded-lg px-2 py-1.5">
          <input
            autoFocus
            value={renameDraft}
            disabled={savingRename}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirmRename?.();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename?.();
              }
            }}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              disabled={savingRename}
              onClick={() => onConfirmRename?.()}
              className="rounded px-2 py-0.5 text-xs text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
            >
              确认
            </button>
            <button
              type="button"
              disabled={savingRename}
              onClick={() => onCancelRename?.()}
              className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }}
            className={`min-w-0 flex-1 rounded-md px-2.5 py-2 text-left text-sm ${
              active
                ? "bg-blue-50 font-medium text-blue-900 ring-1 ring-blue-200"
                : "text-slate-700 hover:bg-slate-50"
            }`}
            title={
              feed.sync_time
                ? `上次更新 ${new Date(feed.sync_time * 1000).toLocaleString("zh-CN")}`
                : "尚未更新"
            }
          >
            <span className="block truncate">{feed.name}</span>
            <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-400">
              {formatFeedSyncTime(feed.sync_time)}
            </span>
          </div>
          {hasActions && (
            <div
              className={`shrink-0 ${active || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            >
              <DropdownMenu
                open={menuOpen}
                onOpenChange={setMenuOpen}
                trigger={
                  <button
                    type="button"
                    title="更多"
                    onMouseDown={(e) => e.stopPropagation()}
                    className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-white hover:text-slate-700"
                  >
                    ⋯
                  </button>
                }
                items={[
                  ...(onRename
                    ? [
                        {
                          label: "重命名",
                          onClick: () => onStartRename?.(),
                        },
                      ]
                    : []),
                  ...(onDelete
                    ? [
                        {
                          label: "从列表移除",
                          onClick: () => onDelete(),
                          danger: true,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}
        </>
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
  onRefreshGroup,
  onLoadGroupBodies,
  refreshingAll,
  refreshing = false,
  refreshingGroupId = null,
  loadingBodies = false,
  loadingBodiesGroupId = null,
  onAddSource,
  onManageGroups,
  onDeleteFeed,
  onRenameFeed,
  onLayoutChange,
}: FeedSidebarProps) {
  const feedRefreshBusy = refreshing || refreshingAll || Boolean(refreshingGroupId);
  const groupBodiesBusy = loadingBodies || Boolean(loadingBodiesGroupId);
  const canManageLayout = Boolean(onLayoutChange);

  const sections = useMemo(
    () => buildSections(feeds, groups, groupOrder),
    [feeds, groups, groupOrder],
  );

  const selectedGroupId = useMemo(() => {
    if (!selectedId) return null;
    for (const section of sections) {
      if (section.feeds.some((feed) => feed.id === selectedId)) {
        return section.id;
      }
    }
    return null;
  }, [sections, selectedId]);

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [editingFeedId, setEditingFeedId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRenameId, setSavingRenameId] = useState<string | null>(null);
  const initializedExpand = useRef(false);

  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const base = query
      ? sections
          .map((section) => ({
            ...section,
            feeds: sortFeedsByName(
              section.feeds.filter((feed) => feed.name.toLowerCase().includes(query)),
            ),
          }))
          .filter((section) => section.feeds.length > 0)
      : sections.map((section) => ({
          ...section,
          feeds: sortFeedsByName(section.feeds),
        }));
    return base;
  }, [sections, searchQuery]);

  const expandedSection = useMemo(() => {
    if (!expandedGroupId) return null;
    return filteredSections.find((section) => section.id === expandedGroupId) ?? null;
  }, [filteredSections, expandedGroupId]);

  useEffect(() => {
    setDragging(null);
    setDropTarget(null);
  }, [groups, groupOrder, feeds]);

  useEffect(() => {
    if (!editingFeedId) return;
    if (!feeds.some((feed) => feed.id === editingFeedId)) {
      setEditingFeedId(null);
      setRenameDraft("");
      setSavingRenameId(null);
    }
  }, [feeds, editingFeedId]);

  useEffect(() => {
    if (sections.length === 0) return;

    if (!initializedExpand.current) {
      initializedExpand.current = true;
      setExpandedGroupId(
        selectedGroupId ?? sections.find((section) => !section.isSystem)?.id ?? sections[0]?.id ?? null,
      );
      return;
    }

    if (selectedGroupId) {
      setExpandedGroupId(selectedGroupId);
    }
  }, [sections, selectedGroupId]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (filteredSections.length > 0) {
      setExpandedGroupId(filteredSections[0].id);
    }
  }, [searchQuery, filteredSections]);

  function toggleSection(sectionId: string) {
    setExpandedGroupId((current) => (current === sectionId ? null : sectionId));
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
    const layout = sectionsToLayout(
      nextSections,
      groups,
      new Set(feeds.map((feed) => feed.id)),
    );
    await onLayoutChange?.(layout.groups, layout.group_order);
  }

  function handleGroupDrop(activeGroupId: string, overGroupId: string) {
    if (activeGroupId === overGroupId || overGroupId === UNGROUPED_GROUP_ID) return;
    const nextOrder = reorderGroups(groupOrder, activeGroupId, overGroupId);
    void applyLayout(buildSections(feeds, groups, nextOrder));
  }

  function handleFeedDrop(feedId: string, toGroupId: string) {
    const nextGroups = moveFeedInLayout(groups, feedId, toGroupId);
    void applyLayout(buildSections(feeds, nextGroups, groupOrder));
  }

  function allowDrop(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function getSectionFeedIds(sectionId: string): string[] {
    const full = sections.find((section) => section.id === sectionId);
    return (full ?? filteredSections.find((section) => section.id === sectionId))?.feeds.map(
      (feed) => feed.id,
    ) ?? [];
  }

  function renderGroupHeader(section: FeedSection) {
    const isExpanded = expandedGroupId === section.id;
    const isGroupReorderOver =
      dropTarget?.type === "group-reorder" && dropTarget.groupId === section.id;
    const isFeedDropOver =
      dropTarget?.type === "feed-to-group" && dropTarget.groupId === section.id;
    const isActiveGroup = selectedGroupId === section.id;

    return (
      <div
        key={section.id}
        onDragEnd={handleDragEnd}
        onDragOver={(event) => {
          if (!canManageLayout) return;
          allowDrop(event);
          const payload = dragging ?? parsePayload(event);
          if (payload?.kind === "feed") {
            setDropTarget({ type: "feed-to-group", groupId: section.id });
          } else if (payload?.kind === "group" && !section.isSystem) {
            setDropTarget({ type: "group-reorder", groupId: section.id });
          }
        }}
        onDrop={(event) => {
          if (!canManageLayout) return;
          event.preventDefault();
          event.stopPropagation();
          const payload = dragging ?? parsePayload(event);
          if (payload?.kind === "group") {
            handleGroupDrop(payload.groupId, section.id);
          } else if (payload?.kind === "feed" && payload.feedId) {
            handleFeedDrop(payload.feedId, section.id);
          }
          handleDragEnd();
        }}
        className={`flex items-center gap-0.5 rounded-md border px-1 py-0.5 ${
          isFeedDropOver
            ? isExpanded
              ? "border-emerald-400 bg-emerald-700 shadow-sm"
              : "border-emerald-400 bg-emerald-100"
            : isGroupReorderOver
              ? "border-blue-300 bg-blue-100"
              : isExpanded
                ? "border-slate-400 bg-slate-700 shadow-sm"
                : "border-transparent bg-slate-200/80 hover:bg-slate-200"
        }`}
      >
        {canManageLayout && !section.isSystem && (
          <button
            type="button"
            draggable
            title="拖动调整分组顺序"
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(event) => {
              setDragData(event, { kind: "group", groupId: section.id });
            }}
            onDragEnd={handleDragEnd}
            className={`shrink-0 cursor-grab rounded px-0.5 py-1 text-xs active:cursor-grabbing ${
              isExpanded ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            ⠿
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleSection(section.id)}
          className={`flex min-w-0 flex-1 items-center justify-between rounded px-1.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide ${
            isExpanded ? "text-white" : isActiveGroup ? "text-slate-800" : "text-slate-600"
          }`}
        >
          <span className="truncate">
            {section.name}
            <span
              className={`ml-1 font-normal normal-case tracking-normal ${
                isExpanded ? "text-slate-300" : "text-slate-400"
              }`}
            >
              ({section.feeds.length})
            </span>
          </span>
          <span className={`ml-1 shrink-0 ${isExpanded ? "text-slate-300" : "text-slate-400"}`}>
            {isExpanded ? "▾" : "▸"}
          </span>
        </button>
      </div>
    );
  }

  function renderFeedItem(feed: Feed, sectionId: string) {
    return (
      <li key={feed.id}>
        <FeedRow
          feed={feed}
          active={selectedId === feed.id}
          canDrag={canManageLayout}
          onSelect={() => onSelect(feed.id)}
          onRename={onRenameFeed ? (name) => onRenameFeed(feed.id, name) : undefined}
          renaming={editingFeedId === feed.id}
          renameDraft={editingFeedId === feed.id ? renameDraft : feed.name}
          savingRename={savingRenameId === feed.id}
          onStartRename={() => {
            setEditingFeedId(feed.id);
            setRenameDraft(feed.name);
          }}
          onRenameChange={setRenameDraft}
          onConfirmRename={() => {
            if (!onRenameFeed) return;
            const nextName = renameDraft.trim();
            if (!nextName || nextName === feed.name) {
              setEditingFeedId(null);
              setRenameDraft("");
              return;
            }
            setSavingRenameId(feed.id);
            void Promise.resolve(onRenameFeed(feed.id, nextName))
              .then(() => {
                setEditingFeedId(null);
                setRenameDraft("");
              })
              .finally(() => {
                setSavingRenameId(null);
              });
          }}
          onCancelRename={() => {
            setEditingFeedId(null);
            setRenameDraft("");
          }}
          onDelete={onDeleteFeed ? () => onDeleteFeed(feed.id) : undefined}
          onDragStart={(event) => {
            if (!canManageLayout) return;
            setDragData(event, {
              kind: "feed",
              groupId: sectionId,
              feedId: feed.id,
            });
          }}
          onDragEnd={handleDragEnd}
        />
      </li>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="shrink-0 border-b border-slate-200 px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-sm font-semibold">订阅列表</h1>
          <span className="text-xs text-slate-400">{feeds.length} 个源</span>
        </div>

        {feeds.length > 0 && (
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索数据源…"
            className="mt-2 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
        )}

        <div className="mt-2 space-y-1.5">
          <button
            type="button"
            onClick={onAddSource}
            className="w-full rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white hover:bg-slate-700"
          >
            添加数据源
          </button>
          <div className="flex gap-1.5">
            {onManageGroups && (
              <button
                type="button"
                onClick={onManageGroups}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                管理分组
              </button>
            )}
            <button
              type="button"
              disabled={feeds.length === 0 || feedRefreshBusy}
              onClick={onRefreshAll}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshingAll ? "更新中…" : "更新全部"}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-slate-500">加载中...</p>
      ) : feeds.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">暂无数据源，点击上方添加</p>
      ) : filteredSections.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">没有匹配的数据源</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 分组区 */}
          <div className="shrink-0 border-b-2 border-slate-300 bg-slate-200 px-2 py-2">
            <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              分组
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {filteredSections.map((section) => renderGroupHeader(section))}
            </div>
          </div>

          {/* 数据源区 */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-white px-2 py-3">
            {!expandedSection ? (
              <p className="px-2 py-6 text-center text-xs text-slate-400">展开分组以查看数据源</p>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                <div className="mb-2 flex items-center gap-2 px-0.5">
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ring-1 ring-slate-200">
                    数据源
                  </span>
                  <span className="truncate text-xs font-medium text-slate-700">{expandedSection.name}</span>
                  <span className="h-px flex-1 bg-slate-300" />
                </div>
                {getSectionFeedIds(expandedSection.id).length > 0 &&
                  (onRefreshGroup || onLoadGroupBodies) && (
                    <div className="mb-2 flex gap-1.5">
                      {onRefreshGroup && (
                        <button
                          type="button"
                          title="更新本组各源的文章列表"
                          disabled={feedRefreshBusy || groupBodiesBusy}
                          onClick={() =>
                            onRefreshGroup(
                              expandedSection.id,
                              expandedSection.name,
                              getSectionFeedIds(expandedSection.id),
                            )
                          }
                          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {refreshingGroupId === expandedSection.id ? "更新中…" : "更新本组"}
                        </button>
                      )}
                      {onLoadGroupBodies && (
                        <button
                          type="button"
                          title="拉取本组各源列表内文章正文（每源最近 20 篇）"
                          disabled={feedRefreshBusy || groupBodiesBusy}
                          onClick={() =>
                            onLoadGroupBodies(
                              expandedSection.id,
                              expandedSection.name,
                              getSectionFeedIds(expandedSection.id),
                            )
                          }
                          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loadingBodiesGroupId === expandedSection.id ? "拉取中…" : "拉取本组正文"}
                        </button>
                      )}
                    </div>
                  )}
                <ul className="space-y-0.5 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
                  {canManageLayout && (
                    <p className="px-2 py-1 text-[11px] text-slate-400">按住数据源可拖到上方分组</p>
                  )}
                  {expandedSection.feeds.map((feed) => renderFeedItem(feed, expandedSection.id))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
