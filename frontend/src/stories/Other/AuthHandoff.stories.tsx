import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import AuthHandoffPanel from "../../components/AuthHandoffPanel";
import { useLocale } from "../../i18n/LocaleContext";
import { CatalogHeader, SampleCard } from "../_decorators/CatalogChrome";
import { AUTH_ITEM, noop } from "../_fixtures/catalog";

function AuthIdle() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [cookieDraft, setCookieDraft] = useState("");

  return (
    <div>
      <CatalogHeader
        titleZh="登录授权"
        titleEn="Auth"
        appearsZh="设置登录 Cookie / 接入失败时的授权面板"
        appearsEn="Settings credentials / onboarding auth handoff"
        noteZh="默认不自动开始登录；「打开登录」走 mock API，不打真后端。"
        noteEn="Does not auto-start login; Open login uses mocked API."
      />
      <SampleCard label={isZh ? "主态 · 粘贴 Cookie" : "Idle · paste cookie"}>
        <div className="p-3">
          <AuthHandoffPanel
            item={AUTH_ITEM}
            cookieDraft={cookieDraft}
            onCookieChange={setCookieDraft}
            onSaved={noop}
            onCancel={noop}
            title={isZh ? "演示授权" : "Demo auth"}
          />
        </div>
      </SampleCard>
    </div>
  );
}

function AuthWaiting() {
  const { locale } = useLocale();
  const isZh = locale === "zh";
  const [cookieDraft, setCookieDraft] = useState("");

  return (
    <div>
      <CatalogHeader
        titleZh="登录授权 · 等待登录"
        titleEn="Auth · waiting"
        appearsZh="设置 / 接入失败授权"
        appearsEn="Settings / onboarding auth"
        noteZh="autoStart + mock login-session → waiting_login。"
        noteEn="autoStart + mocked login-session → waiting_login."
      />
      <SampleCard label={isZh ? "等待浏览器登录" : "Waiting for browser login"}>
        <div className="p-3">
          <AuthHandoffPanel
            item={AUTH_ITEM}
            cookieDraft={cookieDraft}
            onCookieChange={setCookieDraft}
            onSaved={noop}
            onCancel={noop}
            autoStart
            title={isZh ? "演示授权" : "Demo auth"}
          />
        </div>
      </SampleCard>
    </div>
  );
}

const meta = {
  title: "Other/AuthHandoff",
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Idle: Story = {
  render: () => <AuthIdle />,
};

export const WaitingLogin: Story = {
  render: () => <AuthWaiting />,
};
