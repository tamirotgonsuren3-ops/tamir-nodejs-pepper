// Execution logs, stored in the Go backend.
import { ScheduleLogs, ScheduleLogInsert } from '../../wailsjs/go/main/App';
import type { store } from '../../wailsjs/go/models';

export interface ScheduleLog {
  id: number;
  task_id: number;
  task_name: string;
  action: string;
  currency: string;
  interval: string;
  analyzed_table: string;
  balance: string;
  criteria_info: string;
  indicators: string;
  message: string;
  error: string;
  created_at: string;
  trade_amount: string;
}

function toLog(l: store.ScheduleLog): ScheduleLog {
  return {
    id: l.id,
    task_id: l.task_id ?? 0,
    task_name: l.task_name ?? '',
    action: l.action ?? '',
    currency: l.currency ?? '',
    interval: l.interval ?? '',
    analyzed_table: l.analyzed_table ?? '',
    balance: l.balance ?? '',
    criteria_info: l.criteria_info ?? '',
    indicators: l.indicators ?? '',
    message: l.message ?? '',
    error: l.error ?? '',
    created_at: l.created_at ?? '',
    trade_amount: l.trade_amount ?? '',
  };
}

export async function getScheduleLogs(taskId?: number, limit = 100): Promise<ScheduleLog[]> {
  return (await ScheduleLogs(taskId ?? 0, limit)).map(toLog);
}

export async function insertScheduleLog(log: Omit<ScheduleLog, 'id' | 'created_at'>): Promise<void> {
  await ScheduleLogInsert(log as unknown as store.ScheduleLog);
}
