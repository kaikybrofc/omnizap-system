# Template padrão para página satélite de SEO

Objetivo: publicar páginas satélite com estrutura consistente (SEO on-page, interlink interno e FAQ com JSON-LD) sem retrabalho manual.

## Como gerar páginas

1. Edite o arquivo de configuração:

- `docs/seo/satellite-pages-phase1.json`

2. Execute o gerador:

```bash
node scripts/generate-seo-satellite-pages.mjs --config docs/seo/satellite-pages-phase1.json --out public/seo --route-prefix /seo
```

Opção via script npm:

```bash
npm run seo:generate:satellites:phase1
```

3. Verifique os arquivos criados em:

- `public/seo/<slug>/index.html`

## Campos do template (por página)

- `slug`: identificador sem barras (ex.: `como-evitar-spam-no-whatsapp`; rota final padrão: `/seo/<slug>/`)
- `title`: título SEO da página
- `description`: meta description
- `keywords`: lista de palavras-chave
- `h1`: título principal da página
- `intro`: parágrafo de abertura
- `intent_label`: rótulo visual da intenção da página
- `sections`: blocos de conteúdo
- `faq`: perguntas e respostas para a seção visual e JSON-LD
- `related_links`: links internos para reforçar cluster semântico

## Exemplo mínimo

```json
{
  "slug": "exemplo-pagina-satelite",
  "title": "Exemplo de página satélite | OmniZap",
  "description": "Descrição curta com foco na intenção de busca.",
  "keywords": ["keyword 1", "keyword 2"],
  "h1": "Título principal orientado a resultado",
  "intro": "Abertura da página com problema + promessa de solução.",
  "intent_label": "Guia prático",
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
    { "href": "/stickers/", "label": "Catálogo de Stickers" },
    { "href": "/api-docs/", "label": "Área de Desenvolvedor" }
  ]
}
```

## Padrão técnico aplicado automaticamente

- Meta tags básicas (`title`, `description`, `canonical`, `robots`)
- Open Graph + Twitter Card
- JSON-LD `WebPage`
- JSON-LD `FAQPage` quando houver FAQ
- Interlink obrigatório para:
  - `/`
  - `/stickers/`
  - `/comandos/`
  - `/api-docs/`
  - `/login/`

## Padrão editorial recomendado

- Priorize clareza e foco em uma intenção por página.
- Evite duplicação de conteúdo entre satélites do mesmo cluster.
- Use linguagem direta, com exemplos práticos e orientação acionável.
- Inclua pelo menos 1 CTA interno para página comercial/hub.
- Mantenha consistência entre `title`, `h1`, `intro` e FAQ.

## Checklist antes de publicar

- Slug sem acentos e sem espaços
- Title com foco na query principal
- H1 alinhado ao title
- FAQ coerente com o texto da página
- Pelo menos 3 links internos relevantes
- Ausência de promessas exageradas ou claims sem evidência

## Checklist pós-publicação

- Página indexável (`robots` e `canonical` corretos)
- Linkagem interna funcionando
- Renderização sem erro de layout em mobile/desktop
- Validação do JSON-LD em ferramenta de rich results
- Monitoramento inicial de impressões/CTR no Search Console

## Referências

- Google Search Central - SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Google Search Central - Creating helpful, reliable, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Rich Results Test: https://search.google.com/test/rich-results
- Schema.org `FAQPage`: https://schema.org/FAQPage
- Schema.org `WebPage`: https://schema.org/WebPage
