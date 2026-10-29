import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ALLOWED = new Set(['trade_ejtrader_ct.py','trade_sinan_ct.py','trade_ctrader_fix.py','show_orders.py']);
const DEFAULT_SCRIPT = 'trade_ejtrader_ct.py';
const LIST_SCRIPT = 'show_orders.py';

export function unitsPerLot(symbol) {
  const scale = {BTCUSD:1,ETHUSD:1,XAUUSD:100,XAUEUR:100,XAGUSD:5000,XAGEUR:5000,ADAUSD:100,XRPUSD:100,DOGEUSD:100,SOLUSD:100,AVAXUSD:100,DOTUSD:100,LINKUSD:100,MATICUSD:100,SHIBUSD:100,LTCUSD:100,BCHUSD:100,UNIUSD:100,AAVEUSD:100,ATOMUSD:100,FILUSD:100};
  const v = scale[(symbol||'').toUpperCase()];
  return v || 100000;
}
export function lotsToUnits(symbol, lots) { return lots * unitsPerLot(symbol); }

export function resolveDir(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.PEPPERSTONE_DIR) candidates.push(process.env.PEPPERSTONE_DIR);
  candidates.push('pepperstone-ctrader-python','../pepperstone-ctrader-python','pepperstone-ctrade-go/pepperstone-ctrader-python','../pepperstone-ctrade-go/pepperstone-ctrader-python','../../pepperstone-ctrade-go/pepperstone-ctrader-python');
  // home globs simple
  try {
    const home = os.homedir();
    for (const p of [path.join(home,'apps','*','pepperstone-ctrader-python'), path.join(home,'apps','*','*','pepperstone-ctrader-python'), path.join(home,'apps','*','pepperstone-ctrade-go','pepperstone-ctrader-python')]) {
      // simple: push parent and let check
    }
  } catch {}
  // also walk up from cwd
  let cur = process.cwd();
  for (let i = 0; i < 4; i++) {
    candidates.push(path.join(cur, 'pepperstone-ctrader-python'));
    candidates.push(path.join(cur, 'pepperstone-ctrade-go', 'pepperstone-ctrader-python'));
    cur = path.dirname(cur);
  }
  // search starting directory from go project
  candidates.push('/home/bumblebee/apps/bnc/tamir-go/pepperstone-ctrade-go/pepperstone-ctrader-python');
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isDirectory() && fs.existsSync(path.join(c, DEFAULT_SCRIPT))) {
        return path.resolve(c);
      }
    } catch {}
  }
  // glob home
  try {
    const home = os.homedir();
    const base = path.join(home, 'apps');
    for (const level1 of safeReadDir(base)) {
      for (const cand of [path.join(base, level1, 'pepperstone-ctrader-python'), path.join(base, level1, 'pepperstone-ctrade-go', 'pepperstone-ctrader-python')]) {
        if (fs.existsSync(path.join(cand, DEFAULT_SCRIPT))) return path.resolve(cand);
      }
      const base2 = path.join(base, level1);
      for (const level2 of safeReadDir(base2)) {
        const cand = path.join(base2, level2, 'pepperstone-ctrader-python');
        if (fs.existsSync(path.join(cand, DEFAULT_SCRIPT))) return path.resolve(cand);
        const cand2 = path.join(base2, level2, 'pepperstone-ctrade-go', 'pepperstone-ctrader-python');
        if (fs.existsSync(path.join(cand2, DEFAULT_SCRIPT))) return path.resolve(cand2);
      }
    }
  } catch {}
  throw new Error('pepperstone scripts not found');
}
function safeReadDir(d) { try { return fs.readdirSync(d).filter(x=>{try{return fs.statSync(path.join(d,x)).isDirectory();}catch{return false;}}); } catch { return []; } }

export function detectPython(dir) {
  for (const c of [path.join(dir,'venv','bin','python3'), path.join(dir,'venv','bin','python'), path.join(dir,'venv','Scripts','python.exe')]) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return 'python3';
}

