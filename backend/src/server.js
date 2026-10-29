import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { BinanceClient, FormatQuantity, FormatPrice } from './binance.js';
import { resolveDir, detectPython, Broker, fetchCandlesNode, lotsToUnits } from './pepperstone.js';
import * as A from './analyzer.js';
import * as SIG from './signals.js';
import { spawnSync, execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const store = new Store();
const schedulers = new Map(); // id -> timer
const guards = new Set();
const appState = {
  bc: new BinanceClient('', ''),
  se: null,
  pc: null,
  exchange: 'binance',
  environment: 'live',
  ps: null,
  ctx: null
};
function isPepperstone() { return appState.exchange === 'pepperstone'; }

// Pepperstone broker lazy
function pepperstoneBroker() {
  if (appState.ps) return appState.ps;
  if (!isPepperstone()) throw new Error('pepperstone broker not initialized');
  const mode = appState.environment === 'live' ? 'live' : 'demo';
  const dir = resolveDir('');
  const broker = new Broker(dir, mode);
  // attach fetchCandles alias
  appState.ps = broker;
  return broker;
}

function nowISO() { return new Date().toISOString(); }

// ---- helpers for trading ----
function paramVal(params, key, def) {
  if (params && params[key] !== undefined) return Number(params[key]);
  return def;
}
function boolToStr(b) { return b ? '1' : '0'; }
function safeSlice(s, n) {
  if (s.length >= n) return s;
  const ns = new Array(n).fill(0);
  for (let i = 0; i < s.length; i++) ns[i] = s[i];
  return ns;
}
function periodFromTable(tbl) {
  if (tbl === 'analyzed_months') return '1M';
  let rest = tbl.replace(/^analyzed/, '').replace(/s$/, '');
  if (!rest) rest = '1h';
  return rest;
}

// fetchAndAnalyze port
async function fetchAndAnalyze(symbol, interval, lookback, params = null) {
  let klines;
  if (isPepperstone()) {
    pepperstoneBroker();
    const candles = await fetchCandlesNode(symbol, interval, lookback);
    klines = candles.map(c => ({ OpenTime: c.Time, Open: c.Open, High: c.High, Low: c.Low, Close: c.Close, Volume: c.Volume, CloseTime: new Date(c.Time.getTime() + 1000) }));
  } else {
    klines = await appState.bc.fetchKlines(symbol, interval, lookback);
  }

  const n = klines.length;
  const prices = new Array(n), highs = new Array(n), lows = new Array(n), opens = new Array(n), volumes = new Array(n);
  for (let i = 0; i < n; i++) {
    opens[i] = klines[i].Open; highs[i] = klines[i].High; lows[i] = klines[i].Low; prices[i] = klines[i].Close; volumes[i] = klines[i].Volume;
  }
  const analyzed = new Array(n);
  const macdRes = A.MACD(prices, paramVal(params,'macd_fast',12), paramVal(params,'macd_slow',26), paramVal(params,'macd_signal',9));
  const rsi14 = A.RSI(prices, paramVal(params,'rsi_period',14));
  const rsi4 = A.RSI(prices, paramVal(params,'rsi_short',4));
  const rsi7 = A.RSI(prices, paramVal(params,'rsi_middle',7));
  const rsi10 = A.RSI(prices, paramVal(params,'rsi_long',10));
  const ma3 = A.SMA(prices, paramVal(params,'ma_short',3));
  const ma4 = A.SMA(prices, paramVal(params,'ma_middle',4));
  const ma7 = A.SMA(prices, paramVal(params,'ma_long',7));
  const ema3 = A.EMA(prices, paramVal(params,'ema_short',3));
  const ema4 = A.EMA(prices, paramVal(params,'ema_middle',4));
  const ema6 = A.EMA(prices, paramVal(params,'ema_long',6));
  const ema14 = A.EMA(prices, paramVal(params,'ema_primary',14));
  const smaShort = A.SMA(prices, paramVal(params,'sma_short',3));
  const smaLong = A.SMA(prices, paramVal(params,'sma_long',7));
  const bb = A.BBand(prices, paramVal(params,'bb_period',20), paramVal(params,'bb_stddev',2));
  const hma9 = A.HMA(prices, paramVal(params,'hma_period',9));
  const stoch = A.StochasticRSI(prices, paramVal(params,'stoch_length_rsi',14), paramVal(params,'stoch_length_stoch',28), paramVal(params,'stoch_smooth_k',14), paramVal(params,'stoch_smooth_d',14));

  const rsi14s = safeSlice(rsi14, n), rsi4s = safeSlice(rsi4, n), rsi7s = safeSlice(rsi7, n), rsi10s = safeSlice(rsi10, n), hma9s = safeSlice(hma9, n);

  for (let i = 0; i < n; i++) {
    const row = {
      time: Math.floor(klines[i].OpenTime.getTime() / 1000),
      open: opens[i], high: highs[i], low: lows[i], close: prices[i], volume: volumes[i], currency: symbol,
      macd: 0, macd_signal: 0, macd_hist: 0,
      rsi: 0, rsi_short: 0, rsi_middle: 0, rsi_long: 0,
      ema: 0, ema_short: 0, ema_middle: 0, ema_long: 0,
      ma_short: 0, ma_middle: 0, ma_long: 0,
      sma_short: 0, sma_long: 0, hma: 0,
      stochastic_K: 0, stochastic_D: 0,
      bb_middle: 0, bb_upper: 0, bb_lower: 0, bb_upper_75: 0, bb_lower_25: 0, bb_trade: 0, bb_sell_crossover: 0, bb_buy_crossover: 0,
      macd_trade: '', rsi_trade: '', stochastic_trade: '', channel_trade: '', ema_trade: '', sma_trade: '', ma_trade: '', hma_trade: '', trade: '',
      last4candle_trend: '', bullish_crossover: '', bearish_crossover: '', is_Bottom: '', is_Peak: '', up_trend_before_Peak: '', down_trend_before_Bottom: '', buy_on_Bottom: '', sell_on_Peak: '',
      sma_short_uptrend: '', sma_short_downtrend: '', sma_long_uptrend: '', sma_long_downtrend: ''
    };
    if (i < macdRes.MACD.length) { row.macd = macdRes.MACD[i]; row.macd_signal = macdRes.Signal[i]; row.macd_hist = macdRes.Histogram[i]; }
    if (i < rsi14s.length) row.rsi = rsi14s[i];
    if (i < rsi4s.length) row.rsi_short = rsi4s[i];
    if (i < rsi7s.length) row.rsi_middle = rsi7s[i];
    if (i < rsi10s.length) row.rsi_long = rsi10s[i];
    if (i < ma3.length) row.ma_short = ma3[i];
    if (i < ma4.length) row.ma_middle = ma4[i];
    if (i < ma7.length) row.ma_long = ma7[i];
    if (i < ema3.length) row.ema_short = ema3[i];
    if (i < ema4.length) row.ema_middle = ema4[i];
    if (i < ema6.length) row.ema_long = ema6[i];
    if (i < ema14.length) row.ema = ema14[i];
    if (i < smaShort.length) row.sma_short = smaShort[i];
    if (i < smaLong.length) row.sma_long = smaLong[i];
    if (i < hma9s.length) row.hma = hma9s[i];
    if (i < bb.Middle.length) { row.bb_middle = bb.Middle[i]; row.bb_upper = bb.Upper[i]; row.bb_lower = bb.Lower[i]; row.bb_upper_75 = bb.Upper75[i]; row.bb_lower_25 = bb.Lower25[i]; row.bb_sell_crossover = bb.SellCross[i]; row.bb_buy_crossover = bb.BuyCross[i]; }
    if (i < stoch.K.length) { row.stochastic_K = stoch.K[i]; row.stochastic_D = stoch.D[i]; }
    analyzed[i] = row;
  }

  const trend = A.DetectPeakBottom(highs, lows, prices, smaShort, smaLong, ema14, rsi14, paramVal(params,'trend_lookback',3));
  for (let i = 0; i < n; i++) {
    if (i < trend.IsPeak.length) {
      analyzed[i].is_Peak = boolToStr(trend.IsPeak[i]);
      analyzed[i].is_Bottom = boolToStr(trend.IsBottom[i]);
      analyzed[i].bullish_crossover = boolToStr(trend.BullishCross[i]);
      analyzed[i].bearish_crossover = boolToStr(trend.BearishCross[i]);
      analyzed[i].up_trend_before_Peak = boolToStr(trend.UpTrendBeforePeak[i]);
      analyzed[i].down_trend_before_Bottom = boolToStr(trend.DownTrendBeforeBot[i]);
      analyzed[i].buy_on_Bottom = boolToStr(trend.BuyOnBottom[i]);
      analyzed[i].sell_on_Peak = boolToStr(trend.SellOnPeak[i]);
      analyzed[i].sma_short_uptrend = boolToStr(trend.SMAShortUptrend[i]);
      analyzed[i].sma_short_downtrend = boolToStr(trend.SMAShortDowntrend[i]);
      analyzed[i].sma_long_uptrend = boolToStr(trend.SMALongUptrend[i]);
      analyzed[i].sma_long_downtrend = boolToStr(trend.SMALongDowntrend[i]);
    }
  }
  // signals
  for (let i = 1; i < n; i++) {
    const curr = mapRowToSignalInput(analyzed[i]);
    const prev = mapRowToSignalInput(analyzed[i - 1]);
    const trendRow = analyzed[i];
    analyzed[i].macd_trade = SIG.evalMACDTrade(curr, prev);
    analyzed[i].stochastic_trade = SIG.evalStochasticTrade(curr, prev);
    analyzed[i].rsi_trade = SIG.evalRSITrade(curr, prev);
    analyzed[i].ema_trade = SIG.evalEMATrade(curr, prev);
    analyzed[i].ma_trade = SIG.evalMATrade(curr, prev);
    analyzed[i].sma_trade = SIG.evalSMATrade(trendRowSignal(trendRow));
    analyzed[i].hma_trade = SIG.evalHMATrade(curr, prev);
    analyzed[i].bb_trade = SIG.evalBBTrade(curr, prev);
    // compatibility json keys expected by RowMap? Go JSON tags are snake_case; above already.
  }

  const candles = klines.map(k => ({
    time: Math.floor(k.OpenTime.getTime() / 1000),
    open: k.Open, high: k.High, low: k.Low, close: k.Close, volume: k.Volume
  }));
  return { candles, analyzed, table_name: tableNameFor(interval) };
}

// helper to map row fields for signals (already same)
function trendRowSignal(row) { return {
  is_Bottom: row.is_Bottom, down_trend_before_Bottom: row.down_trend_before_Bottom,
  sma_long: row.sma_long, close: row.close, ema: row.ema, is_Peak: row.is_Peak, up_trend_before_Peak: row.up_trend_before_Peak
}; }
function mapRowToSignalInput(row) {
  return {
    macd: row.macd, macd_signal: row.macd_signal, macd_hist: row.macd_hist,
    stochastic_K: row.stochastic_K, stochastic_D: row.stochastic_D,
    rsi_middle: row.rsi_middle,
    ema_short: row.ema_short, ema_long: row.ema_long,
    ma_short: row.ma_short, ma_middle: row.ma_middle,
    close: row.close, hma: row.hma,
    bb_sell_crossover: row.bb_sell_crossover, bb_buy_crossover: row.bb_buy_crossover
  };
}
function tableNameFor(interval) {
  if (interval === '1M') return 'analyzed_months';
  return `analyzed${interval}s`;
}

// trading criteria
function parseCriteria(raw) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function hasCriteria(c) { return Object.values(c || {}).some(v => String(v).trim() !== ''); }
function rowMap(row) { return row; } // already map
function valueStr(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v);
}
function toFloat(v) {
  if (typeof v === 'number') return v;
  const f = parseFloat(String(v).trim());
  return isNaN(f) ? null : f;
}
function checkCriteria(criteria, row, direction) {
  if (!row) return false;
  let anySignal = false, signalHit = false;
  for (const [key, want] of Object.entries(criteria || {})) {
    if (!want || key === 'rsi_level') continue;
    if (!(key in row)) continue;
    anySignal = true;
    if (String(row[key]).trim().toLowerCase() === String(want).trim().toLowerCase()) { signalHit = true; break; }
  }
  let rsiLevel = parseFloat(criteria?.rsi_level);
  const hasRsi = !isNaN(rsiLevel) && rsiLevel > 0;
  let rsiOk = true;
  if (hasRsi) {
    const rv = toFloat(row.rsi);
    if (rv === null) rsiOk = false;
    else if (direction === 'buy') rsiOk = rv < rsiLevel;
    else rsiOk = rv > rsiLevel;
  }
  if (anySignal) return signalHit && rsiOk;
  if (hasRsi) return rsiOk;
  return false;
}
function mostRecentCriteriaTime(rows, criteria, direction) {
  if (!hasCriteria(criteria)) return 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (checkCriteria(criteria, rows[i], direction)) return rows[i].time;
  }
  return 0;
}
function trendDirection(rows, buyCrit, sellCrit) {
  const buyAt = mostRecentCriteriaTime(rows, buyCrit, 'buy');
  const sellAt = mostRecentCriteriaTime(rows, sellCrit, 'sell');
  let dir = '';
  if (buyAt > sellAt) dir = 'buy';
  else if (sellAt > buyAt) dir = 'sell';
  return { dir, buyAt, sellAt };
}
function parseBuyDate(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) {
    // try
    return null;
  }
  return d;
}
function newestEntry(trades) {
  if (!trades || trades.length === 0) return Infinity;
  const d = parseBuyDate(trades[0].buy_date);
  if (!d) return 0;
  return d.getTime() / 1000;
}

