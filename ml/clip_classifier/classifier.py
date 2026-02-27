from __future__ import annotations

import hashlib
import io
import json
import math
import os
import threading
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import open_clip
import torch
from PIL import Image, UnidentifiedImageError

from adaptive_scoring import apply_adaptive_scores, confidence_margin, top_k_items
from embedding_store import EmbeddingStore
from env_loader import load_project_env
from llm_label_expander import expand_labels_with_llm
from similarity_engine import cosine_similarity_matrix as cosine_similarity_matrix_np
from similarity_engine import find_similar_images

load_project_env()

BUILTIN_DEFAULT_LABELS = [
    "anime illustration",
    "manga panel",
    "cartoon",
    "comic art",
    "chibi character",
    "3d render",
    "pixel art",
    "vector illustration",
    "line art drawing",
    "watercolor painting",
    "oil painting",
    "real life photo",
    "portrait photo",
    "selfie photo",
    "group photo",
    "close-up face photo",
    "landscape photo",
    "cityscape photo",
    "street photography",
    "night photo",
    "indoor photo",
    "outdoor photo",
    "nature photo",
    "animal photo",
    "pet photo",
    "food photo",
    "product photo",
    "car photo",
    "motorcycle photo",
    "document screenshot",
    "website screenshot",
    "mobile app screenshot",
    "desktop app screenshot",
    "chat screenshot",
    "video game screenshot",
    "fps game screenshot",
    "rpg game screenshot",
    "moba game screenshot",
    "racing game screenshot",
    "sports game screenshot",
    "stream overlay screenshot",
    "meme image",
    "reaction meme",
    "shitpost meme",
    "motivational quote image",
    "text-only image",
    "poster design",
    "banner design",
    "logo design",
    "brand identity image",
    "infographic",
    "presentation slide",
    "advertisement image",
    "flyer design",
    "event poster",
    "album cover",
    "book cover",
    "movie poster",
    "anime wallpaper",
    "gaming wallpaper",
    "abstract wallpaper",
    "minimal wallpaper",
    "tech wallpaper",
    "sticker style image",
    "emoji style image",
    "telegram sticker style",
    "whatsapp sticker style",
    "cute style image",
    "kawaii style image",
    "dark aesthetic image",
    "cyberpunk style image",
    "fantasy art",
    "sci-fi art",
    "horror art",
    "gothic style image",
    "retro style image",
    "vaporwave style image",
    "glitch art",
    "low quality compressed image",
    "blurry image",
    "watermarked image",
    "collage image",
    "photo with overlaid text",
    "handwritten note photo",
    "whiteboard photo",
    "code screenshot",
    "terminal screenshot",
    "dashboard screenshot",
    "chart screenshot",
    "ui mockup",
    "wireframe design",
    "architecture photo",
    "interior design photo",
    "fashion photo",
    "beauty photo",
    "wedding photo",
    "party photo",
    "sports photo",
    "gym photo",
    "travel photo",
    "beach photo",
    "mountain photo",
    "forest photo",
    "rainy weather photo",
    "sunset photo",
    "space themed image",
    "medical image",
    "educational image",
    "news image",
    "political image",
    "religious image",
    "family-friendly content",
    "violent content",
    "weapon content",
    "gore content",
    "drug-related content",
    "alcohol-related content",
    "smoking-related content",
    "suggestive content",
    "nsfw content",
    "adult explicit content",
]


def _parse_env_bool(value: str | None, fallback: bool) -> bool:
    if value is None:
        return fallback
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return fallback


NSFW_THRESHOLD = float(os.getenv("NSFW_THRESHOLD", "0.6"))
CLIP_MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "MobileCLIP-S1")
CLIP_MODEL_PRETRAINED = os.getenv("CLIP_MODEL_PRETRAINED", "datacompdr")
MAX_LABELS = max(5, int(os.getenv("CLIP_MAX_LABELS", "256")))
CLIP_TOP_K = max(1, min(20, int(os.getenv("CLIP_TOP_K", "5") or 5)))
ENABLE_EMBEDDING_CACHE = _parse_env_bool(os.getenv("ENABLE_EMBEDDING_CACHE"), True)
ENABLE_CLUSTERING = _parse_env_bool(os.getenv("ENABLE_CLUSTERING"), True)
ENABLE_ADAPTIVE_SCORING = _parse_env_bool(os.getenv("ENABLE_ADAPTIVE_SCORING"), True)
ENABLE_LLM_LABEL_EXPANSION = _parse_env_bool(os.getenv("ENABLE_LLM_LABEL_EXPANSION"), True)
ADAPTIVE_ALPHA = float(os.getenv("ADAPTIVE_ALPHA", "0.4") or 0.4)
ENTROPY_THRESHOLD = float(os.getenv("ENTROPY_THRESHOLD", "2.5") or 2.5)
SIMILARITY_THRESHOLD_DEFAULT = float(os.getenv("SIMILARITY_THRESHOLD", "0.85") or 0.85)
SIMILARITY_LIMIT_DEFAULT = max(1, min(100, int(os.getenv("SIMILARITY_LIMIT", "25") or 25)))
SIMILARITY_SCAN_LIMIT = max(100, min(20000, int(os.getenv("SIMILARITY_SCAN_LIMIT", "3000") or 3000)))


