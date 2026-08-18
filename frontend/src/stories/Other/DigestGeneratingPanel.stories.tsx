import type { Meta, StoryObj } from "@storybook/react";
import DigestGeneratingPanel from "../../components/DigestGeneratingPanel";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";

function DigestGeneratingGallery() {
  const { t, locale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div>
      <CatalogHeader
        titleZh="生成进度"
        titleEn="Digest progress"
        appearsZh="Brief 生成过程中的进度面板"
        appearsEn="In-brief digest generation progress"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SampleCard label={isZh ? "分类中" : "Classify"}>
          <div className="p-3">
            <DigestGeneratingPanel phase="classify" message={t("generatingDigestMessage")} />
          </div>
        </SampleCard>
        <SampleCard label={isZh ? "渲染 · 有预览" : "Render · with preview"}>
          <div className="p-3">
            <DigestGeneratingPanel
              phase="render"
              message={isZh ? "正在渲染简报…" : "Rendering digest…"}
              hasPreview
            />
          </div>
        </SampleCard>
      </div>
    </div>
  );
}

const meta = {
  title: "Other/DigestGeneratingPanel",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllStates: Story = {
  render: () => <DigestGeneratingGallery />,
};
