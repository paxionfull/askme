import type { Meta, StoryObj } from "@storybook/react";
import SkillDetailModal from "../../components/SkillDetailModal";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop, SAMPLE_SKILL_DETAIL } from "../_fixtures/catalog";

function SkillDetailGallery() {
  const { locale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div>
      <CatalogHeader
        titleZh="Skill 详情"
        titleEn="Skill detail"
        appearsZh="设置 Skills「查看」"
        appearsEn="Settings → Skills → View"
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SampleCard label={isZh ? "主态" : "Loaded"}>
          <FakeAppShell activeNav="settings" heightClassName="h-[32rem]">
            <SkillDetailModal
              open
              title="36kr"
              loading={false}
              error=""
              detail={SAMPLE_SKILL_DETAIL}
              deletable
              repairable
              onClose={noop}
              onDelete={noop}
              onRepair={noop}
            />
          </FakeAppShell>
        </SampleCard>
        <SampleCard label={isZh ? "加载中" : "Loading"}>
          <FakeAppShell activeNav="settings" heightClassName="h-[32rem]">
            <SkillDetailModal
              open
              title="36kr"
              loading
              error=""
              detail={null}
              onClose={noop}
            />
          </FakeAppShell>
        </SampleCard>
        <SampleCard label={isZh ? "错误" : "Error"}>
          <FakeAppShell activeNav="settings" heightClassName="h-[32rem]">
            <SkillDetailModal
              open
              title="36kr"
              loading={false}
              error={isZh ? "加载失败（fixture）" : "Failed to load (fixture)"}
              detail={null}
              onClose={noop}
            />
          </FakeAppShell>
        </SampleCard>
      </div>
    </div>
  );
}

const meta = {
  title: "Settings/SkillDetail",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllStates: Story = {
  render: () => <SkillDetailGallery />,
};
