# OmniZap SEO Playbook BR (2026-02-28)

Objetivo: posicionar OmniZap como "bot pronto para WhatsApp" para usuario final, mantendo stickers como feature de aquisicao e expansao.

## Status de execucao (2026-02-28)

- Primeira leva de satelites fase 1 publicada:
  - `/bot-whatsapp-para-grupo/`
  - `/como-moderar-grupo-whatsapp/`
  - `/como-evitar-spam-no-whatsapp/`
  - `/como-organizar-comunidade-whatsapp/`
  - `/como-automatizar-avisos-no-whatsapp/`
  - `/como-criar-comandos-whatsapp/`
  - `/melhor-bot-whatsapp-para-grupos/`
  - `/bot-whatsapp-sem-programar/`
- Hub comercial publicado para conversao de comandos:
  - `/comandos/`
- Template padrao para escala em lote:
  - Gerador: `scripts/generate-seo-satellite-pages.mjs`
  - Config principal: `docs/seo/satellite-pages-phase1.json`
  - Guia de uso: `docs/seo/satellite-page-template.md`

## 1) FAQ + JSON-LD pronta

Status implementado no projeto:

- Home (`/`): FAQ visual + `FAQPage` JSON-LD alinhado ao posicionamento "adicionar e usar".
- Catalogo (`/stickers/`): `FAQPage` JSON-LD no HTML publico.
- Pack (`/stickers/{packKey}`): `FAQPage` JSON-LD dinamico no HTML SEO server-side.
- API Docs (`/api-docs/`): ja possui `SoftwareApplication` + `FAQPage`.

Checklist tecnico para manter:

- FAQ da pagina deve bater 1:1 com o JSON-LD.
- Linguagem da FAQ deve seguir intencao da pagina (usuario final na home, integracao no cluster tecnico).
- Atualizar data de cache-bust quando houver mudanca textual relevante.

## 2) Estrategia de paginas satelite para dominar Google

Observacao: abaixo esta o mapa estrategico de satelites. A fase 1 foi publicada e os demais itens seguem como backlog de expansao.

### Cluster principal (comercial)

- `/bot-whatsapp-para-grupo/`
- `/bot-whatsapp-para-comunidade/`
- `/bot-whatsapp-para-loja-online/`
- `/bot-whatsapp-para-grupo-de-estudos/`
- `/bot-whatsapp-para-equipes-internas/`

### Cluster dores (intencao alta)

- `/como-moderar-grupo-whatsapp/`
- `/como-evitar-spam-no-whatsapp/`
- `/como-organizar-comunidade-whatsapp/`
- `/como-automatizar-avisos-no-whatsapp/`
- `/como-criar-comandos-whatsapp/`

### Cluster comparativo (captura de decisao)

- `/melhor-bot-whatsapp-para-grupos/`
- `/omnizap-vs-blip/`
- `/omnizap-vs-zenvia/`
- `/omnizap-vs-huggy/`

### Cluster de feature (stickers como modulo)

- `/stickers-para-bot-whatsapp/`
- `/como-usar-stickers-no-bot/`
- `/pack-de-stickers-para-grupos/`

### Regra de interlink obrigatoria

- Toda pagina satelite linka para: `/`, `/api-docs/`, `/stickers/`.
- Toda pagina de pack linka para: `/api-docs/` + `/` + `/stickers/`.
- Home aponta para satelites comerciais e para dores.

## 3) Mapa de palavras-chave Brasil

### Head terms (topo de volume)

- bot para whatsapp
- chatbot para whatsapp
- automacao whatsapp
- whatsapp api
- bot para grupo whatsapp

### Mid-tail (intencao de solucao)

- bot para moderar grupo whatsapp
- bot para comunidade whatsapp
- bot para responder mensagens no whatsapp
- bot para avisos automaticos whatsapp
- bot de atendimento whatsapp sem programar

### Long-tail (oportunidade de rank rapido)

- como organizar grupo de whatsapp automaticamente
- como evitar spam em grupo de whatsapp com bot
- bot pronto para grupo de estudos no whatsapp
- bot para loja online no whatsapp sem configuracao
- como adicionar bot no grupo do whatsapp

### Keywords de modulo (stickers)

- sticker para bot whatsapp
- pack de stickers para whatsapp
- catalogo de stickers para bot
- stickers integrados via api

### Mapa por intencao

- Descoberta: "como", "o que e", "vale a pena".
- Consideracao: "melhor", "comparativo", "preco", "funciona".
- Conversao: "adicionar bot", "testar bot", "bot pronto", "sem configuracao".

## 4) Estrategia para ranquear antes dos concorrentes

### Fase 1 (dias 0-30) - ganhar velocidade

