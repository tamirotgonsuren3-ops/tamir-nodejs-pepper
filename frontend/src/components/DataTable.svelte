<script lang="ts">
  import type { AnalyzedRow } from '../db/analyzed';
  export let rows: AnalyzedRow[] = [];

  function fmtTime(ts: any): string {
    if (typeof ts === 'number') return new Date(ts * 1000).toLocaleString();
    return new Date(ts).toLocaleString();
  }

  function signalClass(v: string): string {
    if (!v) return 'hold';
    const s = v.toLowerCase();
    if (s === 'buy' || s === 'long') return 'buy';
    if (s === 'sell' || s === 'short') return 'sell';
    return 'hold';
  }
</script>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Close</th>
        <th>RSI</th>
        <th>MACD</th>
        <th>Trade</th>
        <th>HMA</th>
        <th>Bollinger</th>
        <th>Stoch</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row}
        <tr>
          <td>{fmtTime(row.time)}</td>
          <td>{row.close?.toFixed(2)}</td>
          <td><span class="signal-badge {signalClass(row.rsi_trade)}">{row.rsi?.toFixed(1)}</span></td>
          <td><span class="signal-badge {signalClass(row.macd_trade)}">MACD</span></td>
          <td><span class="signal-badge {signalClass(row.trade)}">{row.trade || 'hold'}</span></td>
          <td><span class="signal-badge {signalClass(row.hma_trade)}">HMA</span></td>
          <td><span class="signal-badge {signalClass(row.bb_trade)}">BB</span></td>
          <td><span class="signal-badge {signalClass(row.stochastic_trade)}">Stoch</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .table-wrap { overflow-y: auto; max-height: calc(100vh - 520px); }
</style>
