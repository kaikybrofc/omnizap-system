# v2.1.3

Atualiza a versão para `2.1.3` e consolida o ciclo de entregas desde a `v2.1.2`.

Período do ciclo: `2026-02-26` a `2026-02-27`  
Comparação base: `v2.1.2..HEAD`  
Escopo: **39 commits** e **71 arquivos alterados**

## Destaques

- Plataforma web de stickers expandida de ponta a ponta: criação de packs no browser, upload de mídia (imagem/vídeo), fluxo de publicação e dashboard de criador.
- Marketplace e descoberta evoluídos: categorias, sorting, ranking de criadores, métricas globais, cards/UX mobile e melhorias de navegação.
- SEO e indexação: `sitemap`, ajustes de páginas SEO por pack e controles de exposição NSFW no catálogo.
- Classificação inteligente e curadoria automática reforçadas: pipeline CLIP/MobileCLIP/OpenCLIP, fila de reprocessamento, clustering semântico e otimizações do auto-pack por tags.
- Admin panel consolidado com moderação: gestão de bans e role de moderador, com persistência de sessão Google Web.
- Backend mais robusto: limpeza segura de órfãos, proteção de mutações, idempotência em uploads/publicação e novos caches para stats/sumários.
- Runtime e resiliência: reconexão de socket aprimorada, tratamento de rejeições transitórias e ajustes de agendamento em background.
- Banco e deploy: novas migrations para classificação/engajamento/workers/admin, e ajuste no nome do banco com sufixo por ambiente.

## Banco de dados e migrations

Este ciclo adiciona migrations estruturais importantes:

- `20260226_0011_sticker_asset_classification.sql`
- `20260226_0012_sticker_pack_engagement.sql`
- `20260226_0013_sticker_marketplace_intelligence.sql`
- `20260226_0014_sticker_pack_publish_flow.sql`
- `20260226_0014_sticker_worker_queues.sql`
- `20260226_0015_sticker_auto_pack_curation_integrity.sql`
- `20260226_0016_sticker_web_google_auth_persistence.sql`
- `20260226_0017_sticker_web_admin_ban.sql`
- `20260226_0018_sticker_web_admin_moderator.sql`
- `20260227_0019_sticker_classification_v2_signals.sql`
- `20260227_0020_semantic_theme_clusters.sql`

## Commits incluídos (v2.1.2..HEAD)

- `b46a33f` Improve background scheduling, add cached stats and UI/status enhancements
- `c43decb` Enable semantic clustering and improve auto-pack scheduler
- `91f2950` Enhance socket reconnection and prioritize complete sticker packs
- `64f8e73` Improve classification and auto-pack optimization
- `d11d78b` Appends environment-based suffix to DB name
- `b8ede5f` Add advanced auto-pack optimization and CLIP classification pipeline
- `32e169f` Add SEO, sitemap and NSFW gating to sticker catalog
- `7271a9b` Adds web links for sticker packs and sets auto-packs to unlisted
- `7cd1151` Ignore transient rejections and force process exit
- `5072a0e` Add admin moderator role and revamp admin panel UI
- `84c08dd` Add admin panel and ban management
- `27b387b` Persist Google web sessions and add client-side Google auth cache
- `6c07feb` Improve mobile category-chip touch and scroll behavior
- `c3ca0ea` Improve auto-pack-by-tags curation and pack metadata
- `3f6c258` Fix mobile discover tabs behavior
- `831c279` Adds marketplace global stats API and panel
- `08fdafe` Add catalog sorting, creators ranking and pack UI improvements
- `082ba82` Add safe pack management, orphan asset cleanup, and UX/network robustness
- `d928227` Improve marketplace discovery UX
- `97fe5f4` Bumps stickers app asset version
- `d2d1843` Adds sticker upload API and improves creator dashboard UX
- `be5506b` Adds creator pack management endpoints and dashboard UI
- `589f671` Add creator profile with Google sign-in
- `122c1e8` Switches CLIP classifier to MobileCLIP/OpenCLIP
- `7385d30` Allow spaces in pack names and add tag typeahead
- `2c5589c` Stops trimming input on field change
- `067b6f9` Add web pack publish flow with Google auth and idempotent uploads
- `6953768` Allow image/video uploads with WebP conversion
- `b33c1b8` Add web pack creation and sticker upload UI/API
- `2b23441` Add reprocess queue, cohesion scoring and ranking
- `6342d2b` Add marketplace stats endpoint and homepage preview
- `55cf8b7` Batch-scans and deduplicates catalog listings
- `7819fe6` Adds automatic sticker pack curation by tags
- `8ed61bc` Improve API docs and dynamic sidebar/UI for stickers
- `d0fd86d` Adds support contact API and enhances sticker catalog UI
- `c5cb106` Improves pack cards and mobile header UX
- `3da0375` Adds categories filtering and pack engagement tracking
- `d9bb604` Adds CLIP-based sticker classification
- `fffc205` Enhances catalog and API docs UI

## Notas de atualização

- `package.json` atualizado para `2.1.3`.
- `README.md` atualizado para refletir a versão atual.
- Recomendado reiniciar o processo de produção após deploy (`pm2 restart ... --update-env`).
- Atenção para comportamento de nome de banco por ambiente (`DB_NAME` com sufixo `_dev`/`_prod` quando aplicável).
