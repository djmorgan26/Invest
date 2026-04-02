"""
ML Training Pipeline v2 — Fixed data leakage, proper evaluation.

Key fixes from v1:
1. GroupKFold by market ticker (no same market in train AND val)
2. Metrics reported per time horizon (24h+ is the real test)
3. Trading-signal framing: predict P(YES) and compare to market price
4. Edge-aware evaluation: does the model find profitable trades?
"""

import json
import warnings
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import optuna
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import RobustScaler
from sklearn.metrics import (
    roc_auc_score, brier_score_loss, log_loss,
    average_precision_score
)
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression
import xgboost as xgb
import lightgbm as lgb
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
import pickle

warnings.filterwarnings("ignore", category=FutureWarning)
optuna.logging.set_verbosity(optuna.logging.WARNING)

DATA_DIR = Path(__file__).parent / "data"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

META_COLS = ["ticker", "event_ticker", "obs_hours_before_close", "label"]


def load_data():
    df = pd.read_parquet(DATA_DIR / "features.parquet")
    feature_cols = [c for c in df.columns if c not in META_COLS]
    X = df[feature_cols].values.astype(np.float32)
    y = df["label"].values.astype(np.int32)
    groups = df["ticker"].values  # For GroupKFold
    obs_hours = df["obs_hours_before_close"].values
    X = np.nan_to_num(X, nan=0.0, posinf=1e6, neginf=-1e6)

    print(f"Dataset: {X.shape[0]} samples, {X.shape[1]} features, {len(np.unique(groups))} markets")
    print(f"Label balance: {y.sum()}/{len(y)} YES ({100*y.mean():.1f}%)")
    print(f"Observation points: {sorted(np.unique(obs_hours))}")
    return df, X, y, feature_cols, groups, obs_hours


def get_group_splits(X, y, groups, n_splits=5):
    """GroupKFold: ensures all observations of a market stay together."""
    gkf = GroupKFold(n_splits=n_splits)
    return list(gkf.split(X, y, groups))


def evaluate_by_horizon(y, preds, obs_hours, model_name):
    """Evaluate predictions broken down by time horizon."""
    print(f"\n  {model_name} — Performance by Time Horizon:")
    print(f"  {'Hours':>6s}  {'N':>5s}  {'AUC':>6s}  {'Brier':>6s}  {'AccP70':>6s}  {'AccP60':>6s}")
    print(f"  {'-'*42}")

    for h in sorted(np.unique(obs_hours)):
        mask = obs_hours == h
        if mask.sum() < 5:
            continue
        y_h = y[mask]
        p_h = preds[mask]

        try:
            auc = roc_auc_score(y_h, p_h)
        except ValueError:
            auc = 0.5

        brier = brier_score_loss(y_h, p_h)

        # Accuracy at high-confidence thresholds
        above_70 = p_h >= 0.7
        acc_70 = y_h[above_70].mean() if above_70.sum() > 0 else float('nan')
        above_60 = p_h >= 0.6
        acc_60 = y_h[above_60].mean() if above_60.sum() > 0 else float('nan')

        print(f"  {h:>5.0f}h  {mask.sum():>5d}  {auc:>6.3f}  {brier:>6.3f}  "
              f"{acc_70:>6.1%}  {acc_60:>6.1%}" if not np.isnan(acc_70)
              else f"  {h:>5.0f}h  {mask.sum():>5d}  {auc:>6.3f}  {brier:>6.3f}  "
              f"{'n/a':>6s}  {acc_60:>6.1%}" if not np.isnan(acc_60)
              else f"  {h:>5.0f}h  {mask.sum():>5d}  {auc:>6.3f}  {brier:>6.3f}  "
              f"{'n/a':>6s}  {'n/a':>6s}")

    # Overall
    try:
        overall_auc = roc_auc_score(y, preds)
    except ValueError:
        overall_auc = 0.5
    overall_brier = brier_score_loss(y, preds)
    print(f"  {'ALL':>6s}  {len(y):>5d}  {overall_auc:>6.3f}  {overall_brier:>6.3f}")

    # Early-only (24h+): this is the real predictive test
    early_mask = obs_hours >= 24
    if early_mask.sum() > 10:
        try:
            early_auc = roc_auc_score(y[early_mask], preds[early_mask])
        except ValueError:
            early_auc = 0.5
        early_brier = brier_score_loss(y[early_mask], preds[early_mask])
        print(f"  {'24h+':>6s}  {early_mask.sum():>5d}  {early_auc:>6.3f}  {early_brier:>6.3f}  *** KEY METRIC ***")

    return overall_auc


