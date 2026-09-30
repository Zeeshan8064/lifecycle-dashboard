// ===== Helpers =====
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-US");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dayDate(i) { return new Date(START + i * 864e5); }
function fmtDay(i) { const d = dayDate(i); return d.getUTCDate() + " " + MON[d.getUTCMonth()]; }
function fmtDayFull(i) { return fmtDay(i) + " " + dayDate(i).getUTCFullYear(); }
function toInput(i) { return dayDate(i).toISOString().slice(0, 10); }
function fromInput(str) {
  const [y, m, d] = str.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - START) / 864e5);
}

let CTX = null;                 // current filters ka saara computed data
let currentMetric = "registered";
let mainChart = null;
let channelChart = null;

const REF_IDX = RETENTION_ITEMS.findIndex((r) => r.name === "Referrals");

// ===== FILTERS =====
function getChannel() { return $("channelFilter").value; }   // all | app | web
function getProduct() { return $("productFilter").value; }   // all | lp | ...

function getRange() {
  const v = $("rangeFilter").value;
  let from, to;
  if (v === "today")          { from = to = TODAY_IDX; }
  else if (v === "yesterday") { from = to = TODAY_IDX - 1; }
  else if (v === "7d")        { from = TODAY_IDX - 6;  to = TODAY_IDX; }
  else if (v === "30d")       { from = TODAY_IDX - 29; to = TODAY_IDX; }
  else if (v === "month")     { from = 92; to = TODAY_IDX; }      // 1 Sep - 23 Sep
  else if (v === "lastmonth") { from = 61; to = 91; }             // Aug
  else {
    from = fromInput($("dateFrom").value);
    to = fromInput($("dateTo").value);
    if (isNaN(from) || isNaN(to)) { from = TODAY_IDX - 29; to = TODAY_IDX; }
  }
  from = Math.max(0, Math.min(from, TODAY_IDX));
  to = Math.max(0, Math.min(to, TODAY_IDX));
  if (from > to) [from, to] = [to, from];
  return { from, to, len: to - from + 1 };
}

function rangeText(r) {
  return r.from === r.to ? fmtDayFull(r.from) : fmtDay(r.from) + " – " + fmtDayFull(r.to);
}

// date + product + channel ke hisaab se customers
function pickCustomers(from, to, ch) {
  const pr = getProduct();
  return CUSTOMERS.filter(
    (c) => c.d >= from && c.d <= to && (pr === "all" || c.prod === pr) && (ch === "all" || c.ch === ch)
  );
}

// cum[j] = kitne customers stage j tak (ya us se aage) pohnche
function funnelCounts(list) {
  const n = Array(7).fill(0);
  list.forEach((c) => n[c.s]++);
  const cum = Array(7).fill(0);
  let run = 0;
  for (let j = 6; j >= 0; j--) { run += n[j]; cum[j] = run; }
  return cum;
}

function formatVal(m, v) {
  if (m.format === "num") return fmt(v);
  if (m.format === "pct") return v.toFixed(m.decimals) + "%";
  return v.toFixed(m.decimals) + " days";
}

// ===== METRICS =====
function collect(from, to) {
  const len = to - from + 1;
  const list = pickCustomers(from, to, getChannel());
  const reg = Array(len).fill(0), pol = Array(len).fill(0);
  const ttp = Array(len).fill(0), ref = Array(len).fill(0);
  list.forEach((c) => {
    const k = c.d - from;
    reg[k]++;
    if (c.s === 6) { pol[k]++; ttp[k] += c.ttp; if ((c.ret >> REF_IDX) & 1) ref[k]++; }
  });
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const R = sum(reg), P = sum(pol);
  return {
    reg, pol, ttp, ref, R, P,
    conv: R ? (P / R) * 100 : 0,
    avgT: P ? sum(ttp) / P : 0,
    refP: P ? (sum(ref) / P) * 100 : 0,
  };
}

