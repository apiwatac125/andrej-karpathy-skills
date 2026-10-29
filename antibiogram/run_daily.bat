@echo off
REM ===== รัน antibiogram ETL (ทดสอบแบบ standalone) =====
REM สำหรับรันจริงรายวัน: ต่อ step [4] เข้า master_daily.bat แทน (ดู docs\DAILY_AUTOMATION.md)
REM
REM DBF_DIR = โฟลเดอร์เดียวกับ cfg.DBF_FOLDER ใน config.py (ไฟล์ DDMMYY.DBF สะสมอยู่แล้วทุกวัน)
REM PHI (HN/ชื่อ) ไม่ออกจากเครื่อง — output เป็นตัวเลขสรุปเท่านั้น

set PROJECT=D:\antibiogram
set DBF_DIR=D:\mlab_dbf
set OUT=D:\HIS_export\antibiogram_summary.csv

REM --- ไม่บังคับ: แยก CAI/HAI (qr1020 จาก his_auto.py) ---
REM set HIS_DIR=D:\HIS_export
REM --- ไม่บังคับ: push ขึ้น Google Sheet ด้วย gspread (ต้องมี service-account json) ---
REM set SHEET_ID=
REM set CREDS=D:\amr\service_account.json

cd /d %PROJECT%
if not exist logs mkdir logs

set ARGS=--dbf-dir "%DBF_DIR%" --out "%OUT%"
if defined HIS_DIR set ARGS=%ARGS% --his-dir "%HIS_DIR%"
if defined SHEET_ID set ARGS=%ARGS% --sheet-id %SHEET_ID% --creds "%CREDS%"

python daily_etl.py %ARGS% >> "logs\etl_%date:~-4%%date:~3,2%%date:~0,2%.log" 2>&1
