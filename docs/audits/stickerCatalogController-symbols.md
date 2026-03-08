# Sticker Catalog Controller - Inventario Atual de Simbolos

Snapshot: `2026-03-08`
Arquivo auditado: `server/controllers/sticker/stickerCatalogController.js`

## Resumo do snapshot

- Total de linhas: **5491** (`wc -l`)
- Imports no topo do arquivo: **40**
- API exportada publicamente: **7 simbolos**
- Handlers internos (`handle*`): **28**
- Constantes com leitura de `process.env`: **64**

## API exportada (contrato publico)

- `normalizeBasePath` (linha 51)
- `normalizeCatalogVisibility` (linha 58)
- `stripWebpExtension` (linha 78)
- `extractPackKeyFromWebPath` (linha 2101)
- `isStickerCatalogEnabled` (linha 5349)
- `getStickerCatalogConfig` (linha 5350)
- `maybeHandleStickerCatalogRequest` (linha 5371)

## Composicao por contexto (estado atual)

O controller passou a orquestrar contextos especializados em vez de concentrar tudo no mesmo bloco:

- SEO/contexto de pagina: `createStickerCatalogSeoContext` (linha 2117)
- Auth/contexto de sessao: `createStickerCatalogAuthContext` (linha 2833)
- System/contexto de metricas e sumarios: `createStickerCatalogSystemContext` (linha 4763)
- Handlers nao-catalogo (system/readme/support): `createStickerCatalogNonCatalogHandlers` (linha 4799)
- Handlers administrativos: `createStickerCatalogAdminHandlersContext` (linha 5127)
- Router declarativo da API: `createCatalogApiRouter` (linha 5166)

## Modulos externos mais relevantes

- HTTP utils centralizados: `server/http/httpRequestUtils.js`
- Site routing/canonical host: `server/http/siteRoutingUtils.js`
- Auth web catalogo: `server/auth/stickerCatalogAuthContext.js`
- Admin catalogo: `server/controllers/admin/stickerCatalogAdminContext.js`
- SEO catalogo: `server/controllers/seo/stickerCatalogSeoContext.js`
- System summary/metrics: `server/controllers/system/stickerCatalogSystemContext.js`
- Handlers nao-catalogo: `server/controllers/sticker/nonCatalogHandlers.js`

## Hotspots de acoplamento remanescente

Mesmo com extracoes recentes, os blocos abaixo ainda concentram responsabilidade transversal:

- Configuracao/env e politicas de rota (aprox. linhas 104-201)
- Cache local e snapshots de resumo/ranking (aprox. linhas 218-246)
- Servico de assets publicos (`/data`) e preview de sticker (aprox. linhas 4825-5074)
- Despacho final de rotas publicas/API em `maybeHandleStickerCatalogRequest` (aprox. linhas 5371-5491)

## Mudanca de baseline em relacao ao snapshot anterior

- Snapshot anterior de symbols indicava **7904** linhas; baseline atual caiu para **5491**.
- Partes de auth/admin/seo/system foram modularizadas e hoje entram por context factories.
- Inventario detalhado linha-a-linha foi simplificado para manter manutencao pratica do audit.