const ratio = (a, b, mult, dec) => a.map((x, i) => (b[i] ? +((x / b[i]) * mult).toFixed(dec) : 0));

// ek din select ho to 24 ghante ka dummy curve
const HW = Array.from({ length: 24 }, (_, h) =>
  0.25 + Math.exp(-Math.pow((h - 11) / 3.2, 2)) + 0.9 * Math.exp(-Math.pow((h - 20) / 2.6, 2))
);
function hourly(total, isCount, seed) {
  if (total == null) return null;
  if (isCount) {
    const s = HW.reduce((a, b) => a + b, 0);
    const arr = HW.map((w) => Math.round((total * w) / s));
    arr[12] += total - arr.reduce((a, b) => a + b, 0);
    return arr;
  }
  return HW.map((_, h) => +(total * (1 + 0.07 * Math.sin(h * 0.8 + seed))).toFixed(1));
}

function buildMetrics(range) {
  const { from, to, len } = range;
  const cur = collect(from, to);
  const prev = from - len >= 0 ? collect(from - len, from - 1) : null;
  const pc = (a, b) => (b ? ((a - b) / b) * 100 : null);

  const M = {
    registered: {
      label: "Total signups", format: "num", decimals: 0, unit: "%", count: true,
      total: cur.R, prevTotal: prev && prev.R,
      delta: prev ? pc(cur.R, prev.R) : null,
      current: cur.reg, previous: prev && prev.reg,
    },
    policyholders: {
      label: "Policyholders", format: "num", decimals: 0, unit: "%", count: true,
      total: cur.P, prevTotal: prev && prev.P,
      delta: prev ? pc(cur.P, prev.P) : null,
      current: cur.pol, previous: prev && prev.pol,
    },
    conversion: {
      label: "Overall conversion", format: "pct", decimals: 1, unit: "pp",
      total: +cur.conv.toFixed(1), prevTotal: prev && +prev.conv.toFixed(1),
      delta: prev ? cur.conv - prev.conv : null,
      current: ratio(cur.pol, cur.reg, 100, 1),
      previous: prev && ratio(prev.pol, prev.reg, 100, 1),
    },
    time: {
      label: "Avg. time to policy", format: "days", decimals: 1, unit: "%", lowerIsBetter: true,
      total: +cur.avgT.toFixed(1), prevTotal: prev && +prev.avgT.toFixed(1),
      delta: prev ? pc(cur.avgT, prev.avgT) : null,
      current: ratio(cur.ttp, cur.pol, 1, 1),
      previous: prev && ratio(prev.ttp, prev.pol, 1, 1),
    },
    referrals: {
      label: "Referrals", format: "pct", decimals: 0, unit: "pp",
      total: +cur.refP.toFixed(0), prevTotal: prev && +prev.refP.toFixed(0),
      delta: prev ? cur.refP - prev.refP : null,
      current: ratio(cur.ref, cur.pol, 100, 1),
      previous: prev && ratio(prev.ref, prev.pol, 100, 1),
    },
  };

  let labels;
  if (len === 1) {
    labels = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00");
    Object.values(M).forEach((m, k) => {
      m.current = hourly(m.total, m.count, k + 1);
      m.previous = m.prevTotal == null ? null : hourly(m.prevTotal, m.count, k + 7);
    });
  } else {
    labels = Array.from({ length: len }, (_, k) => fmtDay(from + k));
  }
  return { M, labels };
}

// ===== COMPUTE (filters badle to sab dobara) =====
function compute() {
  const range = getRange();
  const ch = getChannel();
  const base = pickCustomers(range.from, range.to, "all");           // date + product
  const list = ch === "all" ? base : base.filter((c) => c.ch === ch); // + channel
  CTX = {
    range, ch, base, list,
    cnt: funnelCounts(list),
    cntApp: funnelCounts(base.filter((c) => c.ch === "app")),
    cntWeb: funnelCounts(base.filter((c) => c.ch === "web")),
    metrics: buildMetrics(range),
  };
}

