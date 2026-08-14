import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEEDS_NEED_RELOAD_KEY,
  ONBOARD_BATCH_MAX_SIZE,
  fetchFeeds,
  fetchSkillsCatalog,
  importDiscoverySkills,
  parseDiscoverySkillZip,
  parseOnboardUrls,
  precheckSourceAuth,
  type AuthPrecheckItem,
  type AuthPrecheckResult,
  type DiscoverySkillImportResult,
  type FeedGroup,
  type PlatformAccountImportPayload,
} from "../api";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";
import {
  parseSkillDirectoriesFromRelativeEntries,
  parsePlatformAccountsFromRelativeEntries,
  collectFilesFromDataTransfer,
  type ParsedSkillDirectory,
} from "../utils/skillDirectory";
import { useOnboarding } from "../contexts/OnboardingContext";
import AuthHandoffPanel from "./AuthHandoffPanel";

interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
  groups: FeedGroup[];
  defaultGroupId?: string;
  /** 失败重试时预填链接 */
  initialUrls?: string;
  /** skill 导入成功 */
  onImported?: (result: DiscoverySkillImportResult) => void;
}

function isAuthErrorMessage(message: string): boolean {
  const text = (message || "").toLowerCase();
  if (!text) return false;
  // 不要用具体站点/平台名做匹配：普通接入错误也会带这些字样
  return (
    text.includes("askme_auth_required") ||
    text.includes("needs_auth") ||
    text.includes("cookie") ||
    text.includes("授权") ||
    text.includes("未登录") ||
    text.includes("请先登录") ||
    text.includes("需要登录") ||
    text.includes("访客态") ||
    text.includes("重新登录")
  );
}

