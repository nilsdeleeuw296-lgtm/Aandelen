
/* Portfolio Planner v6 - stable vanilla JS (no build step) */

const STORAGE = {
  builder: 'pp_builder_v6',
  myportfolio: 'pp_myportfolio_v6',
  manualPrices: 'pp_manual_prices_v6',
  settings: 'pp_settings_v6',
  cacheMeta: 'pp_cache_meta_v6',
  snapshots: 'pp_snapshots_v6',
  rebalance: 'pp_rebalance_v6',
};

const fmtEUR = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 });

function $(id){ return document.getElementById(id); }
function qs(sel, root=document){ return root.querySelector(sel); }
function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function nowISO(){ return new Date().toISOString(); }

function readJSON(key, fallback){
  try{
    const v = localStorage.getItem(key);
    if(!v) return fallback;
    return JSON.parse(v);
  }catch(e){ return fallback; }
}
function writeJSON(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}

function sum(arr){ return arr.reduce((a,b)=>a+b,0); }

async function apiJSON(url, timeoutMs = 15000){
  // Client-side timeout so buttons never feel "dead"
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }catch(e){
    if(e && e.name === 'AbortError') throw new Error('Timeout (server reageert niet)');
    throw e;
  }finally{
    clearTimeout(t);
  }
}

function lerp(a,b,t){ return a + (b-a)*t; }

function getAnchors(){ return [5,10,20]; }

function mixForYears(years, risk){
  // For custom horizons we interpolate between 5/10/20 for the asset mix.
  // >20 uses the 20Y mix; <5 uses the 5Y mix.
  const y = Number(years);
  const a = getAnchors();
  if(y <= a[0]) return {...ASSET_MIX[a[0]][risk]};
  if(y >= a[2]) return {...ASSET_MIX[a[2]][risk]};
  if(y <= a[1]){
    const t = (y-a[0])/(a[1]-a[0]);
    const m0 = ASSET_MIX[a[0]][risk], m1 = ASSET_MIX[a[1]][risk];
    const equity = lerp(m0.equity, m1.equity, t);
    const bonds  = lerp(m0.bonds,  m1.bonds,  t);
    const cash   = 100 - equity - bonds;
    return { equity, bonds, cash };
  }
  const t = (y-a[1])/(a[2]-a[1]);
  const m0 = ASSET_MIX[a[1]][risk], m1 = ASSET_MIX[a[2]][risk];
  const equity = lerp(m0.equity, m1.equity, t);
  const bonds  = lerp(m0.bonds,  m1.bonds,  t);
  const cash   = 100 - equity - bonds;
  return { equity, bonds, cash };
}

function assumptionsForYears(years, risk){
  // Interpolate assumptions between 5/10/20; >20 uses 20Y set.
  const y = Number(years);
  const a = getAnchors();
  const pick = (yy) => ASSUMPTIONS[yy][risk];
  if(y <= a[0]) return {...pick(a[0])};
  if(y >= a[2]) return {...pick(a[2])};
  if(y <= a[1]){
    const t = (y-a[0])/(a[1]-a[0]);
    const s0 = pick(a[0]), s1 = pick(a[1]);
    return {
      equity: lerp(s0.equity, s1.equity, t),
      bonds:  lerp(s0.bonds,  s1.bonds,  t),
      cash:   lerp(s0.cash,   s1.cash,   t),
      range:  lerp(s0.range,  s1.range,  t),
    };
  }
  const t = (y-a[1])/(a[2]-a[1]);
  const s0 = pick(a[1]), s1 = pick(a[2]);
  return {
    equity: lerp(s0.equity, s1.equity, t),
    bonds:  lerp(s0.bonds,  s1.bonds,  t),
    cash:   lerp(s0.cash,   s1.cash,   t),
    range:  lerp(s0.range,  s1.range,  t),
  };
}

function badge(status){
  const cls = status === 'LIVE' ? 'ok' : status === 'CACHED' ? 'warn' : status === 'MANUAL' ? 'warn' : 'err';
  return `<span class="badge ${cls}">${status}</span>`;
}

/** ---------------------------------------------------------
 * Data model
 * ---------------------------------------------------------- */

const SECURITIES = [
  // ETFs - Core (US + EU UCITS proxies)
  {id:'VT', name:'Vanguard Total World Stock ETF', ticker:'VT', region:'US', type:'ETF', tags:['CORE'], stooq:'vt.us'},
  {id:'BND', name:'Vanguard Total Bond Market ETF', ticker:'BND', region:'US', type:'ETF', tags:['BOND','CORE'], stooq:'bnd.us'},
  {id:'SGOV', name:'iShares 0-3 Month Treasury Bond ETF', ticker:'SGOV', region:'US', type:'ETF', tags:['CASH','CORE'], stooq:'sgov.us'},

  {id:'VWCE', name:'Vanguard FTSE All-World UCITS', ticker:'VWCE', region:'EU', type:'ETF', tags:['CORE'], stooq:'vwce.nl'},
  {id:'VAGF', name:'Vanguard Global Aggregate Bond UCITS (EUR Hedged)', ticker:'VAGF', region:'EU', type:'ETF', tags:['BOND','CORE'], stooq:'vagf.nl'},
  {id:'ERNX', name:'iShares EUR Ultrashort Bond UCITS', ticker:'ERNX', region:'EU', type:'ETF', tags:['CASH','CORE'], stooq:'ernx.de'},

  // US Stocks (expanded)
  {id:'MSFT', name:'Microsoft', ticker:'MSFT', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'msft.us'},
  {id:'AAPL', name:'Apple', ticker:'AAPL', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'aapl.us'},
  {id:'GOOGL', name:'Alphabet', ticker:'GOOGL', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'googl.us'},
  {id:'AMZN', name:'Amazon', ticker:'AMZN', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'amzn.us'},
  {id:'NVDA', name:'NVIDIA', ticker:'NVDA', region:'US', type:'STOCK', tags:['GROWTH'], stooq:'nvda.us'},
  {id:'AMD', name:'AMD', ticker:'AMD', region:'US', type:'STOCK', tags:['GROWTH'], stooq:'amd.us'},
  {id:'JPM', name:'JPMorgan Chase', ticker:'JPM', region:'US', type:'STOCK', tags:['CYCLICAL'], stooq:'jpm.us'},
  {id:'PG', name:'Procter & Gamble', ticker:'PG', region:'US', type:'STOCK', tags:['DEFENSIVE'], stooq:'pg.us'},
  {id:'JNJ', name:'Johnson & Johnson', ticker:'JNJ', region:'US', type:'STOCK', tags:['DEFENSIVE'], stooq:'jnj.us'},
  {id:'KO', name:'Coca-Cola', ticker:'KO', region:'US', type:'STOCK', tags:['DEFENSIVE'], stooq:'ko.us'},
  {id:'V', name:'Visa', ticker:'V', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'v.us'},
  {id:'MA', name:'Mastercard', ticker:'MA', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'ma.us'},
  {id:'BLK', name:'BlackRock', ticker:'BLK', region:'US', type:'STOCK', tags:['QUALITY'], stooq:'blk.us'},

  // EU Stocks (expanded)
  {id:'ASML', name:'ASML', ticker:'ASML', region:'EU', type:'STOCK', tags:['QUALITY'], stooq:'asml.nl'},
  {id:'SAP', name:'SAP', ticker:'SAP', region:'EU', type:'STOCK', tags:['QUALITY'], stooq:'sap.de'},
  {id:'SIE', name:'Siemens', ticker:'SIE', region:'EU', type:'STOCK', tags:['QUALITY'], stooq:'sie.de'},
  {id:'SU', name:'Schneider Electric', ticker:'SU', region:'EU', type:'STOCK', tags:['QUALITY'], stooq:'su.pa'},
  {id:'ADYEN', name:'Adyen', ticker:'ADYEN', region:'EU', type:'STOCK', tags:['GROWTH'], stooq:'adyen.nl'},
  {id:'NESN', name:'Nestlé', ticker:'NESN', region:'EU', type:'STOCK', tags:['DEFENSIVE'], stooq:'nesn.ch'},
  {id:'NOVO', name:'Novo Nordisk', ticker:'NOVO', region:'EU', type:'STOCK', tags:['QUALITY'], stooq:'novo-b.dk'},
  {id:'AIR', name:'Airbus', ticker:'AIR', region:'EU', type:'STOCK', tags:['CYCLICAL'], stooq:'air.pa'},
  {id:'ALV', name:'Allianz', ticker:'ALV', region:'EU', type:'STOCK', tags:['CYCLICAL'], stooq:'alv.de'},
  {id:'RHM', name:'Rheinmetall', ticker:'RHM', region:'EU', type:'STOCK', tags:['DEFENSE'], stooq:'rhm.de'},

  // OTHER
  {id:'TSM', name:'TSMC ADR', ticker:'TSM', region:'OTHER', type:'STOCK', tags:['GROWTH'], stooq:'tsm.us'},
  {id:'SHOP', name:'Shopify', ticker:'SHOP', region:'OTHER', type:'STOCK', tags:['GROWTH'], stooq:'shop.us'},
  {id:'MELI', name:'MercadoLibre', ticker:'MELI', region:'OTHER', type:'STOCK', tags:['GROWTH'], stooq:'meli.us'},
  {id:'SE', name:'Sea Ltd', ticker:'SE', region:'OTHER', type:'STOCK', tags:['GROWTH'], stooq:'se.us'},
];

