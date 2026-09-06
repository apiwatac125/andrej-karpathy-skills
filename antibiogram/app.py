"""Antibiogram (CLSI M39) — Streamlit web app (รันในเครื่อง).

รัน:  streamlit run app.py

ขั้นตอนบนหน้าจอ:
    1. อัปโหลดไฟล์ Excel
    2. จับคู่คอลัมน์ (auto-detect + ปรับเอง) / เลือกคอลัมน์ผลยา
    3. ตั้งเงื่อนไข (48 ชม., min isolate, dedup ...)
    4. เลือก filter: specimen / ward / CAI-HAI
    5. ดูตาราง antibiogram + ดาวน์โหลด Excel
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from ab import antibiogram, classify, config, dedup, dictionary, export, loader, mapping

st.set_page_config(page_title="Antibiogram (CLSI M39)", layout="wide")
st.title("🧫 Antibiogram Generator (CLSI M39)")


@st.cache_data
def _load_conditions() -> dict:
    return config.load_conditions()


# --- 1. อัปโหลดไฟล์ -------------------------------------------------------
st.header("1) อัปโหลดไฟล์ข้อมูล (Excel)")
uploaded = st.file_uploader("เลือกไฟล์ .xlsx", type=["xlsx", "xls"])

if uploaded is None:
    st.info("อัปโหลดไฟล์เพื่อเริ่มต้น")
    st.stop()

raw_df = loader.read_excel(uploaded)
st.success(f"อ่านข้อมูลได้ {len(raw_df):,} แถว, {len(raw_df.columns)} คอลัมน์")
with st.expander("ดูตัวอย่างข้อมูลดิบ"):
    st.dataframe(raw_df.head(20))

columns = list(raw_df.columns.astype(str))

# --- 2. จับคู่คอลัมน์ -----------------------------------------------------
st.header("2) จับคู่คอลัมน์")
guessed = mapping.guess_mapping(columns)

col_map: dict[str, str | None] = {}
cols = st.columns(3)
for i, field in enumerate(mapping.IDENTITY_FIELDS):
    with cols[i % 3]:
        options = ["(ไม่มี)"] + columns
        default = guessed.get(field)
        idx = options.index(default) if default in options else 0
        chosen = st.selectbox(field, options, index=idx, key=f"map_{field}")
        col_map[field] = None if chosen == "(ไม่มี)" else chosen

default_ab = mapping.guess_antibiotic_columns(columns, col_map)
ab_cols = st.multiselect(
    "คอลัมน์ผลยา (antibiotics)", columns, default=default_ab,
    help="เลือกคอลัมน์ที่เก็บผล S/I/R ของยาแต่ละตัว",
)

# --- 3. เงื่อนไขการวิเคราะห์ ---------------------------------------------
st.header("3) เงื่อนไขการวิเคราะห์")
conditions = _load_conditions()
c1, c2, c3 = st.columns(3)
with c1:
    hai_hours = st.number_input(
        "เกณฑ์ HAI (ชั่วโมงหลัง admit)", value=float(conditions["classification"]["hai_threshold_hours"]),
        min_value=0.0, step=1.0,
    )
with c2:
    min_iso = st.number_input(
        "จำนวน isolate ขั้นต่ำที่รายงาน", value=int(conditions["reporting"]["min_isolates"]),
        min_value=0, step=1,
    )
with c3:
    do_dedup = st.checkbox(
        "First isolate per patient/species", value=bool(conditions["deduplication"]["enabled"]),
    )
conditions["classification"]["hai_threshold_hours"] = hai_hours
conditions["reporting"]["min_isolates"] = int(min_iso)
conditions["deduplication"]["enabled"] = do_dedup

# --- ประมวลผลข้อมูล -------------------------------------------------------
std_df = loader.apply_mapping(raw_df, col_map, ab_cols)

# normalize ชื่อเชื้อด้วย dictionary
org_dict = dictionary.load_organism_dictionary()
unknown_orgs = org_dict.unknown_values(std_df["organism"].dropna().unique())
if unknown_orgs:
    st.warning(f"พบชื่อเชื้อที่ยังไม่มีใน dictionary {len(unknown_orgs)} รายการ: "
               + ", ".join(unknown_orgs[:20]) + (" ..." if len(unknown_orgs) > 20 else ""))
std_df["organism"] = std_df["organism"].map(
    lambda v: org_dict.normalize(v) if pd.notna(v) else v
)

std_df = classify.classify_infection_origin(
    std_df,
    hai_threshold_hours=hai_hours,
    missing_admit_as=conditions["classification"]["missing_admit_as"],
)

# --- 4. Filters -----------------------------------------------------------
st.header("4) เลือกข้อมูลที่จะนำมาวิเคราะห์")
f1, f2, f3 = st.columns(3)
with f1:
    specimens = sorted(std_df["specimen"].dropna().unique().tolist())
    sel_spec = st.multiselect("Specimen", specimens, default=specimens)
with f2:
    wards = sorted(std_df["ward"].dropna().unique().tolist())
    sel_ward = st.multiselect("Ward", wards, default=wards)
with f3:
    sel_origin = st.multiselect("CAI / HAI", ["CAI", "HAI", "UNKNOWN"], default=["CAI", "HAI"])

work = std_df[
    std_df["specimen"].isin(sel_spec)
    & std_df["ward"].isin(sel_ward)
    & std_df["infection_origin"].isin(sel_origin)
].copy()

if do_dedup:
    work = dedup.first_isolate_per_patient(
        work, scope=conditions["deduplication"]["scope"]
    )

st.caption(f"หลังกรอง/ตัดซ้ำ เหลือ {len(work):,} isolates")

# --- 5. ผลลัพธ์ -----------------------------------------------------------
st.header("5) ผลลัพธ์ Antibiogram")
if not ab_cols:
    st.error("ยังไม่ได้เลือกคอลัมน์ผลยา")
    st.stop()

show_unreportable = st.checkbox("แสดงช่องที่จำนวนต่ำกว่าเกณฑ์ด้วย", value=False)
long_form = antibiogram.compute_antibiogram(work, ab_cols, conditions)
matrix = antibiogram.to_matrix(long_form, show_unreportable=show_unreportable)

st.dataframe(matrix, use_container_width=True)

st.download_button(
    "⬇️ ดาวน์โหลดผลเป็น Excel",
    data=export.to_excel_bytes(matrix, long_form),
    file_name="antibiogram.xlsx",
    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
)