// Scheduler
function startSchedulerTask(t) {
  if (schedulers.has(t.id)) return;
  const ctx = { cancelled: false };
  const timer = setInterval(() => {
    if (ctx.cancelled) return;
    runExec(t.id).catch(e => console.error('exec err', e));
  }, Math.max(1, t.interval || 5) * 60 * 1000);
  // run immediately
  runExec(t.id).catch(e=>console.error(e));
  schedulers.set(t.id, { timer, ctx });
}
function stopSchedulerTask(id) {
  const s = schedulers.get(id);
  if (s) { clearInterval(s.timer); s.ctx.cancelled = true; schedulers.delete(id); }
}

async function runExec(id) {
  if (guards.has(id)) return;
  guards.add(id);
  try {
    const t = store.getScheduleTask(id);
    if (!t) return;
    await execSchedule(t);
  } catch (e) {
    console.error('exec failed task', id, e);
    try {
      const t = store.getScheduleTask(id);
      if (t) await store.insertScheduleLog({ task_id: t.id, task_name: t.task_name, action: 'error', currency: t.currency, interval: String(t.interval), analyzed_table: t.analyzed_table_name, message: 'Execution failed', error: e.message || String(e) });
    } catch {}
  } finally {
    guards.delete(id);
  }
}

// The frontend pair lists are disjoint (Binance: *USDT / stable quote,
// Pepperstone: FX and metals), so a pair that does not fit the active exchange
// can be caught before the broker rejects it with a bare "Invalid symbol".
function matchesActiveExchange(symbol) {
  const s = String(symbol || '').toUpperCase();
  const isStableQuote = s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('BUSD') || s.endsWith('FDUSD');
  return isPepperstone() ? !isStableQuote : isStableQuote;
}

