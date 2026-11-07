// Blog helpers: slugs, safe content formatting, and the server-rendered public pages.
// Pages are rendered on the server so search engines see the title and meta description.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LIMITS = { title: 120, slug: 80, meta: 160, content: 50000 };

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // é -> e
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
}

// Plain text with the first ~155 characters, used when no meta description is given
function excerpt(content, max = 155) {
  const text = String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // links -> text
    .replace(/^#{1,3}\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/^>\s?/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

const readingMinutes = content => Math.max(1, Math.round(String(content || '').split(/\s+/).filter(Boolean).length / 200));

// Only http(s), mailto:, tel:, site-relative paths and #anchors are allowed (blocks javascript: etc.)
const safeUrl = url => (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url) ? url : null);
const safeImg = url => (/^(https:\/\/|\/uploads\/)/i.test(url) ? url : null);

// Inline formatting on already-escaped text: **bold**, *italic*, [link](url)
function inline(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, rawUrl) => {
      const url = safeUrl(rawUrl.replace(/&amp;/g, '&'));
      if (!url) return text;
      const external = /^https?:\/\//i.test(url);
      return `<a href="${esc(url)}"${external ? ' target="_blank" rel="noopener nofollow"' : ''}>${text}</a>`;
    });
}

// Simple, safe formatting. Everything is escaped first; only the syntax below becomes HTML.
//   ## Heading / ### Smaller heading      - list item / 1. numbered item
//   > quote      ![alt text](https://… or /uploads/…)      blank line = new paragraph
function renderContent(content) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(esc(i))}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!line) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{2,3})\s+(.+)$/))) {
      flushPara(); flushList();
      const tag = m[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(esc(m[2]))}</${tag}>`);
    } else if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) {
      flushPara(); flushList();
      const src = safeImg(m[2]);
      if (src) out.push(`<figure><img src="${esc(src)}" alt="${esc(m[1])}" loading="lazy">${m[1] ? `<figcaption>${esc(m[1])}</figcaption>` : ''}</figure>`);
    } else if ((m = line.match(/^[-*]\s+(.+)$/)) || (m = line.match(/^\d+[.)]\s+(.+)$/))) {
      flushPara();
      const tag = /^\d/.test(line) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push(m[1]);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); flushList();
      out.push(`<blockquote>${inline(esc(m[1]))}</blockquote>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}

