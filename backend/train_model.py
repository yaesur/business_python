import json
import os
import re

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "..", "data", "dataset.csv")
MODEL_PATH = os.path.join(BASE_DIR, "model.joblib")
STATS_PATH = os.path.join(BASE_DIR, "district_stats.json")


def extract_number(value):
    if pd.isna(value) or value == "-":
        return np.nan

    match = re.search(r"[-+]?\d*\.\d+|\d+", str(value).strip())
    return float(match.group()) if match else np.nan


def build_district_stats(df, overall_avg_pyung):
    stats = {}
    for district, group in df.groupby("자치구"):
        avg_pyung = group["평수_val"].mean()
        avg_traffic = group["교통등급_val"].mean()
        avg_density = group["모집규모밀도"].mean()

        mode_grade_series = group["지역등급"].dropna().mode()
        mode_grade = mode_grade_series.iloc[0] if not mode_grade_series.empty else "B"

        valid_cutoff = group[group["순위_num"].notna() & group["가점_num"].notna()]
        avg_rank_num = round(valid_cutoff["순위_num"].mean()) if not valid_cutoff.empty else 2
        avg_rank = "1순위" if avg_rank_num >= 3 else ("2순위" if avg_rank_num == 2 else "3순위")
        avg_score = valid_cutoff["가점_num"].mean() if not valid_cutoff.empty else 0

        stats[district] = {
            "avg_pyung": round(float(avg_pyung), 1),
            "avg_traffic": round(float(avg_traffic), 1),
            "avg_density": float(avg_density),
            "mode_grade": mode_grade,
            "avg_rank": avg_rank,
            "avg_score": round(float(avg_score), 1),
            "listing_count": int(len(group)),
        }

    valid_all = df[df["순위_num"].notna() & df["가점_num"].notna()]
    stats["전체"] = {
        "avg_pyung": round(float(overall_avg_pyung), 1),
        "avg_traffic": round(float(df["교통등급_val"].mean()), 1),
        "avg_density": float(df["모집규모밀도"].mean()),
        "mode_grade": "B",
        "avg_rank": "1순위",
        "avg_score": round(float(valid_all["가점_num"].mean()), 1) if not valid_all.empty else 0,
        "listing_count": int(len(df)),
    }

    return stats


def main():
    print("--- 데이터 로드 및 전처리 시작 ---")
    if not os.path.exists(DATA_PATH):
        print(f"Error: dataset.csv not found at {DATA_PATH}")
        return

    df = pd.read_csv(DATA_PATH, encoding="utf-8")

    df["상/하반기_val"] = df["상/하반기"].map({"상": 1, "하": 0}).fillna(0).astype(int)
    df["재공급/신규공급_val"] = df["재공급/신규공급"].map({"재공급": 1, "신규공급": 0}).fillna(0).astype(int)
    df["평수_val"] = df["평수"].apply(extract_number)
    df["교통등급_val"] = df["교통등급"].apply(extract_number).fillna(10.0)
    df["지역등급_val"] = df["지역등급"].map({"A": 3, "B": 2, "C": 1}).fillna(2).astype(int)

    overall_avg_pyung = df["평수_val"].mean()
    if pd.isna(overall_avg_pyung):
        overall_avg_pyung = 25.0

    district_avg_pyung = df.groupby("자치구")["평수_val"].mean().to_dict()

    def fill_pyung(row):
        if pd.isna(row["평수_val"]):
            return district_avg_pyung.get(row["자치구"], overall_avg_pyung)
        return row["평수_val"]

    df["평수_val"] = df.apply(fill_pyung, axis=1)

    rank_map = {"1순위": 3, "2순위": 2, "3순위": 1}
    df["순위_num"] = df["당첨자순위"].map(rank_map)
    df["가점_num"] = df["당첨자 가점"].apply(extract_number)

    district_stats = build_district_stats(df, overall_avg_pyung)
    with open(STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(district_stats, f, ensure_ascii=False, indent=4)
    print(f"자치구 통계 정보 저장 완료. 자치구 수: {len(district_stats) - 1}개")

    train_df = df[df["순위_num"].notna() & df["가점_num"].notna()].copy()
    train_df["target_score"] = train_df["순위_num"] * 15 + train_df["가점_num"]
    print(f"학습 가능 데이터 수: {len(train_df)}개")

    features = ["상/하반기_val", "재공급/신규공급_val", "평수_val", "지역등급_val", "교통등급_val", "모집규모밀도"]
    X = train_df[features]
    y = train_df["target_score"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("Random Forest 모델 학습 중...")
    model = RandomForestRegressor(n_estimators=200, max_depth=10, random_state=42)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    print("\n--- 모델 검증 결과 ---")
    print(f"Mean Absolute Error (MAE): {mae:.4f}점")
    print(f"R-squared (R2) Score: {r2:.4f}")

    model_data = {
        "model": model,
        "features": features,
        "overall_avg_pyung": overall_avg_pyung,
        "district_avg_pyung": district_avg_pyung,
    }
    joblib.dump(model_data, MODEL_PATH)
    print(f"모델 저장 완료: {MODEL_PATH}")


if __name__ == "__main__":
    main()
