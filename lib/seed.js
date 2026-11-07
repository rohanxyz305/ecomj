// Store settings + first-run sample data. Edit the lists below to customise the shop.
const db = require('./db');
const crypto = require('crypto');
const { hashPasswordSync } = require('./auth');

const CATEGORIES = ['Necklaces', 'Earrings', 'Rings', 'Bangles', 'Bracelets', 'Anklets', 'Maang Tikka', 'Jewellery Sets'];
const BADGES = ['', 'New', 'Bestseller', 'Trending', 'Limited'];
const SHIPPING = { freeShippingAbove: 999, shippingFee: 79 };

// Colour themes the admin can pick for an offer card (brand palette: espresso, champagne gold, ivory)
const OFFER_THEMES = {
  rose: 'linear-gradient(135deg, #3A2115, #6B4530)',     // Espresso
  violet: 'linear-gradient(135deg, #2A170E, #4A2C1C)',   // Dark cocoa
  ocean: 'linear-gradient(135deg, #6B4530, #9C7642)',    // Mocha to gold
  sunset: 'linear-gradient(135deg, #5A3220, #8B5A3C)',   // Cognac
  gold: 'linear-gradient(135deg, #8A6636, #B08A55)',     // Antique gold
  berry: 'linear-gradient(135deg, #4A1F14, #7A3A26)',    // Mahogany
};

// Photos shown in the round category tiles (files in public/images/categories)
const CATEGORY_IMAGES = {
  Necklaces: '/images/categories/necklaces.jpg',
  Earrings: '/images/categories/earrings.jpg',
  Rings: '/images/categories/rings.png',
  Bangles: '/images/categories/bangles.jpg',
  Bracelets: '/images/categories/bracelets.jpg',
  Anklets: '/images/categories/anklets.jpg',
  'Maang Tikka': '/images/categories/maang-tikka.jpg',
  'Jewellery Sets': '/images/categories/sets.jpg',
};

// Default text for the "Find your sparkle" category section (the admin can change it under Admin > Homepage)
const CATEGORY_SECTION = { eyebrow: 'Shop by category', title: 'Find your', highlight: 'sparkle' };

// [name, category, price, mrp, stock, badge, description, image]
const SAMPLE_PRODUCTS = [
  ['Kundan Bridal Choker Set', 'Jewellery Sets', 3499, 5999, 8, 'Bestseller', 'Gold-tone kundan choker with seed-pearl strands and an emerald-green drop pendant. A statement piece for weddings and receptions.', '/images/products/kundan-choker-set.jpg'],
  ['Silver Meena Jhumkas', 'Earrings', 549, 999, 25, 'Trending', 'Silver-tone bell jhumkas with black meena floral work and a row of faux pearl hangings. Light enough for all-day wear.', '/images/products/oxidised-jhumkas.jpg'],
  ['Long Pearl Drop Earrings', 'Earrings', 699, 1199, 18, 'New', 'Minimal threader earrings with a single lustrous faux pearl. Perfect for office, brunch and evenings out.', '/images/products/pearl-drop-earrings.jpg'],
  ['Emerald Cocktail Ring', 'Rings', 899, 1499, 12, '', 'Statement gold-tone ring with a faux emerald centre stone and a tiny ruby-red accent.', '/images/products/emerald-cocktail-ring.jpg'],
  ['Rainbow Lac Bangle Set (12 pcs)', 'Bangles', 1199, 1999, 10, 'Bestseller', 'Glossy lac bangles in red, orange and green, ready for haldi, mehendi and festive days. Size 2.6.', '/images/products/bangle-set.jpg'],
  ['Ruby Temple Necklace', 'Necklaces', 2299, 3799, 6, 'Limited', 'Antique gold-tone temple necklace with paisley motifs, ruby-red stones and delicate bead fringes.', '/images/products/temple-necklace.jpg'],
  ['Gold Band Bracelet Trio', 'Bracelets', 999, 1799, 14, 'New', 'Set of three gold-tone bracelets in textured and engraved finishes. Wear them stacked or alone.', '/images/products/gold-bracelets.jpg'],
  ['Ghungroo Silver Anklets', 'Anklets', 649, 1099, 20, '', 'Pair of silver-tone anklets with clusters of tiny ghungroo bells that chime softly as you walk.', '/images/products/ghungroo-anklets.jpg'],
  ['Meenakari Maang Tikka', 'Maang Tikka', 799, 1399, 9, 'Trending', 'Maang tikka with a blue and green meenakari pendant framed in sparkling stones, with pearl hangings.', '/images/products/maang-tikka.jpg'],
  ['Layered Bead Necklace', 'Necklaces', 1099, 1799, 0, '', 'Three-strand necklace of gold-tone and coral-red beads. Adjustable length.', '/images/products/layered-bead-necklace.jpg'],
  ['Colour Pop Open Rings (Set of 5)', 'Rings', 399, 699, 30, '', 'Five adjustable open rings with candy-coloured stones. Mix, match and stack them.', '/images/products/stacking-rings.jpg'],
  ['Pearl Kada Bracelet', 'Bracelets', 749, 1299, 11, 'Bestseller', 'Gold-tone openable kada with a lustrous faux pearl at its centre.', '/images/products/pearl-kada.jpg'],
];