def _resolve_device() -> str:
    forced = os.getenv("CLIP_DEVICE", "").strip().lower()
    if forced in {"cpu", "cuda"}:
        if forced == "cuda" and not torch.cuda.is_available():
            return "cpu"
        return forced
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load_labels_from_raw(raw_value: str) -> list[str]:
    raw = str(raw_value or "").strip()
    if not raw:
        return []

    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]

    if "\n" in raw:
        return [line.strip() for line in raw.splitlines() if line.strip()]

    return [item.strip() for item in raw.split(",") if item.strip()]


def _load_default_labels() -> list[str]:
    env_json = os.getenv("CLIP_DEFAULT_LABELS_JSON", "").strip()
    if env_json:
        labels = _load_labels_from_raw(env_json)
        if labels:
            return labels

    env_path = os.getenv("CLIP_DEFAULT_LABELS_PATH", "").strip()
    if env_path:
        try:
            with open(env_path, "r", encoding="utf-8") as file:
                labels = _load_labels_from_raw(file.read())
                if labels:
                    return labels
        except OSError:
            pass

    return list(BUILTIN_DEFAULT_LABELS)


def _normalize_labels(labels: Iterable[str] | None) -> list[str]:
    if labels is None:
        labels = DEFAULT_LABELS

    clean: list[str] = []
    seen: set[str] = set()
    for label in labels:
        normalized = str(label).strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        clean.append(normalized)
        seen.add(key)

    if not clean:
        raise ValueError("labels não pode ser vazio")
    if len(clean) > MAX_LABELS:
        clean = clean[:MAX_LABELS]
    return clean


def _pick_nsfw_label(labels: list[str]) -> str | None:
    keywords = ("nsfw", "adult", "explicit", "porn", "sexual")
    for label in labels:
        if any(keyword in label.lower() for keyword in keywords):
            return label
    return None


def _softmax(logits: np.ndarray) -> np.ndarray:
    stable = logits - np.max(logits)
    exp = np.exp(stable)
    return exp / np.clip(exp.sum(), 1e-12, None)


def _entropy(probabilities: np.ndarray) -> float:
    p = np.clip(probabilities.astype(np.float64), 1e-12, 1.0)
    return float(-(p * np.log(p)).sum())


def _round_map(values: dict[str, float], precision: int = 6) -> dict[str, float]:
    return {key: round(float(value), precision) for key, value in values.items()}


def _normalize_theme(value: str | None) -> str:
    return str(value or "").strip().lower()[:120]


@dataclass(frozen=True)
class ClassifierRuntimeInfo:
    model_name: str
    device: str


