import crypto from 'node:crypto';

export class BinanceClient {
  constructor(apiKey = '', secretKey = '') {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://api.binance.com';
  }
  hasKeys() { return !!this.apiKey && !!this.secretKey; }

  sign(params) {
    const qs = new URLSearchParams(params).toString();
    const signature = crypto.createHmac('sha256', this.secretKey).update(qs).digest('hex');
    return qs + '&signature=' + signature;
  }

  async _get(path, params = {}, signed = false) {
    let url = this.baseUrl + path;
    if (signed) {
      params.timestamp = Date.now();
      const qs = this.sign(params);
      url += '?' + qs;
    } else if (Object.keys(params).length) {
      url += '?' + new URLSearchParams(params).toString();
    }
    const headers = this.hasKeys() ? { 'X-MBX-APIKEY': this.apiKey } : {};
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async _post(path, params = {}, signed = true) {
    params.timestamp = Date.now();
    const qs = this.sign(params);
    const url = this.baseUrl + path + '?' + qs;
    const r = await fetch(url, { method: 'POST', headers: { 'X-MBX-APIKEY': this.apiKey } });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async fetchKlines(symbol, interval, limit = 500) {
    const data = await this._get('/api/v3/klines', { symbol, interval, limit });
    return data.map(k => ({
      OpenTime: new Date(k[0]),
      Open: parseFloat(k[1]),
      High: parseFloat(k[2]),
      Low: parseFloat(k[3]),
      Close: parseFloat(k[4]),
      Volume: parseFloat(k[5]),
      CloseTime: new Date(k[6]),
      QuoteVolume: parseFloat(k[7]),
      TradeCount: k[8],
      TakerBuyBaseVol: parseFloat(k[9]),
      TakerBuyQuoteVol: parseFloat(k[10])
    }));
  }

  async getSymbolPrice(symbol) {
    const data = await this._get('/api/v3/ticker/price', { symbol });
    return parseFloat(data.price);
  }
  async getAllBalances() {
    const data = await this._get('/api/v3/account', {}, true);
    const out = [];
    for (const b of data.balances) {
      const free = parseFloat(b.free); const locked = parseFloat(b.locked);
      if (free > 0 || locked > 0) out.push({ asset: b.asset, free, locked });
    }
    return out;
  }
  async getBalance(asset) {
    const data = await this._get('/api/v3/account', {}, true);
    const b = data.balances.find(x => x.asset === asset);
    return b ? parseFloat(b.free) : 0;
  }
  async getSymbolPrecision(symbol) {
    const data = await this._get('/api/v3/exchangeInfo', { symbol });
    if (!data.symbols || !data.symbols.length) return { lotStepSize: '', priceTickSize: '' };
    const sym = data.symbols[0];
    let lot = '', tick = '';
    for (const f of sym.filters) {
      if (f.filterType === 'LOT_SIZE') lot = f.stepSize;
      if (f.filterType === 'PRICE_FILTER') tick = f.tickSize;
    }
    return { lotStepSize: lot, priceTickSize: tick };
  }
  async createMarketBuyQuantity(symbol, quantity) { return this._post('/api/v3/order', { symbol, side: 'BUY', type: 'MARKET', quantity }); }
  async createMarketSellQuantity(symbol, quantity) { return this._post('/api/v3/order', { symbol, side: 'SELL', type: 'MARKET', quantity }); }
  async createMarketBuyQuote(symbol, quoteQty) { return this._post('/api/v3/order', { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: quoteQty }); }
  async createLimitOrder(symbol, side, quantity, price) { return this._post('/api/v3/order', { symbol, side: side.toUpperCase(), type: 'LIMIT', timeInForce: 'GTC', quantity, price }); }
  async listOpenOrders(symbol) { return this._get('/api/v3/openOrders', symbol ? { symbol } : {}, true); }
  async listOrders(symbol, limit = 50) { return this._get('/api/v3/allOrders', { symbol, limit }, true); }
}

export function FormatQuantity(qty, stepSize) {
  const prec = decimalsFromStep(stepSize);
  let step = parseFloat(stepSize);
  if (step > 0) qty = Math.floor(qty / step) * step;
  return qty.toFixed(prec < 0 ? 8 : prec);
}
export function FormatPrice(price, tickSize) {
  const prec = decimalsFromStep(tickSize);
  let step = parseFloat(tickSize);
  if (step > 0) price = Math.floor(price / step) * step;
  return price.toFixed(prec < 0 ? 8 : prec);
}
function decimalsFromStep(step) {
  if (!step) return -1;
  const idx = step.indexOf('.');
  if (idx < 0) return 0;
  const frac = step.slice(idx + 1).replace(/0+$/, '');
  return frac.length;
}

export function modelsOrderFromBinance(o) {
  return {
    order_id: o.orderId,
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    price: parseFloat(o.price || 0),
    quantity: parseFloat(o.origQty || 0),
    executed_qty: parseFloat(o.executedQty || 0),
    quote_qty: parseFloat(o.cummulativeQuoteQty || 0),
    status: o.status,
    time: o.time,
    update_time: o.updateTime
  };
}