// Highlight badges the admin can choose from, grouped (the group decides the icon on the store).
// Only claims that are true for artificial jewellery: no "925 Sterling Silver", "Waterproof" or "Hallmarked".
const HIGHLIGHT_OPTIONS = {
  material: ['Gold Plated', 'Rose Gold Plated', 'Silver Plated', 'Oxidised Silver Finish', 'Brass Base', 'Copper Base', 'Alloy Base', '316L Stainless Steel'],
  stone: ['American Diamond (AD)', 'Cubic Zirconia', 'Kundan', 'Meenakari', 'Faux Pearl', 'Polki-style', 'Handcrafted'],
  skin: ['Skin Friendly', 'Hypoallergenic', 'Nickel Free', 'Lead Free'],
  durability: ['Anti-Tarnish', 'Long-lasting Shine', 'Sweat Resistant'],
  fit: ['Adjustable', 'Free Size', 'Lightweight', 'Secure Closure', 'Extender Chain'],
  occasion: ['Everyday Wear', 'Party Wear', 'Festive Wear', 'Bridal'],
};

// Shown when a product has no highlights of its own
const CATEGORY_HIGHLIGHTS = {
  Necklaces: ['Gold Plated', 'Skin Friendly', 'Anti-Tarnish', 'Extender Chain'],
  Earrings: ['Lightweight', 'Skin Friendly', 'Nickel Free', 'Everyday Wear'],
  Rings: ['Adjustable', 'Skin Friendly', 'Anti-Tarnish', 'Party Wear'],
  Bangles: ['Skin Friendly', 'Long-lasting Shine', 'Lightweight', 'Festive Wear'],
  Bracelets: ['Skin Friendly', 'Anti-Tarnish', 'Secure Closure', 'Everyday Wear'],
  Anklets: ['Adjustable', 'Skin Friendly', 'Lightweight', 'Everyday Wear'],
  'Maang Tikka': ['Lightweight', 'Skin Friendly', 'Festive Wear', 'Bridal'],
  'Jewellery Sets': ['Bridal', 'Skin Friendly', 'Festive Wear', 'Handcrafted'],
};

// Specification rows shown in the product view (only filled rows are displayed)
const SPEC_FIELDS = {
  material: 'Material / Base',
  plating: 'Plating',
  stone: 'Stone type',
  closure: 'Closure',
  size: 'Size',
  care: 'Care tips',
};

const CARE = 'Keep away from water, perfume and lotions. Wipe with a soft dry cloth and store in the box provided.';

