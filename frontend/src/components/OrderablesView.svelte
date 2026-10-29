<script lang="ts">
  import { onMount } from 'svelte';
  import { getOrderables, upsertOrderable, deleteOrderable, type Orderable } from '../db/orderables';

  let orderables: Orderable[] = [];
  let loading = false;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      orderables = await getOrderables();
    } catch (e: any) {
      error = e?.message || 'Failed to load orderables';
      orderables = [];
    }
    loading = false;
  }

  onMount(load);

  let editing: Partial<Orderable> | null = null;
  let saving = false;

  function startNew() {
    editing = { currency: 'ETHUSDT', period: '1h', allowed_trades: 5, orderable_trades: 5, unfinished_trades: 0, balance_percentage: 0.2, tactic: '' };
  }

  function startEdit(o: Orderable) {
    editing = { ...o };
  }

  async function save() {
    if (!editing) return;
    saving = true;
    try {
      await upsertOrderable(editing as Orderable);
      editing = null;
      await load();
    } catch (e: any) {
      error = e?.message || 'Failed to save';
    }
    saving = false;
  }

  async function remove(id: number) {
    if (!confirm('Delete this orderable?')) return;
    try {
      await deleteOrderable(id);
      await load();
    } catch (e: any) {
      error = e?.message || 'Failed to delete';
    }
  }
</script>

<div class="view">
  <div class="header">
    <h2>Orderables</h2>
    <button on:click={startNew}>+ New</button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if loading}
    <p class="muted">Loading...</p>
  {:else if orderables.length === 0}
    <p class="muted">No orderables configured yet.</p>
  {:else}
    <table>
      <thead><tr><th>Currency</th><th>Period</th><th>Tactic</th><th>Allowed</th><th>Open</th><th>Balance %</th><th></th></tr></thead>
      <tbody>
        {#each orderables as o}
          <tr>
            <td>{o.currency}</td>
            <td>{o.period}</td>
            <td>{o.tactic || '-'}</td>
            <td>{o.orderable_trades}</td>
            <td>{o.unfinished_trades}</td>
            <td>{(o.balance_percentage * 100).toFixed(0)}%</td>
            <td class="actions-cell">
              <button class="btn-sm" on:click={() => startEdit(o)}>Edit</button>
              <button class="btn-sm btn-danger" on:click={() => remove(o.id)}>Del</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if editing}
  <div class="modal-overlay" on:click={() => editing = null}>
    <div class="modal" on:click|stopPropagation>
      <h3>{editing.id ? 'Edit' : 'New'} Orderable</h3>
      <label>Currency <input bind:value={editing.currency} /></label>
      <label>Period <input bind:value={editing.period} /></label>
      <label>Allowed Trades <input type="number" bind:value={editing.allowed_trades} /></label>
      <label>Orderable Trades <input type="number" bind:value={editing.orderable_trades} /></label>
      <label>Open Trades <input type="number" bind:value={editing.unfinished_trades} /></label>
      <label>Balance % <input type="number" bind:value={editing.balance_percentage} step="0.05" /></label>
      <label>Tactic <input bind:value={editing.tactic} placeholder="optional" /></label>
      <div class="actions">
        <button class="btn-save" on:click={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button on:click={() => editing = null}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .view { padding: 24px; }
  .view h2 { margin: 0; font-size: 18px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .header button { background: var(--accent); color: #fff; }
  .muted { color: var(--text-secondary); }
  .error { color: var(--accent); margin-bottom: 12px; font-size: 13px; }
  .actions-cell { display: flex; gap: 4px; }
  .btn-sm { padding: 3px 10px; font-size: 11px; background: var(--bg-card); color: var(--text-primary); }
  .btn-danger { background: var(--accent); color: #fff; }
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.6);
    display: flex; align-items: center; justify-content: center; z-index: 100;
  }
  .modal {
    background: var(--bg-secondary); border: 1px solid var(--border);
    border-radius: 8px; padding: 24px; min-width: 360px;
  }
  .modal h3 { margin-bottom: 16px; }
  .modal label { display: block; margin-bottom: 10px; font-size: 13px; color: var(--text-secondary); }
  .modal input { width: 100%; margin-top: 4px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  .btn-save { background: var(--accent-green); color: #000; }
  .btn-save:disabled { opacity: .5; }
</style>
