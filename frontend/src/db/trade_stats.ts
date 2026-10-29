// Statistics are aggregated in Go over the stored trades; this module is a thin
// transport wrapper. `rollUpTotals` stays here because it is pure display maths
// over already-computed rows.
import {
  TradeTaskStats,
  TradeDailyStats,
  TradeHourlyStats,
  TradeFilterOptions,
  TradesFiltered,
} from '../../wailsjs/go/main/App';
import type { store } from '../../wailsjs/go/models';
import { tradeFromGo, type Trade } from './trades';

export interface StatsFilter {
  taskName?: string;
  currency?: string;
  /** YYYY-MM-DD, inclusive, matched against the entry date (UTC) */
  from?: string;
  /** YYYY-MM-DD, inclusive, matched against the entry date (UTC) */
  to?: string;
}

function toGoFilter(f: StatsFilter): store.Filter {
  return {
    taskName: f.taskName ?? '',
    currency: f.currency ?? '',
    from: f.from ?? '',
    to: f.to ?? '',
  } as unknown as store.Filter;
}

// Column semantics as written by the Go engine:
//   profit    = percentage return, already signed for the direction
//   difference = absolute P&L in quote currency (USDT) / price-points (forex lots)
//   usdt      = notional (Binance) or lots (Pepperstone)
//   side      = 'sell' means SHORT entry, anything else is LONG
//
// buy_date and sell_date are both stored as UTC ISO-8601 text, so day/hour
// bucketing is a plain substring in Go.

export interface TaskStats {
  task_name: string;
  currency: string;
  period: string;
  pairs_traded: number;
  total_trades: number;
  open_trades: number;
  closed_trades: number;
  long_trades: number;
  short_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_profit_pct: number | null;
  best_profit_pct: number | null;
  worst_profit_pct: number | null;
  total_amount: number;
  avg_amount: number | null;
  total_qty: number;
  first_trade: string | null;
  last_trade: string | null;
  avg_hold_minutes: number | null;
}

function toTaskStats(r: store.TaskStats): TaskStats {
  return {
    task_name: r.task_name ?? '',
    currency: r.currency ?? '',
    period: r.period ?? '',
    pairs_traded: r.pairs_traded ?? 0,
    total_trades: r.total_trades ?? 0,
    open_trades: r.open_trades ?? 0,
    closed_trades: r.closed_trades ?? 0,
    long_trades: r.long_trades ?? 0,
    short_trades: r.short_trades ?? 0,
    wins: r.wins ?? 0,
    losses: r.losses ?? 0,
    win_rate: r.win_rate ?? 0,
    total_pnl: r.total_pnl ?? 0,
    avg_profit_pct: r.avg_profit_pct ?? null,
    best_profit_pct: r.best_profit_pct ?? null,
    worst_profit_pct: r.worst_profit_pct ?? null,
    total_amount: r.total_amount ?? 0,
    avg_amount: r.avg_amount ?? null,
    total_qty: r.total_qty ?? 0,
    first_trade: r.first_trade ?? null,
    last_trade: r.last_trade ?? null,
    avg_hold_minutes: r.avg_hold_minutes ?? null,
  };
}

export async function getTaskStats(filter: StatsFilter = {}): Promise<TaskStats[]> {
  return (await TradeTaskStats(toGoFilter(filter))).map(toTaskStats);
}

