#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CONFIG_PATH = 'docs/seo/satellite-pages-phase1.json';
const DEFAULT_OUTPUT_DIR = 'public';
const SITE_ORIGIN = 'https://omnizap.shop';

const getArgValue = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
};

const configPath = getArgValue('--config') || DEFAULT_CONFIG_PATH;
const outputDir = getArgValue('--out') || DEFAULT_OUTPUT_DIR;

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toSafeJson = (value) => JSON.stringify(value, null, 0).replace(/</g, '\\u003c');

const normalizeSlug = (slug) =>
  String(slug || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

const ensurePageConfig = (page) => {
  const slug = normalizeSlug(page?.slug);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`slug invalido: ${page?.slug || '<vazio>'}`);
  }

  const requiredFields = ['title', 'description', 'h1', 'intro'];
  for (const field of requiredFields) {
    const value = String(page?.[field] || '').trim();
    if (!value) {
      throw new Error(`campo obrigatorio ausente em ${slug}: ${field}`);
    }
  }

  return {
    ...page,
    slug,
    title: String(page.title).trim(),
    description: String(page.description).trim(),
    h1: String(page.h1).trim(),
    intro: String(page.intro).trim(),
    intent_label: String(page.intent_label || 'Guia pratico').trim(),
    keywords: Array.isArray(page.keywords)
      ? page.keywords
          .filter(Boolean)
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [],
    sections: Array.isArray(page.sections) ? page.sections : [],
    faq: Array.isArray(page.faq) ? page.faq : [],
    related_links: Array.isArray(page.related_links) ? page.related_links : [],
  };
};

const renderSection = (section) => {
  const title = String(section?.title || '').trim();
  const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const bullets = Array.isArray(section?.bullets) ? section.bullets.map((item) => String(item || '').trim()).filter(Boolean) : [];

  if (!title && paragraphs.length === 0 && bullets.length === 0) return '';

  const paragraphsHtml = paragraphs.map((paragraph) => `        <p>${escapeHtml(paragraph)}</p>`).join('\n');
  const bulletsHtml = bullets.length ? `\n        <ul>\n${bullets.map((bullet) => `          <li>${escapeHtml(bullet)}</li>`).join('\n')}\n        </ul>` : '';

  return `<section class="card">\n      ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}\n${paragraphsHtml}${bulletsHtml}\n    </section>`;
};

const renderFaq = (faqEntries) => {
  if (!faqEntries.length) return '';

  const items = faqEntries
    .map((entry) => {
      const question = String(entry?.q || '').trim();
      const answer = String(entry?.a || '').trim();
      if (!question || !answer) return '';
      return `        <details class="faq-item">\n          <summary>${escapeHtml(question)}</summary>\n          <p>${escapeHtml(answer)}</p>\n        </details>`;
    })
    .filter(Boolean)
    .join('\n');

  if (!items) return '';

  return `<section class="card">\n      <h2>Perguntas frequentes</h2>\n      <div class="faq-list">\n${items}\n      </div>\n    </section>`;
};

const withRequiredLinks = (relatedLinks) => {
  const requiredLinks = [
    { href: '/', label: 'OmniZap Home' },
    { href: '/stickers/', label: 'Catálogo de Stickers' },
    { href: '/comandos/', label: 'Biblioteca de Comandos' },
    { href: '/api-docs/', label: 'Área de Desenvolvedor' },
    { href: '/login/', label: 'Adicionar bot agora' },
  ];

  const allLinks = [...requiredLinks, ...relatedLinks];
  const dedup = new Map();
  for (const link of allLinks) {
    const href = String(link?.href || '').trim();
    const label = String(link?.label || '').trim();
    if (!href || !label) continue;
    if (!dedup.has(href)) dedup.set(href, { href, label });
  }

  return Array.from(dedup.values());
};