async function execSchedule(t) {
  if (!matchesActiveExchange(t.currency)) {
    const base = logBase(t, null);
    base.action = 'error';
    base.message = `${t.currency} is not a ${appState.exchange} symbol — check Settings/exchange or the task's currency`;
    base.error = `Currency ${t.currency} does not belong to the active exchange "${appState.exchange}"`;
    await store.insertScheduleLog(base);
    return;
  }
  const interval = periodFromTable(t.analyzed_table_name);
  const params = store.loadParamsForTable(t.analyzed_table_name);
  const r = await fetchAndAnalyze(t.currency, interval, 500, params);
  if (!r.analyzed || r.analyzed.length === 0) {
    const base = logBase(t, null);
    base.action = 'buy-check'; base.message = 'No matching criteria';
    await store.insertScheduleLog(base);
    return;
  }
  const last = r.analyzed[r.analyzed.length - 1];
  const lastMap = last;
  const buyCrit = parseCriteria(t.buy_criteria);
  const sellCrit = parseCriteria(t.sell_criteria);
  const hasBuy = hasCriteria(buyCrit);
  const hasSell = hasCriteria(sellCrit);
  const open = store.getOpenTradesByPeriodAndCurrency(interval, t.currency);
  const buys = open.filter(x => (x.side||'buy').toLowerCase() !== 'sell');
  const sells = open.filter(x => (x.side||'').toLowerCase() === 'sell');
  let maxOpen = t.max_open_trades; if (maxOpen <= 0) maxOpen = 1;
  const buyNow = hasBuy && checkCriteria(buyCrit, lastMap, 'buy');
  const sellNow = hasSell && checkCriteria(sellCrit, lastMap, 'sell');
  const { dir: trendDir, buyAt: trendBuyAt, sellAt: trendSellAt } = trendDirection(r.analyzed, buyCrit, sellCrit);

  if (isPepperstone()) {
    return execPepperstone(t, lastMap, interval, open, buys, sells, maxOpen, buyNow, sellNow, trendDir, trendBuyAt, trendSellAt);
  }
  return execBinance(t, lastMap, interval, open, buys, buyNow, sellNow, trendDir, trendBuyAt, trendSellAt);
}

function logBase(t, row) {
  // mirror criteria_info snapshot minimally
  const buyCrit = parseCriteria(t.buy_criteria);
  const sellCrit = parseCriteria(t.sell_criteria);
  const cols = [];
  const seen = new Set();
  const add = (key, value) => {
    if (!value || seen.has(key)) return;
    seen.add(key); cols.push({ Label: key, Value: value });
  };
  if (row) {
    const signalCols = ['macd_trade','rsi_trade','stochastic_trade','ema_trade','sma_trade','ma_trade','hma_trade'];
    for (const c of signalCols) if (row[c] != null) add(c, String(row[c]));
    for (const k of Object.keys(buyCrit)) {
      if (k === 'rsi_level') continue;
      if (row[k] != null) add(k, String(row[k]));
    }
    for (const k of Object.keys(sellCrit)) {
      if (k === 'rsi_level') continue;
      if (row[k] != null) add(k, String(row[k]));
    }
    if (row.rsi != null) cols.push({ Label: 'RSI', Value: Number(row.rsi).toFixed(1) });
  }
  if (buyCrit.rsi_level) cols.push({ Label: 'BUY_RSI', Value: '< ' + buyCrit.rsi_level });
  if (sellCrit.rsi_level) cols.push({ Label: 'SELL_RSI', Value: '> ' + sellCrit.rsi_level });
  return {
    task_id: t.id, task_name: t.task_name, currency: t.currency, interval: String(t.interval),
    analyzed_table: t.analyzed_table_name, balance: '', criteria_info: JSON.stringify(cols),
    indicators: '', message: '', error: '', trade_amount: '', action: ''
  };
}

