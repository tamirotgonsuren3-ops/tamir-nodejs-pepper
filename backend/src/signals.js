export function evalMACDTrade(curr, prev) {
  if (curr.macd > curr.macd_signal && prev.macd <= prev.macd_signal && curr.macd_hist > 0) return 'buy';
  if (curr.macd < curr.macd_signal && prev.macd >= prev.macd_signal && curr.macd_hist < 0) return 'sell';
  return 'hold';
}
export function evalStochasticTrade(curr, prev) {
  const up = curr.stochastic_K > curr.stochastic_D && prev.stochastic_K <= prev.stochastic_D;
  const down = curr.stochastic_K < curr.stochastic_D && prev.stochastic_K >= prev.stochastic_D;
  if (up && curr.stochastic_K < 80) return 'buy';
  if (down && curr.stochastic_K > 66) return 'sell';
  return 'hold';
}
export function evalRSITrade(curr, prev) {
  if (curr.rsi_middle < 67 && curr.rsi_middle > prev.rsi_middle && prev.rsi_middle < 0) return 'buy';
  if (curr.rsi_middle > 50 && curr.rsi_middle < prev.rsi_middle) return 'sell';
  return 'hold';
}
export function evalSMATrade(t) {
  if (t.is_Bottom === '1' && t.down_trend_before_Bottom === '1' && t.sma_long > t.close && t.ema > t.close) return 'buy';
  if (t.is_Peak === '1' && t.up_trend_before_Peak === '1' && t.sma_long < t.close && t.ema < t.close) return 'sell';
  return 'hold';
}
export function evalEMATrade(curr, prev) {
  if (curr.ema_short > curr.ema_long && prev.ema_short < prev.ema_long) return 'buy';
  if (curr.ema_short < curr.ema_long && prev.ema_short > prev.ema_long) return 'sell';
  return 'hold';
}
export function evalMATrade(curr, prev) {
  if (curr.ma_short > curr.ma_middle && prev.ma_short < prev.ma_middle && curr.rsi_middle < 40) return 'buy';
  if (curr.ma_short < curr.ma_middle && prev.ma_short > prev.ma_middle && curr.rsi_middle > 60) return 'sell';
  return 'hold';
}
export function evalHMATrade(curr, prev) {
  if (curr.close > curr.hma && prev.close <= prev.hma) return 'buy';
  if (curr.close < curr.hma && prev.close >= prev.hma) return 'sell';
  return 'hold';
}
export function evalBBTrade(curr, prev) {
  if (curr.bb_sell_crossover > 0 && !(prev.bb_sell_crossover > 0)) return 'sell';
  if (curr.bb_buy_crossover > 0 && !(prev.bb_buy_crossover > 0)) return 'buy';
  return 'hold';
}