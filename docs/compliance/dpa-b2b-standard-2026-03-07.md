# DPA Padrao (B2B) - Data Processing Addendum

Versao: 2026-03-07  
Partes: Cliente (Controlador) e OmniZap System (Operador, quando atuar sob instrucao do Cliente).

## 1) Objeto

Este DPA define as obrigacoes de protecao de dados para tratamentos realizados em nome do Cliente, incluindo controles tecnicos, suboperadores e cooperacao em incidentes/DSAR.

## 2) Instrucoes do controlador

- O Operador trata dados apenas conforme instrucoes documentadas do Cliente.
- O Cliente declara possuir base legal adequada para os tratamentos ordenados.

## 3) Confidencialidade e acesso

- Acesso interno por necessidade operacional (need-to-know).
- Pessoas autorizadas ficam sujeitas a obrigacao de confidencialidade.

## 4) Seguranca da informacao

- Medidas minimas estao no Anexo II (organizacionais e tecnicas).
- O nivel de seguranca deve ser proporcional ao risco.

## 5) Suboperadores

- Lista atualizada no Anexo I e em `/suboperadores/`.
- Mudancas relevantes podem ser comunicadas ao Cliente conforme contrato principal.

## 6) Incidentes de seguranca

- Fluxo operacional no Anexo III.
- Cooperacao com Cliente para avaliacao de impacto e obrigacoes regulatorias.

## 7) Direitos de titulares (DSAR)

- Cooperacao conforme SLA do Anexo IV.
- O Cliente permanece responsavel pela decisao juridica final quando atuar como Controlador.

## 8) Retencao e descarte

- Retencao conforme instrucao contratual e exigencias legais.
- Ao termino da relacao, devolucao/eliminacao conforme viabilidade tecnica e clausulas do contrato principal.

## Anexo I - Suboperadores (resumo tecnico)

| Categoria           | Finalidade                                     | Exemplo de fornecedor     | Dados afetados                             |
| ------------------- | ---------------------------------------------- | ------------------------- | ------------------------------------------ |
| Cloud/Infra         | Hospedagem, banco e disponibilidade            | Provedor cloud contratado | Dados de conta, logs, conteudo operacional |
| E-mail transacional | Recuperacao de senha e comunicacao operacional | Provedor SMTP/e-mail      | E-mail, metadados de envio                 |
| Monitoramento       | Logs, metricas, alertas                        | Stack observabilidade     | Logs tecnicos e telemetria                 |

## Anexo II - Medidas de seguranca

- Criptografia em transito (TLS).
- Segmentacao logica de ambientes.
- Controle de acesso por papel e minimo privilegio.
- Registro de eventos criticos (auth, erro, seguranca).
- Processo de patching e hardening.
- Backup operacional e testes de restauracao.

## Anexo III - Fluxo de incidente

1. Deteccao e classificacao inicial.
2. Contencao tecnica e preservacao de evidencias.
3. Comunicacao ao Cliente sem atraso indevido (quando houver impacto relevante).
4. Mitigacao, RCA e acoes corretivas.
5. Apoio para reporte regulatorio quando aplicavel.

## Anexo IV - SLA de cooperacao (DSAR e incidente)

| Evento                           | SLA alvo             |
| -------------------------------- | -------------------- |
| Ack de incidente critico         | ate 4h uteis         |
| Atualizacao inicial de incidente | ate 24h              |
| Evidencias tecnicas preliminares | ate 48h              |
| Apoio para DSAR simples          | ate 5 dias corridos  |
| Apoio para DSAR complexo         | ate 10 dias corridos |

Observacao: prazos legais do controlador prevalecem quando menores.
