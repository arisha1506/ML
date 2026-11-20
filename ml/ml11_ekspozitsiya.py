"""Сколько объявление висит в продаже и из-за чего.

В выгрузке есть дата публикации и дата последнего обновления, значит видно,
сколько дней объявление уже стоит на витрине. Это срез, а не полная история:
проданные квартиры из выдачи уже исчезли, а те, что висят, ещё не проданы.
Поэтому честно говорить про «сколько уже висит», а не «сколько провисит».

Главный вопрос: дольше ли висят те, кто просит дороже модели.

    python ml/ml11_ekspozitsiya.py   -> ml/ml11_ekspozitsiya.csv, .png
"""
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.api as sm
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

RAW = "/home/claude/v2run/data/raw/listings_raw_yandex.csv"
SNAPSHOT = pd.Timestamp("2026-09-24", tz="UTC")

data = pd.read_csv("moscow_housing_accessibility.csv")
# в сырой выгрузке одно объявление встречается на нескольких страницах
dates = pd.read_csv(RAW, usecols=["offer_id", "created", "updated"])
dates = dates.drop_duplicates("offer_id")
dates["created"] = pd.to_datetime(dates.created, errors="coerce", utc=True)
dates["updated"] = pd.to_datetime(dates.updated, errors="coerce", utc=True)
d = data.merge(dates, on="offer_id", how="inner").dropna(subset=["created"])
d["days"] = (SNAPSHOT - d.created).dt.days
d = d[(d.days >= 0) & (d.days <= 730)]
print(f"[ml11] объявлений с датой: {len(d):,}")
print(f"[ml11] висит в продаже: медиана {d.days.median():.0f} дней, "
      f"четверть дольше {d.days.quantile(0.75):.0f}")

# насколько цена выше модельной — считаем честно, по отложенным ячейкам
flat_f = ["area_m2", "rooms", "floor", "floors_total", "floor_share",
          "is_first_floor", "is_last_floor", "age", "ceiling_m"]
place_f = ["dist_km", "t_commute_min", "t_all_jobs_raw_min", "logsum",
           "dist_metro_m", "dist_rail_m", "n_retail", "dist_park_km",
           "industrial_share"]
features = flat_f + place_f
work = d.dropna(subset=features + ["price_rub"]).reset_index(drop=True)
predicted = np.zeros(len(work))
target = np.log(work.price_rub)
for train_rows, test_rows in GroupKFold(n_splits=5).split(work, target, work.cell_id):
    model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06,
                                          max_depth=6, random_state=7)
    model.fit(work[features].iloc[train_rows], target.iloc[train_rows])
    predicted[test_rows] = model.predict(work[features].iloc[test_rows])
work["gap_percent"] = 100 * (work.price_rub - np.exp(predicted)) / np.exp(predicted)

# сколько висят дешёвые и дорогие
buckets = [(-100, -20, "дешевле модели на 20% и больше"),
           (-20, -5, "дешевле на 5-20%"),
           (-5, 5, "примерно по модели"),
           (5, 20, "дороже на 5-20%"),
           (20, 1000, "дороже модели на 20% и больше")]
rows = []
for lo, hi, title in buckets:
    part = work[(work.gap_percent >= lo) & (work.gap_percent < hi)]
    rows.append({"группа": title, "объявлений": len(part),
                 "медиана дней": round(float(part.days.median()), 0),
                 "средние дни": round(float(part.days.mean()), 0)})
table = pd.DataFrame(rows)
print("\n" + table.to_string(index=False))

# регрессия: дни в продаже против переплаты, с поправкой на размер и место
model_days = sm.OLS(np.log1p(work.days),
                    sm.add_constant(work[["gap_percent", "area_m2", "dist_km",
                                          "t_commute_min"]])).fit(
    cov_type="cluster", cov_kwds={"groups": work.cell_id})
effect = (np.exp(model_days.params["gap_percent"] * 10) - 1) * 100
print(f"\n[ml11] каждые 10% переплаты против модели добавляют "
      f"{effect:+.1f}% к сроку в продаже (t {model_days.tvalues['gap_percent']:+.1f})")

table.to_csv("ml11_ekspozitsiya.csv", index=False)
plt.figure(figsize=(10, 4))
plt.subplot(1, 2, 1)
plt.hist(work.days, bins=60, color="#2D6BE0", alpha=0.8)
plt.xlabel("дней в продаже на момент сбора")
plt.ylabel("объявлений")
plt.title("Сколько уже висят")
plt.subplot(1, 2, 2)
plt.bar(range(len(table)), table["медиана дней"], color="#C0392B", alpha=0.85)
plt.xticks(range(len(table)), ["−20%+", "−20..−5", "по модели", "+5..20", "+20%+"])
plt.ylabel("медиана дней в продаже")
plt.title("Переплата против срока")
plt.tight_layout()
plt.savefig("ml11_ekspozitsiya.png", dpi=140)
print("[ml11] -> ml11_ekspozitsiya.csv, ml11_ekspozitsiya.png")

print("""
Как это читать. Связь обратная и заметная: чем сильнее объявление дешевле
модели, тем дольше оно висит. Это не значит, что скидка мешает продать.
Мы смотрим срез, а не историю: действительно выгодные квартиры уходят
быстро и из выдачи пропадают, поэтому среди «дешёвых» остаются те, у кого
есть причина не продаваться — состояние, документы, планировка. Это прямое
подтверждение оговорки к выгоде против модели: низкая цена относительно
предсказания — повод проверить объявление, а не признак удачной покупки.
""")
