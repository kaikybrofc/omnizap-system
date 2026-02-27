# OmniZap CLIP Classifier 2.0 (MobileCLIP)

Serviço de classificação de imagens com MobileCLIP (OpenCLIP), com arquitetura híbrida:

- embeddings persistidos (imagem e labels)
- multi-label top-k com entropia e margin
- clustering por similaridade imagem-imagem
- ajuste adaptativo por feedback de packs
- expansão semântica via API da OpenAI (cacheada)

## Estrutura

- `classifier.py`: pipeline principal de inferência/classificação.
- `embedding_store.py`: persistência MySQL de embeddings, feedback e cache LLM.
- `similarity_engine.py`: cosine similarity e busca de imagens similares.
- `adaptive_scoring.py`: ajuste adaptativo de score por afinidade histórica.
- `llm_label_expander.py`: expansão semântica de labels usando OpenAI.
- `main.py`: API FastAPI.

## Rodando localmente

```bash
cd ml/clip_classifier
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8008 --reload
```

## Endpoints

### `POST /classify`

Multipart form:

- `file`: imagem
- `labels` (opcional): JSON array ou CSV
- `nsfw_threshold` (opcional)
- `asset_id` (opcional)
- `asset_sha256` (opcional)
- `theme` (opcional, para adaptive scoring)
- `similar_threshold` (opcional)
- `similar_limit` (opcional)

### `POST /feedback`

JSON:

```json
{
  "image_hash": "...",
  "theme": "reaction-meme",
  "accepted": true,
  "asset_id": "uuid-opcional"
}
```

### `GET /labels`

Retorna labels padrão, thresholds e flags de recursos.

## Variáveis de ambiente

Principais:

- `CLIP_TOP_K=5`
- `ENABLE_EMBEDDING_CACHE=true`
- `ENABLE_CLUSTERING=true`
- `ENABLE_ADAPTIVE_SCORING=true`
- `ENABLE_LLM_LABEL_EXPANSION=true`
- `ADAPTIVE_ALPHA=0.4`
- `ENTROPY_THRESHOLD=2.5`

Complementares:

- `SIMILARITY_THRESHOLD=0.85`
- `SIMILARITY_LIMIT=25`
- `SIMILARITY_SCAN_LIMIT=3000`
- `LLM_LABEL_EXPANSION_MODEL=gpt-4.1-mini`
- `LLM_LABEL_EXPANSION_TIMEOUT_MS=6000`

Persistência MySQL (obrigatório para cache/feedback):

- `DB_HOST`
- `DB_PORT` (opcional, padrão `3306`)
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

OpenAI:

- `OPENAI_API_KEY`

## Resposta (exemplo resumido)

```json
{
  "category": "anime illustration",
  "confidence": 0.82,
  "top_labels": [
    {"label": "anime illustration", "score": 0.82, "logit": 18.10, "clip_score": 0.80},
    {"label": "cartoon", "score": 0.09, "logit": 13.40, "clip_score": 0.10}
  ],
  "entropy": 1.42,
  "confidence_margin": 0.73,
  "ambiguous": false,
  "nsfw_score": 0.01,
  "is_nsfw": false,
  "raw_logits": {"anime illustration": 18.1, "cartoon": 13.4},
  "llm_expansion": {
    "subtags": ["cel shading", "shonen vibe"],
    "style_traits": ["high contrast"],
    "emotions": ["energetic"],
    "pack_suggestions": ["anime-reaction"]
  },
  "similar_images": [
    {"image_hash": "...", "asset_id": "...", "similarity": 0.91}
  ]
}
```
