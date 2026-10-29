export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnalyzedRow {
  time: string;
  open: number; high: number; low: number; close: number; volume: number;
  currency: string;
  macd: number; macd_signal: number; macd_hist: number;
  rsi: number;
  ema: number; ema_short: number; ema_middle: number; ema_long: number;
  ma_short: number; ma_middle: number; ma_long: number;
  hma: number;
  bb_middle: number; bb_upper: number; bb_lower: number;
  bb_upper_75: number; bb_lower_25: number;
  macd_trade: string; rsi_trade: string;
  stochastic_trade: string; ema_trade: string;
  sma_trade: string; ma_trade: string; hma_trade: string; bb_trade: string;
  trade: string;
}

export interface AnalysisResult {
  candles: Candle[];
  analyzed: AnalyzedRow[];
  table_name: string;
}

export interface AccountBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface OrderResult {
  order_id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  status: string;
}

export interface PositionSize {
  balance_portion: number;
  apt: number;
  quantity: number;
  current_price: number;
}

export interface AIConfig {
  symbol: string;
  exec_timeframe: string;
  data_lookback: number;
  future_candles: number;
  buy_threshold: number;
  sell_threshold: number;
  train_split: number;
  n_trees: number;
  max_depth: number;
  use_mtf: boolean;
}

export interface FeatureImportance {
  name: string;
  score: number;
}

export interface AITrainResult {
  config: AIConfig;
  model_accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  feature_importance: FeatureImportance[];
  class_balance: Record<string, number>;
  total_samples: number;
  error?: string;
}

export interface BacktestTrade {
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  action: string;
  return_pct: number;
  duration: number;
}

export interface EquityPoint {
  time: string;
  equity: number;
}

export interface AIBacktestResult {
  total_trades: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  total_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  final_balance: number;
  trades: BacktestTrade[];
  equity_curve: EquityPoint[];
  confusion_matrix: number[];
  error?: string;
}

export interface AIResult {
  train: AITrainResult | null;
  backtest: AIBacktestResult | null;
  error?: string;
}

export interface AIFetchDataResult {
  success: boolean;
  message: string;
  timeframes: string[];
  total_rows: number;
}
