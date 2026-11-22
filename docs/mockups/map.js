/* Forest mockups — sample data + helpers shared by every page.
   Coordinates are FAKE local units = pixels of terrain.svg (1000×700, origin top-left).
   No latitude/longitude anywhere. Scale: 1 unit = 0.48 m (set in field-setup).

   Like the real data model, zone status is NOT stored: it is derived from the
   activity log + seasonal watering rules, so every page agrees by construction. */

const FOREST = {
  metresPerUnit: 0.48,
  today: "2026-11-22",
  defaultWaterIntervalDays: 7,
  wateringRules: [ // month ranges may wrap December
    { name: "Summer", from: 6, to: 9, days: 4 },
    { name: "Spring", from: 3, to: 5, days: 10 },
    { name: "Autumn", from: 10, to: 10, days: 10 },
    { name: "Winter", from: 11, to: 2, days: 14 },
  ],
  recentlyWateredDays: 7,
  plots: [
    { id: 1, name: "Plot 1", declaredHa: 6.2, pts: [[30,30],[470,30],[480,670],[40,600]] },
    { id: 2, name: "Plot 2", declaredHa: 4.96, pts: [[500,150],[840,150],[960,690],[500,690]] },
  ],
  zones: [
    { id: "Z1",  plot: 1, label: "Ninhos feitos",     kind: "cultivation", pts: [[70,70],[200,60],[210,150],[90,170]] },
    { id: "Z2",  plot: 1, label: "Encosta norte",     kind: "cultivation", pts: [[235,80],[335,90],[325,190],[245,180]] },
    { id: "Z3",  plot: 1, label: "Faixa oeste",       kind: "cultivation", pts: [[80,220],[180,210],[190,380],[90,400]] },
    { id: "Z4",  plot: 1, label: "Clareira",          kind: "cultivation", pts: [[230,240],[400,230],[410,360],[240,370]] },
    { id: "Z5",  plot: 1, label: "Covas de outubro",  kind: "cultivation", pts: [[225,420],[420,410],[430,560],[235,580]] },
    { id: "Z6",  plot: 1, label: "Linha do caminho",  kind: "cultivation", pts: [[90,450],[180,440],[190,560],[100,560]] },
    { id: "Z11", plot: 1, label: "Ressementeira",     kind: "cultivation", pts: [[100,335],[200,328],[205,385],[105,392]] }, // overlaps Z3
    { id: "Z7",  plot: 2, label: "Pinhal sul",        kind: "cultivation", pts: [[540,430],[700,420],[720,610],[540,640]] },
    { id: "Z8",  plot: 2, label: "Rochas",            kind: "cultivation", pts: [[560,240],[720,240],[740,370],[570,380]] },
    { id: "Z9",  plot: 2, label: "Mais ninhos",       kind: "cultivation", pts: [[760,300],[860,300],[900,460],[780,470]] },
    { id: "Z10", plot: 2, label: "Caminho norte",     kind: "path",        pts: [[600,200],[833,200],[836,225],[600,225]] },
  ],
  species: [
    { id: "sob", sci: "Quercus suber",         common: "sobreiro" },
    { id: "med", sci: "Arbutus unedo",         common: "medronheiro" },
    { id: "cas", sci: "Castanea sativa",       common: "castanheiro" },
    { id: "car", sci: "Quercus robur",         common: "carvalho-alvarinho" },
    { id: "pin", sci: "Pinus pinea",           common: "pinheiro-manso" },
    { id: "fre", sci: "Fraxinus angustifolia", common: "freixo" },
    { id: "cer", sci: "Prunus avium",          common: "cerejeira-brava" },
  ],
  // One activity can cover several zones; quantity is per zone (activity_zone).
  activities: [
    { id: "A1",  type: "sowing",   date: "2026-09-28", zones: { Z1: 100, Z2: 80, Z3: 60 }, unit: "covas", species: ["sob", "med"], notes: "Ninhos feitos e semeados" },
    { id: "A2",  type: "sowing",   date: "2026-10-05", zones: { Z5: 182, Z9: 60 }, unit: "covas", species: ["sob", "cas"] },
    { id: "A3",  type: "watering", date: "2026-10-10", zones: { Z1: null, Z2: null, Z3: null } },
    { id: "A4",  type: "planting", date: "2026-10-14", zones: { Z3: 30 }, unit: "trees", species: ["sob", "cas"] },
    { id: "A5",  type: "planting", date: "2026-10-20", zones: { Z7: 6 }, unit: "trees", species: ["pin"] },
    { id: "A6",  type: "watering", date: "2026-10-29", zones: { Z7: null } },
    { id: "A7",  type: "watering", date: "2026-11-02", zones: { Z2: null, Z3: null } },
    { id: "A8",  type: "planting", date: "2026-11-10", zones: { Z8: 25 }, unit: "trees", species: ["med"] },
    { id: "A9",  type: "watering", date: "2026-11-10", zones: { Z1: null, Z8: null } },
    { id: "A10", type: "planting", date: "2026-11-12", zones: { Z4: 48 }, unit: "trees", species: ["sob", "car"] },
    { id: "A11", type: "watering", date: "2026-11-12", zones: { Z4: null } },
    { id: "A12", type: "sowing",   date: "2026-11-15", zones: { Z11: 30 }, unit: "covas", species: ["sob"], notes: "Ressemear parte da faixa oeste" },
    { id: "A13", type: "watering", date: "2026-11-19", zones: { Z2: null, Z5: null, Z9: null } },
  ],
  // Trees counted per zone + species (alive / dead), from the plantings above.
  trees: [
    { zone: "Z3", species: "sob", alive: 19, dead: 1 },
    { zone: "Z3", species: "cas", alive: 10, dead: 0 },
    { zone: "Z4", species: "sob", alive: 40, dead: 0 },
    { zone: "Z4", species: "car", alive: 8,  dead: 0 },
    { zone: "Z7", species: "pin", alive: 6,  dead: 0 },
    { zone: "Z8", species: "med", alive: 25, dead: 0 },
  ],
  treeDots: [[260,260],[290,280],[320,300],[350,270],[380,320],[300,340],[270,320],[590,270],[620,300],[660,280],[700,330],[640,350],[600,360]],
  tasks: [
    { id: 1, title: "Melhorar caminho",     kind: "Improve path", zone: "Z10", status: "open",        due: "2026-11-30" },
    { id: 2, title: "Falta semear",         kind: "Sow",          zone: "Z6",  status: "open",        due: "2026-11-25" },
    { id: 3, title: "Falta adubar e regar", kind: "Fertilize",    zone: "Z3",  status: "in_progress", due: "2026-11-20" },
    { id: 4, title: "Mais ninhos",          kind: "Add nests",    zone: "Z9",  status: "open",        due: "2026-12-05" },
    { id: 5, title: "Refazer caminho",      kind: "Improve path", plot: 2,     status: "open",        due: null },
    { id: 6, title: "Semear encosta norte", kind: "Sow",          zone: "Z2",  status: "done",        due: "2026-09-30" },
    { id: 7, title: "Vedação poente",       kind: "Other",        plot: 1,     status: "cancelled",   due: null },
  ],
};