def evaluate_trading_edge(df, preds, model_name):
    """Simulate trading decisions: does the model find profitable edges?"""
    print(f"\n  {model_name} — Trading Edge Analysis:")

    df_eval = df.copy()
    df_eval["pred_prob"] = preds

    # For each observation, compute the "edge" = |predicted - market price|
    df_eval["market_prob"] = df_eval["price_prob"]  # current market-implied probability
    df_eval["edge"] = df_eval["pred_prob"] - df_eval["market_prob"]
    df_eval["abs_edge"] = df_eval["edge"].abs()

    # Simulate: buy YES when pred > market + threshold, buy NO when pred < market - threshold
    for threshold in [0.05, 0.10, 0.15, 0.20]:
        buy_yes = df_eval["edge"] >= threshold
        buy_no = df_eval["edge"] <= -threshold
        trades = buy_yes | buy_no

        if trades.sum() == 0:
            print(f"    Edge >= {threshold:.0%}: 0 trades")
            continue

        # Win if: bought YES and result=YES, or bought NO and result=NO
        wins = (buy_yes & (df_eval["label"] == 1)) | (buy_no & (df_eval["label"] == 0))
        win_rate = wins[trades].mean()
        n_trades = trades.sum()

        # Approximate PnL (simplified: win = edge, lose = -(1-edge))
        avg_edge = df_eval.loc[trades, "abs_edge"].mean()

        print(f"    Edge >= {threshold:.0%}: {n_trades:>4d} trades, "
              f"{win_rate:.1%} WR, avg edge {avg_edge:.3f}")

    # Focus on early observations only (where it matters)
    early = df_eval[df_eval["obs_hours_before_close"] >= 24]
    if len(early) > 0:
        print(f"\n    Early observations (24h+ before close):")
        for threshold in [0.05, 0.10, 0.15]:
            buy_yes = early["edge"] >= threshold
            buy_no = early["edge"] <= -threshold
            trades = buy_yes | buy_no
            if trades.sum() == 0:
                continue
            wins = (buy_yes & (early["label"] == 1)) | (buy_no & (early["label"] == 0))
            win_rate = wins[trades].mean()
            print(f"      Edge >= {threshold:.0%}: {trades.sum():>4d} trades, {win_rate:.1%} WR")


# -------------------------------------------------------------------
# XGBoost
# -------------------------------------------------------------------

def train_xgboost(X, y, groups, splits, n_trials=80):
    print("\n" + "="*60)
    print("XGBOOST (GroupKFold)")
    print("="*60)

    def objective(trial):
        params = {
            "objective": "binary:logistic",
            "eval_metric": "logloss",
            "tree_method": "hist",
            "max_depth": trial.suggest_int("max_depth", 3, 8),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 20),
            "subsample": trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.3, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-8, 10.0, log=True),
            "gamma": trial.suggest_float("gamma", 1e-8, 5.0, log=True),
            "scale_pos_weight": trial.suggest_float("scale_pos_weight", 0.5, 3.0),
            "random_state": 42,
            "verbosity": 0,
        }

        scores = []
        for train_idx, val_idx in splits:
            model = xgb.XGBClassifier(**params)
            model.fit(X[train_idx], y[train_idx], verbose=False)
            preds = model.predict_proba(X[val_idx])[:, 1]
            try:
                scores.append(roc_auc_score(y[val_idx], preds))
            except ValueError:
                scores.append(0.5)
        return np.mean(scores)

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)
    print(f"Best CV AUC: {study.best_value:.4f}")

    best_params = {
        "objective": "binary:logistic", "eval_metric": "logloss",
        "tree_method": "hist", "random_state": 42, "verbosity": 0,
        **study.best_params,
    }

    # CV predictions
    cv_preds = np.zeros(len(y), dtype=np.float64)
    for train_idx, val_idx in splits:
        m = xgb.XGBClassifier(**best_params)
        m.fit(X[train_idx], y[train_idx], verbose=False)
        cv_preds[val_idx] = m.predict_proba(X[val_idx])[:, 1]

    # Final model on all data
    final = xgb.XGBClassifier(**best_params)
    final.fit(X, y, verbose=False)

    return final, cv_preds, study.best_params, study.best_value


