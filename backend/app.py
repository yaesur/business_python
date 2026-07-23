from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import json
import math
import os
import re
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
MODEL_PATH = os.path.join(BASE_DIR, "model.joblib")
STATS_PATH = os.path.join(BASE_DIR, "district_stats.json")
DATA_PATH = os.path.join(PROJECT_DIR, "data", "dataset.csv")
GEOCODE_CACHE_PATH = os.path.join(BASE_DIR, "geocode_cache.json")
ENV_PATH = os.path.join(PROJECT_DIR, ".env")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)


def load_env_file(path):
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env_file(ENV_PATH)
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY")

model_data = None
district_stats = {}
raw_dataset = None
geocode_cache = {}


def extract_number(value):
    if pd.isna(value) or value == "-":
        return np.nan

    match = re.search(r"[-+]?\d*\.\d+|\d+", str(value).strip())
    return float(match.group()) if match else np.nan


def load_geocode_cache():
    if not os.path.exists(GEOCODE_CACHE_PATH):
        return {}
    try:
        with open(GEOCODE_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_geocode_cache():
    try:
        with open(GEOCODE_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(geocode_cache, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


def geocode_kakao(query):
    if not KAKAO_REST_API_KEY or not query:
        return None

    cache_key = normalize_listing_key(query)
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]

    url = "https://dapi.kakao.com/v2/local/search/keyword.json?" + urllib.parse.urlencode(
        {"query": query, "size": 1}
    )
    req = urllib.request.Request(url, headers={"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"})

    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None

    documents = payload.get("documents") or []
    if not documents:
        address_url = "https://dapi.kakao.com/v2/local/search/address.json?" + urllib.parse.urlencode(
            {"query": query, "size": 1}
        )
        address_req = urllib.request.Request(address_url, headers={"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"})
        try:
            with urllib.request.urlopen(address_req, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            documents = payload.get("documents") or []
        except Exception:
            return None

    if not documents:
        return None

    first = documents[0]
    point = {
        "name": first.get("place_name") or first.get("address_name") or query,
        "address": first.get("road_address_name") or first.get("address_name") or query,
        "lat": float(first["y"]),
        "lng": float(first["x"]),
    }
    geocode_cache[cache_key] = point
    save_geocode_cache()
    return point


def haversine_km(lat1, lng1, lat2, lng2):
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def normalize_listing_key(value):
    if pd.isna(value):
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def normalize_house_name(value):
    if pd.isna(value):
        return ""
    name = str(value).strip()
    if not name:
        return ""
    name = re.sub(r"\([^)]*\)", "", name)
    name = re.sub(r"\s+", "", name)
    return name.lower()


def extract_parcel_key(address, house_name=""):
    text = f"{address or ''} {house_name or ''}"
    match = re.search(r"([가-힣]+동)\s*(산\s*)?\d{1,5}(?:-\d{1,5})?", text)
    if match:
        return re.sub(r"\s+", "", match.group(0))
    return ""


def extract_road_base_key(address):
    if pd.isna(address):
        return ""

    text = str(address)
    text = re.sub(r"\([^)]*\)", "", text)
    text = text.split(",", 1)[0]
    text = re.sub(r"\s+", " ", text).strip()
    match = re.search(r"([가-힣]+(?:로|길)\s*\d*(?:[가-힣]+길)?\s*\d+(?:-\d+)?)", text)
    if match:
        return re.sub(r"\s+", "", match.group(1))
    return re.sub(r"\s+", "", text)


def build_listing_identity(row):
    district = normalize_listing_key(row["자치구"])
    house_name = normalize_house_name(row["주택명"])
    address = row["주소지"]

    if not house_name:
        return f"{district}|{normalize_listing_key(address)}"

    location_key = extract_road_base_key(address) or extract_parcel_key(address, row["주택명"])
    return f"{district}|{house_name}|{location_key}"


def filter_valid_cutoff(df):
    return df[
        (df["당첨자순위"].notna())
        & (df["당첨자순위"] != "-")
        & (df["당첨자 가점"].notna())
        & (df["당첨자 가점"] != "-")
    ]


def dedupe_latest_listings(df):
    if df.empty:
        return df

    working = df.copy()
    half_order = {"상": 1, "하": 2}
    working["_half_order"] = working["상/하반기"].map(half_order).fillna(0).astype(int)
    working["_listing_key"] = (
        working.apply(build_listing_identity, axis=1)
        + "|"
        + working["상/하반기"].apply(normalize_listing_key)
    )
    working["_pyung_num"] = working["평수"].apply(extract_number)
    listing_avg_pyung = working.groupby("_listing_key")["_pyung_num"].transform("mean")

    working["평수_filled_val"] = working["_pyung_num"].fillna(listing_avg_pyung)
    working["평수_source"] = np.where(
        working["_pyung_num"].notna(),
        "dataset",
        np.where(working["평수_filled_val"].notna(), "same_listing", "missing"),
    )

    working = working.sort_values(by=["연도", "_half_order"], ascending=[False, False])
    working = working.drop_duplicates(subset=["_listing_key"], keep="first")
    return working.drop(columns=["_half_order", "_listing_key", "_pyung_num"])


def score_to_rank_score(score_val):
    rank_num = int(score_val // 15)
    score_num = int(score_val % 15)

    if rank_num >= 3:
        rank_str = "1순위"
    elif rank_num == 2:
        rank_str = "2순위"
    else:
        rank_str = "3순위"

    return f"{rank_str} {score_num}점"


def build_stats_from_dataset(df):
    if df is None or df.empty or "자치구" not in df.columns:
        return {}

    working = df.copy()
    working["평수_val"] = working["평수"].apply(extract_number)
    working["교통등급_val"] = working["교통등급"].apply(extract_number).fillna(10.0)

    overall_avg_pyung = working["평수_val"].mean()
    if pd.isna(overall_avg_pyung):
        overall_avg_pyung = 25.0

    district_avg_pyung = working.groupby("자치구")["평수_val"].mean().to_dict()
    working["평수_val"] = working.apply(
        lambda row: (
            district_avg_pyung.get(row["자치구"], overall_avg_pyung)
            if pd.isna(row["평수_val"])
            else row["평수_val"]
        ),
        axis=1,
    )

    rank_map = {"1순위": 3, "2순위": 2, "3순위": 1}
    working["순위_num"] = working["당첨자순위"].map(rank_map)
    working["가점_num"] = working["당첨자 가점"].apply(extract_number)

    stats = {}
    for district, group in working.groupby("자치구"):
        valid_cutoff = group[group["순위_num"].notna() & group["가점_num"].notna()]
        avg_rank_num = round(valid_cutoff["순위_num"].mean()) if not valid_cutoff.empty else 2
        avg_rank = "1순위" if avg_rank_num >= 3 else ("2순위" if avg_rank_num == 2 else "3순위")
        avg_score = valid_cutoff["가점_num"].mean() if not valid_cutoff.empty else 0

        mode_grade_series = group["지역등급"].dropna().mode()
        mode_grade = mode_grade_series.iloc[0] if not mode_grade_series.empty else "B"

        stats[district] = {
            "avg_pyung": round(float(group["평수_val"].mean()), 1),
            "avg_traffic": round(float(group["교통등급_val"].mean()), 1),
            "avg_density": float(group["모집규모밀도"].mean()),
            "mode_grade": mode_grade,
            "avg_rank": avg_rank,
            "avg_score": round(float(avg_score), 1),
            "listing_count": int(len(dedupe_latest_listings(filter_valid_cutoff(group)))),
        }

    valid_all = working[working["순위_num"].notna() & working["가점_num"].notna()]
    stats["전체"] = {
        "avg_pyung": round(float(overall_avg_pyung), 1),
        "avg_traffic": round(float(working["교통등급_val"].mean()), 1),
        "avg_density": float(working["모집규모밀도"].mean()),
        "mode_grade": "B",
        "avg_rank": "1순위",
        "avg_score": round(float(valid_all["가점_num"].mean()), 1) if not valid_all.empty else 0,
        "listing_count": int(len(dedupe_latest_listings(filter_valid_cutoff(working)))),
    }

    return stats


if os.path.exists(MODEL_PATH):
    model_data = joblib.load(MODEL_PATH)
    print("머신러닝 모델 로드 완료.")
else:
    print("Warning: model.joblib이 없습니다. 먼저 train_model.py를 실행하세요.")

if os.path.exists(DATA_PATH):
    raw_dataset = pd.read_csv(DATA_PATH, encoding="utf-8")
    print("원천 데이터셋 로드 완료.")
else:
    print("Warning: dataset.csv가 없습니다.")

if raw_dataset is not None:
    district_stats = build_stats_from_dataset(raw_dataset)
elif os.path.exists(STATS_PATH):
    with open(STATS_PATH, "r", encoding="utf-8") as f:
        district_stats = json.load(f)
    print("자치구 통계 정보 로드 완료.")
else:
    print("Warning: district_stats.json이 없습니다.")

geocode_cache = load_geocode_cache()


@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>", methods=["GET"])
def serve_frontend(path):
    target_path = os.path.join(FRONTEND_DIR, path)
    if os.path.exists(target_path) and os.path.isfile(target_path):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/districts", methods=["GET"])
def get_districts():
    """사용 가능한 모든 자치구 목록 및 통계 데이터 반환"""
    return jsonify(district_stats)


@app.route("/api/geocode", methods=["GET"])
def geocode():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "검색어가 필요합니다."}), 400
    if not KAKAO_REST_API_KEY:
        return jsonify({"error": "KAKAO_REST_API_KEY 환경변수가 필요합니다."}), 503

    point = geocode_kakao(query)
    if not point:
        return jsonify({"error": "위치를 찾을 수 없습니다."}), 404

    return jsonify(point)


@app.route("/api/predict", methods=["POST"])
def predict():
    if model_data is None:
        return jsonify({"error": "모델이 준비되지 않았습니다."}), 500

    data = request.json
    if not data:
        return jsonify({"error": "요청 본문이 비어 있습니다."}), 400

    district = data.get("district", "전체")
    user_rank = int(data.get("rank", 1))
    user_score_val = float(data.get("score", 0))
    half = data.get("half", "상")
    supply_type = data.get("supply_type", "신규공급")
    target_location = data.get("target_location", "").strip()
    include_map = bool(data.get("include_map", False))
    target_point = geocode_kakao(target_location) if target_location else None

    stats = district_stats.get(district, district_stats.get("전체"))
    if not stats:
        return jsonify({"error": "자치구 통계 정보를 불러올 수 없습니다."}), 500

    try:
        pyung = float(data.get("pyung")) if data.get("pyung") else stats["avg_pyung"]
    except (ValueError, TypeError):
        pyung = stats["avg_pyung"]

    try:
        traffic = float(data.get("traffic")) if data.get("traffic") else stats["avg_traffic"]
    except (ValueError, TypeError):
        traffic = stats["avg_traffic"]

    half_val = 1 if half == "상" else 0
    supply_val = 1 if supply_type == "재공급" else 0

    grade_map = {"A": 3, "B": 2, "C": 1}
    grade_val = grade_map.get(stats["mode_grade"], 2)
    density_val = stats["avg_density"]

    features = [half_val, supply_val, pyung, grade_val, traffic, density_val]

    ml_model = model_data["model"]
    feature_names = model_data.get(
        "features",
        ["상/하반기_val", "재공급/신규공급_val", "평수_val", "지역등급_val", "교통등급_val", "모집규모밀도"],
    )
    pred_cutoff_score = ml_model.predict(pd.DataFrame([features], columns=feature_names))[0]

    rank_mapping_for_score = {1: 3, 2: 2, 3: 1}
    user_rank_score = rank_mapping_for_score.get(user_rank, 1)
    user_score = user_rank_score * 15 + user_score_val

    gap = user_score - pred_cutoff_score
    probability = 1.0 / (1.0 + np.exp(-0.35 * gap))
    probability_percentage = round(probability * 100, 1)

    if gap >= 3:
        status = "안정"
        status_desc = "과거 당첨 커트라인보다 본인의 점수가 여유 있어 당첨 가능성이 높습니다."
    elif -3 <= gap < 3:
        status = "경합"
        status_desc = "예상 당첨 커트라인 근처입니다. 실제 모집 상황에 따라 결과가 달라질 수 있습니다."
    else:
        status = "도전"
        status_desc = "예상 커트라인보다 점수가 낮습니다. 공급 물량이 많거나 경쟁이 낮은 지역도 함께 검토해 보세요."

    history_list = []
    if raw_dataset is not None:
        hist_df = raw_dataset.copy()
        if district != "전체":
            hist_df = hist_df[hist_df["자치구"] == district].copy()
        if supply_type:
            hist_df = hist_df[
                hist_df["재공급/신규공급"].astype(str).str.strip() == str(supply_type).strip()
            ].copy()

        hist_df = filter_valid_cutoff(hist_df)

        hist_df = dedupe_latest_listings(hist_df)
        hist_df = hist_df.sort_values(by=["연도", "상/하반기"], ascending=[False, False])

        for _, row in hist_df.iterrows():
            pyung_value = row.get("평수_filled_val", extract_number(row["평수"]))
            traffic_value = extract_number(row["교통등급"])

            history_list.append(
                {
                    "year": int(row["연도"]),
                    "half": row["상/하반기"],
                    "supply_type": row["재공급/신규공급"],
                    "housing_name": row["주택명"] if pd.notna(row["주택명"]) and row["주택명"] else "미상 주택",
                    "address": row["주소지"] if pd.notna(row["주소지"]) else "",
                    "district": row["자치구"],
                    "pyung": None if pd.isna(pyung_value) else pyung_value,
                    "pyung_source": row.get("평수_source", "dataset" if pd.notna(extract_number(row["평수"])) else "missing"),
                    "traffic": None if pd.isna(traffic_value) else traffic_value,
                    "cutoff_rank": row["당첨자순위"],
                    "cutoff_score": row["당첨자 가점"],
                    "deposit": None,
                    "rent": None,
                }
            )

            if include_map or target_point:
                listing_point = geocode_kakao(history_list[-1]["address"])
                if listing_point:
                    history_list[-1]["lat"] = listing_point["lat"]
                    history_list[-1]["lng"] = listing_point["lng"]
                    if target_point:
                        history_list[-1]["distance_km"] = round(
                            haversine_km(
                                target_point["lat"],
                                target_point["lng"],
                                listing_point["lat"],
                                listing_point["lng"],
                            ),
                            2,
                        )

    response = {
        "user_score": user_score,
        "pred_cutoff_score": round(pred_cutoff_score, 2),
        "pred_cutoff_desc": score_to_rank_score(pred_cutoff_score),
        "gap": round(gap, 2),
        "probability": probability_percentage,
        "status": status,
        "status_desc": status_desc,
        "features": {
            "district": district,
            "pyung": pyung,
            "traffic": traffic,
            "grade": stats["mode_grade"],
            "density": stats["avg_density"],
        },
        "history": history_list,
        "target_location": target_point,
    }

    return jsonify(response)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
