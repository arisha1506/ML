# Сборка единого датасета для ML: одна строка — одно объявление о продаже квартиры.
# Источники подписаны в словаре полей (dataset_dictionary.csv).

import pandas as pd

PROJECT = "/home/claude/v2run"

listings = pd.read_parquet(PROJECT + "/data/processed/listings_clean.parquet")
cells = pd.read_parquet(PROJECT + "/data/interim/cells.parquet")
access = pd.read_parquet(PROJECT + "/data/processed/accessibility.parquet")
stock = pd.read_parquet(PROJECT + "/data/interim/residential_stock.parquet")

# в проекте основной регрессор — сырые минуты, обобщённые идут отдельной колонкой
access = access.rename(columns={"t_commute_min": "t_commute_gen_min",
                                "t_commute_raw_min": "t_commute_min"})

cell_cols = ["cell_id", "dist_km", "sector", "ring", "zone_id"]
access_cols = ["cell_id", "t_commute_min", "t_commute_gen_min", "t_walk_c", "t_wait_c",
               "t_ride_c", "n_transfers_c", "t_all_jobs_raw_min", "A_exp", "logsum",
               "dist_metro_m", "dist_rail_m", "n_retail", "dist_park_km",
               "industrial_share", "cost_year", "PV"]

data = listings.merge(cells[cell_cols], on="cell_id", how="left")
data = data.merge(access[access_cols], on="cell_id", how="left")
data = data.merge(stock[["cell_id", "res_floor_m2", "n_buildings"]], on="cell_id", how="left")

data["year"] = pd.to_datetime(data.created, format="ISO8601", utc=True).dt.year
data["kitchen_share"] = data.kitchen_m2 / data.area_m2
data["floor_share"] = data.floor / data.floors_total

keep = ["offer_id", "price_rub", "price_m2", "area_m2", "rooms", "floor", "floors_total",
        "floor_share", "is_first_floor", "is_last_floor", "year_built", "age",
        "wall_material", "kitchen_m2", "kitchen_share", "ceiling_m", "deal_type",
        "lat", "lon", "district", "adm_okrug", "cell_id", "dist_km", "sector", "ring",
        "zone_id", "year"] + access_cols[1:] + ["res_floor_m2", "n_buildings"]
data = data[[c for c in keep if c in data.columns]]

data.to_csv("moscow_housing_accessibility.csv", index=False, encoding="utf-8")
print(f"объявлений: {len(data)}, колонок: {len(data.columns)}, ячеек: {data.cell_id.nunique()}")
print(f"пропуски есть в: {[c for c in data.columns if data[c].isna().any()]}")

# словарь полей с источниками
YANDEX = "Яндекс.Недвижимость, публичные страницы каталога (сбор 2026)"
OSM = "OpenStreetMap через Overpass API"
MODEL = "мои расчёты: модель доступности по матрице времён"
GRID = "сетка H3 разрешения 8, моя нарезка города"
GTFS = "GTFS Мосгортранса (Mobility Database, май 2025) и интервалы с Яндекс.Расписаний"

fields = [
    ("offer_id", "идентификатор объявления", "", YANDEX),
    ("price_rub", "цена квартиры целиком", "рубли", YANDEX),
    ("price_m2", "цена квадратного метра", "рубли", "мои расчёты из price_rub и area_m2"),
    ("area_m2", "общая площадь", "м2", YANDEX),
    ("rooms", "число комнат, студия считается за 1", "штук", YANDEX),
    ("floor", "этаж квартиры", "", YANDEX),
    ("floors_total", "этажей в доме", "", YANDEX),
    ("floor_share", "этаж, делённый на этажность", "доля", "мои расчёты"),
    ("is_first_floor", "первый этаж", "0 или 1", "мои расчёты"),
    ("is_last_floor", "последний этаж", "0 или 1", "мои расчёты"),
    ("year_built", "год постройки дома", "год", YANDEX),
    ("age", "возраст дома на момент сбора", "лет", "мои расчёты"),
    ("wall_material", "материал стен", "", YANDEX),
    ("kitchen_m2", "площадь кухни", "м2", YANDEX),
    ("kitchen_share", "доля кухни в общей площади", "доля", "мои расчёты"),
    ("ceiling_m", "высота потолка", "м", YANDEX),
    ("deal_type", "SECONDARY — вторичка, NEW_SECONDARY — перепродажа в новом доме", "", YANDEX),
    ("lat", "широта дома", "градусы", YANDEX),
    ("lon", "долгота дома", "градусы", YANDEX),
    ("district", "район Москвы по координатам", "", OSM + " (границы районов)"),
    ("adm_okrug", "административный округ", "", YANDEX),
    ("cell_id", "шестиугольная ячейка города", "", GRID),
    ("dist_km", "расстояние от центра ячейки до центра Москвы", "км", GRID),
    ("sector", "сектор города, 0 — север, далее по часовой", "0-7", GRID),
    ("ring", "кольцо удалённости", "0-4", GRID),
    ("zone_id", "зона: сектор и кольцо вместе", "", GRID),
    ("year", "год публикации объявления", "год", YANDEX),
    ("t_commute_min", "ожидаемое время до работы, сырые минуты", "минуты", MODEL + ", времена из " + GTFS),
    ("t_commute_gen_min", "то же с весами дискомфорта: пешком 1.65, ожидание 1.70, пересадка +5 мин", "минуты", MODEL),
    ("t_walk_c", "из них пешком", "минуты", MODEL),
    ("t_wait_c", "из них ожидание транспорта", "минуты", MODEL),
    ("t_ride_c", "из них в салоне", "минуты", MODEL),
    ("n_transfers_c", "ожидаемое число пересадок", "штук", MODEL),
    ("t_all_jobs_raw_min", "простое среднее время до всех мест работы, для сравнения", "минуты", MODEL),
    ("A_exp", "доступность рабочих мест с экспоненциальным затуханием", "рабочих мест", MODEL),
    ("logsum", "логарифм доступности, ожидаемая полезность выбора работы", "", MODEL),
    ("dist_metro_m", "расстояние до ближайшей станции метро или МЦК", "метры", OSM),
    ("dist_rail_m", "расстояние до ближайшей станции МЦД или электрички", "метры", OSM),
    ("n_retail", "число торговых объектов в 1.5 км", "штук", OSM),
    ("dist_park_km", "расстояние до ближайшего парка", "км", OSM),
    ("industrial_share", "доля промзоны в радиусе вокруг ячейки", "доля", OSM),
    ("cost_year", "годовые транспортные издержки жителя ячейки", "рубли в год", MODEL),
    ("PV", "те же издержки, приведённые к разовой сумме за 8 лет под 13%", "рубли", MODEL),
    ("res_floor_m2", "жилой фонд в ячейке", "м2", OSM + " (здания)"),
    ("n_buildings", "число жилых зданий в ячейке", "штук", OSM),
]
pd.DataFrame(fields, columns=["поле", "что это", "единица", "источник"]).to_csv(
    "dataset_dictionary.csv", index=False, encoding="utf-8")
print("словарь полей -> dataset_dictionary.csv")
