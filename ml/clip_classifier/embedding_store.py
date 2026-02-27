from __future__ import annotations

import hashlib
import json
import os
import threading
from dataclasses import dataclass
from typing import Any

import numpy as np
import pymysql
from pymysql.cursors import DictCursor

from env_loader import load_project_env

load_project_env()


def _parse_env_bool(value: str | None, fallback: bool) -> bool:
    if value is None:
        return fallback
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return fallback


@dataclass(frozen=True)
class SimilarImageRow:
    image_hash: str
    asset_id: str | None
    embedding: np.ndarray


class EmbeddingStore:
    """Persistent store for embeddings, feedback and LLM expansion cache."""

    def __init__(self) -> None:
        self.db_host = os.getenv("DB_HOST", "").strip()
        self.db_user = os.getenv("DB_USER", "").strip()
        self.db_password = os.getenv("DB_PASSWORD", "")
        base_db_name = os.getenv("DB_NAME", "").strip()
        node_env = os.getenv("NODE_ENV", "development").strip().lower() or "development"
        suffix = "prod" if node_env == "production" else "dev"
        if base_db_name.endswith("_prod") or base_db_name.endswith("_dev"):
            self.db_name = base_db_name
        else:
            self.db_name = f"{base_db_name}_{suffix}" if base_db_name else ""
        self.db_port = int(os.getenv("DB_PORT", "3306") or 3306)

        self.enabled = all([self.db_host, self.db_user, self.db_name])
        self._connection: pymysql.Connection | None = None
        self._schema_ready = False
        self._lock = threading.Lock()

    def _connect(self) -> pymysql.Connection | None:
        if not self.enabled:
            return None
        if self._connection and self._connection.open:
            return self._connection

        try:
            self._connection = pymysql.connect(
                host=self.db_host,
                user=self.db_user,
                password=self.db_password,
                database=self.db_name,
                port=self.db_port,
                charset="utf8mb4",
                cursorclass=DictCursor,
                autocommit=True,
                connect_timeout=5,
                read_timeout=10,
                write_timeout=10,
            )
        except Exception:
            self._connection = None
            self.enabled = False
            return None
        return self._connection

    def _ensure_schema(self) -> None:
        if not self.enabled:
            return
        with self._lock:
            if self._schema_ready:
                return
            connection = self._connect()
            if connection is None:
                return

            ddl = [
                """
                CREATE TABLE IF NOT EXISTS clip_image_embedding_cache (
                    image_hash CHAR(64) NOT NULL,
                    asset_id VARCHAR(64) NULL,
                    model_name VARCHAR(80) NOT NULL,
                    embedding_dim SMALLINT UNSIGNED NOT NULL,
                    embedding MEDIUMBLOB NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (image_hash),
                    KEY idx_clip_image_embedding_asset_id (asset_id),
                    KEY idx_clip_image_embedding_model (model_name)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """,
                """
                CREATE TABLE IF NOT EXISTS clip_label_embedding_cache (
                    model_name VARCHAR(80) NOT NULL,
                    label VARCHAR(191) NOT NULL,
                    embedding_dim SMALLINT UNSIGNED NOT NULL,
                    embedding MEDIUMBLOB NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (model_name, label)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """,
                """
                CREATE TABLE IF NOT EXISTS clip_llm_label_expansion_cache (
                    cache_key CHAR(64) NOT NULL,
                    model_name VARCHAR(80) NOT NULL,
                    top_labels_json TEXT NOT NULL,
                    expansion_json LONGTEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (cache_key)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """,
                """
                CREATE TABLE IF NOT EXISTS clip_image_theme_feedback (
                    image_hash CHAR(64) NOT NULL,
                    asset_id VARCHAR(64) NULL,
                    theme VARCHAR(120) NOT NULL,
                    acceptance_count INT UNSIGNED NOT NULL DEFAULT 0,
                    total_assignments INT UNSIGNED NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (image_hash, theme),
                    KEY idx_clip_feedback_asset_id (asset_id),
                    KEY idx_clip_feedback_theme (theme)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                """,
            ]

            try:
                with connection.cursor() as cursor:
                    for statement in ddl:
                        cursor.execute(statement)
                self._schema_ready = True
            except Exception:
                self.enabled = False
                self._schema_ready = False

    @staticmethod
    def stable_labels_key(model_name: str, labels: list[str]) -> str:
        payload = json.dumps({"model": model_name, "labels": labels}, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _serialize_vector(vector: np.ndarray) -> tuple[bytes, int]:
        array = np.asarray(vector, dtype=np.float32).reshape(-1)
        return array.tobytes(), int(array.shape[0])

    @staticmethod
    def _deserialize_vector(raw: bytes, dim: int) -> np.ndarray:
        if not raw:
            return np.empty((0,), dtype=np.float32)
        vector = np.frombuffer(raw, dtype=np.float32)
        if dim > 0 and vector.shape[0] != dim:
            return vector[:dim]
        return vector

    def get_image_embedding(self, image_hash: str, model_name: str) -> np.ndarray | None:
        if not self.enabled or not image_hash:
            return None
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return None

        sql = """
            SELECT embedding, embedding_dim
            FROM clip_image_embedding_cache
            WHERE image_hash = %s AND model_name = %s
            LIMIT 1
        """
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (image_hash, model_name))
                row = cursor.fetchone()
        except Exception:
            self.enabled = False
            return None
        if not row:
            return None
        return self._deserialize_vector(row.get("embedding") or b"", int(row.get("embedding_dim") or 0))

    def save_image_embedding(
        self,
        image_hash: str,
        model_name: str,
        embedding: np.ndarray,
        asset_id: str | None = None,
    ) -> None:
        if not self.enabled or not image_hash:
            return
        self._ensure_schema()

        payload, dim = self._serialize_vector(embedding)
        sql = """
            INSERT INTO clip_image_embedding_cache (
                image_hash, asset_id, model_name, embedding_dim, embedding
            ) VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                asset_id = VALUES(asset_id),
                model_name = VALUES(model_name),
                embedding_dim = VALUES(embedding_dim),
                embedding = VALUES(embedding),
                updated_at = CURRENT_TIMESTAMP
        """

        connection = self._connect()
        if connection is None:
            return

        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (image_hash, asset_id, model_name, dim, payload))
        except Exception:
            self.enabled = False

    def get_label_embeddings(self, model_name: str, labels: list[str]) -> dict[str, np.ndarray]:
        if not self.enabled or not labels:
            return {}
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return {}

        placeholders = ", ".join(["%s"] * len(labels))
        sql = f"""
            SELECT label, embedding, embedding_dim
            FROM clip_label_embedding_cache
            WHERE model_name = %s AND label IN ({placeholders})
        """

        rows: list[dict[str, Any]]
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (model_name, *labels))
                rows = cursor.fetchall() or []
        except Exception:
            self.enabled = False
            return {}

        output: dict[str, np.ndarray] = {}
        for row in rows:
            label = str(row.get("label") or "")
            if not label:
                continue
            output[label] = self._deserialize_vector(row.get("embedding") or b"", int(row.get("embedding_dim") or 0))
        return output

    def save_label_embeddings(self, model_name: str, embeddings: dict[str, np.ndarray]) -> None:
        if not self.enabled or not embeddings:
            return
        self._ensure_schema()

        sql = """
            INSERT INTO clip_label_embedding_cache (
                model_name, label, embedding_dim, embedding
            ) VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                embedding_dim = VALUES(embedding_dim),
                embedding = VALUES(embedding),
                updated_at = CURRENT_TIMESTAMP
        """

        connection = self._connect()
        if connection is None:
            return

        payload = []
        for label, vector in embeddings.items():
            serialized, dim = self._serialize_vector(vector)
            payload.append((model_name, label, dim, serialized))

        try:
            with connection.cursor() as cursor:
                cursor.executemany(sql, payload)
        except Exception:
            self.enabled = False

    def list_image_embeddings(self, model_name: str, limit: int = 3000) -> list[SimilarImageRow]:
        if not self.enabled:
            return []
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return []

        safe_limit = max(50, min(int(limit or 3000), 20000))
        sql = """
            SELECT image_hash, asset_id, embedding, embedding_dim
            FROM clip_image_embedding_cache
            WHERE model_name = %s
            ORDER BY updated_at DESC
            LIMIT %s
        """

        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (model_name, safe_limit))
                rows = cursor.fetchall() or []
        except Exception:
            self.enabled = False
            return []

        output: list[SimilarImageRow] = []
        for row in rows:
            image_hash = str(row.get("image_hash") or "")
            if not image_hash:
                continue
            embedding = self._deserialize_vector(row.get("embedding") or b"", int(row.get("embedding_dim") or 0))
            output.append(
                SimilarImageRow(
                    image_hash=image_hash,
                    asset_id=str(row.get("asset_id")) if row.get("asset_id") is not None else None,
                    embedding=embedding,
                )
            )
        return output

    def get_affinity_weight(self, image_hash: str, theme: str) -> float:
        if not self.enabled or not image_hash or not theme:
            return 0.0
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return 0.0

        sql = """
            SELECT acceptance_count, total_assignments
            FROM clip_image_theme_feedback
            WHERE image_hash = %s AND theme = %s
            LIMIT 1
        """

        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (image_hash, theme))
                row = cursor.fetchone()
        except Exception:
            self.enabled = False
            return 0.0
        if not row:
            return 0.0

        acceptance = int(row.get("acceptance_count") or 0)
        total = int(row.get("total_assignments") or 0)
        if total <= 0:
            return 0.0
        return float(acceptance / total)

    def record_feedback(
        self,
        image_hash: str,
        theme: str,
        accepted: bool,
        asset_id: str | None = None,
    ) -> None:
        if not self.enabled or not image_hash or not theme:
            return
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return

        accepted_increment = 1 if accepted else 0
        sql = """
            INSERT INTO clip_image_theme_feedback (
                image_hash, asset_id, theme, acceptance_count, total_assignments
            ) VALUES (%s, %s, %s, %s, 1)
            ON DUPLICATE KEY UPDATE
                asset_id = COALESCE(VALUES(asset_id), asset_id),
                acceptance_count = acceptance_count + VALUES(acceptance_count),
                total_assignments = total_assignments + 1,
                updated_at = CURRENT_TIMESTAMP
        """

        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (image_hash, asset_id, theme, accepted_increment))
        except Exception:
            self.enabled = False

    def get_llm_expansion(self, cache_key: str) -> dict[str, list[str]] | None:
        if not self.enabled or not cache_key:
            return None
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return None

        sql = """
            SELECT expansion_json
            FROM clip_llm_label_expansion_cache
            WHERE cache_key = %s
            LIMIT 1
        """

        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, (cache_key,))
                row = cursor.fetchone()
        except Exception:
            self.enabled = False
            return None
        if not row:
            return None

        raw = row.get("expansion_json")
        if not isinstance(raw, str):
            return None

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None

        if not isinstance(parsed, dict):
            return None
        return parsed

    def save_llm_expansion(
        self,
        cache_key: str,
        model_name: str,
        top_labels: list[str],
        expansion_payload: dict[str, list[str]],
    ) -> None:
        if not self.enabled or not cache_key:
            return
        self._ensure_schema()

        connection = self._connect()
        if connection is None:
            return

        sql = """
            INSERT INTO clip_llm_label_expansion_cache (
                cache_key, model_name, top_labels_json, expansion_json
            ) VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                model_name = VALUES(model_name),
                top_labels_json = VALUES(top_labels_json),
                expansion_json = VALUES(expansion_json),
                updated_at = CURRENT_TIMESTAMP
        """

        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    sql,
                    (
                        cache_key,
                        model_name,
                        json.dumps(top_labels, ensure_ascii=False),
                        json.dumps(expansion_payload, ensure_ascii=False),
                    ),
                )
        except Exception:
            self.enabled = False
