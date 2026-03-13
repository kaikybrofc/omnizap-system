# Política de Segurança e Procedimento Operacional

Este documento estabelece:

- as diretrizes formais para tratamento de vulnerabilidades no Omnizap;
- o fluxo operacional (runbook) utilizado para triagem, correção e divulgação responsável.

## Objetivo e Aplicabilidade

Esta política se aplica ao código e aos ativos técnicos mantidos neste repositório, incluindo:

- código-fonte da aplicação;
- workflows e automações de CI/CD;
- dependências e configuração de build/publicação;
- componentes de execução e integração diretamente mantidos pelo projeto.

Não fazem parte do escopo obrigatório desta política:

- serviços de terceiros fora de controle do projeto;
- ambientes não oficiais, forks e deploys sem vínculo direto com o mantenedor.

## Versões Suportadas

Correções de segurança são priorizadas para o branch `main` e para a release estável mais recente.

| Canal                            | Suporte de segurança                       |
| -------------------------------- | ------------------------------------------ |
| `main`                           | Suportado                                  |
| Última release estável publicada | Suportado                                  |
| Releases anteriores              | Suporte limitado, sem garantia de correção |

## Canal Oficial de Reporte

Não abra issue pública para reportes de segurança.

Envie o reporte por e-mail para:

- `bot@omnizap.shop`

No assunto, utilize preferencialmente: `"[SECURITY] <resumo da vulnerabilidade>"`.

## Conteúdo Mínimo do Reporte

Para acelerar a análise, inclua:

- componente e versão afetados;
- pré-condições e passos de reprodução;
- impacto técnico e impacto de negócio;
- prova de conceito (PoC), quando aplicável;
- sugestões de mitigação;
- evidências técnicas (logs, payloads e respostas), sem dados sensíveis de terceiros.

## Classificação de Severidade e Meta de Resposta

| Severidade | Exemplo                                                         | Meta de triagem inicial     |
| ---------- | --------------------------------------------------------------- | --------------------------- |
| Crítica    | execução remota, vazamento sensível em produção                 | até 24 horas                |
| Alta       | bypass de autenticação/autorização, escalonamento de privilégio | até 72 horas                |
| Média      | falha explorável com restrições relevantes                      | até 7 dias corridos         |
| Baixa      | baixo impacto ou cenário de exploração limitado                 | conforme fila de manutenção |

Os prazos acima são metas operacionais e podem variar conforme complexidade, dependências externas e disponibilidade de correção segura.

## Runbook de Tratamento (Fluxo Operacional)

1. Recebimento e protocolo: confirmação de recebimento em até 72 horas.
2. Triagem técnica: validação de escopo, reprodução e classificação de severidade.
3. Contenção inicial: mitigação temporária, quando necessária.
4. Correção: implementação, revisão e validação em pipeline.
5. Publicação: disponibilização da correção no canal suportado.
6. Fechamento: comunicação ao pesquisador e registro das lições aprendidas.

## Divulgação Responsável

Solicitamos confidencialidade até que a correção ou mitigação oficial esteja disponível.

Quando aplicável, a comunicação pública ocorrerá por meio de:

- release notes/changelog;
- advisory de segurança;
- documentação técnica pertinente.

## Pesquisa em Boa-fé e Conduta Esperada

Ao realizar testes de segurança, não é permitido:

- indisponibilizar serviços intencionalmente (DoS/DDoS);
- acessar, alterar ou exfiltrar dados de terceiros;
- executar engenharia social, phishing ou ataques físicos;
- realizar testes destrutivos em ambientes de produção.

Reportes realizados de boa-fé, com respeito a esta política, serão tratados com prioridade técnica e comunicação responsável.

## Baseline de Hardening de Produção

Para hardening de rede e redução de superfície exposta (portas públicas, SSH e Nginx), consulte:

- [`docs/security/network-hardening-runbook-2026-03-07.md`](./docs/security/network-hardening-runbook-2026-03-07.md)

## Resposta a Incidentes com Critério LGPD/ANPD

Para resposta formal a incidentes com avaliação de gatilho de notificação regulatória, consulte:

- [`docs/security/incident-response-lgpd-anpd-runbook-2026-03-07.md`](./docs/security/incident-response-lgpd-anpd-runbook-2026-03-07.md)

## Compliance Operacional Mensal

Para acompanhamento mensal de conteúdo regulado, branding, contratos (DPA), governança de dados, notice-and-takedown e separação patrimonial, consulte:

- [`docs/compliance/monthly-compliance-checklist-2026-03-07.md`](./docs/compliance/monthly-compliance-checklist-2026-03-07.md)
