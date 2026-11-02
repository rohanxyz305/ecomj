/* Colourful SVG artwork used for any product that has no photo yet. Shared by store + admin. */
(function () {
  const BACKDROPS = [
    ['#F0E3D0', '#E4CFA8'], ['#FAF4EB', '#F0E3D0'], ['#EADBC3', '#D9BE93'], ['#F5E9D6', '#E8D9C3'],
    ['#F0E3D0', '#DCCBB2'], ['#FAF4EB', '#E4CFA8'],
  ];
  const GEMS = ['#8B1E2D', '#1F5C45', '#3A2115', '#6B4530', '#7A3A26'];

  const hash = str => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  const gem = (x, y, r, c) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="url(#g)" stroke-width="${Math.max(2, r / 3)}"/>` +
    `<circle cx="${x - r / 3}" cy="${y - r / 3}" r="${r / 3}" fill="#fff" opacity=".75"/>`;
  const bead = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#g)"/>`;
  const drop = (x, y, s, c) =>
    `<path d="M${x} ${y}C${x + s} ${y + s * 1.2} ${x + s} ${y + s * 2.2} ${x} ${y + s * 2.2}C${x - s} ${y + s * 2.2} ${x - s} ${y + s * 1.2} ${x} ${y}Z" fill="${c}" stroke="url(#g)" stroke-width="3"/>`;
  const star = (x, y, s) =>
    `<path d="M${x} ${y - s}L${x + s * 0.22} ${y - s * 0.22}L${x + s} ${y}L${x + s * 0.22} ${y + s * 0.22}L${x} ${y + s}L${x - s * 0.22} ${y + s * 0.22}L${x - s} ${y}L${x - s * 0.22} ${y - s * 0.22}Z" fill="#fff" opacity=".9"/>`;

  // Points along a quadratic curve, used to place beads on chains
  function curve([x0, y0], [x1, y1], [x2, y2], n) {
    return Array.from({ length: n }, (_, i) => {
      const t = (i + 1) / (n + 1);
      const u = 1 - t;
      return [u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2];
    });
  }

  function necklace(c) {
    const beads = curve([60, 70], [150, 250], [240, 70], 13).map(([x, y], i) => (i === 6 ? '' : bead(x, y, 6))).join('');
    return `<path d="M60 70Q150 250 240 70" fill="none" stroke="url(#g)" stroke-width="4"/>${beads}${drop(150, 168, 20, c)}${gem(150, 196, 8, '#fff')}${gem(150, 160, 10, c)}`;
  }
  function jhumka(x, c, scale = 1) {
    const w = 34 * scale, top = 70;
    const hang = [-1, -0.5, 0, 0.5, 1].map(k => bead(x + k * w * 0.85, top + 112 * scale, 4.5 * scale)).join('');
    return `${gem(x, top, 10 * scale, c)}<line x1="${x}" y1="${top + 10 * scale}" x2="${x}" y2="${top + 40 * scale}" stroke="url(#g)" stroke-width="4"/>` +
      `<path d="M${x - w} ${top + 104 * scale}Q${x} ${top + 10 * scale} ${x + w} ${top + 104 * scale}Z" fill="url(#g)"/>` +
      `${gem(x, top + 76 * scale, 8 * scale, c)}${hang}`;
  }

  const SHAPES = {
    Necklaces: necklace,
    Earrings: c => jhumka(100, c) + jhumka(200, c),
    Rings: c =>
      `<ellipse cx="150" cy="190" rx="62" ry="58" fill="none" stroke="url(#g)" stroke-width="14"/>` +
      `<polygon points="150,78 184,110 150,146 116,110" fill="${c}" stroke="url(#g)" stroke-width="5"/>` +
      `<polygon points="150,88 168,110 150,128" fill="#fff" opacity=".45"/>${gem(118, 140, 7, c)}${gem(182, 140, 7, c)}`,
    Bangles: c =>
      `<circle cx="115" cy="155" r="62" fill="none" stroke="url(#g)" stroke-width="11"/>` +
      `<circle cx="150" cy="155" r="62" fill="none" stroke="${c}" stroke-width="11"/>` +
      `<circle cx="185" cy="155" r="62" fill="none" stroke="url(#g)" stroke-width="11"/>` +
      [0, 1, 2, 3, 4, 5].map(i => gem(150 + 62 * Math.cos(i * 1.05), 155 + 62 * Math.sin(i * 1.05), 5, '#fff')).join(''),
    Bracelets: c =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        const x = 150 + 88 * Math.cos(a), y = 150 + 62 * Math.sin(a);
        return i % 2 ? gem(x, y, 10, c) : bead(x, y, 9);
      }).join(''),
    Anklets: c => {
      const pts = curve([40, 120], [150, 200], [260, 120], 9);
      return `<path d="M40 120Q150 200 260 120" fill="none" stroke="url(#g)" stroke-width="4"/>` +
        pts.map(([x, y], i) => `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 20}" stroke="url(#g)" stroke-width="2"/>${i % 2 ? gem(x, y + 26, 6, c) : bead(x, y + 26, 7)}`).join('');
    },
    'Maang Tikka': c =>
      `<line x1="150" y1="20" x2="150" y2="130" stroke="url(#g)" stroke-width="4"/>` +
      [40, 65, 90, 115].map(y => bead(150, y, 5)).join('') +
      `<circle cx="150" cy="172" r="38" fill="${c}" opacity=".25" stroke="url(#g)" stroke-width="9"/>${gem(150, 172, 14, c)}` +
      [-24, 0, 24].map(dx => drop(150 + dx, 212, 8, c)).join(''),
    'Jewellery Sets': c =>
      `<g transform="translate(30 40) scale(.8)">${necklace(c)}</g>${drop(48, 98, 12, c)}${gem(48, 90, 7, c)}${drop(252, 98, 12, c)}${gem(252, 90, 7, c)}`,
  };

  function svg(category, seed) {
    const h = hash(seed || category);
    const [a, b] = BACKDROPS[h % BACKDROPS.length];
    const c = GEMS[(h >>> 4) % GEMS.length];
    const draw = SHAPES[category] || SHAPES.Necklaces;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
      `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4b8"/><stop offset=".5" stop-color="#e3a312"/><stop offset="1" stop-color="#9c6200"/></linearGradient></defs>` +
      `<rect width="300" height="300" fill="url(#bg)"/><circle cx="245" cy="55" r="75" fill="#fff" opacity=".25"/><circle cx="40" cy="265" r="95" fill="#fff" opacity=".2"/>` +
      `${star(42, 48, 10)}${star(262, 250, 8)}${star(255, 120, 5)}${draw(c)}</svg>`;
  }

  window.JewelArt = {
    url: (category, seed) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(category, seed))}`,
  };
})();