export class Broker {
  constructor(dir, mode) {
    this.dir = dir;
    this.mode = mode;
    this.python = detectPython(dir);
    this.script = DEFAULT_SCRIPT;
    this.timeout = 90000;
  }
  runScript(script, extra = []) {
    if (!script || !ALLOWED.has(script)) script = DEFAULT_SCRIPT;
    const args = [script, '--mode', this.mode, ...extra];
    const out = execFileSync(this.python, args, { cwd: this.dir, timeout: this.timeout, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
    return out;
  }
  run(extra = []) { return this.runScript(this.script, extra); }
  extractErrors(text) {
    const errs = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('[ERROR]') || t.startsWith('[SEND ERROR]') || t.includes('Order rejected')) errs.push(t);
    }
    return errs;
  }
  taggedJSON(text, tag) {
    const prefix = '[' + tag + ']';
    const out = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith(prefix)) {
        const p = t.slice(prefix.length).trim();
        if (p) out.push(p);
      }
    }
    return out;
  }
  parseQuote(text) {
    const m = text.match(/\bbid=([0-9.]+).*ask=([0-9.]+)/i);
    if (m) return { bid: parseFloat(m[1]), ask: parseFloat(m[2]) };
    return { bid: 0, ask: 0 };
  }
  async quote(symbol) {
    const text = this.run(['--price-only','--currency', symbol.toUpperCase()]);
    const errs = this.extractErrors(text);
    if (errs.length) throw new Error(errs.join(' | '));
    const q = this.parseQuote(text);
    if (q.bid <= 0 || q.ask <= 0) throw new Error('no bid/ask');
    return q;
  }
  async listPositions() {
    // try list script
    try {
      const text = this.runScript(LIST_SCRIPT, ['--json','--wait','3']);
      const errs = this.extractErrors(text);
      if (errs.length === 0) {
        const positions = this.parsePositions(text);
        return positions;
      }
    } catch (e) {}
    const text = this.run(['--list-positions']);
    const errs = this.extractErrors(text);
    if (errs.length) throw new Error(errs.join(' | '));
    return this.parsePositions(text);
  }
  parsePositions(text) {
    const payloads = this.taggedJSON(text, 'POSITION');
    const positions = [];
    for (const p of payloads) {
      try {
        const pos = JSON.parse(p);
        if (pos.pos_id) positions.push(pos);
      } catch {}
    }
    return positions;
  }
  async closePosition(positionID) {
    const text = this.run(['--close-position', positionID]);
    const errs = this.extractErrors(text);
    if (errs.length) throw new Error(errs.join(' | '));
    if (!/\[CLOSE\]\s*OK/i.test(text)) throw new Error('did not confirm close');
    return true;
  }
  async order(side, symbol, lots, sl=0, tp=0) {
    side = side.toLowerCase().trim();
    const args = ['--side', side, '--amount', String(lots), '--currency', symbol.toUpperCase()];
    if (sl > 0) args.push('--sl', String(sl));
    if (tp > 0) args.push('--tp', String(tp));
    const text = this.run(args);
    const errs = this.extractErrors(text);
    // parse ticket
    const ticketM = text.match(/\bticket=(\S+)/i);
    const ticket = ticketM ? ticketM[1] : '';
    const posPayloads = this.taggedJSON(text, 'POSITION_OPEN');
    let positionID = '';
    if (posPayloads.length) {
      try { positionID = JSON.parse(posPayloads[posPayloads.length-1]).pos_id || ''; } catch {}
    }
    const q = this.parseQuote(text);
    if (errs.length) throw new Error(errs.join(' | '));
    let price = side === 'buy' ? q.ask : q.bid;
    if (price <= 0) throw new Error('no fill price');
    return { ticket, positionID, positionUnresolved: ticket !== '' && positionID === '', bid: q.bid, ask: q.ask, price, output: text };
  }
  fetchCandles(symbol, interval, limit) {
    return fetchCandlesNode(symbol, interval, limit);
  }
}

// Yahoo candles (simplified)
const intervalSeconds = { '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'8h':28800,'1d':86400,'3d':259200,'1w':604800,'1M':2592000 };
function yahooInterval(interval) {
  const map = { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'60m','4h':'60m','8h':'60m','1d':'1d','3d':'1d','1w':'1wk','1M':'1mo' };
  const base = map[interval];
  if (!base) throw new Error('unsupported interval ' + interval);
  let factor = 1;
  if (interval === '4h' || interval === '8h') factor = 4;
  if (interval === '3d') factor = 3;
  return { base, factor };
}
function yahooSymbols(pair) {
  const p = (pair||'').toUpperCase().trim();
  const re = /^([A-Z]{3})([A-Z]{3})$/;
  const m = p.match(re);
  const cands = [];
  if (m) {
    const base = m[1], quote = m[2];
    if (base === 'USD' && quote !== 'USD') cands.push(quote + '=X');
    cands.push(p + '=X');
  } else cands.push(p + '=X');
  return [...new Set(cands)];
}
async function fetchYahooOnce(sym, base, period1, period2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${period1}&period2=${period2}&interval=${base}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('yahoo http ' + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('no result');
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const opens = q.open || [], highs = q.high || [], lows = q.low || [], closes = q.close || [], vols = q.volume || [];
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ Time: new Date(ts[i] * 1000), Open: o, High: h, Low: l, Close: c, Volume: vols[i] || 0 });
  }
  return candles;
}
export async function fetchCandlesNode(symbol, interval, limit) {
  const { base, factor } = yahooInterval(interval);
  const secs = intervalSeconds[base] || 3600;
  const now = Math.floor(Date.now() / 1000);
  const baseLimit = Math.min(limit * factor, 2000);
  const period1 = now - secs * baseLimit - secs * 4;
  const period2 = now;
  let lastErr = null;
  for (const sym of yahooSymbols(symbol)) {
    try {
      let candles = await fetchYahooOnce(sym, base, period1, period2);
      if (!candles.length) { lastErr = new Error('no data'); continue; }
      candles.sort((a,b)=>a.Time - b.Time);
      // aggregate
      if (factor > 1) {
        const out = [];
        for (let i = 0; i + factor <= candles.length; i += factor) {
          const grp = candles.slice(i, i + factor);
          const c = { Time: grp[0].Time, Open: grp[0].Open, High: grp[0].High, Low: grp[0].Low, Close: grp[factor-1].Close, Volume: 0 };
          for (const g of grp) { if (g.High > c.High) c.High = g.High; if (g.Low < c.Low) c.Low = g.Low; c.Volume += g.Volume || 0; }
          out.push(c);
        }
        candles = out;
      }
      if (candles.length > limit) candles = candles.slice(candles.length - limit);
      return candles;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('yahoo failed');
}