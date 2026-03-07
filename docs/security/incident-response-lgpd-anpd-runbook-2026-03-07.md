# Runbook de Resposta a Incidentes (LGPD/ANPD)

Data: 2026-03-07  
Escopo: segurança, privacidade e continuidade operacional do OmniZap System.

## 1) Objetivo

Estabelecer fluxo formal para:

- detecção, contenção e erradicação de incidentes;
- preservação de evidências técnicas e cadeia de custódia;
- decisão sobre comunicação à ANPD e aos titulares, quando aplicável;
- registro de lições aprendidas e prevenção de recorrência.

## 2) Classificação inicial de severidade

| Severidade | Critério resumido                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Crítica    | Exfiltração confirmada de dados/mensagens, indisponibilidade relevante, comprometimento de credenciais administrativas. |
| Alta       | Acesso não autorizado com potencial de dano relevante, impacto regulatório provável.                                    |
| Média      | Falha explorável com restrições relevantes, sem evidência de exfiltração.                                               |
| Baixa      | Evento de baixo impacto, sem risco material imediato.                                                                   |

## 3) Papéis e responsabilidades

- Líder de incidente: coordena resposta e decisões de prioridade.
- Segurança (SecOps): contenção técnica, coleta de IOC, análise de causa raiz.
- Produto/Engenharia: correção, rollback, validação e monitoramento pós-correção.
- Privacidade/Jurídico: análise LGPD, avaliação de risco ao titular, decisão de notificação.
- Comunicação: preparação de mensagens para clientes, titulares e partes interessadas.

## 4) Fluxo operacional (tempo de referência)

1. T+0 até T+30 min: abrir incidente, classificar severidade e acionar responsáveis.
2. T+30 min até T+2 h: isolar vetores, revogar tokens/sessões, aplicar bloqueios emergenciais.
3. T+2 h até T+6 h: identificar escopo afetado, coletar evidências e registrar timeline.
4. T+6 h até T+24 h: executar correções/migações e validar estabilidade.
5. T+24 h em diante: concluir RCA, ações preventivas e relatório final.

## 5) Gatilhos de comunicação à ANPD e titulares

Acionar avaliação formal de notificação quando houver, por indício mínimo:

- acesso não autorizado a dados pessoais com risco ou dano relevante;
- exposição de conteúdo integral de mensagens, credenciais ou dados sensíveis;
- comprometimento em larga escala de contas, grupos ou histórico de comunicação;
- indisponibilidade relevante com potencial de prejuízo material a titulares/clientes.

Critério jurídico: observar a LGPD (Lei nº 13.709/2018, art. 48) e regulamentações vigentes da ANPD.
Quando aplicável, considerar o prazo regulatório de 3 (três) dias úteis para comunicação, sem prejuízo de obrigações setoriais específicas.

## 6) Evidências mínimas obrigatórias

- linha do tempo do incidente (UTC e horário local);
- ativos afetados (serviços, banco, endpoints, credenciais);
- amostras de logs, hashes e identificadores técnicos;
- decisão técnica e jurídica de notificação (com justificativa);
- ações de contenção, correção e verificação pós-incidente.

## 7) Comunicação e rastreabilidade

- toda comunicação deve possuir ID de incidente;
- manter repositório interno com documentos e decisões;
- preservar logs de acesso a mensagens, quando aplicável, para auditoria.

## 8) Pós-incidente (obrigatório)

1. Executar reunião de lições aprendidas em até 5 dias úteis.
2. Converter causas-raiz em ações com responsável e prazo.
3. Atualizar runbooks, controles preventivos e checklist de compliance mensal.

## 9) Referências oficiais

- LGPD (Lei nº 13.709/2018): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD (portal institucional): https://www.gov.br/anpd/pt-br
- ANPD (comunicado de incidente de segurança - CIS): https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
