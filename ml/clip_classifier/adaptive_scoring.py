from __future__ import annotations

from typing import Iterable


def adjusted_score(clip_score: float, affinity_weight: float, alpha: float) -> float:
    return float(clip_score) * (1.0 + float(affinity_weight) * float(alpha))


def apply_adaptive_scores(
    base_scores: dict[str, float],
    affinity_weight: float,
    alpha: float,
) -> dict[str, float]:
    if not base_scores:
        return {}

    boosted = {
        label: adjusted_score(score, affinity_weight=affinity_weight, alpha=alpha)
        for label, score in base_scores.items()
    }

    # Re-normalize to keep a probabilistic interpretation for entropy.
    total = sum(max(0.0, float(value)) for value in boosted.values())
    if total <= 1e-12:
        return {label: 0.0 for label in boosted}

    return {label: float(max(0.0, value) / total) for label, value in boosted.items()}


def top_k_items(score_map: dict[str, float], k: int) -> list[tuple[str, float]]:
    safe_k = max(1, int(k or 1))
    return sorted(score_map.items(), key=lambda item: item[1], reverse=True)[:safe_k]


def confidence_margin(items: Iterable[tuple[str, float]]) -> float:
    ordered = list(items)
    if len(ordered) < 2:
        return float(ordered[0][1]) if ordered else 0.0
    return float(ordered[0][1]) - float(ordered[1][1])