const UPCOMING_CURATED = [
  {ticker:'BLK', name:'BlackRock', region:'US', tags:['QUALITY']},
  {ticker:'RHM', name:'Rheinmetall', region:'EU', tags:['DEFENSE']},
  {ticker:'LLY', name:'Eli Lilly', region:'US', tags:['QUALITY']},
  {ticker:'AVGO', name:'Broadcom', region:'US', tags:['GROWTH']},
  {ticker:'TSM', name:'TSMC', region:'OTHER', tags:['GROWTH']},
  {ticker:'SNOW', name:'Snowflake', region:'US', tags:['GROWTH']},
];

const UPCOMING_MOMENTUM = [
  {ticker:'PLTR', name:'Palantir', region:'US', tags:['GROWTH']},
  {ticker:'ARM', name:'Arm', region:'US', tags:['GROWTH']},
  {ticker:'CRWD', name:'CrowdStrike', region:'US', tags:['GROWTH']},
  {ticker:'MSTR', name:'MicroStrategy', region:'US', tags:['HIGHBETA']},
  {ticker:'DKNG', name:'DraftKings', region:'US', tags:['GAMBLING']},
];

function getSecurityByTicker(t){
  return SECURITIES.find(s => s.ticker.toUpperCase() === String(t).toUpperCase());
}

function loadSettings(){
  const s = readJSON(STORAGE.settings, null) || {};
  if(!s.excludedTags) s.excludedTags = ['DEFENSE','FOSSIL','TOBACCO','GAMBLING'];
  if(typeof s.autoRefreshEnabled !== 'boolean') s.autoRefreshEnabled = true;
  if(!s.autoRefreshIntervalSec || s.autoRefreshIntervalSec < 5) s.autoRefreshIntervalSec = 5;
  if(typeof s.chartFillEnabled !== 'boolean') s.chartFillEnabled = true;
  return s;
}
function saveSettings(s){ writeJSON(STORAGE.settings, s); }

function loadManualPrices(){
  return readJSON(STORAGE.manualPrices, {});
}
function saveManualPrices(p){ writeJSON(STORAGE.manualPrices, p); }

/** ---------------------------------------------------------
 * Scenario logic (asset mix + core/satellite)
 * ---------------------------------------------------------- */

const ASSET_MIX = {
  5:  { L:{equity:30,bonds:60,cash:10}, M:{equity:50,bonds:45,cash:5},  H:{equity:70,bonds:25,cash:5} },
  10: { L:{equity:40,bonds:55,cash:5}, M:{equity:65,bonds:30,cash:5},  H:{equity:85,bonds:15,cash:0} },
  20: { L:{equity:55,bonds:40,cash:5}, M:{equity:80,bonds:20,cash:0},  H:{equity:90,bonds:10,cash:0} },
};

const CORE_SHARE = { L:0.80, M:0.60, H:0.40 }; // of equity bucket

const EQUITY_BUCKET_WEIGHTS = {
  // Within STOCK sleeve (satellite): weights across buckets
  L: { DEFENSIVE:0.35, QUALITY:0.45, CYCLICAL:0.15, GROWTH:0.05 },
  M: { DEFENSIVE:0.20, QUALITY:0.45, CYCLICAL:0.20, GROWTH:0.15 },
  H: { DEFENSIVE:0.10, QUALITY:0.35, CYCLICAL:0.20, GROWTH:0.35 },
};

// per-year assumptions by asset class, nominal
const ASSUMPTIONS = {
  5:  { L:{equity:0.055,bonds:0.030,cash:0.020, range:0.03},
        M:{equity:0.060,bonds:0.030,cash:0.020, range:0.04},
        H:{equity:0.070,bonds:0.025,cash:0.015, range:0.05}},
  10: { L:{equity:0.060,bonds:0.030,cash:0.020, range:0.03},
        M:{equity:0.065,bonds:0.030,cash:0.020, range:0.04},
        H:{equity:0.075,bonds:0.025,cash:0.015, range:0.05}},
  20: { L:{equity:0.060,bonds:0.030,cash:0.020, range:0.03},
        M:{equity:0.070,bonds:0.030,cash:0.020, range:0.04},
        H:{equity:0.080,bonds:0.025,cash:0.015, range:0.05}},
};

function scenarioId(years, risk, values){ return `${years}_${risk}_${values}`; }

function buildPortfolio({years, risk, values, region, customTickers=[]}){
  const mix = mixForYears(years, risk);
  const settings = loadSettings();
  const excludedTags = (values === 'Yes') ? (settings.excludedTags || []) : [];
  const manual = loadManualPrices();

  // Core ETFs (by region)
  const core = [];
  if(region === 'EU'){
    core.push({ticker:'VWCE', weight: mix.equity/100 * CORE_SHARE[risk]});
    core.push({ticker:'VAGF', weight: mix.bonds/100});
    if(mix.cash>0) core.push({ticker:'ERNX', weight: mix.cash/100});
  } else if(region === 'US'){
    core.push({ticker:'VT', weight: mix.equity/100 * CORE_SHARE[risk]});
    core.push({ticker:'BND', weight: mix.bonds/100});
    if(mix.cash>0) core.push({ticker:'SGOV', weight: mix.cash/100});
  } else {
    // ALL/OTHER: use EU UCITS as default core (more EUR friendly)
    core.push({ticker:'VWCE', weight: mix.equity/100 * CORE_SHARE[risk]});
    core.push({ticker:'VAGF', weight: mix.bonds/100});
    if(mix.cash>0) core.push({ticker:'ERNX', weight: mix.cash/100});
  }

  // Satellite stocks share of equity
  const satelliteEquityWeight = (mix.equity/100) * (1-CORE_SHARE[risk]);

  // Candidate stocks per region selection
  const stocks = SECURITIES.filter(s => s.type==='STOCK' && (region==='ALL' ? true : (region==='OTHER' ? s.region==='OTHER' : s.region===region)));
  // Always allow some diversification: if region is US/EU/OTHER we still keep a small cross-region safety if region is not ALL?
  // Keep it simple: honour user's region.

  // Filter by values
  const filteredStocks = stocks.filter(s => !excludedTags.some(t => s.tags.includes(t)));

  // If too few after filtering, fall back to QUALITY/DEFENSIVE subset
  const usable = filteredStocks.length ? filteredStocks : stocks.filter(s => ['QUALITY','DEFENSIVE'].some(t => s.tags.includes(t)));

// --- Custom tickers (forced include) ---
const forcedTickers = (customTickers || []).map(t=>String(t).toUpperCase()).filter(Boolean);
const forcedSecs = [];
for(const t of forcedTickers){
  let sec = getSecurityByTicker(t);
  if(!sec){
    sec = {id:t, name:t, ticker:t, region:'US', type:'STOCK', tags:['GROWTH'], stooq:(t.toLowerCase()+'.us')};
    SECURITIES.push(sec);
  }
  const buckets = ['DEFENSIVE','QUALITY','CYCLICAL','GROWTH'];
  if(!buckets.some(b => (sec.tags||[]).includes(b))){
    sec.tags = Array.from(new Set([...(sec.tags||[]), 'QUALITY']));
  }
  forcedSecs.push(sec);
}

  // Bucket allocations within satellite stock sleeve
  const bw = EQUITY_BUCKET_WEIGHTS[risk];
  const buckets = ['DEFENSIVE','QUALITY','CYCLICAL','GROWTH'];

  // Pick up to 12 stocks total (3 per bucket, adjusted)
  const picks = [];
  for(const b of buckets){
    const inBucket = usable.filter(s => s.tags.includes(b));
    // deterministic-ish: sort by ticker
    inBucket.sort((a,b)=>a.ticker.localeCompare(b.ticker));
    const take = Math.min(3, inBucket.length);
    for(let i=0;i<take;i++) picks.push(inBucket[i]);
  }
  // If still < 8, fill with QUALITY
  if(picks.length < 8){
    const qual = usable.filter(s => s.tags.includes('QUALITY') && !picks.includes(s)).sort((a,b)=>a.ticker.localeCompare(b.ticker));
    while(picks.length < 8 && qual.length) picks.push(qual.shift());
  }
  // Cap at 12

// Always include forced custom tickers first, then fill with picks
const uniq = new Map();
for(const s of (forcedSecs || [])) uniq.set(s.ticker, s);
for(const s of picks) uniq.set(s.ticker, s);
const finalStocks = Array.from(uniq.values()).slice(0,12);


  // weights for stocks per bucket
  const weights = [];
  for(const b of buckets){
    const members = finalStocks.filter(s => s.tags.includes(b));
    if(!members.length) continue;
    const bucketWeight = satelliteEquityWeight * bw[b];
    const per = bucketWeight / members.length;
    for(const m of members){
      weights.push({ticker:m.ticker, weight: per});
    }
  }

  // Combine core + stocks, normalize to 100%
  const combined = [...core, ...weights];
  // Normalization due to bucket missing etc.
  let totalW = sum(combined.map(x=>x.weight));
  if(totalW <= 0) totalW = 1;
  const normalized = combined.map(x => ({...x, weight: x.weight / totalW}));

  // Decorate with details
  const holdings = normalized.map(h => {
    const sec = getSecurityByTicker(h.ticker) || {name:h.ticker, region:'—', type:'STOCK', tags:[]};
    const manKey = h.ticker.toUpperCase();
    const manualPrice = manual[manKey];
    return {
      ticker: h.ticker,
      name: sec.name,
      region: sec.region,
      type: sec.type,
      tags: sec.tags || [],
      weight: h.weight,
      stooq: sec.stooq || null,
      price: (manualPrice != null) ? Number(manualPrice) : null,
      priceStatus: (manualPrice != null) ? 'MANUAL' : '—',
    };
  });

  return { mix, holdings, excludedTags };
}

