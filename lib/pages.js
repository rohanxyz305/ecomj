// Information pages: About, Contact, Privacy Policy, Terms & Conditions, FAQ.
// The text is editable from Admin > Pages and saved in data/pages.json; store details
// (email, phone…) are saved in data/settings.json. Until a page is edited, the default below is shown.
// Pages are rendered on the server (same layout as the blog) so search engines can read them.

const db = require('./db');
const { layout, esc, inline, renderContent, excerpt } = require('./blog');
const { SHIPPING, CATEGORIES } = require('./seed');

/* ---------------- Store details (editable in Admin > Pages) ---------------- */

const BUSINESS_DEFAULTS = {
  name: 'Jpara Jewels',
  email: 'hello@jparajewels.example',
  phone: '+91 00000 00000',
  whatsapp: '',        // digits with country code, e.g. 919876543210
  address: '',
  hours: 'Monday to Saturday, 10am to 7pm',
  instagram: '',       // full https:// link
  deliveryTime: '3 to 7 working days',
  returnDays: '7',
};
const BUSINESS_FIELDS = {
  name: 60, email: 120, phone: 30, whatsapp: 20, address: 200, hours: 80, instagram: 200, deliveryTime: 60, returnDays: 3,
};

function business() {
  const saved = db.read('settings', {}).business || {};
  const out = { ...BUSINESS_DEFAULTS };
  for (const key of Object.keys(BUSINESS_FIELDS)) if (typeof saved[key] === 'string') out[key] = saved[key];
  return out;
}

function readBusiness(body, fail) {
  const out = {};
  for (const [key, max] of Object.entries(BUSINESS_FIELDS)) out[key] = String(body[key] ?? '').trim().slice(0, max);
  if (!out.name) throw fail(400, 'Store name is required');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw fail(400, 'Please enter a valid email address');
  out.whatsapp = out.whatsapp.replace(/\D/g, '');
  if (out.instagram && !/^https:\/\//i.test(out.instagram)) throw fail(400, 'Instagram link must start with https://');
  if (!/^\d{1,3}$/.test(out.returnDays)) throw fail(400, 'Return days must be a number');
  return out;
}

// What the public store needs (footer contact column)
const publicBusiness = () => {
  const b = business();
  return { name: b.name, email: b.email, phone: b.phone, hours: b.hours, whatsapp: b.whatsapp, instagram: b.instagram };
};

/* ---------------- Placeholders usable in page text ---------------- */

const rupee = n => `₹${Number(n).toLocaleString('en-IN')}`;

function tokens() {
  const b = business();
  return {
    storeName: b.name, email: b.email, phone: b.phone, hours: b.hours, address: b.address,
    deliveryTime: b.deliveryTime, returnDays: b.returnDays,
    freeShippingAbove: rupee(SHIPPING.freeShippingAbove), shippingFee: rupee(SHIPPING.shippingFee),
    categories: `${CATEGORIES.slice(0, -1).join(', ').toLowerCase()} and ${CATEGORIES.at(-1).toLowerCase()}`,
  };
}
const fillTokens = (text, t) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(t, k) ? t[k] : m));
const TOKEN_HELP = ['storeName', 'email', 'phone', 'hours', 'address', 'deliveryTime', 'returnDays', 'freeShippingAbove', 'shippingFee', 'categories'];

/* ---------------- Default page text ---------------- */
// Formatting: ## Heading, ### Smaller heading, - list, **bold**, *italic*, [text](link), > quote
// On the FAQ page, each "### Question" followed by its answer becomes an open/close item.

