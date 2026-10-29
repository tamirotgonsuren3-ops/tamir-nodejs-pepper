// Thin wrappers over the Go store bindings. All persistence now lives in the Go
// backend (SQLite); this module only translates between the Wails transport
// types and the plain shapes the components already use.
import {
  TradesList,
  TradesOpen,
  TradesOpenByPair,
  TradeInsert,
  TradeClose,
  TradeSetPosition,
  TradeDelete,
} from '../../wailsjs/go/main/App';
import type { store } from '../../wailsjs/go/models';

export interface Trade {
  id: number;
  buy_date: string;
  sell_date: string | null;
  amount: number;
  currency: string;
  buy_price: number;
  sell_price: number | null;
  period: string;
  tactic_name: string;
  usdt: number;
  difference: number | null;
  profit: number | null;
  side: string;
  position_id: string;
}

export function tradeFromGo(t: store.Trade): Trade {
  return {
    id: t.id,
    buy_date: t.buy_date ?? '',
    sell_date: t.sell_date ?? null,
    amount: t.amount ?? 0,
    currency: t.currency ?? '',
    buy_price: t.buy_price ?? 0,
    sell_price: t.sell_price ?? null,
    period: t.period ?? '',
    tactic_name: t.tactic_name ?? '',
    usdt: t.usdt ?? 0,
    difference: t.difference ?? null,
    profit: t.profit ?? null,
    side: t.side || 'buy',
    position_id: t.position_id || '',
  };
}

export async function getTrades(limit = 100): Promise<Trade[]> {
  return (await TradesList(limit)).map(tradeFromGo);
}

export async function getOpenTrades(): Promise<Trade[]> {
  return (await TradesOpen()).map(tradeFromGo);
}

// Open positions are scoped by PAIR + TIMEFRAME, not by task name: the cap of
// max_open_trades per direction must hold for every task trading the same pair
// on the same timeframe. The Go query treats rows without a period as matching
// any timeframe so legacy records can never be left unmanaged.
export async function getOpenTradesByPeriodAndCurrency(period: string, currency: string): Promise<Trade[]> {
  return (await TradesOpenByPair(period, currency)).map(tradeFromGo);
}

export async function insertTrade(trade: Omit<Trade, 'id'>): Promise<void> {
  await TradeInsert(trade as unknown as store.Trade);
}

/** Attach a broker position id to an existing open trade. */
export async function setTradePositionId(id: number, positionId: string): Promise<void> {
  await TradeSetPosition(id, positionId);
}

// sell_date is stamped by the Go store as a UTC ISO-8601 string, exactly like
// buy_date, so the two columns agree on the day an entry and its exit belong to.
export async function updateTradeSell(id: number, sellPrice: number, profit: number, difference: number): Promise<void> {
  await TradeClose(id, sellPrice, profit, difference);
}

export async function deleteTrade(id: number): Promise<void> {
  await TradeDelete(id);
}
