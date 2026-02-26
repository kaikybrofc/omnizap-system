from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from classifier import DEFAULT_LABELS, NSFW_THRESHOLD, classify_image_bytes, get_classifier

app = FastAPI(
    title="OmniZap MobileCLIP Classifier API",
    description="Classificação de imagens com MobileCLIP (via OpenCLIP) para categorizar stickers/packs.",
    version="1.1.0",
)


class ClassificationResponse(BaseModel):
    category: str
    confidence: float
    all_scores: dict[str, float]
    nsfw_score: float
    is_nsfw: bool
    model: str
    device: str
    labels: list[str]
    filename: str | None = None
    content_type: str | None = None


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
    }


@app.post("/classify", response_model=ClassificationResponse)
async def classify(
    file: UploadFile = File(...),
    labels: str | None = Form(None),
    nsfw_threshold: float = Form(NSFW_THRESHOLD),
) -> ClassificationResponse:
    if not file.filename:
        raise HTTPException(status_code=422, detail="Arquivo sem nome.")

    if file.content_type and not file.content_type.lower().startswith("image/"):
        raise HTTPException(status_code=415, detail=f"Tipo de arquivo não suportado: {file.content_type}")

    file_bytes = await file.read()
    custom_labels = _parse_labels(labels)

    try:
        result = classify_image_bytes(file_bytes, labels=custom_labels, nsfw_threshold=nsfw_threshold)
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
