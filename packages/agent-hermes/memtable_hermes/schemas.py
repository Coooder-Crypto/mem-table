"""Schemas and event mapping helpers for the MemTable Hermes enhancer."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

DEFAULT_ENDPOINT = "http://127.0.0.1:3838"

OBSERVED_EVENTS = (
    "pre_gateway_dispatch",
    "post_tool_call",
    "post_llm_call",
    "on_session_start",
    "on_session_end",
)

ASK_PARAMETERS = {
    "type": "object",
    "additionalProperties": False,
    "required": ["question"],
    "properties": {
        "question": {"type": "string"},
    },
}

PROPOSE_PARAMETERS = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "content": {"type": "string"},
    },
}

LIST_PROPOSALS_PARAMETERS = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {"type": "string"},
    },
}

PROPOSAL_ID_PARAMETERS = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id"],
    "properties": {
        "id": {"type": "string"},
    },
}


def map_hermes_event(event_name: str, payload: Any) -> dict[str, Any] | None:
    """Convert Hermes lifecycle payloads into MemTable AgentEvent payloads."""
    source = payload if isinstance(payload, dict) else {}
    occurred_at = _string(source.get("occurred_at")) or datetime.now(timezone.utc).isoformat()

    if event_name == "pre_gateway_dispatch":
        event = {
            "agent": "hermes",
            "event_type": "user_message",
            "role": "user",
            "occurred_at": occurred_at,
        }
        _assign(event, "content", _string(source.get("content") or source.get("message") or source.get("text") or source.get("prompt")))
        return _with_optional_fields(event, source)

    if event_name == "post_llm_call":
        event = {
            "agent": "hermes",
            "event_type": "assistant_message",
            "role": "assistant",
            "occurred_at": occurred_at,
        }
        _assign(event, "content", _string(source.get("content") or source.get("message") or source.get("output") or source.get("response")))
        return _with_optional_fields(event, source)

    if event_name == "post_tool_call":
        event = {
            "agent": "hermes",
            "event_type": "tool_result",
            "role": "tool",
            "occurred_at": occurred_at,
        }
        _assign(event, "tool_name", _string(source.get("tool_name") or source.get("toolName") or source.get("name")))
        _assign(event, "tool_input", source.get("params") or source.get("input") or source.get("arguments"))
        _assign(event, "tool_output", source.get("result") or source.get("output"))
        return _with_optional_fields(event, source)

    if event_name == "on_session_start":
        return _with_optional_fields(
            {
                "agent": "hermes",
                "event_type": "session_start",
                "occurred_at": occurred_at,
            },
            source,
        )

    if event_name == "on_session_end":
        return _with_optional_fields(
            {
                "agent": "hermes",
                "event_type": "session_end",
                "occurred_at": occurred_at,
            },
            source,
        )

    return None


def _with_optional_fields(event: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    _assign(event, "session_id", _string(source.get("session_id") or source.get("sessionId")))
    _assign(event, "conversation_id", _string(source.get("conversation_id") or source.get("conversationId")))
    _assign(event, "message_id", _string(source.get("message_id") or source.get("messageId")))
    _assign(event, "metadata", source)
    return event


def _assign(target: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        target[key] = value


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) else None