class ClipClassifier:
    def __init__(
        self,
        model_name: str = CLIP_MODEL_NAME,
        pretrained: str = CLIP_MODEL_PRETRAINED,
        device: str | None = None,
    ) -> None:
        self.device = device or _resolve_device()
        self.model_name = model_name
        self.pretrained = pretrained
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            self.model_name,
            pretrained=self.pretrained,
        )
        self.model = self.model.to(self.device)
        self.model.eval()
        self.tokenizer = open_clip.get_tokenizer(self.model_name)
        self.embedding_store = EmbeddingStore()

        self._label_embeddings_cache: dict[str, np.ndarray] = {}
        self._label_lock = threading.Lock()

    @property
    def runtime_info(self) -> ClassifierRuntimeInfo:
        return ClassifierRuntimeInfo(model_name=self.model_name, device=self.device)

    @property
    def logit_scale_value(self) -> float:
        scale = getattr(self.model, "logit_scale", None)
        if isinstance(scale, torch.Tensor):
            return float(scale.exp().detach().cpu().item())
        return 100.0

    def _compute_image_embedding(self, image: Image.Image) -> np.ndarray:
        image_tensor = self.preprocess(image.convert("RGB")).unsqueeze(0).to(self.device)
        with torch.no_grad():
            features = self.model.encode_image(image_tensor)
            features = features / features.norm(dim=-1, keepdim=True).clamp(min=1e-12)
        return features.squeeze(0).float().detach().cpu().numpy().astype(np.float32)

    def _compute_label_embeddings(self, labels: list[str]) -> dict[str, np.ndarray]:
        if not labels:
            return {}

        text_tokens = self.tokenizer(labels).to(self.device)
        with torch.no_grad():
            features = self.model.encode_text(text_tokens)
            features = features / features.norm(dim=-1, keepdim=True).clamp(min=1e-12)

        matrix = features.float().detach().cpu().numpy().astype(np.float32)
        return {label: matrix[idx] for idx, label in enumerate(labels)}

    def get_label_embeddings(self, labels: list[str]) -> dict[str, np.ndarray]:
        clean_labels = _normalize_labels(labels)
        out: dict[str, np.ndarray] = {}
        missing: list[str] = []

        with self._label_lock:
            for label in clean_labels:
                cached = self._label_embeddings_cache.get(label)
                if cached is None:
                    missing.append(label)
                else:
                    out[label] = cached

        if missing and ENABLE_EMBEDDING_CACHE:
            persisted = self.embedding_store.get_label_embeddings(self.model_name, missing)
            for label, vector in persisted.items():
                out[label] = vector
            missing = [label for label in missing if label not in persisted]

        if missing:
            computed = self._compute_label_embeddings(missing)
            out.update(computed)
            if ENABLE_EMBEDDING_CACHE and computed:
                self.embedding_store.save_label_embeddings(self.model_name, computed)

        with self._label_lock:
            self._label_embeddings_cache.update(out)

        return {label: out[label] for label in clean_labels if label in out}

    def get_image_embedding(
        self,
        image: Image.Image,
        *,
        image_hash: str | None = None,
        asset_id: str | None = None,
    ) -> np.ndarray:
        if ENABLE_EMBEDDING_CACHE and image_hash:
            cached = self.embedding_store.get_image_embedding(image_hash=image_hash, model_name=self.model_name)
            if cached is not None and cached.size > 0:
                return cached.astype(np.float32)

        computed = self._compute_image_embedding(image)
        if ENABLE_EMBEDDING_CACHE and image_hash:
            self.embedding_store.save_image_embedding(
                image_hash=image_hash,
                model_name=self.model_name,
                embedding=computed,
                asset_id=asset_id,
            )
        return computed

    def classify_pil(
        self,
        image: Image.Image,
        labels: Iterable[str] | None = None,
        nsfw_threshold: float = NSFW_THRESHOLD,
        *,
        image_hash: str | None = None,
        asset_id: str | None = None,
        theme: str | None = None,
        similar_threshold: float | None = None,
        similar_limit: int | None = None,
    ) -> dict[str, Any]:
        clean_labels = _normalize_labels(labels)
        nsfw_label = _pick_nsfw_label(clean_labels)
        normalized_theme = _normalize_theme(theme)

        image_embedding = self.get_image_embedding(image=image, image_hash=image_hash, asset_id=asset_id)
        label_embeddings = self.get_label_embeddings(clean_labels)

        text_matrix = np.asarray([label_embeddings[label] for label in clean_labels], dtype=np.float32)
        logits_vector = (image_embedding.reshape(1, -1) @ text_matrix.T).reshape(-1) * self.logit_scale_value

        logits_by_label = {label: float(logits_vector[idx]) for idx, label in enumerate(clean_labels)}
        probabilities = _softmax(logits_vector)
        base_scores = {label: float(probabilities[idx]) for idx, label in enumerate(clean_labels)}

        affinity_weight = 0.0
        effective_scores = base_scores
        if ENABLE_ADAPTIVE_SCORING and image_hash and normalized_theme:
            affinity_weight = self.embedding_store.get_affinity_weight(image_hash=image_hash, theme=normalized_theme)
            effective_scores = apply_adaptive_scores(
                base_scores=base_scores,
                affinity_weight=affinity_weight,
                alpha=ADAPTIVE_ALPHA,
            )

        ordered = sorted(
            clean_labels,
            key=lambda label: (effective_scores.get(label, 0.0), logits_by_label.get(label, -math.inf)),
            reverse=True,
        )

        top_k = min(CLIP_TOP_K, len(ordered))
        top_labels_payload = []
        for label in ordered[:top_k]:
            top_labels_payload.append(
                {
                    "label": label,
                    "score": round(float(effective_scores.get(label, 0.0)), 6),
                    "logit": round(float(logits_by_label.get(label, 0.0)), 6),
                    "clip_score": round(float(base_scores.get(label, 0.0)), 6),
                }
            )

        top_items = top_k_items(effective_scores, top_k)
        best_label = top_items[0][0] if top_items else ordered[0]
        best_score = float(effective_scores.get(best_label, 0.0))

        entropy = _entropy(np.asarray([effective_scores[label] for label in clean_labels], dtype=np.float64))
        margin = confidence_margin(top_items)
        nsfw_score = float(effective_scores.get(nsfw_label, 0.0)) if nsfw_label else 0.0

        llm_expansion = expand_labels_with_llm(
            top_labels=[entry["label"] for entry in top_labels_payload[:3]],
            store=self.embedding_store,
            enabled=ENABLE_LLM_LABEL_EXPANSION,
        )

        similar_images = []
        if ENABLE_CLUSTERING and ENABLE_EMBEDDING_CACHE and image_embedding.size > 0:
            threshold = float(similar_threshold) if similar_threshold is not None else SIMILARITY_THRESHOLD_DEFAULT
            limit = int(similar_limit) if similar_limit is not None else SIMILARITY_LIMIT_DEFAULT
            similar_images = find_similar_images(
                store=self.embedding_store,
                image_embedding=image_embedding,
                model_name=self.model_name,
                threshold=threshold,
                limit=limit,
                scan_limit=SIMILARITY_SCAN_LIMIT,
                source_image_hash=image_hash,
            )

        return {
            "category": best_label,
            "confidence": round(best_score, 6),
            "all_scores": _round_map(effective_scores),
            "raw_logits": _round_map(logits_by_label),
            "top_labels": top_labels_payload,
            "entropy": round(float(entropy), 6),
            "confidence_margin": round(float(margin), 6),
            "nsfw_score": round(nsfw_score, 6),
            "is_nsfw": nsfw_score >= float(nsfw_threshold),
            "ambiguous": float(entropy) > float(ENTROPY_THRESHOLD),
            "affinity_weight": round(float(affinity_weight), 6),
            "llm_expansion": llm_expansion,
            "similar_images": similar_images,
            "image_hash": image_hash,
            "model_name": self.model_name,
        }


