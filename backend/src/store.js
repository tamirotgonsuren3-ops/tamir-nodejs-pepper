import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function defaultPath() {
  try {
    const dir = path.join(os.homedir(), '.config', 'tamir-nodejs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'tamir.db');
  } catch {
    return 'tamir-nodejs.db';
  }
}

export class Store {
  constructor(dbPath) {
    const p = dbPath || defaultPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(p);
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.applySchema();
  }
  applySchema() {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buy_date TEXT,
        sell_date TEXT,
        amount REAL,
        currency TEXT,
        buy_price REAL,
        sell_price REAL,
        sell_if REAL,
        period TEXT,
        tactic_name TEXT,
        usdt REAL,
        difference REAL,
        profit REAL,
        side TEXT NOT NULL DEFAULT 'buy',
        position_id TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_name TEXT NOT NULL DEFAULT '',
        interval INTEGER NOT NULL DEFAULT 5,
        analyzed_table_name TEXT NOT NULL DEFAULT '',
        buy_criteria TEXT NOT NULL DEFAULT '{}',
        sell_criteria TEXT NOT NULL DEFAULT '{}',
        currency TEXT NOT NULL DEFAULT 'ETHUSDT',
        trade_balance_percentage REAL NOT NULL DEFAULT 10,
        balance_type TEXT NOT NULL DEFAULT 'percentage',
        sell_if_greater_than REAL NOT NULL DEFAULT 0.5,
        max_open_trades INTEGER NOT NULL DEFAULT 1,
        task_status TEXT NOT NULL DEFAULT 'stopped'
      )`,
      `CREATE TABLE IF NOT EXISTS schedule_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        task_name TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT '',
        interval TEXT NOT NULL DEFAULT '',
        analyzed_table TEXT NOT NULL DEFAULT '',
        balance TEXT NOT NULL DEFAULT '',
        criteria_info TEXT NOT NULL DEFAULT '',
        indicators TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        trade_amount TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
      )`,
      `CREATE TABLE IF NOT EXISTS indicator_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        analyzed_table TEXT NOT NULL DEFAULT '',
        params TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS orderables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        allowed_trades INTEGER NOT NULL DEFAULT 5,
        orderable_trades INTEGER NOT NULL DEFAULT 5,
        unfinished_trades INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'ETHUSDT',
        period TEXT NOT NULL DEFAULT '1h',
        balance_percentage REAL NOT NULL DEFAULT 0.2,
        tactic TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_name TEXT NOT NULL UNIQUE,
        encrypted_value TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_trades_open ON trades(sell_date, currency, period)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_buy_date ON trades(buy_date)`
    ];
    const tx = this.db.transaction(() => {
      for (const s of stmts) this.db.exec(s);
    });
    tx();
  }
  close() { this.db.close(); }

  nowISO() { return new Date().toISOString(); }

  // Trades
  getTrades(limit = 100) {
    if (limit <= 0) limit = 100;
    return this.db.prepare('SELECT id,buy_date,sell_date,amount,currency,buy_price,sell_price,period,tactic_name,usdt,difference,profit,side,position_id FROM trades ORDER BY buy_date DESC LIMIT ?').all(limit).map(r => this._trade(r));
  }
  getOpenTrades() {
    return this.db.prepare('SELECT id,buy_date,sell_date,amount,currency,buy_price,sell_price,period,tactic_name,usdt,difference,profit,side,position_id FROM trades WHERE sell_date IS NULL ORDER BY buy_date DESC').all().map(r => this._trade(r));
  }
  getOpenTradesByPeriodAndCurrency(period, currency) {
    return this.db.prepare("SELECT id,buy_date,sell_date,amount,currency,buy_price,sell_price,period,tactic_name,usdt,difference,profit,side,position_id FROM trades WHERE sell_date IS NULL AND currency = ? AND (period IS NULL OR period = '' OR period = ?) ORDER BY buy_date DESC").all(currency, period).map(r => this._trade(r));
  }
  _trade(r) {
    return {
      id: r.id,
      buy_date: r.buy_date || '',
      sell_date: r.sell_date || null,
      amount: r.amount ?? 0,
      currency: r.currency || '',
      buy_price: r.buy_price ?? 0,
      sell_price: r.sell_price ?? null,
      period: r.period || '',
      tactic_name: r.tactic_name || '',
      usdt: r.usdt ?? 0,
      difference: r.difference ?? null,
      profit: r.profit ?? null,
      side: r.side || 'buy',
      position_id: r.position_id || ''
    };
  }
  insertTrade(t) {
    const info = this.db.prepare(`INSERT INTO trades (buy_date, sell_date, amount, currency, buy_price, sell_price, period, tactic_name, usdt, difference, profit, side, position_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(t.buy_date || null, t.sell_date || null, t.amount ?? 0, t.currency || '', t.buy_price ?? 0, t.sell_price ?? null,
        t.period || '', t.tactic_name || '', t.usdt ?? 0, t.difference ?? null, t.profit ?? null, t.side || 'buy', t.position_id || '');
    return info.lastInsertRowid;
  }
  updateTradeSell(id, sellDate, sellPrice, profit, difference) {
    this.db.prepare('UPDATE trades SET sell_date = ?, sell_price = ?, profit = ?, difference = ? WHERE id = ?').run(sellDate, sellPrice, profit, difference, id);
    return true;
  }
  updateTradeSellUnknown(id) {
    this.db.prepare('UPDATE trades SET sell_date = ?, sell_price = 0, profit = 0, difference = 0 WHERE id = ?').run(this.nowISO(), id);
    return true;
  }
  setTradePositionId(id, positionID) {
    this.db.prepare('UPDATE trades SET position_id = ? WHERE id = ?').run(positionID, id);
    return true;
  }
  deleteTrade(id) {
    this.db.prepare('DELETE FROM trades WHERE id = ?').run(id);
    return true;
  }

  // Schedule
  getScheduleTasks() {
    return this.db.prepare('SELECT id,task_name,interval,analyzed_table_name,buy_criteria,sell_criteria,currency,trade_balance_percentage,balance_type,sell_if_greater_than,max_open_trades,task_status FROM schedule ORDER BY id').all().map(r => this._sched(r));
  }
  getScheduleTask(id) {
    const r = this.db.prepare('SELECT id,task_name,interval,analyzed_table_name,buy_criteria,sell_criteria,currency,trade_balance_percentage,balance_type,sell_if_greater_than,max_open_trades,task_status FROM schedule WHERE id = ?').get(id);
    return r ? this._sched(r) : null;
  }
  _sched(r) { return {
    id: r.id,
    task_name: r.task_name || '',
    interval: r.interval ?? 5,
    analyzed_table_name: r.analyzed_table_name || '',
    buy_criteria: r.buy_criteria || '{}',
    sell_criteria: r.sell_criteria || '{}',
    currency: r.currency || 'ETHUSDT',
    trade_balance_percentage: r.trade_balance_percentage ?? 10,
    balance_type: r.balance_type || 'percentage',
    sell_if_greater_than: r.sell_if_greater_than ?? 0.5,
    max_open_trades: r.max_open_trades ?? 1,
    task_status: r.task_status || 'stopped'
  }; }
  upsertScheduleTask(id, t) {
    if (t.max_open_trades <= 0) t.max_open_trades = 1;
    if (!t.balance_type) t.balance_type = 'percentage';
    if (id > 0) {
      this.db.prepare(`UPDATE schedule SET task_name=?, interval=?, analyzed_table_name=?, buy_criteria=?, sell_criteria=?, currency=?, trade_balance_percentage=?, balance_type=?, sell_if_greater_than=?, max_open_trades=? WHERE id=?`)
        .run(t.task_name, t.interval, t.analyzed_table_name, t.buy_criteria, t.sell_criteria, t.currency, t.trade_balance_percentage, t.balance_type, t.sell_if_greater_than, t.max_open_trades, id);
      return id;
    }
    const info = this.db.prepare(`INSERT INTO schedule (task_name, interval, analyzed_table_name, buy_criteria, sell_criteria, currency, trade_balance_percentage, balance_type, sell_if_greater_than, max_open_trades)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(t.task_name, t.interval, t.analyzed_table_name, t.buy_criteria, t.sell_criteria, t.currency, t.trade_balance_percentage, t.balance_type, t.sell_if_greater_than, t.max_open_trades);
    return info.lastInsertRowid;
  }
  deleteScheduleTask(id) {
    this.db.prepare('DELETE FROM schedule WHERE id = ?').run(id);
    return true;
  }
  updateTaskStatus(id, status) {
    this.db.prepare('UPDATE schedule SET task_status = ? WHERE id = ?').run(status, id);
    return true;
  }

  // Logs
  getScheduleLogs(taskId = 0, limit = 100) {
    if (limit <= 0) limit = 100;
    let rows;
    if (taskId > 0) rows = this.db.prepare('SELECT id,task_id,task_name,action,currency,interval,analyzed_table,balance,criteria_info,indicators,message,error,trade_amount,created_at FROM schedule_logs WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(taskId, limit);
    else rows = this.db.prepare('SELECT id,task_id,task_name,action,currency,interval,analyzed_table,balance,criteria_info,indicators,message,error,trade_amount,created_at FROM schedule_logs ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
    return rows.map(r => this._log(r));
  }
  _log(r) { return {
    id: r.id, task_id: r.task_id, task_name: r.task_name || '', action: r.action || '', currency: r.currency || '',
    interval: r.interval || '', analyzed_table: r.analyzed_table || '', balance: r.balance || '',
    criteria_info: r.criteria_info || '', indicators: r.indicators || '', message: r.message || '',
    error: r.error || '', trade_amount: r.trade_amount || '', created_at: r.created_at || ''
  }; }
  insertScheduleLog(l) {
    this.db.prepare(`INSERT INTO schedule_logs (task_id, task_name, action, currency, interval, analyzed_table, balance, criteria_info, indicators, message, error, trade_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(l.task_id, l.task_name, l.action, l.currency, l.interval, l.analyzed_table, l.balance, l.criteria_info, l.indicators, l.message, l.error, l.trade_amount);
    return true;
  }

  // Adjustments
  getAllAdjustments() {
    return this.db.prepare('SELECT id,name,analyzed_table,params,created_at,updated_at FROM indicator_adjustments ORDER BY name').all().map(r => this._adj(r));
  }
  getAdjustmentsByTable(table) {
    return this.db.prepare('SELECT id,name,analyzed_table,params,created_at,updated_at FROM indicator_adjustments WHERE analyzed_table = ? ORDER BY name').all(table).map(r => this._adj(r));
  }
  getAdjustmentByName(name, table) {
    const r = this.db.prepare('SELECT id,name,analyzed_table,params,created_at,updated_at FROM indicator_adjustments WHERE name = ? AND analyzed_table = ?').get(name, table);
    return r ? this._adj(r) : null;
  }
  _adj(r) { return { id: r.id, name: r.name || '', analyzed_table: r.analyzed_table || '', params: r.params || '{}', created_at: r.created_at || '', updated_at: r.updated_at || '' }; }
  upsertAdjustment(a) {
    if (a.id > 0) {
      this.db.prepare('UPDATE indicator_adjustments SET name=?, analyzed_table=?, params=?, updated_at=datetime(\'now\') WHERE id=?').run(a.name, a.analyzed_table, a.params, a.id);
      return a.id;
    }
    const info = this.db.prepare('INSERT INTO indicator_adjustments (name, analyzed_table, params, updated_at) VALUES (?,?,?,datetime(\'now\'))').run(a.name, a.analyzed_table, a.params);
    return info.lastInsertRowid;
  }
  deleteAdjustment(id) {
    this.db.prepare('DELETE FROM indicator_adjustments WHERE id = ?').run(id);
    return true;
  }
  loadParamsForTable(table) {
    const rows = this.getAdjustmentsByTable(table);
    const merged = {};
    for (const row of rows) {
      let p = {};
      try { p = JSON.parse(row.params || '{}'); } catch {}
      for (const k in p) {
        const v = p[k];
        if (typeof v === 'number') merged[k] = v;
        else if (typeof v === 'string') { const f = Number(v); if (!isNaN(f)) merged[k] = f; }
      }
    }
    return merged;
  }

  // Orderables
  getOrderables() {
    return this.db.prepare('SELECT id,allowed_trades,orderable_trades,unfinished_trades,currency,period,balance_percentage,tactic FROM orderables ORDER BY period, tactic').all().map(r => ({
      id: r.id, allowed_trades: r.allowed_trades ?? 0, orderable_trades: r.orderable_trades ?? 0,
      unfinished_trades: r.unfinished_trades ?? 0, currency: r.currency || '', period: r.period || '',
      balance_percentage: r.balance_percentage ?? 0, tactic: r.tactic || ''
    }));
  }
  upsertOrderable(o) {
    if (o.id > 0) {
      this.db.prepare('UPDATE orderables SET allowed_trades=?, orderable_trades=?, unfinished_trades=?, currency=?, period=?, balance_percentage=?, tactic=?, updated_at=datetime(\'now\') WHERE id=?')
        .run(o.allowed_trades, o.orderable_trades, o.unfinished_trades, o.currency, o.period, o.balance_percentage, o.tactic, o.id);
      return o.id;
    }
    const info = this.db.prepare('INSERT INTO orderables (allowed_trades, orderable_trades, unfinished_trades, currency, period, balance_percentage, tactic) VALUES (?,?,?,?,?,?,?)')
      .run(o.allowed_trades, o.orderable_trades, o.unfinished_trades, o.currency, o.period, o.balance_percentage, o.tactic);
    return info.lastInsertRowid;
  }
  deleteOrderable(id) {
    this.db.prepare('DELETE FROM orderables WHERE id = ?').run(id);
    return true;
  }

  // Api keys
  getApiKey(name) {
    const r = this.db.prepare('SELECT encrypted_value FROM api_keys WHERE key_name = ?').get(name);
    return r ? r.encrypted_value : '';
  }
  setApiKey(name, value) {
    this.db.prepare(`INSERT INTO api_keys (key_name, encrypted_value) VALUES (?,?) ON CONFLICT(key_name) DO UPDATE SET encrypted_value = excluded.encrypted_value`).run(name, value);
    return true;
  }

  // misc
  isEmpty() {
    const t = this.db.prepare('SELECT COUNT(*) c FROM trades').get().c;
    const s = this.db.prepare('SELECT COUNT(*) c FROM schedule').get().c;
    return t === 0 && s === 0;
  }
  tableNames() {
    return this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  }
  rawQuery(q) {
    const rows = this.db.prepare(q).all();
    return rows.map(r => {
      const o = {}; for (const k in r) o[k] = r[k]; return o;
    });
  }

  // Stats (basic pass-through)
  getTaskStats(filter) { return []; }
  getDailyStats(filter) { return []; }
  getHourlyStats(filter) { return []; }
  getStatsFilterOptions() { return { tasks: [], currencies: [] }; }
  getFilteredTrades(filter, limit) { return limit ? this.getTrades(limit) : this.getTrades(100); }
}