/** ---------------------------------------------------------
 * Math for projections
 * ---------------------------------------------------------- */

// future value with monthly contributions, with effective monthly rate
function fvWithMonthly({initial, monthly, years, annualRate}){
  const n = Math.round(years*12);
  const r = Math.pow(1+annualRate, 1/12) - 1;
  // FV = P*(1+r)^n + PMT*(( (1+r)^n - 1)/r )
  const a = Math.pow(1+r, n);
  const fv = initial*a + (r===0 ? monthly*n : monthly*((a-1)/r));
  return fv;
}

function projectPortfolio({years, risk, initial, monthly}){
  const a = assumptionsForYears(years, risk);
  // Weighted annual rate based on asset mix
  const mix = mixForYears(years, risk);
  const wEq = mix.equity/100, wBd=mix.bonds/100, wCa=mix.cash/100;
  const baseRate = wEq*a.equity + wBd*a.bonds + wCa*a.cash;
  const lowRate = baseRate - a.range;
  const highRate = baseRate + a.range;
  const baseFV = fvWithMonthly({initial, monthly, years, annualRate: baseRate});
  const lowFV = fvWithMonthly({initial, monthly, years, annualRate: Math.max(-0.9, lowRate)});
  const highFV = fvWithMonthly({initial, monthly, years, annualRate: highRate});
  const invested = initial + monthly*12*years;
  return {
    invested,
    base: { rate: baseRate, fv: baseFV, profit: baseFV - invested },
    low: { rate: lowRate, fv: lowFV, profit: lowFV - invested },
    high:{ rate: highRate, fv: highFV, profit: highFV - invested },
  };
}

function seriesProfit({initial, monthly, years, annualRate}){
  const n = Math.round(years*12);
  const r = Math.pow(1+annualRate, 1/12) - 1;
  let value = initial;
  let invested = initial;
  const out = [];
  out.push({m:0, invested, value, profit:value-invested});
  for(let i=1;i<=n;i++){
    value *= (1+r);
    value += monthly;
    invested += monthly;
    out.push({m:i, invested, value, profit:value-invested});
  }
  return out;
}

/** ---------------------------------------------------------
 * UI: navigation
 * ---------------------------------------------------------- */

function showView(view){
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  qsa('.view').forEach(v => v.classList.add('hidden'));
  const el = $(`view-${view}`);
  if(el) el.classList.remove('hidden');
}

function initNav(){
  qsa('.nav-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      showView(btn.dataset.view);
      if(btn.dataset.view === 'quotes') renderQuotesTable();
      if(btn.dataset.view === 'upcoming') renderUpcoming();
      if(btn.dataset.view === 'settings') renderManualTable();
      if(btn.dataset.view === 'rebalance') renderRebalance();
    });
  });
}

/** ---------------------------------------------------------
 * Builder state + rendering
 * ---------------------------------------------------------- */

let builder = {
  yearsPreset: 10,
  yearsCustom: '',
  years: 10,
  risk: 'M',
  values: 'No',
  region: 'ALL',
  initial: 10000,
  monthly: 500,
  rounding: 'whole',
  fee: 1.0,
  slip: 0.10,
  customTickers: [],
  holdings: [],
  mix: null,
  prices: {},
};

function loadBuilder(){
  const b = readJSON(STORAGE.builder, null);
  if(b){
    builder = {...builder, ...b};
    if(!builder.customTickers) builder.customTickers = [];
  }
  // Keep backwards compatibility with older saved state
  if(!builder.yearsPreset) builder.yearsPreset = (builder.years && [5,10,20].includes(Number(builder.years))) ? Number(builder.years) : 10;
  if(builder.yearsCustom == null) builder.yearsCustom = '';
  builder.years = builder.yearsCustom ? Number(builder.yearsCustom) : Number(builder.yearsPreset);

  $('selYears').value = String(builder.yearsPreset);
  $('inpYearsCustom').value = builder.yearsCustom || '';
  $('selRisk').value = builder.risk;
  $('selValues').value = builder.values;
  $('selRegion').value = builder.region;
  $('inpInitial').value = builder.initial;
  $('inpMonthly').value = builder.monthly;
  $('selRounding').value = builder.rounding;
  $('inpFee').value = builder.fee;
  $('inpSlip').value = builder.slip;
}

function saveBuilder(){
  writeJSON(STORAGE.builder, builder);
}

function builderInputs(){
  builder.yearsPreset = Number($('selYears').value);
  const customRaw = Number($('inpYearsCustom').value);
  if(isFinite(customRaw) && customRaw > 0){
    const y = clamp(Math.round(customRaw), 1, 40);
    builder.yearsCustom = String(y);
    builder.years = y;
  }else{
    builder.yearsCustom = '';
    builder.years = builder.yearsPreset;
  }
  builder.risk = $('selRisk').value;
  builder.values = $('selValues').value;
  builder.region = $('selRegion').value;
  builder.initial = Number($('inpInitial').value || 0);
  builder.monthly = Number($('inpMonthly').value || 0);
  builder.rounding = $('selRounding').value;
  builder.fee = Number($('inpFee').value || 0);
  builder.slip = Number($('inpSlip').value || 0);
}

function renderBuilder(){
  const { mix, holdings } = buildPortfolio({
    years: builder.years,
    risk: builder.risk,
    values: builder.values,
    region: builder.region,
    customTickers: builder.customTickers || []
  });
  builder.mix = mix;
  builder.holdings = holdings;

  $('mixEquity').textContent = fmt1.format(mix.equity);
  $('mixBonds').textContent = fmt1.format(mix.bonds);
  $('mixCash').textContent = fmt1.format(mix.cash);

  // compute allocations
  const total = builder.initial;
  let cashRemainder = total;
  for(const h of builder.holdings){
    h.alloc = total * h.weight;
    h.shares = null;
    h.value = null;
    h.priceUsed = null;
  }

  // compute with prices if known
  const manual = loadManualPrices();
  for(const h of builder.holdings){
    const p = (builder.prices[h.ticker] && builder.prices[h.ticker].price) || (manual[h.ticker] != null ? manual[h.ticker] : null);
    if(p && Number(p) > 0){
      h.priceUsed = Number(p) * (1 + builder.slip/100);
      h.priceStatus = (builder.prices[h.ticker]?.status) || (manual[h.ticker] != null ? 'MANUAL' : 'LIVE');
      if(builder.rounding === 'whole'){
        h.shares = Math.floor(h.alloc / h.priceUsed);
      }else{
        h.shares = h.alloc / h.priceUsed;
      }
      h.value = h.shares * h.priceUsed;
      cashRemainder -= h.value;
    }else{
      h.priceUsed = null;
      h.shares = (builder.rounding === 'whole') ? 0 : 0;
      h.value = 0;
      h.priceStatus = (manual[h.ticker] != null) ? 'MANUAL' : 'MISSING';
    }
  }

  // transaction fees estimate
  const trades = builder.holdings.filter(h => (h.value || 0) > 0);
  const feeTotal = trades.length * builder.fee;
  cashRemainder -= feeTotal;

  const proj = projectPortfolio({years: builder.years, risk: builder.risk, initial: builder.initial, monthly: builder.monthly});
  $('sumInvested').textContent = fmtEUR.format(proj.invested);
  $('sumEndBase').textContent = fmtEUR.format(proj.base.fv);
  $('sumProfitBase').textContent = fmtEUR.format(proj.base.profit);
  $('sumCash').textContent = fmtEUR.format(Math.max(0, cashRemainder));

  // table
  const tbody = $('tblHoldings').querySelector('tbody');
  tbody.innerHTML = '';
  for(const h of builder.holdings){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="#" class="ticker-link" data-ticker="${h.ticker}">${h.ticker}</a></td>
      <td>${h.name}</td>
      <td>${h.type}</td>
      <td>${fmt2.format(h.weight*100)}%</td>
      <td>${h.priceUsed ? fmt2.format(h.priceUsed) : '—'}</td>
      <td>${fmtEUR.format(h.alloc)}</td>
      <td>${builder.rounding==='whole' ? fmtEUR.format(h.shares) : fmt2.format(h.shares)}</td>
      <td>${fmtEUR.format(h.value||0)}</td>
      <td>${badge(h.priceStatus || '—')}</td>
    `;
    tbody.appendChild(tr);
  }

  // update dashboard summary
  updateDashboard();
  saveBuilder();
}

function setBuilderStatus(msg){ $('builderStatus').textContent = msg; }

function normTickerInput(raw){
  return String(raw||'').trim().toUpperCase();
}

function normalizeTickerForApi(t){
  const up = normTickerInput(t);
  const parts = up.split('.');
  if(parts.length === 2 && parts[1].length >= 2 && parts[1].length <= 4){
    return parts[0]; // likely exchange suffix
  }
  if(parts.length === 2 && parts[1].length === 1){
    return parts[0] + '-' + parts[1]; // share class
  }
  return up;
}

function ensureCustomTicker(t){
  const tt = normTickerInput(t);
  if(!tt) return null;
  const base = normalizeTickerForApi(tt);
  if(!(builder.customTickers||[]).map(x=>String(x).toUpperCase()).includes(base)){
    builder.customTickers.push(base);
    saveBuilder();
  }
  if(!getSecurityByTicker(base)){
    SECURITIES.push({id:base, name:base, ticker:base, region:'US', type:'STOCK', tags:['GROWTH'], stooq:(base.toLowerCase()+'.us')});
  }
  return base;
}

function removeCustomTicker(t){
  const tt = normTickerInput(t);
  builder.customTickers = (builder.customTickers||[]).filter(x => String(x).toUpperCase() !== tt);
  saveBuilder();
  renderCustomTickerChips();
  renderBuilder();
}

function renderCustomTickerChips(){
  const el = $('customTickerChips');
  if(!el) return;
  el.innerHTML = '';
  const arr = (builder.customTickers||[]).map(x=>String(x).toUpperCase());
  if(!arr.length){
    el.innerHTML = '<span class="muted">Geen custom tickers toegevoegd.</span>';
    return;
  }
  for(const t of arr){
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${t}</span><button title="Verwijder" data-t="${t}">×</button>`;
    chip.querySelector('button').addEventListener('click', ()=> removeCustomTicker(t));
    el.appendChild(chip);
  }
}



