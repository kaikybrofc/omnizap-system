# Runbook DSAR/LGPD (Direitos do Titular)

Data: 2026-03-07

## 1) Objetivo

Padronizar resposta para direitos do titular: acesso, correcao, exclusao, oposicao e portabilidade.

## 2) Canais de entrada

- WhatsApp oficial: https://wa.me/559591122954
- Canal interno de compliance (registro em ticket obrigatorio)

## 3) Papéis e responsaveis

- DPO/Privacidade (owner do caso): valida base legal e resposta final.
- Engenharia: localiza dados, executa exportacao/correcao/exclusao.
- Seguranca: valida risco e cadeia de evidencia.
- Suporte: confirma identidade e comunica status ao titular.

## 4) Prazos operacionais

| Tipo de solicitacao                        | Prazo alvo interno   |
| ------------------------------------------ | -------------------- |
| Confirmacao de recebimento                 | ate 2 dias corridos  |
| Acesso/confirmacao de tratamento           | ate 7 dias corridos  |
| Correcao                                   | ate 7 dias corridos  |
| Exclusao/anonimizacao (quando cabivel)     | ate 15 dias corridos |
| Oposicao/revisao                           | ate 10 dias corridos |
| Portabilidade (quando tecnicamente viavel) | ate 15 dias corridos |

Observacao: prevalecem prazos legais aplicaveis quando menores.
Para pedidos enquadrados no art. 19 da LGPD, observar resposta simplificada imediata quando possivel e declaracao clara/completa em ate 15 dias.

## 5) Fluxo operacional

1. Registrar ticket com ID unico e timestamp UTC.
2. Confirmar identidade minima do solicitante.
3. Classificar direito solicitado e base juridica.
4. Mapear sistemas/tabelas afetadas.
5. Executar acao tecnica (consulta, ajuste, exclusao, exportacao).
6. Revisao juridica/privacidade.
7. Responder titular com protocolo e resumo da acao.
8. Encerrar com evidencias anexas e metricas de SLA.

## 6) Matriz por direito

### 6.1 Acesso

- Entregar resumo dos dados tratados e finalidades.
- Incluir categorias, origem e compartilhamentos principais.

### 6.2 Correcao

- Corrigir dado incompleto/inexato/desatualizado.
- Registrar antes/depois e fundamento da alteracao.

### 6.3 Exclusao

- Eliminar ou anonimizar quando nao houver base legal de retencao.
- Se houver retencao obrigatoria, informar bloqueio e justificativa.

### 6.4 Oposicao

- Avaliar legitimidade do pedido conforme base legal aplicavel.
- Suspender tratamento contestado quando juridicamente cabivel.

### 6.5 Portabilidade

- Fornecer formato estruturado e interoperavel quando tecnicamente viavel.
- Excluir segredos comerciais e dados de terceiros nao transferiveis.

## 7) Evidencias obrigatorias

- ID do ticket, timestamps e responsaveis por etapa.
- Comprovante de identidade validado.
- Consulta tecnica executada e resultado.
- Mensagem de resposta final ao titular.

## 8) Escalonamento

Escalonar para juridico + seguranca quando houver:

- risco de incidente de seguranca;
- pedido envolvendo alto volume de titulares;
- conflito entre pedido e obrigacao legal de retencao.
