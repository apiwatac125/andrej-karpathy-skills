@echo off
REM ===== รัน antibiogram ETL รายวันบนเครื่อง lab (patho13) =====
REM แก้ค่า 4 ตัวข้างล่างให้ตรงเครื่องจริง แล้วตั้ง Windows Task Scheduler ชี้มาที่ไฟล์นี้
REM PHI (HN/ชื่อ) ไม่ออกจากเครื่อง — output เป็นตัวเลขสรุปเท่านั้น

set PROJECT=D:\antibiogram
set DBF_DIR=D:\mlab_dbf
set HIS_DIR=D:\qr1020
set OUT=D:\amr\antibiogram_summary.csv

REM --- ไม่บังคับ: push ขึ้น Google Sheet (ใช้ไฟล์ creds เดิมของ AMR Alert) ---
set SHEET_ID=
set CREDS=D:\amr\service_account.json

cd /d %PROJECT%
if not exist logs mkdir logs

set ARGS=--dbf-dir "%DBF_DIR%" --out "%OUT%"
if exist "%HIS_DIR%" set ARGS=%ARGS% --his-dir "%HIS_DIR%"
if not "%SHEET_ID%"=="" set ARGS=%ARGS% --sheet-id %SHEET_ID% --creds "%CREDS%"

python daily_etl.py %ARGS% >> "logs\etl_%date:~-4%%date:~3,2%%date:~0,2%.log" 2>&1
