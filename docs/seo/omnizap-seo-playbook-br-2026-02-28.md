# OmniZap SEO Playbook BR (2026-02-28)

Objetivo: posicionar o OmniZap como "bot pronto para WhatsApp" para usuário final, mantendo stickers como feature de aquisição e expansão.

## Status de execução (2026-02-28)

- Primeira leva de satélites da fase 1 publicada:
  - `/seo/bot-whatsapp-para-grupo/`
  - `/seo/como-moderar-grupo-whatsapp/`
  - `/seo/como-evitar-spam-no-whatsapp/`
  - `/seo/como-organizar-comunidade-whatsapp/`
  - `/seo/como-automatizar-avisos-no-whatsapp/`
  - `/seo/como-criar-comandos-whatsapp/`
  - `/seo/melhor-bot-whatsapp-para-grupos/`
  - `/seo/bot-whatsapp-sem-programar/`
- Hub comercial publicado para conversão de comandos:
  - `/comandos/`
- Template padrão para escala em lote:
  - Gerador: `scripts/generate-seo-satellite-pages.mjs`
  - Config principal: `docs/seo/satellite-pages-phase1.json`
  - Guia de uso: `docs/seo/satellite-page-template.md`

## 1) FAQ + JSON-LD prontos

Status implementado no projeto:

- Home (`/`): FAQ visual + `FAQPage` JSON-LD alinhado ao posicionamento "adicionar e usar".
- Catálogo (`/stickers/`): `FAQPage` JSON-LD no HTML público.
- Pack (`/stickers/{packKey}`): `FAQPage` JSON-LD dinâmico no HTML SEO server-side.
- API Docs (`/api-docs/`): já possui `SoftwareApplication` + `FAQPage`.

Checklist técnico para manutenção:

- FAQ da página deve corresponder 1:1 ao JSON-LD.
- Linguagem da FAQ deve seguir a intenção da página (usuário final na home, integração no cluster técnico).
- Atualizar cache-bust quando houver mudança textual relevante.
- Validar rich results após alterações de conteúdo.

## 2) Estratégia de páginas satélite para dominar Google

Observação: o mapa abaixo orienta expansão. A fase 1 está publicada; os itens restantes permanecem no backlog priorizado.

### Cluster principal (comercial)

- `/bot-whatsapp-para-grupo/`
- `/bot-whatsapp-para-comunidade/`
- `/bot-whatsapp-para-loja-online/`
- `/bot-whatsapp-para-grupo-de-estudos/`
- `/bot-whatsapp-para-equipes-internas/`

### Cluster de dores (intenção alta)

- `/como-moderar-grupo-whatsapp/`
- `/como-evitar-spam-no-whatsapp/`
- `/como-organizar-comunidade-whatsapp/`
- `/como-automatizar-avisos-no-whatsapp/`
- `/como-criar-comandos-whatsapp/`

### Cluster comparativo (captura de decisão)

- `/melhor-bot-whatsapp-para-grupos/`
- `/omnizap-vs-blip/`
- `/omnizap-vs-zenvia/`
- `/omnizap-vs-huggy/`

### Cluster de feature (stickers como módulo)

- `/stickers-para-bot-whatsapp/`
- `/como-usar-stickers-no-bot/`
- `/pack-de-stickers-para-grupos/`

### Regra de interlink obrigatória

- Toda página satélite deve linkar para: `/`, `/api-docs/`, `/stickers/`.
- Toda página de pack deve linkar para: `/api-docs/`, `/`, `/stickers/`.
- Home deve apontar para satélites comerciais e satélites de dores.

## 3) Mapa de palavras-chave Brasil

### Head terms (alto volume)

- bot para WhatsApp
- chatbot para WhatsApp
- automação WhatsApp
- WhatsApp API
- bot para grupo WhatsApp

### Mid-tail (intenção de solução)

- bot para moderar grupo WhatsApp
- bot para comunidade WhatsApp
- bot para responder mensagens no WhatsApp
- bot para avisos automáticos WhatsApp
- bot de atendimento WhatsApp sem programar

### Long-tail (oportunidade de ranking rápido)

- como organizar grupo de WhatsApp automaticamente
- como evitar spam em grupo de WhatsApp com bot
- bot pronto para grupo de estudos no WhatsApp
- bot para loja online no WhatsApp sem configuração
- como adicionar bot no grupo do WhatsApp

### Keywords de módulo (stickers)

- sticker para bot WhatsApp
- pack de stickers para WhatsApp
- catálogo de stickers para bot
- stickers integrados via API

### Mapa por intenção

- Descoberta: "como", "o que é", "vale a pena".
- Consideração: "melhor", "comparativo", "preço", "funciona".
- Conversão: "adicionar bot", "testar bot", "bot pronto", "sem configuração".

## 4) Estratégia para ranquear antes dos concorrentes

### Fase 1 (dias 0-30) - ganhar velocidade

- Publicar 8-12 conteúdos long-tail de dor real (moderar, spam, avisos, comunidade).
- Criar comparativos orientados a decisão (sem ataque de marca; foco em aderência por cenário).
- Melhorar CTR com titles orientados a resultado: "em 1 minuto", "sem configuração", "sem programar".
- Revisar links internos para formar ciclo fechado entre Home -> API -> Stickers -> Packs.

