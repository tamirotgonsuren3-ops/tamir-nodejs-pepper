#!/usr/bin/env python3
"""Multi-Timeframe Random Forest training + backtesting for tamir-go."""

import json
import sys
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
from sklearn.model_selection import TimeSeriesSplit


ALL_TF = ["5m", "15m", "30m", "1h", "4h", "8h", "1d", "3d", "1w", "1M"]
TF_ORDER = {tf: i for i, tf in enumerate(ALL_TF)}

INDICATOR_FEATURES = [
    "macd", "macd_signal", "macd_hist",
    "rsi",
    "ema", "ema_short", "ema_middle", "ema_long",
    "ma_short", "ma_middle", "ma_long",
    "sma_short", "sma_long", "hma",
    "stochastic_K", "stochastic_D",
    "bb_middle", "bb_upper", "bb_lower",
]

TRADE_FEATURES = [
    "macd_trade", "rsi_trade", "stochastic_trade",
    "ema_trade", "sma_trade", "ma_trade", "hma_trade", "bb_trade",
]


def load_timeframes(data_dir: str, symbol: str, exec_tf: str) -> dict[str, pd.DataFrame]:
    """Load all timeframe CSVs from data_dir. Returns dict[tf -> DataFrame]."""
    data = {}
    for tf in ALL_TF:
        path = Path(data_dir) / f"{symbol}_{tf}.csv"
        if path.exists():
            df = pd.read_csv(path)
            df["time"] = pd.to_numeric(df["time"], errors="coerce")
            df = df.dropna(subset=["time"])
            df = df.sort_values("time")
            data[tf] = df
    return data


def compute_tf_bias(row: pd.Series) -> str:
    """Compute directional bias from a single TF's indicators."""
    score = 0
    try:
        if row.get("macd", 0) > row.get("macd_signal", 0): score += 1
        if row.get("macd", 0) < row.get("macd_signal", 0): score -= 1
        if row.get("rsi", 50) > 50: score += 1
        if row.get("rsi", 50) < 50: score -= 1
        if row.get("close", 0) > row.get("ema_long", 0): score += 1
        if row.get("close", 0) < row.get("ema_long", 0): score -= 1
        if row.get("sma_short", 0) > row.get("sma_long", 0): score += 1
        if row.get("sma_short", 0) < row.get("sma_long", 0): score -= 1
        if row.get("stochastic_K", 0) > row.get("stochastic_D", 0): score += 1
        if row.get("stochastic_K", 0) < row.get("stochastic_D", 0): score -= 1
    except (TypeError, ValueError):
        pass
    if score >= 3: return "bullish"
    if score <= -3: return "bearish"
    return "neutral"


def encode_bias(bias: str) -> int:
    """Encode bias string to numeric."""
    return {"bullish": 1, "neutral": 0, "bearish": -1}.get(bias, 0)


