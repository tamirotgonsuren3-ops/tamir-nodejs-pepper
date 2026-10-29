// The analyzed-candle cache that used to live in the browser PGlite database is
// gone: analysis now runs in Go on demand for every fetch. This module keeps the
// row shape and the table-name helper the components still share.
export interface AnalyzedRow {
  time: string;
  open: number; high: number; low: number; close: number; volume: number;
  currency: string;
  macd: number; macd_signal: number; macd_hist: number;
  rsi: number; rsi_short: number; rsi_middle: number; rsi_long: number;
  ema: number; ema_short: number; ema_middle: number; ema_long: number;
  ma_short: number; ma_middle: number; ma_long: number;
  sma_short: number; sma_long: number;
  hma: number;
  stochastic_k: number; stochastic_d: number;
  bb_middle: number; bb_upper: number; bb_lower: number;
  bb_upper_75: number; bb_lower_25: number;
  bb_sell_crossover: number; bb_buy_crossover: number;
  bb_trend: string; bb_signal: string; bb_trade: string;
  near_bb_support: number; near_bb_resistance: number;
  macd_trade: string; rsi_trade: string; stochastic_trade: string;
  channel_trade: string;   ema_trade: string; sma_trade: string; ma_trade: string; hma_trade: string;
  trade: string; last4candle_trend: string;
  bullish_crossover: string; bearish_crossover: string;
  is_Bottom: string; is_Peak: string;
  up_trend_before_Peak: string; down_trend_before_Bottom: string;
  buy_on_Bottom: string; sell_on_Peak: string;
  sma_short_uptrend: string; sma_short_downtrend: string;
  sma_long_uptrend: string; sma_long_downtrend: string;
}

export function tableForInterval(interval: string): string {
  if (interval === '1M') return 'analyzed_months';
  return `analyzed${interval}s`;
}