function buildQuoteItems(list){
  // Use items=TICKER@stooqSymbol where possible.
  // This makes EU/UCITS tickers (VWCE, VAGF, etc.) much more reliable.
  const map = {};
  const items = [];
  for(const h of list){
    const t = String(h.ticker||'').toUpperCase();
    const apiT = normalizeTickerForApi(t);
    map[apiT] = t;

    const sec = getSecurityByTicker(t) || getSecurityByTicker(apiT);
    const stooq = sec?.stooq ? String(sec.stooq).trim() : '';
    // Encode as API-safe "TICKER@stooq". If no stooq mapping is known, send only ticker.
    items.push(stooq ? `${apiT}@${stooq}` : `${apiT}`);
  }
  return { items, map };
}

async function fetchPricesForHoldings(list){
  const { items, map } = buildQuoteItems(list);
  const url = `/api/quotes?items=${encodeURIComponent(items.join(','))}`;
  const res = await apiJSON(url);
  const out = { prices: {}, note: res.note };
  for(const [k,v] of Object.entries(res.prices||{})){
    const orig = map[String(k).toUpperCase()] || String(k).toUpperCase();
    out.prices[orig] = v;
  }
  return out;
}

async function onFetchPrices(){
  try{
    setBuilderStatus('Koersen ophalen…');
    const res = await fetchPricesForHoldings(builder.holdings);
    builder.prices = res.prices || {};
    const now = formatTimeHHMM();
    setBuilderStatus(`Koersen opgehaald (${Object.keys(builder.prices).length} items) om ${now}. ${res.note || ''}`.trim());
    setQuotesLastUpdated(`Handmatig ${now}`);
    lastBuilderUpdate = now;
    scheduleRenderAll();
  }catch(e){
    setBuilderStatus(`Fout bij ophalen: ${e.message}. Gebruik manual overrides in Instellingen.`);
  }
}

