# Тема 6. Рекомендации.
# Две задачи. Первая: человек задаёт бюджет, минимальную площадь и сколько готов
# ехать — подбираем варианты и сортируем по выгоде относительно модели.
# Вторая: нашли подходящую квартиру — показываем похожие на неё.

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

data = pd.read_csv("moscow_housing_accessibility.csv")
data = data[data.price_rub.notna() & data.area_m2.notna()].reset_index(drop=True)

features = ["area_m2", "rooms", "floor", "floors_total", "age", "kitchen_share",
            "ceiling_m", "t_commute_min", "dist_metro_m", "n_retail",
            "dist_park_km", "industrial_share", "dist_km"]

# честная цена квартиры по модели, обученной на других ячейках
target = np.log(data.price_rub)
predicted = np.zeros(len(data))
folds = GroupKFold(n_splits=5)
for train_rows, test_rows in folds.split(data, target, data.cell_id):
    model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, random_state=7)
    model.fit(data[features].iloc[train_rows], target.iloc[train_rows])
    predicted[test_rows] = model.predict(data[features].iloc[test_rows])
data["fair_price"] = np.exp(predicted)
data["benefit_percent"] = 100 * (data.fair_price - data.price_rub) / data.fair_price


def recommend(budget, min_area, max_commute, n=10):
    # отбираем подходящее и сортируем по выгоде относительно модельной цены
    suitable = data[(data.price_rub <= budget) &
                    (data.area_m2 >= min_area) &
                    (data.t_commute_min <= max_commute)]
    print(f"бюджет {round(budget / 1e6)} млн, от {min_area} м2, не дольше {max_commute} мин "
          f"-> подходит {len(suitable)} объявлений")
    if len(suitable) == 0:
        print(" ничего не нашлось, стоит ослабить одно из условий")
        return suitable
    best = suitable.sort_values("benefit_percent", ascending=False).head(n)
    for _, row in best.iterrows():
        print(f" {row.district}, {int(row.rooms)}-к, {round(row.area_m2)} м2, "
              f"{round(row.price_rub / 1e6, 1)} млн (модель: {round(row.fair_price / 1e6, 1)} млн, "
              f"выгода {round(row.benefit_percent)}%), до работы {round(row.t_commute_min)} мин")
    return best


print("Подбор вариантов")
print()
for budget, min_area, max_commute in [(15e6, 45, 50), (25e6, 60, 45), (40e6, 80, 35)]:
    recommend(budget, min_area, max_commute, n=5)
    print()

# насколько мягче условия — настолько больше выбор
print("Сколько вариантов при разных требованиях ко времени (бюджет 20 млн, от 50 м2):")
for max_commute in [30, 40, 50, 60, 90]:
    n = len(data[(data.price_rub <= 20e6) & (data.area_m2 >= 50) & (data.t_commute_min <= max_commute)])
    print(f" не дольше {max_commute} мин: {n} вариантов")
print()

# похожие квартиры: косинусная близость по нормированным признакам
similar_features = ["area_m2", "rooms", "age", "floors_total", "t_commute_min",
                    "dist_metro_m", "n_retail", "dist_km"]
scaler = StandardScaler()
matrix = scaler.fit_transform(data[similar_features].fillna(data[similar_features].median()))
lengths = np.sqrt((matrix ** 2).sum(axis=1))


def similar_to(row_number, n=5):
    target_vector = matrix[row_number]
    closeness = matrix.dot(target_vector) / (lengths * np.sqrt((target_vector ** 2).sum()))
    order = np.argsort(-closeness)
    chosen = data.iloc[order[1:n + 1]]
    base = data.iloc[row_number]
    print(f"Похожие на: {base.district}, {int(base.rooms)}-к, {round(base.area_m2)} м2, "
          f"{round(base.price_rub / 1e6, 1)} млн, до работы {round(base.t_commute_min)} мин")
    for _, row in chosen.iterrows():
        print(f" {row.district}, {int(row.rooms)}-к, {round(row.area_m2)} м2, "
              f"{round(row.price_rub / 1e6, 1)} млн, до работы {round(row.t_commute_min)} мин, "
              f"выгода {round(row.benefit_percent)}%")
    return chosen


print("Похожие квартиры")
print()
example = data[(data.rooms == 2) & (data.area_m2.between(55, 65))].index[0]
similar_to(example, n=5)
print()

# проверка: действительно ли рекомендованные выгоднее случайных
best = data.sort_values("benefit_percent", ascending=False).head(200)
print("Проверка подбора:")
print(f" топ-200 по выгоде: медианная цена метра {round(best.price_m2.median() / 1000)} тыс, "
      f"до работы {round(best.t_commute_min.median())} мин")
print(f" вся выборка: медианная цена метра {round(data.price_m2.median() / 1000)} тыс, "
      f"до работы {round(data.t_commute_min.median())} мин")

data[["offer_id", "district", "rooms", "area_m2", "price_rub", "fair_price",
      "benefit_percent", "t_commute_min"]].sort_values("benefit_percent", ascending=False).to_csv(
    "ml6_rekomendatsii.csv", index=False, encoding="utf-8")

figure, axes = plt.subplots(1, 2, figsize=(11, 4.5))

for max_commute, color in [(30, "#4C72B0"), (45, "#DD8452"), (60, "#55A868")]:
    part = data[data.t_commute_min <= max_commute]
    axes[0].scatter(part.area_m2, part.price_rub / 1e6, s=4, alpha=0.3, color=color,
                    label=f"до {max_commute} мин")
axes[0].set_xlim(0, 200)
axes[0].set_ylim(0, 150)
axes[0].set_title("Что можно купить при разных требованиях ко времени")
axes[0].set_xlabel("площадь, м2")
axes[0].set_ylabel("цена, млн руб")
axes[0].legend()

axes[1].hist(data.benefit_percent.clip(-100, 60), bins=60, color="#4C72B0")
axes[1].axvline(0, color="black", linewidth=0.9)
axes[1].set_title("Выгода относительно модельной цены")
axes[1].set_xlabel("процентов")
axes[1].set_ylabel("объявлений")

plt.tight_layout()
plt.savefig("ml6_rekomendatsii.png", dpi=140)
print()
print("таблица -> ml6_rekomendatsii.csv, график -> ml6_rekomendatsii.png")
