export const TIMEFRAMES = [
  '1ms', '5ms', '15ms', '30ms',
  '1hs', '4hs', '8hs',
  '1ds', '3ds', '1ws',
] as const;

export const TABLE_NAMES = [
  'analyzed1ms', 'analyzed5ms', 'analyzed15ms', 'analyzed30ms',
  'analyzed1hs', 'analyzed4hs', 'analyzed8hs',
  'analyzed1ds', 'analyzed3ds', 'analyzed1ws',
  'analyzed_months',
  'orderables', 'trades', 'api_keys',
] as const;

export const ANALYZED_COLUMNS = `
  time TEXT PRIMARY KEY,
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  currency TEXT,
  macd REAL, macd_signal REAL, macd_hist REAL,
  rsi REAL, rsi_short REAL, rsi_middle REAL, rsi_long REAL,
  ema REAL, ema_short REAL, ema_middle REAL, ema_long REAL,
  ma_short REAL, ma_middle REAL, ma_long REAL,
  sma_short REAL, sma_long REAL,
  hma REAL,
  hma_trade TEXT,
  stochastic_K REAL, stochastic_D REAL,
  bb_middle REAL, bb_upper REAL, bb_lower REAL,
  bb_upper_75 REAL, bb_lower_25 REAL,
  bb_sell_crossover REAL, bb_buy_crossover REAL,
  bb_trend TEXT, bb_signal TEXT, bb_trade TEXT,
  near_bb_support REAL, near_bb_resistance REAL,
  macd_trade TEXT, rsi_trade TEXT, stochastic_trade TEXT,
  channel_trade TEXT, ema_trade TEXT, sma_trade TEXT, ma_trade TEXT,
  trade TEXT, last4candle_trend TEXT,
  bullish_crossover TEXT, bearish_crossover TEXT,
  is_Bottom TEXT, is_Peak TEXT,
  up_trend_before_Peak TEXT, down_trend_before_Bottom TEXT,
  buy_on_Bottom TEXT, sell_on_Peak TEXT,
  sma_short_uptrend TEXT, sma_short_downtrend TEXT,
  sma_long_uptrend TEXT, sma_long_downtrend TEXT
`.trim();

export function generateAnalyzedTable(name: string): string {
  return `CREATE TABLE IF NOT EXISTS ${name} (${ANALYZED_COLUMNS});`;
}

const ANALYZED_TABLE_NAMES = ['analyzed1ms','analyzed5ms','analyzed15ms','analyzed30ms',
  'analyzed1hs','analyzed4hs','analyzed8hs',
  'analyzed1ds','analyzed3ds','analyzed1ws',
  'analyzed_months'];

export const CREATE_TABLE_SQL = `
${ANALYZED_TABLE_NAMES.map(generateAnalyzedTable).join('\n')}

CREATE TABLE IF NOT EXISTS orderables (
  id SERIAL PRIMARY KEY,
  allowed_trades INTEGER NOT NULL DEFAULT 5,
  orderable_trades INTEGER NOT NULL DEFAULT 5,
  unfinished_trades INTEGER NOT NULL DEFAULT 0,
  dates TEXT,
  currency TEXT NOT NULL DEFAULT 'ETHUSDT',
  period TEXT NOT NULL DEFAULT '1h',
  balance_percentage REAL NOT NULL DEFAULT 0.2,
  tactic TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  buy_date TEXT,
  sell_date TEXT,
  amount REAL,
  currency TEXT,
  buy_price REAL,
  sell_price REAL,
  sell_if REAL,
  period TEXT,
  tactic_name TEXT,
  usdt REAL,
  difference REAL,
  profit REAL,
  side TEXT NOT NULL DEFAULT 'buy',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_name TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule (
  id SERIAL PRIMARY KEY,
  task_name TEXT NOT NULL DEFAULT '',
  interval INTEGER NOT NULL DEFAULT 5,
  analyzed_table_name TEXT NOT NULL DEFAULT '',
  buy_criteria TEXT NOT NULL DEFAULT '{}',
  sell_criteria TEXT NOT NULL DEFAULT '{}',
  currency TEXT NOT NULL DEFAULT 'ETHUSDT',
  trade_balance_percentage REAL NOT NULL DEFAULT 10,
  balance_type TEXT NOT NULL DEFAULT 'percentage',
  sell_if_greater_than REAL NOT NULL DEFAULT 0.5,
  max_open_trades INTEGER NOT NULL DEFAULT 1,
  task_status TEXT NOT NULL DEFAULT 'stopped',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule_logs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  task_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  interval TEXT NOT NULL DEFAULT '',
  analyzed_table TEXT NOT NULL DEFAULT '',
  balance TEXT NOT NULL DEFAULT '',
  criteria_info TEXT NOT NULL DEFAULT '',
  indicators TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS indicator_adjustments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  analyzed_table TEXT NOT NULL DEFAULT '',
  params TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`.trim();

export const MIGRATION_SQL = `
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS buy_criteria TEXT NOT NULL DEFAULT '{}';
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS sell_criteria TEXT NOT NULL DEFAULT '{}';
ALTER TABLE schedule_logs ADD COLUMN IF NOT EXISTS interval TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_logs ADD COLUMN IF NOT EXISTS analyzed_table TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_logs ADD COLUMN IF NOT EXISTS balance TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_logs ADD COLUMN IF NOT EXISTS criteria_info TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS balance_type TEXT NOT NULL DEFAULT 'percentage';
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS max_open_trades INTEGER NOT NULL DEFAULT 1;
ALTER TABLE schedule_logs ADD COLUMN IF NOT EXISTS indicators TEXT NOT NULL DEFAULT '';
ALTER TABLE schedule_logs ADD COLUMN IF NOT EXISTS trade_amount TEXT NOT NULL DEFAULT '';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS side TEXT NOT NULL DEFAULT 'buy';
-- Broker position id for Pepperstone trades. Reversals close this exact
-- position, so a row without one cannot be closed reliably.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS position_id TEXT NOT NULL DEFAULT '';
`.trim();
