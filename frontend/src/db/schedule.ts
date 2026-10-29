// Schedule tasks now live in the Go store. Starting/stopping a task also starts
// or stops the Go trading loop, which is what makes a task keep trading while
// the window is closed.
import {
  ScheduleList,
  ScheduleSave,
  ScheduleDelete,
  StartScheduleTask,
  StopScheduleTask,
  RunScheduleTaskNow,
} from '../../wailsjs/go/main/App';
import type { store } from '../../wailsjs/go/models';

export interface ScheduleTask {
  id: number;
  task_name: string;
  interval: number;
  analyzed_table_name: string;
  buy_criteria: string;
  sell_criteria: string;
  currency: string;
  trade_balance_percentage: number;
  balance_type: string;
  sell_if_greater_than: number;
  max_open_trades: number;
  task_status: string;
}

function toTask(t: store.ScheduleTask): ScheduleTask {
  return {
    id: t.id,
    task_name: t.task_name ?? '',
    interval: t.interval ?? 5,
    analyzed_table_name: t.analyzed_table_name ?? '',
    buy_criteria: t.buy_criteria ?? '{}',
    sell_criteria: t.sell_criteria ?? '{}',
    currency: t.currency ?? '',
    trade_balance_percentage: t.trade_balance_percentage ?? 0,
    balance_type: t.balance_type || 'percentage',
    sell_if_greater_than: t.sell_if_greater_than ?? 0,
    max_open_trades: t.max_open_trades ?? 1,
    task_status: t.task_status || 'stopped',
  };
}

export async function getScheduleTasks(): Promise<ScheduleTask[]> {
  return (await ScheduleList()).map(toTask);
}

export async function upsertScheduleTask(
  id: number | null,
  t: Omit<ScheduleTask, 'id' | 'task_status'>
): Promise<void> {
  await ScheduleSave(id ?? 0, { ...t, task_status: 'stopped' } as unknown as store.ScheduleTask);
}

export async function deleteScheduleTask(id: number): Promise<void> {
  await ScheduleDelete(id);
}

/** Mark a task running/stopped AND start/stop its Go loop. */
export async function updateTaskStatus(id: number, status: string): Promise<void> {
  if (status === 'running') {
    await StartScheduleTask(id);
  } else {
    await StopScheduleTask(id);
  }
}

export async function startScheduleTask(id: number): Promise<string> {
  return StartScheduleTask(id);
}

export async function stopScheduleTask(id: number): Promise<string> {
  return StopScheduleTask(id);
}

/** Run one execution immediately without changing the persisted status. */
export async function runScheduleTaskNow(id: number): Promise<void> {
  await RunScheduleTaskNow(id);
}
