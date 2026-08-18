import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import SkillMarkdownModal from "../../components/SkillMarkdownModal";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function SkillMarkdownPreview() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [document, setDocument] = useState("# Fixture document\n\nEditable markdown for catalog.");

  return (
    <div>
      <CatalogHeader
        titleZh="Skill 文档"
        titleEn="Skill document"
        appearsZh="Skill Markdown 编辑 / 预览"
        appearsEn="Skill markdown editor"
      />
      <FakeAppShell activeNav="settings" heightClassName="h-[40rem]">
        <SkillMarkdownModal
          open
          title={isZh ? "编辑文档" : "Edit document"}
          path="skills/demo/SKILL.md"
          document={document}
          onDocumentChange={setDocument}
          skillId="demo-skill"
          onClose={noop}
          onSave={noop}
        />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Settings/SkillMarkdown",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <SkillMarkdownPreview />,
};
