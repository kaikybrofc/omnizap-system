# StickerCatalogController - Itens Fora de Escopo (Snapshot 2026-03-08)

Arquivo de origem: `server/controllers/sticker/stickerCatalogController.js`

## Objetivo

Registrar o que ainda esta dentro do controller e deveria, idealmente, viver em modulos/contextos dedicados.

## Delta desde o snapshot anterior

No snapshot anterior (2026-03-07) foram sinalizados **119 itens** fora de escopo.
No estado atual, houve extracao real de responsabilidades para modulos dedicados, principalmente em:

- Auth: `server/auth/stickerCatalogAuthContext.js`
- Admin: `server/controllers/admin/stickerCatalogAdminContext.js`
- SEO: `server/controllers/seo/stickerCatalogSeoContext.js`
- System: `server/controllers/system/stickerCatalogSystemContext.js`
- HTTP util: `server/http/httpRequestUtils.js`
- Site routing: `server/http/siteRoutingUtils.js`
- Nao-catalogo: `server/controllers/sticker/nonCatalogHandlers.js`

## Itens remanescentes (priorizados)

Lista focada nos pontos de maior acoplamento atual (nao e inventario exaustivo linha-a-linha).

### 1) Config/env de auth e usuario ainda no controller

- `USER_API_BASE_PATH` (linha 107)
- `STICKER_LOGIN_WEB_PATH` (linha 110)
- `USER_PROFILE_WEB_PATH` (linha 111)
- `USER_PASSWORD_RESET_WEB_PATH` (linha 112)
- `PASSWORD_RECOVERY_SESSION_AUTH_METHOD` (linha 113)
- `PASSWORD_RECOVERY_SESSION_TTL_SECONDS` (linha 114)

Risco: politica de rota e auth espalhada entre controller/context.

### 2) Observabilidade e sumarios globais

- `METRICS_ENDPOINT` (linha 149)
- `METRICS_SUMMARY_TIMEOUT_MS` (linha 150)
- `GITHUB_REPOSITORY` (linha 151)
- `GITHUB_TOKEN` (linha 152)
- `GITHUB_PROJECT_CACHE_SECONDS` (linha 153)
- `GLOBAL_RANK_REFRESH_SECONDS` (linha 162)
- `MARKETPLACE_GLOBAL_STATS_API_PATH` (linha 166)
- `MARKETPLACE_GLOBAL_STATS_CACHE_SECONDS` (linha 167)
- `HOME_MARKETPLACE_STATS_CACHE_SECONDS` (linha 168)
- `SYSTEM_SUMMARY_CACHE_SECONDS` (linha 169)
- `README_SUMMARY_CACHE_SECONDS` (linha 170)
- `README_MESSAGE_TYPE_SAMPLE_LIMIT` (linha 171)
- `README_COMMAND_PREFIX` (linha 172)

Risco: afinacao operacional continua acoplada ao controller.

### 3) SEO/sitemap e discovery ainda declarados localmente

- `SITEMAP_MAX_PACKS` (linha 174)
- `SITEMAP_CACHE_SECONDS` (linha 175)
- `SEO_DISCOVERY_LINK_LIMIT` (linha 176)
- `SEO_DISCOVERY_CACHE_SECONDS` (linha 177)

Risco: limiares de SEO espalhados entre controller e contexto SEO.

### 4) Sessao web/cookies no mesmo arquivo do catalogo

- `WEB_VISITOR_COOKIE_NAME` (linha 185)
- `WEB_SESSION_COOKIE_NAME` (linha 186)
- `WEB_VISITOR_COOKIE_TTL_SECONDS` (linha 194)
- `WEB_SESSION_COOKIE_TTL_SECONDS` (linha 195)

Risco: fronteira entre catalogo publico e sessao web ainda nao esta totalmente separada.

### 5) Cache bucket local no controller

- `GITHUB_PROJECT_CACHE` (linha 218)
- `GLOBAL_RANK_CACHE` (linha 222)
- `MARKETPLACE_GLOBAL_STATS_CACHE` (linha 227)
- `CATALOG_LIST_CACHE` (linha 233)
- `CATALOG_CREATOR_RANKING_CACHE` (linha 234)
- `CATALOG_PACK_PAYLOAD_CACHE` (linha 235)
- `SYSTEM_SUMMARY_CACHE` (linha 237)
- `README_SUMMARY_CACHE` (linha 242)

Risco: estrategias de cache nao padronizadas em servico unico.

### 6) Responsabilidades HTTP de arquivos/public assets

- `handlePublicDataAssetRequest` (linha 4825)
- `handleAssetRequest` (linha 4961)

Risco: o controller continua com detalhes de IO/streaming de arquivo.

### 7) Despacho final de rotas muito concentrado

- `maybeHandleStickerCatalogRequest` (linhas 5371-5491)

Risco: gateway unico com muitas regras condicionais reduz testabilidade.

## Proxima rodada recomendada

1. Extrair bloco de env/config para `stickerCatalogConfigRuntime` dedicado.
2. Mover handlers de assets (`/data` e `/asset`) para modulo de rota/serving separado.
3. Reduzir `maybeHandleStickerCatalogRequest` para um router declarativo com mapa de rotas.
