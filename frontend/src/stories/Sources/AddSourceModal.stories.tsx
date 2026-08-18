import type { Meta, StoryObj } from "@storybook/react";
import AddSourceModal from "../../components/AddSourceModal";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop, SAMPLE_GROUPS } from "../_fixtures/catalog";

function AddSourcePreview() {
  return (
    <div>
      <CatalogHeader
        titleZh="添加源"
        titleEn="Add source"
        appearsZh="Sources「添加源」"
        appearsEn="Sources → Add source"
        noteZh="默认打开；链接接入 / 导入 skill 表单。"
        noteEn="Open by default; link / import skill form."
      />
      <FakeAppShell activeNav="sources" heightClassName="h-[40rem]">
        <AddSourceModal open onClose={noop} groups={SAMPLE_GROUPS} defaultGroupId="group-ai" />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Sources/AddSourceModal",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <AddSourcePreview />,
};
