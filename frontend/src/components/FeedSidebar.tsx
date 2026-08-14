import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
import OverflowMenu from "./OverflowMenu";
import { formatDaysLabel, type DefaultDays } from "../hooks/useSettings";

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
  /** 与库页顶栏时间范围一致，用于「拉取本组正文」说明 */
  days?: DefaultDays;
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
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  submenu?: MenuItem[];
}

function menuItemClass(item: MenuItem, extra = ""): string {
  return `flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
    item.danger ? "text-red-600 hover:bg-[var(--error-soft)]" : "text-[var(--ink)] hover:bg-[var(--paper)]"
  } ${extra}`;
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
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const submenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleCloseSubmenu() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setSubmenuOpen(null);
      setSubmenuPos(null);
      submenuAnchorRef.current = null;
    }, 140);
  }

  function openSubmenuFor(label: string, button: HTMLButtonElement) {
    clearCloseTimer();
    const rect = button.getBoundingClientRect();
    submenuAnchorRef.current = button;
    setSubmenuPos({ top: rect.top, left: rect.right + 4 });
    setSubmenuOpen(label);
  }

  useEffect(() => {
    if (!open) {
      clearCloseTimer();
      setSubmenuOpen(null);
      setSubmenuPos(null);
      submenuAnchorRef.current = null;
      return;
    }
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      if (submenuRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!submenuOpen) return;
    function updatePosition() {
      const button = submenuAnchorRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setSubmenuPos({ top: rect.top, left: rect.right + 4 });
    }
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [submenuOpen]);

  useEffect(() => () => clearCloseTimer(), []);

  const activeSubmenu = useMemo(
    () => items.find((item) => item.label === submenuOpen)?.submenu ?? null,
    [items, submenuOpen],
  );

  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => onOpenChange(!open)}>{trigger}</div>
      {open ? (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] rounded-md border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-lg"
        >
          {items.map((item) =>
            item.submenu && item.submenu.length > 0 ? (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onMouseEnter={(event) => openSubmenuFor(item.label, event.currentTarget)}
                onMouseLeave={scheduleCloseSubmenu}
                onClick={(event) => {
                  event.stopPropagation();
                  openSubmenuFor(item.label, event.currentTarget);
                }}
                className={menuItemClass(item)}
              >
                <span>{item.label}</span>
                <span className="text-[var(--ink-muted)]">›</span>
              </button>
            ) : (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  onOpenChange(false);
                  item.onClick?.();
                }}
                className={menuItemClass(item)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
      {open &&
      submenuOpen &&
      submenuPos &&
      activeSubmenu &&
      activeSubmenu.length > 0
        ? createPortal(
            <div
              ref={submenuRef}
              style={{ top: submenuPos.top, left: submenuPos.left }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleCloseSubmenu}
              className="fixed z-[80] max-h-56 min-w-[9rem] overflow-y-auto rounded-md border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-lg"
            >
              {activeSubmenu.map((sub) => (
                <button
                  key={sub.label}
                  type="button"
                  disabled={sub.disabled}
                  onClick={() => {
                    onOpenChange(false);
                    sub.onClick?.();
                  }}
                  className={menuItemClass(sub)}
                >
                  <span className="truncate">{sub.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
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
  onMoveTo,
  moveTargets = [],
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
  onMoveTo?: (groupId: string) => void;
  moveTargets?: { id: string; name: string; disabled?: boolean }[];
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  renameDraft?: string;
  renaming?: boolean;
  savingRename?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const enabledMoveTargets = moveTargets.filter((target) => !target.disabled);
  const canMove = Boolean(onMoveTo) && enabledMoveTargets.length > 0;
  const hasActions = Boolean(onRename || onDelete || canMove);
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
            className="w-full rounded border border-[var(--rule)] px-2 py-1 text-sm"
          />
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              disabled={savingRename}
              onClick={() => onConfirmRename?.()}
              className="rounded px-2 py-0.5 text-xs text-[var(--success)] hover:bg-[var(--success-soft)] disabled:opacity-50"
            >
              确认
            </button>
            <button
              type="button"
              disabled={savingRename}
              onClick={() => onCancelRename?.()}
              className="rounded px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper)] disabled:opacity-50"
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
            className={`relative min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left text-[13px] ${
              active
                ? "bg-[var(--accent-soft)] font-medium text-[var(--ink)] before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-[var(--accent)]"
                : "text-[var(--ink)] hover:bg-[var(--paper)]"
            }`}
            title={
              feed.sync_time
                ? `上次更新 ${new Date(feed.sync_time * 1000).toLocaleString("zh-CN")}`
                : "尚未更新"
            }
          >
            <span className="block truncate">{feed.name}</span>
            <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--ink-muted)]">
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
                    className="rounded px-1.5 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-raised)] hover:text-[var(--ink)]"
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
                  ...(canMove
                    ? [
                        {
                          label: "移动到",
                          submenu: enabledMoveTargets.map((target) => ({
                            label: target.name,
                            onClick: () => onMoveTo?.(target.id),
                          })),
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
  days = 1,
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
    if (initializedExpand.current || sections.length === 0) return;
    initializedExpand.current = true;
    setExpandedGroupId(
      selectedGroupId ?? sections.find((section) => !section.isSystem)?.id ?? sections[0]?.id ?? null,
    );
  }, [sections, selectedGroupId]);

  // 仅在选中组变化时跟随展开；分组拖动重排会改 sections，不应自动展开
  useEffect(() => {
    if (!initializedExpand.current || !selectedGroupId) return;
    setExpandedGroupId(selectedGroupId);
  }, [selectedGroupId]);

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
    const feedIds = getSectionFeedIds(section.id);
    const hasGroupActions =
      feedIds.length > 0 && Boolean(onRefreshGroup || onLoadGroupBodies);

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
        className={`group/section rounded-[var(--radius-control)] ${
          isFeedDropOver
            ? "bg-[var(--success-soft)] ring-1 ring-[var(--success)]"
            : isGroupReorderOver
              ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
              : ""
        }`}
      >
        <div
          className={`flex items-center gap-0.5 px-1 py-0.5 ${
            isExpanded || isActiveGroup ? "bg-[color-mix(in_srgb,var(--paper)_70%,transparent)]" : ""
          }`}
        >
          {canManageLayout && !section.isSystem ? (
            <button
              type="button"
              draggable
              title="拖动调整分组顺序"
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(event) => {
                setDragData(event, { kind: "group", groupId: section.id });
              }}
              onDragEnd={handleDragEnd}
              className="flex w-4 shrink-0 cursor-grab items-center justify-center rounded py-1 text-xs text-[var(--ink-muted)] opacity-0 hover:text-[var(--ink)] group-hover/section:opacity-100 active:cursor-grabbing"
            >
              ⠿
            </button>
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => toggleSection(section.id)}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left text-[13px] ${
              isExpanded
                ? "font-semibold text-[var(--ink)]"
                : isActiveGroup
                  ? "font-medium text-[var(--ink)]"
                  : "font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <span
              className={`shrink-0 text-[10px] text-[var(--ink-muted)] ${isExpanded ? "text-[var(--accent)]" : ""}`}
              aria-hidden
            >
              {isExpanded ? "▾" : "▸"}
            </span>
            <span className="min-w-0 flex-1 truncate">{section.name}</span>
          </button>
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-[var(--ink-muted)]">
            {section.feeds.length}
          </span>
          <div
            className={`flex w-8 shrink-0 justify-end ${
              hasGroupActions
                ? isExpanded
                  ? "opacity-100"
                  : "opacity-0 group-hover/section:opacity-100"
                : "pointer-events-none opacity-0"
            }`}
          >
            {hasGroupActions ? (
              <OverflowMenu
                label="本组操作"
                disabled={feedRefreshBusy || groupBodiesBusy}
                items={[
                  ...(onRefreshGroup
                    ? [
                        {
                          label:
                            refreshingGroupId === section.id ? "更新中…" : "更新本组",
                          hint: "刷新本组各源的文章列表",
                          disabled: feedRefreshBusy || groupBodiesBusy,
                          onClick: () =>
                            onRefreshGroup(section.id, section.name, feedIds),
                        },
                      ]
                    : []),
                  ...(onLoadGroupBodies
                    ? [
                        {
                          label:
                            loadingBodiesGroupId === section.id
                              ? "拉取中…"
                              : "拉取本组正文",
                          hint: `当前范围（${formatDaysLabel(days)}）内本组列表文章的正文`,
                          disabled: feedRefreshBusy || groupBodiesBusy,
                          onClick: () =>
                            onLoadGroupBodies(section.id, section.name, feedIds),
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <span className="inline-block w-7" aria-hidden />
            )}
          </div>
        </div>

        {isExpanded ? (
          <ul className="mb-1 ml-3 space-y-0.5 border-l border-[var(--rule)] pl-2">
            {section.feeds.length === 0 ? (
              <li className="px-2 py-2 text-[11px] text-[var(--ink-muted)]">此组暂无数据源</li>
            ) : (
              section.feeds.map((feed) => renderFeedItem(feed, section.id))
            )}
          </ul>
        ) : null}
      </div>
    );
  }

  function renderFeedItem(feed: Feed, sectionId: string) {
    const moveTargets = sections.map((section) => ({
      id: section.id,
      name: section.name,
      disabled: section.id === sectionId,
    }));

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
          moveTargets={canManageLayout ? moveTargets : []}
          onMoveTo={
            canManageLayout && onLayoutChange
              ? (targetGroupId) => {
                  if (targetGroupId === sectionId) return;
                  const nextGroups = moveFeedInLayout(groups, feed.id, targetGroupId);
                  setExpandedGroupId(targetGroupId);
                  void onLayoutChange(nextGroups, groupOrder);
                }
              : undefined
          }
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

  const libraryMenuItems = [
    ...(onManageGroups
      ? [
          {
            label: "管理分组",
            onClick: onManageGroups,
          },
        ]
      : []),
    {
      label: refreshingAll ? "更新中…" : "更新全部",
      hint: "刷新所有数据源的文章列表",
      disabled: feeds.length === 0 || feedRefreshBusy,
      onClick: onRefreshAll,
    },
  ];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper-raised)]">
      <div className="shrink-0 border-b border-[var(--rule)] px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold tracking-tight text-[var(--ink)]">订阅</h1>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{feeds.length} 个源</p>
          </div>
          {libraryMenuItems.length > 0 ? <OverflowMenu items={libraryMenuItems} label="库操作" /> : null}
        </div>

        <div className="mt-2.5 flex items-center gap-1.5">
          {feeds.length > 0 ? (
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索…"
              className="ui-input min-w-0 flex-1 text-xs placeholder:text-[var(--ink-muted)]"
            />
          ) : (
            <span className="min-w-0 flex-1 text-xs text-[var(--ink-muted)]">添加第一个数据源</span>
          )}
          <button
            type="button"
            onClick={onAddSource}
            className="ui-btn ui-btn-accent shrink-0 px-2.5 py-1.5 text-xs font-medium"
          >
            添加
          </button>
        </div>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">加载中...</p>
      ) : feeds.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">暂无数据源，点击上方添加</p>
      ) : filteredSections.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">没有匹配的数据源</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {canManageLayout ? (
            <p className="mb-2 px-2 text-[10px] text-[var(--ink-muted)]">
              拖动分组排序 · 拖动源到其他组
            </p>
          ) : null}
          <div className="space-y-0.5">
            {filteredSections.map((section) => renderGroupHeader(section))}
          </div>
        </div>
      )}
    </aside>
  );
}
