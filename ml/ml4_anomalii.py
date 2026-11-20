# Тема 4. Поиск аномалий.
# Два взгляда. Первый: необычные объявления сами по себе, без оглядки на цену
# (изолирующий лес). Второй, полезный покупателю: квартиры, которые стоят сильно
# дешевле или дороже, чем предсказывает модель по их характеристикам и месту.

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.ensemble import IsolationForest, HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

data = pd.read_csv("moscow_housing_accessibility.csv")
data = data[data.price_rub.notna() & data.area_m2.notna()].reset_index(drop=True)

features = ["area_m2", "rooms", "floor", "floors_total", "age", "kitchen_share",
            "ceiling_m", "t_commute_min", "dist_metro_m", "n_retail",
            "dist_park_km", "industrial_share", "dist_km"]

# первый взгляд: необычные сочетания признаков
x = data[features].fillna(data[features].median())
forest = IsolationForest(contamination=0.02, random_state=7, n_estimators=300)
data["anomaly_score"] = -forest.fit(x).score_samples(x)
data["is_strange"] = forest.predict(x) == -1

print(f"изолирующий лес пометил необычными: {data.is_strange.sum()} объявлений "
      f"({round(100 * data.is_strange.mean(), 1)}%)")
print()
print("Чем необычные отличаются от обычных (медианы):")
for column in ["price_m2", "area_m2", "age", "floors_total", "t_commute_min", "dist_metro_m"]:
    strange = data[data.is_strange][column].median()
    normal = data[~data.is_strange][column].median()
    print(f" {column}: необычные {round(strange, 1)}, обычные {round(normal, 1)}")
print()

# второй взгляд: отклонение цены от модели
target = np.log(data.price_rub)
predicted = np.zeros(len(data))
folds = GroupKFold(n_splits=5)
for train_rows, test_rows in folds.split(data, target, data.cell_id):
    model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, random_state=7)
    model.fit(data[features].iloc[train_rows], target.iloc[train_rows])
    predicted[test_rows] = model.predict(data[features].iloc[test_rows])

data["predicted_price"] = np.exp(predicted)
data["gap_percent"] = 100 * (data.price_rub - data.predicted_price) / data.predicted_price

print("Отклонение цены от модели:")
print(f" медиана {round(data.gap_percent.median(), 1)}%, "
      f"стандартное отклонение {round(data.gap_percent.std(), 1)}%")
for border in [30, 50]:
    n_cheap = len(data[data.gap_percent < -border])
    n_dear = len(data[data.gap_percent > border])
    print(f" дешевле модели больше чем на {border}%: {n_cheap}; "
          f"дороже больше чем на {border}%: {n_dear}")
print()

cheap = data.sort_values("gap_percent").head(10)
print("Десять квартир, которые дешевле всего относительно своих характеристик:")
for _, row in cheap.iterrows():
    print(f" {row.district}, {int(row.rooms)}-к, {round(row.area_m2)} м2, "
          f"{round(row.price_rub / 1e6, 1)} млн при модельных "
          f"{round(row.predicted_price / 1e6, 1)} млн ({round(row.gap_percent)}%), "
          f"до работы {round(row.t_commute_min)} мин")
print()

print("Районы, где чаще всего встречаются квартиры дешевле модели (от 30 объявлений):")
by_district = data.groupby("district").agg(
    объявлений=("price_rub", "size"),
    доля_дешёвых=("gap_percent", lambda column: (column < -20).mean()),
    медианный_разрыв=("gap_percent", "median"))
by_district = by_district[by_district.объявлений >= 30].sort_values("доля_дешёвых", ascending=False)
for name, row in by_district.head(8).iterrows():
    print(f" {name}: {round(100 * row.доля_дешёвых)}% дешевле модели на 20%+, "
          f"медианный разрыв {round(row.медианный_разрыв)}%, объявлений {int(row.объявлений)}")

data[["offer_id", "district", "rooms", "area_m2", "price_rub", "predicted_price",
      "gap_percent", "anomaly_score", "is_strange", "t_commute_min"]].to_csv(
    "ml4_anomalii_tablitsa.csv", index=False, encoding="utf-8")

figure, axes = plt.subplots(1, 3, figsize=(15, 4.5))

axes[0].hist(data.gap_percent.clip(-100, 200), bins=70, color="#4C72B0")
axes[0].axvline(0, color="black", linewidth=0.9)
axes[0].set_title("Отклонение цены от модели")
axes[0].set_xlabel("процентов")
axes[0].set_ylabel("объявлений")

axes[1].scatter(data.t_commute_min, data.price_m2 / 1000, s=4, alpha=0.2, color="#AAB4C2")
strange = data[data.is_strange]
axes[1].scatter(strange.t_commute_min, strange.price_m2 / 1000, s=14, color="#C44E52", label="необычные")
axes[1].set_title("Что пометил изолирующий лес")
axes[1].set_xlabel("минуты до работы")
axes[1].set_ylabel("тыс. руб за м2")
axes[1].legend()

names = list(by_district.head(8).index)
values = [100 * v for v in by_district.head(8).доля_дешёвых]
axes[2].barh(names, values, color="#4C72B0")
axes[2].set_title("Доля квартир дешевле модели на 20%+")
axes[2].set_xlabel("процентов объявлений района")
axes[2].invert_yaxis()

plt.tight_layout()
plt.savefig("ml4_anomalii.png", dpi=140)
print()
print("таблица -> ml4_anomalii_tablitsa.csv, график -> ml4_anomalii.png")