def build_mtf_dataset(
    data: dict[str, pd.DataFrame],
    exec_tf: str,
    lookahead: int = 12,
    buy_threshold: float = 0.005,
    sell_threshold: float = -0.005,
) -> pd.DataFrame:
    """
    Build a single flat DataFrame aligned on exec_tf.
    For each exec_tf candle, merge the latest candle from each higher TF.
    Features: exec_tf indicators + higher TF bias features.
    """
    if exec_tf not in data:
        raise ValueError(f"Execution timeframe '{exec_tf}' not found in data")

    exec_df = data[exec_tf].copy()
    exec_df = exec_df.dropna(subset=["close", "open"])
    exec_df = exec_df.sort_values("time").reset_index(drop=True)

    rows = []
    for idx, row in exec_df.iterrows():
        ts = row["time"]
        base = {
            "time": ts,
            "open": row.get("open", 0),
            "high": row.get("high", 0),
            "low": row.get("low", 0),
            "close": row.get("close", 0),
            "volume": row.get("volume", 0),
        }

        for feat in INDICATOR_FEATURES + TRADE_FEATURES:
            if feat in row:
                base[f"tf_{exec_tf}_{feat}"] = row[feat]

        exec_bias = compute_tf_bias(row)
        base[f"tf_{exec_tf}_bias"] = encode_bias(exec_bias)

        for tf, tf_df in data.items():
            if tf == exec_tf:
                continue
            higher_tf_order = TF_ORDER.get(tf, 99)
            exec_tf_order = TF_ORDER.get(exec_tf, 99)

            if higher_tf_order < exec_tf_order:
                continue

            mask = tf_df["time"] <= ts
            if not mask.any():
                continue
            last = tf_df[mask].iloc[-1]

            for feat in INDICATOR_FEATURES:
                if feat in last:
                    base[f"tf_{tf}_{feat}"] = last[feat]

            tf_bias = compute_tf_bias(last)
            base[f"tf_{tf}_bias"] = encode_bias(tf_bias)

        rows.append(base)

    result_df = pd.DataFrame(rows)

    future_prices = exec_df["close"].shift(-lookahead)
    result_df["future_close"] = future_prices.values
    result_df["return"] = (result_df["future_close"] - result_df["close"]) / result_df["close"]

    result_df["label"] = 0
    result_df.loc[result_df["return"] >= buy_threshold, "label"] = 1
    result_df.loc[result_df["return"] <= sell_threshold, "label"] = -1

    result_df = result_df.dropna(subset=["label"])
    return result_df


def train_model(
    df: pd.DataFrame,
    config: dict,
) -> dict:
    """Train Random Forest and return metrics + model info."""
    feature_cols = [c for c in df.columns if c.startswith("tf_")]
    feature_cols = [c for c in feature_cols if c not in ("time", "label", "return", "future_close")]

    X = df[feature_cols].values
    y = df["label"].values

    n_total = len(y)
    n_train = int(n_total * config.get("train_split", 0.7))
    n_train = max(n_train, 100)

    X_train, X_test = X[:n_train], X[n_train:]
    y_train, y_test = y[:n_train], y[n_train:]

    clf = RandomForestClassifier(
        n_estimators=config.get("n_trees", 200),
        max_depth=config.get("max_depth", 12),
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)

    present_labels = sorted(set(y_test) | set(y_pred))
    labels_for_metrics = [l for l in [-1, 0, 1] if l in present_labels]

    acc = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, labels=labels_for_metrics, average="weighted", zero_division=0)
    rec = recall_score(y_test, y_pred, labels=labels_for_metrics, average="weighted", zero_division=0)
    f1 = f1_score(y_test, y_pred, labels=labels_for_metrics, average="weighted", zero_division=0)

    cm = confusion_matrix(y_test, y_pred, labels=[-1, 0, 1]).ravel().tolist()

    importances = sorted(
        zip(feature_cols, clf.feature_importances_),
        key=lambda x: x[1], reverse=True,
    )[:20]

    class_balance = {str(k): int(v) for k, v in sorted(zip(*np.unique(y, return_counts=True)))}

    return {
        "model_accuracy": round(float(acc), 4),
        "precision": round(float(prec), 4),
        "recall": round(float(rec), 4),
        "f1_score": round(float(f1), 4),
        "feature_importance": [
            {"name": name, "score": round(float(score), 4)}
            for name, score in importances
        ],
        "class_balance": class_balance,
        "confusion_matrix": cm,
        "total_samples": int(n_total),
        "model": clf,
        "feature_cols": feature_cols,
    }


