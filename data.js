// =====================================================
// SEEDED RANDOM (har refresh pe same data aaye)
// =====================================================
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRng(20260923);
const rpick = (arr) => arr[Math.floor(rand() * arr.length)];
function wpick(items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// =====================================================
// DATES
// Data 1 Jun 2026 se 23 Sep 2026 tak hai. "Today" = 23 Sep 2026.
// Asli project mein TODAY_IDX ko new Date() se nikalna.
// =====================================================
const START = Date.UTC(2026, 5, 1);   // 1 Jun 2026 = day 0
const TOTAL_DAYS = 115;               // 1 Jun ... 23 Sep
const TODAY_IDX = 114;                // 23 Sep

// =====================================================
// LABELS
// =====================================================
const STAGES = [
  "Registered",
  "Signup Completed",
  "Product Viewed",
  "Premium Calculated",
  "Application Started",
  "Payment Initiated",
  "Policy Issued",
];

const ERRORS = [
  "OTP Not Sent / Failed",
  "OCR Failure (CNIC)",
  "Payment Failure / Timeout",
  "Application Errors",
  "Other",
];

const RETENTION_ITEMS = [
  { name: "Active This Month",  p: 0.805, hidden: true },
  { name: "Repeat Visits",      p: 0.537, hidden: true },
  { name: "Product Revisits",   p: 0.341, hidden: true },
  // hidden items stay so the seeded random stream (and all other numbers) don't change
  { name: "Policy Servicing",   p: 0.251, hidden: true },
  { name: "Claims Interaction", p: 0.143, hidden: true },
  { name: "Rewards Engagement", p: 0.237, hidden: true },
  { name: "Referrals",          p: 0.111 },
];


// =====================================================
// PRODUCTS
// share = registrations mein hissa, tilt = conversion behtar/kamzor,
// timeF = policy lene ka waqt, repF = repeat engagement
// =====================================================
const PRODUCTS = {
  all: { name: "All products" },
  lp:  { name: "Life Protector Plan",         share: 0.22, tilt: 1.02, timeF: 1.05, repF: 0.95 },
  lpt: { name: "Life Protector Plan Takaful", share: 0.11, tilt: 0.99, timeF: 1.10, repF: 0.90 },
  ms:  { name: "Mukammal Sehat Plan",         share: 0.25, tilt: 1.05, timeF: 0.90, repF: 1.10 },
  mst: { name: "Mukammal Sehat Plan Takaful", share: 0.13, tilt: 1.02, timeF: 0.95, repF: 1.05 },
  gs:  { name: "Goal Saving Plan",            share: 0.19, tilt: 0.96, timeF: 1.15, repF: 0.92 },
  gst: { name: "Goal Saving Plan Takaful",    share: 0.10, tilt: 0.94, timeF: 1.20, repF: 0.85 },
};
const PROD_KEYS = ["lp", "lpt", "ms", "mst", "gs", "gst"];

// =====================================================
// MONTHS (har mahine ka total, conversion adj, avg time, repeat)
// Aug 2026 exact hai: 12,480 registered ... 2,870 policies
// =====================================================
const AUG_TARGET = [12480, 9850, 7420, 5910, 4230, 3410, 2870];
const AUG_RATIO = AUG_TARGET.map((v) => v / AUG_TARGET[0]);

const MONTHS = [
  { start: 0,  len: 30, reg: 10200, adj: -0.20, ttp: 7.4, rep: 0.12 },               // Jun
  { start: 30, len: 31, reg: 11143, adj: -0.15, ttp: 6.8, rep: 0.13 },               // Jul
  { start: 61, len: 31, reg: 12480, adj: 0,     ttp: 4.6, rep: 0.18, exact: true },  // Aug
  { start: 92, len: 23, reg: 9600,  adj: 0.03,  ttp: 4.3, rep: 0.19 },               // Sep (1-23)
];
const monthOf = (i) => MONTHS.find((m) => i >= m.start && i < m.start + m.len);

// =====================================================
// DAILY STAGE COUNTS: DAILY[din] = [c0..c6] (c[j] = kitne is stage tak pohnche)
// =====================================================
const DAILY = new Array(TOTAL_DAYS);

MONTHS.forEach((m) => {
  const w = [];
  for (let k = 0; k < m.len; k++) {
    const i = m.start + k;
    const dow = new Date(START + i * 864e5).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? -0.18 : 0;
    w.push(1 + 0.16 * Math.sin(i / 2.3 + 1) + 0.10 * Math.sin(i * 1.7 + 3) + weekend);
  }
  const sw = w.reduce((a, b) => a + b, 0);
  const regs = w.map((x) => Math.round((m.reg * x) / sw));
  regs[m.len - 1] += m.reg - regs.reduce((a, b) => a + b, 0);

  const rows = regs.map((r, k) => {
    const i = m.start + k;
    const c = [r];
    for (let j = 1; j < 7; j++) {
      const jit = 1 + 0.06 * Math.sin(i * 0.9 + j);
      const v = Math.round(r * AUG_RATIO[j] * (1 + m.adj * (j / 6)) * jit);
      c.push(Math.min(c[j - 1], v));
    }
    return c;
  });

  // Aug ko exact targets pe le aao
  if (m.exact) {
    for (let j = 1; j < 7; j++) {
      const sum = rows.reduce((a, c) => a + c[j], 0);
      rows.forEach((c) => {
        c[j] = Math.min(c[j - 1], Math.round((c[j] * AUG_TARGET[j]) / sum));
      });
      let diff = AUG_TARGET[j] - rows.reduce((a, c) => a + c[j], 0);
      let k = 0, guard = 0;
      while (diff !== 0 && guard++ < 20000) {
        const c = rows[k % rows.length];
        if (diff > 0 && c[j] < c[j - 1]) { c[j]++; diff--; }
        else if (diff < 0 && c[j] > 0) { c[j]--; diff++; }
        k++;
      }
    }
  }

  rows.forEach((c, k) => (DAILY[m.start + k] = c));
});

// =====================================================
// CUSTOMERS GENERATOR
// =====================================================
const FIRST = ["Ahmed","Ali","Hassan","Usman","Bilal","Hamza","Zain","Fahad","Imran","Saad","Kamran","Asad","Omar","Danish","Talha","Ayesha","Fatima","Sana","Hina","Maryam","Zainab","Iqra","Nimra","Sadia","Bushra","Kiran","Mahnoor","Rabia","Noor","Laiba"];
const LAST  = ["Khan","Ahmed","Malik","Sheikh","Butt","Chaudhry","Qureshi","Siddiqui","Raza","Hussain","Baig","Mirza","Abbasi","Javed","Iqbal","Shah","Ansari","Farooq","Rehman","Nawaz"];
const CITIES = ["Karachi","Lahore","Islamabad","Rawalpindi","Faisalabad","Multan","Peshawar","Quetta","Hyderabad","Sialkot"];
const CITY_W = [22, 20, 12, 8, 7, 6, 6, 4, 5, 4];

// har stage pe kaunsa error kitni probability se aata hai: [errorIndex, probability]
const ERR_RULES = [
  [[0, 0.35], [4, 0.04]],   // stage 0 (Registered)
  [[0, 0.13], [4, 0.03]],   // stage 1
  [[4, 0.04]],              // stage 2
  [[1, 0.30], [3, 0.10]],   // stage 3
  [[1, 0.25], [3, 0.25]],   // stage 4
  [[2, 0.90]],              // stage 5
  [[2, 0.05]],              // stage 6
];
function pickErr(s) {
  let r = rand();
  for (const [e, p] of ERR_RULES[s]) {
    if (r < p) return e;
    r -= p;
  }
  return -1;
}

// app ka chance, is bat pe depend ke customer kahan tak pohncha
const P_APP = [0.33, 0.36, 0.40, 0.42, 0.44, 0.45, 0.46];

const CUSTOMERS = [];
let seq = 100000;

for (let i = 0; i < TOTAL_DAYS; i++) {
  const c = DAILY[i];
  const m = monthOf(i);

  // is din ke customers ka "furthest stage" list
  const stages = [];
  for (let s = 6; s >= 0; s--) {
    const n = Math.max(0, c[s] - (s < 6 ? c[s + 1] : 0));
    for (let k = 0; k < n; k++) stages.push(s);
  }
  // shuffle
  for (let k = stages.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [stages[k], stages[j]] = [stages[j], stages[k]];
  }

  for (const s of stages) {
    const prod = wpick(PROD_KEYS, PROD_KEYS.map((k) => PRODUCTS[k].share * Math.pow(PRODUCTS[k].tilt, s)));
    const cust = {
      id: "CUS-" + seq++,
      name: rpick(FIRST) + " " + rpick(LAST),
      phone: "03" + Math.floor(rand() * 5) + Math.floor(rand() * 10) + "-***" + String(Math.floor(rand() * 10000)).padStart(4, "0"),
      city: wpick(CITIES, CITY_W),
      ch: rand() < P_APP[s] ? "app" : "web",
      prod,
      d: i,
      s,
      err: pickErr(s),
      ttp: 0,
      rep: false,
      ret: 0,
    };
    if (s === 6) {
      cust.ttp = Math.max(0.3, +(m.ttp * PRODUCTS[prod].timeF * (0.35 + 1.3 * rand())).toFixed(1));
      cust.rep = rand() < m.rep * PRODUCTS[prod].repF;
      RETENTION_ITEMS.forEach((r, k) => {
        if (rand() < r.p) cust.ret |= 1 << k;
      });
    }
    CUSTOMERS.push(cust);
  }
}