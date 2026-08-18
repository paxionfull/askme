import type { Meta, StoryObj } from "@storybook/react";
import OverflowMenu from "../../components/OverflowMenu";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";
import { noop } from "../_fixtures/catalog";

function OverflowGallery() {
  const { locale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div>
      <CatalogHeader
        titleZh="下拉菜单"
        titleEn="Menus"
        appearsZh="Ask「⋯」、侧栏分组/源菜单"
        appearsEn="Ask ⋯ menu, Sources sidebar menus"
      />
      <div className="flex flex-wrap gap-4">
        <SampleCard label={isZh ? "对话选项" : "Chat options"}>
          <div className="p-4">
            <OverflowMenu
              label={isZh ? "对话选项" : "Chat options"}
              items={[
                { label: isZh ? "快捷键" : "Shortcuts", onClick: noop },
                { label: isZh ? "查看提示词" : "Prompt preview", onClick: noop },
                { label: isZh ? "清空对话" : "Clear chat", danger: true, onClick: noop },
              ]}
            />
          </div>
        </SampleCard>
        <SampleCard label={isZh ? "含禁用项" : "With disabled"}>
          <div className="p-4">
            <OverflowMenu
              label={isZh ? "含禁用项" : "With disabled"}
              items={[
                { label: isZh ? "可用" : "Enabled", onClick: noop },
                { label: isZh ? "不可用" : "Disabled", disabled: true },
              ]}
            />
          </div>
        </SampleCard>
      </div>
    </div>
  );
}

const meta = {
  title: "Overlay/OverflowMenu",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <OverflowGallery />,
};
