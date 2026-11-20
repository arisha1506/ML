# Тема 5. Кластеризация.
# Разбиваем ячейки города на типы по доступности и среде. Цены в признаках нет:
# хотим получить типы районов, а потом посмотреть, как по ним различается цена.

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

data = pd.read_csv("moscow_housing_accessibility.csv")

features = ["t_commute_min", "t_walk_c", "t_ride_c", "n_transfers_c", "logsum",
            "dist_metro_m", "dist_rail_m", "n_retail", "dist_park_km",
            "industrial_share", "dist_km", "res_floor_m2"]

# одна строка — одна ячейка города, а не объявление
cells = data.groupby("cell_id")[features + ["price_m2", "lat", "lon"]].median()
cells["объявлений"] = data.groupby("cell_id").size()
cells = cells.dropna(subset=features)
print(f"ячеек для кластеризации: {len(cells)}")
print()

scaler = StandardScaler()
x = scaler.fit_transform(cells[features])

print("Подбор числа кластеров:")
inertia = []
silhouette = []
for k in range(2, 11):
    model = KMeans(n_clusters=k, n_init=10, random_state=7)
    labels = model.fit_predict(x)
    inertia.append(model.inertia_)
    score = silhouette_score(x, labels)
    silhouette.append(score)
    print(f" k = {k}: инерция {round(model.inertia_)}, силуэт {round(score, 3)}")
print()

k = 5
model = KMeans(n_clusters=k, n_init=20, random_state=7)
cells["cluster"] = model.fit_predict(x)

print(f"Описание {k} кластеров (медианы по ячейкам):")
for cluster in range(k):
    part = cells[cells.cluster == cluster]
    print(f" кластер {cluster}: ячеек {len(part)}, "
          f"до работы {round(part.t_commute_min.median())} мин, "
          f"до метро {round(part.dist_metro_m.median())} м, "
          f"от центра {round(part.dist_km.median(), 1)} км, "
          f"магазинов {round(part.n_retail.median())}, "
          f"промзона {round(100 * part.industrial_share.median())}%, "
          f"цена метра {round(part.price_m2.median() / 1000)} тыс")
print()

# даём кластерам человеческие имена по их же характеристикам
names = {}
order = cells.groupby("cluster").t_commute_min.median().sort_values().index
labels_by_rank = ["рядом с метро", "у промзон", "спальные дальние",
                  "за городом у электрички", "дальние без метро"]
for position in range(k):
    names[order[position]] = labels_by_rank[position]
cells["type"] = cells.cluster.map(names)

print("Цена метра по типам районов:")
for cluster in order:
    part = cells[cells.cluster == cluster]
    print(f" {names[cluster]}: {round(part.price_m2.median() / 1000)} тыс руб за м2, ячеек {len(part)}")
print()

spread = cells.groupby("cluster").price_m2.median()
print(f"разрыв между самым дорогим и самым дешёвым типом: "
      f"{round(spread.max() / spread.min(), 2)} раза")

cells.reset_index().to_csv("ml5_tipy_rayonov.csv", index=False, encoding="utf-8")

pca = PCA(n_components=2)
coordinates = pca.fit_transform(x)
print(f"две главные компоненты объясняют {round(100 * pca.explained_variance_ratio_.sum())}% разброса")

figure, axes = plt.subplots(1, 3, figsize=(16, 5))

axes[0].plot(range(2, 11), inertia, marker="o", color="#4C72B0")
axes[0].set_title("Локоть: инерция по числу кластеров")
axes[0].set_xlabel("число кластеров")
axes[0].grid(True, alpha=0.3)

colors = ["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3"]
for cluster in range(k):
    mask = cells.cluster == cluster
    axes[1].scatter(coordinates[mask.values, 0], coordinates[mask.values, 1],
                    s=10, alpha=0.6, color=colors[cluster], label=names[cluster])
axes[1].set_title("Кластеры в двух главных компонентах")
axes[1].legend(fontsize=8)

for cluster in range(k):
    part = cells[cells.cluster == cluster]
    axes[2].scatter(part.lon, part.lat, s=9, color=colors[cluster], label=names[cluster])
axes[2].set_title("Типы районов на карте города")
axes[2].set_xlabel("долгота")
axes[2].set_ylabel("широта")
axes[2].legend(fontsize=8)

plt.tight_layout()
plt.savefig("ml5_klasterizatsiya.png", dpi=140)
print()
print("таблица -> ml5_tipy_rayonov.csv, график -> ml5_klasterizatsiya.png")
