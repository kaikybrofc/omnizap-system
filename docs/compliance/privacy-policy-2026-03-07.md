# Politica de Privacidade (Documento Separado dos Termos)

Data da versao: 2026-03-07  
Escopo: site, login web, painel, API e operacao de automacao do OmniZap System.

## 0) Escopo desta politica (servico oficial)

- Esta politica se aplica ao servico oficial operado pelos canais do OmniZap System (incluindo dominio omnizap.shop e endpoints oficiais).
- Forks, redistribuicoes e instancias auto-hospedadas por terceiros nao se vinculam automaticamente a este documento.
- Em instancia derivada/self-host, o operador da instancia atua como controlador independente e deve publicar sua propria politica de privacidade.

## 1) Controlador e contato

- Controlador: 59.034.123 KAIKY BRITO RIBEIRO (CNPJ 59.034.123/0001-96).
- Contato de privacidade: https://wa.me/559591122954
- Canal para titulares (LGPD): mensagem com assunto "DSAR LGPD" no contato oficial.
- Para servicos de terceiros baseados em fork/self-host, o contato de privacidade deve ser solicitado diretamente ao operador da respectiva instancia.

## 1.1) Encarregado pelo tratamento (LGPD art. 41)

- Encarregado (DPO): Kaiky Brito Ribeiro (59.034.123 KAIKY BRITO RIBEIRO, CNPJ 59.034.123/0001-96).
- Contato do encarregado: https://wa.me/559591122954 (assunto recomendado: "ENCARREGADO LGPD").
- Divulgacao publica mantida para transparencia regulatoria.

## 2) Tabela de tratamento de dados

| Categoria de dados                                                           | Finalidade principal                                   | Base legal (LGPD art. 7)                                                            | Prazo de retencao                                                        | Compartilhamentos                               | Transferencia internacional                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------- |
| Identificacao de conta (sub Google, e-mail, owner_jid)                       | Autenticacao, seguranca de sessao e vinculo de conta   | Execucao de contrato; legitimo interesse                                            | Enquanto a conta estiver ativa + ate 12 meses para trilha tecnica        | Provedores de cloud, autenticao e e-mail        | Pode ocorrer quando fornecedor tiver infraestrutura fora do Brasil  |
| Credenciais e eventos de login (sessao, IP, user agent, aceite juridico)     | Prevenir fraude, auditoria e prova de consentimento    | Legitimo interesse; exercicio regular de direitos; obrigacao legal quando aplicavel | Ate 24 meses, salvo retencao superior por obrigacao legal                | Provedores de cloud/seguranca/monitoramento     | Pode ocorrer via suboperadores globais com salvaguardas contratuais |
| Conteudo de mensagens e metadados (quando funcionalidade estiver habilitada) | Execucao de automacoes, moderacao, suporte e seguranca | Execucao de contrato; legitimo interesse; consentimento quando exigido              | Conforme finalidade declarada pelo cliente e politicas tecnicas vigentes | Infraestrutura de processamento e armazenamento | Pode ocorrer conforme regiao do provedor contratado                 |
| Logs de API, erros e telemetria                                              | Observabilidade, capacidade, resposta a incidentes     | Legitimo interesse                                                                  | 6 a 24 meses, conforme criticidade operacional                           | Monitoramento e observabilidade                 | Pode ocorrer (fornecedores globais)                                 |
| Dados de suporte (tickets, e-mails, evidencias)                              | Atendimento, correcoes e historico de suporte          | Execucao de contrato; exercicio regular de direitos                                 | Ate 5 anos para defesa administrativa/judicial, quando cabivel           | Plataforma de e-mail e atendimento              | Pode ocorrer conforme local de processamento do provedor            |

## 3) Compartilhamento de dados

- Compartilhamos somente com suboperadores e parceiros estritamente necessarios para operar o servico.
- Compartilhamos com autoridades publicas quando houver obrigacao legal, ordem judicial ou requisicao valida.
- Nao comercializamos dados pessoais como produto.

## 4) Transferencias internacionais

- Alguns fornecedores podem processar dados fora do Brasil.
- As transferencias internacionais seguem salvaguardas contratuais, controles tecnicos e avaliacao de risco compativeis com a LGPD e regulamentacao da ANPD.
- Mecanismos adotados podem incluir clausulas contratuais e avaliacao por finalidade/risco.
- O inventario de suboperadores publicado em `/suboperadores/` informa categoria e status de localizacao/regiao.

## 5) Retencao e descarte

- Mantemos dados somente pelo tempo necessario para as finalidades legitimas e exigencias legais.
- Encerrada a finalidade, os dados podem ser anonimizados, bloqueados ou eliminados, ressalvadas obrigacoes legais e necessidade probatoria.

## 6) Direitos do titular (art. 18 LGPD)

- Confirmacao de tratamento e acesso.
- Correcao de dados incompletos ou desatualizados.
- Anonimizacao, bloqueio ou eliminacao quando cabivel.
- Portabilidade (quando tecnicamente viavel).
- Oposicao e revisao de tratamento nas hipoteses legais.
- Peticao perante ANPD e autoridades competentes, quando cabivel.
- Quando aplicavel, declaracao clara e completa em ate 15 dias (LGPD art. 19), sem prejuizo de resposta simplificada imediata quando possivel.

Prazos operacionais e fluxo completo: ver `docs/security/dsar-lgpd-runbook-2026-03-07.md`.

## 7) Seguranca

- Criptografia em transito (TLS), controles de acesso por privilegio minimo, logs e trilhas de auditoria.
- Monitoramento tecnico e resposta a incidentes com criterio LGPD/ANPD.
- Havendo incidente com risco ou dano relevante aos titulares, comunicacao a ANPD e aos titulares sera avaliada e realizada quando exigida por lei/regulamentacao.
- Quando aplicavel ao controlador, observar prazo regulatorio vigente para comunicacao de incidente (incluindo 3 dias uteis previstos no regulamento atual da ANPD).

## 8) Atualizacoes desta politica

- Esta politica pode ser atualizada para refletir mudancas legais, regulatorias e operacionais.
- Versoes e aceite eletronico podem ser registrados para prova juridica (hash da versao, timestamp, IP e user agent).
