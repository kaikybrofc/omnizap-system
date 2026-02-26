# v2.1.2

Atualiza a versão para 2.1.2 e consolida o ciclo de entregas desde a `v2.1.1`.

Esta release foca em maturidade do produto e prontidão para produção: a camada web foi expandida (home, catálogo, API docs e páginas legais), o fluxo de sticker packs foi reforçado (incluindo melhor resolução para packs compartilhados/públicos) e a validação de identidade de admin foi aprimorada para cenários PN/JID/LID com mais confiabilidade.

## Destaques

- Atualizações da plataforma web:
  - Novas páginas públicas e ajustes de navegação (`/`, `/stickers/`, `/api-docs/`, termos/licença).
  - Melhorias de SEO (`robots.txt`, `sitemap.xml`, melhorias em OG/Twitter/meta).
  - Melhor responsividade em mobile (correções em navbar/cards/painel de ranking).
  - Inclusão de ícones Font Awesome e maior consistência visual.
- Sticker packs:
  - Fluxo de visibilidade padrão refinado para compartilhamento público.
  - Melhor identificação de pack no `pack send` (suporte a variações de key/link e resolução pública/não listada por `pack_key`).
  - Ações com deep-link para WhatsApp integradas no catálogo.
- Métricas e visibilidade do projeto:
  - Métricas de runtime do sistema exibidas nas páginas web.
  - Painel de resumo do projeto no GitHub integrado/refinado (stats, commits, releases, estados de loading/erro).
  - Blocos de ranking e comportamento de cache refinados para exibição no front-end.
- Admin e permissões:
  - Identidade de admin centralizada e normalizada.
  - Tratamento de `USER_ADMIN` agora suporta caminhos de conversão/normalização mais seguros.
  - Integração com `lidMapService` para validação canônica de identidade em comandos restritos ao dono (incluindo o fluxo de aviso).
- Runtime e manutenção:
  - Atualização de dependências e lockfile.
  - Alinhamento da fonte do Baileys e múltiplas melhorias de refatoração/limpeza.
  - Reforços pontuais em fluxos de mídia/sticker.

## Referências web

- Site: https://omnizap.shop/
- Stickers: https://omnizap.shop/stickers/
- API docs: https://omnizap.shop/api-docs/
- Terms: https://omnizap.shop/termos-de-uso/
- License: https://omnizap.shop/licenca/

## Notas

- Versão atualizada para `2.1.2` no `package.json`.
- Lockfile atualizado via `npm update`.
- Não há breaking change explícito neste ciclo de release, mas é recomendado revisar os valores de ambiente relacionados à identidade de admin (`USER_ADMIN`) e manter o processo de produção reiniciado após o deploy.
