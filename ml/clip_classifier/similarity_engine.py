from __future__ import annotations

from typing import Any

import numpy as np

from embedding_store import EmbeddingStore


def cosine_similarity_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Compute pairwise cosine similarity between 2-D arrays."""
    if a.ndim != 2 or b.ndim != 2:
        raise ValueError("cosine_similarity_matrix requires 2-D arrays")
    if a.shape[1] != b.shape[1]:
        raise ValueError("Embedding dimensions must match")

    a_norm = np.linalg.norm(a, axis=1, keepdims=True)
    b_norm = np.linalg.norm(b, axis=1, keepdims=True)

    a_safe = a / np.clip(a_norm, 1e-12, None)
    b_safe = b / np.clip(b_norm, 1e-12, None)
    return a_safe @ b_safe.T


def find_similar_images(
    *,
    store: EmbeddingStore,
    image_embedding: np.ndarray,
    model_name: str,
    threshold: float = 0.85,
    limit: int = 25,
    scan_limit: int = 3000,
    source_image_hash: str | None = None,
) -> list[dict[str, Any]]:
    """Find semantically similar images from persisted embedding cache."""
    if image_embedding.ndim != 1:
        image_embedding = image_embedding.reshape(-1)

    rows = store.list_image_embeddings(model_name=model_name, limit=scan_limit)
    if not rows:
        return []

    candidates = []
    vectors = []
    for row in rows:
        if source_image_hash and row.image_hash == source_image_hash:
            continue
        if row.embedding.size == 0:
            continue
        candidates.append(row)
        vectors.append(row.embedding)

    if not vectors:
        return []

    matrix_a = np.asarray([image_embedding.astype(np.float32)], dtype=np.float32)
    matrix_b = np.asarray(vectors, dtype=np.float32)
    scores = cosine_similarity_matrix(matrix_a, matrix_b).reshape(-1)

    hits = []
    for idx, score in enumerate(scores.tolist()):
        if float(score) < float(threshold):
            continue
        candidate = candidates[idx]
        hits.append(
            {
                "image_hash": candidate.image_hash,
                "asset_id": candidate.asset_id,
                "similarity": round(float(score), 6),
            }
        )

    hits.sort(key=lambda entry: float(entry["similarity"]), reverse=True)
    return hits[: max(1, min(int(limit or 25), 100))]
