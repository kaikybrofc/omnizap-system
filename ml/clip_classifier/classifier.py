from __future__ import annotations

import io
import json
import os
import threading
from dataclasses import dataclass
from typing import Iterable

import clip
import torch
from PIL import Image, UnidentifiedImageError

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

NSFW_THRESHOLD = float(os.getenv("NSFW_THRESHOLD", "0.6"))
CLIP_MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "ViT-B/32")
MAX_LABELS = max(5, int(os.getenv("CLIP_MAX_LABELS", "256")))


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


@dataclass(frozen=True)
class ClassifierRuntimeInfo:
    model_name: str
    device: str


class ClipClassifier:
    def __init__(self, model_name: str = CLIP_MODEL_NAME, device: str | None = None) -> None:
        self.device = device or _resolve_device()
        self.model_name = model_name
        self.model, self.preprocess = clip.load(self.model_name, device=self.device)
        self.model.eval()

    @property
    def runtime_info(self) -> ClassifierRuntimeInfo:
        return ClassifierRuntimeInfo(model_name=self.model_name, device=self.device)

    def classify_pil(
        self,
        image: Image.Image,
        labels: Iterable[str] | None = None,
        nsfw_threshold: float = NSFW_THRESHOLD,
    ) -> dict:
        clean_labels = _normalize_labels(labels)
        nsfw_label = _pick_nsfw_label(clean_labels)

        image_tensor = self.preprocess(image.convert("RGB")).unsqueeze(0).to(self.device)
        text_tokens = clip.tokenize(clean_labels).to(self.device)

        with torch.no_grad():
            logits_per_image, _ = self.model(image_tensor, text_tokens)
            probs = logits_per_image.softmax(dim=-1).squeeze(0).detach().cpu().tolist()

        scores = {label: float(score) for label, score in zip(clean_labels, probs)}
        best_label = max(scores, key=scores.get)
        best_score = float(scores[best_label])
        nsfw_score = float(scores.get(nsfw_label, 0.0)) if nsfw_label else 0.0

        return {
            "category": best_label,
            "confidence": round(best_score, 6),
            "all_scores": {key: round(value, 6) for key, value in scores.items()},
            "nsfw_score": round(nsfw_score, 6),
            "is_nsfw": nsfw_score >= float(nsfw_threshold),
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


def classify_image(
    image_path: str,
    labels: Iterable[str] | None = None,
    nsfw_threshold: float = NSFW_THRESHOLD,
) -> dict:
    if not image_path:
        raise ValueError("image_path é obrigatório")

    try:
        with Image.open(image_path) as image:
            image.load()
            return get_classifier().classify_pil(image, labels=labels, nsfw_threshold=nsfw_threshold)
    except FileNotFoundError as error:
        raise ValueError(f"Arquivo não encontrado: {image_path}") from error
    except UnidentifiedImageError as error:
        raise ValueError("Arquivo inválido: não foi possível identificar como imagem.") from error


def classify_image_bytes(
    image_bytes: bytes,
    labels: Iterable[str] | None = None,
    nsfw_threshold: float = NSFW_THRESHOLD,
) -> dict:
    if not image_bytes:
        raise ValueError("Nenhum conteúdo de imagem recebido.")

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            return get_classifier().classify_pil(image, labels=labels, nsfw_threshold=nsfw_threshold)
    except UnidentifiedImageError as error:
        raise ValueError("Upload inválido: conteúdo não reconhecido como imagem.") from error
