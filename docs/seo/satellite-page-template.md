# Template padrao para pagina satelite SEO

Objetivo: publicar paginas satelite com estrutura consistente (SEO on-page, interlink interno e FAQ com JSON-LD) sem retrabalho manual.

## Como gerar paginas

1. Edite o arquivo de configuracao:
- `docs/seo/satellite-pages-phase1.json`

2. Rode o gerador:

```bash
node scripts/generate-seo-satellite-pages.mjs --config docs/seo/satellite-pages-phase1.json --out public
```

Opcao via npm script:

```bash
npm run seo:generate:satellites:phase1
```

3. Confira os arquivos criados em:
- `public/<slug>/index.html`

## Campos do template (por pagina)

- `slug`: caminho da rota sem barras (ex: `como-evitar-spam-no-whatsapp`)
- `title`: title tag SEO
- `description`: meta description
- `keywords`: lista de palavras-chave
- `h1`: titulo principal da pagina
- `intro`: paragrafo de abertura
- `intent_label`: rotulo visual da intencao da pagina
- `sections`: blocos de conteudo
- `faq`: perguntas e respostas para a secao visual e JSON-LD
- `related_links`: links internos para reforcar cluster

## Exemplo minimo

```json
{
  "slug": "exemplo-pagina-satelite",
  "title": "Exemplo de pagina satelite | OmniZap",
  "description": "Descricao curta com foco na intencao de busca.",
  "keywords": ["keyword 1", "keyword 2"],
  "h1": "Titulo principal orientado a resultado",
  "intro": "Abertura da pagina com problema + promessa de solucao.",
  "intent_label": "Guia pratico",
  "sections": [
    {
      "title": "Bloco 1",
      "paragraphs": ["Texto 1", "Texto 2"],
      "bullets": ["Ponto A", "Ponto B"]
    }
  ],
  "faq": [
    {
      "q": "Pergunta frequente?",
      "a": "Resposta curta e objetiva."
    }
  ],
  "related_links": [
    { "href": "/", "label": "OmniZap Home" },
    { "href": "/stickers/", "label": "Catalogo de Stickers" },
    { "href": "/api-docs/", "label": "Area de Desenvolvedor" }
  ]
}
```

## Padrao tecnico aplicado automaticamente

- Meta tags basicas (`title`, `description`, `canonical`, `robots`)
- Open Graph + Twitter Card
- JSON-LD `WebPage`
- JSON-LD `FAQPage` quando houver FAQ
- Interlink obrigatorio para:
  - `/`
  - `/stickers/`
  - `/comandos/`
  - `/api-docs/`
  - `/login/`

## Checklist antes de publicar

- Slug sem acentos e sem espacos
- Title com foco na query principal
- H1 alinhado ao title
- FAQ coerente com o texto da pagina
- Pelo menos 3 links internos relevantes
