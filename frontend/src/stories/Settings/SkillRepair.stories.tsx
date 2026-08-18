import type { Meta, StoryObj } from "@storybook/react";
import SkillRepairModal from "../../components/SkillRepairModal";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function SkillRepairPreview() {
  return (
    <div>
      <CatalogHeader
        titleZh="修复反馈"
        titleEn="Skill repair"
        appearsZh="Skill「反馈与修复」"
        appearsEn="Skill → Feedback & repair"
      />
      <FakeAppShell activeNav="settings" heightClassName="h-[36rem]">
        <SkillRepairModal open skillName="36kr" skillId="36kr-discovery" onClose={noop} onSubmit={noop} />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Settings/SkillRepair",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <SkillRepairPreview />,
};

export const Busy: Story = {
  render: () => (
    <div>
      <CatalogHeader
        titleZh="修复反馈 · 提交中"
        titleEn="Skill repair · busy"
        appearsZh="Skill「反馈与修复」"
        appearsEn="Skill → Feedback & repair"
      />
      <FakeAppShell activeNav="settings" heightClassName="h-[36rem]">
        <SkillRepairModal
          open
          busy
          skillName="36kr"
          skillId="36kr-discovery"
          onClose={noop}
          onSubmit={noop}
        />
      </FakeAppShell>
    </div>
  ),
};