// ===== TOP STATS =====
function renderStats() {
  const { M } = CTX.metrics;
  const len = CTX.range.len;
  const note = len === 1 ? "vs prev. day" : `vs prev. ${len} days`;

  $("stats").innerHTML = Object.entries(M)
    .map(([key, m]) => {
      let deltaHtml;
      if (m.delta == null) {
        deltaHtml = `<span class="delta none">–<small>no previous data</small></span>`;
      } else {
        const good = m.lowerIsBetter ? m.delta < 0 : m.delta > 0;
        const arrow = m.delta > 0 ? "↑" : m.delta < 0 ? "↓" : "•";
        const cls = m.delta === 0 ? "none" : good ? "good" : "bad";
        deltaHtml = `<span class="delta ${cls}">${arrow} ${Math.abs(+m.delta.toFixed(1))}${m.unit}<small>${note}</small></span>`;
      }
      const link =
        key === "registered" ? `<span class="stat-link" data-act="stage:0">View customers →</span>` :
        key === "policyholders" ? `<span class="stat-link" data-act="stage:6">View customers →</span>` :
        key === "referrals" ? `<span class="stat-link" data-act="ret:${REF_IDX}">View customers →</span>` : "";
      return `
        <button class="stat ${key === currentMetric ? "active" : ""}" data-metric="${key}">
          <span class="stat-label">${m.label}</span>
          <span class="stat-value">${formatVal(m, m.total)}</span>
          ${deltaHtml}
          ${link}
        </button>`;
    })
    .join("");

  document.querySelectorAll(".stat").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-act]")) return; // "View customers" link alag handle hota hai
      currentMetric = btn.dataset.metric;
      renderStats();
      drawMainChart();
    });
  });
}

