# Тема 1. Анализ данных.
# Смотрим, что лежит в датасете: пропуски, распределения, связи, выбросы.

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

data = pd.read_csv("moscow_housing_accessibility.csv")

print(f"объявлений: {len(data)}, колонок: {len(data.columns)}, ячеек города: {data.cell_id.nunique()}")
print()

print("Пропуски:")
for column in data.columns:
    n_missing = data[column].isna().sum()
    if n_missing > 0:
        print(f" {column}: {n_missing} ({round(100 * n_missing / len(data), 1)}%)")
print()

print("Главные числа:")
for column in ["price_rub", "price_m2", "area_m2", "age", "t_commute_min", "dist_metro_m"]:
    values = data[column].dropna()
    print(f" {column}: медиана {round(values.median(), 1)}, среднее {round(values.mean(), 1)}, "
          f"от {round(values.min(), 1)} до {round(values.max(), 1)}")
print()

# у цены длинный правый хвост, поэтому дальше почти везде берём логарифм
print(f"асимметрия цены: {round(data.price_rub.skew(), 2)}")
print(f"асимметрия логарифма цены: {round(np.log(data.price_rub).skew(), 2)}")
print()

print("Связь признаков с ценой метра (корреляция Пирсона):")
numeric = ["t_commute_min", "t_commute_gen_min", "dist_metro_m", "dist_km", "logsum",
           "n_retail", "dist_park_km", "industrial_share", "area_m2", "age",
           "ceiling_m", "floors_total"]
correlations = []
for column in numeric:
    r = data[column].corr(data.price_m2)
    correlations.append((column, r))
correlations.sort(key=lambda pair: abs(pair[1]), reverse=True)
for column, r in correlations:
    print(f" {column}: {round(r, 3)}")
print()

# выбросы по правилу полутора межквартильных размахов
print("Выбросы по цене метра:")
q1 = data.price_m2.quantile(0.25)
q3 = data.price_m2.quantile(0.75)
iqr = q3 - q1
low = q1 - 1.5 * iqr
high = q3 + 1.5 * iqr
n_out = len(data[(data.price_m2 < low) | (data.price_m2 > high)])
print(f" границы: {round(low)} и {round(high)} руб/м2")
print(f" за границами: {n_out} объявлений ({round(100 * n_out / len(data), 1)}%)")
print()

print("Цена метра по кольцам (тыс. руб):")
for ring in sorted(data.ring.dropna().unique()):
    part = data[data.ring == ring]
    print(f" кольцо {int(ring)}: медиана {round(part.price_m2.median() / 1000)}, "
          f"время до работы {round(part.t_commute_min.median())} мин, объявлений {len(part)}")
print()

print("Цена метра по материалу стен (тыс. руб):")
for material in data.wall_material.dropna().unique():
    part = data[data.wall_material == material]
    if len(part) >= 30:
        print(f" {material}: {round(part.price_m2.median() / 1000)}, объявлений {len(part)}")

# графики
figure, axes = plt.subplots(2, 2, figsize=(12, 9))

axes[0][0].hist(data.price_m2 / 1000, bins=60, color="#4C72B0")
axes[0][0].set_title("Распределение цены метра")
axes[0][0].set_xlabel("тыс. руб за м2")
axes[0][0].set_ylabel("объявлений")

axes[0][1].hist(np.log(data.price_rub), bins=60, color="#4C72B0")
axes[0][1].set_title("Распределение логарифма цены")
axes[0][1].set_xlabel("ln(цена)")
axes[0][1].set_ylabel("объявлений")

axes[1][0].scatter(data.t_commute_min, data.price_m2 / 1000, s=4, alpha=0.25, color="#4C72B0")
axes[1][0].set_title("Цена метра и время до работы")
axes[1][0].set_xlabel("минуты до работы")
axes[1][0].set_ylabel("тыс. руб за м2")

names = [pair[0] for pair in correlations[:8]]
values = [pair[1] for pair in correlations[:8]]
axes[1][1].barh(names, values, color="#4C72B0")
axes[1][1].set_title("Корреляция с ценой метра")
axes[1][1].axvline(0, color="black", linewidth=0.8)
axes[1][1].invert_yaxis()

plt.tight_layout()
plt.savefig("ml1_analiz.png", dpi=140)
print()
print("график -> ml1_analiz.png")