async function execBinance(t, lastMap, interval, open, buys, buyNow, sellNow, trendDir, trendBuyAt, trendSellAt) {
  if (open && open.length > 0) {
    const held = open[0];
    const heldSide = (held.side||'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    let oppSignal = false;
    if (heldSide === 'buy') {
      oppSignal = sellNow || (trendDir === 'sell' && trendSellAt >= newestEntry(buys));
    } else {
      oppSignal = buyNow || (trendDir === 'buy' && trendBuyAt >= newestEntry(buys));
    }
    if (!oppSignal) {
      const base = logBase(t, lastMap);
      base.action = 'hold'; base.message = `Holding ${t.currency}, no signal`;
      await store.insertScheduleLog(base);
      return;
    }
    if (heldSide === 'buy') {
      return closeBinanceLong(t, lastMap, held);
    }
    // legacy short close
    const order = await executeMarketOrderNode(t.currency, 'buy', held.amount);
    const profit = (held.buy_price - order.price) / held.buy_price * 100;
    const diffAbs = (held.buy_price - order.price) * held.amount;
    await store.updateTradeSell(held.id, nowISO(), order.price, profit, diffAbs);
    const base = logBase(t, lastMap);
    base.action = 'close-sell'; base.trade_amount = `${held.amount} @ ${order.price.toFixed(2)}`;
    base.message = `Closed sell ${t.currency} @ ${order.price} profit ${profit.toFixed(2)}% (ID: ${order.order_id})`;
    await store.insertScheduleLog(base);
    return;
  }
  if (buyNow) return openPosition(t, lastMap, 'buy');
  const base = logBase(t, lastMap);
  base.action = 'buy-check'; base.message = 'No matching criteria';
  await store.insertScheduleLog(base);
}

async function closeBinanceLong(t, lastMap, held) {
  const baseAsset = t.currency.replace(/USDT$/,'');
  const assetBalance = await appState.bc.getBalance(baseAsset);
  const currentPrice = await getLatestPriceNode(t.currency);
  const profitPct = (currentPrice - held.buy_price) / held.buy_price * 100;
  if (!(currentPrice > held.buy_price)) {
    const base = logBase(t, lastMap);
    base.action = 'sell'; base.balance = `${assetBalance.toFixed(6)} ${baseAsset} free`;
    base.trade_amount = `would sell ${held.amount} ${baseAsset} @ ${currentPrice} (not profitable)`;
    base.message = `Not profitable: current ${currentPrice} <= buy ${held.buy_price}`;
    await store.insertScheduleLog(base); return;
  }
  if (t.sell_if_greater_than > 0 && profitPct < t.sell_if_greater_than) {
    const base = logBase(t, lastMap);
    base.action = 'sell'; base.balance = `${assetBalance.toFixed(6)} ${baseAsset} free`;
    base.trade_amount = `${held.amount} ${baseAsset} @ ${currentPrice} ~${profitPct.toFixed(2)}%`;
    base.message = `Profit ${profitPct.toFixed(2)}% < ${t.sell_if_greater_than}% threshold`;
    await store.insertScheduleLog(base); return;
  }
  if (assetBalance <= 0) {
    const base = logBase(t, lastMap);
    base.action = 'sell'; base.balance = `${assetBalance} ${baseAsset} free`;
    base.trade_amount = `no ${baseAsset} to sell`;
    base.message = `No ${baseAsset} balance: ${assetBalance}`;
    await store.insertScheduleLog(base); return;
  }
  const sellQty = Math.min(held.amount, assetBalance);
  const order = await executeMarketOrderNode(t.currency, 'sell', sellQty);
  const diff = (order.price - held.buy_price) * held.amount;
  const profit = (order.price - held.buy_price) / held.buy_price * 100;
  await store.updateTradeSell(held.id, nowISO(), order.price, profit, diff);
  const base = logBase(t, lastMap);
  base.action = 'sell'; base.balance = `${assetBalance.toFixed(6)} ${baseAsset} free`;
  base.trade_amount = `sold ${sellQty} ${baseAsset} @ ${order.price}`;
  base.message = `Sell: ${order.quantity} @ ${order.price} profit ${profit.toFixed(2)}% (ID: ${order.order_id})`;
  await store.insertScheduleLog(base);
}

async function execPepperstone(t, lastMap, interval, open, buys, sells, maxOpen, buyNow, sellNow, trendDir, trendBuyAt, trendSellAt) {
  function trendBuy() { return trendDir === 'buy' && sells.length > 0 && trendBuyAt >= newestEntry(sells); }
  function trendSell() { return trendDir === 'sell' && buys.length > 0 && trendSellAt >= newestEntry(buys); }
  const wantBuy = buyNow || trendBuy();
  const wantSell = sellNow || trendSell();
  if (!wantBuy && !wantSell) {
    const base = logBase(t, lastMap);
    if (open && open.length > 0) { base.action='hold'; base.message=`Holding ${buys.length} buy / ${sells.length} sell ${t.currency} ${interval}, no signal`; }
    else { base.action='buy-check'; base.message='No matching criteria'; }
    await store.insertScheduleLog(base);
    return;
  }
  if (wantBuy) {
    const broker = pepperstoneBroker();
    let closed = true;
    for (const s of sells) {
      if (!(await closePsTrade(t, lastMap, s))) closed = false;
    }
    if (!closed) {
      const base = logBase(t, lastMap);
      base.action='buy-check'; base.message=`Skipped new buy: could not close the open ${t.currency} short(s)`; base.error='close failed';
      await store.insertScheduleLog(base); /* continue? Go returns after logging */ 
    } else {
      const cur = store.getOpenTradesByPeriodAndCurrency(interval, t.currency);
      const curBuys = cur.filter(x => (x.side||'buy').toLowerCase() !== 'sell');
      if (curBuys.length < maxOpen) {
        await openPosition(t, lastMap, 'buy');
      } else {
        const base = logBase(t, lastMap);
        base.action='buy-check'; base.trade_amount = `${maxOpen} per dir`;
        base.message = `Max ${maxOpen} buy(s) already open on ${interval}, skipping new buy`;
        await store.insertScheduleLog(base);
      }
    }
  }
  if (wantSell) {
    const cur = store.getOpenTradesByPeriodAndCurrency(interval, t.currency);
    const curBuys = cur.filter(x => (x.side||'buy').toLowerCase() !== 'sell');
    const curSells = cur.filter(x => (x.side||'').toLowerCase() === 'sell');
    let closed = true;
    for (const b of curBuys) {
      if (!(await closePsTrade(t, lastMap, b))) closed = false;
    }
    if (!closed) {
      const base = logBase(t, lastMap);
      base.action='sell-check'; base.message=`Skipped new sell: could not close the open ${t.currency} buy(ies)`; base.error='close failed';
      await store.insertScheduleLog(base);
      return;
    }
    if (curSells.length < maxOpen) {
      return openPosition(t, lastMap, 'sell');
    }
    const base = logBase(t, lastMap);
    base.action='sell-check'; base.trade_amount = `${maxOpen} per dir`;
    base.message = `Max ${maxOpen} sell(s) already open on ${interval}, skipping new sell`;
    await store.insertScheduleLog(base);
  }
}

async function resolvePositionID(t, tr) {
  const broker = pepperstoneBroker();
  const positions = await broker.listPositions();
  const wantedSide = (tr.side||'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
  const candidates = positions.filter(p => String(p.symbol).toUpperCase() === String(t.currency).toUpperCase() && String(p.side).toLowerCase() === wantedSide);
  if (candidates.length === 0) {
    // log
    return '';
  }
  if (candidates.length > 1) return '';
  return String(candidates[0].pos_id || candidates[0].position_id || '');
}

async function closePsTrade(t, lastMap, tr) {
  const isLong = (tr.side||'buy').toLowerCase() !== 'sell';
  let positionID = (tr.position_id || '').trim();
  const broker = pepperstoneBroker();
  if (!positionID) {
    const resolved = await resolvePositionID(t, tr);
    if (!resolved) {
      const base = logBase(t, lastMap);
      base.action = 'close-' + tr.side;
      base.trade_amount = `${tr.amount} lots`;
      base.message = `Could not identify the broker position for trade #${tr.id} (${tr.side} ${t.currency} ${tr.amount} lots). Left open for manual review.`;
      base.error = 'position not identified';
      await store.insertScheduleLog(base);
      return false;
    }
    await store.setTradePositionId(tr.id, resolved);
    tr.position_id = resolved;
    positionID = resolved;
  }
  try {
    await broker.closePosition(positionID);
  } catch (e) {
    const base = logBase(t, lastMap);
    base.action = 'close-' + tr.side;
    base.trade_amount = `${tr.amount} lots`;
    base.message = `Failed to close broker position ${positionID}: ${e.message}`;
    base.error = e.message;
    await store.insertScheduleLog(base);
    return false;
  }
  const closePrice = await getLatestPriceNode(t.currency).catch(() => 0);
  if (!(closePrice > 0)) {
    await store.updateTradeSellUnknown(tr.id);
    const base = logBase(t, lastMap);
    base.action = 'close-' + tr.side;
    base.trade_amount = `${tr.amount} lots`;
    base.message = `Closed ${tr.side} ${t.currency} (position ${positionID}) but could not read a price; profit left unrecorded.`;
    base.error = 'no close price';
    await store.insertScheduleLog(base);
    return true;
  }
  let profitPct, diffAbs;
  if (isLong) { profitPct = (closePrice - tr.buy_price) / tr.buy_price * 100; diffAbs = (closePrice - tr.buy_price) * tr.amount; }
  else { profitPct = (tr.buy_price - closePrice) / tr.buy_price * 100; diffAbs = (tr.buy_price - closePrice) * tr.amount; }
  await store.updateTradeSell(tr.id, nowISO(), closePrice, profitPct, diffAbs);
  const base = logBase(t, lastMap);
  base.action = 'close-' + (tr.side||'buy');
  base.trade_amount = `${tr.amount} lots @ ${closePrice}`;
  base.message = `Closed ${tr.side} ${t.currency} @ ${closePrice} profit ${profitPct.toFixed(2)}% (position ${positionID})`;
  await store.insertScheduleLog(base);
  return true;
}

async function openPosition(t, lastMap, side) {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const lots = t.trade_balance_percentage > 0 ? t.trade_balance_percentage : 0.01;
    const res = await broker.order(side, t.currency, lots, 0, 0);
    const id = store.insertTrade({
      buy_date: nowISO(), amount: lots, currency: t.currency, buy_price: res.price, period: periodFromTable(t.analyzed_table_name),
      tactic_name: t.task_name, usdt: lots, side, position_id: res.positionID
    });
    const label = side === 'sell' ? 'Sell (short)' : 'Buy';
    let posNote = `position ${res.positionID}`;
    let errStr = '';
    if (!res.positionID) { posNote = 'POSITION ID UNRESOLVED — open on broker but not closable by this app; attribute manually'; errStr = 'position id unresolved'; }
    const base = logBase(t, lastMap);
    base.action = side;
    base.trade_amount = `${lots} lots`;
    base.message = `${label}: ${lots} lots @ ${res.price} (${posNote})`;
    base.error = errStr;
    await store.insertScheduleLog(base);
    return;
  }
  // Binance
  const usdtBalance = await appState.bc.getBalance('USDT');
  let usdtAmount, ok;
  if (t.balance_type === 'fixed') {
    if (t.trade_balance_percentage <= 0) { ok = false; } else { usdtAmount = t.trade_balance_percentage; ok = true; }
  } else {
    if (usdtBalance <= 0) ok = false;
    else { usdtAmount = usdtBalance * t.trade_balance_percentage / 100; ok = usdtAmount > 0; }
  }
  if (!ok) {
    const base = logBase(t, lastMap);
    base.action = side === 'buy' ? 'buy' : side;
    base.balance = `${usdtBalance.toFixed(2)} USDT free`;
    const unit = t.balance_type === 'fixed' ? ' USDT' : '%';
    base.trade_amount = `insufficient: ${t.balance_type} -> ${t.trade_balance_percentage}${unit}`;
    base.message = 'Skipped: insufficient balance';
    await store.insertScheduleLog(base);
    return;
  }
  const order = await executeMarketOrderQuoteNode(t.currency, side, String(usdtAmount));
  store.insertTrade({
    buy_date: nowISO(), amount: order.quantity, currency: t.currency, buy_price: order.price,
    period: periodFromTable(t.analyzed_table_name), tactic_name: t.task_name, usdt: usdtAmount, side: 'buy'
  });
  const unit = t.balance_type === 'fixed' ? ' USDT' : '%';
  const base = logBase(t, lastMap);
  base.action = 'buy';
  base.balance = `${usdtBalance.toFixed(2)} USDT free`;
  base.trade_amount = `${t.balance_type} -> ${t.trade_balance_percentage}${unit} = ${usdtAmount} USDT`;
  base.message = `Buy: ${order.quantity} @ ${order.price} (ID: ${order.order_id})`;
  await store.insertScheduleLog(base);
}

// Node versions of app methods used by scheduler
async function getLatestPriceNode(symbol) {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const q = await broker.quote(symbol);
    return (q.bid + q.ask) / 2;
  }
  return appState.bc.getSymbolPrice(symbol);
}
async function executeMarketOrderNode(symbol, side, quantity) {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const qty = Number(quantity);
    const lots = qty / lotsToUnits(symbol, 1);
    const finalLots = lots < 0.0001 ? (qty/100000 < 0.0001 ? 0.01 : qty/100000) : lots;
    const res = await broker.order(side, symbol, finalLots < 0.0001 ? 0.01 : finalLots, 0, 0);
    return { order_id: 0, symbol, side, quantity: qty, price: res.price, status: 'FILLED', position_id: res.positionID, position_unresolved: res.positionUnresolved };
  }
  const stepSize = (await appState.bc.getSymbolPrecision(symbol)).lotStepSize;
  let qtyStr = String(quantity);
  if (stepSize) qtyStr = FormatQuantity(Number(quantity), stepSize);
  let order;
  if (side.toLowerCase() === 'buy') order = await appState.bc.createMarketBuyQuantity(symbol, qtyStr);
  else order = await appState.bc.createMarketSellQuantity(symbol, qtyStr);
  const execQty = parseFloat(order.executedQty || 0);
  const quote = parseFloat(order.cummulativeQuoteQty || 0);
  const avg = execQty > 0 ? quote / execQty : 0;
  return { order_id: order.orderId, symbol, side, quantity: execQty, price: avg, status: order.status };
}
async function executeMarketOrderQuoteNode(symbol, side, quoteQty) {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const qv = parseFloat(quoteQty);
    const price = await getLatestPriceNode(symbol);
    const qty = qv / price;
    const lots = qty / 100000;
    const finalLots = lots < 0.0001 ? 0.01 : lots;
    const res = await broker.order(side.toLowerCase(), symbol, finalLots, 0, 0);
    return { order_id: 0, symbol, side: side.toLowerCase(), quantity: qty, price: res.price, status: 'FILLED' };
  }
  let order;
  if (side.toLowerCase() === 'buy') {
    order = await appState.bc.createMarketBuyQuote(symbol, quoteQty);
  } else {
    const price = await appState.bc.getSymbolPrice(symbol);
    const q = parseFloat(quoteQty);
    const qty = q / price;
    const stepSize = (await appState.bc.getSymbolPrecision(symbol)).lotStepSize;
    const qtyStr = stepSize ? FormatQuantity(qty, stepSize) : String(qty);
    order = await appState.bc.createMarketSellQuantity(symbol, qtyStr);
  }
  const execQty = parseFloat(order.executedQty || 0);
  const quote = parseFloat(order.cummulativeQuoteQty || 0);
  const avg = execQty > 0 ? quote / execQty : parseFloat(order.price || 0);
  return { order_id: order.orderId, symbol, side, quantity: execQty, price: avg, status: order.status };
}