const DEFAULTS = {
  about: {
    path: '/about', name: 'About Us',
    eyebrow: 'Our story',
    heading: 'About *{storeName}*',
    title: 'About Us',
    metaDescription: '{storeName} brings you beautiful, skin-friendly artificial jewellery for festive, bridal and everyday wear, with Cash on Delivery across India.',
    content: `Jewellery should make you feel special, whether it's your wedding day, a festival, or just a Tuesday. At {storeName} we make that sparkle easy and affordable.

## What we do
We handpick artificial jewellery that looks rich, feels light and stays comfortable all day. Our collection covers {categories}, in kundan, oxidised, pearl, American diamond and more.

## Why customers choose us
- **Premium plating:** multi-layer gold, rose-gold and rhodium finishes with an anti-tarnish coat.
- **Skin friendly:** nickel-safe, lightweight pieces you can wear from morning till late night.
- **Free shipping** on orders above {freeShippingAbove}, and **Cash on Delivery** across India.
- **Gift ready:** every order arrives in a keepsake box.

## Our promise
Every piece is checked before it is packed. If something arrives damaged or isn't what you ordered, tell us within {returnDays} days of delivery and we'll make it right. See our [FAQ](/faq) for details.`,
    cta: { title: 'Find your sparkle', text: 'Explore our latest designs, or say hello. We\'d love to hear from you.', primary: ['/#shop', 'Shop the collection'], secondary: ['/contact', 'Contact us'] },
  },

  contact: {
    path: '/contact', name: 'Contact Us',
    eyebrow: 'We\'re here to help',
    heading: 'Contact *us*',
    title: 'Contact Us',
    metaDescription: 'Questions about an order, a product or a gift? Contact {storeName} by email or phone. {hours}.',
    content: `Have a question about an order, a design or a gift? Get in touch and we'll reply as soon as we can.

## Opening hours
{hours}. Messages sent outside these hours are answered on the next working day.

## About an order?
Please include your **order number** (it starts with JP). You can find it under **My Orders** after signing in on the store. If a piece arrived damaged, a photo of the item and the packaging helps us sort it out quickly.

Many answers are already in our [Frequently Asked Questions](/faq).`,
  },

  privacy: {
    path: '/privacy-policy', name: 'Privacy Policy', showUpdated: true,
    eyebrow: 'Your data',
    heading: 'Privacy *policy*',
    title: 'Privacy Policy',
    metaDescription: 'How {storeName} collects, uses and protects your personal information when you shop with us.',
    content: `This policy explains what personal information {storeName} ("we", "us") collects when you use this website, why we collect it, and the choices you have. By using the website you agree to this policy.

## 1. Information we collect
- **Account details:** your name, email address and password when you create an account. Passwords are stored only in a scrambled (hashed) form, so nobody, including us, can read them.
- **Order details:** your name, mobile number, delivery address, city, pincode and the items you order.
- **Messages:** anything you send us by email, phone or WhatsApp.
- **Newsletter:** your email address, if you sign up to our newsletter in the website footer.
- **Technical data:** basic information your browser sends, such as your IP address, kept in our server logs for security (for example, to block repeated wrong password attempts).

We do **not** collect card, UPI or bank details. Orders are paid by Cash on Delivery.

## 2. How we use your information
- To create and manage your account and let you see your orders.
- To process, pack and deliver your orders, and to contact you about them.
- To answer your questions and handle returns or complaints.
- To send you our newsletter, only if you signed up for it. You can ask us to remove you at any time.
- To keep the website secure and prevent fraud or misuse.
- To meet our legal and tax obligations.

## 3. Cookies and storage on your device
We use only the cookies needed for the website to work: a sign-in cookie that keeps you logged in. Your bag and wishlist are saved in your own browser (local storage) so they are still there when you come back. We do not use advertising or tracking cookies.

Our pages load fonts from Google Fonts, so Google may receive your IP address when a page loads. Some product images may be loaded from other image websites.

## 4. Who we share it with
We never sell your personal information. We share it only when needed:
- **Courier and delivery partners**, who receive your name, phone number and address to deliver your order.
- **Our hosting provider**, which stores the website and its data on our behalf.
- **Authorities**, when the law requires it.

## 5. How long we keep it
We keep your account details while your account is open, and order records for as long as required for accounting and tax purposes. You can ask us to delete your account at any time (see below).

## 6. How we protect it
Passwords are hashed, sign-in sessions are signed and expire, repeated wrong login attempts are blocked, and access to the admin panel is restricted. No method of storing data online is 100% secure, but we work hard to protect yours.

## 7. Your rights
Under India's Digital Personal Data Protection Act, 2023 and other applicable laws, you can ask us to:
- tell you what personal information we hold about you;
- correct or update it;
- delete your account and personal information (except what we must keep by law);
- withdraw consent you have given.

Write to us at [{email}](mailto:{email}) and we will respond within a reasonable time.

## 8. Children
This website is meant for people aged 18 and over. If you are under 18, please use it with a parent or guardian.

## 9. Changes to this policy
We may update this policy from time to time. The "Last updated" date above shows when it last changed.

## 10. Contact and grievances
For any privacy question or complaint, contact us at [{email}](mailto:{email}) or {phone}.`,
  },

  terms: {
    path: '/terms-and-conditions', name: 'Terms & Conditions', showUpdated: true,
    eyebrow: 'The fine print',
    heading: 'Terms & *conditions*',
    title: 'Terms & Conditions',
    metaDescription: 'The terms for using the {storeName} website and buying from us: orders, Cash on Delivery, shipping, cancellations and returns.',
    content: `These terms apply when you use this website or buy from {storeName}. Please read them carefully. By using the website or placing an order, you agree to them.

## 1. Our products
We sell **artificial (imitation) jewellery**. Our products are not made of real gold, silver, diamonds or precious stones unless the product description clearly says so. Colours may look slightly different on your screen, and handcrafted pieces can vary a little from the photos.

## 2. Your account
You need an account to place an order. Please give correct details and keep your password private. You are responsible for activity on your account. You must be 18 or older, or use the website with a parent or guardian.

## 3. Prices and offers
All prices are in Indian Rupees (₹). Offers and discounts are applied automatically at checkout and may end at any time. If a price is clearly wrong because of an error, we may cancel the order and tell you.

## 4. Orders
When you place an order you'll see an order number starting with JP. We confirm the order after checking stock and your details. We may cancel an order if an item is out of stock, the address can't be delivered to, or we suspect misuse. If we do, we'll let you know.

## 5. Payment
Orders are paid by **Cash on Delivery**. Please keep the exact amount ready when the parcel arrives. Repeatedly refusing Cash on Delivery parcels may lead us to stop accepting orders from that account.

## 6. Shipping and delivery
Shipping is free on orders above {freeShippingAbove}; smaller orders have a delivery charge of {shippingFee}. Orders usually arrive in {deliveryTime}. Delivery times are estimates and can be affected by courier delays, holidays or weather.

## 7. Cancellations
You can cancel an order before it is shipped by contacting us with your order number. Once an order has shipped it can't be cancelled, but you can refuse it on delivery.

## 8. Returns and replacements
If your item arrives **damaged, defective or different from what you ordered**, contact us within **{returnDays} days of delivery** with your order number and photos. We'll arrange a replacement or refund after checking. For hygiene reasons, earrings and nose pins can be returned only if they are damaged or wrong. Damage caused by water, perfume, rough use or not following the care instructions is not covered.

## 9. Use of the website
Please don't misuse the website: no attempts to break in, overload it, copy it in bulk, or use it for anything illegal. All content, including photos, text, logos and designs, belongs to {storeName} or its licensors and may not be copied without permission.

## 10. Limitation of liability
To the extent the law allows, our liability for any order is limited to the amount you paid for it. We are not responsible for indirect losses or for delays caused by events outside our control.

## 11. Governing law
These terms are governed by the laws of India. Any dispute will be handled by the courts in India.

## 12. Changes and contact
We may update these terms; the version on this page applies to your order. Questions? Write to [{email}](mailto:{email}) or see our [Contact page](/contact).`,
  },

  faq: {
    path: '/faq', name: 'FAQ',
    eyebrow: 'Help centre',
    heading: 'Frequently asked *questions*',
    title: 'Frequently Asked Questions',
    metaDescription: 'Answers about ordering, Cash on Delivery, shipping, returns and jewellery care at {storeName}.',
    content: `## Ordering
### How do I place an order?
Add pieces to your bag, tap Checkout, sign in or create an account, enter your delivery address and place the order. You will see an order number starting with JP.
### Do I need an account to order?
Yes. A free account lets you place orders and track them under My Orders. It takes less than a minute to sign up.
### Can I change or cancel my order?
Yes, before it ships. Contact us at {email} with your order number. Once it has shipped it can't be changed, but you can refuse the parcel on delivery.

## Payment
### What payment methods do you accept?
We currently accept Cash on Delivery across India. Please keep the exact amount ready when your parcel arrives.
### Are there any extra charges?
No hidden charges. Shipping is free on orders above {freeShippingAbove}; smaller orders have a {shippingFee} delivery charge, shown before you place the order.

## Shipping & delivery
### How long does delivery take?
Orders usually arrive in {deliveryTime}, depending on your location.
### How can I track my order?
Sign in on the store and open My Orders (in the menu under your name) to see the status: Pending, Confirmed, Shipped or Delivered.
### Do you deliver all over India?
We deliver to most pincodes in India. If we can't deliver to your address, we'll contact you and cancel the order.

## Returns
### What if my item arrives damaged or wrong?
Contact us within {returnDays} days of delivery with your order number and photos of the item and packaging. We'll arrange a replacement or refund.
### Can I return an item if I change my mind?
We accept returns only for damaged, defective or wrong items. Please check the photos, description and size details before ordering.

## Product & care
### Is this real gold or silver?
No. Our jewellery is artificial (imitation) jewellery with premium gold, rose-gold or rhodium plating, made to look rich at an affordable price.
### Is it safe for sensitive skin?
Our pieces are nickel-safe and lightweight. If you have a known metal allergy, please check the material details on each product first.
### How do I care for my jewellery?
Keep it away from water, perfume and lotions. Wipe it with a soft dry cloth after wearing and store it in the box provided. This keeps the shine for much longer.
### Will the colour fade?
With proper care, the plating stays bright for a long time. Contact with water, sweat and perfume can make any plating fade faster.
### Do you offer gift packing?
Yes. Every order arrives in a keepsake box, ready to gift.`,
    cta: { title: 'Still have a question?', text: 'We\'re happy to help. {hours}.', primary: ['/contact', 'Contact us'] },
  },
};