const renderLinks = (links) => {
  if (!links.length) return '';

  return `<section class="card">\n      <h2>Links úteis</h2>\n      <div class="links-grid">\n${links.map((link) => `        <a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join('\n')}\n      </div>\n    </section>`;
};

const renderPageHtml = (page, generatedAt) => {
  const canonicalPath = `/${page.slug}/`;
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  const keywordsContent = page.keywords.join(', ');

  const faqEntities = page.faq
    .map((entry) => ({
      '@type': 'Question',
      name: String(entry?.q || '').trim(),
      acceptedAnswer: {
        '@type': 'Answer',
        text: String(entry?.a || '').trim(),
      },
    }))
    .filter((item) => item.name && item.acceptedAnswer.text);

  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    inLanguage: 'pt-BR',
    url: canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: 'OmniZap System',
      url: SITE_ORIGIN,
    },
  };

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntities,
  };

  const sectionsHtml = page.sections.map(renderSection).filter(Boolean).join('\n\n');
  const faqHtml = renderFaq(page.faq);
  const linksHtml = renderLinks(withRequiredLinks(page.related_links));

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
  ${keywordsContent ? `<meta name="keywords" content="${escapeHtml(keywordsContent)}" />` : ''}
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="icon" type="image/png" href="/assets/images/brand-icon-192.png" />

  <meta property="og:type" content="article" />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content="OmniZap System" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:image" content="https://omnizap.shop/assets/images/hero-banner-1280.jpg" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(page.title)}" />
  <meta name="twitter:description" content="${escapeHtml(page.description)}" />
  <meta name="twitter:image" content="https://omnizap.shop/assets/images/hero-banner-1280.jpg" />

  <script type="application/ld+json">${toSafeJson(webPageSchema)}</script>
  ${faqEntities.length ? `<script type="application/ld+json">${toSafeJson(faqSchema)}</script>` : ''}

  <style>
    :root {
      --bg: #0f172a;
      --bg-2: #111827;
      --line: rgba(255, 255, 255, 0.05);
      --text: #f8fafc;
      --muted: #94a3b8;
      --card: #1e293bd9;
      --accent: #2563eb;
      --accent-2: #7c3aed;
      --cta: #22c55e;
      --cta-hover: #16a34a;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Manrope", system-ui, -apple-system, sans-serif;
      color: var(--text);
      background:
        radial-gradient(58rem 22rem at -10% -8%, #2563eb24, transparent 60%),
        radial-gradient(62rem 26rem at 112% -12%, #7c3aed22, transparent 58%),
        linear-gradient(165deg, var(--bg), var(--bg-2));
    }

    .wrap { width: min(980px, 92vw); margin: 0 auto; padding: 22px 0 42px; }

    .top {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }

    .top a {
      color: var(--text);
      text-decoration: none;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 11px;
      background: #111827;
      font-size: 14px;
      font-weight: 700;
    }

    .hero,
    .card {
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      background: var(--card);
      padding: 16px;
      margin-bottom: 12px;
    }

    .pill {
      display: inline-flex;
      border: 1px solid #45689f;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .3px;
      color: #cde4ff;
      background: #16274a96;
      margin-bottom: 10px;
    }

    h1, h2 {
      margin: 0 0 8px;
      font-family: "Sora", "Manrope", sans-serif;
      letter-spacing: -0.02em;
    }

    h1 {
      font-size: clamp(29px, 4vw, 42px);
      line-height: 1.08;
      background: linear-gradient(92deg, #f3f8ff 0%, #60a5fa 45%, #a78bfa 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }

    h2 { font-size: clamp(22px, 2.8vw, 30px); }

    p, li {
      margin: 0 0 10px;
      color: var(--muted);
      line-height: 1.65;
      font-size: 16px;
    }

    ul { margin: 0; padding-left: 18px; }

    .cta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .btn {
      text-decoration: none;
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 11px;
      padding: 10px 13px;
      color: var(--text);
      background: #111827;
      font-weight: 800;
      font-size: 14px;
    }

    .btn.primary {
      border-color: transparent;
      color: #0f172a;
      background: var(--cta);
    }

    .btn.primary:hover { background: var(--cta-hover); }

    .faq-list {
      display: grid;
      gap: 9px;
    }

    .faq-item {
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      background: #1e293bb8;
      padding: 0 12px;
    }

    .faq-item summary {
      cursor: pointer;
      list-style: none;
      font-weight: 800;
      color: #ebf4ff;
      padding: 12px 0;
    }

    .faq-item summary::-webkit-details-marker { display: none; }

    .faq-item p {
      margin: 0;
      padding: 0 0 12px;
      font-size: 15px;
    }

    .links-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
    }

    .links-grid a {
      text-decoration: none;
      color: #dbecff;
      border: 1px solid #365686;
      border-radius: 10px;
      padding: 9px 10px;
      background: #10203d;
      font-weight: 700;
    }

    .meta {
      margin-top: 8px;
      font-size: 13px;
      color: #95b2d8;
    }
  </style>
</head>
<body>
  <main class="wrap">
    <nav class="top" aria-label="Navegação interna">
      <a href="/">Início</a>
      <a href="/stickers/">Stickers</a>
      <a href="/api-docs/">API Docs</a>
      <a href="/login/">Adicionar Bot</a>
    </nav>

    <header class="hero">
      <span class="pill">${escapeHtml(page.intent_label)}</span>
      <h1>${escapeHtml(page.h1)}</h1>
      <p>${escapeHtml(page.intro)}</p>
      <div class="cta">
        <a class="btn primary" href="/login/">Adicionar ao meu grupo</a>
        <a class="btn" href="/">Conhecer OmniZap</a>
      </div>
      <p class="meta">Página atualizada em ${escapeHtml(generatedAt)}</p>
    </header>

${sectionsHtml}

${faqHtml}

${linksHtml}
  </main>
</body>
</html>`;
};

const run = async () => {
  const absoluteConfigPath = path.resolve(configPath);
  const absoluteOutputDir = path.resolve(outputDir);

  const rawConfig = await fs.readFile(absoluteConfigPath, 'utf8');
  const parsedConfig = JSON.parse(rawConfig);
  const pages = Array.isArray(parsedConfig?.pages) ? parsedConfig.pages : [];
  const generatedAt = String(parsedConfig?.generated_at || new Date().toISOString().slice(0, 10)).trim();

  if (!pages.length) {
    throw new Error('config sem paginas');
  }

  const generatedFiles = [];

  for (const pageConfig of pages) {
    const page = ensurePageConfig(pageConfig);
    const html = renderPageHtml(page, generatedAt);
    const targetDir = path.join(absoluteOutputDir, page.slug);
    const targetFile = path.join(targetDir, 'index.html');

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetFile, html, 'utf8');
    generatedFiles.push(targetFile);
  }

  process.stdout.write(`Paginas geradas: ${generatedFiles.length}\n`);
  for (const filePath of generatedFiles) {
    process.stdout.write(`- ${path.relative(process.cwd(), filePath)}\n`);
  }
};

run().catch((error) => {
  process.stderr.write(`Erro ao gerar paginas satelite: ${error.message}\n`);
  process.exitCode = 1;
});
