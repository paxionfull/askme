"""已知平台接入规格注册表：probe / 鉴权 / 显示名 / 失败策略集中声明，主流程查表调度。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from onboarding.source_platform_scaffold import (
    PlatformMatch,
    fetch_zhihu_profile_name,
    format_reddit_source_name,
    format_weixin_source_name,
    format_x_source_name,
    format_zhihu_source_name,
    probe_jin10_api,
    probe_reddit_subreddit,
    probe_weixin_account,
    probe_xiaohongshu_profile,
    probe_x_profile,
    probe_zhihu_api,
    refresh_x_display_name_from_list,
    weixin_name_hint_from_url,
)

# hard_repair: 探测失败时先登记再修，且重探必须成功（知乎 / 金十）
# register_then_repair: 先登记，失败可 soft 或 repair（小红书 / Reddit / 微信）
# soft: 始终登记；探测问题仅告警（X）
FailMode = Literal["hard_repair", "register_then_repair", "soft"]

ProbeFn = Callable[[PlatformMatch], dict[str, Any]]
DisplayFn = Callable[[PlatformMatch, dict[str, Any], str, str], str]
RefreshDisplayFn = Callable[[PlatformMatch, str, str], str | None]
AuthCheckFn = Callable[[dict[str, Any]], str | None]


@dataclass(frozen=True)
class PlatformSpec:
    id: str
    label: str
    probe: ProbeFn = field(repr=False)
    resolve_display_name: DisplayFn = field(repr=False)
    auth_slot: str = ""
    singleton_skill: bool = False
    # 返回非空字符串则立即 ASKME_AUTH_REQUIRED
    check_early_auth: AuthCheckFn | None = field(default=None, repr=False)
    fail_mode: FailMode = "register_then_repair"
    reprobe_after_repair: bool = True
    reprobe_must_succeed: bool = False
    skip_full_validate_when_probe_ok: bool = False
    # 复用源时刷新显示名（batch）
    refresh_display_name: RefreshDisplayFn | None = field(default=None, repr=False)
    # 登记后可选再刷一次显示名（如 X 列表作者）
    after_register_refresh_display: RefreshDisplayFn | None = field(default=None, repr=False)


def _probe_jin10(_match: PlatformMatch) -> dict[str, Any]:
    return probe_jin10_api()


def _zhihu_early_auth(probe: dict[str, Any]) -> str | None:
    if probe.get("ok"):
        return None
    detail = str(probe.get("error") or "")
    if "ZHIHU_COOKIE" in detail or not probe.get("cookie_configured"):
        return (
            "ASKME_AUTH_REQUIRED:slot=zhihu 知乎接入需要登录授权：请先添加知乎 Cookie 凭证"
        )
    return None


def _xhs_early_auth(probe: dict[str, Any]) -> str | None:
    if not probe.get("cookie_configured"):
        return (
            "ASKME_AUTH_REQUIRED:slot=xiaohongshu 小红书接入需要登录授权："
            "请先在设置页完成小红书 Cookie 授权"
        )
    return None


def _weixin_early_auth(probe: dict[str, Any]) -> str | None:
    if not probe.get("cookie_configured") or (
        not probe.get("ok") and "ASKME_AUTH_REQUIRED" in str(probe.get("error") or "")
    ):
        return (
            "ASKME_AUTH_REQUIRED:slot=weixin 微信接入需要公众号后台登录授权："
            "请在设置页用【公众号】扫码登录（不要选小程序），保存凭证后再接入"
        )
    return None


def _display_zhihu(
    match: PlatformMatch, probe: dict[str, Any], fallback: str, user_name: str
) -> str:
    raw = (
        probe.get("display_name")
        or fetch_zhihu_profile_name(match)
        or user_name
        or fallback
        or match.user_id
    )
    return format_zhihu_source_name(str(raw)) or str(raw)


def _display_jin10(
    _match: PlatformMatch, _probe: dict[str, Any], _fallback: str, _user_name: str
) -> str:
    return "金十数据"


def _display_xhs(
    match: PlatformMatch, probe: dict[str, Any], fallback: str, user_name: str
) -> str:
    raw = probe.get("display_name") or user_name or fallback or match.user_id
    return str(raw)


def _display_reddit(
    match: PlatformMatch, probe: dict[str, Any], fallback: str, _user_name: str
) -> str:
    raw = probe.get("display_name") or format_reddit_source_name(match.user_id) or fallback
    return format_reddit_source_name(str(raw)) or str(raw)


def _display_x(
    match: PlatformMatch, probe: dict[str, Any], fallback: str, _user_name: str
) -> str:
    raw = probe.get("display_name") or format_x_source_name(match.user_id) or fallback
    return format_x_source_name(str(raw)) or str(raw)


def _display_weixin(
    match: PlatformMatch, probe: dict[str, Any], fallback: str, user_name: str
) -> str:
    name_hint = weixin_name_hint_from_url(match.entry_url)
    raw = (
        (user_name.strip() if user_name and user_name.strip() else "")
        or probe.get("display_name")
        or format_weixin_source_name(str(probe.get("nickname") or ""))
        or format_weixin_source_name(name_hint)
        or format_weixin_source_name(match.user_id)
        or fallback
    )
    return format_weixin_source_name(str(raw)) or str(raw)


def _refresh_xhs(match: PlatformMatch, _slug: str, _current: str) -> str | None:
    probe = probe_xiaohongshu_profile(match)
    name = str(probe.get("display_name") or "").strip()
    if name == match.user_id or name == f"小红书-{match.user_id}":
        return None
    return name or None


def _refresh_zhihu(match: PlatformMatch, _slug: str, _current: str) -> str | None:
    name = str(fetch_zhihu_profile_name(match) or "").strip()
    if name == match.user_id or name == f"知乎-{match.user_id}":
        return None
    return name or None


def _refresh_reddit(match: PlatformMatch, _slug: str, _current: str) -> str | None:
    return format_reddit_source_name(match.user_id) or None


def _refresh_x(match: PlatformMatch, slug: str, _current: str) -> str | None:
    name = refresh_x_display_name_from_list(slug, match) or ""
    if name:
        return name
    probe = probe_x_profile(match)
    return str(
        probe.get("display_name") or format_x_source_name(match.user_id)
    ).strip() or None


def _refresh_weixin(match: PlatformMatch, _slug: str, _current: str) -> str | None:
    probe = probe_weixin_account(match)
    return str(
        probe.get("display_name")
        or format_weixin_source_name(str(probe.get("nickname") or ""))
        or format_weixin_source_name(match.user_id)
    ).strip() or None


def _after_register_x(match: PlatformMatch, slug: str, _current: str) -> str | None:
    return refresh_x_display_name_from_list(slug, match) or None


PLATFORM_SPECS: dict[str, PlatformSpec] = {
    "zhihu": PlatformSpec(
        id="zhihu",
        label="知乎",
        auth_slot="zhihu",
        probe=probe_zhihu_api,
        resolve_display_name=_display_zhihu,
        check_early_auth=_zhihu_early_auth,
        fail_mode="hard_repair",
        reprobe_must_succeed=True,
        refresh_display_name=_refresh_zhihu,
    ),
    "jin10": PlatformSpec(
        id="jin10",
        label="金十数据",
        singleton_skill=True,
        probe=_probe_jin10,
        resolve_display_name=_display_jin10,
        fail_mode="hard_repair",
        reprobe_must_succeed=True,
    ),
    "xiaohongshu": PlatformSpec(
        id="xiaohongshu",
        label="小红书",
        auth_slot="xiaohongshu",
        probe=probe_xiaohongshu_profile,
        resolve_display_name=_display_xhs,
        check_early_auth=_xhs_early_auth,
        fail_mode="register_then_repair",
        refresh_display_name=_refresh_xhs,
    ),
    "reddit": PlatformSpec(
        id="reddit",
        label="Reddit",
        probe=probe_reddit_subreddit,
        resolve_display_name=_display_reddit,
        fail_mode="register_then_repair",
        reprobe_after_repair=False,
        refresh_display_name=_refresh_reddit,
    ),
    "x": PlatformSpec(
        id="x",
        label="X",
        probe=probe_x_profile,
        resolve_display_name=_display_x,
        fail_mode="soft",
        after_register_refresh_display=_after_register_x,
        refresh_display_name=_refresh_x,
    ),
    "weixin": PlatformSpec(
        id="weixin",
        label="微信公众号",
        auth_slot="weixin",
        probe=probe_weixin_account,
        resolve_display_name=_display_weixin,
        check_early_auth=_weixin_early_auth,
        fail_mode="register_then_repair",
        skip_full_validate_when_probe_ok=True,
        refresh_display_name=_refresh_weixin,
    ),
}


def get_platform_spec(platform_id: str) -> PlatformSpec | None:
    return PLATFORM_SPECS.get((platform_id or "").strip().lower())


def list_platform_ids() -> list[str]:
    return sorted(PLATFORM_SPECS.keys())
