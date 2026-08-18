import type { Meta, StoryObj } from "@storybook/react";
import HelpModal from "../../components/HelpModal";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function HelpPreview() {
  return (
    <div>
      <CatalogHeader
        titleZh="帮助"
        titleEn="Help"
        appearsZh="侧栏「帮助」"
        appearsEn="Sidebar Help"
      />
      <FakeAppShell activeNav="brief" heightClassName="h-[36rem]">
        <HelpModal open onClose={noop} />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Overlay/HelpModal",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <HelpPreview />,
};
