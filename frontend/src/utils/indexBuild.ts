import type { Locale } from "../i18n/locale";
import { formatMessage } from "../i18n/messages";

/** 向量索引固定按近 3 天维护，与 DigestContext.buildIndex 一致。 */
export const INDEX_RETENTION_DAYS = 3;

export function formatIndexBuildConfirmMessage(
  locale: Locale,
  params: {
    scopeLabel: string;
    articleCount: number | null;
    metaCount?: number;
    previewFailed?: boolean;
  },
): string {
  const range = formatMessage(locale, "indexBuildRangeLabel", { days: INDEX_RETENTION_DAYS });
  const scope = params.scopeLabel.trim() || formatMessage(locale, "indexBuildScopeFallback", {});

  if (params.previewFailed || params.articleCount === null) {
    return [
      formatMessage(locale, "indexBuildPreviewFailedLine1", { scope, range }),
      formatMessage(locale, "indexBuildPreviewFailedLine2", {}),
    ].join("\n");
  }

  if (params.articleCount === 0) {
    const metaHint =
      params.metaCount != null && params.metaCount > 0
        ? formatMessage(locale, "indexBuildEmptyMetaHint", { metaCount: params.metaCount })
        : "";
    return [
      formatMessage(locale, "indexBuildEmptyLine1", { scope, range, metaHint }),
      formatMessage(locale, "indexBuildEmptyLine2", {}),
    ].join("\n");
  }

  return [
    formatMessage(locale, "indexBuildWithCountLine1", {
      scope,
      range,
      count: params.articleCount,
    }),
    formatMessage(locale, "indexBuildWithCountLine2", {}),
  ].join("\n");
}
