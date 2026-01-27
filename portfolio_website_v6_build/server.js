
/**
 * Portfolio Planner v6 - Node server (no dependencies)
 * Runs on http://localhost:5174
 * - serves /public static files
 * - /api/quotes?tickers=MSFT,ASML...
 * - /api/history?ticker=MSFT&range=3y
 * - /api/cache/clear
 *
 * Price sources (server-side proxy; avoids CORS):
 * 1) Stooq (no key) - primary
 * 2) Yahoo Finance quote/chart endpoints - fallback
 * 3) Cache - fallback
 */
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5174;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, 'cache');

// Symbol overrides so "VWCE" and similar work reliably across Stooq/Yahoo
const STOOQ_OVERRIDES = {
  VWCE: ['vwce.nl','vwce.de'],
  VAGF: ['vagf.nl','vagf.de'],
  ERNX: ['ernx.de'],
  ASML: ['asml.nl'],
  ADYEN: ['adyen.nl'],
  SAP: ['sap.de'],
  SIE: ['sie.de'],
  SU: ['su.pa'],
  AIR: ['air.pa'],
  ALV: ['alv.de'],
  RHM: ['rhm.de'],
  NESN: ['nesn.ch'],
  NOVO: ['novo-b.dk'],
};

const YAHOO_OVERRIDES = {
  VWCE: 'VWCE.DE',
  VAGF: 'VAGF.DE',
  ERNX: 'ERNX.DE',
  ASML: 'ASML.AS',
  ADYEN: 'ADYEN.AS',
  SAP: 'SAP.DE',
  SIE: 'SIE.DE',
  SU: 'SU.PA',
  AIR: 'AIR.PA',
  ALV: 'ALV.DE',
  RHM: 'RHM.DE',
  NESN: 'NESN.SW',
  NOVO: 'NOVO-B.CO',
};

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }, headers));
  res.end(body);
}

function sendJSON(res, obj, status = 200) {
  send(res, status, JSON.stringify(obj));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text);
}

function safeFile(p) {
  const full = path.normalize(path.join(PUBLIC_DIR, p));
  if (!full.startsWith(PUBLIC_DIR)) return null;
  return full;
}

async function fetchUrl(u, timeoutMs = 8000) {
  // On many Windows/corporate networks, curl respects proxy settings better than Node.
  // Therefore we try curl first, then native https, then PowerShell.
  // EXTRA robustness:
  // - Some networks break TLS inspection. We add curl options to avoid revocation issues.
  // - For Stooq we also try plain HTTP as a last resort.

  const isStooq = /^https:\/\/stooq\.com\//i.test(u);

  // 1) curl
  try {
    const r = await curlFetch(u, timeoutMs);
    if (r && r.status && r.status !== 0) return r;
  } catch (e) { /* ignore */ }

  // 1b) for Stooq: try HTTP variant (often bypasses strict TLS setups)
  if (isStooq) {
    const httpUrl = u.replace(/^https:\/\//i, 'http://');
    try {
      const r = await curlFetch(httpUrl, timeoutMs);
      if (r && r.status && r.status !== 0) return r;
    } catch (e) { /* ignore */ }
  }

  // Fallback: native https.get
  try {
    const r = await new Promise((resolve, reject) => {
      const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } }, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve({ status: resp.statusCode, data, headers: resp.headers }));
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
    if (r && r.status && r.status !== 0) return r;
  } catch (e) { /* ignore */ }

  // 2b) for Stooq: plain HTTP with Node (no TLS)
  if (isStooq) {
    const httpUrl = u.replace(/^https:\/\//i, 'http://');
    try {
      const r = await new Promise((resolve, reject) => {
        const req = http.get(httpUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => resolve({ status: resp.statusCode, data, headers: resp.headers }));
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
      });
      if (r && r.status && r.status !== 0) return r;
    } catch (e) { /* ignore */ }
  }

  // Final fallback: PowerShell (proxy-aware)
  return await psFetch(u, timeoutMs);
}

function curlFetch(u, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Emit status code at the end so we can parse it reliably
    const maxTime = Math.max(2, Math.ceil(timeoutMs / 1000));
    const marker = 'HTTP_STATUS:';

    const baseArgs = [
      '-L',
      '-sS',
      '--connect-timeout', '4',
      '--max-time', String(maxTime),
      '--retry', '2',
      '--retry-delay', '0',
      '--ssl-no-revoke',
      '-A', 'Mozilla/5.0',
      '-w', `\\n${marker}%{http_code}`,
      u,
    ];

    const run = (args, cb) => execFile('curl', args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, cb);

    run(baseArgs, (err, stdout, stderr) => {
      // If TLS inspection breaks, curl on Windows may error out. Try one last time with --insecure.
      if (err) {
        const insecureArgs = baseArgs.slice(0, baseArgs.length - 1);
        insecureArgs.splice(2, 0, '--insecure');
        insecureArgs.push(u);
        return run(insecureArgs, (err2, stdout2) => {
          if (err2) return reject(err2);
          return finish(stdout2);
        });
      }
      return finish(stdout);
    });

    function finish(out){
      const idx = out.lastIndexOf(marker);
      if (idx === -1) return reject(new Error('curl: no status marker'));
      const body = out.slice(0, idx).replace(/\r?\n$/, '');
      const codeStr = out.slice(idx + marker.length).trim();
      const code = parseInt(codeStr, 10);
      resolve({ status: Number.isFinite(code) ? code : 0, data: body, headers: {} });
    }
  });
}

