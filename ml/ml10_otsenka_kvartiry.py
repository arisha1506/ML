"""Оценка конкретной квартиры прямо на сайте.

Градиентный бустинг в браузер не затащишь, а оценивать квартиру по её
параметрам хочется. Поэтому раскладываем цену на два слагаемых: эффект
места и эффект самой квартиры.

    log(цена) = эффект ячейки + b1*log(площадь) + b2*комнаты + ...

Эффект квартиры оцениваем регрессией с фиксированными эффектами ячеек,
эффект места достаём из предсказания ml7 для стандартной квартиры. В сайт
уезжают семь коэффициентов и по одному числу на ячейку — этого хватает,
чтобы считать цену в браузере.

    python ml/ml10_otsenka_kvartiry.py   -> ml/ml10_otsenka.json
"""
import json

import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.model_selection import GroupKFold

data = pd.read_csv("moscow_housing_accessibility.csv")
standard_price = pd.read_csv("ml7_karta_tsen.csv").set_index("cell_id").price_m2_pred

names = ["log_area", "rooms", "floor_share", "is_first_floor", "is_last_floor",
         "age", "ceiling_m"]
d = data.copy()
d["log_area"] = np.log(d.area_m2)
d = d.dropna(subset=names + ["price_rub", "cell_id"])
print(f"[ml10] объявлений в оценке: {len(d):,}")

# фиксированные эффекты ячеек: вычитаем из всего среднее по ячейке, тогда
# эффект места уходит, а коэффициенты квартиры остаются
y = np.log(d.price_rub)
X = d[names]
y_within = y - y.groupby(d.cell_id).transform("mean")
X_within = X - X.groupby(d.cell_id).transform("mean")
model = sm.OLS(y_within, X_within).fit(
    cov_type="cluster", cov_kwds={"groups": d.cell_id})
coef = {name: float(model.params[name]) for name in names}
print("[ml10] коэффициенты квартиры:")
for name in names:
    print(f"   {name:16s} {model.params[name]:+.4f}   (t {model.tvalues[name]:+.1f})")

# честная проверка: насколько точно это считает цену на отложенных ячейках
folds = GroupKFold(n_splits=5)
predicted = np.zeros(len(d))
Xv, yv, groups = X.to_numpy(), y.to_numpy(), d.cell_id.to_numpy()
for train_rows, test_rows in folds.split(Xv, yv, groups):
    dtr = d.iloc[train_rows]
    ytr = y.iloc[train_rows]
    Xtr = X.iloc[train_rows]
    inner = sm.OLS(ytr - ytr.groupby(dtr.cell_id).transform("mean"),
                   Xtr - Xtr.groupby(dtr.cell_id).transform("mean")).fit()
    base = (ytr - Xtr @ inner.params).groupby(dtr.cell_id).mean()
    overall = float((ytr - Xtr @ inner.params).mean())
    cell_base = d.iloc[test_rows].cell_id.map(base).fillna(overall)
    predicted[test_rows] = cell_base + X.iloc[test_rows] @ inner.params
r2 = 1 - np.sum((y - predicted) ** 2) / np.sum((y - y.mean()) ** 2)
mae = 100 * np.mean(np.abs(np.exp(predicted) - d.price_rub) / d.price_rub)
print(f"[ml10] проверка по ячейкам: R2 {r2:.3f}, средняя ошибка {mae:.1f}%")

# эффект места для всех ячеек: из предсказания ml7 вычитаем вклад стандартной
# квартиры, тогда остаётся чистое «сколько стоит быть здесь»
standard = {"log_area": float(np.log(data.area_m2.median())),
            "rooms": float(data.rooms.median()),
            "floor_share": float(data.floor_share.median()),
            "is_first_floor": 0.0, "is_last_floor": 0.0,
            "age": float(data.age.median()),
            "ceiling_m": float(data.ceiling_m.median())}
flat_part = sum(coef[k] * standard[k] for k in names)
area_standard = float(data.area_m2.median())
base_by_cell = {}
for cell_id, price_m2 in standard_price.items():
    base_by_cell[cell_id] = round(float(np.log(price_m2 * area_standard) - flat_part), 4)