- Publicar 8-12 conteudos long-tail de dor real (moderar, spam, avisos, comunidade).
- Criar comparativos orientados a decisao (sem ataque de marca, foco em "para quem serve").
- Fortalecer CTR com titles de resultado: "em 1 minuto", "sem configuracao", "sem programar".
- Revisar links internos para formar ciclo fechado entre Home -> API -> Stickers -> Packs.

### Fase 2 (dias 31-60) - escalar cobertura

- Expandir para paginas satelite por nicho (comunidade, loja, estudo, creators).
- Criar template de prova social por caso de uso (antes/depois em metricas simples).
- Atualizar sitemap com prioridade para novas satelites e hubs de cluster.

### Fase 3 (dias 61-90) - defender posicao

- Criar FAQ adicional por pagina (3-5 perguntas de objecao).
- Otimizar paginas que baterem top 20 para top 10 (title, intro, links internos, schema).
- Construir backlinks de contexto (comunidades, blogs de creators, automacao e WhatsApp).

### KPI alvo (90 dias)

- +30% impressoes organicas (GSC) nas queries com "bot", "grupo", "whatsapp".
- +20% CTR medio nas paginas comerciais.
- 20+ keywords long-tail em top 10.
- 5+ keywords comerciais em top 20.

## 5) Analise de concorrencia nacional (snapshot)

### Camada 1: suites enterprise (fortes em marca e CAC)

1. Blip

- Sinal: posicionamento forte em WhatsApp + IA + vendas.
- Evidencia publica: "plataforma oficial", numeros altos de mensagens/chatbots.
- Risco para OmniZap: domina termos genericos institucionais e enterprise.
- Brecha para OmniZap: pouca proposta "bot pronto para grupo em 1 minuto".

2. Zenvia

- Sinal: narrativa de Customer Cloud multicanal com WhatsApp no centro.
- Evidencia publica: foco em automacoes, campanhas, API e atendimento.
- Risco para OmniZap: forte presenca B2B em termos de atendimento e vendas.
- Brecha para OmniZap: proposta da Zenvia tende a ser mais "suite" e menos "plug-and-play para comunidade".

3. Huggy

- Sinal: oferta de chatbot/atendimento, com claim de 4000 negocios.
- Evidencia publica: foco em centralizacao de canais + automacao 24/7.
- Risco para OmniZap: captura media-tail de atendimento WhatsApp.
- Brecha para OmniZap: mensagem menos focada em "grupo/comunidade".

4. Leadster

- Sinal: entrada forte em marketing conversacional + WhatsApp.
- Evidencia publica: foco em captacao e qualificacao de leads.
- Risco para OmniZap: ocupa termos de "chatbot para vender".
- Brecha para OmniZap: menos foco em operacao de grupos e moderacao.

### Camada 2: nicho "bot para grupos" (fragmentado)

1. BotAdmin

- Foco: moderacao de grupos, comandos e automacao.
- Risco: pode capturar suas palavras exatas de intencao alta (grupo/moderacao).

2. AutoGrupo

- Foco: monetizacao de grupos pagos.
- Risco: captura nicho de creators infoproduto.

3. Sites pequenos de "bot de figurinhas"

- Foco: termos de cauda longa e transacional de baixo ticket.
- Risco: volume pulverizado, baixa qualidade media, mas alta capilaridade de indexacao.

### Leitura competitiva objetiva

- Grandes players defendem termos amplos (chatbot, plataforma, API, atendimento).
- Oportunidade real de OmniZap esta no "desconforto operacional" de quem administra grupos.
- Melhor estrategia: dominar long-tail de dor + CTA de uso imediato.

## 6) Prioridade de execucao recomendada

1. Publicar satelites de dor (moderar, spam, avisos, organizar grupo).
2. Publicar satelites por publico (comunidade, loja, estudo, creators).
3. Criar 3 comparativos leves (OmniZap vs suites enterprise por cenario de uso).
4. Fortalecer links internos e breadcrumbs semanticos.
5. Revisar FAQ/JSON-LD a cada 30 dias com base em Search Console.

## 7) Fontes usadas nesta analise (snapshot 2026-02-28)

- Blip (site oficial): https://www.blip.ai/
- Blip (solucoes/plataforma): https://www.blip.ai/plataforma/
- Zenvia WhatsApp: https://www.zenvia.com/whatsapp/
- Zenvia Devs: https://www.zenvia.com/devs/
- Huggy (site oficial): https://www.huggy.io/
- Huggy WhatsApp: https://www.huggy.io/whatsapp
- Leadster: https://leadster.com.br/
- BotAdmin: https://botadmin.shop/
- AutoGrupo: https://autogrupo.com.br/
- DataReportal Brazil 2025: https://datareportal.com/reports/digital-2025-brazil
- Semrush snapshot blip.ai: https://pt.semrush.com/website/blip.ai/overview/
- Semrush snapshot gruposwhats.app: https://pt.semrush.com/website/gruposwhats.app/overview/
