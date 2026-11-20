# Тема 3. Классификация.
# Задача: по характеристикам квартиры и её места предсказать, попадёт ли она
# в дорогую половину города по цене метра. Цену в признаки, конечно, не кладём.

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.model_selection import GroupKFold
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (accuracy_score, roc_auc_score, confusion_matrix,
                             precision_score, recall_score, f1_score, roc_curve)

data = pd.read_csv("moscow_housing_accessibility.csv")
data = data[data.price_m2.notna()]

border = data.price_m2.median()
data["is_expensive"] = (data.price_m2 > border).astype(int)
print(f"граница дорогой половины: {round(border / 1000)} тыс. руб за м2")
print(f"дорогих: {data.is_expensive.sum()}, дешёвых: {len(data) - data.is_expensive.sum()}")
print()

features = ["area_m2", "rooms", "floor", "floors_total", "floor_share", "is_first_floor",
            "is_last_floor", "age", "kitchen_share", "ceiling_m", "t_commute_min",
            "t_walk_c", "t_ride_c", "n_transfers_c", "logsum", "dist_metro_m",
            "dist_rail_m", "n_retail", "dist_park_km", "industrial_share", "dist_km"]

target = data.is_expensive
groups = data.cell_id


def check_model(model, name, scale):
    folds = GroupKFold(n_splits=5)
    probability = np.zeros(len(data))
    for train_rows, test_rows in folds.split(data, target, groups):
        x_train = data[features].iloc[train_rows]
        x_test = data[features].iloc[test_rows]
        fill = x_train.median()
        x_train = x_train.fillna(fill)
        x_test = x_test.fillna(fill)
        if scale:
            scaler = StandardScaler()
            x_train = scaler.fit_transform(x_train)
            x_test = scaler.transform(x_test)
        model.fit(x_train, target.iloc[train_rows])
        probability[test_rows] = model.predict_proba(x_test)[:, 1]
    predicted = (probability > 0.5).astype(int)
    print(f" {name}: доля верных {round(accuracy_score(target, predicted), 3)}, "
          f"ROC AUC {round(roc_auc_score(target, probability), 3)}, "
          f"точность {round(precision_score(target, predicted), 3)}, "
          f"полнота {round(recall_score(target, predicted), 3)}, "
          f"F1 {round(f1_score(target, predicted), 3)}")
    return probability


print("Качество на отложенных ячейках:")
results = []
models = [(LogisticRegression(max_iter=2000), "логистическая регрессия", True),
          (RandomForestClassifier(n_estimators=300, min_samples_leaf=3, random_state=7, n_jobs=-1), "случайный лес", False),
          (HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, random_state=7), "градиентный бустинг", False)]
for model, name, scale in models:
    results.append((name, check_model(model, name, scale)))
print()

best_name, best_probability = results[2]
predicted = (best_probability > 0.5).astype(int)
matrix = confusion_matrix(target, predicted)
print("Матрица ошибок лучшей модели (строки — факт, столбцы — предсказание):")
print(f" дешёвая: верно {matrix[0][0]}, ошибочно названа дорогой {matrix[0][1]}")
print(f" дорогая: ошибочно названа дешёвой {matrix[1][0]}, верно {matrix[1][1]}")
print()

print("Как меняется качество, если убирать группы признаков:")
sets = [(features, "все признаки"),
        ([f for f in features if f not in ["t_commute_min", "t_walk_c", "t_ride_c",
                                           "n_transfers_c", "logsum"]], "без транспортной доступности"),
        ([f for f in features if f not in ["dist_km"]], "без расстояния до центра"),
        (["area_m2", "rooms", "floor", "floors_total", "age", "ceiling_m"], "только квартира")]
for feature_set, name in sets:
    folds = GroupKFold(n_splits=5)
    probability = np.zeros(len(data))
    for train_rows, test_rows in folds.split(data, target, groups):
        model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, random_state=7)
        model.fit(data[feature_set].iloc[train_rows], target.iloc[train_rows])
        probability[test_rows] = model.predict_proba(data[feature_set].iloc[test_rows])[:, 1]
    print(f" {name}: ROC AUC {round(roc_auc_score(target, probability), 3)}")

figure, axes = plt.subplots(1, 2, figsize=(11, 4.5))

for name, probability in results:
    false_positive, true_positive, _ = roc_curve(target, probability)
    axes[0].plot(false_positive, true_positive, label=f"{name} ({round(roc_auc_score(target, probability), 3)})")
axes[0].plot([0, 1], [0, 1], color="black", linewidth=0.8)
axes[0].set_title("ROC-кривые")
axes[0].set_xlabel("доля ложных тревог")
axes[0].set_ylabel("доля пойманных дорогих")
axes[0].legend()
axes[0].grid(True, alpha=0.3)

axes[1].imshow(matrix, cmap="Blues")
axes[1].set_xticks([0, 1])
axes[1].set_xticklabels(["предсказана дешёвая", "предсказана дорогая"])
axes[1].set_yticks([0, 1])
axes[1].set_yticklabels(["факт дешёвая", "факт дорогая"])
for i in range(2):
    for j in range(2):
        axes[1].text(j, i, matrix[i][j], ha="center", va="center", fontsize=14)
axes[1].set_title("Матрица ошибок")

plt.tight_layout()
plt.savefig("ml3_klassifikatsiya.png", dpi=140)
print()
print("график -> ml3_klassifikatsiya.png")
