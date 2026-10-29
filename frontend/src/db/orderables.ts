// Orderables, stored in the Go backend.
import { OrderablesList, OrderableSave, OrderableDelete } from '../../wailsjs/go/main/App';
import type { store } from '../../wailsjs/go/models';

export interface Orderable {
  id: number;
  allowed_trades: number;
  orderable_trades: number;
  unfinished_trades: number;
  currency: string;
  period: string;
  balance_percentage: number;
  tactic: string;
}

function toOrderable(o: store.Orderable): Orderable {
  return {
    id: o.id,
    allowed_trades: o.allowed_trades ?? 0,
    orderable_trades: o.orderable_trades ?? 0,
    unfinished_trades: o.unfinished_trades ?? 0,
    currency: o.currency ?? '',
    period: o.period ?? '',
    balance_percentage: o.balance_percentage ?? 0,
    tactic: o.tactic ?? '',
  };
}

export async function getOrderables(): Promise<Orderable[]> {
  return (await OrderablesList()).map(toOrderable);
}

export async function upsertOrderable(o: Orderable): Promise<void> {
  await OrderableSave(o as unknown as store.Orderable);
}

export async function deleteOrderable(id: number): Promise<void> {
  await OrderableDelete(id);
}