function psFetch(u, timeoutMs) {
  return new Promise((resolve, reject) => {
    const seconds = Math.max(2, Math.ceil(timeoutMs / 1000));
    const marker = 'HTTP_STATUS:';
    // Use PowerShell to respect Windows proxy settings
    const ps = [
      '-NoProfile',
      '-Command',
      `$ProgressPreference='SilentlyContinue';` +
      `$r=Invoke-WebRequest -UseBasicParsing -Uri '${u.replace(/'/g, "''")}' -TimeoutSec ${seconds} -Headers @{'User-Agent'='Mozilla/5.0'};` +
      `Write-Output '${marker}'$r.StatusCode;` +
      `Write-Output $r.Content;`
    ];
    execFile('powershell', ps, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      const lines = stdout.split(/\r?\n/);
      const statusLine = lines.find(l => l.startsWith(marker));
      if (!statusLine) return reject(new Error('ps: no status'));
      const code = parseInt(statusLine.replace(marker, '').trim(), 10);
      // content is everything after the status line
      const idx = lines.indexOf(statusLine);
      const body = lines.slice(idx + 1).join('\n');
      resolve({ status: Number.isFinite(code) ? code : 0, data: body, headers: {} });
    });
  });
}
function cachePath(key) {
  return path.join(CACHE_DIR, key.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json');
}

function readCache(key) {
  try {
    const p = cachePath(key);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function writeCache(key, obj) {
  try { fs.writeFileSync(cachePath(key), JSON.stringify(obj)); } catch (e) { }
}

// ---------------- Stooq parsing ----------------

function parseStooqQuoteCSV(csv) {
  // Some proxies (or text gateways) can prepend extra lines.
  // We try to locate the real CSV header.
  const raw = String(csv || '').trim();
  const headerIdx = raw.indexOf('Symbol,Date');
  const normalized = (headerIdx >= 0) ? raw.slice(headerIdx) : raw;
  const lines = normalized.trim().split(/\r?\n/);
  if (!lines.length) return null;

  const first = lines[0].split(',');
  const hasHeader = first[0] && first[0].trim().toLowerCase() === 'symbol';
  const row = hasHeader ? (lines[1] || '').split(',') : first;

  if (hasHeader) {
    const header = first;
    const map = {};
    header.forEach((h, i) => map[h.trim().toLowerCase()] = row[i]);
    const close = Number(map['close']);
    if (!isFinite(close)) return null;
    return { symbol: map['symbol'], date: map['date'], time: map['time'], close };
  }

  // Stooq quote CSV often returns a single row without headers:
  // SYMBOL,DATE,TIME,OPEN,HIGH,LOW,CLOSE,VOLUME
  if (row.length >= 7) {
    const close = Number(row[6]);
    if (!isFinite(close)) return null;
    return {
      symbol: row[0],
      date: row[1],
      time: row[2],
      close,
    };
  }

  return null;
}

function parseStooqHistoryCSV(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;
    const date = parts[0];
    const close = Number(parts[4]);
    if (!date || !isFinite(close)) continue;
    out.push({ date, close });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ---------------- Yahoo parsing ----------------

function parseYahooQuote(jsonText) {
  try {
    const obj = JSON.parse(jsonText);
    const r = obj && obj.quoteResponse && obj.quoteResponse.result && obj.quoteResponse.result[0];
    if (!r) return null;
    const price = Number(r.regularMarketPrice);
    if (!isFinite(price)) return null;
    return { price };
  } catch (e) { return null; }
}

function parseYahooChart(jsonText) {
  try {
    const obj = JSON.parse(jsonText);
    const r = obj && obj.chart && obj.chart.result && obj.chart.result[0];
    if (!r) return [];
    const ts = r.timestamp || [];
    const closes = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      const c = Number(closes[i]);
      if (!isFinite(c)) continue;
      const d = new Date(ts[i] * 1000);
      const iso = d.toISOString().slice(0, 10);
      out.push({ date: iso, close: c });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch (e) { return []; }
}

// ---------------- Source logic ----------------

function stooqCandidates(ticker) {
  const t = String(ticker).trim().toUpperCase();
  const out = [];
  const ovr = STOOQ_OVERRIDES[t] || [];
  for (const s of ovr) out.push(String(s).toLowerCase());
  // Keep the candidate list short to prevent "Haal koersen op" feeling slow.
  // Most US tickers resolve as .us; a few EU tickers resolve as .de/.nl.
  const d = [
    `${t.toLowerCase()}.us`,
    `${t.toLowerCase()}.de`,
    `${t.toLowerCase()}.nl`,
  ];
  for (const s of d) if (!out.includes(s)) out.push(s);
  return out;
}

async function getQuoteForTicker(ticker, stooqOverride=null) {
  const t = String(ticker).trim().toUpperCase();
  const cacheKey = `quote_${t}`;
  const cached = readCache(cacheKey);
  if (cached && cached.price && (Date.now() - cached.ts < 1000 * 60 * 60 * 6)) {
    return { ticker: t, price: cached.price, status: 'CACHED', source: cached.source || 'cache' };
  }

  // 1) Stooq
    const candidates = [];
  if (stooqOverride) candidates.push(String(stooqOverride).trim().toLowerCase());
  for (const sym of stooqCandidates(t)) candidates.push(sym);
  const seen = new Set();
  const uniqCandidates = candidates.filter(s => { if(seen.has(s)) return false; seen.add(s); return true; });

  for (const sym of uniqCandidates) {
    const u = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&e=csv`;
    try {
      // More forgiving timeout: corporate proxies can add latency.
      const r = await fetchUrl(u, 7000);
      if (r.status !== 200) continue;
      const q = parseStooqQuoteCSV(r.data);
      if (q && q.close) {
        writeCache(cacheKey, { price: q.close, source: `stooq:${sym}`, ts: Date.now() });
        return { ticker: t, price: q.close, status: 'LIVE', source: `stooq:${sym}` };
      }
    } catch (e) { /* try next */ }

    // Extra fallback: use Jina text gateway (helps when direct TLS/network paths are blocked)
    try {
      const ju = `https://r.jina.ai/http://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&e=csv`;
      const r2 = await fetchUrl(ju, 9000);
      if (r2.status !== 200) continue;
      const q2 = parseStooqQuoteCSV(r2.data);
      if (q2 && q2.close) {
        writeCache(cacheKey, { price: q2.close, source: `stooq_jina:${sym}`, ts: Date.now() });
        return { ticker: t, price: q2.close, status: 'LIVE', source: `stooq_jina:${sym}` };
      }
    } catch (e) { /* ignore */ }
  }

  // 2) Yahoo quote
  try {
    const ySym = YAHOO_OVERRIDES[t] || t;
    const u = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ySym)}`;
    const r = await fetchUrl(u, 12000);
    if (r.status === 200) {
      const q = parseYahooQuote(r.data);
      if (q && q.price) {
        writeCache(cacheKey, { price: q.price, source: `yahoo:${ySym}`, ts: Date.now() });
        return { ticker: t, price: q.price, status: 'LIVE', source: `yahoo:${ySym}` };
      }
    }
  } catch (e) { /* ignore */ }

  // 3) stale cache
  if (cached && cached.price) {
    return { ticker: t, price: cached.price, status: 'CACHED', source: cached.source || 'cache', note: 'stale' };
  }

  return { ticker: t, price: null, status: 'MISSING', source: 'none' };
}

async function getHistoryForTicker(ticker, range) {
  const t = String(ticker).trim().toUpperCase();
  const r = String(range || '3y').toLowerCase();
  const cacheKey = `hist_${t}_${r}`;
  const cached = readCache(cacheKey);
  if (cached && cached.prices && (Date.now() - cached.ts < 1000 * 60 * 60 * 24)) {
    return { ticker: t, prices: cached.prices, status: 'CACHED', source: cached.source, ts: cached.ts };
  }

  const years = (r === '1y') ? 1 : (r === '3y') ? 3 : (r === '5y') ? 5 : 50;
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  // 1) Stooq history
  for (const sym of stooqCandidates(t)) {
    const u = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
    try {
      const resp = await fetchUrl(u, 9000);
      if (resp.status !== 200) continue;
      const all = parseStooqHistoryCSV(resp.data);
      if (!all.length) continue;
      const prices = all.filter(p => p.date >= cutoffISO);
      writeCache(cacheKey, { prices, source: `stooq:${sym}`, ts: Date.now() });
      return { ticker: t, prices, status: 'LIVE', source: `stooq:${sym}`, ts: Date.now() };
    } catch (e) { /* try next */ }

    // Jina gateway fallback
    try {
      const ju = `https://r.jina.ai/http://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
      const resp2 = await fetchUrl(ju, 12000);
      if (resp2.status !== 200) continue;
      const all2 = parseStooqHistoryCSV(resp2.data);
      if (!all2.length) continue;
      const prices2 = all2.filter(p => p.date >= cutoffISO);
      writeCache(cacheKey, { prices: prices2, source: `stooq_jina:${sym}`, ts: Date.now() });
      return { ticker: t, prices: prices2, status: 'LIVE', source: `stooq_jina:${sym}`, ts: Date.now() };
    } catch (e) { /* ignore */ }
  }

  // 2) Yahoo chart
  try {
    const yRange = (r === 'max') ? 'max' : r;
    const ySym = YAHOO_OVERRIDES[t] || t;
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=${encodeURIComponent(yRange)}&interval=1d`;
    const resp = await fetchUrl(u, 8000);
    if (resp.status === 200) {
      const all = parseYahooChart(resp.data);
      if (all.length) {
        const prices = all.filter(p => p.date >= cutoffISO);
        writeCache(cacheKey, { prices, source: `yahoo:${ySym}`, ts: Date.now() });
        return { ticker: t, prices, status: 'LIVE', source: `yahoo:${ySym}`, ts: Date.now() };
      }
    }
  } catch (e) { /* ignore */ }

  // 3) stale cache
  if (cached && cached.prices) {
    return { ticker: t, prices: cached.prices, status: 'CACHED', source: cached.source, ts: cached.ts, note: 'stale' };
  }
  return { ticker: t, prices: [], status: 'MISSING', source: 'none' };
}

function handleApi(req, res, parsed) {
  const pathname = parsed.pathname || '';
  if (pathname === '/api/quotes') {
    const items = (parsed.query.items || '').split(',').map(s => s.trim()).filter(Boolean);
    const tickers = (parsed.query.tickers || '').split(',').map(s => s.trim()).filter(Boolean);

    // items format: TICKER@stooq.symbol (optional)
    const requests = items.length
      ? items.map(it => {
          const [t, sym] = it.split('@');
          return getQuoteForTicker((t || '').trim(), (sym || '').trim() || null);
        })
      : tickers.map(t => getQuoteForTicker(t));

    if (!requests.length) return sendJSON(res, { prices: {}, note: 'no tickers' });

    Promise.all(requests).then(results => {
      const prices = {};
      results.forEach(r => prices[r.ticker] = { price: r.price, status: r.status, source: r.source });
      sendJSON(res, { prices, note: 'stooq (curl/http/jina) -> yahoo -> cache' });
    }).catch(err => sendJSON(res, { error: String(err) }, 500));
    return;
  }

  if (pathname === '/api/history') {
    const ticker = parsed.query.ticker;
    const range = parsed.query.range || '3y';
    if (!ticker) return sendJSON(res, { error: 'missing ticker' }, 400);
    getHistoryForTicker(ticker, range).then(payload => sendJSON(res, payload)).catch(err => sendJSON(res, { error: String(err) }, 500));
    return;
  }

  if (pathname === '/api/cache/clear') {
    try {
      for (const f of fs.readdirSync(CACHE_DIR)) fs.unlinkSync(path.join(CACHE_DIR, f));
      sendJSON(res, { ok: true });
    } catch (e) { sendJSON(res, { ok: false, error: String(e) }, 500); }
    return;
  }

  // Diagnostics: fetch an arbitrary URL (useful to confirm network/proxy behavior)
  // Example: /api/diag?url=https%3A%2F%2Fstooq.com%2Fq%2Fl%2F%3Fs%3Dmsft.us%26f%3Dsd2t2ohlcv%26e%3Dcsv
  if (pathname === '/api/diag') {
    const target = parsed.query.url;
    if (!target) return sendJSON(res, { error: 'missing url' }, 400);
    fetchUrl(String(target), 12000).then(r => {
      const preview = String(r.data || '').slice(0, 400);
      sendJSON(res, { status: r.status, preview });
    }).catch(err => sendJSON(res, { error: String(err) }, 500));
    return;
  }

  sendJSON(res, { error: 'not found' }, 404);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname.startsWith('/api/')) return handleApi(req, res, parsed);

  let filePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  filePath = safeFile(filePath);
  if (!filePath) return sendText(res, 403, 'Forbidden');

  if (!fs.existsSync(filePath)) return sendText(res, 404, 'Not found');

  const ext = path.extname(filePath).toLowerCase();
  const ct =
    ext === '.html' ? 'text/html; charset=utf-8' :
    ext === '.css' ? 'text/css; charset=utf-8' :
    ext === '.js' ? 'application/javascript; charset=utf-8' :
    ext === '.json' ? 'application/json; charset=utf-8' :
    'application/octet-stream';

  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
  res.end(data);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Portfolio Planner v6 running on http://localhost:${PORT}`);
  console.log(`Serving static from: ${PUBLIC_DIR}`);
});
