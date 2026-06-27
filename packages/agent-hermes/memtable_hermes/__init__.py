"""MemTable Hermes enhancer plugin."""

from __future__ import annotations

from typing import Any

from .schemas import DEFAULT_ENDPOINT, map_hermes_event
from .tools import MemTableClient, register_hooks, register_skill, register_tools

__all__ = [
    "DEFAULT_ENDPOINT",
    "MemTableClient",
    "map_hermes_event",
    "register",
    "register_hooks",
    "register_skill",
    "register_tools",
]


def register(ctx: Any, endpoint: str | None = None, observe: bool = True) -> Any:
    """Register MemTable tools, hooks, and skill with Hermes."""
    resolved_endpoint = endpoint or getattr(ctx, "memtable_endpoint", None) or DEFAULT_ENDPOINT
    register_tools(ctx, resolved_endpoint)
    if observe:
        register_hooks(ctx, resolved_endpoint)
    register_skill(ctx)
    return ctx