DEFAULT_LABELS = _load_default_labels()


_service: ClipClassifier | None = None
_service_lock = threading.Lock()


def get_classifier() -> ClipClassifier:
    global _service
    if _service is not None:
        return _service

    with _service_lock:
        if _service is None:
            _service = ClipClassifier()
    return _service


def get_image_embedding(image: Image.Image) -> np.ndarray:
    return get_classifier().get_image_embedding(image)


def get_label_embeddings(labels: Iterable[str]) -> dict[str, list[float]]:
    embeddings = get_classifier().get_label_embeddings(_normalize_labels(labels))
    return {label: vector.astype(np.float32).tolist() for label, vector in embeddings.items()}


def cosine_similarity_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return cosine_similarity_matrix_np(a, b)


def register_pack_feedback(
    *,
    image_hash: str,
    theme: str,
    accepted: bool,
    asset_id: str | None = None,
) -> None:
    get_classifier().embedding_store.record_feedback(
        image_hash=image_hash,
        theme=_normalize_theme(theme),
        accepted=accepted,
        asset_id=asset_id,
    )


def classify_image(
    image_path: str,
    labels: Iterable[str] | None = None,
    nsfw_threshold: float = NSFW_THRESHOLD,
    *,
    theme: str | None = None,
) -> dict[str, Any]:
    if not image_path:
        raise ValueError("image_path é obrigatório")

    try:
        with open(image_path, "rb") as file:
            file_bytes = file.read()
    except FileNotFoundError as error:
        raise ValueError(f"Arquivo não encontrado: {image_path}") from error

    if not file_bytes:
        raise ValueError("Arquivo de imagem vazio.")

    image_hash = hashlib.sha256(file_bytes).hexdigest()

    try:
        with Image.open(io.BytesIO(file_bytes)) as image:
            image.load()
            return get_classifier().classify_pil(
                image,
                labels=labels,
                nsfw_threshold=nsfw_threshold,
                image_hash=image_hash,
                theme=theme,
            )
    except UnidentifiedImageError as error:
        raise ValueError("Arquivo inválido: não foi possível identificar como imagem.") from error


def classify_image_bytes(
    image_bytes: bytes,
    labels: Iterable[str] | None = None,
    nsfw_threshold: float = NSFW_THRESHOLD,
    *,
    asset_id: str | None = None,
    asset_sha256: str | None = None,
    theme: str | None = None,
    similar_threshold: float | None = None,
    similar_limit: int | None = None,
) -> dict[str, Any]:
    if not image_bytes:
        raise ValueError("Nenhum conteúdo de imagem recebido.")

    image_hash = (str(asset_sha256).strip().lower() if asset_sha256 else "") or hashlib.sha256(image_bytes).hexdigest()

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            return get_classifier().classify_pil(
                image,
                labels=labels,
                nsfw_threshold=nsfw_threshold,
                image_hash=image_hash,
                asset_id=asset_id,
                theme=theme,
                similar_threshold=similar_threshold,
                similar_limit=similar_limit,
            )
    except UnidentifiedImageError as error:
        raise ValueError("Upload inválido: conteúdo não reconhecido como imagem.") from error
