import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ONBOARD_BATCH_MAX_SIZE,
  buildWeixinOnboardUrl,
  looksLikeWeixinUrl,
  parseOnboardUrls,
  parseWeixinNames,
  pickWeixinAccount,
  precheckSourceAuth,
  resolveWeixinAccountUrl,
  searchWeixinAccounts,
  type AuthPrecheckItem,
  type AuthPrecheckResult,
  type FeedGroup,
} from "../api";
import { UNGROUPED_GROUP_ID } from "../utils/feedLayout";
import { WEIXIN_SOURCE_ENABLED } from "../utils/featureFlags";
import { useOnboarding } from "../contexts/OnboardingContext";
import AuthHandoffPanel from "./AuthHandoffPanel";

interface AddSourceModalProps {
  open: boolean;
  onClose: () => void;
  groups: FeedGroup[];
  defaultGroupId?: string;
  /** 失败重试时预填链接 */
  initialUrls?: string;
}

type AddSourceTab = "url" | "weixin";

const WEIXIN_PRECHECK_URL = "https://mp.weixin.qq.com/";

function isAuthErrorMessage(message: string): boolean {
  const text = (message || "").toLowerCase();
  if (!text) return false;
  // 不要用平台名（zhihu / xiaohongshu）做匹配：普通接入错误也会带这些字样
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
}: AddSourceModalProps) {
  const { batch, job, startBatchOnboarding } = useOnboarding();
  const [tab, setTab] = useState<AddSourceTab>("url");
  const [siteUrls, setSiteUrls] = useState("");
  const [weixinNamesText, setWeixinNamesText] = useState("");
  const [groupId, setGroupId] = useState<string>(defaultGroupId);
  const [localError, setLocalError] = useState("");
  const [precheck, setPrecheck] = useState<AuthPrecheckResult | null>(null);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const [authCookies, setAuthCookies] = useState<Record<string, string>>({});
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [resolvingWeixin, setResolvingWeixin] = useState(false);

  const parsedUrls = useMemo(() => parseOnboardUrls(siteUrls), [siteUrls]);
  const parsedWeixinNames = useMemo(
    () => parseWeixinNames(weixinNamesText),
    [weixinNamesText],
  );
  const busy = Boolean(batch?.status === "running" || job?.running || resolvingWeixin);

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

  const weixinReady = useMemo(() => {
    const item = (precheck?.items ?? []).find((x) => x.slot === "weixin");
    return Boolean(item?.configured);
  }, [precheck]);

  const refreshPrecheck = useCallback(async (urls: string[]) => {
    if (urls.length === 0) {
      setPrecheck(null);
      return null;
    }
    const refreshed = await precheckSourceAuth(urls);
    setPrecheck(refreshed);
    return refreshed;
  }, []);

  useEffect(() => {
    if (!open) return;
    setGroupId(defaultGroupId || UNGROUPED_GROUP_ID);
    setLocalError("");
    setPrecheck(null);
    setAuthCookies({});
    setSavingSlot(null);
    setResolvingWeixin(false);
    setWeixinNamesText("");
    if (initialUrls.trim()) {
      setSiteUrls(initialUrls.trim());
      setTab("url");
    } else {
      setTab("url");
    }
  }, [open, defaultGroupId, initialUrls]);

  // 链接 Tab：按解析出的 URL 预检
  useEffect(() => {
    if (!open || tab !== "url") return;
    if (parsedUrls.length === 0) {
      setPrecheck(null);
      setPrecheckLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
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
    };
  }, [open, tab, parsedUrls]);

  // 微信 Tab：固定预检公众号后台凭证（功能关闭时不跑）
  useEffect(() => {
    if (!WEIXIN_SOURCE_ENABLED || !open || tab !== "weixin") return;
    let cancelled = false;
    setPrecheckLoading(true);
    void precheckSourceAuth([WEIXIN_PRECHECK_URL])
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
    return () => {
      cancelled = true;
    };
  }, [open, tab]);

  if (!open) return null;

  async function handleAuthSaved(slot: string) {
    setSavingSlot(slot);
    setLocalError("");
    try {
      setAuthCookies((current) => ({ ...current, [slot]: "" }));
      const urls = tab === "weixin" ? [WEIXIN_PRECHECK_URL] : parseOnboardUrls(siteUrls);
      await refreshPrecheck(urls);
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
    if (!WEIXIN_SOURCE_ENABLED && urls.some((url) => looksLikeWeixinUrl(url))) {
      setLocalError("微信公众号接入已暂时关闭，请去掉 mp.weixin.qq.com 相关链接");
      return;
    }
    if (busy) {
      setLocalError("已有接入或修复任务在后台运行");
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

  async function handleStartWeixin() {
    if (!WEIXIN_SOURCE_ENABLED) {
      setLocalError("微信公众号接入已暂时关闭");
      return;
    }
    const names = parseWeixinNames(weixinNamesText);
    if (names.length === 0) {
      setLocalError("请填写至少一个公众号名称或文章链接");
      return;
    }
    if (names.length > ONBOARD_BATCH_MAX_SIZE) {
      setLocalError(`单次最多 ${ONBOARD_BATCH_MAX_SIZE} 个公众号`);
      return;
    }
    if (busy) {
      setLocalError("已有接入或修复任务在后台运行");
      return;
    }
    if (!weixinReady) {
      setLocalError("请先完成微信公众号后台授权");
      return;
    }

    setLocalError("");
    try {
      const latest = await precheckSourceAuth([WEIXIN_PRECHECK_URL]);
      setPrecheck(latest);
      if (!latest.can_proceed) {
        setLocalError("请先完成下方登录授权，再开始接入");
        return;
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "授权预检失败");
      return;
    }

    setResolvingWeixin(true);
    try {
      const urls: string[] = [];
      const seenFakeids = new Set<string>();
      const missing: string[] = [];
      const LINK_HINT =
        "也可在本页直接粘贴文章链接（mp.weixin.qq.com/s/...），无需按名搜索。";

      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        try {
          if (looksLikeWeixinUrl(name)) {
            const resolved = await resolveWeixinAccountUrl(name);
            if (!resolved?.fakeid) {
              missing.push(name);
              continue;
            }
            if (seenFakeids.has(resolved.fakeid)) continue;
            seenFakeids.add(resolved.fakeid);
            urls.push(
              resolved.entry_url ||
                buildWeixinOnboardUrl(resolved.fakeid, resolved.nickname || ""),
            );
            continue;
          }

          const result = await searchWeixinAccounts(name);
          const hit = pickWeixinAccount(name, result.accounts || []);
          if (!hit?.fakeid) {
            missing.push(name);
          } else if (!seenFakeids.has(hit.fakeid)) {
            seenFakeids.add(hit.fakeid);
            urls.push(buildWeixinOnboardUrl(hit.fakeid, hit.nickname || name));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "解析公众号失败";
          const rateLimited =
            /频繁|限流|冷却|429|稍后再试/i.test(msg) || msg.includes("freq");
          setLocalError(
            rateLimited
              ? `${msg}${urls.length > 0 ? `（已解析 ${urls.length} 个）` : ""}。${LINK_HINT}`
              : `${msg}。${LINK_HINT}`,
          );
          return;
        }
      }

      if (missing.length > 0) {
        setLocalError(`未找到公众号：${missing.join("、")}。${LINK_HINT}`);
        return;
      }
      if (urls.length === 0) {
        setLocalError(`未能解析出可接入的公众号。${LINK_HINT}`);
        return;
      }

      onClose();
      void startBatchOnboarding(urls, groupId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "解析公众号失败");
    } finally {
      setResolvingWeixin(false);
    }
  }

  const authReadyCount = (precheck?.items ?? []).filter(
    (item) => item.requires_auth && item.configured,
  ).length;
  const authNeededCount = (precheck?.items ?? []).filter((item) => item.requires_auth).length;

  const primaryDisabled =
    busy ||
    blockedByAuth ||
    precheckLoading ||
    (!WEIXIN_SOURCE_ENABLED || tab === "url"
      ? parsedUrls.length === 0
      : parsedWeixinNames.length === 0);

  return (
    <div className="ui-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-source-title">
      <div className="ui-modal ui-modal-md">
        <div className="ui-modal-header">
          <h2 id="add-source-title" className="ui-modal-title">
            添加数据源
          </h2>
          <p className="ui-modal-desc">
            {tab === "url"
              ? `每行一个链接，或用逗号分隔；最多 ${ONBOARD_BATCH_MAX_SIZE} 个。需要登录的站点会引导完成授权。`
              : `每行一个公众号名称或文章链接，可混输；最多 ${ONBOARD_BATCH_MAX_SIZE} 个。名称会走搜索（有间隔与缓存）；链接直接解析 __biz，不触发 searchbiz。需先登录【公众号】后台（不要选小程序）。`}
          </p>
        </div>

        <div className="ui-modal-body space-y-4">
          <label className="ui-field">
            <span className="ui-field-label">添加到分组</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="ui-select w-full"
            >
              <option value={UNGROUPED_GROUP_ID}>未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          {WEIXIN_SOURCE_ENABLED ? (
            <div className="flex gap-1 border-b border-[var(--line)] pb-0" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "url"}
                className={`px-3 py-2 text-sm ${
                  tab === "url"
                    ? "border-b-2 border-[var(--ink)] font-medium text-[var(--ink)]"
                    : "text-[var(--ink-muted)]"
                }`}
                onClick={() => {
                  setTab("url");
                  setLocalError("");
                }}
              >
                链接
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "weixin"}
                className={`px-3 py-2 text-sm ${
                  tab === "weixin"
                    ? "border-b-2 border-[var(--ink)] font-medium text-[var(--ink)]"
                    : "text-[var(--ink-muted)]"
                }`}
                onClick={() => {
                  setTab("weixin");
                  setLocalError("");
                }}
              >
                微信公众号
              </button>
            </div>
          ) : null}

          {tab === "url" || !WEIXIN_SOURCE_ENABLED ? (
            <>
              <label className="ui-field">
                <span className="ui-field-label">网站链接</span>
                <textarea
                  value={siteUrls}
                  onChange={(e) => setSiteUrls(e.target.value)}
                  rows={5}
                  className="ui-textarea w-full"
                  placeholder={
                    "https://www.xiaohongshu.com/user/profile/...\nhttps://www.zhihu.com/people/example\nhttps://www.reddit.com/r/indiehackers\nhttps://x.com/elonmusk"
                  }
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
            </>
          ) : (
            <>
              <label className="ui-field">
                <span className="ui-field-label">公众号名称或文章链接</span>
                <textarea
                  value={weixinNamesText}
                  onChange={(e) => setWeixinNamesText(e.target.value)}
                  rows={5}
                  className="ui-textarea w-full"
                  placeholder={
                    "量子位\nhttps://mp.weixin.qq.com/s/xxxx\n机器之心"
                  }
                  disabled={!weixinReady || precheckLoading || resolvingWeixin}
                />
              </label>

              {precheckLoading && (
                <p className="text-xs text-[var(--ink-muted)]">正在检查微信授权…</p>
              )}

              {parsedWeixinNames.length > 0 && (
                <p className="text-xs text-[var(--ink-muted)]">
                  将解析并接入 {parsedWeixinNames.length} 项
                  {resolvingWeixin
                    ? " · 正在匹配（名称搜索约间隔 3 秒；链接即时解析）…"
                    : " · 优先粘贴文章链接，可减少搜索限流"}
                </p>
              )}
            </>
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

          {localError && <p className="text-sm text-red-800">{localError}</p>}
        </div>

        <div className="ui-modal-footer">
          <button type="button" onClick={onClose} className="ui-btn">
            取消
          </button>
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={() =>
              void (
                WEIXIN_SOURCE_ENABLED && tab === "weixin"
                  ? handleStartWeixin()
                  : handleStartUrl()
              )
            }
            className="ui-btn ui-btn-primary"
          >
            {blockedByAuth
              ? "请先完成授权"
              : resolvingWeixin
                ? "匹配中…"
                : "开始接入"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { isAuthErrorMessage };
