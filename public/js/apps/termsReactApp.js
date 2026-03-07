import React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(React.createElement);

const TERMS_CONTENT_HTML = String.raw`
      <nav class="top" aria-label="Navegação">
        <a href="/">Início</a>
        <a href="/stickers/">Stickers</a>
        <a href="/api-docs/">API</a>
        <a href="/licenca/">Licença</a>
      </nav>

      <section class="card">
        <h1>Termos de Uso</h1>
        <p class="updated">Última atualização: 07/03/2026</p>
        <p class="note"><strong>Contato oficial (WhatsApp):</strong> +55 95 9112-2954 (número no link: 559591122954).</p>
        <div class="contact-actions" aria-label="Acesso rápido aos contatos">
          <a class="contact-btn wa" href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">WhatsApp oficial</a>
          <a class="contact-btn ig" href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">Instagram @kaikybrofc</a>
        </div>
        <p class="note"><strong>Aviso institucional:</strong> o OmniZap System é um <strong>projeto independente e não oficial</strong>, sem autorização, afiliação ou endosso da Meta Platforms, Inc.</p>
        <p>Este instrumento regula o acesso e uso do site, API, painel e funcionalidades de automação disponibilizadas pelo OmniZap System.</p>
        <p>Ao utilizar a plataforma, o usuário declara ciência e concordância integral com estes Termos de Uso e com a seção de privacidade constante neste documento.</p>
      </section>

      <section class="card">
        <h2>1. Identificação do responsável</h2>
        <ul>
          <li>Responsável/Titular: <strong>Kaiky Brito Ribeiro</strong>.</li>
          <li>Nome empresarial: <strong>59.034.123 KAIKY BRITO RIBEIRO</strong>.</li>
          <li>CNPJ: <strong>59.034.123/0001-96</strong>.</li>
          <li>UF do registro: <strong>RR</strong>.</li>
          <li>Canal de contato principal: <a href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">https://wa.me/559591122954</a>.</li>
        </ul>
      </section>

      <section class="card">
        <h2>2. Aceitação, vigência e capacidade civil</h2>
        <ul>
          <li>O uso da plataforma caracteriza aceite eletrônico, livre e informado destes Termos.</li>
          <li>O usuário declara possuir capacidade civil para contratar ou, quando aplicável, estar assistido/representado por responsável legal.</li>
          <li>Se o usuário atuar em nome de pessoa jurídica, declara possuir poderes para vincular a organização a este instrumento.</li>
          <li>Estes Termos permanecem vigentes enquanto houver uso da plataforma ou obrigações legais/contratuais pendentes.</li>
        </ul>
      </section>

      <section class="card">
        <h2>3. Definições contratuais</h2>
        <ul>
          <li><strong>Plataforma:</strong> ambiente digital OmniZap System (site, API, integrações e painel).</li>
          <li><strong>Usuário:</strong> pessoa natural ou jurídica que acessa ou utiliza a plataforma.</li>
          <li><strong>Conta:</strong> credencial de acesso vinculada a usuário, e-mail e/ou identificadores técnicos.</li>
          <li><strong>Dados pessoais:</strong> informações relacionadas a pessoa natural identificada ou identificável, nos termos da LGPD.</li>
          <li><strong>Operador:</strong> terceiro que trata dados em nome do controlador, conforme art. 5º, VII, da LGPD.</li>
        </ul>
      </section>

      <section class="card">
        <h2>4. Objeto e escopo de uso</h2>
        <ul>
          <li>Estes Termos se aplicam a todo uso do site, API, painel administrativo e módulos de automação do OmniZap System.</li>
          <li>A plataforma possui finalidade técnica e educacional, sem prejuízo de usos operacionais legítimos pelo usuário.</li>
          <li>O usuário é integralmente responsável pela regularidade jurídica do uso que fizer do sistema em seu contexto de negócio.</li>
        </ul>
      </section>

      <section class="card">
        <h2>5. Cadastro, autenticação e segurança da conta</h2>
        <ul>
          <li>O usuário deve fornecer dados verdadeiros, atualizados e completos para cadastro e manutenção da conta.</li>
          <li>Credenciais, tokens e sessões são pessoais e intransferíveis, cabendo ao usuário o dever de guarda e sigilo.</li>
          <li>O responsável pela conta responde pelas ações realizadas com suas credenciais, inclusive por terceiros autorizados ou não.</li>
          <li>Podem ser aplicadas medidas adicionais de verificação de identidade em hipóteses de risco, fraude, abuso ou exigência legal.</li>
        </ul>
        <h3>5.1 Redefinição de senha e controles antiabuso</h3>
        <ul>
          <li>Fluxos de recuperação de acesso podem exigir e-mail válido, token temporário, expiração automática e uso único do link.</li>
          <li>Podem ser aplicados limite de tentativas, janela mínima entre solicitações e bloqueio temporário por comportamento suspeito.</li>
          <li>Eventos críticos de segurança podem ser registrados para trilha de auditoria e prevenção de incidentes.</li>
        </ul>
      </section>

      <section class="card">
        <h2>6. Uso permitido e condutas proibidas</h2>
        <ul>
          <li>É permitido utilizar a plataforma para automação e integração, desde que observadas a legislação aplicável e as políticas de terceiros integrados.</li>
          <li>É vedado o uso para spam, fraude, phishing, engenharia social, assédio, malware, invasão de sistemas ou qualquer prática ilícita.</li>
          <li>É vedada a coleta, o tratamento ou o compartilhamento de dados de terceiros sem base legal adequada.</li>
          <li>É vedado testar vulnerabilidades, realizar varreduras agressivas ou provocar degradação de serviço sem autorização formal prévia.</li>
          <li>O usuário responderá civil, administrativa e criminalmente por conteúdo e operações executadas por sua conta.</li>
        </ul>
      </section>

      <section class="card">
        <h2>7. Tratamento de dados e fundamentos jurídicos</h2>
        <p>O tratamento de dados pessoais poderá ocorrer, conforme o caso concreto, com fundamento nas bases legais do art. 7º da LGPD, incluindo:</p>
        <ul>
          <li>execução de contrato e de procedimentos preliminares relacionados à contratação;</li>
          <li>cumprimento de obrigação legal ou regulatória;</li>
          <li>exercício regular de direitos em processo judicial, administrativo ou arbitral;</li>
          <li>legítimo interesse do controlador, observados direitos e liberdades fundamentais do titular;</li>
          <li>consentimento, quando exigido pela legislação aplicável.</li>
        </ul>
      </section>

      <section class="card">
        <h2 id="politica-de-privacidade">8. Política de Privacidade (termos complementares)</h2>
        <ul>
          <li><strong>Finalidade:</strong> dados são tratados para operação da plataforma, autenticação, segurança, suporte e evolução técnica do serviço.</li>
          <li><strong>Necessidade:</strong> coleta limitada ao mínimo necessário para execução das funcionalidades contratadas/ativadas.</li>
          <li><strong>Transparência:</strong> este documento descreve categorias de dados, finalidades e hipóteses de compartilhamento.</li>
          <li><strong>Qualidade dos dados:</strong> o titular poderá solicitar correções de dados incompletos, inexatos ou desatualizados.</li>
          <li><strong>Segurança:</strong> são adotadas medidas técnicas e administrativas razoáveis para redução de risco de acesso indevido ou vazamento.</li>
          <li><strong>Não comercialização:</strong> dados pessoais não são comercializados como produto.</li>
        </ul>
      </section>

      <section class="card">
        <h2>9. Direitos do titular (LGPD)</h2>
        <p>Nos termos do art. 18 da Lei nº 13.709/2018 (LGPD), o titular poderá requerer, quando cabível:</p>
        <ul>
          <li>confirmação da existência de tratamento e acesso aos dados;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;</li>
          <li>portabilidade, eliminação de dados tratados com consentimento e informação sobre compartilhamentos;</li>
          <li>revogação do consentimento e oposição ao tratamento, observados os limites legais.</li>
        </ul>
        <p>Para exercício de direitos e demandas de privacidade:</p>
        <div class="contact-actions" aria-label="Contatos para privacidade">
          <a class="contact-btn wa" href="https://wa.me/559591122954?text=Ol%C3%A1%2C%20gostaria%20de%20exercer%20meus%20direitos%20de%20titular%20de%20dados%20(LGPD)." target="_blank" rel="noreferrer noopener">Solicitar via WhatsApp</a>
          <a class="contact-btn ig" href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">Contato no Instagram</a>
        </div>
      </section>

      <section class="card">
        <h2>10. Compartilhamento, operadores e transferência internacional</h2>
        <ul>
          <li>Poderá haver compartilhamento com operadores e fornecedores de infraestrutura, monitoramento, autenticação, comunicação e suporte.</li>
          <li>Compartilhamentos com terceiros ocorrerão no limite necessário para execução das finalidades legítimas da plataforma.</li>
          <li>Dados poderão ser fornecidos a autoridades públicas mediante obrigação legal, ordem judicial ou requisição válida.</li>
          <li>Em transferências internacionais, serão adotadas salvaguardas compatíveis com a legislação brasileira de proteção de dados.</li>
        </ul>
      </section>

      <section class="card">
        <h2>11. Retenção, registros e evidências digitais</h2>
        <ul>
          <li>Dados e logs podem ser armazenados pelo período necessário para cumprimento de finalidades contratuais, segurança e obrigações legais.</li>
          <li>Quando aplicável ao modelo operacional da plataforma, registros de acesso a aplicações poderão ser mantidos nos termos do Marco Civil da Internet.</li>
          <li>Backups e registros de auditoria podem subsistir por prazo adicional para continuidade, recuperação e integridade probatória.</li>
          <li>Após o término da finalidade, os dados poderão ser eliminados, bloqueados ou anonimizados, ressalvadas hipóteses legais de retenção.</li>
        </ul>
      </section>

      <section class="card">
        <h2>12. Segurança da informação e resposta a incidentes</h2>
        <ul>
          <li>São adotadas práticas de hardening, controle de acesso, limitação de taxa, segregação de ambientes e monitoramento de eventos críticos.</li>
          <li>Nenhum ambiente computacional é integralmente imune a falhas; por isso, não há garantia de invulnerabilidade absoluta.</li>
          <li>Na hipótese de incidente relevante envolvendo dados pessoais, serão adotadas as medidas técnicas, administrativas e legais cabíveis.</li>
          <li>Quando exigido em lei, serão realizadas comunicações às autoridades competentes e aos titulares afetados.</li>
        </ul>
      </section>

      <section class="card">
        <h2>13. Propriedade intelectual e conteúdo de terceiros</h2>
        <ul>
          <li>O usuário declara possuir direitos, licenças e autorizações necessárias sobre os conteúdos submetidos à plataforma.</li>
          <li>Conteúdo que infrinja direitos autorais, marca, imagem, privacidade ou legislação poderá ser removido, sem aviso prévio, para mitigação de risco jurídico.</li>
          <li>O software, código-fonte, documentação, layout, sinais distintivos e demais ativos do OmniZap System permanecem protegidos pela legislação aplicável.</li>
          <li>Pedidos de remoção por violação de direitos poderão ser enviados aos canais oficiais, com documentação mínima comprobatória.</li>
        </ul>
      </section>

      <section class="card">
        <h2>14. API, disponibilidade e alterações técnicas</h2>
        <ul>
          <li>A API e demais recursos podem sofrer evolução, descontinuidade, limitação de uso, versionamento e janelas de manutenção.</li>
          <li>Não se garante disponibilidade contínua, latência mínima, compatibilidade irrestrita com terceiros ou ausência completa de falhas.</li>
          <li>Integrações com serviços de terceiros dependem de condições externas e podem ser alteradas sem controle direto da plataforma.</li>
        </ul>
      </section>

      <section class="card">
        <h2>15. Suspensão, bloqueio cautelar e encerramento</h2>
        <ul>
          <li>Poderá ocorrer suspensão ou bloqueio cautelar em caso de indício de abuso, fraude, violação de segurança, risco regulatório ou ordem de autoridade competente.</li>
          <li>O acesso poderá ser encerrado em caso de descumprimento contratual, uso ilícito, inobservância de políticas técnicas ou determinação legal.</li>
          <li>O usuário poderá encerrar o uso a qualquer momento, observadas obrigações pendentes e retenções legalmente obrigatórias.</li>
        </ul>
      </section>

      <section class="card">
        <h2>16. Responsabilidade do usuário e indenização regressiva</h2>
        <ul>
          <li>O usuário compromete-se a indenizar regressivamente o OmniZap System por danos, custos e despesas decorrentes de uso ilícito ou violação destes Termos.</li>
          <li>Incluem-se, quando aplicável, custos de defesa, perícia, cumprimento de ordem judicial e sanções atribuíveis à conduta do usuário.</li>
          <li>Esta cláusula não afasta direitos inderrogáveis previstos em lei.</li>
        </ul>
      </section>

      <section class="card">
        <h2>17. Limitação de responsabilidade</h2>
        <p>Na extensão máxima permitida pela legislação aplicável, o OmniZap System não será responsável por danos indiretos, lucros cessantes, perdas de oportunidade, indisponibilidade de terceiros, bloqueios externos de conta, força maior, caso fortuito, atos de terceiros ou uso indevido da plataforma pelo usuário.</p>
        <p class="note"><strong>Nota:</strong> nada neste instrumento exclui responsabilidade nos casos em que a legislação brasileira expressamente proíba limitação ou exclusão.</p>
      </section>

      <section class="card">
        <h2>18. Comunicações, notificações e validade eletrônica</h2>
        <ul>
          <li>Comunicações operacionais e de segurança podem ser realizadas por e-mail, painéis internos, avisos no site e canais oficiais de atendimento.</li>
          <li>O usuário reconhece validade jurídica de registros eletrônicos, logs, comprovantes de envio e trilhas de auditoria como meios de prova.</li>
          <li>Notificações devem conter identificação mínima do solicitante e descrição objetiva da demanda para tratamento adequado.</li>
        </ul>
      </section>

      <section class="card">
        <h2>19. Alterações destes Termos</h2>
        <p>Estes Termos poderão ser atualizados a qualquer tempo para refletir mudanças legais, regulatórias, jurisprudenciais, técnicas ou operacionais. A versão vigente será aquela publicada nesta página, com data de atualização.</p>
      </section>

      <section class="card">
        <h2>20. Contato e foro</h2>
        <p>Para questões contratuais, privacidade e proteção de dados, utilize os canais oficiais abaixo.</p>
        <div class="contact-actions" aria-label="Canais oficiais de contato">
          <a class="contact-btn wa" href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">WhatsApp oficial</a>
          <a class="contact-btn ig" href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">Instagram oficial</a>
        </div>
        <ul>
          <li>WhatsApp oficial: <strong>+55 95 9112-2954</strong>.</li>
          <li>Link direto: <a href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">https://wa.me/559591122954</a>.</li>
          <li>Instagram oficial: <a href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">https://www.instagram.com/kaikybrofc/</a>.</li>
          <li>Fica eleito o foro da Comarca de Boa Vista/RR, com renúncia a qualquer outro, por mais privilegiado que seja, ressalvadas hipóteses legais de competência absoluta e normas protetivas aplicáveis ao consumidor.</li>
        </ul>
      </section>

      <section class="card">
        <h2>21. Referências legais oficiais (Brasil)</h2>
        <ul>
          <li>Constituição Federal de 1988 (direitos e garantias fundamentais): <a href="https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais - LGPD): <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Lei nº 12.965/2014 (Marco Civil da Internet): <a href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Decreto nº 8.771/2016 (regulamenta o Marco Civil da Internet): <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/decreto/d8771.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Lei nº 8.078/1990 (Código de Defesa do Consumidor): <a href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Lei nº 10.406/2002 (Código Civil): <a href="https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Lei nº 9.610/1998 (Direitos Autorais): <a href="https://www.planalto.gov.br/ccivil_03/leis/l9610.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>Lei nº 9.609/1998 (Lei de Software): <a href="https://www.planalto.gov.br/ccivil_03/leis/l9609.htm" target="_blank" rel="noreferrer noopener">Planalto</a>.</li>
          <li>ANPD - direitos do titular e canais institucionais: <a href="https://www.gov.br/anpd/pt-br" target="_blank" rel="noreferrer noopener">gov.br/anpd</a>.</li>
        </ul>
      </section>

      <section class="card">
        <h2>22. Disposições gerais</h2>
        <ul>
          <li>A eventual tolerância quanto ao descumprimento de obrigação não importará novação, renúncia de direito ou alteração contratual tácita.</li>
          <li>A nulidade ou inexequibilidade de cláusula específica não invalidará as demais disposições, que permanecerão em pleno vigor.</li>
          <li>Este instrumento representa o acordo integral entre as partes sobre seu objeto, prevalecendo sobre entendimentos anteriores conflitantes.</li>
          <li>Os títulos das cláusulas possuem finalidade apenas organizacional e não restringem a interpretação do conteúdo jurídico.</li>
        </ul>
      </section>

      <section class="card">
        <h2>23. Histórico de alterações</h2>
        <ul>
          <li><strong>07/03/2026:</strong> revisão integral em tom jurídico, inclusão de cláusulas de validade eletrônica, indenização regressiva, disposições gerais e seção de referências legais oficiais (Planalto/ANPD).</li>
          <li><strong>06/03/2026:</strong> inclusão de cláusulas sobre autenticação por senha, redefinição por e-mail com controles antiabuso, filosofia open source, comunidade e reforço das diretrizes de segurança de dados.</li>
          <li><strong>05/03/2026:</strong> inclusão de cláusula sobre uso do e-mail de login para envio de informações do projeto, comunicados operacionais e avisos de segurança.</li>
          <li><strong>28/02/2026:</strong> inclusão de contatos explícitos, aviso de projeto não oficial, termos complementares de privacidade, exemplos práticos de uso proibido e linguagem simplificada em seções jurídicas.</li>
          <li><strong>26/02/2026:</strong> publicação da versão inicial dos termos.</li>
        </ul>
      </section>
`;

const TermsReactApp = () => html`
  <main className="wrap" dangerouslySetInnerHTML=${{ __html: TERMS_CONTENT_HTML }}></main>
`;

const useHashAnchorSync = () => {
  React.useEffect(() => {
    const scrollToAnchor = () => {
      const rawHash = String(window.location.hash || '')
        .replace(/^#/, '')
        .trim();
      if (!rawHash) return;
      const targetId = decodeURIComponent(rawHash);
      const target = document.getElementById(targetId);
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start' });
      }
    };

    scrollToAnchor();
    window.addEventListener('hashchange', scrollToAnchor);
    return () => window.removeEventListener('hashchange', scrollToAnchor);
  }, []);
};

const TermsReactAppWithAnchors = () => {
  useHashAnchorSync();
  return html`<${TermsReactApp} />`;
};

const rootElement = document.getElementById('terms-react-root');

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(html`<${TermsReactAppWithAnchors} />`);
}
