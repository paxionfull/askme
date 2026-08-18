import type { Meta, StoryObj } from "@storybook/react";
import FeedSchedulerSection from "../../components/FeedSchedulerSection";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";

function FeedSchedulerGallery() {
  const { locale } = useLocale();
  const isZh = locale === "zh";

  return (
    <div>
      <CatalogHeader
        titleZh="定时更新"
        titleEn="Schedules"
        appearsZh="设置 → 定时"
        appearsEn="Settings → Schedule"
        noteZh="API 已 mock：已有定时 / 空列表 / 加载中。"
        noteEn="API mocked: populated / empty / loading."
      />
      <div className="grid gap-4">
        <SampleCard label={isZh ? "已有定时（主态）" : "Populated (primary)"}>
          <div className="p-3">
            <FeedSchedulerSection />
          </div>
        </SampleCard>
      </div>
    </div>
  );
}

function EmptyScheduler() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  return (
    <div>
      <CatalogHeader
        titleZh="定时更新 · 空"
        titleEn="Schedules · empty"
        appearsZh="设置 → 定时"
        appearsEn="Settings → Schedule"
      />
      <SampleCard label={isZh ? "无定时" : "Empty"}>
        <div className="p-3">
          <FeedSchedulerSection />
        </div>
      </SampleCard>
    </div>
  );
}

function LoadingScheduler() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  return (
    <div>
      <CatalogHeader
        titleZh="定时更新 · 加载中"
        titleEn="Schedules · loading"
        appearsZh="设置 → 定时"
        appearsEn="Settings → Schedule"
      />
      <SampleCard label={isZh ? "加载中" : "Loading"}>
        <div className="p-3">
          <FeedSchedulerSection />
        </div>
      </SampleCard>
    </div>
  );
}

const meta = {
  title: "Settings/FeedScheduler",
  parameters: {
    catalogApi: { scheduler: "populated" },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Populated: Story = {
  render: () => <FeedSchedulerGallery />,
};

export const Empty: Story = {
  parameters: { catalogApi: { scheduler: "empty" } },
  render: () => <EmptyScheduler />,
};

export const Loading: Story = {
  parameters: { catalogApi: { scheduler: "loading" } },
  render: () => <LoadingScheduler />,
};
