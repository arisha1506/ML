"""Сегменты рынка: какие бывают квартиры, а не какие бывают районы.

В ml5 кластеризованы места. Здесь кластеризуются сами объявления: модель
ищет, на какие типы распадается предложение, если смотреть и на квартиру,
и на её окружение. Цена в признаки не входит, иначе кластеры свелись бы к
«дорогие» и «дешёвые».

    python ml/ml12_segmenty.py   -> ml/ml12_segmenty.csv, .png
"""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

data = pd.read_csv("moscow_housing_accessibility.csv")
features = ["area_m2", "rooms", "floors_total", "age", "ceiling_m",
            "floor_share", "dist_km", "t_commute_min", "dist_metro_m",
            "n_retail", "industrial_share"]
d = data.dropna(subset=features + ["price_m2"]).reset_index(drop=True)
# в выгрузке встречаются опечатки: потолок 83 метра и подобное
d = d[(d.ceiling_m > 2.2) & (d.ceiling_m < 5.0)]
d = d[(d.area_m2 > 15) & (d.area_m2 < 400)].reset_index(drop=True)
X = StandardScaler().fit_transform(d[features])
print(f"[ml12] объявлений: {len(d):,}")

print("\nсколько сегментов брать:")
scores = []
for k in range(2, 8):
    labels = KMeans(n_clusters=k, n_init=10, random_state=7).fit_predict(X)
    score = silhouette_score(X, labels, sample_size=3000, random_state=7)
    scores.append((k, score))
    print(f"   k = {k}: силуэт {score:.3f}")
best_k = 5

model = KMeans(n_clusters=best_k, n_init=10, random_state=7)
d["segment"] = model.fit_predict(X)

table = d.groupby("segment").agg(
    объявлений=("price_m2", "size"),
    площадь=("area_m2", "median"),
    комнат=("rooms", "median"),
    этажность=("floors_total", "median"),
    возраст=("age", "median"),
    потолки=("ceiling_m", "median"),
    до_центра=("dist_km", "median"),
    до_метро=("dist_metro_m", "median"),
    до_работы=("t_commute_min", "median"),
    цена_метра=("price_m2", "median"), ).round(1)

# имена даём по тому, что реально отличает сегмент
names = {}
for segment, row in table.iterrows():
    if row.возраст > 50 and row.потолки > 2.9:
        names[segment] = "старый фонд с высокими потолками"
    elif row.возраст < 12 and row.этажность > 20:
        names[segment] = "новые высотки"
    elif row.до_метро > 3000:
        names[segment] = "далеко от метро"
    elif row.возраст > 40:
        names[segment] = "панель и кирпич советских лет"
    else:
        names[segment] = "массовая застройка нулевых"
seen = {}
for segment in list(names):
    base = names[segment]
    if base in seen.values():
        names[segment] = base + ", крупнее" if table.loc[segment].площадь > 60 else base + ", компактнее"
    seen[segment] = names[segment]

table["сегмент"] = [names[i] for i in table.index]
print("\n" + table.to_string())

table.to_csv("ml12_segmenty.csv")
d[["offer_id", "cell_id", "segment"]].assign(
    name=lambda x: x.segment.map(names)).to_csv("ml12_segmenty_obyavleniya.csv", index=False)

plt.figure(figsize=(11, 4.2))
plt.subplot(1, 2, 1)
plt.plot([k for k, _ in scores], [s for _, s in scores], marker="o", color="#2D6BE0")
plt.xlabel("число сегментов")
plt.ylabel("силуэт")
plt.title("Насколько сегменты разделены")
plt.subplot(1, 2, 2)
order = table.цена_метра.sort_values().index
plt.barh([names[i] for i in order], table.цена_метра[order] / 1000, color="#C0392B", alpha=0.85)
plt.xlabel("медианная цена метра, тыс руб")
plt.title("Цена метра по сегментам")
plt.tight_layout()
plt.savefig("ml12_segmenty.png", dpi=140)
print("\n[ml12] -> ml12_segmenty.csv, ml12_segmenty_obyavleniya.csv, ml12_segmenty.png")