# -------------------------------------------------------------------
# LightGBM
# -------------------------------------------------------------------

def train_lightgbm(X, y, groups, splits, n_trials=80):
    print("\n" + "="*60)
    print("LIGHTGBM (GroupKFold)")
    print("="*60)

    def objective(trial):
        params = {
            "objective": "binary", "metric": "binary_logloss",
            "boosting_type": "gbdt", "verbose": -1,
            "num_leaves": trial.suggest_int("num_leaves", 16, 128),
            "max_depth": trial.suggest_int("max_depth", 3, 10),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "min_child_samples": trial.suggest_int("min_child_samples", 5, 50),
            "subsample": trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.3, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-8, 10.0, log=True),
            "scale_pos_weight": trial.suggest_float("scale_pos_weight", 0.5, 3.0),
            "random_state": 42,
        }

        scores = []
        for train_idx, val_idx in splits:
            model = lgb.LGBMClassifier(**params)
            model.fit(X[train_idx], y[train_idx])
            preds = model.predict_proba(X[val_idx])[:, 1]
            try:
                scores.append(roc_auc_score(y[val_idx], preds))
            except ValueError:
                scores.append(0.5)
        return np.mean(scores)

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)
    print(f"Best CV AUC: {study.best_value:.4f}")

    best_params = {
        "objective": "binary", "metric": "binary_logloss",
        "boosting_type": "gbdt", "verbose": -1, "random_state": 42,
        **study.best_params,
    }

    cv_preds = np.zeros(len(y), dtype=np.float64)
    for train_idx, val_idx in splits:
        m = lgb.LGBMClassifier(**best_params)
        m.fit(X[train_idx], y[train_idx])
        cv_preds[val_idx] = m.predict_proba(X[val_idx])[:, 1]

    final = lgb.LGBMClassifier(**best_params)
    final.fit(X, y)

    return final, cv_preds, study.best_params, study.best_value


# -------------------------------------------------------------------
# Neural Network
# -------------------------------------------------------------------

class MarketNet(nn.Module):
    def __init__(self, input_dim, hidden_dims, dropout):
        super().__init__()
        layers = []
        prev = input_dim
        for h in hidden_dims:
            layers += [nn.Linear(prev, h), nn.BatchNorm1d(h), nn.GELU(), nn.Dropout(dropout)]
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


