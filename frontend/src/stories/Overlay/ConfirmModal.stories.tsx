import type { Meta, StoryObj } from "@storybook/react";
import ConfirmModal from "../../components/ConfirmModal";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";
import FakeAppShell from "../_decorators/FakeAppShell";
import { noop } from "../_fixtures/catalog";

function ConfirmGallery() {
  const { t, locale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div>
      <CatalogHeader
        titleZh="确认框"
        titleEn="Confirm"
        appearsZh="删除源 / 删除分组 / 重新生成简报"
        appearsEn="Delete source / delete group / regenerate brief"
        noteZh="默认 / 危险 / 加载中三态并列展示。"
        noteEn="Default / danger / loading side by side."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SampleCard label={isZh ? "默认" : "Default"}>
          <FakeAppShell heightClassName="h-[22rem]" activeNav="brief">
            <ConfirmModal
              open
              title={isZh ? "重新生成简报？" : "Regenerate brief?"}
              message={
                isZh
                  ? "将覆盖当前板块与时间范围内的简报。"
                  : "This replaces the current brief for this group and date range."
              }
              onConfirm={noop}
              onCancel={noop}
            />
          </FakeAppShell>
        </SampleCard>
        <SampleCard label={isZh ? "危险操作" : "Danger"}>
          <FakeAppShell heightClassName="h-[22rem]" activeNav="sources">
            <ConfirmModal
              open
              title={isZh ? "删除源？" : "Delete source?"}
              message={isZh ? "从 Askme 中移除该源？" : "Remove this source from Askme?"}
              danger
              confirmLabel={t("delete")}
              extraContent={
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <input type="checkbox" defaultChecked={false} readOnly />
                  {isZh ? "同时删除关联 skill" : "Also remove linked skill"}
                </label>
              }
              onConfirm={noop}
              onCancel={noop}
            />
          </FakeAppShell>
        </SampleCard>
        <SampleCard label={isZh ? "加载中" : "Loading"}>
          <FakeAppShell heightClassName="h-[22rem]" activeNav="sources">
            <ConfirmModal
              open
              title={isZh ? "删除分组？" : "Delete group?"}
              message={isZh ? "将同时删除组内的源。" : "This also deletes sources in the group."}
              danger
              loading
              onConfirm={noop}
              onCancel={noop}
            />
          </FakeAppShell>
        </SampleCard>
      </div>
    </div>
  );
}

const meta = {
  title: "Overlay/ConfirmModal",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const AllStates: Story = {
  render: () => <ConfirmGallery />,
};
