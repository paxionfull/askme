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
  refreshingAll: boolean;
  refreshing?: boolean;
  refreshingGroupId?: string | null;
  loadingBodies?: boolean;
  loadingBodiesGroupId?: string | null;
  sourcesBusy?: boolean;
  onAddSource?: (groupId?: string) => void;
  onManageGroups?: () => void;
  onRenameGroup?: (groupId: string, name: string) => void | Promise<void>;
  onOpenSchedule?: (groupId: string) => void;
  onDeleteGroup?: (group: { id: string; name: string; feedIds: string[] }) => void;
  onClearUngrouped?: (feedIds: string[]) => void;
  onDeleteFeed?: (feedId: string) => void;
  onRenameFeed?: (feedId: string, name: string) => void | Promise<void>;
  onLayoutChange?: (groups: FeedGroup[], groupOrder: string[]) => void | Promise<void>;
  /** 与源页顶栏时间范围一致 */
  days?: DefaultDays;
  /** 工作集：更新所选 / 建立索引作用于此 */
  scopedGroupIds?: Set<string>;
  onToggleGroupScope?: (groupId: string, checked: boolean) => void;
  /** 出现在任一条定时规则中的分组 */
  scheduledGroupIds?: Set<string>;
  scheduleHintByGroupId?: Record<string, string>;
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