function exportCSV(rows, filename){
  const header = ['ticker','name','type','weight','price','shares','value'];
  const lines = [header.join(',')];
  for(const r of rows){
    lines.push([
      r.ticker,
      `"${String(r.name).replaceAll('"','""')}"`,
      r.type,
      (r.weight*100).toFixed(4),
      r.priceUsed ?? '',
      r.shares ?? '',
      r.value ?? ''
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportExcelTable({columns, rows, filename}){
  // Excel-compatible export without external libraries.
  // Generates an HTML table which Excel opens natively.
  let html = '<table><tr>';
  for(const c of columns) html += `<th>${c.label}</th>`;
  html += '</tr>';
  for(const r of rows){
    html += '<tr>';
    for(const c of columns){
      const v = (r[c.key] == null) ? '' : r[c.key];
      html += `<td>${String(v)}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  const uri = 'data:application/vnd.ms-excel;charset=utf-8,' + encodeURIComponent(html);
  const a = document.createElement('a');
  a.href = uri;
  a.download = filename;
  a.click();
}

function exportBuilderExcel(){
  const rows = (builder.holdings||[]).map(h=>({
    ticker: h.ticker,
    name: h.name,
    type: h.type,
    weight: (h.weight*100).toFixed(2),
    price: h.priceUsed != null ? Number(h.priceUsed).toFixed(4) : '',
    shares: h.shares != null ? h.shares : '',
    value: h.value != null ? Number(h.value).toFixed(2) : '',
    status: h.priceStatus || ''
  }));
  exportExcelTable({
    columns: [
      {key:'ticker',label:'Ticker'},
      {key:'name',label:'Naam'},
      {key:'type',label:'Type'},
      {key:'weight',label:'Weight %'},
      {key:'price',label:'Koers'},
      {key:'shares',label:'Aantal'},
      {key:'value',label:'Waarde €'},
      {key:'status',label:'Status'},
    ],
    rows,
    filename: `portfolio_${scenarioId(builder.years,builder.risk,builder.values)}.xls`
  });
}

/** ---------------------------------------------------------
 * My portfolio state
 * ---------------------------------------------------------- */

let myp = {
  startDate: null,
  initial: 10000,
  monthly: 500,
  holdings: [], // {ticker, shares}
  prices: {},
};

function loadMyPortfolio(){
  const m = readJSON(STORAGE.myportfolio, null);
  if(m) myp = {...myp, ...m};
  // defaults
  const d = new Date();
  d.setMonth(d.getMonth()-6);
  if(!myp.startDate) myp.startDate = d.toISOString().slice(0,10);
  $('mpStartDate').value = myp.startDate;
  $('mpInitial').value = myp.initial;
  $('mpMonthly').value = myp.monthly;
}

function saveMyPortfolio(){ writeJSON(STORAGE.myportfolio, myp); }

function loadSnapshots(){
  return readJSON(STORAGE.snapshots, []);
}
function saveSnapshots(arr){
  writeJSON(STORAGE.snapshots, arr);
}
function addSnapshot(dateISO, invested, value){
  const d = String(dateISO||'').slice(0,10);
  if(!d) return;
  const arr = loadSnapshots();
  const idx = arr.findIndex(x => x.date === d);
  const item = {date:d, invested:Number(invested||0), value:Number(value||0)};
  if(idx>=0) arr[idx] = item; else arr.push(item);
  // keep sorted, max 365
  arr.sort((a,b)=>a.date.localeCompare(b.date));
  while(arr.length > 365) arr.shift();
  saveSnapshots(arr);
}

function mypInputs(){
  myp.startDate = $('mpStartDate').value;
  myp.initial = Number($('mpInitial').value || 0);
  myp.monthly = Number($('mpMonthly').value || 0);
}

function setMPStatus(msg){ $('mpStatus').textContent = msg; }

function renderMyHoldings(){
  const tbody = $('tblMyHoldings').querySelector('tbody');
  tbody.innerHTML = '';
  const manual = loadManualPrices();
  let totalValue = 0;

  for(const h of myp.holdings){
    const sec = getSecurityByTicker(h.ticker) || {name:h.ticker};
    const pLive = myp.prices[h.ticker]?.price ?? null;
    const pMan = manual[h.ticker] ?? null;
    const price = (pLive!=null ? pLive : (pMan!=null ? Number(pMan) : null));
    const status = (pLive!=null ? (myp.prices[h.ticker].status || 'LIVE') : (pMan!=null ? 'MANUAL' : 'MISSING'));
    const value = price ? price * Number(h.shares||0) : 0;
    totalValue += value;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="#" class="ticker-link" data-ticker="${h.ticker}">${h.ticker}</a></td>
      <td>${sec.name}</td>
      <td>${price!=null ? fmt2.format(price) : '—'}</td>
      <td><input class="share-input" data-ticker="${h.ticker}" type="number" step="0.0001" value="${h.shares ?? 0}" style="width:120px;padding:8px;border-radius:10px;border:1px solid var(--border)"/></td>
      <td>${fmtEUR.format(value)}</td>
      <td>${badge(status)}</td>
    `;
    tbody.appendChild(tr);
  }

  // capture edits
  qsa('.share-input', tbody).forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const t = inp.dataset.ticker;
      const row = myp.holdings.find(x=>x.ticker===t);
      if(row) row.shares = Number(inp.value||0);
      saveMyPortfolio();
      renderMyHoldings(); // update values
      updateDashboard();
    });
  });

  // invested so far
  const months = monthsBetween(myp.startDate, new Date().toISOString().slice(0,10));
  const invested = myp.initial + myp.monthly * months;
  const profit = totalValue - invested;

  $('mpInvested').textContent = fmtEUR.format(invested);
  $('mpValue').textContent = fmtEUR.format(totalValue);
  $('mpProfit').textContent = fmtEUR.format(profit);

  updateDashboard();
}

function monthsBetween(startISO, endISO){
  const s = new Date(startISO);
  const e = new Date(endISO);
  let months = (e.getFullYear()-s.getFullYear())*12 + (e.getMonth()-s.getMonth());
  // if day hasn't reached, keep months as is
  if(e.getDate() < s.getDate()) months -= 1;
  return Math.max(0, months);
}

let autoRefreshTimer = null;
let autoRefreshInFlight = false;
let autoRefreshIntervalSec = 5;
let renderTimer = null;
let lastBuilderUpdate = null;
let lastMyPortfolioUpdate = null;
let autoRefreshPaused = false;
let autoRefreshErrorCount = 0;

function formatTimeHHMM(){
  const d = new Date();
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso){
  if(!iso) return '';
  return String(iso).slice(0, 7);
}

function setQuotesLastUpdated(text){
  const el = $('qLastUpdated');
  if(el) el.textContent = text;
}

function showToast(message){
  const el = $('toast');
  if(!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(el.dataset.timerId);
  const timerId = setTimeout(()=> el.classList.add('hidden'), 3500);
  el.dataset.timerId = String(timerId);
}

function setAutoRefreshEnabled(enabled){
  if(enabled){
    if(!autoRefreshTimer){
      autoRefreshTimer = setInterval(autoRefreshPrices, autoRefreshIntervalSec * 1000);
    }
  }else if(autoRefreshTimer){
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function setAutoRefreshInterval(seconds){
  const next = Math.max(5, Number(seconds) || 5);
  autoRefreshIntervalSec = next;
  if(autoRefreshTimer){
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(autoRefreshPrices, autoRefreshIntervalSec * 1000);
  }
}

function scheduleRenderAll(){
  if(renderTimer) return;
  renderTimer = setTimeout(() => {
    renderBuilder();
    renderMyHoldings();
    renderQuotesTable();
    updateDashboard();
    renderTimer = null;
  }, 300);
}

async function mpFetchPrices(){
  try{
    setMPStatus('Koersen ophalen…');
    const res = await fetchPricesForHoldings(myp.holdings);
    const merged = {...(myp.prices || {})};
    for(const [k,v] of Object.entries(res.prices||{})){
      merged[String(k).toUpperCase()] = v;
    }
    myp.prices = merged;
    const now = formatTimeHHMM();
    setMPStatus(`Koersen opgehaald (${Object.keys(myp.prices).length} items) om ${now}.`);
    setQuotesLastUpdated(`Handmatig ${now}`);
    lastMyPortfolioUpdate = now;
    saveMyPortfolio();
    renderMyHoldings();
  }catch(e){
    setMPStatus(`Fout bij ophalen: ${e.message}.`);
  }
}

async function autoRefreshPrices(){
  const settings = loadSettings();
  if(!settings.autoRefreshEnabled) return;
  if(autoRefreshPaused) return;
  if(autoRefreshInFlight) return;
  autoRefreshInFlight = true;
  try{
    const now = formatTimeHHMM();
    if(builder.holdings && builder.holdings.length){
      const res = await fetchPricesForHoldings(builder.holdings);
      builder.prices = res.prices || {};
      setBuilderStatus(`Koersen auto-updated (${Object.keys(builder.prices).length} items) om ${now}. ${res.note || ''}`.trim());
      lastBuilderUpdate = now;
    }
    if(myp.holdings && myp.holdings.length){
      const res = await fetchPricesForHoldings(myp.holdings);
      const merged = {...(myp.prices || {})};
      for(const [k,v] of Object.entries(res.prices||{})){
        merged[String(k).toUpperCase()] = v;
      }
      myp.prices = merged;
      setMPStatus(`Koersen auto-updated (${Object.keys(myp.prices).length} items) om ${now}.`);
      lastMyPortfolioUpdate = now;
      saveMyPortfolio();
    }
    scheduleRenderAll();
    setQuotesLastUpdated(`Auto ${now}`);
    autoRefreshErrorCount = 0;
  }catch(e){
    autoRefreshErrorCount += 1;
    setBuilderStatus(`Auto-update fout: ${e.message}.`);
    setMPStatus(`Auto-update fout: ${e.message}.`);
    if(autoRefreshErrorCount >= 3){
      showToast('Auto-refresh faalt meerdere keren. Controleer de server of je verbinding.');
    }
  }finally{
    autoRefreshInFlight = false;
  }
}

function mpLoadFromBuilder(){
  // Take builder holdings with shares calculated, as starting point
  const list = builder.holdings.map(h => ({ticker:h.ticker, shares: Number(h.shares||0)}));
  myp.holdings = list;
  // also sync amounts
  myp.initial = builder.initial;
  myp.monthly = builder.monthly;
  $('mpInitial').value = myp.initial;
  $('mpMonthly').value = myp.monthly;
  saveMyPortfolio();
  renderMyHoldings();
  setMPStatus('Holdings overgenomen uit Builder.');
}

function mpSave(){
  mypInputs();
  saveMyPortfolio();
  renderMyHoldings();
  setMPStatus('Berekening uitgevoerd en opgeslagen.');
}

/** ---------------------------------------------------------
 * Quotes view
 * ---------------------------------------------------------- */

function regionFilter(sec, region){
  if(region === 'ALL') return true;
  if(region === 'ETF') return sec.type === 'ETF';
  return sec.region === region;
}

async function renderQuotesTable(){
  const region = $('qRegion').value;
  const statusFilter = $('qStatusFilter') ? $('qStatusFilter').value : 'ALL';
  const tbody = $('tblQuotes').querySelector('tbody');
  tbody.innerHTML = '';
  const manual = loadManualPrices();
  const settings = loadSettings();
  const excluded = settings.excludedTags || [];

  const list = SECURITIES.filter(s => regionFilter(s, region));
  for(const s of list){
    const pLive = builder.prices[s.ticker]?.price ?? myp.prices[s.ticker]?.price ?? null;
    const pMan = manual[s.ticker] ?? null;
    const price = pLive!=null ? pLive : (pMan!=null ? Number(pMan) : null);
    const status = pLive!=null ? (builder.prices[s.ticker]?.status || myp.prices[s.ticker]?.status || 'LIVE') : (pMan!=null ? 'MANUAL' : '—');
    const tagStr = (s.tags||[]).join('|');
    const muted = (excluded.some(t => (s.tags||[]).includes(t))) ? 'style="opacity:.55"' : '';
    if(statusFilter !== 'ALL'){
      if(status === '—' && statusFilter !== 'MISSING') continue;
      if(status !== '—' && status !== statusFilter) continue;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td ${muted}><a href="#" class="ticker-link" data-ticker="${s.ticker}">${s.ticker}</a></td>
      <td ${muted}>${s.name}</td>
      <td ${muted}>${s.region}</td>
      <td ${muted}>${s.type}</td>
      <td ${muted}>${price!=null ? fmt2.format(price) : '—'}</td>
      <td ${muted}>${badge(status)}</td>
    `;
    tbody.appendChild(tr);
  }

  attachTickerLinks();
}

async function qFetch(){
  try{
    $('qStatus').textContent = 'Koersen ophalen…';
    const region = $('qRegion').value;
    const list = SECURITIES.filter(s => regionFilter(s, region));
    const tickers = list.map(s=>s.ticker).join(',');
    const res = await apiJSON(`/api/quotes?tickers=${encodeURIComponent(tickers)}`);
    builder.prices = {...builder.prices, ...(res.prices||{})};
    myp.prices = {...myp.prices, ...(res.prices||{})};
    const now = formatTimeHHMM();
    $('qStatus').textContent = `Koersen opgehaald (${Object.keys(res.prices||{}).length} items) om ${now}.`;
    setQuotesLastUpdated(`Handmatig ${now}`);
    lastBuilderUpdate = now;
    lastMyPortfolioUpdate = now;
    saveBuilder(); saveMyPortfolio();
    scheduleRenderAll();
  }catch(e){
    $('qStatus').textContent = `Fout: ${e.message}`;
  }
}

async function qClearCache(){
  try{
    $('qStatus').textContent = 'Cache wissen…';
    await apiJSON('/api/cache/clear');
    $('qStatus').textContent = 'Cache gewist.';
  }catch(e){
    $('qStatus').textContent = `Fout: ${e.message}`;
  }
}

/** ---------------------------------------------------------
 * Manual prices
 * ---------------------------------------------------------- */

function renderManualTable(){
  const tbody = $('tblManual').querySelector('tbody');
  tbody.innerHTML = '';
  const p = loadManualPrices();
  for(const [t,price] of Object.entries(p)){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t}</td>
      <td>${fmt2.format(Number(price))}</td>
      <td><button class="secondary btnDel" data-t="${t}" style="padding:6px 10px;border-radius:10px">Verwijder</button></td>
    `;
    tbody.appendChild(tr);
  }
  qsa('.btnDel', tbody).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const mp = loadManualPrices();
      delete mp[btn.dataset.t];
      saveManualPrices(mp);
      renderManualTable();
      renderBuilder();
      renderMyHoldings();
      updateDashboard();
    });
  });

  // excluded tags checkboxes
  const settings = loadSettings();
  qsa('.exclTag').forEach(chk=>{
    chk.checked = (settings.excludedTags||[]).includes(chk.value);
    chk.addEventListener('change', ()=>{
      const s = loadSettings();
      const set = new Set(s.excludedTags||[]);
      if(chk.checked) set.add(chk.value); else set.delete(chk.value);
      s.excludedTags = Array.from(set);
      saveSettings(s);
      renderBuilder();
      renderQuotesTable();
      updateDashboard();
    });
  });

  const autoToggle = $('autoRefreshToggle');
  if(autoToggle){
    autoToggle.checked = settings.autoRefreshEnabled;
    autoToggle.onchange = () => {
      const s = loadSettings();
      s.autoRefreshEnabled = autoToggle.checked;
      saveSettings(s);
      setAutoRefreshEnabled(s.autoRefreshEnabled);
    };
  }

  const intervalInput = $('autoRefreshInterval');
  if(intervalInput){
    intervalInput.value = settings.autoRefreshIntervalSec;
    intervalInput.onchange = () => {
      const s = loadSettings();
      s.autoRefreshIntervalSec = Math.max(5, Number(intervalInput.value) || 5);
      saveSettings(s);
      setAutoRefreshInterval(s.autoRefreshIntervalSec);
    };
  }

  const chartFillToggle = $('chartFillToggle');
  if(chartFillToggle){
    chartFillToggle.checked = settings.chartFillEnabled;
    chartFillToggle.onchange = () => {
      const s = loadSettings();
      s.chartFillEnabled = chartFillToggle.checked;
      saveSettings(s);
      updateDashboard();
      renderHistoryChart();
    };
  }
}

function saveManual(){
  const t = $('manTicker').value.trim().toUpperCase();
  const p = Number($('manPrice').value);
  if(!t || !isFinite(p) || p<=0) return;
  const mp = loadManualPrices();
  mp[t]=p;
  saveManualPrices(mp);
  $('manTicker').value=''; $('manPrice').value='';
  renderManualTable();
  renderBuilder();
  renderMyHoldings();
  updateDashboard();
}
function clearManual(){
  saveManualPrices({});
  renderManualTable();
  renderBuilder();
  renderMyHoldings();
  updateDashboard();
}

/** ---------------------------------------------------------
 * Upcoming
 * ---------------------------------------------------------- */

function renderUpcoming(){
  const mode = $('uMode').value;
  const tbody = $('tblUpcoming').querySelector('tbody');
  tbody.innerHTML='';
  let list = [];
  if(mode==='CURATED') list = UPCOMING_CURATED;
  if(mode==='MOMENTUM') list = UPCOMING_MOMENTUM;
  if(mode==='ALL') list = [...UPCOMING_CURATED, ...UPCOMING_MOMENTUM];

  for(const u of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="#" class="ticker-link" data-ticker="${u.ticker}">${u.ticker}</a></td>
      <td>${u.name}</td>
      <td>${u.region}</td>
      <td>${(u.tags||[]).join(', ')}</td>
      <td><button class="secondary btnAdd" data-t="${u.ticker}" style="padding:6px 10px;border-radius:10px">Toevoegen</button></td>
    `;
    tbody.appendChild(tr);
  }
  qsa('.btnAdd', tbody).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const t = btn.dataset.t.toUpperCase();
      // Add as ad-hoc security if missing (as OTHER US by default)
      if(!getSecurityByTicker(t)){
        SECURITIES.push({id:t, name:t, ticker:t, region:'US', type:'STOCK', tags:['GROWTH'], stooq:(t.toLowerCase()+'.us')});
      }

// Add to Builder custom tickers (so it shows up in Portfolio Builder)
ensureCustomTicker(t);
$('uStatus').textContent = `Toegevoegd aan Builder: ${t}`;
renderCustomTickerChips();
renderBuilder();
renderQuotesTable();
    });
  });

  attachTickerLinks();
}

/** ---------------------------------------------------------
 * Charts (simple canvas)
 * ---------------------------------------------------------- */

function drawLineChart(canvas, series, opts){
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.getAttribute('height') ? Number(canvas.getAttribute('height')) : 220;
  ctx.clearRect(0,0,W,H);

  // padding
  const pad = {l:48,r:16,t:14,b:28};
  const x0=pad.l, x1=W-pad.r, y0=pad.t, y1=H-pad.b;

  const allY = series.flatMap(s=>s.data.map(p=>p.y));
  const minY = Math.min(...allY, 0);
  const maxY = Math.max(...allY, 1);
  const minX = 0;
  const maxX = Math.max(...series.flatMap(s=>s.data.map(p=>p.x)));

  function xScale(x){ return x0 + (x - minX) * (x1-x0) / (maxX-minX || 1); }
  function yScale(y){
    const v = (y - minY) / (maxY-minY || 1);
    return y1 - v*(y1-y0);
  }

  // background grid
  ctx.strokeStyle = 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  const gridRows = 4;
  for(let i=0;i<=gridRows;i++){
    const py = y0 + (y1-y0)*i/gridRows;
    ctx.beginPath();
    ctx.moveTo(x0,py);
    ctx.lineTo(x1,py);
    ctx.stroke();
  }

  // axes
  ctx.strokeStyle = 'rgba(226,232,240,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0,y0);
  ctx.lineTo(x0,y1);
  ctx.lineTo(x1,y1);
  ctx.stroke();

  // y ticks
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px system-ui';
  const ticks = 4;
  for(let i=0;i<=ticks;i++){
    const ty = minY + (maxY-minY)*i/ticks;
    const py = yScale(ty);
    ctx.fillText(fmtEUR.format(ty), 6, py+4);
  }

  // x ticks (year labels)
  const maxMonths = maxX || 0;
  const xTicks = 4;
  ctx.fillStyle = '#94a3b8';
  for(let i=0;i<=xTicks;i++){
    const tx = minX + (maxMonths-minX)*i/xTicks;
    const px = xScale(tx);
    ctx.fillText(`${Math.round(tx/12)}y`, px-8, y1+18);
  }

  if(opts && Array.isArray(opts.xLabels) && opts.xLabels.length){
    opts.xLabels.forEach(label => {
      if(!label || label.x == null || !label.text) return;
      const px = xScale(label.x);
      ctx.fillText(label.text, px-20, y1+18);
    });
  }

  const settings = loadSettings();

  // area fill for first series
  if(settings.chartFillEnabled && series[0] && series[0].data.length){
    const s = series[0];
    ctx.beginPath();
    s.data.forEach((p, idx)=>{
      const px = xScale(p.x);
      const py = yScale(p.y);
      if(idx===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    });
    ctx.lineTo(xScale(maxX), y1);
    ctx.lineTo(xScale(minX), y1);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, 'rgba(148,163,184,0.18)');
    grad.addColorStop(1, 'rgba(148,163,184,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // draw series
  for(const s of series){
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.data.forEach((p, idx)=>{
      const px = xScale(p.x);
      const py = yScale(p.y);
      if(idx===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    });
    ctx.stroke();
  }

  // optional current point
  if(opts && opts.point){
    const px = xScale(opts.point.x);
    const py = yScale(opts.point.y);
    ctx.fillStyle = opts.point.color || '#f59e0b';
    ctx.beginPath();
    ctx.arc(px,py,4,0,Math.PI*2);
    ctx.fill();
  }
}

function updateDashboard(){
  $('dashScenario').textContent = scenarioId(builder.years, builder.risk, builder.values) + ` • ${builder.region}`;
  $('dashInitial').textContent = fmtEUR.format(builder.initial);
  $('dashMonthly').textContent = fmtEUR.format(builder.monthly);
  $('dashYears').textContent = builder.years;
  if(lastBuilderUpdate){
    $('dashScenario').textContent += ` • bijgewerkt ${lastBuilderUpdate}`;
  }

  const proj = projectPortfolio({years: builder.years, risk: builder.risk, initial: builder.initial, monthly: builder.monthly});
  $('kpiEndBase').textContent = fmtEUR.format(proj.base.fv);
  $('kpiProfitBase').textContent = fmtEUR.format(proj.base.profit);

  // series for profit chart
  const mix = mixForYears(builder.years, builder.risk);
  const a = assumptionsForYears(builder.years, builder.risk);
  const baseRate = (mix.equity/100)*a.equity + (mix.bonds/100)*a.bonds + (mix.cash/100)*a.cash;
  const lowRate = baseRate - a.range;
  const highRate = baseRate + a.range;

  const sBase = seriesProfit({initial: builder.initial, monthly: builder.monthly, years: builder.years, annualRate: baseRate});
  const sLow  = seriesProfit({initial: builder.initial, monthly: builder.monthly, years: builder.years, annualRate: Math.max(-0.9, lowRate)});
  const sHigh = seriesProfit({initial: builder.initial, monthly: builder.monthly, years: builder.years, annualRate: highRate});


const investedData = sBase.map(p=>({x:p.m, y:p.invested}));
const baseData = sBase.map(p=>({x:p.m, y:p.value}));
const lowData  = sLow.map(p=>({x:p.m, y:p.value}));
const highData = sHigh.map(p=>({x:p.m, y:p.value}));

// actual line from snapshots (Eigen portfolio)
const snaps = loadSnapshots();
const actualData = [];
try{
  for(const s of snaps){
    const mx = monthsBetween(myp.startDate, s.date);
    actualData.push({x: mx, y: s.value});
  }
}catch(_){}

// Current point (fallback) from myportfolio if no snapshot available
let point = null;
try{
  const months = monthsBetween(myp.startDate, new Date().toISOString().slice(0,10));
  const manual = loadManualPrices();
  let value = 0;
  for(const h of myp.holdings){
    const p = myp.prices[h.ticker]?.price ?? manual[h.ticker] ?? null;
    if(p) value += Number(p) * Number(h.shares||0);
  }
  if(myp.holdings.length && value>0){
    point = { x: months, y: value, color:'#f59e0b' };
  }
}catch(_){}

const series = [
  {color:'#94a3b8', data: investedData},
  {color:'#2563eb', data: baseData},
  {color:'#6b7280', data: lowData},
  {color:'#16a34a', data: highData},
];
if(actualData.length){
  series.push({color:'#f59e0b', data: actualData});
}

const xLabels = [
  { x: 0, text: String(new Date().getFullYear()) },
  { x: builder.years * 12, text: String(new Date().getFullYear() + builder.years) },
];
drawLineChart($('profitChart'), series, {point, xLabels});
}

/** ---------------------------------------------------------
 * History modal + chart
 * ---------------------------------------------------------- */

let modalState = { ticker:null, data:null };

function attachTickerLinks(){
  qsa('.ticker-link').forEach(a=>{
    a.addEventListener('click', async (ev)=>{
      ev.preventDefault();
      const t = a.dataset.ticker;
      openModal(t);
    });
  });
}

async function openModal(ticker){
  modalState.ticker = ticker.toUpperCase();
  $('modalTitle').textContent = ticker.toUpperCase();
  const sec = getSecurityByTicker(ticker) || {name:ticker};
  $('modalSub').textContent = sec.name || ticker;

  $('modal').classList.remove('hidden');
  $('mdd').textContent = '—';
  $('histPeriod').textContent = '—';
  try{
    const range = $('histRange').value;
    const res = await apiJSON(`/api/history?ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}`);
    modalState.data = res;
    renderHistoryChart();
  }catch(e){
    $('mdd').textContent = 'N/A';
    $('histPeriod').textContent = 'N/A';
  }
}

function closeModal(){
  $('modal').classList.add('hidden');
}

function maxDrawdown(series){
  let peak = -Infinity;
  let mdd = 0;
  for(const v of series){
    if(v>peak) peak=v;
    const dd = (v/peak)-1;
    if(dd < mdd) mdd = dd;
  }
  return mdd; // negative
}

function renderHistoryChart(){
  const res = modalState.data;
  if(!res || !res.prices) return;
  const prices = res.prices.map(p=>p.close);
  const dates = res.prices.map(p=>p.date);
  const base = prices[0] || 1;
  const norm = prices.map(v=>v/base*100);

  const scale = $('histScale').value;
  const data = norm.map((v,i)=>({x:i, y: (scale==='log' ? Math.log(v) : v)}));

  // draw
  const canvas = $('histChart');
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.getAttribute('height') ? Number(canvas.getAttribute('height')) : 240;
  ctx.clearRect(0,0,W,H);

  const pad = {l:48,r:16,t:14,b:28};
  const x0=pad.l, x1=W-pad.r, y0=pad.t, y1=H-pad.b;

  const ys = data.map(p=>p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minX = 0;
  const maxX = data.length-1;

  function xs(x){ return x0 + (x-minX)*(x1-x0)/(maxX-minX || 1); }
  function yscl(y){ return y1 - (y-minY)*(y1-y0)/(maxY-minY || 1); }

  // grid
  ctx.strokeStyle = 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  const gridRows = 4;
  for(let i=0;i<=gridRows;i++){
    const py = y0 + (y1-y0)*i/gridRows;
    ctx.beginPath();
    ctx.moveTo(x0,py);
    ctx.lineTo(x1,py);
    ctx.stroke();
  }

  // axes
  ctx.strokeStyle = 'rgba(226,232,240,0.6)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x0,y1); ctx.lineTo(x1,y1); ctx.stroke();

  // y-axis labels (normalized %)
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px system-ui';
  for(let i=0;i<=4;i++){
    const ty = minY + (maxY-minY)*i/4;
    const py = yscl(ty);
    const v = (scale === 'log') ? Math.exp(ty) : ty;
    ctx.fillText(`${fmt1.format(v)}%`, 6, py+4);
  }

  // x-axis date labels (start/middle/end)
  ctx.fillStyle = '#94a3b8';
  const dateTicks = [0, Math.floor(maxX/2), maxX].filter((v, i, arr) => arr.indexOf(v) === i);
  dateTicks.forEach((idx) => {
    const px = xs(idx);
    const label = formatDateShort(dates[idx]);
    if(label) ctx.fillText(label, px - 22, y1 + 18);
  });

  const settings = loadSettings();

  // area fill
  if(settings.chartFillEnabled){
    ctx.beginPath();
    data.forEach((p,i)=>{
      const px = xs(p.x), py = yscl(p.y);
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    });
    ctx.lineTo(xs(maxX), y1);
    ctx.lineTo(xs(minX), y1);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, 'rgba(37,99,235,0.25)');
    grad.addColorStop(1, 'rgba(37,99,235,0.04)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // line
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth=2;
  ctx.beginPath();
  data.forEach((p,i)=>{
    const px = xs(p.x), py = yscl(p.y);
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  });
  ctx.stroke();

  const mdd = maxDrawdown(prices);
  $('mdd').textContent = fmt2.format(mdd*100) + '%';
  $('histPeriod').textContent = `${dates[0]} → ${dates[dates.length-1]}`;
}

/** ---------------------------------------------------------
 * Excel export (simple HTML table → XLSX via data URI fallback)
 * ---------------------------------------------------------- */
function exportMyPortfolioExcel(){
  // Minimal Excel export using HTML table. Works in Excel, no libs.
  const rows = myp.holdings.map(h=>{
    const sec = getSecurityByTicker(h.ticker) || {name:h.ticker};
    const price = myp.prices[h.ticker]?.price ?? loadManualPrices()[h.ticker] ?? '';
    const value = price ? Number(price)*Number(h.shares||0) : '';
    return {ticker:h.ticker, name:sec.name, shares:h.shares, price, value};
  });
  let html = '<table><tr><th>Ticker</th><th>Naam</th><th>Aantal</th><th>Koers</th><th>Waarde</th></tr>';
  for(const r of rows){
    html += `<tr><td>${r.ticker}</td><td>${r.name}</td><td>${r.shares}</td><td>${r.price}</td><td>${r.value}</td></tr>`;
  }
  html += '</table>';
  const uri = 'data:application/vnd.ms-excel;charset=utf-8,' + encodeURIComponent(html);
  const a = document.createElement('a');
  a.href = uri;
  a.download = 'my_portfolio.xls';
  a.click();
}

/** ---------------------------------------------------------
 * Init bindings
 * ---------------------------------------------------------- */



/** ---------------------------------------------------------
 * Rebalance
 * ---------------------------------------------------------- */

let reb = {
  cash: 0,
  current: {}, // ticker -> shares
  trades: [],
  minDriftPct: 2,
  minTradeEur: 25,
  useCosts: true,
};

function loadRebalance(){
  const r = readJSON(STORAGE.rebalance, null);
  if(r) reb = {...reb, ...r};
  if(!reb.current) reb.current = {};
  if(reb.minDriftPct == null) reb.minDriftPct = 2;
  if(reb.minTradeEur == null) reb.minTradeEur = 25;
  if(reb.useCosts == null) reb.useCosts = true;
  if($('rebCash')) $('rebCash').value = reb.cash || 0;
  if($('rebMinDriftPct')) $('rebMinDriftPct').value = reb.minDriftPct;
  if($('rebMinTradeEur')) $('rebMinTradeEur').value = reb.minTradeEur;
  if($('rebUseCosts')) $('rebUseCosts').checked = !!reb.useCosts;
}
function saveRebalance(){ writeJSON(STORAGE.rebalance, reb); }

function setRebStatus(msg){
  const el = $('rebStatus');
  if(el) el.textContent = msg;
}

function getPriceForTicker(t){
  const T = String(t).toUpperCase();
  const manual = loadManualPrices();
  const p = (builder.prices && builder.prices[T] && builder.prices[T].price) ||
            (myp.prices && myp.prices[T] && myp.prices[T].price) ||
            manual[T] || null;
  return p ? Number(p) : null;
}

function rebLoadFromMyPortfolio(){
  reb.current = reb.current || {};
  for(const h of myp.holdings){
    const t = String(h.ticker).toUpperCase();
    reb.current[t] = Number(h.shares||0);
  }
  saveRebalance();
  renderRebalance();
  setRebStatus('Aantallen geladen uit Eigen portfolio.');
}

function computeRebalance(){
  const targets = builder.holdings || [];
  const cash = Number($('rebCash')?.value || 0);
  reb.cash = cash;

  // thresholds + cost assumptions
  const minDriftPct = Number($('rebMinDriftPct')?.value || reb.minDriftPct || 0);
  const minTradeEur = Number($('rebMinTradeEur')?.value || reb.minTradeEur || 0);
  const useCosts = $('rebUseCosts') ? $('rebUseCosts').checked : true;
  reb.minDriftPct = minDriftPct;
  reb.minTradeEur = minTradeEur;
  reb.useCosts = !!useCosts;

  // total value from current holdings + cash
  let totalValue = cash;
  for(const t of targets){
    const price = getPriceForTicker(t.ticker);
    const curShares = Number(reb.current[String(t.ticker).toUpperCase()] || 0);
    const curValue = (price && curShares) ? price*curShares : 0;
    totalValue += curValue;
  }
  if(totalValue <= 0) totalValue = 0;

  let net = 0;
  let tradeCount = 0;
  let feeTotal = 0;
  let slipTotal = 0;
  const trades = [];
  const rows = [];

  for(const t of targets){
    const ticker = String(t.ticker).toUpperCase();
    const price = getPriceForTicker(ticker);
    const curShares = Number(reb.current[ticker] || 0);
    const curValue = (price && curShares) ? price*curShares : 0;
    const targetValue = totalValue * Number(t.weight || 0);
    const drift = curValue - targetValue; // positive: overweight
    const tradeValue = targetValue - curValue; // positive: buy
    const curW = totalValue > 0 ? (curValue / totalValue) : 0;
    const driftPct = (curW - Number(t.weight||0)) * 100;

    let action = 'HOLD';
    let tradeShares = 0;
    if(price && Math.abs(driftPct) >= minDriftPct && Math.abs(tradeValue) >= minTradeEur){
      action = tradeValue > 0 ? 'BUY' : 'SELL';
      const slipPct = (useCosts ? (builder.slip||0) : 0);
      const effPrice = action === 'BUY'
        ? price * (1 + slipPct/100)
        : price * (1 - slipPct/100);
      const rawShares = tradeValue / (effPrice || price);
      if(builder.rounding === 'whole'){
        tradeShares = rawShares > 0 ? Math.floor(rawShares) : Math.ceil(rawShares);
      }else{
        tradeShares = rawShares;
      }
      if((builder.rounding==='whole' && tradeShares === 0) || Math.abs(tradeShares) < 1e-9){
        action = 'HOLD';
        tradeShares = 0;
      }
    }

    // Trade € uses effective price if costs enabled
    let tradeEUR = 0;
    if(price && tradeShares){
      const slipPct = (useCosts ? (builder.slip||0) : 0);
      const effPrice = action === 'BUY'
        ? price * (1 + slipPct/100)
        : price * (1 - slipPct/100);
      tradeEUR = tradeShares * effPrice;
      // slippage cost estimate (vs mid-price)
      if(useCosts){
        slipTotal += Math.abs(tradeShares * price) * (slipPct/100);
      }
    }

    if(action !== 'HOLD'){
      tradeCount += 1;
      net += tradeEUR;
      trades.push({ticker, action, shares: tradeShares, price, tradeEUR});
    }

    rows.push({
      ticker,
      targetPct: Number(t.weight||0)*100,
      price,
      curShares,
      curValue,
      targetValue,
      drift,
      driftPct,
      action,
      tradeShares,
      tradeEUR
    });
  }

  // fees estimate
  feeTotal = (reb.useCosts ? (tradeCount * Number(builder.fee||0)) : 0);
  const netCash = net + feeTotal + (reb.useCosts ? slipTotal : 0);

  reb.trades = trades;
  saveRebalance();
  return {rows, totalValue, net, tradeCount, feeTotal, slipTotal, netCash};
}

function renderRebalance(){
  const tbody = $('tblRebalance')?.querySelector('tbody');
  if(!tbody) return;

  if(!builder.holdings || !builder.holdings.length){
    tbody.innerHTML = '<tr><td colspan="10" class="muted">Bouw eerst een portefeuille in Portfolio Builder.</td></tr>';
    return;
  }

  const {rows, totalValue, net, tradeCount, feeTotal, slipTotal, netCash} = computeRebalance();

  $('rebTotalValue').textContent = fmtEUR.format(totalValue || 0);
  $('rebNet').textContent = fmtEUR.format(net || 0);
  $('rebTrades').textContent = String(tradeCount || 0);
  if($('rebFees')) $('rebFees').textContent = fmtEUR.format(feeTotal || 0);
  if($('rebSlip')) $('rebSlip').textContent = fmtEUR.format(slipTotal || 0);
  if($('rebNetCash')) $('rebNetCash').textContent = fmtEUR.format(netCash || 0);
  if($('rebFeeView')) $('rebFeeView').textContent = fmt2.format(builder.fee || 0);
  if($('rebSlipView')) $('rebSlipView').textContent = fmt2.format(builder.slip || 0);

  tbody.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');
    const priceStr = r.price ? fmt2.format(r.price) : '—';
    tr.innerHTML = `
      <td><a href="#" class="ticker-link" data-ticker="${r.ticker}">${r.ticker}</a></td>
      <td>${fmt2.format(r.targetPct)}%</td>
      <td>${priceStr}</td>
      <td><input type="number" step="0.0001" value="${r.curShares}" data-t="${r.ticker}" class="rebShares" /></td>
      <td>${fmtEUR.format(r.curValue||0)}</td>
      <td>${fmtEUR.format(r.targetValue||0)}</td>
      <td title="Drift ${fmt2.format(r.driftPct||0)}%">${fmtEUR.format(r.drift||0)}</td>
      <td>${badge(r.action)}</td>
      <td>${builder.rounding==='whole' ? fmtEUR.format(r.tradeShares||0) : fmt2.format(r.tradeShares||0)}</td>
      <td>${fmtEUR.format(r.tradeEUR||0)}</td>
    `;
    tbody.appendChild(tr);
  }

  qsa('.rebShares').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const t = inp.dataset.t;
      reb.current[String(t).toUpperCase()] = Number(inp.value || 0);
      saveRebalance();
      renderRebalance();
    });
  });

  attachTickerLinks();
}

function exportRebalanceCSV(){
  const trades = reb.trades || [];
  const header = ['ticker','action','shares','price','trade_eur'];
  const lines = [header.join(',')];
  for(const tr of trades){
    lines.push([tr.ticker,tr.action,tr.shares,tr.price,tr.tradeEUR].join(','));
  }
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rebalance_trades_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportRebalanceExcel(){
  const trades = reb.trades || [];
  const rows = trades.map(tr=>({
    ticker: tr.ticker,
    action: tr.action,
    shares: tr.shares,
    price: tr.price != null ? Number(tr.price).toFixed(4) : '',
    trade_eur: tr.tradeEUR != null ? Number(tr.tradeEUR).toFixed(2) : '',
  }));
  exportExcelTable({
    columns: [
      {key:'ticker',label:'Ticker'},
      {key:'action',label:'Actie'},
      {key:'shares',label:'Aantal'},
      {key:'price',label:'Koers'},
      {key:'trade_eur',label:'Trade €'},
    ],
    rows,
    filename: `rebalance_trades_${new Date().toISOString().slice(0,10)}.xls`
  });
}

function init(){
  initNav();
  loadBuilder();
  loadMyPortfolio();
  loadRebalance();

  // default show dashboard
  showView('dashboard');

  // builder buttons
  $('btnBuild').addEventListener('click', ()=>{
    builderInputs();
    renderBuilder();
    setBuilderStatus('Portefeuille opgebouwd.');
  });
  $('btnFetchPrices').addEventListener('click', async ()=>{
    builderInputs();
    await onFetchPrices();
    // Ensure the holdings table updates immediately after price fetch
    renderBuilder();
    renderQuotesTable();
  });
  $('btnExportCSV').addEventListener('click', ()=>{
    exportCSV(builder.holdings, `portfolio_${scenarioId(builder.years,builder.risk,builder.values)}.csv`);
  });
  $('btnExportXLS').addEventListener('click', ()=>{
    builderInputs();
    renderBuilder();
    exportBuilderExcel();
  });

// custom tickers in Builder
const btnAdd = $('btnAddTicker');
if(btnAdd){
  btnAdd.addEventListener('click', ()=>{
    const raw = $('inpAddTicker').value;
    const t = ensureCustomTicker(raw);
    if(t){
      $('inpAddTicker').value = '';
      setBuilderStatus(`Custom ticker toegevoegd: ${t}`);
      renderCustomTickerChips();
      renderBuilder();
    }else{
      setBuilderStatus('Voer een ticker in.');
    }
  });
}


  // builder initial render
  renderBuilder();
  renderCustomTickerChips();
  attachTickerLinks();

  // my portfolio
  $('mpLoadFromBuilder').addEventListener('click', mpLoadFromBuilder);
  $('mpFetchPrices').addEventListener('click', mpFetchPrices);
  $('mpSave').addEventListener('click', mpSave);
  $('mpExportXLSX').addEventListener('click', exportMyPortfolioExcel);

  // quotes
  $('qFetch').addEventListener('click', qFetch);
  $('qClearCache').addEventListener('click', qClearCache);
  $('qRegion').addEventListener('change', renderQuotesTable);
  if($('qStatusFilter')) $('qStatusFilter').addEventListener('change', renderQuotesTable);

// rebalance
if($('rebGenerate')){
  $('rebLoadFromMy').addEventListener('click', rebLoadFromMyPortfolio);
  $('rebGenerate').addEventListener('click', ()=>{ renderRebalance(); setRebStatus('Trades berekend.'); });
  $('rebExportCSV').addEventListener('click', exportRebalanceCSV);
  $('rebExportXLS').addEventListener('click', exportRebalanceExcel);
  $('rebCash').addEventListener('change', ()=>{ reb.cash = Number($('rebCash').value||0); saveRebalance(); renderRebalance(); });
  if($('rebMinDriftPct')) $('rebMinDriftPct').addEventListener('change', ()=>{ reb.minDriftPct = Number($('rebMinDriftPct').value||0); saveRebalance(); renderRebalance(); });
  if($('rebMinTradeEur')) $('rebMinTradeEur').addEventListener('change', ()=>{ reb.minTradeEur = Number($('rebMinTradeEur').value||0); saveRebalance(); renderRebalance(); });
  if($('rebUseCosts')) $('rebUseCosts').addEventListener('change', ()=>{ reb.useCosts = $('rebUseCosts').checked; saveRebalance(); renderRebalance(); });
}

  // upcoming
  $('uMode').addEventListener('change', renderUpcoming);
  $('uRefresh').addEventListener('click', ()=>{
    $('uStatus').textContent = 'Lijst ververst.';
    renderUpcoming();
  });

  // settings manual prices
  $('btnSaveManual').addEventListener('click', saveManual);
  $('btnClearManual').addEventListener('click', clearManual);

  // modal
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') closeModal(); });
  $('histRange').addEventListener('change', ()=> openModal(modalState.ticker));
  $('histScale').addEventListener('change', renderHistoryChart);

  document.addEventListener('focusin', (e)=>{
    if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable)){
      autoRefreshPaused = true;
    }
  });
  document.addEventListener('focusout', (e)=>{
    if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable)){
      autoRefreshPaused = false;
    }
  });

  // kick off other renders
  renderQuotesTable();
  renderUpcoming();
  renderManualTable();
  renderMyHoldings();
  updateDashboard();

  const settings = loadSettings();
  setAutoRefreshInterval(settings.autoRefreshIntervalSec);
  setAutoRefreshEnabled(settings.autoRefreshEnabled);
}

document.addEventListener('DOMContentLoaded', init);
