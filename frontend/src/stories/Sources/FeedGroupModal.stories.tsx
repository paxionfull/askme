import type { Meta, StoryObj } from "@storybook/react";
import FeedGroupModal from "../../components/FeedGroupModal";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop, noopAsync, SAMPLE_FEEDS, SAMPLE_GROUPS } from "../_fixtures/catalog";

function FeedGroupPreview() {
  return (
    <div>
      <CatalogHeader
        titleZh="管理分组"
        titleEn="Manage groups"
        appearsZh="Sources「管理分组」"
        appearsEn="Sources → Manage groups"
      />
      <FakeAppShell activeNav="sources" heightClassName="h-[40rem]">
        <FeedGroupModal
          open
          feeds={SAMPLE_FEEDS}
          groups={SAMPLE_GROUPS}
          onClose={noop}
          onSave={noopAsync}
          onDeleteFeeds={noopAsync}
        />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Sources/FeedGroupModal",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <FeedGroupPreview />,
};