def run_backtest(
    df: pd.DataFrame,
    model: RandomForestClassifier,
    feature_cols: list[str],
    initial_balance: float = 100.0,
) -> dict:
    """Run backtest simulation using model predictions."""
    X = df[feature_cols].values
    y_pred = model.predict(X)
    df = df.copy()
    df["pred"] = y_pred

    balance = initial_balance
    equity = balance
    in_position = False
    entry_price = 0.0
    entry_time = ""
    entry_idx = 0
    trades = []
    equity_curve = []
    peak = balance
    max_dd = 0.0
    returns = []

    for idx, row in df.iterrows():
        ts_str = pd.to_datetime(row["time"], unit="s").strftime("%Y-%m-%d %H:%M")
        price = row["close"]
        pred = row["pred"]
        equity_curve.append({"time": ts_str, "equity": round(equity, 2)})

        if not in_position and pred == 1:
            in_position = True
            entry_price = price
            entry_time = ts_str
            entry_idx = idx
        elif in_position and pred == -1:
            in_position = False
            ret = (price - entry_price) / entry_price
            ret = ret if abs(ret) < 0.5 else 0.0
            returns.append(ret)
            balance *= (1 + ret)
            trades.append({
                "entry_time": entry_time,
                "exit_time": ts_str,
                "entry_price": round(entry_price, 8),
                "exit_price": round(price, 8),
                "action": "sell",
                "return_pct": round(ret * 100, 2),
                "duration": int(idx - entry_idx),
            })
            equity = balance
            peak = max(peak, equity)
            dd = (peak - equity) / peak
            max_dd = max(max_dd, dd)

    if in_position:
        last = df.iloc[-1]
        ret = (last["close"] - entry_price) / entry_price
        ret = ret if abs(ret) < 0.5 else 0.0
        returns.append(ret)
        balance *= (1 + ret)
        trades.append({
            "entry_time": entry_time,
            "exit_time": pd.to_datetime(last["time"], unit="s").strftime("%Y-%m-%d %H:%M"),
            "entry_price": round(entry_price, 8),
            "exit_price": round(last["close"], 8),
            "action": "close",
            "return_pct": round(ret * 100, 2),
            "duration": int(len(df) - entry_idx),
        })

    wins = sum(1 for r in returns if r > 0)
    losses = sum(1 for r in returns if r <= 0)
    total = len(returns)
    win_rate = wins / total if total > 0 else 0.0

    total_return = ((balance - initial_balance) / initial_balance) * 100
    avg_return = np.mean(returns) * 100 if returns else 0.0
    std_return = np.std(returns) * 100 if len(returns) > 1 else 1.0
    sharpe = (avg_return / std_return) * np.sqrt(365) if std_return > 0 else 0.0

    return {
        "total_trades": total,
        "win_count": wins,
        "loss_count": losses,
        "win_rate": round(win_rate, 4),
        "total_return": round(total_return, 2),
        "max_drawdown": round(max_dd * 100, 2),
        "sharpe_ratio": round(sharpe, 2),
        "final_balance": round(balance, 2),
        "trades": trades[-100:],
        "equity_curve": equity_curve[::max(1, len(equity_curve) // 500)],
        "confusion_matrix": [],
    }


def main():
    config = json.loads(sys.stdin.read())
    symbol = config.get("symbol", "ETHUSDT")
    data_dir = config.get("data_dir", "ai-data")
    exec_tf = config.get("exec_timeframe", "5m")
    lookahead = config.get("future_candles", 12)
    buy_thresh = config.get("buy_threshold", 0.005)
    sell_thresh = config.get("sell_threshold", -0.005)
    train_split = config.get("train_split", 0.7)
    n_trees = config.get("n_trees", 200)
    max_depth = config.get("max_depth", 12)
    use_mtf = config.get("use_mtf", True)
    action = config.get("action", "train")

    if not os.path.isdir(data_dir):
        result = {"error": f"Data directory '{data_dir}' not found"}
        print(json.dumps(result))
        return

    data = load_timeframes(data_dir, symbol, exec_tf)
    if exec_tf not in data:
        result = {"error": f"Execution timeframe '{exec_tf}' has no data"}
        print(json.dumps(result))
        return

    df = build_mtf_dataset(data, exec_tf, lookahead, buy_thresh, sell_thresh)

    if len(df) < 200:
        result = {"error": f"Not enough data: {len(df)} rows (need 200+)"}
        print(json.dumps(result))
        return

    config_internal = {
        "train_split": train_split,
        "n_trees": n_trees,
        "max_depth": max_depth,
    }

    train_result = train_model(df, config_internal)
    clf = train_result.pop("model")
    feature_cols = train_result.pop("feature_cols")

    bt = run_backtest(df, clf, feature_cols)

    output = {
        "train": train_result,
        "backtest": bt,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
