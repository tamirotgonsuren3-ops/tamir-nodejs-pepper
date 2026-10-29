import { writable } from 'svelte/store';

export type ExchangeId = 'binance' | 'pepperstone';
export type Environment = 'live' | 'demo';

export const exchange = writable<ExchangeId>('binance');
export const environment = writable<Environment>('live');

export const BINANCE_SYMBOLS = [
  'ETHUSDT', 'BTCUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'ADAUSDT',
];

export const PEPPERSTONE_SYMBOLS = [
  'USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'USDCHF', 'USDCAD',
  'NZDUSD', 'XAUUSD',
];

export function symbolsFor(ex: ExchangeId): string[] {
  return ex === 'pepperstone' ? PEPPERSTONE_SYMBOLS : BINANCE_SYMBOLS;
}

export function exchangeLabel(ex: ExchangeId): string {
  return ex === 'pepperstone' ? 'Pepperstone' : 'Binance';
}