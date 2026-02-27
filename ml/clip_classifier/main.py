from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from classifier import (
    ADAPTIVE_ALPHA,
    CLIP_TOP_K,
    DEFAULT_LABELS,
    ENABLE_ADAPTIVE_SCORING,
    ENABLE_CLUSTERING,
    ENABLE_EMBEDDING_CACHE,
    ENABLE_LLM_LABEL_EXPANSION,
    ENTROPY_THRESHOLD,
    NSFW_THRESHOLD,
    classify_image_bytes,
    get_classifier,
    register_pack_feedback,
)

app = FastAPI(
    title="OmniZap MobileCLIP Classifier API",
    description="Classificação de imagens com MobileCLIP (via OpenCLIP) para categorizar stickers/packs.",
    version="2.0.0",
)


class TopLabelEntry(BaseModel):
    label: str
    score: float
    logit: float
    clip_score: float


class SimilarImageEntry(BaseModel):
    image_hash: str
    asset_id: str | None = None
    similarity: float


class LlmExpansionPayload(BaseModel):
    subtags: list[str] = Field(default_factory=list)
    style_traits: list[str] = Field(default_factory=list)
    emotions: list[str] = Field(default_factory=list)
    pack_suggestions: list[str] = Field(default_factory=list)


class ClassificationResponse(BaseModel):
    category: str
    confidence: float
    all_scores: dict[str, float]
    raw_logits: dict[str, float] = Field(default_factory=dict)
    top_labels: list[TopLabelEntry] = Field(default_factory=list)
    entropy: float
    confidence_margin: float
    nsfw_score: float
    is_nsfw: bool
    ambiguous: bool
    affinity_weight: float
    llm_expansion: LlmExpansionPayload = Field(default_factory=LlmExpansionPayload)
    similar_images: list[SimilarImageEntry] = Field(default_factory=list)
    image_hash: str | None = None
    model: str
    device: str
    labels: list[str]
    filename: str | None = None
    content_type: str | None = None


class FeedbackRequest(BaseModel):
    image_hash: str
    theme: str
    accepted: bool = True
    asset_id: str | None = None


class FeedbackResponse(BaseModel):
    ok: bool


def _parse_labels(raw: str | None) -> list[str] | None:
    if raw is None:
        return None

    value = raw.strip()
    if not value:
        return None

    if value.startswith("["):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail=f"labels JSON inválido: {error.msg}") from error

        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="labels JSON deve ser uma lista de strings.")
        return [str(item).strip() for item in parsed if str(item).strip()]

    return [item.strip() for item in value.split(",") if item.strip()]


@app.get("/health")
def health() -> dict[str, Any]:
    runtime = get_classifier().runtime_info
    return {
        "ok": True,
        "status": "ready",
        "model": runtime.model_name,
        "device": runtime.device,
    }


@app.get("/labels")
def labels() -> dict[str, Any]:
    return {
        "ok": True,
        "default_labels": DEFAULT_LABELS,
        "nsfw_threshold": NSFW_THRESHOLD,
        "top_k": CLIP_TOP_K,
        "entropy_threshold": ENTROPY_THRESHOLD,
        "adaptive_alpha": ADAPTIVE_ALPHA,
        "features": {
            "embedding_cache": ENABLE_EMBEDDING_CACHE,
            "clustering": ENABLE_CLUSTERING,
            "adaptive_scoring": ENABLE_ADAPTIVE_SCORING,
            "llm_label_expansion": ENABLE_LLM_LABEL_EXPANSION,
        },
    }


@app.post("/classify", response_model=ClassificationResponse)
async def classify(
    file: UploadFile = File(...),
    labels: str | None = Form(None),
    nsfw_threshold: float = Form(NSFW_THRESHOLD),
    asset_id: str | None = Form(None),
    asset_sha256: str | None = Form(None),
    theme: str | None = Form(None),
    similar_threshold: float | None = Form(None),
    similar_limit: int | None = Form(None),
) -> ClassificationResponse:
    if not file.filename:
        raise HTTPException(status_code=422, detail="Arquivo sem nome.")

    if file.content_type and not file.content_type.lower().startswith("image/"):
        raise HTTPException(status_code=415, detail=f"Tipo de arquivo não suportado: {file.content_type}")

    file_bytes = await file.read()
    custom_labels = _parse_labels(labels)

    try:
        result = classify_image_bytes(
            file_bytes,
            labels=custom_labels,
            nsfw_threshold=nsfw_threshold,
            asset_id=(asset_id or None),
            asset_sha256=(asset_sha256 or None),
            theme=(theme or None),
            similar_threshold=similar_threshold,
            similar_limit=similar_limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Falha interna na classificação: {error}") from error

    runtime = get_classifier().runtime_info
    return ClassificationResponse(
        **result,
        model=runtime.model_name,
        device=runtime.device,
        labels=custom_labels or list(DEFAULT_LABELS),
        filename=file.filename,
        content_type=file.content_type,
    )


@app.post("/feedback", response_model=FeedbackResponse)
def feedback(payload: FeedbackRequest) -> FeedbackResponse:
    if not payload.image_hash.strip():
        raise HTTPException(status_code=422, detail="image_hash é obrigatório.")
    if not payload.theme.strip():
        raise HTTPException(status_code=422, detail="theme é obrigatório.")

    try:
        register_pack_feedback(
            image_hash=payload.image_hash.strip().lower(),
            theme=payload.theme.strip(),
            accepted=bool(payload.accepted),
            asset_id=payload.asset_id,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Falha ao registrar feedback: {error}") from error

    return FeedbackResponse(ok=True)