def train_neural_net(X, y, groups, splits, n_trials=30):
    print("\n" + "="*60)
    print("NEURAL NETWORK (GroupKFold)")
    print("="*60)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    scaler = RobustScaler()
    X_scaled = scaler.fit_transform(X).astype(np.float32)

    pos_weight_val = (len(y) - y.sum()) / max(y.sum(), 1)

    def objective(trial):
        n_layers = trial.suggest_int("n_layers", 2, 4)
        hidden_dims = [trial.suggest_int(f"h{i}", 32, 256, log=True) for i in range(n_layers)]
        dropout = trial.suggest_float("dropout", 0.1, 0.5)
        lr = trial.suggest_float("lr", 1e-4, 5e-3, log=True)
        wd = trial.suggest_float("wd", 1e-6, 1e-3, log=True)
        batch_size = trial.suggest_categorical("bs", [64, 128, 256])
        epochs = trial.suggest_int("epochs", 30, 100)

        scores = []
        for train_idx, val_idx in splits:
            Xt = torch.tensor(X_scaled[train_idx], dtype=torch.float32)
            yt = torch.tensor(y[train_idx], dtype=torch.float32).unsqueeze(1)
            Xv = torch.tensor(X_scaled[val_idx], dtype=torch.float32)

            ds = TensorDataset(Xt, yt)
            loader = DataLoader(ds, batch_size=batch_size, shuffle=True)
            model = MarketNet(X.shape[1], hidden_dims, dropout).to(device)
            pw = torch.tensor([pos_weight_val], dtype=torch.float32).to(device)
            crit = nn.BCEWithLogitsLoss(pos_weight=pw)
            opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=wd)

            model.train()
            for _ in range(epochs):
                for bX, bY in loader:
                    bX, bY = bX.to(device), bY.to(device)
                    opt.zero_grad()
                    crit(model(bX), bY).backward()
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    opt.step()

            model.eval()
            with torch.no_grad():
                logits = model(Xv.to(device)).cpu().numpy().flatten()
                probs = 1 / (1 + np.exp(-logits))
            try:
                scores.append(roc_auc_score(y[val_idx], probs))
            except ValueError:
                scores.append(0.5)

        return np.mean(scores)

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)
    print(f"Best CV AUC: {study.best_value:.4f}")

    bp = study.best_params
    hidden_dims = [bp[f"h{i}"] for i in range(bp["n_layers"])]

    # CV predictions
    cv_preds = np.zeros(len(y), dtype=np.float64)
    for train_idx, val_idx in splits:
        Xt = torch.tensor(X_scaled[train_idx], dtype=torch.float32)
        yt = torch.tensor(y[train_idx], dtype=torch.float32).unsqueeze(1)
        Xv = torch.tensor(X_scaled[val_idx], dtype=torch.float32)

        ds = TensorDataset(Xt, yt)
        loader = DataLoader(ds, batch_size=bp["bs"], shuffle=True)
        model = MarketNet(X.shape[1], hidden_dims, bp["dropout"]).to(device)
        pw = torch.tensor([pos_weight_val], dtype=torch.float32).to(device)
        crit = nn.BCEWithLogitsLoss(pos_weight=pw)
        opt = torch.optim.AdamW(model.parameters(), lr=bp["lr"], weight_decay=bp["wd"])

        model.train()
        for _ in range(bp["epochs"]):
            for bX, bY in loader:
                bX, bY = bX.to(device), bY.to(device)
                opt.zero_grad()
                crit(model(bX), bY).backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()

        model.eval()
        with torch.no_grad():
            logits = model(Xv.to(device)).cpu().numpy().flatten()
            cv_preds[val_idx] = 1 / (1 + np.exp(-logits))

    # Final model
    Xall = torch.tensor(X_scaled, dtype=torch.float32)
    yall = torch.tensor(y, dtype=torch.float32).unsqueeze(1)
    ds = TensorDataset(Xall, yall)
    loader = DataLoader(ds, batch_size=bp["bs"], shuffle=True)
    final = MarketNet(X.shape[1], hidden_dims, bp["dropout"]).to(device)
    pw = torch.tensor([pos_weight_val], dtype=torch.float32).to(device)
    crit = nn.BCEWithLogitsLoss(pos_weight=pw)
    opt = torch.optim.AdamW(final.parameters(), lr=bp["lr"], weight_decay=bp["wd"])

    final.train()
    for _ in range(bp["epochs"]):
        for bX, bY in loader:
            bX, bY = bX.to(device), bY.to(device)
            opt.zero_grad()
            crit(final(bX), bY).backward()
            torch.nn.utils.clip_grad_norm_(final.parameters(), 1.0)
            opt.step()

    return final, cv_preds, scaler, study.best_params, study.best_value


# -------------------------------------------------------------------
# Ensemble + Save
# -------------------------------------------------------------------

