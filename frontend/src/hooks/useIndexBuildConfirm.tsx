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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
    >
      建立索引
    </button>
  );
}

export function useIndexBuildConfirm() {
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
      await buildIndex(scopedIds.length > 0 ? scopedIds : undefined);
      setOpen(false);
      setPending(null);
      setPreview(null);
      setPreviewFailed(false);
    } finally {
      setConfirmLoading(false);
    }
  }, [pending, confirmLoading, previewLoading, buildIndex, clearErrors]);

  const confirmMessage = formatIndexBuildConfirmMessage({
    scopeLabel: pending?.scopeLabel ?? "",
    articleCount: previewFailed ? null : (preview?.articleCount ?? null),
    metaCount: preview?.metaCount,
    previewFailed,
  });

  const IndexBuildConfirmModal = (): ReactNode => (
    <>
      <ConfirmModal
        open={embedGuideOpen}
        title="需要配置 Embedding"
        message={
          settings.embeddingModel.trim()
            ? "建立索引需要 Embedding API Key。请在设置 → API Key 中填写；若与对话模型同 provider，可留空并复用对话模型 Key。"
            : "建立索引需要 Embedding 模型与 API Key。请在设置 → API Key 中配置；若与对话模型同 provider，Embedding Key 可留空并复用对话模型 Key。"
        }
        confirmLabel="去配置"
        cancelLabel="关闭"
        onConfirm={() => {
          setEmbedGuideOpen(false);
          navigate("/settings?tab=model");
        }}
        onCancel={() => setEmbedGuideOpen(false)}
      />
      <ConfirmModal
        open={open}
        title="建立索引"
        message={previewLoading ? "正在统计可索引文章…" : confirmMessage}
        confirmLabel="确认建立"
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
