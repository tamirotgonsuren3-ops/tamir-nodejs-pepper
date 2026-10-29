// Indicator presets, stored in the Go backend.
import {
  AdjustmentsList,
  AdjustmentGet,
  AdjustmentsByTable,
  AdjustmentGetByName,
  AdjustmentSave,
  AdjustmentDelete,
  IndicatorParams,
} from '../../wailsjs/go/main/App';
import type { store } from '../../wailsjs/go/models';

export interface IndicatorAdjustment {
  id: number;
  name: string;
  analyzed_table: string;
  params: string;
  created_at: string;
  updated_at: string;
}

function toAdj(a: store.IndicatorAdjustment): IndicatorAdjustment {
  return {
    id: a.id,
    name: a.name ?? '',
    analyzed_table: a.analyzed_table ?? '',
    params: a.params ?? '{}',
    created_at: a.created_at ?? '',
    updated_at: a.updated_at ?? '',
  };
}

export async function getAllAdjustments(): Promise<IndicatorAdjustment[]> {
  return (await AdjustmentsList()).map(toAdj);
}

export async function getAdjustment(id: number): Promise<IndicatorAdjustment | undefined> {
  const row = await AdjustmentGet(id);
  return row ? toAdj(row) : undefined;
}

export async function getAdjustmentsByTable(tableName: string): Promise<IndicatorAdjustment[]> {
  return (await AdjustmentsByTable(tableName)).map(toAdj);
}

export async function getAdjustmentByName(name: string, tableName: string): Promise<IndicatorAdjustment | undefined> {
  const row = await AdjustmentGetByName(name, tableName);
  return row ? toAdj(row) : undefined;
}

export async function upsertAdjustment(
  a: Omit<IndicatorAdjustment, 'id' | 'created_at' | 'updated_at'> & { id?: number }
): Promise<void> {
  await AdjustmentSave({
    id: a.id ?? 0,
    name: a.name,
    analyzed_table: a.analyzed_table,
    params: a.params,
    created_at: '',
    updated_at: '',
  } as unknown as store.IndicatorAdjustment);
}

export async function deleteAdjustment(id: number): Promise<void> {
  await AdjustmentDelete(id);
}

export function tableToInterval(tbl: string): string {
  if (tbl === 'analyzed_months') return '1M';
  const m = tbl.match(/analyzed(\d+)([mhdw])s?/);
  return m ? m[1] + m[2] : '1h';
}

export async function loadParamsForTable(tableName: string): Promise<Record<string, number>> {
  return IndicatorParams(tableName);
}