const STATUS_LABEL = {
  "needs-water": "Needs water (seasonal rule)",
  "watered": "Watered ≤ 7 d",
  "planted": "Planted",
  "sown": "Sown",
  "unsown": "Not sown yet",
  "path": "Path / other",
};
const ACT = {
  sowing:      { label: "Sowed",      cls: "sown",    ico: "🕳️" },
  planting:    { label: "Planted",    cls: "planted", ico: "🌱" },
  watering:    { label: "Watered",    cls: "watered", ico: "💧" },
  fertilizing: { label: "Fertilized", cls: "path",    ico: "🧪" },
  other:       { label: "Other",      cls: "path",    ico: "•" },
};

/* ---------- dates ---------- */
const MONTHS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
function fmt(iso) { if (!iso) return "—"; const [, m, d] = iso.split("-"); return `${+d} ${MONTHS[m - 1]}`; }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }
function addDays(iso, n) { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

/* ---------- derived state (mirrors the zone_status view) ---------- */
function intervalFor(iso) {
  const m = +iso.slice(5, 7);
  const match = FOREST.wateringRules.filter(r => r.from <= r.to ? m >= r.from && m <= r.to : m >= r.from || m <= r.to);
  return match.length ? match[0].days : FOREST.defaultWaterIntervalDays;
}
function zoneEvents(zoneId, asOf = FOREST.today) {
  return FOREST.activities.filter(a => zoneId in a.zones && a.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
}
function lastOf(zoneId, type, asOf) { const e = zoneEvents(zoneId, asOf).find(a => a.type === type); return e ? e.date : null; }
function zoneStatus(z, asOf = FOREST.today) {
  if (z.kind !== "cultivation") return "path";
  const ev = zoneEvents(z.id, asOf);
  if (!ev.length) return "unsown";
  const last = ev[0].date;  // GREATEST(watered, sown, planted)
  if (daysBetween(last, asOf) >= intervalFor(asOf)) return "needs-water";
  const w = lastOf(z.id, "watering", asOf);
  if (w && daysBetween(w, asOf) <= FOREST.recentlyWateredDays) return "watered";
  if (lastOf(z.id, "planting", asOf)) return "planted";
  return "sown";
}
const zoneById = id => FOREST.zones.find(z => z.id === id);
const speciesById = id => FOREST.species.find(s => s.id === id);
const zonesOfPlot = pid => FOREST.zones.filter(z => z.plot === pid);
function tasksOfPlot(pid) {
  return FOREST.tasks.filter(t => t.plot === pid || (t.zone && zoneById(t.zone).plot === pid));
}
const isOpen = t => t.status === "open" || t.status === "in_progress";

/* ---------- geometry ---------- */
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
function areaHa(pts) { return polyArea(pts) * FOREST.metresPerUnit ** 2 / 10000; }
function centroid(pts) { const n = pts.length; return pts.reduce(([sx, sy], [x, y]) => [sx + x / n, sy + y / n], [0, 0]); }
function inside([x, y], pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function bbox(pts, margin = 40) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin;
  return [x, y, Math.max(...xs) - x + margin, Math.max(...ys) - y + margin];
}

/* ---------- SVG map ---------- */
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/* renderMap(container, { onZoneClick(z, poly, point), highlight, showLabels, layers, asOf, viewBox, scaleBar }) */
function renderMap(container, opts = {}) {
  const vb = opts.viewBox || [0, 0, 1000, 700];
  const svg = el("svg", { viewBox: vb.join(" "), preserveAspectRatio: "xMidYMid meet" });
  el("image", { href: "terrain.svg", x: 0, y: 0, width: 1000, height: 700 }, svg);

  const gPlots = el("g", { "data-layer": "plots" }, svg);
  FOREST.plots.forEach(p => {
    el("polygon", { class: "plot", points: p.pts.join(" ") }, gPlots);
    const t = el("text", { class: "plot-label lbl", x: p.pts[0][0] + 14, y: p.pts[0][1] + 26 }, gPlots);
    t.textContent = `${p.name.toUpperCase()} · label ${p.declaredHa} ha`;
  });

  const gZones = el("g", { "data-layer": "zones" }, svg);
  const gZoneLabels = el("g", { "data-layer": "zones" }, svg);
  FOREST.zones.forEach(z => {
    const poly = el("polygon", { class: "zone", points: z.pts.join(" "), "data-id": z.id }, gZones);
    el("title", {}, poly).textContent = `${z.id} · ${z.label}`;
    if (opts.highlight && opts.highlight !== z.id) poly.classList.add("is-dim");
    if (opts.onZoneClick) poly.addEventListener("click", e => opts.onZoneClick(z, poly, svgPoint(svg, e)));
    if (opts.showLabels !== false && z.kind === "cultivation") {
      const [cx, cy] = centroid(z.pts);
      el("text", { class: "zone-label lbl", x: cx, y: cy, "text-anchor": "middle", "data-id": z.id }, gZoneLabels).textContent = z.id;
    }
  });

  const gTrees = el("g", { "data-layer": "trees" }, svg);
  FOREST.treeDots.forEach(([x, y]) => el("circle", { class: "tree", cx: x, cy: y, r: 4 }, gTrees));

  // Tasks have no position of their own: pin at the zone centroid, or under the plot label.
  const gTasks = el("g", { "data-layer": "tasks" }, svg);
  FOREST.tasks.filter(isOpen).forEach(t => {
    let [x, y] = t.zone ? centroid(zoneById(t.zone).pts) : [FOREST.plots[t.plot - 1].pts[0][0] + 24, FOREST.plots[t.plot - 1].pts[0][1] + 50];
    if (t.zone) y += 20;
    const a = el("a", { href: "tasks.html", class: "task-pin" }, gTasks);
    el("circle", { cx: x, cy: y, r: 8, class: "pin" }, a);
    el("text", { x: x + 12, y: y + 4, class: "lbl task-lbl" }, a).textContent = t.title;
  });

  if (opts.scaleBar !== false) {
    const len = 50 / FOREST.metresPerUnit;
    const sb = el("g", { class: "scale-bar" }, svg);
    el("line", { x1: 20, y1: 685, x2: 20 + len, y2: 685 }, sb);
    el("text", { x: 20, y: 675, class: "lbl" }, sb).textContent = "50 m";
  }

  if (opts.layers) for (const k in opts.layers) setLayer(svg, k, opts.layers[k]);
  container.appendChild(svg);
  colourZones(svg, opts.asOf);

  // Keep labels a constant on-screen size whatever the map's rendered width.
  const resize = () => {
    const k = Math.max(vb[2] / Math.max(svg.clientWidth, 1), vb[3] / Math.max(svg.clientHeight, 1)); // 'meet' fits the tighter axis
    svg.style.setProperty("--k", k);
    svg.querySelectorAll("circle.pin").forEach(c => c.setAttribute("r", 7 * k));
  };
  new ResizeObserver(resize).observe(svg);
  return svg;
}
function colourZones(svg, asOf = FOREST.today) {
  FOREST.zones.forEach(z => {
    const poly = svg.querySelector(`polygon[data-id="${z.id}"]`);
    const st = zoneStatus(z, asOf);
    [...poly.classList].filter(c => c.startsWith("zone--")).forEach(c => poly.classList.remove(c));
    poly.classList.add(`zone--${st}`);
    poly.dataset.status = st;
  });
}
function svgPoint(svg, e) {
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const { x, y } = p.matrixTransform(svg.getScreenCTM().inverse());
  return [Math.round(x), Math.round(y)];
}
function setLayer(svg, name, on) {
  svg.querySelectorAll(`[data-layer="${name}"]`).forEach(g => g.style.display = on ? "" : "none");
}

function legendHTML() {
  return `<div class="legend">
    <span><i class="swatch outline"></i>Plot</span>
    ${Object.entries(STATUS_LABEL).map(([k, v]) => `<span><i class="swatch zone--${k}"></i>${v}</span>`).join("")}
    <span><i class="swatch pin-swatch"></i>Open task</span>
  </div>`;
}

/* ---------- shared nav (top on desktop, bottom tabs on phones) + sync status ---------- */
function renderNav(current) {
  const links = [
    ["map.html", "Map", "🗺️"], ["quick-log.html", "Log", "＋"], ["tasks.html", "Tasks", "✓"],
    ["draw-zone.html", "Draw zone"], ["zone-detail.html", "Zone"], ["species.html", "Species"],
    ["plot-stats.html", "Stats"], ["field-setup.html", "Field setup"],
  ];
  const nav = document.createElement("nav");
  nav.className = "nav";
  nav.innerHTML = `<a class="brand" href="index.html">🌳 Forest</a>` +
    links.map(([h, t]) => `<a class="nav-link" href="${h}"${h === current ? ' aria-current="page"' : ""}>${t}</a>`).join("") +
    `<span class="spacer"></span><span class="sync" title="Entries saved on this device, sent when signal returns">📴 Offline · 2 queued</span>`;
  const tabs = document.createElement("nav");
  tabs.className = "tabs";
  const main = links.slice(0, 3);
  tabs.innerHTML = main.map(([h, t, i]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ""}><b>${i}</b>${t}</a>`).join("") +
    `<a href="index.html"${!main.some(l => l[0] === current) ? ' aria-current="page"' : ""}><b>☰</b>More</a>`;
  document.body.prepend(nav);
  document.body.append(tabs);
}