// ===== MAIN LINE CHART =====
function drawMainChart() {
  const m = CTX.metrics.M[currentMetric];
  const labels = CTX.metrics.labels;
  const ctx = $("mainChart").getContext("2d");
  const accent = css("--accent");

  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, "rgba(88, 80, 236, 0.25)");
  grad.addColorStop(1, "rgba(88, 80, 236, 0)");

  if (mainChart) mainChart.destroy();

  const { from, len } = CTX.range;
  const daily = len > 1;
  const DESC = {
    registered: "New customers who signed up",
    policyholders: "Policies issued",
    conversion: "Share of signups who bought a policy",
    time: "Average days from registration to policy",
    referrals: "Share of policyholders who referred someone",
  };
  const prevRange = { from: from - len, to: from - 1 };
  $("chartHead").innerHTML = `
    <div>
      <div class="chart-title">${m.label} <span>· ${daily ? "per day" : "per hour"}</span></div>
      <div class="chart-sub">${DESC[currentMetric]}${daily ? ", for each day in the selected range" : ", by hour of the day"}. Click a card above to change the metric.</div>
    </div>
    <div class="chart-legend">
      <span><i class="lg-solid"></i>This period · ${rangeText(CTX.range)}</span>
      ${m.previous ? `<span><i class="lg-dash"></i>Previous period · ${rangeText(prevRange)}</span>` : ""}
    </div>`;

  const datasets = [
    {
      label: "This period",
      data: m.current,
      borderColor: accent,
      backgroundColor: grad,
      borderWidth: 2,
      fill: true,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: accent,
    },
  ];
  if (m.previous) {
    datasets.push({
      label: "Previous period",
      data: m.previous,
      borderColor: "rgba(156, 163, 175, 0.8)",
      borderWidth: 1.5,
      borderDash: [4, 4],
      fill: false,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 3,
    });
  }

  mainChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111827",
          padding: 10,
          cornerRadius: 8,
          titleFont: { weight: "600" },
          callbacks: {
            label: (c) => {
              const isPrev = c.dataset.label === "Previous period";
              const when = isPrev ? ` (${fmtDay(daily ? from - len + c.dataIndex : from - 1)})` : "";
              return `${c.dataset.label}${when}: ${formatVal(m, c.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: css("--muted"), maxTicksLimit: 8, maxRotation: 0 },
        },
        y: {
          beginAtZero: m.format === "num",
          grace: "10%",
          grid: { color: css("--grid") },
          border: { display: false },
          ticks: {
            color: css("--muted"),
            maxTicksLimit: 5,
            callback: (v) => {
              if (m.format === "num") return v >= 1000 ? v / 1000 + "k" : v;
              if (m.format === "pct") return v + "%";
              return v + "d";
            },
          },
        },
      },
    },
  });
}

// ===== CHANNEL BAR CHART =====
const CH_STAGES = [0, 2, 3, 4, 5, 6];

function channelShares() {
  const app = CH_STAGES.map((j) => {
    const t = CTX.cntApp[j] + CTX.cntWeb[j];
    return t ? Math.round((CTX.cntApp[j] / t) * 100) : 0;
  });
  const web = CH_STAGES.map((j, i) => (CTX.cntApp[j] + CTX.cntWeb[j] ? 100 - app[i] : 0));
  return { app, web };
}

function updateShare() {
  const b = document.querySelectorAll(".share b");
  const t = CTX.cntApp[0] + CTX.cntWeb[0];
  const app = t ? Math.round((CTX.cntApp[0] / t) * 100) : 0;
  b[0].textContent = app + "%";
  b[1].textContent = (t ? 100 - app : 0) + "%";
}

function drawChannelChart() {
  const ch = CTX.ch;
  const sh = channelShares();
  const ctx = $("channelChart").getContext("2d");
  if (channelChart) channelChart.destroy();

  const all = [
    { key: "app", label: "App", data: sh.app, backgroundColor: "#a5b4fc" },
    { key: "web", label: "Web", data: sh.web, backgroundColor: css("--accent") },
  ];
  const datasets = (ch === "all" ? all : all.filter((d) => d.key === ch)).map((d) => ({
    label: d.label,
    data: d.data,
    backgroundColor: d.backgroundColor,
    borderRadius: 4,
    barPercentage: 0.8,
  }));

  channelChart = new Chart(ctx, {
    type: "bar",
    data: { labels: CH_STAGES.map((j) => STAGES[j]), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111827",
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: css("--muted"), font: { size: 11 } },
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: css("--grid") },
          border: { display: false },
          ticks: { color: css("--muted"), stepSize: 25, callback: (v) => v + "%" },
        },
      },
    },
  });
}

// ===== FRICTION =====
function renderFriction() {
  const counts = Array(ERRORS.length).fill(0);
  CTX.list.forEach((c) => { if (c.err >= 0) counts[c.err]++; });
  const rows = counts.map((n, k) => ({ k, n })).sort((a, b) => b.n - a.n);
  const max = Math.max(...rows.map((r) => r.n), 1);
  const reg = CTX.cnt[0];

  $("friction").innerHTML = rows
    .map(
      (r) => `
    <div class="bar-row" data-act="err:${r.k}">
      <div class="bar-fill red" style="width:${(r.n / max) * 100}%"></div>
      <span class="bar-label">${ERRORS[r.k]}</span>
      <span class="bar-values"><span class="n">${fmt(r.n)}</span><span class="p">${reg ? ((r.n / reg) * 100).toFixed(1) : "0.0"}%</span></span>
    </div>`
    )
    .join("");
}

// ===== TABLE =====
function renderBreakdown() {
  const { cnt, cntApp, cntWeb, ch } = CTX;
  const dim = (c) => (ch !== "all" && ch !== c ? 'style="opacity:.35"' : "");

  const pcts = STAGES.map((_, j) => (j && cnt[j - 1] ? (1 - cnt[j] / cnt[j - 1]) * 100 : 0));
  const worst = pcts.indexOf(Math.max(...pcts));
  $("overallBadge").textContent = (cnt[0] ? ((cnt[6] / cnt[0]) * 100).toFixed(1) : "0.0") + "% overall";

  $("breakdown").innerHTML = STAGES.map((name, j) => {
    const has = j > 0 && cnt[j - 1];
    const rate = j === 0 ? "100%" : has ? ((cnt[j] / cnt[j - 1]) * 100).toFixed(1) + "%" : "0%";
    const lost = has ? fmt(cnt[j - 1] - cnt[j]) : "–";
    const chDrop = (arr) => (has && arr[j - 1] ? ((1 - arr[j] / arr[j - 1]) * 100).toFixed(1) + "%" : "–");
    const act = has ? ` data-act="drop:${j}"` : "";
    return `
    <tr data-act="stage:${j}"${j === worst ? ' class="worst"' : ""}>
      <td>${name}</td>
      <td class="num" ${dim("app")} data-act="stage:${j}:app">${fmt(cntApp[j])}</td>
      <td class="num" ${dim("web")} data-act="stage:${j}:web">${fmt(cntWeb[j])}</td>
      <td class="num"><b>${fmt(cnt[j])}</b></td>
      <td class="num">${rate}</td>
      <td class="num"${act}>${lost}</td>
      <td class="num ${has ? "drop" : ""}" ${dim("app")}${has ? ` data-act="drop:${j}:app"` : ""}>${chDrop(cntApp)}</td>
      <td class="num ${has ? "drop" : ""}" ${dim("web")}${has ? ` data-act="drop:${j}:web"` : ""}>${chDrop(cntWeb)}</td>
    </tr>`;
  }).join("");
}

// ===== SAB KUCH DOBARA DRAW =====
function renderAll() {
  compute();
  renderStats();
  drawMainChart();
  updateShare();
  drawChannelChart();
  renderFriction();
  renderBreakdown();
}

// =====================================================
// CUSTOMER DETAILS DRAWER
// =====================================================
const PAGE = 25;
const D = { all: [], q: "", page: 0, title: "" };

function openAct(act) {
  const [kind, a, b] = act.split(":");
  const { from, to } = CTX.range;
  const ch = b || CTX.ch; // table ke App/Web cell pe click ho to wahi channel
  let list = [], title = "", sub = "";

  if (kind === "stage") {
    const j = +a;
    list = pickCustomers(from, to, ch).filter((c) => c.s >= j);
    title = j === 0 ? "Total signups" : j === 6 ? "Policy issued customers" : `Reached: ${STAGES[j]}`;
    sub = j === 0 ? "Everyone who registered" : `Customers who reached "${STAGES[j]}" or beyond`;
  } else if (kind === "drop") {
    const j = +a;
    list = pickCustomers(from, to, ch).filter((c) => c.s === j - 1);
    title = `Dropped: ${STAGES[j - 1]} → ${STAGES[j]}`;
    sub = `Customers who stopped at "${STAGES[j - 1]}"`;
  } else if (kind === "err") {
    const k = +a;
    list = pickCustomers(from, to, ch).filter((c) => c.err === k);
    title = ERRORS[k];
    sub = "Customers who hit this issue";
  } else if (kind === "ret") {
    const k = +a;
    list = pickCustomers(from, to, ch).filter((c) => c.s === 6 && (c.ret >> k) & 1);
    title = RETENTION_ITEMS[k].name;
    sub = "Policyholders";
  }

  const chText = ch === "all" ? "All channels" : ch === "app" ? "App" : "Web";
  sub += ` · ${rangeText(CTX.range)} · ${chText} · ${PRODUCTS[getProduct()].name}`;
  openDrawer(title, sub, list);
}

function openDrawer(title, sub, list) {
  D.all = list.slice().reverse(); // naye customers pehle
  D.q = "";
  D.page = 0;
  D.title = title;
  $("drawerTitle").textContent = title;
  $("drawerSub").textContent = sub;
  $("drawerSearch").value = "";
  renderDrawer();
  $("overlay").classList.add("open");
  $("drawer").classList.add("open");
  document.body.classList.add("no-scroll");
}

function closeDrawer() {
  $("overlay").classList.remove("open");
  $("drawer").classList.remove("open");
  document.body.classList.remove("no-scroll");
}

function drawerFiltered() {
  const q = D.q.trim().toLowerCase();
  if (!q) return D.all;
  return D.all.filter((c) => (c.id + " " + c.name + " " + c.phone + " " + c.city).toLowerCase().includes(q));
}

function renderDrawer() {
  const f = drawerFiltered();
  const pages = Math.max(1, Math.ceil(f.length / PAGE));
  D.page = Math.min(D.page, pages - 1);
  const rows = f.slice(D.page * PAGE, (D.page + 1) * PAGE);

  $("drawerRows").innerHTML = rows.length
    ? rows
        .map(
          (c) => `
    <tr>
      <td class="mono">${c.id}</td>
      <td><b>${c.name}</b></td>
      <td>${c.phone}</td>
      <td>${c.city}</td>
      <td><span class="pill ${c.ch}">${c.ch === "app" ? "App" : "Web"}</span></td>
      <td>${PRODUCTS[c.prod].name}</td>
      <td>${fmtDay(c.d)}</td>
      <td>${STAGES[c.s]}</td>
      <td>${c.err >= 0 ? `<span class="pill err">${ERRORS[c.err]}</span>` : "–"}</td>
      <td class="num">${c.s === 6 ? c.ttp + "d" : "–"}</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:28px">No customers found</td></tr>`;

  $("drawerCount").textContent = fmt(f.length) + " customers";
  $("pageInfo").textContent = `Page ${D.page + 1} / ${pages}`;
  $("prevPage").disabled = D.page === 0;
  $("nextPage").disabled = D.page >= pages - 1;
}

function exportCsv() {
  const f = drawerFiltered();
  const head = ["ID", "Name", "Phone", "City", "Channel", "Product", "Registered", "Reached", "Issue", "Days to policy"];
  const rows = f.map((c) => [
    c.id, c.name, c.phone, c.city, c.ch, PRODUCTS[c.prod].name, fmtDayFull(c.d),
    STAGES[c.s], c.err >= 0 ? ERRORS[c.err] : "", c.s === 6 ? c.ttp : "",
  ]);
  const csv = [head, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = D.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== EVENTS =====
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (el) openAct(el.dataset.act);
});
$("drawerClose").addEventListener("click", closeDrawer);
$("overlay").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
$("drawerSearch").addEventListener("input", (e) => { D.q = e.target.value; D.page = 0; renderDrawer(); });
$("prevPage").addEventListener("click", () => { D.page--; renderDrawer(); });
$("nextPage").addEventListener("click", () => { D.page++; renderDrawer(); });
$("drawerCsv").addEventListener("click", exportCsv);

// ===== THEME TOGGLE =====
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  drawMainChart();
  drawChannelChart();
}
$("themeToggle").addEventListener("click", () => {
  const now = document.documentElement.getAttribute("data-theme");
  applyTheme(now === "light" ? "dark" : "light");
});

// ===== FILTERS =====
$("channelFilter").addEventListener("change", renderAll);
$("productFilter").addEventListener("change", renderAll);

$("rangeFilter").addEventListener("change", () => {
  const custom = $("rangeFilter").value === "custom";
  $("customRange").hidden = !custom;
  if (custom) {
    $("dateFrom").value = toInput(CTX.range.from);
    $("dateTo").value = toInput(CTX.range.to);
  }
  renderAll();
});
$("dateFrom").addEventListener("change", renderAll);
$("dateTo").addEventListener("change", renderAll);

// ===== LIVE VISITORS (sirf dikhawa) =====
setInterval(() => {
  $("liveCount").textContent = 200 + Math.floor(Math.random() * 40);
}, 5000);

// ===== INIT =====
document.documentElement.setAttribute("data-theme", localStorage.getItem("theme") || "light");
renderAll();