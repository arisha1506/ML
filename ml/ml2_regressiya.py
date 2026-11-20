# Тема 2. Регрессия.
# Предсказываем цену квартиры. Главная аккуратность — разбивка на фолды по ячейкам
# города, а не по объявлениям: иначе соседние квартиры из одного дома попадут
# и в обучение, и в проверку, и качество будет завышенным.

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupKFold
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.metrics import r2_score, mean_absolute_error

data = pd.read_csv("moscow_housing_accessibility.csv")

flat_features = ["area_m2", "rooms", "floor", "floors_total", "floor_share",
                 "is_first_floor", "is_last_floor", "age", "kitchen_m2",
                 "kitchen_share", "ceiling_m"]
place_features = ["t_commute_min", "t_walk_c", "t_ride_c", "n_transfers_c", "logsum",
                  "dist_metro_m", "dist_rail_m", "n_retail", "dist_park_km",
                  "industrial_share", "dist_km", "res_floor_m2"]
all_features = flat_features + place_features

data = data[data.price_rub.notna() & data.area_m2.notna()]
target = np.log(data.price_rub)
groups = data.cell_id


def check_model(model, features, name):
    # кросс-валидация с разбивкой по ячейкам города
    folds = GroupKFold(n_splits=5)
    predicted = np.zeros(len(data))
    for train_rows, test_rows in folds.split(data, target, groups):
        x_train = data[features].iloc[train_rows]
        x_test = data[features].iloc[test_rows]
        y_train = target.iloc[train_rows]
        if isinstance(model, (LinearRegression, Ridge, RandomForestRegressor)):
            x_train = x_train.fillna(x_train.median())
            x_test = x_test.fillna(x_train.median())
        model.fit(x_train, y_train)
        predicted[test_rows] = model.predict(x_test)
    r2 = r2_score(target, predicted)
    mae_log = mean_absolute_error(target, predicted)
    # средняя ошибка в процентах от цены: удобнее читать, чем ошибка в логарифме
    mae_percent = 100 * np.mean(np.abs(np.exp(predicted) - data.price_rub) / data.price_rub)
    print(f" {name}: R2 {round(r2, 3)}, ошибка в логарифме {round(mae_log, 3)}, "
          f"средняя ошибка {round(mae_percent, 1)}%")
    return predicted, r2, mae_percent


print("Качество на отложенных ячейках, все признаки:")
results = []
models = [(LinearRegression(), "линейная регрессия"),
          (Ridge(alpha=1.0), "гребневая регрессия"),
          (RandomForestRegressor(n_estimators=300, min_samples_leaf=3, random_state=7, n_jobs=-1), "случайный лес"),
          (HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, random_state=7), "градиентный бустинг")]
for model, name in models:
    predicted, r2, mae_percent = check_model(model, all_features, name)
    results.append((name, r2, mae_percent, predicted))
print()

# показываем, сколько качества даёт утечка, если резать выборку случайно
print("Честная разбивка против случайной (градиентный бустинг, все признаки):")
from sklearn.model_selection import KFold
for splitter, name in [(GroupKFold(n_splits=5), "по ячейкам города, честная"),
                       (KFold(n_splits=5, shuffle=True, random_state=7), "случайная по объявлениям")]:
    predicted = np.zeros(len(data))
    for train_rows, test_rows in splitter.split(data, target, groups):
        model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, random_state=7)
        model.fit(data[all_features].iloc[train_rows], target.iloc[train_rows])
        predicted[test_rows] = model.predict(data[all_features].iloc[test_rows])
    mae_percent = 100 * np.mean(np.abs(np.exp(predicted) - data.price_rub) / data.price_rub)
    print(f" {name}: R2 {round(r2_score(target, predicted), 3)}, "
          f"средняя ошибка {round(mae_percent, 1)}%")
print()

print("Сколько даёт транспортная часть (градиентный бустинг):")
for features, name in [(flat_features, "только признаки квартиры"),
                       (flat_features + ["dist_km"], "квартира и расстояние до центра"),
                       (all_features, "квартира, место и доступность")]:
    check_model(HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, random_state=7),
                features, name)
print()

# важность признаков считаем перестановкой: мешаем колонку и смотрим, насколько упало качество
best_model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06, random_state=7)
folds = GroupKFold(n_splits=5)
train_rows, test_rows = next(folds.split(data, target, groups))
best_model.fit(data[all_features].iloc[train_rows], target.iloc[train_rows])
base_score = r2_score(target.iloc[test_rows], best_model.predict(data[all_features].iloc[test_rows]))

importance = []
for feature in all_features:
    shuffled = data[all_features].iloc[test_rows].copy()
    shuffled[feature] = shuffled[feature].sample(frac=1, random_state=3).values
    score = r2_score(target.iloc[test_rows], best_model.predict(shuffled))
    importance.append((feature, base_score - score))
importance.sort(key=lambda pair: pair[1], reverse=True)

print("Важность признаков (насколько падает R2, если перемешать колонку):")
for feature, drop in importance[:12]:
    print(f" {feature}: {round(drop, 4)}")
print()

# предсказание средней цены метра по районам
best_predicted = results[3][3]
data_with_prediction = data.assign(predicted_price=np.exp(best_predicted))
by_district = data_with_prediction.groupby("district").agg(
    объявлений=("price_rub", "size"),
    факт_тыс=("price_m2", lambda column: column.median() / 1000),
    модель_тыс=("predicted_price", lambda column: column.median() / 1000))
by_district = by_district[by_district.объявлений >= 30]
by_district["ошибка_%"] = (100 * (by_district.модель_тыс * 0 + 1)).round(0)
print(f"районов с 30+ объявлениями: {len(by_district)}")
print(f"корреляция фактической и предсказанной медианы по районам: "
      f"{round(by_district.факт_тыс.corr(by_district.модель_тыс), 3)}")

figure, axes = plt.subplots(1, 3, figsize=(15, 4.5))

names = [row[0] for row in results]
scores = [row[1] for row in results]
axes[0].barh(names, scores, color="#4C72B0")
axes[0].set_title("Качество моделей, R2")
axes[0].invert_yaxis()
for i in range(len(scores)):
    axes[0].text(scores[i] - 0.06, i, round(scores[i], 3), color="white", va="center")

axes[1].scatter(np.exp(best_predicted) / 1e6, data.price_rub / 1e6, s=4, alpha=0.25, color="#4C72B0")
limit = 120
axes[1].plot([0, limit], [0, limit], color="black", linewidth=0.9)
axes[1].set_xlim(0, limit)
axes[1].set_ylim(0, limit)
axes[1].set_title("Предсказание и факт, млн руб")
axes[1].set_xlabel("предсказано")
axes[1].set_ylabel("факт")

top_names = [pair[0] for pair in importance[:10]]
top_values = [pair[1] for pair in importance[:10]]
axes[2].barh(top_names, top_values, color="#4C72B0")
axes[2].set_title("Важность признаков")
axes[2].invert_yaxis()

plt.tight_layout()
plt.savefig("ml2_regressiya.png", dpi=140)
print()
print("график -> ml2_regressiya.png")
