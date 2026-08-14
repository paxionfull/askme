"""平台账号运行时上下文：一个平台 skill 绑定多个 feed 时注入当前账号参数。

须放在 skills/_lib，供 discover.py 与 backend BoundPlatformAdapter 共用同一 ContextVar。
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_account_var: ContextVar[dict[str, Any] | None] = ContextVar(
    "askme_platform_account", default=None
)


def require_account() -> dict[str, Any]:
    account = _account_var.get()
    if not account:
        raise RuntimeError("平台 skill 未绑定账号上下文（platform_accounts）")
    return account


def get_account() -> dict[str, Any] | None:
    return _account_var.get()


def account_field(key: str, default: str = "") -> str:
    account = _account_var.get()
    if not account:
        return default
    return str(account.get(key) or default).strip() or default


class platform_account_scope:
    """with platform_account_scope(account): ..."""

    def __init__(self, account: dict[str, Any]):
        self.account = account
        self._token = None

    def __enter__(self) -> dict[str, Any]:
        self._token = _account_var.set(self.account)
        return self.account

    def __exit__(self, *exc: object) -> None:
        if self._token is not None:
            _account_var.reset(self._token)