const DEFAULT_UPDATED = '2026-11-07T00:00:00.000Z';
const EDITABLE = { eyebrow: 60, heading: 100, title: 70, metaDescription: 160, content: 50000 };

/* ---------------- Saved versions ---------------- */

// Saved text merged over the default; isDefault tells the admin whether it was ever edited
function getPage(key) {
  const def = DEFAULTS[key];
  if (!def) return null;
  const saved = db.read('pages', {})[key];
  const page = { key, path: def.path, name: def.name, isDefault: !saved, updatedAt: saved?.updatedAt || null };
  for (const field of Object.keys(EDITABLE)) page[field] = typeof saved?.[field] === 'string' ? saved[field] : def[field];
  return page;
}
const allPages = () => Object.keys(DEFAULTS).map(getPage);

function readPage(body, fail) {
  const out = {};
  for (const [field, max] of Object.entries(EDITABLE)) out[field] = String(body[field] ?? '').replace(/\r\n?/g, '\n').trim();
  out.metaDescription = out.metaDescription.replace(/\s+/g, ' ');
  for (const [field, max] of Object.entries(EDITABLE)) {
    if (out[field].length > max) throw fail(400, `${field === 'metaDescription' ? 'Meta description' : field[0].toUpperCase() + field.slice(1)} must be at most ${max} characters`);
  }
  if (!out.heading) throw fail(400, 'Heading is required');
  if (!out.title) throw fail(400, 'Browser title is required');
  if (!out.content) throw fail(400, 'Page content is required');
  return out;
}

