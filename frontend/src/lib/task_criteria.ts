// Criteria evaluation, trend direction and reversal now live in Go
// (internal/trading/criteria.go). The frontend only needs the mapping from an
// analyzed table to the timeframe that is stamped on a trade row — the key that
// links an open trade back to the task that opened it.

export function periodFromTable(table: string): string {
  const m = table.match(/analyzed(\d+)([mhdw])s?/);
  return m ? m[1] + m[2] : '1h';
}
