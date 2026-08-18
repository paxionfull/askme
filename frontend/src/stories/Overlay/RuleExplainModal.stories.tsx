import type { Meta, StoryObj } from "@storybook/react";
import RuleExplainModal from "../../components/RuleExplainModal";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function RuleExplainPreview() {
  const { locale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div>
      <CatalogHeader
        titleZh="规则说明"
        titleEn="Rule explain"
        appearsZh="设置 / Brief「规则是什么」"
        appearsEn="Settings / Brief — what are rules"
      />
      <FakeAppShell activeNav="settings" heightClassName="h-[36rem]">
        <RuleExplainModal
          open
          onClose={noop}
          skills={[
            {
              id: "tech-longform-digest",
              name: "AI_news",
              description: isZh ? "结构化整理规则" : "Structured digest rule",
              skill_content: "",
              builtin: true,
            },
          ]}
        />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Overlay/RuleExplainModal",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <RuleExplainPreview />,
};
