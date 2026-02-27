from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from openai import OpenAI

from embedding_store import EmbeddingStore
from env_loader import load_project_env

load_project_env()

LLM_EXPANSION_MODEL = os.getenv("LLM_LABEL_EXPANSION_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"
LLM_TIMEOUT_MS = max(1000, int(os.getenv("LLM_LABEL_EXPANSION_TIMEOUT_MS", "6000") or 6000))

_EMPTY_EXPANSION = {
    "subtags": [],
    "style_traits": [],
    "emotions": [],
    "pack_suggestions": [],
}


def _sanitize_list(values: Any, max_items: int = 12) -> list[str]:
    if not isinstance(values, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        cleaned.append(text)
        seen.add(key)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _normalize_payload(payload: dict[str, Any] | None) -> dict[str, list[str]]:
    source = payload or {}
    return {
        "subtags": _sanitize_list(source.get("subtags"), 20),
        "style_traits": _sanitize_list(source.get("style_traits"), 12),
        "emotions": _sanitize_list(source.get("emotions"), 10),
        "pack_suggestions": _sanitize_list(source.get("pack_suggestions"), 12),
    }


def _extract_json_dict(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None

    # Accept markdown fenced JSON.
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()

    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None

    candidate = raw[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None

    return parsed if isinstance(parsed, dict) else None


def _build_cache_key(model_name: str, top_labels: list[str]) -> str:
    payload = json.dumps({"model": model_name, "labels": top_labels}, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def expand_labels_with_llm(
    *,
    top_labels: list[str],
    store: EmbeddingStore,
    enabled: bool,
    model_name: str = LLM_EXPANSION_MODEL,
) -> dict[str, list[str]]:
    if not enabled:
        return dict(_EMPTY_EXPANSION)

    clean_labels = [str(label).strip() for label in top_labels if str(label).strip()][:3]
    if not clean_labels:
        return dict(_EMPTY_EXPANSION)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return dict(_EMPTY_EXPANSION)

    cache_key = _build_cache_key(model_name=model_name, top_labels=clean_labels)
    cached = store.get_llm_expansion(cache_key)
    if isinstance(cached, dict):
        return _normalize_payload(cached)

    client = OpenAI(api_key=api_key, timeout=max(1.0, LLM_TIMEOUT_MS / 1000.0))

    system_prompt = (
        "You are a multimodal taxonomy assistant. "
        "Return only valid JSON with keys: subtags, style_traits, emotions, pack_suggestions."
    )
    user_prompt = (
        "Top labels from an image classifier: "
        f"{json.dumps(clean_labels, ensure_ascii=False)}. "
        "Generate semantic subtags, visual style traits, emotions and related pack themes. "
        "Do not repeat labels verbatim unless needed. Keep each list concise."
    )

    try:
        completion = client.chat.completions.create(
            model=model_name,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        content = completion.choices[0].message.content if completion.choices else ""
        parsed = _extract_json_dict(content or "")
        normalized = _normalize_payload(parsed)
    except Exception:
        normalized = dict(_EMPTY_EXPANSION)

    store.save_llm_expansion(
        cache_key=cache_key,
        model_name=model_name,
        top_labels=clean_labels,
        expansion_payload=normalized,
    )
    return normalized
