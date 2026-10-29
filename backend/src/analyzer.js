export function SMA(values, window) {
  if (!values || values.length === 0 || window <= 0) return null;
  const n = values.length;
  const res = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) res[i] = sum / window;
    else res[i] = 0;
  }
  return res;
}
export function EMA(values, span) {
  if (!values || values.length === 0 || span <= 0) return null;
  const n = values.length;
  const res = new Array(n).fill(0);
  const k = 2 / (span + 1);
  res[0] = values[0];
  for (let i = 1; i < n; i++) res[i] = values[i] * k + res[i - 1] * (1 - k);
  return res;
}
export function WMA(values, window) {
  if (!values || values.length === 0 || window <= 0) return null;
  const n = values.length;
  const res = new Array(n).fill(0);
  const weightSum = window * (window + 1) / 2;
  for (let i = 0; i < n; i++) {
    if (i < window - 1) { res[i] = 0; continue; }
    let sum = 0;
    for (let j = 0; j < window; j++) sum += values[i - j] * (window - j);
    res[i] = sum / weightSum;
  }
  return res;
}
export function HMA(values, window) {
  if (!values || values.length === 0 || window <= 0) return null;
  let half = Math.floor(window / 2); if (half < 1) half = 1;
  let sqrtW = Math.floor(Math.sqrt(window)); if (sqrtW < 1) sqrtW = 1;
  const wmaHalf = WMA(values, half);
  const wmaFull = WMA(values, window);
  const raw = values.map((_, i) => 2 * wmaHalf[i] - wmaFull[i]);
  return WMA(raw, sqrtW);
}
export function RSI(prices, window) {
  const n = prices.length;
  const res = new Array(n).fill(0);
  if (n < window + 1) return res;
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains[i] = diff; else losses[i] = -diff;
  }
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= window; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
  avgGain /= window; avgLoss /= window;
  for (let i = window; i < n; i++) {
    if (avgLoss === 0) res[i] = 100;
    else { const rs = avgGain / avgLoss; res[i] = 100 - (100 / (1 + rs)); }
    if (i === n - 1) break;
    avgGain = (avgGain * (window - 1) + gains[i + 1]) / window;
    avgLoss = (avgLoss * (window - 1) + losses[i + 1]) / window;
  }
  return res;
}
export function MACD(prices, fast, slow, signal) {
  const emaFast = EMA(prices, fast);
  const emaSlow = EMA(prices, slow);
  const macdLine = prices.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = EMA(macdLine, signal);
  const hist = prices.map((_, i) => macdLine[i] - signalLine[i]);
  return { MACD: macdLine, Signal: signalLine, Histogram: hist };
}
export function BBand(prices, window, numStd) {
  const n = prices.length;
  const middle = SMA(prices, window);
  const upper = new Array(n).fill(0), lower = new Array(n).fill(0);
  const upper75 = new Array(n).fill(0), lower25 = new Array(n).fill(0);
  const sellCross = new Array(n).fill(0), buyCross = new Array(n).fill(0);
  for (let i = window - 1; i < n; i++) {
    let sumSq = 0;
    for (let j = i - window + 1; j <= i; j++) { const diff = prices[j] - middle[i]; sumSq += diff * diff; }
    const std = Math.sqrt(sumSq / window);
    upper[i] = middle[i] + std * numStd;
    lower[i] = middle[i] - std * numStd;
    upper75[i] = middle[i] + (upper[i] - middle[i]) * 0.80;
    lower25[i] = middle[i] - (middle[i] - lower[i]) * 0.40;
  }
  for (let i = 1; i < n; i++) {
    if (prices[i] < upper75[i] && prices[i - 1] > upper75[i - 1]) sellCross[i] = prices[i];
    if (prices[i] > lower25[i] && prices[i - 1] < lower25[i - 1]) buyCross[i] = prices[i];
  }
  return { Middle: middle, Upper: upper, Lower: lower, Upper75: upper75, Lower25: lower25, SellCross: sellCross, BuyCross: buyCross };
}
export function StochasticRSI(prices, lengthRSI, lengthStoch, smoothK, smoothD) {
  const rsiValues = RSI(prices, lengthRSI);
  const n = rsiValues.length;
  const kRaw = new Array(n).fill(50);
  if (n >= lengthStoch) {
    for (let i = lengthStoch - 1; i < n; i++) {
      let minR = rsiValues[i], maxR = rsiValues[i];
      for (let j = i - lengthStoch + 1; j <= i; j++) { if (rsiValues[j] < minR) minR = rsiValues[j]; if (rsiValues[j] > maxR) maxR = rsiValues[j]; }
      const denom = maxR - minR;
      kRaw[i] = denom !== 0 ? 100 * (rsiValues[i] - minR) / denom : 50;
    }
  }
  const k = SMA(kRaw, smoothK);
  const d = SMA(k, smoothD);
  return { K: k, D: d };
}
export function DetectPeakBottom(high, low, close, smaShort, smaLong, ema, rsi, windowSize) {
  const n = high.length;
  const IsPeak = new Array(n).fill(false);
  const IsBottom = new Array(n).fill(false);
  const UpTrendBeforePeak = new Array(n).fill(false);
  const DownTrendBeforeBot = new Array(n).fill(false);
  const BuyOnBottom = new Array(n).fill(false);
  const SellOnPeak = new Array(n).fill(false);
  const BullishCross = new Array(n).fill(false);
  const BearishCross = new Array(n).fill(false);
  const SMAShortUptrend = new Array(n).fill(false);
  const SMAShortDowntrend = new Array(n).fill(false);
  const SMALongUptrend = new Array(n).fill(false);
  const SMALongDowntrend = new Array(n).fill(false);

  for (let i = windowSize; i < n; i++) {
    let isPeak = true;
    for (let j = i - windowSize + 1; j <= i; j++) if (high[j] > high[i]) { isPeak = false; break; }
    IsPeak[i] = isPeak;
    let isBottom = true;
    for (let j = i - windowSize + 1; j <= i; j++) if (low[j] < low[i]) { isBottom = false; break; }
    IsBottom[i] = isBottom;
  }
  for (let i = windowSize; i < n; i++) {
    let diffSum = 0;
    for (let j = i - windowSize + 1; j <= i; j++) diffSum += close[j] - close[j - 1];
    const avgDiff = diffSum / windowSize;
    UpTrendBeforePeak[i] = avgDiff > 0.5;
    DownTrendBeforeBot[i] = avgDiff < -0.5;
  }
  for (let i = 1; i < n; i++) {
    if (close[i] > smaLong[i] && smaShort[i] > smaLong[i] && smaShort[i - 1] < smaLong[i - 1]) BullishCross[i] = true;
    if (close[i] < smaLong[i] && smaShort[i] < smaLong[i] && smaShort[i - 1] > smaLong[i - 1]) BearishCross[i] = true;
  }
  for (let i = 2; i < n; i++) {
    if (i < rsi.length) {
      if (rsi[i] < 40 && i < high.length - 1 && high[i] <= ema[i] && high[i] + 20 >= ema[i] && close[i] >= smaLong[i]) BuyOnBottom[i] = true;
      if (rsi[i] > 60 && close[i] >= smaLong[i] && close[i - 1] > smaLong[i - 1] && low[i] + 20 <= smaLong[i]) SellOnPeak[i] = true;
    }
    SMAShortUptrend[i] = smaShort[i] > smaShort[i - 1] && smaShort[i - 1] > smaShort[i - 2];
    SMAShortDowntrend[i] = smaShort[i] < smaShort[i - 1] && smaShort[i - 1] < smaShort[i - 2];
    SMALongUptrend[i] = smaLong[i] > smaLong[i - 1] && smaLong[i - 1] > smaLong[i - 2];
    SMALongDowntrend[i] = smaLong[i] < smaLong[i - 1] && smaLong[i - 1] < smaLong[i - 2];
  }
  return { IsPeak, IsBottom, UpTrendBeforePeak, DownTrendBeforeBot, BuyOnBottom, SellOnPeak, BullishCross, BearishCross, SMAShortUptrend, SMAShortDowntrend, SMALongUptrend, SMALongDowntrend };
}