function savePage(key, fields) {
  const all = db.read('pages', {});
  all[key] = { ...fields, updatedAt: new Date().toISOString() };
  db.write('pages', all);
  return getPage(key);
}

function resetPage(key) {
  const all = db.read('pages', {});
  delete all[key];
  db.write('pages', all);
  return getPage(key);
}

function saveBusiness(fields) {
  const settings = db.read('settings', {});
  settings.business = fields;
  db.write('settings', settings);
  return business();
}

/* ---------------- Rendering ---------------- */

// FAQ: "## Group" headings, and each "### Question" + the lines under it becomes an open/close item
function renderFaq(content) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  const qa = [];
  let intro = [];
  let current = null; // { q, lines }
  let open = false;
  const flushIntro = () => { if (intro.length) { html.push(renderContent(intro.join('\n'))); intro = []; } };
  const flushQ = () => {
    if (!current) return;
    if (!open) { html.push('<div class="faq-list">'); open = true; }
    const answer = current.lines.join('\n').trim();
    html.push(`<details class="faq-item"><summary>${inline(esc(current.q))}</summary><div class="faq-answer">${renderContent(answer)}</div></details>`);
    qa.push({ q: current.q, a: excerpt(answer, 1000) });
    current = null;
  };
  const closeList = () => { if (open) { html.push('</div>'); open = false; } };
  for (const line of lines) {
    const q = line.match(/^###\s+(.+)$/);
    const g = line.match(/^##\s+(.+)$/);
    if (q) { flushIntro(); flushQ(); current = { q: q[1].trim(), lines: [] }; }
    else if (g) { flushQ(); closeList(); flushIntro(); html.push(`<h2>${inline(esc(g[1].trim()))}</h2>`); }
    else if (current) current.lines.push(line);
    else intro.push(line);
  }
  flushQ(); closeList(); flushIntro();
  return { html: html.join('\n'), qa };
}

function contactCards(b) {
  return [
    b.email && `<a class="contact-card" href="mailto:${esc(b.email)}"><span>✉️</span><strong>Email</strong>${esc(b.email)}</a>`,
    b.phone && `<a class="contact-card" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}"><span>📞</span><strong>Call</strong>${esc(b.phone)}</a>`,
    b.whatsapp && `<a class="contact-card" href="https://wa.me/${esc(b.whatsapp)}" target="_blank" rel="noopener"><span>💬</span><strong>WhatsApp</strong>Chat with us</a>`,
    b.instagram && `<a class="contact-card" href="${esc(b.instagram)}" target="_blank" rel="noopener"><span>📸</span><strong>Instagram</strong>Follow us</a>`,
    b.address && `<div class="contact-card"><span>📍</span><strong>Visit</strong>${esc(b.address)}</div>`,
  ].filter(Boolean).join('');
}

function renderPage(key, origin) {
  const page = getPage(key);
  const def = DEFAULTS[key];
  const t = tokens();
  const b = business();
  const content = fillTokens(page.content, t);
  const fmtDate = iso => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  let bodyHtml;
  let jsonLd = null;
  if (key === 'faq') {
    const faq = renderFaq(content);
    bodyHtml = faq.html;
    if (faq.qa.length) {
      jsonLd = {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: faq.qa.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      };
    }
  } else {
    bodyHtml = renderContent(content);
  }
  // First paragraph styled as the intro (when the page starts with text, not a heading)
  bodyHtml = bodyHtml.replace(/^<p>/, '<p class="blog-lead">');
  if (key === 'contact') {
    const cards = contactCards(b);
    // Contact cards go after the intro paragraph
    bodyHtml = bodyHtml.replace(/^(<p class="blog-lead">[\s\S]*?<\/p>)?/, m => `${m}${cards ? `<div class="contact-grid">${cards}</div>` : ''}`);
  }
  if (def.showUpdated) bodyHtml = `<p class="page-updated">Last updated: ${fmtDate(page.updatedAt || DEFAULT_UPDATED)}</p>${bodyHtml}`;

  const cta = def.cta && `
      <div class="blog-cta">
        <h3>${esc(fillTokens(def.cta.title, t))}</h3>
        <p>${esc(fillTokens(def.cta.text, t))}</p>
        <a href="${def.cta.primary[0]}" class="btn btn-primary">${esc(def.cta.primary[1])}</a>
        ${def.cta.secondary ? `<a href="${def.cta.secondary[0]}" class="btn btn-outline-light">${esc(def.cta.secondary[1])}</a>` : ''}
      </div>`;

  return layout({
    title: `${fillTokens(page.title, t)} | ${b.name}`,
    description: fillTokens(page.metaDescription, t) || excerpt(content),
    canonical: `${origin}${page.path}`,
    jsonLd,
    body: `
    <section class="blog-hero page-hero">
      <div class="container">
        ${page.eyebrow ? `<span class="eyebrow">${esc(fillTokens(page.eyebrow, t))}</span>` : ''}
        <h1>${inline(esc(fillTokens(page.heading, t)))}</h1>
      </div>
    </section>
    <article class="blog-post container info-page">
      <div class="blog-content">${bodyHtml}${cta || ''}</div>
    </article>`,
  });
}

const ROUTES = Object.fromEntries(Object.entries(DEFAULTS).map(([key, d]) => [d.path, key]));

module.exports = {
  ROUTES, TOKEN_HELP, BUSINESS_FIELDS,
  allPages, getPage, readPage, savePage, resetPage, renderPage,
  business, readBusiness, saveBusiness, publicBusiness,
};