// Highlights + specs for the sample products, matched by name
const SAMPLE_DETAILS = {
  'Kundan Bridal Choker Set': {
    highlights: ['Kundan', 'Gold Plated', 'Faux Pearl', 'Bridal', 'Handcrafted', 'Extender Chain'],
    specs: { material: 'Brass base', plating: 'Gold plated', stone: 'Kundan stones, faux pearls and a green glass drop', closure: 'Adjustable dori (thread) tie', size: 'Choker, fits 12 to 16 inches', care: CARE },
  },
  'Silver Meena Jhumkas': {
    highlights: ['Oxidised Silver Finish', 'Meenakari', 'Faux Pearl', 'Lightweight', 'Festive Wear', 'Nickel Free'],
    specs: { material: 'Alloy base', plating: 'Oxidised silver finish', stone: 'Faux pearls with black meena enamel', closure: 'Fish hook', size: 'Drop length approx. 5 cm', care: CARE },
  },
  'Long Pearl Drop Earrings': {
    highlights: ['Silver Plated', 'Faux Pearl', 'Lightweight', 'Hypoallergenic', 'Everyday Wear'],
    specs: { material: 'Brass base', plating: 'Silver plated', stone: 'Faux pearl', closure: 'Pull-through threader', size: 'Drop length approx. 8 cm', care: CARE },
  },
  'Emerald Cocktail Ring': {
    highlights: ['Gold Plated', 'Adjustable', 'Cubic Zirconia', 'Party Wear', 'Anti-Tarnish'],
    specs: { material: 'Brass base', plating: 'Gold plated', stone: 'Emerald-green glass stone with a ruby-red CZ accent', closure: 'Open adjustable band', size: 'Free size (adjustable)', care: CARE },
  },
  'Rainbow Lac Bangle Set (12 pcs)': {
    highlights: ['Handcrafted', 'Lightweight', 'Festive Wear', 'Skin Friendly', 'Lead Free'],
    specs: { material: 'Lac (natural resin)', closure: 'Slip-on', size: '2.6 (inner diameter approx. 6.0 cm)', care: 'Keep away from heat and water. Store flat so the bangles keep their shape.' },
  },
  'Ruby Temple Necklace': {
    highlights: ['Gold Plated', 'Handcrafted', 'Bridal', 'Festive Wear', 'Anti-Tarnish', 'Extender Chain'],
    specs: { material: 'Copper base', plating: 'Antique gold plated', stone: 'Ruby-red glass stones with a bead fringe', closure: 'Hook with extender chain', size: 'Necklace length approx. 16 inches + 3 inch extender', care: CARE },
  },
  'Gold Band Bracelet Trio': {
    highlights: ['Gold Plated', 'Brass Base', 'Anti-Tarnish', 'Sweat Resistant', 'Everyday Wear'],
    specs: { material: 'Brass base', plating: 'Gold plated', closure: 'Slip-on band', size: 'Fits wrist sizes 2.4 to 2.6', care: CARE },
  },
  'Ghungroo Silver Anklets': {
    highlights: ['Oxidised Silver Finish', 'Handcrafted', 'Adjustable', 'Festive Wear', 'Nickel Free'],
    specs: { material: 'Alloy base', plating: 'Oxidised silver finish', closure: 'Hook with adjustable chain', size: 'Approx. 10 inches, adjustable to 11 inches (sold as a pair)', care: CARE },
  },
  'Meenakari Maang Tikka': {
    highlights: ['Meenakari', 'Kundan', 'Faux Pearl', 'Gold Plated', 'Bridal', 'Lightweight'],
    specs: { material: 'Brass base', plating: 'Gold plated', stone: 'Kundan stones, faux pearls and meena enamel', closure: 'Hair hook with chain', size: 'Pendant approx. 4 cm, chain approx. 15 cm', care: CARE },
  },
  'Layered Bead Necklace': {
    highlights: ['Gold Plated', 'Alloy Base', 'Lightweight', 'Everyday Wear', 'Extender Chain'],
    specs: { material: 'Alloy base with glass beads', plating: 'Gold plated', stone: 'Coral-red glass beads', closure: 'Lobster clasp', size: 'Adjustable 16 to 20 inches', care: CARE },
  },
  'Colour Pop Open Rings (Set of 5)': {
    highlights: ['Free Size', 'Adjustable', 'Cubic Zirconia', 'Gold Plated', 'Party Wear'],
    specs: { material: 'Brass base', plating: 'Gold plated', stone: 'Multi-coloured cubic zirconia', closure: 'Open adjustable band', size: 'Free size (set of 5 rings)', care: CARE },
  },
  'Pearl Kada Bracelet': {
    highlights: ['Gold Plated', 'Faux Pearl', 'Secure Closure', 'Anti-Tarnish', 'Party Wear'],
    specs: { material: 'Brass base', plating: 'Gold plated', stone: 'Faux pearl', closure: 'Screw-open kada', size: '2.6 (inner diameter approx. 6.0 cm)', care: CARE },
  },
};

function seed() {
  if (!db.exists('admin')) {
    const username = process.env.ADMIN_USER || 'admin';
    // No well-known default: use ADMIN_PASSWORD, or generate a random one and show it once
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.write('admin', { username, password: hashPasswordSync(password), version: 1 });
    console.log(`\n  Admin account created -> username: ${username}  password: ${generated ? password : '(the ADMIN_PASSWORD you set)'}`);
    if (generated) console.log('  This password is shown only once. Note it down, then change it in Admin > Settings.\n');
  }

  if (!db.exists('products')) {
    const now = Date.now();
    db.write('products', SAMPLE_PRODUCTS.map(([name, category, price, mrp, stock, badge, description, image], i) => ({
      id: db.newId(), name, category, price, mrp, stock, available: true, badge, description, image,
      highlights: SAMPLE_DETAILS[name]?.highlights || [], specs: SAMPLE_DETAILS[name]?.specs || {},
      createdAt: new Date(now - i * 86400000).toISOString(),
    })));
  } else {
    // Older stores: give sample products their highlights/specs once (never overwrites admin edits)
    const products = db.read('products');
    let changed = false;
    for (const p of products) {
      if (!('highlights' in p)) {
        p.highlights = SAMPLE_DETAILS[p.name]?.highlights || [];
        p.specs = SAMPLE_DETAILS[p.name]?.specs || {};
        changed = true;
      }
    }
    if (changed) db.write('products', products);
  }

  if (!db.exists('offers')) {
    const year = new Date().getFullYear();
    db.write('offers', [
      { id: db.newId(), title: 'Jhumka Jamboree', subtitle: 'Earrings at their happiest prices', discount: 25, category: 'Earrings', theme: 'rose', endsAt: `${year}-12-31`, active: true },
      { id: db.newId(), title: 'Bridal Edit', subtitle: 'Complete sets for your big day', discount: 20, category: 'Jewellery Sets', theme: 'gold', endsAt: `${year}-12-31`, active: true },
      { id: db.newId(), title: 'Festive Sparkle Sale', subtitle: 'Extra savings on everything', discount: 10, category: 'All', theme: 'violet', endsAt: `${year}-12-31`, active: true },
    ]);
  }

  if (!db.exists('users')) db.write('users', []);
  if (!db.exists('orders')) db.write('orders', []);
}

module.exports = {
  CATEGORIES, CATEGORY_IMAGES, CATEGORY_SECTION, BADGES, SHIPPING, OFFER_THEMES,
  HIGHLIGHT_OPTIONS, CATEGORY_HIGHLIGHTS, SPEC_FIELDS, seed,
};
