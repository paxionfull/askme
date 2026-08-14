/** 向量索引固定按近 3 天维护，与 DigestContext.buildIndex 一致。 */
export const INDEX_RETENTION_DAYS = 3;

export function formatIndexBuildConfirmMessage(params: {
  scopeLabel: string;
  articleCount: number | null;
  metaCount?: number;
  previewFailed?: boolean;
}): string {
  const rangeLabel = `近 ${INDEX_RETENTION_DAYS} 天`;
  const scope = params.scopeLabel.trim() || "所选范围";

  if (params.previewFailed || params.articleCount === null) {
    return [
      `将为「${scope}」${rangeLabel}范围内的文章建立向量索引。`,
      "这会消耗 Embedding API 额度，确认继续？",
    ].join("\n");
  }

  if (params.articleCount === 0) {
    const metaHint =
      params.metaCount != null && params.metaCount > 0
        ? `（列表共 ${params.metaCount} 篇，尚无已拉取正文的内容）`
        : "";
    return [
      `「${scope}」${rangeLabel}范围内当前没有可索引的文章${metaHint}。`,
      "仍要继续吗？",
    ].join("\n");
  }

  return [
    `将为「${scope}」${rangeLabel}内 ${params.articleCount} 篇有正文的文章建立向量索引。`,
    "这会消耗 Embedding API 额度，确认继续？",
  ].join("\n");
}
