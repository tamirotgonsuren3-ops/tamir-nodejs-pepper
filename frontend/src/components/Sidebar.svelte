<script lang="ts">
  import { exchange, environment } from '../lib/exchange';

  export let active: string;
  export let apiConnected: boolean;

  const items = [
    { id: 'chart', label: 'Chart', icon: '📊' },
    { id: 'scheduler', label: 'Scheduler', icon: '⏰' },
    { id: 'ai_trade', label: 'AI Trade', icon: '🤖' },
    { id: 'order_test', label: 'Order Test', icon: '🧪', needsApi: true },
    { id: 'indicator_adjustments', label: 'Indicators', icon: '⚙️' },
    { id: 'api', label: 'Set API', icon: '🔑' },
    { id: 'balance', label: 'Balance', icon: '💰', needsApi: true },
    { id: 'orderables', label: 'Orderables', icon: '📋' },
    { id: 'trades', label: 'Trades', icon: '🔄' },
    { id: 'statistics', label: 'Statistics', icon: '📈' },
    { id: 'csvdata', label: 'CSV Data', icon: '📁' },
    { id: 'debug', label: 'DB Debug', icon: '🔍' },
  ];
</script>

<nav class="sidebar">
  <div class="brand">Tamir Go</div>
  <div class="menu">
    {#each items as item}
      <button
        class="menu-item {active === item.id ? 'active' : ''}"
        on:click={() => active = item.id}
        disabled={item.needsApi && !apiConnected}
        title={item.needsApi && !apiConnected ? 'Connect API key first' : item.label}
      >
        <span class="icon">{item.icon}</span>
        <span class="label">{item.label}</span>
      </button>
    {/each}
  </div>
  <div class="footer">
    <div class="status {apiConnected ? 'connected' : 'disconnected'}">
      {#if !apiConnected}
        Read-only
      {:else if $exchange === 'pepperstone'}
        Pepperstone · {$environment === 'demo' ? 'Demo' : 'Live'}
      {:else}
        Binance · Connected
      {/if}
    </div>
  </div>
</nav>

<style>
  .sidebar {
    width: var(--sidebar-width);
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100vh;
    flex-shrink: 0;
  }
  .brand {
    padding: 18px 16px;
    font-size: 16px;
    font-weight: 700;
    color: var(--accent);
    border-bottom: 1px solid var(--border);
  }
  .menu {
    flex: 1;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: transparent;
    color: var(--text-primary);
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    width: 100%;
    text-align: left;
    border: none;
    cursor: pointer;
    transition: background .15s;
  }
  .menu-item:hover:not(:disabled) { background: rgba(255,255,255,.06); }
  .menu-item.active { background: var(--bg-card); color: #fff; }
  .menu-item:disabled { opacity: .35; cursor: not-allowed; }
  .icon { font-size: 16px; }
  .footer { padding: 12px 16px; border-top: 1px solid var(--border); }
  .status {
    font-size: 11px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 4px;
    text-align: center;
  }
  .status.connected { background: var(--accent-green); color: #000; }
  .status.disconnected { background: #555; color: #aaa; }
</style>
