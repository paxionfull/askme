import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import FeedSidebar from "../../components/FeedSidebar";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";
import {
  noop,
  SAMPLE_FEEDS,
  SAMPLE_GROUP_ORDER,
  SAMPLE_GROUPS,
} from "../_fixtures/catalog";

function FeedSidebarGallery() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [selectedFeedId, setSelectedFeedId] = useState("feed-a");
  const [scopedGroupIds, setScopedGroupIds] = useState(() => new Set(["group-ai"]));

  const sidebar = (loading: boolean) => (
    <div className="h-[28rem] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--paper-raised)]">
      <FeedSidebar
        feeds={SAMPLE_FEEDS}
        groups={SAMPLE_GROUPS}
        groupOrder={SAMPLE_GROUP_ORDER}
        selectedId={selectedFeedId}
        loading={loading}
        onSelect={setSelectedFeedId}
        onRefreshAll={noop}
        onRefreshGroup={noop}
        refreshingAll={false}
        onAddSource={noop}
        onManageGroups={noop}
        onRenameGroup={noop}
        onOpenSchedule={noop}
        onDeleteGroup={noop}
        onClearUngrouped={noop}
        onDeleteFeed={noop}
        onRenameFeed={noop}
        days={1}
        scopedGroupIds={scopedGroupIds}
        onToggleGroupScope={(groupId, checked) => {
          setScopedGroupIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(groupId);
            else next.delete(groupId);
            return next;
          });
        }}
        scheduledGroupIds={new Set(["group-ai"])}
        scheduleHintByGroupId={{ "group-ai": isZh ? "每天 08:00" : "Daily 08:00" }}
      />
    </div>
  );

  return (
    <div>
      <CatalogHeader
        titleZh="源侧栏"
        titleEn="Sources sidebar"
        appearsZh="Sources 左侧分组 / 源列表"
        appearsEn="Sources left rail"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SampleCard label={isZh ? "主态" : "Default"}>{sidebar(false)}</SampleCard>
        <SampleCard label={isZh ? "加载中" : "Loading"}>{sidebar(true)}</SampleCard>
      </div>
    </div>
  );
}

const meta = {
  title: "Sources/FeedSidebar",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllStates: Story = {
  render: () => <FeedSidebarGallery />,
};
