<img width="1318" height="352" alt="OmniZap banner" src="https://github.com/user-attachments/assets/d44835e7-021a-4c67-a0e7-5b858d51eb91" />

# OmniZap System

Plataforma de automacao para WhatsApp com foco em figurinhas, packs, catalogo web e comandos inteligentes.

## Links oficiais

- Site: https://omnizap.shop/
- Login web: https://omnizap.shop/login/
- Painel do usuario: https://omnizap.shop/user/
- Catalogo de figurinhas: https://omnizap.shop/stickers/
- API Docs: https://omnizap.shop/api-docs/
- Termos de uso: https://omnizap.shop/termos-de-uso/
- Licenca: https://omnizap.shop/licenca/

## Como comecar (usuario final)

1. Abra o WhatsApp e envie `iniciar` para o bot.
2. Use o link seguro recebido para abrir o login web.
3. Faça login com Google para vincular sua conta.
4. Volte para o WhatsApp e use os comandos de figurinha e pack.
5. Acesse o painel em `https://omnizap.shop/user/` para gerenciar seus packs.

## Experiencia OmniZap

- Login seguro com Google e vinculacao ao numero do WhatsApp.
- Sessao web compartilhada entre as paginas (login unico).
- Criacao de packs com capa, descricao, tags e visibilidade.
- Catalogo publico com busca por packs e figurinhas.
- Comandos rapidos para transformar imagem/video/texto em sticker.

## Comandos mais usados no WhatsApp

O prefixo pode variar no seu grupo. Nos exemplos abaixo, foi usado `/`.

- `/s` ou `/sticker`: cria figurinha da midia respondida.
- `/st`, `/stw`, `/stb`: sticker de texto (normal, branco, blink).
- `/toimg`: converte figurinha para imagem.
- `/pack create "Meu Pack"`: cria um novo pack.
- `/pack add <pack>`: adiciona a ultima figurinha no pack.
- `/pack list`: lista seus packs.
- `/pack send <pack>`: envia figurinhas de um pack.
- `/pack publish <pack> <public|private|unlisted>`: define visibilidade.
- `/user perfil`: mostra dados e resumo do usuario.

## Fluxo rapido de packs

1. Crie o pack com `/pack create "Nome do Pack"`.
2. Gere figurinhas com `/s` e adicione com `/pack add <pack>`.
3. Confira com `/pack list`.
4. Publique com `/pack publish <pack> public`.
5. Veja no catalogo web em `https://omnizap.shop/stickers/`.

## Paginas web principais

- `/login/`: autenticacao e vinculacao da conta.
- `/user/`: painel com perfil, estatisticas e seus packs.
- `/stickers/`: busca de packs publicados e visualizacao das figurinhas.

## Nao estou vendo meu pack. E agora?

- Confirme se o pack foi publicado com visibilidade correta.
- Rode `/pack list` para validar se o pack esta na sua conta.
- No painel `/user/`, verifique se voce esta logado com o mesmo Google usado no WhatsApp.
- Se estiver em outra conta/sessao antiga, saia e faça login novamente.

## Boas praticas

- Nao compartilhe o link de login recebido no WhatsApp.
- Use apenas o dominio oficial `omnizap.shop`.
- Revise os termos antes de publicar conteudo publico.

## Snapshot dinamico do sistema

Este bloco pode ser atualizado automaticamente pela API (`/api/sticker-packs/readme-markdown`).

<!-- README_SNAPSHOT:START -->
### Snapshot do Sistema

> Atualizado em `2026-03-03T03:25:15.320Z` | cache `1800s`

| Métrica | Valor |
| --- | ---: |
| Usuários (lid_map) | 5.537 |
| Grupos | 119 |
| Packs | 324 |
| Stickers | 8.589 |
| Mensagens registradas | 461.280 |

#### Tipos de mensagem mais usados (amostra: 25.000)
| Tipo | Total |
| --- | ---: |
| `texto` | 14.810 |
| `figurinha` | 4.582 |
| `imagem` | 2.210 |
| `reacao` | 1.501 |
| `outros` | 1.474 |
| `audio` | 211 |
| `video` | 209 |
| `documento` | 3 |

<details><summary>Comandos disponíveis (62)</summary>

`/add` · `/addmode` · `/autorequests` · `/autosticker` · `/ban` · `/captcha` · `/cat` · `/catimg` · `/catprompt` · `/catprompt reset` · `/dado` · `/down` · `/farewell` · `/groups` · `/info` · `/invite` · `/join` · `/leave` · `/menu anime` · `/menu figurinhas` · `/menu ia` · `/menu midia` · `/menu quote` · `/menu stats` · `/menuadm` · `/metadata` · `/newgroup` · `/noticias` · `/nsfw` · `/pack add` · `/pack create` · `/pack list` · `/pack send` · `/ping` · `/play` · `/playvid` · `/prefix` · `/premium` · `/quote` · `/ranking` · `/rankingglobal` · `/requests` · `/revoke` · `/s` · `/semmsg` · `/setdesc` · `/setgroup` · `/setsubject` · `/st` · `/stb` · `/sticker` · `/stickertext` · `/stickertextblink` · `/stickertextwhite` · `/stw` · `/temp` · `/tiktok` · `/toimg` · `/up` · `/updaterequests` · `/user perfil` · `/welcome`

</details>
<!-- README_SNAPSHOT:END -->

## Suporte

- Canal principal: https://omnizap.shop/
- Para problemas de acesso/login, gere um novo link enviando `iniciar` no WhatsApp do bot.

## Licenca

Licenca MIT. Consulte o arquivo `LICENSE`.
