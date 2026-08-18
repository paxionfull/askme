import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import DaysRangeSelect from "../../components/DaysRangeSelect";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";

function DaysRangeGallery() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [days, setDays] = useState<1 | 3>(1);

  return (
    <div>
      <CatalogHeader
        titleZh="时间范围"
        titleEn="Date range"
        appearsZh="Brief / Sources 时间范围选择"
        appearsEn="Brief / Sources date range"
      />
      <div className="flex flex-wrap gap-4">
        <SampleCard label={isZh ? "中等" : "Medium"}>
          <div className="p-4">
            <DaysRangeSelect value={days} onChange={setDays} size="md" />
          </div>
        </SampleCard>
        <SampleCard label={isZh ? "小号" : "Small"}>
          <div className="p-4">
            <DaysRangeSelect value={days} onChange={setDays} size="sm" />
          </div>
        </SampleCard>
        <SampleCard label={isZh ? "禁用" : "Disabled"}>
          <div className="p-4">
            <DaysRangeSelect value={days} onChange={setDays} disabled />
          </div>
        </SampleCard>
      </div>
    </div>
  );
}

const meta = {
  title: "Other/DaysRangeSelect",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllStates: Story = {
  render: () => <DaysRangeGallery />,
};
