"""Tools and hooks for the MemTable Hermes enhancer."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import (
    ASK_PARAMETERS,
    DEFAULT_ENDPOINT,
    LIST_PROPOSALS_PARAMETERS,
    OBSERVED_EVENTS,
    PROPOSAL_ID_PARAMETERS,
    PROPOSE_PARAMETERS,
    map_hermes_event,
)

Handler = Callable[..., Any]


class MemTableClient:
    """Small stdlib HTTP client for the local MemTable sidecar."""

    def __init__(self, endpoint: str | None = None) -> None:
        self.endpoint = (endpoint or os.environ.get("MEMTABLE_ENDPOINT") or DEFAULT_ENDPOINT).rstrip("/")

    def ask(self, question: str) -> Any:
        return self._post("/v1/ask", {"question": question})

    def observe(self, event: dict[str, Any]) -> Any:
        return self._post("/v1/observe", event)

    def list_proposals(self, status: str | None = None) -> Any:
        query = f"?{urlencode({'status': status})}" if status else ""
        return self._get(f"/v1/proposals{query}")

    def commit_proposal(self, proposal_id: str) -> Any:
        return self._post(f"/v1/proposals/{proposal_id}/commit", {})

    def reject_proposal(self, proposal_id: str) -> Any:
        return self._post(f"/v1/proposals/{proposal_id}/reject", {})

    def _get(self, path: str) -> Any:
        with urlopen(f"{self.endpoint}{path}", timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        request = Request(
            f"{self.endpoint}{path}",
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))


def register_tools(ctx: Any, endpoint: str | None = None) -> None:
    client = MemTableClient(endpoint)

    _register_tool(
        ctx,
        "memtable_ask",
        "Ask MemTable structured ledger a data question.",
        ASK_PARAMETERS,
        lambda question, **_: client.ask(question),
    )
    _register_tool(
        ctx,
        "memtable_propose",
        "Observe a Hermes event and create MemTable proposals.",
        PROPOSE_PARAMETERS,
        lambda **params: client.observe(_manual_event(params)),
    )
    _register_tool(
        ctx,
        "memtable_record",
        "Create a MemTable write proposal from structured or natural-language content.",
        PROPOSE_PARAMETERS,
        lambda **params: client.observe(_manual_event(params)),
    )
    _register_tool(
        ctx,
        "memtable_list_proposals",
        "List pending MemTable proposals.",
        LIST_PROPOSALS_PARAMETERS,
        lambda status=None, **_: client.list_proposals(status),
    )
    _register_tool(
        ctx,
        "memtable_commit_proposal",
        "Commit a MemTable proposal into a record.",
        PROPOSAL_ID_PARAMETERS,
        lambda id, **_: client.commit_proposal(id),
    )
    _register_tool(
        ctx,
        "memtable_reject_proposal",
        "Reject a MemTable proposal.",
        PROPOSAL_ID_PARAMETERS,
        lambda id, **_: client.reject_proposal(id),
    )


def register_hooks(ctx: Any, endpoint: str | None = None) -> None:
    client = MemTableClient(endpoint)

    for event_name in OBSERVED_EVENTS:
        _register_hook(ctx, event_name, _make_hook(client, event_name))


def register_skill(ctx: Any) -> None:
    skill_path = Path(__file__).parent / "skill" / "SKILL.md"
    if hasattr(ctx, "register_skill"):
        ctx.register_skill("memtable", skill_path)


def _make_hook(client: MemTableClient, event_name: str) -> Handler:
    def handler(payload: Any = None, **kwargs: Any) -> None:
        source = payload if payload is not None else kwargs
        event = map_hermes_event(event_name, source)
        if event is None:
            return
        try:
            client.observe(event)
        except (OSError, URLError, TimeoutError):
            # Hermes should continue when the MemTable sidecar is offline.
            return

    return handler


def _register_tool(ctx: Any, name: str, description: str, parameters: dict[str, Any], handler: Handler) -> None:
    spec = {
        "name": name,
        "description": description,
        "parameters": parameters,
        "handler": handler,
    }

    if hasattr(ctx, "register_tool"):
        try:
            ctx.register_tool(name=name, description=description, parameters=parameters, handler=handler)
            return
        except TypeError:
            try:
                ctx.register_tool(name, handler, description=description, parameters=parameters)
                return
            except TypeError:
                ctx.register_tool(spec)
                return

    tools = getattr(ctx, "tools", None)
    if tools and hasattr(tools, "register"):
        tools.register(spec)
        return

    if hasattr(ctx, "add_tool"):
        ctx.add_tool(spec)
        return

    _append(ctx, "memtable_tools", spec)


def _register_hook(ctx: Any, event_name: str, handler: Handler) -> None:
    if hasattr(ctx, "register_hook"):
        ctx.register_hook(event_name, handler)
        return

    if hasattr(ctx, "on"):
        ctx.on(event_name, handler)
        return

    hooks = getattr(ctx, "hooks", None)
    if hooks and hasattr(hooks, "register"):
        hooks.register(event_name, handler)
        return

    _append(ctx, "memtable_hooks", {"event_name": event_name, "handler": handler})


def _append(ctx: Any, key: str, value: Any) -> None:
    items = getattr(ctx, key, None)
    if items is None:
        items = []
        setattr(ctx, key, items)
    items.append(value)


def _manual_event(params: dict[str, Any]) -> dict[str, Any]:
    content = params.get("content")
    if not isinstance(content, str):
        content = json.dumps(params, ensure_ascii=False)
    return {
        "agent": "hermes",
        "event_type": "manual_note",
        "content": content,
        "occurred_at": params.get("occurred_at") or _now(),
        "metadata": params,
    }


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