def train_ensemble(xgb_p, lgb_p, nn_p, y):
    print("\n" + "="*60)
    print("STACKING ENSEMBLE")
    print("="*60)
    meta_X = np.column_stack([xgb_p, lgb_p, nn_p])
    meta = LogisticRegression(C=1.0, random_state=42, max_iter=1000)
    meta.fit(meta_X, y)
    preds = meta.predict_proba(meta_X)[:, 1]
    print(f"Weights: XGB={meta.coef_[0][0]:.3f} LGB={meta.coef_[0][1]:.3f} NN={meta.coef_[0][2]:.3f}")
    return meta, preds


def save_all(xgb_model, lgb_model, nn_model, meta, scaler, feature_cols, results):
    xgb_model.save_model(str(MODEL_DIR / "xgboost_model.json"))
    lgb_model.booster_.save_model(str(MODEL_DIR / "lightgbm_model.txt"))
    torch.save(nn_model.state_dict(), MODEL_DIR / "neural_net.pt")
    with open(MODEL_DIR / "meta_learner.pkl", "wb") as f:
        pickle.dump(meta, f)
    with open(MODEL_DIR / "scaler.pkl", "wb") as f:
        pickle.dump(scaler, f)
    with open(MODEL_DIR / "training_metadata.json", "w") as f:
        json.dump({
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "feature_cols": feature_cols,
            "results": results,
            "version": 2,
            "cv_method": "GroupKFold_by_ticker",
        }, f, indent=2, default=str)
    print(f"\nModels saved to {MODEL_DIR}")


def main():
    print("=" * 60)
    print("KALSHI ML v2 — GroupKFold, Edge-Aware")
    print(f"{datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    df, X, y, feature_cols, groups, obs_hours = load_data()

    n_markets = len(np.unique(groups))
    n_folds = min(5, n_markets // 3)  # Need at least 3 markets per fold
    print(f"\nUsing {n_folds}-fold GroupKFold")

    splits = get_group_splits(X, y, groups, n_splits=n_folds)

    # Verify no leakage
    for i, (tr, va) in enumerate(splits):
        tr_markets = set(groups[tr])
        va_markets = set(groups[va])
        overlap = tr_markets & va_markets
        assert len(overlap) == 0, f"Fold {i} has {len(overlap)} overlapping markets!"
    print("Verified: zero market overlap across folds\n")

    # Train
    xgb_model, xgb_preds, xgb_params, xgb_auc = train_xgboost(X, y, groups, splits, n_trials=80)
    lgb_model, lgb_preds, lgb_params, lgb_auc = train_lightgbm(X, y, groups, splits, n_trials=80)
    nn_model, nn_preds, scaler, nn_params, nn_auc = train_neural_net(X, y, groups, splits, n_trials=30)
    meta, ensemble_preds = train_ensemble(xgb_preds, lgb_preds, nn_preds, y)

    # Evaluate
    print("\n" + "="*60)
    print("EVALUATION (Cross-validated, no leakage)")
    print("="*60)

    results = {}
    for name, preds in [("XGBoost", xgb_preds), ("LightGBM", lgb_preds),
                        ("NeuralNet", nn_preds), ("Ensemble", ensemble_preds)]:
        auc = evaluate_by_horizon(y, preds, obs_hours, name)
        evaluate_trading_edge(df.assign(pred=preds), preds, name)
        results[name] = {"overall_auc": float(auc)}

    # Feature importance
    print("\n--- TOP 20 FEATURES (XGBoost) ---")
    imp = xgb_model.feature_importances_
    for rank, idx in enumerate(np.argsort(imp)[::-1][:20]):
        print(f"  {rank+1:2d}. {feature_cols[idx]:30s} {imp[idx]:.4f}")

    save_all(xgb_model, lgb_model, nn_model, meta, scaler, feature_cols, results)

    print("\n" + "="*60)
    print("TRAINING COMPLETE")
    print("="*60)


if __name__ == "__main__":
    main()