### Fase 2 (dias 31-60) - escalar cobertura

- Expandir para satélites por nicho (comunidade, loja, estudo, creators).
- Criar template de prova social por caso de uso (antes/depois em métricas simples).
- Atualizar sitemap priorizando satélites novos e hubs de cluster.

### Fase 3 (dias 61-90) - defender posição

- Criar FAQ adicional por página (3-5 perguntas de objeção).
- Otimizar páginas em top 20 para top 10 (title, intro, links internos, schema).
- Construir backlinks contextuais (comunidades, creators, automação e WhatsApp).

### KPI alvo (90 dias)

- +30% impressões orgânicas (GSC) nas queries com "bot", "grupo", "WhatsApp".
- +20% CTR médio nas páginas comerciais.
- 20+ keywords long-tail em top 10.
- 5+ keywords comerciais em top 20.

## 5) Análise de concorrência nacional (snapshot)

### Camada 1: suites enterprise (fortes em marca e CAC)

1. Blip

- Sinal: posicionamento forte em WhatsApp + IA + vendas.
- Evidência pública: discurso de plataforma oficial e escala de mensagens/chatbots.
- Risco para OmniZap: domínio de termos institucionais/enterprise.
- Brecha para OmniZap: menor foco em "bot pronto para grupo em 1 minuto".

2. Zenvia

- Sinal: narrativa de customer cloud multicanal com WhatsApp no centro.
- Evidência pública: foco em automação, campanhas, API e atendimento.
- Risco para OmniZap: forte presença B2B para atendimento e vendas.
- Brecha para OmniZap: proposta mais orientada a suite do que a operação plug-and-play de comunidade.

3. Huggy

- Sinal: oferta de chatbot/atendimento com prova social de mercado.
- Evidência pública: foco em centralização de canais + automação 24/7.
- Risco para OmniZap: captura de mid-tail em atendimento WhatsApp.
- Brecha para OmniZap: menor foco em operação de grupos e moderação.

4. Leadster

- Sinal: força em marketing conversacional + WhatsApp.
- Evidência pública: foco em captação e qualificação de leads.
- Risco para OmniZap: ocupação de termos como "chatbot para vender".
- Brecha para OmniZap: menor profundidade em moderação/organização de grupos.

### Camada 2: nicho "bot para grupos" (fragmentado)

1. BotAdmin

- Foco: moderação de grupos, comandos e automação.
- Risco: captura de keywords de intenção alta (grupo/moderação).

2. AutoGrupo

- Foco: monetização de grupos pagos.
- Risco: captura de nicho creator/infoproduto.

3. Sites pequenos de "bot de figurinhas"

- Foco: cauda longa transacional de baixo ticket.
- Risco: volume pulverizado, qualidade média menor e alta capilaridade de indexação.

### Leitura competitiva objetiva

- Grandes players defendem termos amplos (chatbot, plataforma, API, atendimento).
- A oportunidade principal do OmniZap está no desconforto operacional de quem administra grupos.
- Melhor estratégia: dominar long-tail de dor + CTA de uso imediato + prova de simplicidade.

## 6) Prioridade de execução recomendada

1. Publicar satélites de dor (moderar, spam, avisos, organização).
2. Publicar satélites por público (comunidade, loja, estudo, creators).
3. Criar 3 comparativos leves (OmniZap vs suites enterprise por cenário de uso).
4. Fortalecer links internos e breadcrumbs semânticos.
5. Revisar FAQ/JSON-LD a cada 30 dias com base no Search Console.

## 7) Governança de execução

- Cadência editorial: semanal (publicação) e quinzenal (otimização).
- Revisão técnica: validar links, schema, canonical e renderização.
- Revisão de conteúdo: precisão factual, clareza e aderência à intenção.
- Critério de atualização: páginas abaixo da mediana de CTR por 28 dias devem entrar em refresh.

## 8) Fontes usadas nesta análise (snapshot 2026-02-28)

### Concorrência e mercado

- Blip (site oficial): https://www.blip.ai/
- Blip (plataforma): https://www.blip.ai/plataforma/
- Zenvia WhatsApp: https://www.zenvia.com/whatsapp/
- Zenvia Devs: https://www.zenvia.com/devs/
- Huggy (site oficial): https://www.huggy.io/
- Huggy WhatsApp: https://www.huggy.io/whatsapp
- Leadster: https://leadster.com.br/
- BotAdmin: https://botadmin.shop/
- AutoGrupo: https://autogrupo.com.br/
- DataReportal Brazil 2025: https://datareportal.com/reports/digital-2025-brazil

### Referências de SEO e conteúdo

- Google Search Central - SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Google Search Central - Helpful Content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Search Central - Title links: https://developers.google.com/search/docs/appearance/title-link
- Google Search Central - Snippets: https://developers.google.com/search/docs/appearance/snippet
- Schema.org FAQPage: https://schema.org/FAQPage
- Schema.org SoftwareApplication: https://schema.org/SoftwareApplication
- Rich Results Test: https://search.google.com/test/rich-results
