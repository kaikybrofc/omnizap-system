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
        <p class="updated">Última atualização: 06/03/2026</p>
        <p class="note"><strong>Contato oficial (WhatsApp):</strong> +55 95 9112-2954 (número no link: 559591122954).</p>
        <div class="contact-actions" aria-label="Acesso rápido aos contatos">
          <a class="contact-btn wa" href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">WhatsApp oficial</a>
          <a class="contact-btn ig" href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">Instagram @kaikybrofc</a>
        </div>
        <p class="note"><strong>Aviso importante:</strong> o OmniZap System é um <strong>projeto não oficial</strong>, <strong>sem autorização, afiliação ou endosso da Meta</strong>. O projeto tem foco em <strong>estudo, aprendizado e experimentação técnica</strong>.</p>
        <p>Ao usar o OmniZap System, você concorda com estas regras de uso e com as práticas de privacidade descritas nesta página.</p>
        <p class="note">Escrevemos este documento em linguagem direta para explicar, de forma clara, quais dados são mantidos, por quanto tempo e para quais finalidades.</p>
        <p><strong>Para usar o OmniZap System, você precisa estar ciente de que:</strong> este é um projeto não oficial para estudo; o uso deve seguir a lei e as políticas das plataformas; e alguns dados de uso são mantidos para segurança, suporte e métricas.</p>
        <p class="note"><strong>Resumo rápido para você, usuário final:</strong> guardamos dados de uso para manter o serviço funcionando, proteger sua conta e gerar métricas que ajudam a melhorar estabilidade e desempenho.</p>
        <p class="note"><strong>Atualização importante:</strong> com a autenticação por senha no sistema, este termo inclui regras específicas de login, redefinição de senha por e-mail, limites antiabuso e responsabilidades do usuário para proteção da conta.</p>
      </section>

      <section class="card">
        <h2>1. Sobre o dono e responsável pelo serviço</h2>
        <ul>
          <li>Responsável/Titular: <strong>Kaiky Brito Ribeiro</strong>.</li>
          <li>Nome empresarial: <strong>59.034.123 KAIKY BRITO RIBEIRO</strong>.</li>
          <li>CNPJ: <strong>59.034.123/0001-96</strong>.</li>
          <li>Situação cadastral do registro: <strong>Ativa</strong>.</li>
          <li>UF do registro: <strong>RR</strong>.</li>
          <li>Fonte dos dados cadastrais: documento <code>empresa.pdf</code> (Consulta por CNPJ/Redesim).</li>
          <li>Instagram informado para contato/perfil público: <a href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">https://www.instagram.com/kaikybrofc/</a>.</li>
        </ul>
      </section>

      <section class="card">
        <h2>2. Aceitação e escopo</h2>
        <ul>
          <li>Estes termos se aplicam a todo uso do site, API, painel administrativo e recursos de automação do OmniZap System.</li>
          <li>O OmniZap System é um projeto independente e não oficial, sem vínculo contratual, autorização ou endosso da Meta Platforms.</li>
          <li>O uso da plataforma é direcionado a fins de estudo, aprendizado e desenvolvimento técnico.</li>
          <li>Se você não concordar com qualquer cláusula, não utilize a plataforma.</li>
          <li>Ao usar o serviço em nome de empresa ou equipe, você declara possuir autorização para aceitar estes termos em nome dessa organização.</li>
        </ul>
      </section>

      <section class="card">
        <h2>3. Cadastro, acesso e responsabilidade da conta</h2>
        <ul>
          <li>Você deve fornecer informações verdadeiras e atualizadas ao criar ou manter sua conta.</li>
          <li>Você é responsável por manter credenciais, tokens e sessões protegidos.</li>
          <li>Atividades realizadas na sua conta são de sua responsabilidade, inclusive ações feitas por terceiros com seu acesso.</li>
          <li>Podemos solicitar validações adicionais de identidade para prevenção de fraude e proteção da plataforma.</li>
        </ul>
        <h3>3.1 Autenticação por senha</h3>
        <ul>
          <li>O acesso ao painel pode exigir e-mail e senha cadastrados na plataforma.</li>
          <li>Você deve usar senha forte, exclusiva e não reutilizada em outros serviços.</li>
          <li>Você não deve compartilhar sua senha com terceiros, inclusive equipe sem autorização formal.</li>
          <li>Recomendamos habilitar boas práticas adicionais de segurança no seu ambiente (por exemplo: navegador atualizado e proteção do dispositivo).</li>
        </ul>
        <h3>3.2 Redefinição de senha e e-mail transacional</h3>
        <ul>
          <li>A redefinição de senha ocorre por link enviado ao e-mail da conta e depende do controle desse e-mail pelo titular.</li>
          <li>Links de redefinição podem ser temporários e de uso único, para reduzir risco de reutilização indevida.</li>
          <li>Podemos aplicar tempo mínimo entre novos envios, limite de tentativas e bloqueios temporários para prevenir spam e abuso do recurso.</li>
          <li>Solicitações suspeitas de reset podem ser registradas em log e analisadas para proteção da conta e da infraestrutura.</li>
        </ul>
        <h3>3.3 Deveres do usuário sobre a conta</h3>
        <ul>
          <li>Manter o e-mail da conta atualizado e sob seu controle é responsabilidade do usuário.</li>
          <li>Você deve encerrar sessões em dispositivos compartilhados e comunicar suspeitas de invasão imediatamente pelos canais oficiais.</li>
          <li>O OmniZap System pode exigir confirmação adicional de identidade antes de restaurar acesso em casos sensíveis.</li>
        </ul>
      </section>

      <section class="card">
        <h2>4. Uso permitido e condutas proibidas</h2>
        <ul>
          <li>É permitido usar o sistema para automação e integração com WhatsApp conforme a legislação aplicável e políticas das plataformas envolvidas.</li>
          <li>É proibido uso para spam, fraude, engenharia social, assédio, violação de privacidade, distribuição de malware ou qualquer atividade ilícita.</li>
          <li>É proibido tentar obter acesso não autorizado, testar vulnerabilidades sem permissão ou prejudicar a disponibilidade do serviço.</li>
          <li>Você é responsável pelo conteúdo, comandos, campanhas e mensagens disparadas por sua operação.</li>
        </ul>
        <p class="note"><strong>Exemplos práticos de uso proibido:</strong></p>
        <ul>
          <li>Disparar mensagens em massa para números sem consentimento (spam).</li>
          <li>Usar automações para golpes, clonagem de identidade, phishing ou promessa enganosa.</li>
          <li>Coletar/compartilhar dados pessoais de terceiros sem base legal ou autorização.</li>
          <li>Tentar derrubar o serviço com sobrecarga de requisições ou burlar limites técnicos.</li>
        </ul>
      </section>

      <section class="card">
        <h2>5. Quais dados mantemos sobre o uso</h2>
        <p class="note">Esta seção foi escrita para ser objetiva: estes são os dados que podem ser mantidos quando você usa o OmniZap System.</p>
        <h3>5.1 Dados informados por você</h3>
        <ul>
          <li>Nome, e-mail, telefone, identificadores de conta e demais dados informados em formulários, suporte ou cadastro.</li>
          <li>O e-mail de login pode ser utilizado para autenticação da conta e para envio de comunicações do projeto (como avisos operacionais, atualizações de funcionalidades, manutenção e segurança).</li>
          <li>Configurações de automação, preferências do painel, integrações habilitadas e parâmetros definidos por você.</li>
        </ul>
        <h3>5.2 Dados coletados automaticamente</h3>
        <ul>
          <li>Logs técnicos como IP, data e hora de acesso, user-agent, tipo de dispositivo, sistema operacional, páginas/rotas utilizadas, eventos de erro e desempenho.</li>
          <li>Identificadores técnicos de sessão e segurança para autenticação, prevenção de abuso e auditoria operacional.</li>
        </ul>
        <h3>5.3 Dados operacionais de mensagens e mídia</h3>
        <ul>
          <li>Mensagens, comandos, anexos e metadados processados quando necessários para executar funcionalidades do bot, automações, estatísticas e organização de packs.</li>
          <li>Ao adicionar o bot em grupos, você declara ciência de que interações do grupo podem ser processadas para o funcionamento dos recursos contratados.</li>
        </ul>
        <h3>5.4 Dados de pagamento (quando aplicável)</h3>
        <ul>
          <li>Informações de cobrança e status de assinatura podem ser processados por provedores de pagamento parceiros.</li>
          <li>O OmniZap System não armazena número completo de cartão quando o processamento ocorre por gateway terceirizado.</li>
        </ul>
        <p class="note">Resumo: mantemos dados de uso necessários para operar o serviço com segurança e qualidade.</p>
      </section>

      <section class="card">
        <h2>6. Como usamos esses dados</h2>
        <ol>
          <li>Prestar, manter e melhorar os serviços, incluindo API, painel, bot e recursos de automação.</li>
          <li>Executar autenticação, controle de acesso, prevenção a fraude, segurança e resposta a incidentes.</li>
          <li>Fornecer suporte, responder solicitações e enviar comunicações para o e-mail de login sobre o projeto, incluindo atualizações técnicas, novidades relevantes, manutenção e avisos de segurança.</li>
          <li>Cumprir obrigações legais, regulatórias e ordens de autoridades competentes.</li>
          <li>Gerar métricas de uso para acompanhar desempenho, estabilidade e evolução do produto (por exemplo: volume de comandos, funcionalidades mais usadas, taxa de erros e capacidade da infraestrutura).</li>
        </ol>
        <p>Essas métricas são usadas para melhorar a experiência do usuário final e manter o sistema estável. Sempre que possível, usamos dados agregados/estatísticos para análises de produto e operação. O tratamento de dados pessoais pode se basear em execução de contrato, legítimo interesse, cumprimento de obrigação legal e consentimento, conforme a LGPD.</p>
        <p class="note">Quando aplicável por lei, você pode solicitar o descadastramento de comunicações informativas não essenciais. Comunicados obrigatórios de conta, segurança e operação podem continuar sendo enviados.</p>
      </section>

      <section class="card">
        <h2>7. Compartilhamento de dados</h2>
        <ul>
          <li>Com operadores e fornecedores que apoiam infraestrutura, hospedagem, monitoramento, autenticação, mensagens e cobrança.</li>
          <li>Com parceiros de integração, quando necessário para executar funcionalidades solicitadas por você.</li>
          <li>Com autoridades públicas, quando houver obrigação legal, ordem judicial ou requisição válida.</li>
          <li>Não comercializamos dados pessoais como produto.</li>
        </ul>
      </section>

      <section class="card">
        <h2>8. Onde e por quanto tempo os dados ficam armazenados</h2>
        <ul>
          <li>Os dados de uso ficam armazenados em infraestrutura de hospedagem e banco de dados utilizados para operação do OmniZap System.</li>
          <li>Registros técnicos (logs) podem ficar em serviços de monitoramento e auditoria para segurança, diagnóstico e geração de métricas.</li>
          <li>Os dados são mantidos pelo tempo necessário para cumprir as finalidades informadas, obrigações legais e proteção contra fraudes/abusos.</li>
          <li>Quando possível e solicitado, dados podem ser anonimizados, bloqueados ou excluídos, respeitados prazos legais e obrigações de guarda.</li>
          <li>Backups e logs podem permanecer por períodos adicionais de segurança e continuidade do serviço.</li>
        </ul>
      </section>

      <section class="card">
        <h2>9. Segurança da informação</h2>
        <ul>
          <li>Adotamos controles técnicos e organizacionais razoáveis para proteger dados contra acesso não autorizado, perda, alteração ou vazamento.</li>
          <li>Os mecanismos incluem controles de acesso, monitoramento, segregação de ambientes e medidas de hardening, quando aplicável.</li>
          <li>Para conta com senha, aplicamos camadas de proteção de autenticação, monitoramento de tentativas e medidas de mitigação contra abuso.</li>
          <li>O fluxo de recuperação de senha por e-mail pode incluir expiração de token, invalidação após uso e trilha de auditoria.</li>
          <li>Podemos usar limitação de taxa (rate limit), bloqueios temporários e filtros de tráfego para conter spam, força bruta e automações maliciosas.</li>
          <li>Dados de produção e credenciais operacionais não fazem parte do conteúdo público do projeto open source.</li>
          <li>Nenhum sistema é totalmente imune a falhas; portanto, não é possível garantir segurança absoluta.</li>
        </ul>
        <p class="note"><strong>Boas práticas do usuário:</strong> use senha forte, não compartilhe credenciais, revise sessões ativas e mantenha seu e-mail protegido com verificação em duas etapas quando disponível.</p>
      </section>

      <section class="card">
        <h2>10. Projeto Open Source, comunidade e colaboração</h2>
        <ul>
          <li>O OmniZap System segue uma filosofia open source: o código-fonte pode ser estudado, auditado, evoluído e adaptado, conforme os termos da licença do repositório.</li>
          <li>Nosso objetivo é criar tecnologia útil para que mais pessoas possam aprender, usar, contribuir e melhorar o projeto coletivamente.</li>
          <li>A comunidade open source acelera correções, aumenta transparência técnica e incentiva revisão pública de qualidade e segurança.</li>
          <li>Contribuições da comunidade (issues, pull requests, documentação e testes) são bem-vindas quando respeitam padrões técnicos, legais e éticos.</li>
          <li>Conteúdo enviado para contribuição não pode incluir malware, backdoors, violações de direitos autorais ou dados pessoais sem base legal.</li>
          <li>Open source não significa ausência de regras: uso em produção continua sujeito a estes termos, à legislação aplicável e às políticas das plataformas integradas.</li>
        </ul>
      </section>

      <section class="card">
        <h2>11. Cookies e tecnologias semelhantes</h2>
        <ul>
          <li>Utilizamos cookies e identificadores técnicos para autenticação, sessão, segurança e funcionamento essencial da plataforma.</li>
          <li>Também podem ser usados recursos analíticos para entender uso e desempenho, respeitadas exigências legais aplicáveis.</li>
          <li>Você pode gerenciar cookies no navegador, ciente de que certas funcionalidades podem deixar de operar corretamente.</li>
        </ul>
      </section>

      <section class="card">
        <h2>12. Direitos do titular de dados (LGPD)</h2>
        <p>Nos termos da Lei nº 13.709/2018 (LGPD), você pode solicitar:</p>
        <ul>
          <li>Confirmação da existência de tratamento e acesso aos dados.</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.</li>
          <li>Portabilidade, revogação de consentimento e oposição ao tratamento, quando cabível.</li>
        </ul>
        <p>Para exercer direitos, solicitar remoção de dados ou esclarecer dúvidas, entre em contato com o administrador:</p>
        <p><strong>WhatsApp (contato direto):</strong> +55 95 9112-2954 <br /><strong>Número no link:</strong> 559591122954</p>
        <div class="contact-actions" aria-label="Contatos para privacidade">
          <a class="contact-btn wa" href="https://wa.me/559591122954?text=Ol%C3%A1%2C%20gostaria%20de%20solicitar%20a%20remo%C3%A7%C3%A3o%20dos%20meus%20dados%20do%20OmniZap%20System." target="_blank" rel="noreferrer noopener">Solicitar via WhatsApp</a>
          <a class="contact-btn ig" href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">Contato no Instagram</a>
        </div>
      </section>

      <section class="card">
        <h2 id="politica-de-privacidade">13. Política de Privacidade (termos complementares)</h2>
        <ul>
          <li><strong>Minimização:</strong> coletamos e mantemos apenas os dados necessários para operação, segurança, suporte e melhoria dos serviços.</li>
          <li><strong>Finalidade e transparência:</strong> o tratamento de dados é feito para finalidades legítimas, específicas e informadas neste documento.</li>
          <li><strong>Bases legais:</strong> o tratamento pode ocorrer com base em execução de contrato, legítimo interesse, cumprimento de obrigação legal/regulatória e consentimento, quando exigido.</li>
          <li><strong>Controle do titular:</strong> pedidos de acesso, correção, oposição e exclusão são avaliados conforme a LGPD e atendidos nos prazos legais aplicáveis.</li>
          <li><strong>Retenção e descarte:</strong> dados são eliminados, anonimizados ou bloqueados ao fim da finalidade, salvo hipóteses legais de retenção.</li>
          <li><strong>Segurança e prevenção:</strong> adotamos medidas técnicas e administrativas para reduzir risco de acesso indevido, vazamento, alteração ou indisponibilidade.</li>
          <li><strong>Incidentes:</strong> em caso de incidente relevante de segurança envolvendo dados pessoais, as medidas cabíveis serão adotadas, inclusive comunicação às autoridades e titulares quando exigido por lei.</li>
          <li><strong>Crianças e adolescentes:</strong> o usuário que utiliza o serviço declara ter capacidade legal para contratação ou autorização do responsável legal, quando aplicável.</li>
        </ul>
      </section>

      <section class="card">
        <h2>14. Transferência internacional de dados</h2>
        <p>Alguns fornecedores e serviços podem operar fora do Brasil. Nesses casos, medidas contratuais e salvaguardas adequadas são adotadas para proteção dos dados, conforme legislação aplicável.</p>
      </section>

      <section class="card">
        <h2>15. Conteúdo, propriedade intelectual e direitos de terceiros</h2>
        <ul>
          <li>Você deve possuir direitos e autorizações sobre mídias, textos e materiais enviados para processamento.</li>
          <li>Conteúdo que viole direitos autorais, marca, imagem, privacidade ou legislação poderá ser removido e poderá resultar em suspensão de acesso.</li>
          <li>O OmniZap System, sua marca, código e elementos de interface são protegidos por direitos de propriedade intelectual.</li>
        </ul>
      </section>

      <section class="card">
        <h2>16. API, disponibilidade e mudanças técnicas</h2>
        <ul>
          <li>A API e os recursos podem ter limites de uso, janelas de manutenção, alterações de versão e ajustes de capacidade.</li>
          <li>Não garantimos disponibilidade ininterrupta, latência mínima ou ausência de falhas em ambiente de internet.</li>
        </ul>
      </section>

      <section class="card">
        <h2>17. Suspensão e encerramento</h2>
        <ul>
          <li>Podemos suspender ou encerrar acesso em caso de violação destes termos, risco de segurança, ordem legal ou uso abusivo da infraestrutura.</li>
          <li>Você pode interromper o uso do serviço a qualquer momento, sujeito às condições contratuais aplicáveis.</li>
        </ul>
      </section>

      <section class="card">
        <h2>18. Limitação de responsabilidade</h2>
        <p>O OmniZap System é fornecido no estado em que se encontra. Na extensão permitida por lei, não nos responsabilizamos por danos indiretos, lucros cessantes, perda de oportunidade, bloqueios de conta de terceiros, indisponibilidade externa, falhas de integração ou uso indevido da plataforma por usuários.</p>
        <p class="note"><strong>Em termos simples:</strong> vamos trabalhar para manter tudo estável, mas não conseguimos garantir ausência total de falhas e não cobrimos prejuízos causados por fatores externos, decisões de terceiros ou uso indevido da conta.</p>
      </section>

      <section class="card">
        <h2>19. Alterações destes termos</h2>
        <p>Podemos atualizar este documento periodicamente para refletir mudanças legais, técnicas e operacionais. A versão vigente sempre será a publicada nesta página, com a data de atualização correspondente.</p>
      </section>

      <section class="card">
        <h2>20. Contato e foro</h2>
        <p>Para questões relacionadas a estes termos, privacidade ou proteção de dados, utilize os canais oficiais abaixo. Fica eleito o foro competente no Brasil, conforme legislação aplicável, para dirimir eventuais controvérsias.</p>
        <div class="contact-actions" aria-label="Canais oficiais de contato">
          <a class="contact-btn wa" href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">WhatsApp oficial</a>
          <a class="contact-btn ig" href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">Instagram oficial</a>
        </div>
        <ul>
          <li>WhatsApp oficial: <strong>+55 95 9112-2954</strong> (número do link: <strong>559591122954</strong>).</li>
          <li>Link direto: <a href="https://wa.me/559591122954" target="_blank" rel="noreferrer noopener">https://wa.me/559591122954</a>.</li>
          <li>Instagram oficial: <a href="https://www.instagram.com/kaikybrofc/" target="_blank" rel="noreferrer noopener">https://www.instagram.com/kaikybrofc/</a>.</li>
        </ul>
      </section>

      <section class="card">
        <h2>21. Histórico de alterações</h2>
        <ul>
          <li><strong>06/03/2026:</strong> inclusão de cláusulas sobre autenticação por senha, redefinição por e-mail com controles antiabuso, filosofia open source, comunidade e reforço das diretrizes de segurança de dados.</li>
          <li><strong>05/03/2026:</strong> inclusão de cláusula sobre uso do e-mail de login para envio de informações do projeto, comunicados operacionais e avisos de segurança.</li>
          <li><strong>28/02/2026:</strong> inclusão de contatos explícitos, aviso de projeto não oficial, termos complementares de privacidade, exemplos práticos de uso proibido e linguagem simplificada em seções jurídicas.</li>
          <li><strong>26/02/2026:</strong> publicação da versão inicial dos termos.</li>
        </ul>
      </section>
`;

const TermsReactApp = () => html` <main className="wrap" dangerouslySetInnerHTML=${{ __html: TERMS_CONTENT_HTML }}></main> `;

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
