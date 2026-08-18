import type { Meta, StoryObj } from "@storybook/react";
import GroupScheduleModal from "../../components/GroupScheduleModal";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function GroupSchedulePreview() {
  return (
    <div>
      <CatalogHeader
        titleZh="分组定时"
        titleEn="Group schedule"
        appearsZh="Sources 分组菜单「设置定时」"
        appearsEn="Sources group menu → Schedule"
        noteZh="API 已 mock，无需后端。"
        noteEn="API mocked — no backend required."
      />
      <FakeAppShell activeNav="sources" heightClassName="h-[36rem]">
        <GroupScheduleModal open groupId="group-ai" groupName="ai" onClose={noop} />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Sources/GroupScheduleModal",
  parameters: {
    catalogApi: { scheduler: "populated" },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <GroupSchedulePreview />,
};