// RPC handlers
const H = {};
function reg(name, fn) { H[name] = fn; }

reg('InitBinanceClient', async (apiKey, secretKey) => {
  if (apiKey && secretKey) appState.bc = new BinanceClient(apiKey, secretKey);
  return null;
});
reg('TestConnection', async () => {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const q = await broker.quote('USDJPY');
    return { asset: 'USDJPY', free: q.bid, locked: q.ask };
  }
  if (!appState.bc.hasKeys()) throw new Error('API key required');
  const balances = await appState.bc.getAllBalances();
  const usdt = balances.find(b => b.asset === 'USDT') || { asset:'USDT', free:0, locked:0 };
  return usdt;
});
reg('FetchAndAnalyze', async (symbol, interval, lookback) => fetchAndAnalyze(symbol, interval, lookback, null));
reg('FetchAndAnalyzeWithParams', async (symbol, interval, lookback, params) => fetchAndAnalyze(symbol, interval, lookback, params));
reg('GetBalance', async (asset) => {
  if (isPepperstone()) return 0;
  if (!appState.bc.hasKeys()) throw new Error('API key required');
  return appState.bc.getBalance(asset);
});
reg('ExecuteMarketOrder', async (symbol, side, quantity) => executeMarketOrderNode(symbol, side, quantity).then(r=>r));
reg('ExecuteMarketOrder', async (symbol, side, quantity) => {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const q = (await import('./pepperstone.js')).lotsToUnits ? null : null;
    const lots = Number(quantity) / lotsToUnits(symbol, 1);
    let finalLots = lots < 0.0001 ? Number(quantity)/100000 : lots;
    if (finalLots < 0.0001) finalLots = 0.01;
    const res = await broker.order(side.toLowerCase(), symbol, finalLots < 0.0001 ? 0.01 : finalLots, 0, 0);
    return { order_id: 0, symbol, side: side.toLowerCase(), quantity: Number(quantity), price: res.price, status: 'FILLED', position_id: res.positionID, position_unresolved: res.positionUnresolved };
  }
  const { lotStepSize } = await appState.bc.getSymbolPrecision(symbol);
  let qtyStr = String(quantity);
  if (lotStepSize) qtyStr = FormatQuantity(Number(quantity), lotStepSize);
  let order;
  if (side.toLowerCase() === 'buy') order = await appState.bc.createMarketBuyQuantity(symbol, qtyStr);
  else order = await appState.bc.createMarketSellQuantity(symbol, qtyStr);
  const execQty = parseFloat(order.executedQty || 0);
  const quote = parseFloat(order.cummulativeQuoteQty || 0);
  const avg = execQty > 0 ? quote / execQty : 0;
  return { order_id: order.orderId, symbol, side, quantity: execQty, price: avg, status: order.status };
});
reg('ExecuteLimitOrder', async (symbol, side, quantity, price) => {
  if (isPepperstone()) {
    const broker = pepperstoneBroker();
    const q = parseFloat(quantity);
    const lots = q / 100000;
    const finalLots = lots < 0.0001 ? 0.01 : lots;
    const res = await broker.order(side.toLowerCase(), symbol, finalLots, 0, 0);
    return { order_id: 0, symbol, side: side.toLowerCase(), quantity: q, price: res.price, status: 'FILLED' };
  }
  const { lotStepSize, priceTickSize } = await appState.bc.getSymbolPrecision(symbol);
  let qStr = String(quantity), pStr = String(price);
  const qn = parseFloat(quantity), pn = parseFloat(price);
  if (lotStepSize) qStr = FormatQuantity(qn, lotStepSize);
  if (priceTickSize) pStr = FormatPrice(pn, priceTickSize);
  const order = await appState.bc.createLimitOrder(symbol, side, qStr, pStr);
  const execQty = parseFloat(order.executedQty || 0);
  const avg = parseFloat(order.price || 0);
  const quote = parseFloat(order.cummulativeQuoteQty || 0);
  return { order_id: order.orderId, symbol, side, quantity: execQty, price: quote > 0 && execQty > 0 ? quote/execQty : avg, status: order.status };
});
reg('ExecuteMarketOrderQuote', async (symbol, side, quoteQty) => {
  return executeMarketOrderQuoteNode(symbol, side, quoteQty);
});
reg('GetLatestPrice', async (symbol) => {
  return getLatestPriceNode(symbol);
});
reg('GetOpenOrdersList', async (symbol) => {
  if (isPepperstone()) return [];
  if (!appState.bc.hasKeys()) throw new Error('API key required');
  const orders = await appState.bc.listOpenOrders(symbol);
  return orders.map(o => ({ order_id: o.orderId, symbol: o.symbol, side: o.side, type: o.type, price: parseFloat(o.price||0), quantity: parseFloat(o.origQty||0), executed_qty: parseFloat(o.executedQty||0), quote_qty: parseFloat(o.cummulativeQuoteQty||0), status: o.status, time: o.time, update_time: o.updateTime }));
});
reg('GetAllOrdersList', async (symbol) => {
  if (isPepperstone()) return [];
  if (!appState.bc.hasKeys()) throw new Error('API key required');
  const orders = await appState.bc.listOrders(symbol, 50);
  return orders.map(o => ({ order_id: o.orderId, symbol: o.symbol, side: o.side, type: o.type, price: parseFloat(o.price||0), quantity: parseFloat(o.origQty||0), executed_qty: parseFloat(o.executedQty||0), quote_qty: parseFloat(o.cummulativeQuoteQty||0), status: o.status, time: o.time, update_time: o.updateTime }));
});
reg('SaveOrdersCsv', async (symbol) => {
  if (isPepperstone()) throw new Error('not implemented for pepperstone');
  const dir = 'order-csv';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const orders = await appState.bc.listOrders(symbol, 50);
  const filename = `${dir}/${symbol}_orders.csv`;
  const lines = ['order_id,symbol,side,type,price,quantity,executed_qty,quote_qty,status,time'];
  for (const o of orders) {
    lines.push([o.orderId, o.symbol, o.side, o.type, o.price, o.origQty, o.executedQty, o.cummulativeQuoteQty, o.status, o.time].join(','));
  }
  fs.writeFileSync(filename, lines.join('\n'));
  return filename;
});
reg('ListPepperstonePositions', async () => {
  const broker = pepperstoneBroker();
  return broker.listPositions();
});
reg('ClosePepperstonePosition', async (positionID) => {
  const broker = pepperstoneBroker();
  await broker.closePosition(positionID);
  return null;
});
reg('ReconcilePepperstonePositions', async (openTrades) => {
  const broker = pepperstoneBroker();
  const positions = await broker.listPositions();
  const tracked = new Set((openTrades||[]).map(t => (t.position_id||'').trim()).filter(Boolean));
  for (const p of positions) {
    if (tracked.has(p.pos_id)) continue;
    try { await broker.closePosition(p.pos_id); } catch (e) { console.error(e); }
  }
  return positions;
});
reg('PepperstoneBrokerStatus', async () => {
  try {
    const broker = pepperstoneBroker();
    return { initialized: true, exchange: appState.exchange, environment: appState.environment, dir: broker.dir, python: broker.python, script: broker.script, error: '' };
  } catch (e) {
    return { initialized: false, exchange: appState.exchange, environment: appState.environment, dir: '', python: '', script: '', error: e.message };
  }
});
reg('SaveAnalyzedCsv', async (symbol, interval, analyzed) => {
  const dir = 'csv-data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${dir}/${symbol}_${interval}_analyzed.csv`;
  // minimal csv
  const header = ['time','open','high','low','close','volume','currency','macd','macd_signal','macd_hist','rsi','trade'].join(',');
  const lines = [header];
  for (const row of analyzed || []) {
    lines.push([row.time,row.open,row.high,row.low,row.close,row.volume,row.currency,row.macd,row.macd_signal,row.macd_hist,row.rsi,row.trade].join(','));
  }
  fs.writeFileSync(filename, lines.join('\n'));
  return null;
});
reg('GetCsvFiles', async () => {
  const dir = 'csv-data';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir).filter(f => !fs.statSync(path.join(dir, f)).isDirectory());
});
reg('ReadCsvFile', async (filename) => {
  return fs.readFileSync(path.join('csv-data', filename), 'utf8');
});
reg('FetchAIData', async (symbol, lookback) => {
  // port basic: save analyzed csv per timeframe
  if (isPepperstone()) pepperstoneBroker();
  const dataDir = path.resolve('ai-data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const timeframes = [];
  let total = 0;
  const tfs = ['5m','15m','30m','1h','4h','8h','1d','3d','1w','1M'];
  for (const tf of tfs) {
    try {
      const r = await fetchAndAnalyze(symbol, tf, lookback, null);
      const filename = path.join(dataDir, `${symbol}_${tf}.csv`);
      // Save csv with enough columns: replicate go-ish header
      const header = ['time','open','high','low','close','volume','currency','macd','macd_signal','macd_hist','rsi','ema','ema_short','ema_middle','ema_long','ma_short','ma_middle','ma_long','sma_short','sma_long','hma','stochastic_K','stochastic_D','bb_middle','bb_upper','bb_lower','macd_trade','rsi_trade','stochastic_trade','ema_trade','sma_trade','ma_trade','hma_trade','bb_trade'];
      const lines = [header.join(',')];
      for (const row of r.analyzed) {
        lines.push([
          row.time,row.open,row.high,row.low,row.close,row.volume,row.currency,
          row.macd,row.macd_signal,row.macd_hist,row.rsi,row.ema,row.ema_short,row.ema_middle,row.ema_long,
          row.ma_short,row.ma_middle,row.ma_long,row.sma_short,row.sma_long,row.hma,row.stochastic_K,row.stochastic_D,row.bb_middle,row.bb_upper,row.bb_lower,
          row.macd_trade,row.rsi_trade,row.stochastic_trade,row.ema_trade,row.sma_trade,row.ma_trade,row.hma_trade,row.bb_trade
        ].join(','));
      }
      fs.writeFileSync(filename, lines.join('\n'));
      timeframes.push(tf);
      total += r.analyzed.length;
    } catch (e) {
      console.error('fetch tf fail', tf, e.message);
    }
  }
  return { success: true, timeframes, total_rows: total, message: `Saved ${timeframes.length} timeframes, ${total} total rows` };
});
reg('TrainAI', async (configJSON) => {
  let config = {};
  try { config = JSON.parse(configJSON || '{}'); } catch {}
  if (!config.symbol) config.symbol = 'ETHUSDT';
  if (!config.exec_timeframe) config.exec_timeframe = '5m';
  if (!config.data_lookback || config.data_lookback <= 0) config.data_lookback = 500;
  if (!config.future_candles || config.future_candles <= 0) config.future_candles = 12;
  if (!config.buy_threshold || config.buy_threshold <= 0) config.buy_threshold = 0.005;
  if (config.sell_threshold === undefined || config.sell_threshold >= 0) config.sell_threshold = -0.005;
  if (!config.train_split || config.train_split <= 0) config.train_split = 0.7;
  if (!config.n_trees || config.n_trees <= 0) config.n_trees = 200;
  if (!config.max_depth || config.max_depth <= 0) config.max_depth = 12;
  // fetch data
  await H.FetchAIData(config.symbol, config.data_lookback);
  // resolve data dir
  const dataDir = path.resolve('ai-data');
  const runner = { python: 'python3', script: findScript() };
  const req = {
    symbol: config.symbol, data_dir: dataDir, exec_timeframe: config.exec_timeframe,
    future_candles: config.future_candles, buy_threshold: config.buy_threshold,
    sell_threshold: config.sell_threshold, train_split: config.train_split,
    n_trees: config.n_trees, max_depth: config.max_depth, use_mtf: !!config.use_mtf, action: 'train'
  };
  const input = JSON.stringify(req);
  const r = spawnSync(runner.python, [runner.script], { input, encoding: 'utf8', cwd: process.cwd() });
  if (r.status !== 0) throw new Error(r.stderr || 'python failed');
  if (r.stderr) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
});
function findScript() {
  const candidates = [path.join(process.cwd(),'ai','train.py'), path.join(__dirname,'..','..','..','ai','train.py'), path.join(process.cwd(),'..','ai','train.py')];
  // also go project
  candidates.push('/home/bumblebee/apps/bnc/tamir-go/ai/train.py');
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return 'ai/train.py';
}
reg('CheckAIReady', async () => {
  const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  let packages = false;
  try { const r = spawnSync('python3', ['-c','import sklearn, pandas, numpy, json; print("ok")'], { encoding:'utf8' }); packages = r.status === 0; } catch {}
  return { python: py.status === 0, packages };
});
reg('GetAIDataFiles', async () => {
  const dir = path.resolve('ai-data');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.csv'));
});
reg('CreateAISchedule', async (configJSON) => {
  console.log('Would create AI schedule', configJSON);
  return null;
});
// Shared by SetExchangeConfig (browser session) and startup restore: the
// exchange must be known before any scheduled task fetches candles, otherwise
// a Pepperstone task would be sent to Binance (Binance answers -1121
// "Invalid symbol" for FX pairs such as USDJPY).
function applyExchangeConfig(exchange, environment, pepperstoneDir) {
  exchange = (exchange||'').toLowerCase().trim() || 'binance';
  environment = (environment||'').toLowerCase().trim();
  if (exchange !== 'binance' && exchange !== 'pepperstone') throw new Error('exchange must be binance or pepperstone');
  if (!environment) environment = exchange === 'binance' ? 'live' : 'demo';
  if (environment !== 'live' && environment !== 'demo') throw new Error('environment must be live or demo');
  appState.exchange = exchange;
  console.log(`Exchange set to ${exchange} (${environment})`);
  if (exchange === 'binance') { appState.environment = 'live'; appState.ps = null; return null; }
  appState.environment = environment;
  const dir = resolveDir(pepperstoneDir || '');
  appState.ps = new Broker(dir, environment);
  return null;
}
reg('SetExchangeConfig', async (exchange, environment, pepperstoneDir) => {
  return applyExchangeConfig(exchange, environment, pepperstoneDir);
});
reg('GetExchangeConfig', async () => ({ exchange: appState.exchange, environment: appState.environment }));
reg('IsApiConnected', async () => {
  if (isPepperstone()) return appState.ps !== null;
  return appState.bc.hasKeys();
});
reg('TradesList', async (limit) => store.getTrades(limit||100));
reg('TradesOpen', async () => store.getOpenTrades());
reg('TradesOpenByPair', async (period, currency) => store.getOpenTradesByPeriodAndCurrency(period, currency));
reg('TradeInsert', async (t) => store.insertTrade(t));
reg('TradeClose', async (id, sellPrice, profit, difference) => {
  store.updateTradeSell(id, nowISO(), sellPrice, profit, difference);
  return null;
});
reg('TradeSetPosition', async (id, positionID) => { store.setTradePositionId(id, positionID); return null; });
reg('TradeDelete', async (id) => { store.deleteTrade(id); return null; });

// Schedule bindings
reg('ScheduleList', async () => store.getScheduleTasks());
reg('ScheduleSave', async (id, t) => {
  const saved = store.upsertScheduleTask(id, t);
  // sync scheduler
  if (saved > 0) {
    const cur = store.getScheduleTask(saved);
    if (cur && cur.task_status === 'running') {
      stopSchedulerTask(saved);
      startSchedulerTask(cur);
    }
  }
  return saved;
});
reg('ScheduleDelete', async (id) => { stopSchedulerTask(id); store.deleteScheduleTask(id); return null; });
reg('ScheduleLogs', async (taskID, limit) => store.getScheduleLogs(taskID||0, limit||100));
reg('ScheduleLogInsert', async (l) => { store.insertScheduleLog(l); return null; });
reg('StartScheduleTask', async (id) => {
  const t = store.getScheduleTask(id);
  if (!t) throw new Error('schedule not found');
  store.updateTaskStatus(id, 'running');
  startSchedulerTask({ ...t, task_status: 'running' });
  return 'running';
});
reg('StopScheduleTask', async (id) => {
  stopSchedulerTask(id);
  store.updateTaskStatus(id, 'stopped');
  return 'stopped';
});
reg('RunScheduleTaskNow', async (id) => {
  const t = store.getScheduleTask(id);
  if (!t) throw new Error('schedule not found');
  await runExec(id); // runExec reads task
  return null;
});

// Adjustments
reg('AdjustmentsList', async () => store.getAllAdjustments());
reg('AdjustmentGet', async (id) => {
  const rows = store.getAllAdjustments();
  return rows.find(r => r.id === id) || null;
});
reg('AdjustmentsByTable', async (table) => store.getAdjustmentsByTable(table));
reg('AdjustmentGetByName', async (name, table) => store.getAdjustmentByName(name, table));
reg('AdjustmentSave', async (adj) => { store.upsertAdjustment(adj); return null; });
reg('AdjustmentDelete', async (id) => { store.deleteAdjustment(id); return null; });
reg('IndicatorParams', async (table) => store.loadParamsForTable(table));

// Orderables
reg('OrderablesList', async () => store.getOrderables());
reg('OrderableSave', async (o) => { store.upsertOrderable(o); return null; });
reg('OrderableDelete', async (id) => { store.deleteOrderable(id); return null; });
reg('GetOrderables', async () => 'frontend-managed');

// Api keys
reg('ApiKeyGet', async (name) => store.getApiKey(name));
reg('ApiKeySet', async (name, value) => { store.setApiKey(name, value); return null; });

// Stats (stub empty)
reg('TradeTaskStats', async (filter) => []);
reg('TradeDailyStats', async (filter) => []);
reg('TradeHourlyStats', async (filter) => []);
reg('TradeFilterOptions', async () => ({ tasks: [], currencies: [] }));
reg('TradesFiltered', async (filter, limit) => store.getTrades(limit||100));
reg('TradeDelete', async (id) => { store.deleteTrade(id); return null; });

// Evaluate open trends
reg('EvaluateOpenTrends', async () => {
  const trades = store.getOpenTrades();
  const tasks = store.getScheduleTasks();
  const cache = new Map();
  const out = [];
  for (const tr of trades) {
    const ev = { trade_id: tr.id, finished: false, note: '', task_id: 0, task_name: '', analyzed_table: '', buy_at: 0, sell_at: 0, mark: null };
    // match task
    const named = tasks.filter(t => t.task_name === tr.tactic_name);
    let task = null;
    if (named.length === 1) task = named[0];
    else if (named.length > 1 && tr.period) {
      const hits = named.filter(t => periodFromTable(t.analyzed_table_name) === tr.period);
      if (hits.length === 1) task = hits[0];
    }
    if (!task) { ev.note = 'no matching task'; out.push(ev); continue; }
    ev.task_id = task.id; ev.task_name = task.task_name; ev.analyzed_table = task.analyzed_table_name;
    const ownDir = (tr.side||'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    const buyCrit = parseCriteria(task.buy_criteria);
    const sellCrit = parseCriteria(task.sell_criteria);
    const oppCrit = ownDir === 'buy' ? sellCrit : buyCrit;
    if (!hasCriteria(oppCrit)) { ev.note = 'no opposite criteria'; out.push(ev); continue; }
    const key = tr.currency + '|' + task.analyzed_table_name;
    let rows = cache.get(key);
    if (rows === undefined) {
      try {
        const params = store.loadParamsForTable(task.analyzed_table_name);
        const r = await fetchAndAnalyze(tr.currency, periodFromTable(task.analyzed_table_name), 500, params);
        rows = r.analyzed;
      } catch { rows = []; }
      cache.set(key, rows);
    }
    if (!rows || rows.length === 0) { ev.note = 'no candle data'; out.push(ev); continue; }
    const { buyAt, sellAt } = trendDirection(rows, buyCrit, sellCrit);
    ev.buy_at = buyAt; ev.sell_at = sellAt;
    ev.mark = rows[rows.length - 1].close;
    let ownAt = ownDir === 'buy' ? buyAt : sellAt;
    let oppAt = ownDir === 'buy' ? sellAt : buyAt;
    const d = parseBuyDate(tr.buy_date);
    const entryAt = d ? d.getTime()/1000 : 0;
    if (oppAt > 0 && oppAt >= entryAt && oppAt > ownAt) {
      ev.finished = true;
      ev.note = ownDir === 'buy' ? 'sell signal' : 'buy signal';
    } else {
      ev.note = 'trend still running';
    }
    out.push(ev);
  }
  return out;
});

// SimulateStrategy
reg('SimulateStrategy', async (rows, buyCrit, sellCrit) => {
  buyCrit = buyCrit || {};
  sellCrit = sellCrit || {};
  const res = { points: [], trades: [], balance: 100 };
  if (!rows || rows.length === 0) return res;
  const maps = rows.map(r => r);
  let inPos = false, buyPrice = 0;
  const simDate = (unixSec) => new Date(unixSec * 1000).toISOString().replace('T',' ').slice(0,19);
  function check(crit, i, direction) {
    // port simCheckCriteria
    const row = maps[i];
    for (const c of ['macd_trade','rsi_trade','stochastic_trade','ema_trade','sma_trade','ma_trade','hma_trade']) {
      const want = crit[c];
      if (!want) continue;
      if (String(row[c] || '').toLowerCase() !== String(want).toLowerCase()) return false;
    }
    const lvl = parseFloat(crit.rsi_level);
    if (!isNaN(lvl) && lvl > 0) {
      const rsi = parseFloat(row.rsi);
      if (isNaN(rsi)) return false;
      if (direction === 'buy' && rsi >= lvl) return false;
      if (direction === 'sell' && rsi <= lvl) return false;
    }
    // slopes omitted for brevity
    const maA = crit.ma_comp_a, maB = crit.ma_comp_b;
    if (maA && maB) {
      const va = parseFloat(row[maA]), vb = parseFloat(row[maB]);
      if (isNaN(va) || isNaN(vb)) return false;
      if (direction === 'buy' && !(va > vb)) return false;
      if (direction === 'sell' && !(va < vb)) return false;
    }
    return true;
  }
  for (let i = 0; i < rows.length; i++) {
    const date = simDate(rows[i].time);
    if (!inPos) {
      if (check(buyCrit, i, 'buy')) {
        inPos = true; buyPrice = rows[i].close;
        res.points.push({ x: date, y: rows[i].low, type: 'buy' });
      }
      continue;
    }
    if (check(sellCrit, i, 'sell')) {
      inPos = false;
      const profitPct = ((rows[i].close - buyPrice) / buyPrice) * 100;
      res.trades.push({ buyPrice, sellPrice: rows[i].close, profitPct, profitUsdt: profitPct });
      res.points.push({ x: date, y: rows[i].high, type: 'sell' });
    }
  }
  if (inPos) {
    const last = rows[rows.length - 1];
    const profitPct = ((last.close - buyPrice) / buyPrice) * 100;
    res.trades.push({ buyPrice, sellPrice: last.close, profitPct, profitUsdt: profitPct });
  }
  res.balance = 100;
  for (const t of res.trades) res.balance += t.profitUsdt;
  return res;
});

// Db debug
reg('DbTables', async () => store.tableNames());
reg('DbQuery', async (q) => store.rawQuery(q));
reg('StoreIsEmpty', async () => store.isEmpty());
reg('ImportStoreSnapshot', async (data) => {
  const snap = typeof data === 'string' ? JSON.parse(data) : data;
  // simple import not implemented fully; return
  return null;
});

// Auto scheduler on startup
function startAutoScheduler() {
  try {
    // The persisted exchange must be restored before any running task fires:
    // without it appState defaults to binance and a Pepperstone task fails its
    // first fetch with "Invalid symbol" (the frontend only re-applies its
    // settings when a page loads, long after these timers started).
    const ex = store.getApiKey('exchange');
    const env = store.getApiKey('trading_environment');
    const dir = store.getApiKey('pepperstone_dir');
    if (ex) {
      applyExchangeConfig(ex, env, dir);
      console.log(`Restored exchange config: ${ex} (${env || 'default'})`);
    }
  } catch (e) { console.error('Restoring exchange config failed:', e); }
  try {
    const tasks = store.getScheduleTasks();
    for (const t of tasks) if (t.task_status === 'running') startSchedulerTask(t);
  } catch (e) { console.error(e); }
}
startAutoScheduler();

// HTTP
app.post('/api/rpc', async (req, res) => {
  const { method, args = [] } = req.body || {};
  if (!H[method]) { res.status(404).json({ error: 'unknown method ' + method }); return; }
  try {
    const result = await H[method](...args);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Serve frontend static
const distPath = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tamir Node.js fullstack running on http://localhost:${PORT}`));
