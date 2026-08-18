import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import DigestProfileModal from "../../components/DigestProfileModal";
import { useLocale } from "../../i18n/LocaleContext";
import { defaultDigestProfile } from "../../utils/digestProfile";
import { CatalogHeader } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function DigestProfilePreview() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [name, setName] = useState("AI_news");
  const [description, setDescription] = useState(
    isZh ? "结构化整理规则" : "Structured digest rule",
  );
  const [profile, setProfile] = useState(() => defaultDigestProfile());

  return (
    <div>
      <CatalogHeader
        titleZh="整理规则"
        titleEn="Digest rule"
        appearsZh="设置 Skills「新建 / 编辑整理规则」"
        appearsEn="Settings → Skills → New / edit digest rule"
      />
      <FakeAppShell activeNav="settings" heightClassName="h-[40rem]">
        <DigestProfileModal
          open
          title={isZh ? "新建整理规则" : "New digest rule"}
          skillId="custom-demo-digest"
          name={name}
          description={description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          profile={profile}
          onProfileChange={setProfile}
          onClose={noop}
          onSave={noop}
        />
      </FakeAppShell>
    </div>
  );
}

const meta = {
  title: "Settings/DigestProfileModal",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <DigestProfilePreview />,
};