const fmtDate = iso => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const absolute = (origin, url) => (!url ? '' : /^https?:\/\//i.test(url) ? url : origin + url);

function layout({ title, description, canonical, image, robots, type = 'website', jsonLd, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${robots ? `<meta name="robots" content="${robots}">` : ''}
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
  <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
  <meta name="theme-color" content="#3A2115">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%92%8E%3C/text%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="blog-page">
  <header class="header">
    <div class="container header-inner">
      <a href="/" class="logo">Jpara<span class="logo-spark">✦</span><small>JEWELS</small></a>
      <nav class="blog-nav" aria-label="Blog">
        <a href="/blog">Blog</a>
        <a href="/#shop" class="btn btn-primary btn-sm">Shop now</a>
      </nav>
    </div>
  </header>
  <main>${body}</main>
  <footer class="footer">
    <div class="container footer-newsletter">
      <div class="newsletter-text">
        <h4>Join the Jpara list</h4>
        <p>New arrivals, festive offers and styling tips in your inbox. No spam.</p>
      </div>
      <form class="newsletter-form" novalidate>
        <div class="newsletter-row">
          <label class="sr-only" for="newsletterEmail">Email address</label>
          <input id="newsletterEmail" type="email" name="email" required maxlength="200" placeholder="Your email address" autocomplete="email">
          <input class="nl-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn btn-gold" type="submit">Subscribe</button>
        </div>
        <p class="newsletter-msg" role="status" aria-live="polite"></p>
        <small class="newsletter-note">By subscribing you agree to our <a href="/privacy-policy">Privacy Policy</a>. You can unsubscribe at any time by contacting us.</small>
      </form>
    </div>
    <div class="container footer-grid footer-grid-pages">
      <div>
        <span class="logo">Jpara<span class="logo-spark">✦</span></span>
        <p>Artificial jewellery for every occasion: festive, bridal and everyday.</p>
      </div>
      <div>
        <h4>Shop</h4>
        <a href="/#shop">All jewellery</a>
        <a href="/#offers">Offers</a>
        <a href="/#collections">Collections</a>
      </div>
      <div>
        <h4>Company</h4>
        <a href="/about">About Us</a>
        <a href="/contact">Contact Us</a>
        <a href="/blog">Blog</a>
      </div>
      <div>
        <h4>Help</h4>
        <a href="/faq">FAQ</a>
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/terms-and-conditions">Terms &amp; Conditions</a>
      </div>
    </div>
    <div class="container footer-bottom">© ${new Date().getFullYear()} Jpara Jewels. All rights reserved. · <a href="/privacy-policy" style="display:inline">Privacy</a> · <a href="/terms-and-conditions" style="display:inline">Terms</a> · <a href="/credits" style="display:inline">Photo credits</a></div>
  </footer>
  <script src="/js/newsletter.js" defer></script>
</body>
</html>`;
}

const cover = (post, cls = '') => (post.image
  ? `<img class="${cls}" src="${esc(post.image)}" alt="${esc(post.title)}" loading="lazy">`
  : `<div class="${cls} blog-cover-empty" aria-hidden="true">✦</div>`);

function renderIndex(posts, origin) {
  const cards = posts.map(p => `
      <article class="blog-card">
        <a href="/blog/${esc(p.slug)}" class="blog-card-img">${cover(p)}</a>
        <div class="blog-card-body">
          <time datetime="${esc(p.publishedAt)}">${fmtDate(p.publishedAt)} · ${readingMinutes(p.content)} min read</time>
          <h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
          <p>${esc(p.metaDescription || excerpt(p.content))}</p>
          <a href="/blog/${esc(p.slug)}" class="blog-more">Read more →</a>
        </div>
      </article>`).join('');
  return layout({
    title: 'Blog | Jpara Jewels',
    description: 'Styling tips, jewellery care guides and festive trends from Jpara Jewels.',
    canonical: `${origin}/blog`,
    body: `
    <section class="blog-hero">
      <div class="container">
        <span class="eyebrow">The Jpara Journal</span>
        <h1>Style notes &amp; <em>jewellery stories</em></h1>
        <p>Styling tips, care guides and festive trends.</p>
      </div>
    </section>
    <section class="container blog-list">
      ${cards || '<p class="blog-empty">No posts yet. Check back soon!</p>'}
    </section>`,
  });
}

function renderPost(post, origin, { preview = false, related = [] } = {}) {
  const canonical = `${origin}/blog/${post.slug}`;
  const description = post.metaDescription || excerpt(post.content);
  const image = absolute(origin, post.image);
  const date = post.publishedAt || post.createdAt;
  return layout({
    title: `${post.title} | Jpara Jewels`,
    description,
    canonical,
    image,
    type: 'article',
    robots: preview ? 'noindex, nofollow' : '',
    jsonLd: preview ? null : {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title, description, image: image || undefined,
      datePublished: date, dateModified: post.updatedAt || date,
      mainEntityOfPage: canonical, publisher: { '@type': 'Organization', name: 'Jpara Jewels' },
    },
    body: `
    ${preview ? '<div class="blog-preview-bar">👀 Draft preview: only you can see this. Publish it from the admin panel.</div>' : ''}
    <article class="blog-post container">
      <a href="/blog" class="blog-back">← All posts</a>
      <header>
        <time datetime="${esc(date)}">${fmtDate(date)} · ${readingMinutes(post.content)} min read</time>
        <h1>${esc(post.title)}</h1>
        ${post.metaDescription ? `<p class="blog-lead">${esc(post.metaDescription)}</p>` : ''}
      </header>
      ${post.image ? `<img class="blog-post-cover" src="${esc(post.image)}" alt="${esc(post.title)}">` : ''}
      <div class="blog-content">${renderContent(post.content)}</div>
      <div class="blog-cta">
        <h3>Love this look?</h3>
        <p>Explore our handpicked artificial jewellery collection.</p>
        <a href="/#shop" class="btn btn-primary">Shop the collection</a>
      </div>
    </article>
    ${related.length ? `
    <section class="container blog-related">
      <h2>More from the blog</h2>
      <div class="blog-list">${related.map(p => `
        <article class="blog-card">
          <a href="/blog/${esc(p.slug)}" class="blog-card-img">${cover(p)}</a>
          <div class="blog-card-body">
            <h3><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h3>
          </div>
        </article>`).join('')}
      </div>
    </section>` : ''}`,
  });
}

function renderNotFound(origin) {
  return layout({
    title: 'Post not found | Jpara Jewels',
    description: 'This blog post could not be found.',
    canonical: `${origin}/blog`,
    robots: 'noindex',
    body: '<section class="container blog-post"><h1>Post not found</h1><p>This post may have been removed. <a href="/blog">See all posts →</a></p></section>',
  });
}

module.exports = { esc, inline, layout, LIMITS, slugify, excerpt, renderContent, renderIndex, renderPost, renderNotFound };
