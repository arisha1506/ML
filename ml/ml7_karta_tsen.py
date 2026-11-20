"""Предсказанная цена метра для всех 4 039 ячеек города.

Зачем. Объявления есть только в 1 467 ячейках, а цена метра честно считается
только там, где их хотя бы три — это 777 ячеек из 4 039. Три четверти карты
пустые. Модель умеет закрыть эту дыру: она выучена на объявлениях и может
сказать, сколько стоил бы метр в ячейке, где объявлений нет.

Считаем цену одной и той же стандартной квартиры во всех ячейках, чтобы
карта сравнивала места, а не квартиры.

    python ml/ml7_karta_tsen.py
      -> ml/ml7_karta_tsen.csv, ml/ml7_karta_tsen.png
"""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

data = pd.read_csv("moscow_housing_accessibility.csv")
cells = pd.read_parquet("/home/claude/v2run/data/processed/accessibility.parquet")
stock = pd.read_parquet("/home/claude/v2run/data/interim/residential_stock.parquet")
cells = cells.merge(stock[["cell_id", "res_floor_m2"]], on="cell_id", how="left")
cells["res_floor_m2"] = cells.res_floor_m2.fillna(0)

# признаки квартиры и признаки места: место берём из таблицы ячеек, чтобы
# потом подставить его для любой ячейки, даже без объявлений
flat_features = ["area_m2", "rooms", "floor", "floors_total", "floor_share",
                 "is_first_floor", "is_last_floor", "age", "ceiling_m"]
place_features = ["dist_km", "t_commute_min", "t_all_jobs_raw_min", "logsum",
                  "dist_metro_m", "dist_rail_m", "n_retail", "dist_park_km",
                  "industrial_share", "res_floor_m2"]
features = flat_features + place_features

X = data[features]
target = np.log(data.price_rub)
groups = data.cell_id

# проверка честная: обучение и тест разнесены по ячейкам города
folds = GroupKFold(n_splits=5)
predicted = np.zeros(len(data))
for train_rows, test_rows in folds.split(X, target, groups):
    model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06,
                                          max_depth=6, random_state=7)
    model.fit(X.iloc[train_rows], target.iloc[train_rows])
    predicted[test_rows] = model.predict(X.iloc[test_rows])

r2 = 1 - np.sum((target - predicted) ** 2) / np.sum((target - target.mean()) ** 2)
mae_percent = 100 * np.mean(np.abs(np.exp(predicted) - data.price_rub) / data.price_rub)
print(f"[ml7] проверка по ячейкам: R2 {r2:.3f}, средняя ошибка {mae_percent:.1f}%")

# финальная модель на всех данных
model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06,
                                      max_depth=6, random_state=7)
model.fit(X, target)

# стандартная квартира: медиана выборки, одна и та же для всех ячеек
standard = {}
for name in flat_features:
    standard[name] = float(data[name].median())
print("[ml7] стандартная квартира: "
      + ", ".join(f"{k} {v:g}" for k, v in standard.items()))

grid = cells[["cell_id"] + place_features].dropna().copy()
for name, value in standard.items():
    grid[name] = value
grid["price_pred"] = np.exp(model.predict(grid[features]))
grid["price_m2_pred"] = grid.price_pred / standard["area_m2"]

# насколько предсказание совпадает с фактом там, где объявления есть
fact = data.groupby("cell_id").price_m2.median()
check = grid.set_index("cell_id").join(fact.rename("price_m2_fact"), how="inner")
check = check.dropna(subset=["price_m2_fact"])
n_fact = data.groupby("cell_id").size()
check = check[check.index.map(n_fact) >= 3]
err = 100 * np.mean(np.abs(check.price_m2_pred - check.price_m2_fact) / check.price_m2_fact)
print(f"[ml7] там, где объявления есть ({len(check)} ячеек): "
      f"расхождение с медианой объявлений {err:.1f}%")

out = grid[["cell_id", "price_m2_pred"]].copy()
out["price_m2_pred"] = out.price_m2_pred.round(0)
out.to_csv("ml7_karta_tsen.csv", index=False)
print(f"[ml7] ячеек с предсказанной ценой: {len(out)} -> ml7_karta_tsen.csv")

plt.figure(figsize=(11, 4.2))
plt.subplot(1, 2, 1)
plt.hist(out.price_m2_pred / 1000, bins=50, color="#C0392B", alpha=0.8)
plt.xlabel("предсказанная цена метра, тыс руб")
plt.ylabel("ячеек")
plt.title("Цена метра по всему городу")
plt.subplot(1, 2, 2)
plt.scatter(check.price_m2_fact / 1000, check.price_m2_pred / 1000, s=6, alpha=0.4,
            color="#2D6BE0")
lo = min(check.price_m2_fact.min(), check.price_m2_pred.min()) / 1000
hi = max(check.price_m2_fact.max(), check.price_m2_pred.max()) / 1000
plt.plot([lo, hi], [lo, hi], color="#8C8C8C", linewidth=1)
plt.xlabel("медиана объявлений, тыс руб")
plt.ylabel("предсказание модели, тыс руб")
plt.title(f"Сверка там, где объявления есть ({err:.0f}%)")
plt.tight_layout()
plt.savefig("ml7_karta_tsen.png", dpi=140)
print("[ml7] график -> ml7_karta_tsen.png")
