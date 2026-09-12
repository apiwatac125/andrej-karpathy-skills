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

import streamlit as st

from ab import config, export, loader, mapping, pipeline

st.set_page_config(page_title="Antibiogram (CLSI M39)", layout="wide")
st.title("🧫 Antibiogram Generator (CLSI M39)")


@st.cache_data
def _load_conditions() -> dict:
    return config.load_conditions()


# --- 1. อัปโหลดไฟล์ -------------------------------------------------------
st.header("1) อัปโหลดไฟล์ข้อมูล (Excel)")
uploaded = st.file_uploader("เลือกไฟล์ข้อมูลแลป (.xlsx / .xls / .csv)", type=["xlsx", "xls", "csv"])

if uploaded is None:
    st.info("อัปโหลดไฟล์เพื่อเริ่มต้น")
    st.stop()

raw_df = loader.read_table(uploaded)
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

# --- 2b. ไฟล์ HIS (วัน admit) สำหรับ CAI/HAI ------------------------------
st.header("2b) ไฟล์ HIS สำหรับแยก CAI/HAI (ไม่บังคับ)")
st.caption("ไฟล์แลปไม่มีวัน admit — อัปโหลดรายงาน HIS (เช่น QR-10-020) เพื่อ join ด้วย HN")
his_file = st.file_uploader("เลือกไฟล์ HIS (.xlsx / .xls / .csv)", type=["xlsx", "xls", "csv"], key="his")
his_hn_col = his_admit_col = None
his_raw = None
if his_file is not None:
    his_raw = loader.read_table(his_file)
    his_cols = list(his_raw.columns.astype(str))
    h1, h2 = st.columns(2)
    with h1:
        hn_guess = next((c for c in his_cols if c.strip().upper() == "HN"), his_cols[0])
        his_hn_col = st.selectbox("คอลัมน์ HN (ไฟล์ HIS)", his_cols,
                                  index=his_cols.index(hn_guess), key="his_hn")
    with h2:
        adm_guess = next((c for c in his_cols if "ลงทะเบียน" in c or "admit" in c.lower()), his_cols[0])
        his_admit_col = st.selectbox("คอลัมน์วัน admit (ไฟล์ HIS)", his_cols,
                                     index=his_cols.index(adm_guess), key="his_admit")

# --- 3. เงื่อนไขการวิเคราะห์ ---------------------------------------------
st.header("3) เงื่อนไขการวิเคราะห์")
conditions = _load_conditions()
c1, c2, c3 = st.columns(3)
with c1:
    hai_days = st.number_input(
        "เกณฑ์ HAI (วันหลัง admit, >= = HAI)", value=int(conditions["classification"]["hai_threshold_days"]),
        min_value=0, step=1,
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
conditions["classification"]["hai_threshold_days"] = int(hai_days)
conditions["reporting"]["min_isolates"] = int(min_iso)
conditions["deduplication"]["enabled"] = do_dedup

if not ab_cols:
    st.error("ยังไม่ได้เลือกคอลัมน์ผลยา")
    st.stop()

# --- ประมวลผล: prepare (map -> clean -> normalize -> group -> join HIS -> classify) ---
his_an_col = "AN" if (his_raw is not None and "AN" in his_raw.columns) else None
std_df, steps = pipeline.prepare(
    raw_df, col_map, ab_cols, conditions,
    his_df=his_raw, his_hn_col=his_hn_col, his_admit_col=his_admit_col, his_an_col=his_an_col,
)
st.info(f"culture {steps.get('after_culture_filter', 0):,} → มีผล AST {steps.get('after_ast_filter', 0):,} isolates"
        + (f" · จับคู่ admit จาก HIS ได้ {steps['admit_matched']:,}" if "admit_matched" in steps else ""))

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

# --- 5. ผลลัพธ์ -----------------------------------------------------------
st.header("5) ผลลัพธ์ Antibiogram")
show_unreportable = st.checkbox("แสดงช่องที่จำนวนต่ำกว่าเกณฑ์ด้วย", value=False)

res = pipeline.finalize(
    std_df, ab_cols, conditions,
    specimens=sel_spec, wards=sel_ward, origins=sel_origin,
    show_unreportable=show_unreportable, steps=steps,
)
long_form, matrix, drug_name, organism_totals = res.long_form, res.matrix, res.drug_name, res.totals

st.caption(f"หลังกรอง/ตัดซ้ำ เหลือ {res.steps['after_dedup']:,} isolates "
           f"· กลุ่มเชื้อที่รายงาน {len(organism_totals)} กลุ่ม")
# แปลงเป็น string ก่อนแสดง (ตารางมีทั้งตัวเลขและ "R" ปนกัน -> Arrow ต้องการชนิดเดียว)
st.dataframe(matrix.fillna("").astype(str), use_container_width=True)

scope_txt = ("Specimen: " + ", ".join(sel_spec[:3]) + (" ..." if len(sel_spec) > 3 else "")
             + " | Ward: " + ("ทุก ward" if len(sel_ward) == len(wards) else ", ".join(sel_ward[:3]))
             + " | " + ", ".join(sel_origin))

c_dl1, c_dl2 = st.columns(2)
with c_dl1:
    st.download_button(
        "⬇️ ดาวน์โหลด (รูปแบบ publish)",
        data=export.to_publish_excel(
            long_form, drug_name, organism_totals,
            scope=scope_txt,
            date_range=f"1 January – 31 December ({', '.join(sel_origin)})",
        ),
        file_name="antibiogram_publish.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
with c_dl2:
    st.download_button(
        "⬇️ ดาวน์โหลด (ตารางเรียบ)",
        data=export.to_excel_bytes(matrix, long_form),
        file_name="antibiogram.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
