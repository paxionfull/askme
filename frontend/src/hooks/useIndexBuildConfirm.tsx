import { useCallback, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
import { fetchIndexBuildPreview } from "../api";
import { useDigest } from "../contexts/DigestContext";
import { isEmbeddingConfigured, useSettings } from "./useSettings";
import {
  INDEX_RETENTION_DAYS,
  formatIndexBuildConfirmMessage,
} from "../utils/indexBuild";
import { useLocale } from "../i18n/LocaleContext";

export interface IndexBuildRequest {
  feedIds?: string[];
  scopeLabel: string;
}

interface IndexBuildLinkProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function IndexBuildLink({ onClick, disabled, className }: IndexBuildLinkProps) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
    >
      {t("indexBuildLink")}
    </button>
  );
}

export function useIndexBuildConfirm() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { buildIndex, loadingIndex, digestBusy, clearErrors } = useDigest();
  const [open, setOpen] = useState(false);
  const [embedGuideOpen, setEmbedGuideOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [pending, setPending] = useState<IndexBuildRequest | null>(null);
  const [preview, setPreview] = useState<{ articleCount: number; metaCount: number } | null>(
    null,
  );
  const [previewFailed, setPreviewFailed] = useState(false);

  // 索引进行中禁止重复启动；正文/摘要 busy 时也先不抢资源
  const indexBuildBusy = loadingIndex || digestBusy;
  const embeddingConfigured = isEmbeddingConfigured(settings);

  const requestIndexBuild = useCallback(
    async (request: IndexBuildRequest) => {
      if (indexBuildBusy) return;
      if (!isEmbeddingConfigured(settings)) {
        setEmbedGuideOpen(true);
        return;
      }
      setPending(request);
      setOpen(true);
      setPreviewLoading(true);
      setPreview(null);
      setPreviewFailed(false);
      try {
        const scopedIds = (request.feedIds ?? []).map((id) => id.trim()).filter(Boolean);
        const data = await fetchIndexBuildPreview(
          INDEX_RETENTION_DAYS,
          scopedIds.length > 0 ? scopedIds : undefined,
        );
        setPreview({
          articleCount: data.article_count,
          metaCount: data.meta_count ?? 0,
        });
      } catch {
        setPreviewFailed(true);
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [indexBuildBusy, settings],
  );

  const cancel = useCallback(() => {
    if (confirmLoading) return;
    setOpen(false);
    setPending(null);
    setPreview(null);
    setPreviewFailed(false);
  }, [confirmLoading]);

  const confirm = useCallback(async () => {
    if (!pending || confirmLoading || previewLoading) return;
    setConfirmLoading(true);
    clearErrors();
    try {
      const scopedIds = (pending.feedIds ?? []).map((id) => id.trim()).filter(Boolean);
      // buildIndex 仅等待任务启动；完成后立即关弹窗，进度由顶部 banner 后台展示
      await buildIndex(scopedIds.length > 0 ? scopedIds : undefined);
      setOpen(false);
      setPending(null);
      setPreview(null);
      setPreviewFailed(false);
    } catch {
      // 启动失败时错误已由 DigestContext 写入 loadError，弹窗保持可关
    } finally {
      setConfirmLoading(false);
    }
  }, [pending, confirmLoading, previewLoading, buildIndex, clearErrors]);

  const confirmMessage = formatIndexBuildConfirmMessage(locale, {
    scopeLabel: pending?.scopeLabel ?? "",
    articleCount: previewFailed ? null : (preview?.articleCount ?? null),
    metaCount: preview?.metaCount,
    previewFailed,
  });

  const IndexBuildConfirmModal = (): ReactNode => (
    <>
      <ConfirmModal
        open={embedGuideOpen}
        title={t("indexEmbedTitle")}
        message={
          settings.embeddingModel.trim()
            ? t("indexEmbedMessageWithModel")
            : t("indexEmbedMessageNoModel")
        }
        confirmLabel={t("commonGoConfigure")}
        cancelLabel={t("close")}
        onConfirm={() => {
          setEmbedGuideOpen(false);
          navigate("/settings?tab=model");
        }}
        onCancel={() => setEmbedGuideOpen(false)}
      />
      <ConfirmModal
        open={open}
        title={t("indexBuildTitle")}
        message={previewLoading ? t("indexBuildPreviewLoading") : confirmMessage}
        confirmLabel={t("indexBuildConfirm")}
        loading={previewLoading || confirmLoading}
        onConfirm={() => void confirm()}
        onCancel={cancel}
      />
    </>
  );

  return {
    requestIndexBuild,
    IndexBuildConfirmModal,
    IndexBuildLink,
    indexBuildBusy,
    embeddingConfigured,
  };
}