export default function AddSourceModal({
  open,
  onClose,
  groups,
  defaultGroupId = UNGROUPED_GROUP_ID,
  initialUrls = "",
  onImported,
}: AddSourceModalProps) {
  const { job, startBatchOnboarding } = useOnboarding();
  const [siteUrls, setSiteUrls] = useState("");
  const [groupId, setGroupId] = useState<string>(defaultGroupId);
  const [localError, setLocalError] = useState("");
  const [precheck, setPrecheck] = useState<AuthPrecheckResult | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const [authCookies, setAuthCookies] = useState<Record<string, string>>({});
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<"url" | "import">("url");
  const [importSkills, setImportSkills] = useState<ParsedSkillDirectory[]>([]);
  const [importPlatformAccounts, setImportPlatformAccounts] = useState<PlatformAccountImportPayload[]>([]);
  const [importError, setImportError] = useState("");
  const [importConflict, setImportConflict] = useState(false);
  const [overwriteImport, setOverwriteImport] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsingImport, setParsingImport] = useState(false);
  const [knownDiscoverySkillIds, setKnownDiscoverySkillIds] = useState<Set<string>>(new Set());
  const [knownPlatformFeedIds, setKnownPlatformFeedIds] = useState<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);

  const parsedUrls = useMemo(() => parseOnboardUrls(siteUrls), [siteUrls]);
  // 接入 batch 进行中仍可继续提交（后端合并进同一并发池）；仅修复中禁用
  const busy = Boolean(job?.running);

  const missingAuthItems = useMemo(() => {
    const bySlot = new Map<string, AuthPrecheckItem>();
    for (const item of precheck?.items ?? []) {
      if (item.requires_auth && !item.configured && item.slot) {
        bySlot.set(item.slot, item);
      }
    }
    return [...bySlot.values()];
  }, [precheck]);

  const blockedByAuth = missingAuthItems.length > 0;

  const validImportSkills = useMemo(
    () => importSkills.filter((skill) => !skill.error),
    [importSkills],
  );

  const importMetaError = useMemo(() => {
    if (importSkills.length === 0) return "";
    const firstError = importSkills.find((skill) => skill.error)?.error;
    return firstError || "";
  }, [importSkills]);

  const conflictingSkills = useMemo(
    () => validImportSkills.filter((skill) => knownDiscoverySkillIds.has(skill.skillId)),
    [knownDiscoverySkillIds, validImportSkills],
  );

  const conflictingPlatformAccounts = useMemo(
    () => importPlatformAccounts.filter((account) => knownPlatformFeedIds.has(account.feed_id)),
    [importPlatformAccounts, knownPlatformFeedIds],
  );

  const hasImportConflict =
    conflictingSkills.length > 0 || conflictingPlatformAccounts.length > 0;

  const refreshPrecheck = useCallback(async (urls: string[]) => {
    if (urls.length === 0) {
      setPrecheck(null);
      return null;
    }
    const refreshed = await precheckSourceAuth(urls);
    setPrecheck(refreshed);
    return refreshed;
  }, []);

  const applyImportPackage = useCallback(
    (skills: ParsedSkillDirectory[], platformAccounts: PlatformAccountImportPayload[]) => {
      if (skills.length === 0 && platformAccounts.length === 0) {
        setImportSkills([]);
        setImportPlatformAccounts([]);
        setImportError("未识别到有效的 skill 或平台账号，请拖入或选择 zip / *-discovery 目录");
        return;
      }
      setImportSkills(skills);
      setImportPlatformAccounts(platformAccounts);
      setImportError("");
    },
    [],
  );

  const loadImportFromZipFiles = useCallback(async (zipFiles: File[]) => {
    const parsed: ParsedSkillDirectory[] = [];
    const platformAccounts: PlatformAccountImportPayload[] = [];
    for (const zipFile of zipFiles) {
      const pkg = await parseDiscoverySkillZip(zipFile);
      for (const skill of pkg.skills) {
        parsed.push({
          skillId: skill.skill_id,
          slug: skill.slug || skill.skill_id.replace(/-discovery$/, ""),
          feedId: skill.feed_id || `website:${(skill.slug || skill.skill_id).replace(/-discovery$/, "")}`,
          name: skill.name || skill.skill_id,
          files: skill.files,
        });
      }
      platformAccounts.push(...pkg.platform_accounts);
    }
    applyImportPackage(
      parsed.sort((a, b) => a.skillId.localeCompare(b.skillId)),
      platformAccounts.sort((a, b) => a.feed_id.localeCompare(b.feed_id)),
    );
  }, [applyImportPackage]);

  const loadImportPayload = useCallback(
    async (payload: FileList | Awaited<ReturnType<typeof collectFilesFromDataTransfer>>) => {
      if (!payload || (payload instanceof FileList && payload.length === 0)) {
        setImportSkills([]);
        setImportPlatformAccounts([]);
        setImportError("");
        return;
      }

      setParsingImport(true);
      setImportError("");
      try {
        if (payload instanceof FileList) {
          const zipFiles = Array.from(payload).filter((file) => /\.zip$/i.test(file.name));
          if (zipFiles.length > 0) {
            await loadImportFromZipFiles(zipFiles);
            return;
          }
          const dirEntries = Array.from(payload).flatMap((file) => {
            if (!file) return [];
            const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
            return [{ relPath, file }];
          });
          applyImportPackage(
            await parseSkillDirectoriesFromRelativeEntries(dirEntries),
            await parsePlatformAccountsFromRelativeEntries(dirEntries),
          );
          return;
        }

        const zipFiles = payload
          .filter((entry) => /\.zip$/i.test(entry.relPath.split("/").pop() || entry.file.name))
          .map((entry) => entry.file);
        const dirEntries = payload.filter(
          (entry) => !/\.zip$/i.test(entry.relPath.split("/").pop() || entry.file.name),
        );

        const parsed: ParsedSkillDirectory[] = [];
        const platformAccounts: PlatformAccountImportPayload[] = [];
        if (zipFiles.length > 0) {
          for (const zipFile of zipFiles) {
            const pkg = await parseDiscoverySkillZip(zipFile);
            for (const skill of pkg.skills) {
              parsed.push({
                skillId: skill.skill_id,
                slug: skill.slug || skill.skill_id.replace(/-discovery$/, ""),
                feedId: skill.feed_id || `website:${(skill.slug || skill.skill_id).replace(/-discovery$/, "")}`,
                name: skill.name || skill.skill_id,
                files: skill.files,
              });
            }
            platformAccounts.push(...pkg.platform_accounts);
          }
        }
        if (dirEntries.length > 0) {
          parsed.push(...(await parseSkillDirectoriesFromRelativeEntries(dirEntries)));
          platformAccounts.push(...(await parsePlatformAccountsFromRelativeEntries(dirEntries)));
        }
        applyImportPackage(
          parsed.sort((a, b) => a.skillId.localeCompare(b.skillId)),
          platformAccounts.sort((a, b) => a.feed_id.localeCompare(b.feed_id)),
        );
      } catch (err) {
        setImportSkills([]);
        setImportPlatformAccounts([]);
        setImportError(err instanceof Error ? err.message : "解析 skill 失败");
      } finally {
        setParsingImport(false);
      }
    },
    [applyImportPackage, loadImportFromZipFiles],
  );

  const handleImportPick = useCallback(() => {
    if (parsingImport || importing) return;
    importInputRef.current?.click();
  }, [importing, parsingImport]);

  const handleImportDrop = useCallback(
    async (dataTransfer: DataTransfer) => {
      const payload = await collectFilesFromDataTransfer(dataTransfer);
      await loadImportPayload(payload);
    },
    [loadImportPayload],
  );

  useEffect(() => {
    if (!open) return;
    setGroupId(defaultGroupId || UNGROUPED_GROUP_ID);
    setLocalError("");
    setPrecheck(null);
    setAuthCookies({});
    setSavingSlot(null);
    setMode("url");
    setImportSkills([]);
    setImportPlatformAccounts([]);
    setImportError("");
    setImportConflict(false);
    setOverwriteImport(false);
    setDragOver(false);
    setImporting(false);
    setParsingImport(false);
    if (initialUrls.trim()) {
      setSiteUrls(initialUrls.trim());
    }
  }, [open, defaultGroupId, initialUrls]);

  useEffect(() => {
    if (!open) return;
    void Promise.all([fetchSkillsCatalog(), fetchFeeds()])
      .then(([catalog, feedsData]) => {
        const ids = new Set<string>();
        for (const item of catalog.discovery || []) {
          const raw = (item.id || "").trim();
          if (!raw) continue;
          ids.add(raw);
          ids.add(raw.endsWith("-discovery") ? raw : `${raw}-discovery`);
        }
        setKnownDiscoverySkillIds(ids);
        const platformIds = new Set<string>();
        for (const feed of feedsData.feeds || []) {
          if (feed.platform_account) platformIds.add(feed.id);
        }
        setKnownPlatformFeedIds(platformIds);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    setImportError(importMetaError);
    setImportConflict(hasImportConflict);
    if (!hasImportConflict) setOverwriteImport(false);
  }, [hasImportConflict, importMetaError]);

  useEffect(() => {
    if (!open) return;
    if (parsedUrls.length === 0) {
      setPrecheck(null);
      setPrecheckLoading(false);
      return;
    }

    let cancelled = false;
    let requestStarted = false;
    const timer = window.setTimeout(() => {
      requestStarted = true;
      setPrecheckLoading(true);
      void precheckSourceAuth(parsedUrls)
        .then((result) => {
          if (!cancelled) setPrecheck(result);
        })
        .catch((err) => {
          if (!cancelled) {
            setPrecheck(null);
            setLocalError(err instanceof Error ? err.message : "授权预检失败");
          }
        })
        .finally(() => {
          if (!cancelled) setPrecheckLoading(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // 取消进行中的预检时清掉 loading，避免按钮一直灰掉
      if (requestStarted) {
        setPrecheckLoading(false);
      }
    };
  }, [open, parsedUrls]);

  if (!open) return null;

  async function handleAuthSaved(slot: string) {
    setSavingSlot(slot);
    setLocalError("");
    try {
      setAuthCookies((current) => ({ ...current, [slot]: "" }));
      await refreshPrecheck(parseOnboardUrls(siteUrls));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "刷新授权状态失败");
    } finally {
      setSavingSlot(null);
    }
  }

  async function handleStartUrl() {
    const urls = parseOnboardUrls(siteUrls);
    if (urls.length === 0) {
      setLocalError("请填写至少一个网站链接");
      return;
    }
    if (urls.length > ONBOARD_BATCH_MAX_SIZE) {
      setLocalError(`单次最多 ${ONBOARD_BATCH_MAX_SIZE} 个链接`);
      return;
    }
    if (job?.running) {
      setLocalError("已有修复任务在后台运行，请稍后再添加源");
      return;
    }

    setLocalError("");
    try {
      const latest = await precheckSourceAuth(urls);
      setPrecheck(latest);
      if (!latest.can_proceed) {
        setLocalError("请先完成下方登录授权，再开始接入");
        return;
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "授权预检失败");
      return;
    }

    onClose();
    void startBatchOnboarding(urls, groupId);
  }

  async function handleImportSkill() {
    if ((validImportSkills.length === 0 && importPlatformAccounts.length === 0) || importError) return;
    if (importConflict && !overwriteImport) return;
    setImporting(true);
    setLocalError("");
    try {
      const result = await importDiscoverySkills(
        validImportSkills.map((skill) => ({
          skill_id: skill.skillId,
          slug: skill.slug,
          feed_id: skill.feedId,
          name: skill.name,
          files: skill.files,
        })),
        overwriteImport,
        groupId,
        importPlatformAccounts,
      );
      sessionStorage.setItem(FEEDS_NEED_RELOAD_KEY, "1");
      onImported?.(result);
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  const authReadyCount = (precheck?.items ?? []).filter(
    (item) => item.requires_auth && item.configured,
  ).length;
  const authNeededCount = (precheck?.items ?? []).filter((item) => item.requires_auth).length;

  const primaryDisabled =
    mode === "url"
      ? busy || blockedByAuth || precheckLoading || parsedUrls.length === 0
      : importing ||
        parsingImport ||
        (validImportSkills.length === 0 && importPlatformAccounts.length === 0) ||
        Boolean(importError) ||
        (importConflict && !overwriteImport);

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-source-title">
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="add-source-title" className="ui-modal-title">
            添加数据源
          </h2>
          <div className="mt-3 inline-flex rounded border border-[var(--rule)] bg-[var(--paper)] p-0.5">
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs ${
                mode === "url"
                  ? "bg-[var(--paper-raised)] font-semibold text-[var(--ink)] shadow-sm"
                  : "text-[var(--ink-muted)]"
              }`}
              onClick={() => setMode("url")}
            >
              链接接入
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-xs ${
                mode === "import"
                  ? "bg-[var(--paper-raised)] font-semibold text-[var(--ink)] shadow-sm"
                  : "text-[var(--ink-muted)]"
              }`}
              onClick={() => setMode("import")}
            >
              导入 skill
            </button>
          </div>
        </div>

        <div className="ui-modal-body space-y-4">
          <label className="ui-field">
            <span className="ui-field-label">添加到分组</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="ui-select w-full">
              <option value={UNGROUPED_GROUP_ID}>未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          {mode === "url" ? (
            <>
              <label className="ui-field">
                <span className="ui-field-label">网站链接</span>
                <textarea
                  value={siteUrls}
                  onChange={(e) => setSiteUrls(e.target.value)}
                  rows={5}
                  className="ui-textarea w-full"
                  placeholder={"https://example.com/blog\nhttps://news.example.org/"}
                />
              </label>

              {parsedUrls.length > 0 && (
                <p className="text-xs text-[var(--ink-muted)]">
                  将接入 {parsedUrls.length} 个数据源
                  {precheckLoading
                    ? " · 正在检查授权…"
                    : authNeededCount > 0
                      ? ` · ${authReadyCount}/${authNeededCount} 个需授权源已就绪`
                      : ""}
                </p>
              )}

              {missingAuthItems.map((item) => (
                <AuthHandoffPanel
                  key={item.slot || item.entry_url}
                  item={item}
                  cookieDraft={authCookies[item.slot || ""] || ""}
                  onCookieChange={(value) =>
                    setAuthCookies((current) => ({
                      ...current,
                      [item.slot || ""]: value,
                    }))
                  }
                  saving={savingSlot === item.slot}
                  onSaved={() => void handleAuthSaved(item.slot || "")}
                />
              ))}

              {!blockedByAuth &&
                (precheck?.items ?? []).some((item) => item.requires_auth && item.configured) && (
                  <div className="border-l-2 border-[var(--success)] bg-[var(--success-soft)] px-3 py-2 text-xs text-[var(--success)]">
                    已使用已有授权：
                    {(precheck?.items ?? [])
                      .filter((item) => item.requires_auth && item.configured)
                      .map((item) => item.credential_label || item.slot_label || item.slot)
                      .filter((value, index, arr) => arr.indexOf(value) === index)
                      .join("、")}
                  </div>
                )}
            </>
          ) : (
            <>
              <button
                type="button"
                className={`w-full rounded border border-dashed px-4 py-6 text-center transition-colors ${
                  dragOver
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--rule)] bg-[var(--paper)] hover:bg-[var(--paper-raised)]"
                }`}
                disabled={parsingImport || importing}
                onClick={() => void handleImportPick()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void handleImportDrop(e.dataTransfer);
                }}
              >
                <p className="text-sm text-[var(--ink)]">选择或拖入 <strong>zip / skill 目录</strong></p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  推荐直接拖入 zip；也支持解压后的目录（含 <code>askme-skills/</code> 或单个{" "}
                  <code>*-discovery</code> 文件夹）
                </p>
              </button>
              <input
                ref={importInputRef}
                type="file"
                hidden
                accept=".zip,application/zip"
                multiple
                onChange={(e) => {
                  if (e.target.files) void loadImportPayload(e.target.files);
                  e.target.value = "";
                }}
              />
              {parsingImport ? (
                <p className="text-xs text-[var(--ink-muted)]">正在读取…</p>
              ) : null}
              {validImportSkills.length > 0 || importPlatformAccounts.length > 0 ? (
                !importError ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--ink-muted)]">
                    将导入
                    {validImportSkills.length > 0 ? ` ${validImportSkills.length} 个 skill` : ""}
                    {validImportSkills.length > 0 && importPlatformAccounts.length > 0 ? "、" : ""}
                    {importPlatformAccounts.length > 0 ? ` ${importPlatformAccounts.length} 个平台账号` : ""}
                  </p>
                  {validImportSkills.map((skill) => (
                    <div
                      key={skill.skillId}
                      className="rounded border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-xs"
                    >
                      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                        <dt className="text-[var(--ink-muted)]">类型</dt>
                        <dd className="font-medium">站级 skill</dd>
                        <dt className="text-[var(--ink-muted)]">名称</dt>
                        <dd className="font-medium">{skill.name}</dd>
                        <dt className="text-[var(--ink-muted)]">Skill</dt>
                        <dd className="font-medium">{skill.skillId}</dd>
                        <dt className="text-[var(--ink-muted)]">Feed ID</dt>
                        <dd className="font-medium">{skill.feedId}</dd>
                      </dl>
                    </div>
                  ))}
                  {importPlatformAccounts.map((account) => (
                    <div
                      key={account.feed_id}
                      className="rounded border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-xs"
                    >
                      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                        <dt className="text-[var(--ink-muted)]">类型</dt>
                        <dd className="font-medium">平台账号</dd>
                        <dt className="text-[var(--ink-muted)]">名称</dt>
                        <dd className="font-medium">{account.display_name || account.account_key || account.feed_id}</dd>
                        <dt className="text-[var(--ink-muted)]">平台</dt>
                        <dd className="font-medium">{account.platform || "—"}</dd>
                        <dt className="text-[var(--ink-muted)]">Feed ID</dt>
                        <dd className="font-medium">{account.feed_id}</dd>
                      </dl>
                      <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                        不含 Cookie；导入后若需登录请在设置中补授权
                      </p>
                    </div>
                  ))}
                </div>
                ) : null
              ) : null}
              {importError ? (
                <div className="border-l-2 border-amber-700 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {importError}
                </div>
              ) : null}
              {importConflict ? (
                <div className="border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-xs">
                  {conflictingSkills.length > 0 ? (
                    <p>
                      本地已有同名 skill：
                      {conflictingSkills.map((skill) => skill.skillId).join("、")}。
                    </p>
                  ) : null}
                  {conflictingPlatformAccounts.length > 0 ? (
                    <p className={conflictingSkills.length > 0 ? "mt-1" : ""}>
                      本地已有平台账号：
                      {conflictingPlatformAccounts
                        .map((account) => account.display_name || account.feed_id)
                        .join("、")}
                      。
                    </p>
                  ) : null}
                  <label className="mt-2 flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={overwriteImport}
                      onChange={(e) => setOverwriteImport(e.target.checked)}
                    />
                    <span>覆盖现有项并移入选定分组</span>
                  </label>
                </div>
              ) : null}
            </>
          )}

          {localError && <p className="text-sm text-red-800">{localError}</p>}
        </div>

        <div className="ui-modal-footer">
          <button type="button" onClick={onClose} className="ui-btn">
            取消
          </button>
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={() => void (mode === "url" ? handleStartUrl() : handleImportSkill())}
            className="ui-btn ui-btn-primary"
          >
            {mode === "import"
              ? importing
                ? "导入中…"
                : parsingImport
                  ? "读取中…"
                  : "确认导入"
              : blockedByAuth
                ? "请先完成授权"
                : "开始接入"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { isAuthErrorMessage };