out = {"coef": {k: round(v, 5) for k, v in coef.items()},
       "standard": {k: round(v, 4) for k, v in standard.items()},
       "r2": round(float(r2), 3), "mae_percent": round(float(mae), 1),
       "base": base_by_cell}
with open("ml10_otsenka.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"[ml10] ячеек с эффектом места: {len(base_by_cell):,} -> ml10_otsenka.json")

# сверка: как эта простая формула ложится на реальные объявления
check = np.exp([base_by_cell.get(c, 0) for c in d.cell_id] + X.to_numpy() @ np.array([coef[n] for n in names]))
err = 100 * np.mean(np.abs(check - d.price_rub) / d.price_rub)
print(f"[ml10] формула против фактических цен: средняя ошибка {err:.1f}%")

# --- честная проверка всей цепочки целиком ---
# В браузере эффект места берётся не из среднего, а из предсказания ml7.
# Поэтому проверяем так же: для отложенных ячеек бустинг тоже учится без них.
from sklearn.ensemble import HistGradientBoostingRegressor

cells_tbl = pd.read_parquet("/home/claude/v2run/data/processed/accessibility.parquet")
stock = pd.read_parquet("/home/claude/v2run/data/interim/residential_stock.parquet")
cells_tbl = cells_tbl.merge(stock[["cell_id", "res_floor_m2"]], on="cell_id", how="left")
cells_tbl["res_floor_m2"] = cells_tbl.res_floor_m2.fillna(0)

flat_f = ["area_m2", "rooms", "floor", "floors_total", "floor_share",
          "is_first_floor", "is_last_floor", "age", "ceiling_m"]
place_f = ["dist_km", "t_commute_min", "t_all_jobs_raw_min", "logsum",
           "dist_metro_m", "dist_rail_m", "n_retail", "dist_park_km",
           "industrial_share", "res_floor_m2"]
big = data.dropna(subset=flat_f + place_f + ["price_rub"]).reset_index(drop=True)
std_flat = {k: float(data[k].median()) for k in flat_f}

chain = np.zeros(len(d))
d_index = {oid: k for k, oid in enumerate(d.offer_id)}
for train_rows, test_rows in GroupKFold(n_splits=5).split(big, big.price_rub, big.cell_id):
    tr = big.iloc[train_rows]
    gb = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06,
                                       max_depth=6, random_state=7)
    gb.fit(tr[flat_f + place_f], np.log(tr.price_rub))
    test_cells = big.iloc[test_rows].cell_id.unique()
    grid = cells_tbl[cells_tbl.cell_id.isin(test_cells)].copy()
    for k, v in std_flat.items():
        grid[k] = v
    grid["pred_standard"] = np.exp(gb.predict(grid[flat_f + place_f]))
    base_fold = dict(zip(grid.cell_id, np.log(grid.pred_standard) - flat_part))
    for row in big.iloc[test_rows].itertuples():
        k = d_index.get(row.offer_id)
        if k is None or row.cell_id not in base_fold:
            continue
        x = np.array([np.log(row.area_m2), row.rooms, row.floor_share,
                      row.is_first_floor, row.is_last_floor, row.age, row.ceiling_m])
        chain[k] = base_fold[row.cell_id] + float(x @ np.array([coef[n] for n in names]))

good = chain != 0
chain_err = 100 * np.mean(np.abs(np.exp(chain[good]) - d.price_rub.to_numpy()[good])
                          / d.price_rub.to_numpy()[good])
chain_r2 = 1 - np.sum((y.to_numpy()[good] - chain[good]) ** 2) / \
            np.sum((y.to_numpy()[good] - y.to_numpy()[good].mean()) ** 2)
print(f"[ml10] вся цепочка на отложенных ячейках ({good.sum():,} объявлений): "
      f"R2 {chain_r2:.3f}, средняя ошибка {chain_err:.1f}%")

out["chain_r2"] = round(float(chain_r2), 3)
out["chain_mae_percent"] = round(float(chain_err), 1)
with open("ml10_otsenka.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