function computeFloatingMenuPosition(
  anchorRect: DOMRect,
  menuWidth: number,
  menuHeight: number,
): { top: number; left: number } {
  const gap = 4;
  const spaceBelow = window.innerHeight - anchorRect.bottom - gap;
  const spaceAbove = anchorRect.top - gap;
  const openUp = menuHeight > spaceBelow && spaceAbove >= spaceBelow;
  const top = openUp
    ? anchorRect.top - menuHeight - gap
    : anchorRect.bottom + gap;
  const left = Math.max(
    8,
    Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8),
  );
  return {
    top: Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8)),
    left,
  };
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
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

  function updateMenuPosition() {
    const root = rootRef.current;
    const menu = menuRef.current;
    if (!root) return;
    const anchorRect = root.getBoundingClientRect();
    const menuWidth = menu?.offsetWidth ?? 144;
    const menuHeight = menu?.offsetHeight ?? Math.max(items.length * 32 + 8, 40);
    setMenuPos(computeFloatingMenuPosition(anchorRect, menuWidth, menuHeight));
  }

  function openSubmenuFor(label: string, button: HTMLButtonElement) {
    clearCloseTimer();
    const rect = button.getBoundingClientRect();
    submenuAnchorRef.current = button;
    const submenuWidth = submenuRef.current?.offsetWidth ?? 144;
    const itemCount = items.find((item) => item.label === label)?.submenu?.length ?? 1;
    const submenuHeight = submenuRef.current?.offsetHeight ?? Math.max(itemCount * 32 + 8, 40);
    let left = rect.right + 4;
    if (left + submenuWidth > window.innerWidth - 8) {
      left = Math.max(8, rect.left - submenuWidth - 4);
    }
    let top = rect.top;
    if (top + submenuHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - submenuHeight - 8);
    }
    setSubmenuPos({ top, left });
    setSubmenuOpen(label);
  }

  useEffect(() => {
    if (!open) {
      clearCloseTimer();
      setMenuPos(null);
      setSubmenuOpen(null);
      setSubmenuPos(null);
      submenuAnchorRef.current = null;
      return;
    }
    updateMenuPosition();
    const raf = window.requestAnimationFrame(() => updateMenuPosition());
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      if (submenuRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    function handleReposition() {
      updateMenuPosition();
      const button = submenuAnchorRef.current;
      const label = submenuOpen;
      if (button && label) {
        openSubmenuFor(label, button);
      }
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open, onOpenChange, items, submenuOpen]);

  useEffect(() => () => clearCloseTimer(), []);

  const activeSubmenu = useMemo(
    () => items.find((item) => item.label === submenuOpen)?.submenu ?? null,
    [items, submenuOpen],
  );

  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => onOpenChange(!open)}>{trigger}</div>
      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: menuPos.top, left: menuPos.left }}
              className="fixed z-[80] min-w-[9rem] rounded-md border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-lg"
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
            </div>,
            document.body,
          )
        : null}
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
              className="fixed z-[90] max-h-56 min-w-[9rem] overflow-y-auto rounded-md border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-lg"
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
                          label: "删除",
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
  refreshingAll,
  refreshing: _refreshing = false,
  refreshingGroupId = null,
  loadingBodies = false,
  loadingBodiesGroupId = null,
  sourcesBusy: _sourcesBusy = false,
  onAddSource,
  onManageGroups,
  onRenameGroup,
  onOpenSchedule,
  onDeleteGroup,
  onClearUngrouped,
  onDeleteFeed,
  onRenameFeed,
  onLayoutChange,
  days = 1,
  scopedGroupIds,
  onToggleGroupScope,
  scheduledGroupIds,
  scheduleHintByGroupId,
}: FeedSidebarProps) {
  const groupBodiesBusy = loadingBodies || Boolean(loadingBodiesGroupId);
  // 刷新进行中仍可继续点更新（后端合并入队）；仅正文拉取时禁用避免交错
  const refreshActionDisabled = groupBodiesBusy;
  const canManageLayout = Boolean(onLayoutChange);
  const canGroupContextMenu = Boolean(
    onAddSource || onRenameGroup || onOpenSchedule || onDeleteGroup || onClearUngrouped,
  );

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
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupRenameDraft, setGroupRenameDraft] = useState("");
  const [savingGroupRenameId, setSavingGroupRenameId] = useState<string | null>(null);
  const [groupCtx, setGroupCtx] = useState<{
    sectionId: string;
    x: number;
    y: number;
  } | null>(null);
  const groupCtxMenuRef = useRef<HTMLDivElement>(null);
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
          // 未分组为内置分组，搜索时也始终保留
          .filter((section) => section.feeds.length > 0 || section.isSystem)
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
    if (!editingGroupId) return;
    if (!groups.some((group) => group.id === editingGroupId)) {
      setEditingGroupId(null);
      setGroupRenameDraft("");
      setSavingGroupRenameId(null);
    }
  }, [groups, editingGroupId]);

  useEffect(() => {
    if (!groupCtx) return;
    function handleClose(event: MouseEvent) {
      const target = event.target as Node;
      if (groupCtxMenuRef.current?.contains(target)) return;
      setGroupCtx(null);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setGroupCtx(null);
    }
    function handleScroll() {
      setGroupCtx(null);
    }
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [groupCtx]);

  useEffect(() => {
    if (!groupCtx || !groupCtxMenuRef.current) return;
    const menu = groupCtxMenuRef.current;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(groupCtx.x, window.innerWidth - rect.width - 8);
    const top = Math.min(groupCtx.y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }, [groupCtx]);

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
    const hasGroupActions = feedIds.length > 0 && Boolean(onRefreshGroup);
    const scoped = scopedGroupIds?.has(section.id) ?? false;
    const inSchedule = !section.isSystem && (scheduledGroupIds?.has(section.id) ?? false);
    const alarmTitle =
      scheduleHintByGroupId?.[section.id] ||
      (inSchedule
        ? "已加入定时"
        : onOpenSchedule
          ? "未加入任何定时（组行右键 → 设置定时）"
          : "");
    const groupRefreshing =
      refreshingGroupId === section.id || loadingBodiesGroupId === section.id;
    const renamingThis = editingGroupId === section.id;

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
            isExpanded || isActiveGroup || scoped
              ? "bg-[color-mix(in_srgb,var(--paper)_70%,transparent)]"
              : ""
          }`}
          onContextMenu={(event) => {
            if (!canGroupContextMenu || renamingThis) return;
            event.preventDefault();
            event.stopPropagation();
            setGroupCtx({
              sectionId: section.id,
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          {canManageLayout && !section.isSystem ? (
            <button
              type="button"
              draggable
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(event) => {
                setDragData(event, { kind: "group", groupId: section.id });
              }}
              onDragEnd={handleDragEnd}
              aria-label="拖动调整分组顺序"
              className="flex w-4 shrink-0 cursor-grab items-center justify-center rounded py-1 text-xs text-[var(--ink-muted)] opacity-0 hover:text-[var(--ink)] group-hover/section:opacity-100 active:cursor-grabbing"
            >
              ⠿
            </button>
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
          {onToggleGroupScope && feedIds.length > 0 ? (
            <input
              type="checkbox"
              className="mx-0.5 shrink-0"
              checked={scoped}
              aria-label={`选中 ${section.name} 参与更新与索引`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggleGroupScope(section.id, e.target.checked)}
            />
          ) : null}
          {renamingThis ? (
            <div className="flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5">
              <input
                autoFocus
                value={groupRenameDraft}
                disabled={savingGroupRenameId === section.id}
                aria-label="分组名称"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setGroupRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitGroupRename(section.id);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingGroupId(null);
                    setGroupRenameDraft("");
                  }
                }}
                className="min-w-0 flex-1 rounded border border-[var(--rule)] px-2 py-1 text-[12px] font-semibold"
              />
              <button
                type="button"
                disabled={savingGroupRenameId === section.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void commitGroupRename(section.id);
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--success)] hover:bg-[var(--success-soft)] disabled:opacity-50"
              >
                确认
              </button>
              <button
                type="button"
                disabled={savingGroupRenameId === section.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingGroupId(null);
                  setGroupRenameDraft("");
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-[var(--paper)] disabled:opacity-50"
              >
                取消
              </button>
            </div>
          ) : (
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
          )}
          {inSchedule ? (
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--accent)]"
              title={alarmTitle}
              aria-label={alarmTitle}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                <circle
                  cx="12"
                  cy="13"
                  r="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 10v3.5l2 1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M5.5 5.5l2.2 1.6M18.5 5.5l-2.2 1.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          ) : null}
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-[var(--ink-muted)]">
            {section.feeds.length}
          </span>
          <div
            className={`flex w-7 shrink-0 justify-end ${
              hasGroupActions
                ? isExpanded
                  ? "opacity-100"
                  : "opacity-0 group-hover/section:opacity-100"
                : "pointer-events-none opacity-0"
            }`}
          >
            {hasGroupActions ? (
              <button
                type="button"
                disabled={refreshActionDisabled}
                title={`更新本组源信息（${formatDaysLabel(days)}）`}
                aria-label={`刷新 ${section.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshGroup?.(section.id, section.name, feedIds);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-sm text-[var(--ink-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                {groupRefreshing ? "…" : "↻"}
              </button>
            ) : (
              <span className="inline-block w-6" aria-hidden />
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

  async function commitGroupRename(groupId: string) {
    if (!onRenameGroup) return;
    const nextName = groupRenameDraft.trim();
    const current = groups.find((group) => group.id === groupId);
    if (!current || !nextName || nextName === current.name) {
      setEditingGroupId(null);
      setGroupRenameDraft("");
      return;
    }
    setSavingGroupRenameId(groupId);
    try {
      await onRenameGroup(groupId, nextName);
      setEditingGroupId(null);
      setGroupRenameDraft("");
    } finally {
      setSavingGroupRenameId(null);
    }
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
    {
      label: refreshingAll || loadingBodies ? "更新中…" : "更新全部",
      disabled: feeds.length === 0 || refreshActionDisabled,
      onClick: onRefreshAll,
    },
  ];

  const groupCtxSection = groupCtx
    ? (filteredSections.find((section) => section.id === groupCtx.sectionId) ??
      sections.find((section) => section.id === groupCtx.sectionId) ??
      null)
    : null;

  const groupCtxItems: MenuItem[] = groupCtxSection
    ? [
        ...(onRenameGroup && !groupCtxSection.isSystem
          ? [
              {
                label: "重命名",
                onClick: () => {
                  setEditingFeedId(null);
                  setRenameDraft("");
                  setEditingGroupId(groupCtxSection.id);
                  setGroupRenameDraft(groupCtxSection.name);
                },
              },
            ]
          : onRenameGroup
            ? [{ label: "重命名", disabled: true }]
            : []),
        ...(onAddSource
          ? [
              {
                label: "添加源",
                onClick: () => onAddSource(groupCtxSection.id),
              },
            ]
          : []),
        ...(onOpenSchedule && !groupCtxSection.isSystem
          ? [
              {
                label: "设置定时",
                onClick: () => onOpenSchedule(groupCtxSection.id),
              },
            ]
          : onOpenSchedule
            ? [{ label: "设置定时", disabled: true }]
            : []),
        ...(groupCtxSection.isSystem
          ? onClearUngrouped
            ? [
                {
                  label: "清空",
                  danger: true,
                  disabled: groupCtxSection.feeds.length === 0,
                  onClick: () =>
                    onClearUngrouped(groupCtxSection.feeds.map((feed) => feed.id)),
                },
              ]
            : []
          : onDeleteGroup
            ? [
                {
                  label: "删除分组",
                  danger: true,
                  onClick: () =>
                    onDeleteGroup({
                      id: groupCtxSection.id,
                      name: groupCtxSection.name,
                      feedIds: groupCtxSection.feeds.map((feed) => feed.id),
                    }),
                },
              ]
            : []),
      ]
    : [];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper-raised)]">
      <div className="shrink-0 border-b border-[var(--rule)] px-3 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold tracking-tight text-[var(--ink)]">订阅</h1>
              {onAddSource ? (
                <button
                  type="button"
                  onClick={() => onAddSource()}
                  title="添加源"
                  aria-label="添加源"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper)] text-base leading-none text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                >
                  +
                </button>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
              {loading ? "加载中…" : `${feeds.length} 个源`}
            </p>
          </div>
          {onManageGroups ? (
            <button
              type="button"
              onClick={onManageGroups}
              className="rounded-[var(--radius-control)] border border-[var(--rule)] bg-[var(--paper-raised)] px-2 py-1 text-xs text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              管理分组
            </button>
          ) : libraryMenuItems.length > 0 ? (
            <OverflowMenu items={libraryMenuItems} label="订阅操作" />
          ) : null}
        </div>

        <div className="mt-2.5">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索…"
            className="ui-input w-full text-xs placeholder:text-[var(--ink-muted)]"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 px-3 py-4" aria-busy="true" aria-label="加载订阅">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-8 animate-pulse rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--rule)_70%,white)]"
              style={{ opacity: 1 - index * 0.08 }}
            />
          ))}
        </div>
      ) : filteredSections.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--ink-muted)]">没有匹配的数据源</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="space-y-0.5">
            {filteredSections.map((section) => renderGroupHeader(section))}
          </div>
        </div>
      )}

      {groupCtx && groupCtxItems.length > 0
        ? createPortal(
            <div
              ref={groupCtxMenuRef}
              role="menu"
              style={{ left: groupCtx.x, top: groupCtx.y }}
              className="fixed z-[80] min-w-[9.5rem] rounded-md border border-[var(--rule)] bg-[var(--paper-raised)] py-1 shadow-lg"
            >
              {groupCtxItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setGroupCtx(null);
                    item.onClick?.();
                  }}
                  className={menuItemClass(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
