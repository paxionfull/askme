import type { Preview } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import { DigestProvider } from "../src/contexts/DigestContext";
import { FeedRefreshProvider } from "../src/contexts/FeedRefreshContext";
import { OnboardingProvider } from "../src/contexts/OnboardingContext";
import { LocaleProvider } from "../src/i18n/LocaleContext";
import { writeStoredLocale, type Locale } from "../src/i18n/locale";
import { installCatalogApiMock, setCatalogApi } from "../src/stories/_mocks/apiHandlers";
import "../src/index.css";
import "./preview.css";

installCatalogApiMock();

const preview: Preview = {
  globalTypes: {
    locale: {
      name: "Locale",
      description: "UI language",
      defaultValue: "zh",
      toolbar: {
        icon: "globe",
        items: [
          { value: "zh", title: "中文" },
          { value: "en", title: "English" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: "padded",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ["Notify", "Overlay", "Sources", "Settings", "Other"],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const locale = (context.globals.locale as Locale) || "zh";
      writeStoredLocale(locale);
      setCatalogApi(context.parameters.catalogApi);
      return (
        <MemoryRouter>
          <LocaleProvider key={locale}>
            <OnboardingProvider>
              <FeedRefreshProvider>
                <DigestProvider>
                  <div className="min-h-[100%] bg-[var(--paper)] text-[var(--ink)] antialiased">
                    <Story />
                  </div>
                </DigestProvider>
              </FeedRefreshProvider>
            </OnboardingProvider>
          </LocaleProvider>
        </MemoryRouter>
      );
    },
  ],
};

export default preview;