export interface DayStats {
  day: string;
  trades: number;
  open_trades: number;
  closed_trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

export async function getDailyStats(filter: StatsFilter = {}): Promise<DayStats[]> {
  return (await TradeDailyStats(toGoFilter(filter))).map((r) => ({
    day: r.day ?? '',
    trades: r.trades ?? 0,
    open_trades: r.open_trades ?? 0,
    closed_trades: r.closed_trades ?? 0,
    wins: r.wins ?? 0,
    losses: r.losses ?? 0,
    pnl: r.pnl ?? 0,
  }));
}

export interface HourStats {
  hour: string;
  trades: number;
  wins: number;
  pnl: number;
}

/** Entry-time distribution across the 24 UTC hours (Go fills the gaps). */
export async function getHourlyStats(filter: StatsFilter = {}): Promise<HourStats[]> {
  return (await TradeHourlyStats(toGoFilter(filter))).map((r) => ({
    hour: r.hour ?? '',
    trades: r.trades ?? 0,
    wins: r.wins ?? 0,
    pnl: r.pnl ?? 0,
  }));
}

export interface FilterOptions {
  tasks: string[];
  currencies: string[];
}

/** The raw trades behind the filtered scope, oldest first. */
export async function getFilteredTrades(filter: StatsFilter = {}, limit = 2000): Promise<Trade[]> {
  return (await TradesFiltered(toGoFilter(filter), limit)).map(tradeFromGo);
}

/** Union of configured tasks and pairs that actually have trades. */
export async function getStatsFilterOptions(): Promise<FilterOptions> {
  const r = await TradeFilterOptions();
  return {
    tasks: r.tasks ?? [],
    currencies: r.currencies ?? [],
  };
}

export interface StatsTotals {
  total_trades: number;
  open_trades: number;
  closed_trades: number;
  long_trades: number;
  short_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_profit_pct: number | null;
  best_profit_pct: number | null;
  worst_profit_pct: number | null;
  total_amount: number;
  avg_amount: number | null;
  total_qty: number;
  first_trade: string | null;
  last_trade: string | null;
  avg_hold_minutes: number | null;
  task_count: number;
}

/** Roll the per-task rows up into one overall summary. Averages are weighted by
 *  their own population (closed trades for returns, all trades for sizing) so
 *  a single big task cannot skew them. */
export function rollUpTotals(rows: TaskStats[]): StatsTotals {
  const sum = (k: keyof TaskStats) =>
    rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);

  const closed = sum('closed_trades');
  const total = sum('total_trades');

  const weightedAvg = (
    key: 'avg_profit_pct' | 'avg_amount' | 'avg_hold_minutes',
    weightOf: (r: TaskStats) => number
  ) => {
    let acc = 0;
    let seen = 0;
    for (const r of rows) {
      const v = r[key];
      const w = weightOf(r);
      if (v == null || w <= 0) continue;
      acc += Number(v) * w;
      seen += w;
    }
    return seen === 0 ? null : acc / seen;
  };

  const round = (v: number | null, dp: number) =>
    v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp;

  return {
    task_count: rows.length,
    total_trades: total,
    open_trades: sum('open_trades'),
    closed_trades: closed,
    long_trades: sum('long_trades'),
    short_trades: sum('short_trades'),
    wins: sum('wins'),
    losses: sum('losses'),
    win_rate: closed === 0 ? 0 : round((100 * sum('wins')) / closed, 2)!,
    total_pnl: sum('total_pnl'),
    avg_profit_pct: round(weightedAvg('avg_profit_pct', (r) => r.closed_trades), 4),
    best_profit_pct: rows.some((r) => r.best_profit_pct != null)
      ? Math.max(...rows.map((r) => r.best_profit_pct ?? -Infinity))
      : null,
    worst_profit_pct: rows.some((r) => r.worst_profit_pct != null)
      ? Math.min(...rows.map((r) => r.worst_profit_pct ?? Infinity))
      : null,
    total_amount: sum('total_amount'),
    avg_amount: total === 0 ? null : round(sum('total_amount') / total, 6),
    total_qty: sum('total_qty'),
    first_trade: rows.map((r) => r.first_trade).filter(Boolean).sort()[0] ?? null,
    last_trade: rows.map((r) => r.last_trade).filter(Boolean).sort().pop() ?? null,
    avg_hold_minutes: round(weightedAvg('avg_hold_minutes', (r) => r.closed_trades), 1),
  };
}
