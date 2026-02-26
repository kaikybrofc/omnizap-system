# OmniZap CLIP Classifier

Serviço de classificação de imagens com CLIP para categorizar stickers/packs.

## Estrutura

- `classifier.py`: lógica de inferência (modelo global, classificação, NSFW).
- `main.py`: API FastAPI.
- `requirements.txt`: dependências Python.
- `Dockerfile`: container pronto para deploy.

## Rodando localmente

```bash
cd ml/clip_classifier
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8008 --reload
```

## Endpoint principal

`POST /classify`

- `file`: upload da imagem
- `labels` (opcional): lista custom (JSON ou CSV)
- `nsfw_threshold` (opcional): threshold para NSFW

## Categorias (100+)

O serviço agora vem com mais de 100 categorias padrão.

Você pode sobrescrever via ambiente:

- `CLIP_DEFAULT_LABELS_JSON`: lista JSON (`["categoria 1","categoria 2"]`)
- `CLIP_DEFAULT_LABELS_PATH`: caminho para arquivo `.txt`/`.json` com labels
- `CLIP_MAX_LABELS`: limite máximo de labels por inferência (padrão: `256`)

Exemplo com cURL:

```bash
curl -X POST "http://localhost:8008/classify" \
  -F "file=@./imagem.jpg" \
  -F "labels=[\"anime illustration\",\"video game screenshot\",\"real life photo\",\"nsfw content\",\"cartoon\"]" \
  -F "nsfw_threshold=0.6"
```

## Resposta esperada

```json
{
  "category": "anime illustration",
  "confidence": 0.91,
  "all_scores": {
    "anime illustration": 0.91,
    "video game screenshot": 0.03,
    "real life photo": 0.02,
    "nsfw content": 0.01,
    "cartoon": 0.03
  },
  "nsfw_score": 0.01,
  "is_nsfw": false,
  "model": "ViT-B/32",
  "device": "cuda",
  "labels": [
    "anime illustration",
    "video game screenshot",
    "real life photo",
    "nsfw content",
    "cartoon"
  ],
  "filename": "imagem.jpg",
  "content_type": "image/jpeg"
}
```

## Docker

```bash
cd ml/clip_classifier
docker build -t omnizap-clip-classifier .
docker run --rm -p 8008:8008 omnizap-clip-classifier
```
