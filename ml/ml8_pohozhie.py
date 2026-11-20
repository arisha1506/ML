"""Похожие районы, но дешевле.

Человек нашёл ячейку, которая ему нравится, но дорогая. Вопрос: где ещё в
городе так же близко до работы, так же с метро и магазинами, но метр стоит
меньше. Считаем косинусную близость по признакам места и среди похожих
оставляем те, где предсказанная цена метра ниже.

    python ml/ml8_pohozhie.py    -> ml/ml8_pohozhie.csv
"""
import numpy as np
import pandas as pd

cells = pd.read_parquet("/home/claude/v2run/data/processed/accessibility.parquet")
stock = pd.read_parquet("/home/claude/v2run/data/interim/residential_stock.parquet")
cells = cells.merge(stock[["cell_id", "res_floor_m2"]], on="cell_id", how="left")
cells["res_floor_m2"] = cells.res_floor_m2.fillna(0)
price = pd.read_csv("ml7_karta_tsen.csv").set_index("cell_id").price_m2_pred

# берём только жилые ячейки: в промзонах и парках советовать нечего
cells = cells[cells.res_floor_m2 > 5000].reset_index(drop=True)
cells["price"] = cells.cell_id.map(price)
cells = cells.dropna(subset=["price"]).reset_index(drop=True)
print(f"[ml8] жилых ячеек с ценой: {len(cells):,}")

features = ["t_commute_min", "t_all_jobs_raw_min", "logsum", "dist_metro_m",
            "dist_rail_m", "n_retail", "dist_park_km", "industrial_share"]
X = cells[features].to_numpy(dtype=float)
X = (X - X.mean(axis=0)) / X.std(axis=0)
X = X / np.linalg.norm(X, axis=1, keepdims=True)

rows = []
prices = cells.price.to_numpy()
for i in range(len(cells)):
    similarity = X @ X[i]
    similarity[i] = -2
    cheaper = prices < prices[i] * 0.93        # заметно дешевле, а не на рубль
    similarity[~cheaper] = -2
    best = np.argsort(-similarity)[:3]
    best = [j for j in best if similarity[j] > 0.9]
    if not best:
        continue
    rows.append({"cell_id": cells.cell_id[i],
                 "similar": " ".join(cells.cell_id[j] for j in best)})

out = pd.DataFrame(rows)
out.to_csv("ml8_pohozhie.csv", index=False)
print(f"[ml8] ячеек с советом «похоже, но дешевле»: {len(out):,} -> ml8_pohozhie.csv")
