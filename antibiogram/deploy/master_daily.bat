@echo off
REM ============================================================
REM  master_daily.bat - merged daily pull (2 systems, 1 machine)
REM  Order: [1] MLab daily -> [2] MLab IC -> [3] SoftCon ward sync
REM         [4] Antibiogram cumulative + rolling (CSV)   <-- เพิ่มใหม่
REM  GUI automation must NOT overlap -> sequential + focus gap
REM  Needs: user logged on + screen unlocked + MLab VM + SoftCon open
REM ============================================================
cd /d D:\Users\patho13

set AUTOIT="C:\Program Files (x86)\AutoIt3\AutoIt3.exe"

if not exist D:\HIS_export\logs mkdir D:\HIS_export\logs
set LOG=D:\HIS_export\logs\master_daily.log

echo.>> "%LOG%"
echo ========== [%date% %time%] MASTER START ==========>> "%LOG%"

REM ========== [1] MLab daily report ==========
echo [%date% %time%] [1] MLab export today...>> "%LOG%"
%AUTOIT% "D:\Users\patho13\mlab_export.au3"
timeout /t 40 /nobreak >nul
echo [%date% %time%] [1] daily report (Line + Sheet)...>> "%LOG%"
python mlab_daily_report.py >> "%LOG%" 2>&1

REM ========== [2] MLab IC email ==========
echo [%date% %time%] [2] MLab export yesterday...>> "%LOG%"
%AUTOIT% "D:\Users\patho13\mlab_export_ic.au3"
timeout /t 40 /nobreak >nul
echo [%date% %time%] [2] IC email...>> "%LOG%"
python ic_email.py >> "%LOG%" 2>&1

REM ---- focus gap before switching VM -> SoftCon ----
timeout /t 10 /nobreak >nul

REM ========== [3] SoftCon ward sync ==========
echo [%date% %time%] [3] SoftCon capture...>> "%LOG%"
python his_auto.py >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARN capture failed, skip ward_sync push>> "%LOG%"
) else (
  echo [%date% %time%] [3] ward_sync push...>> "%LOG%"
  python his_ward_sync.py >> "%LOG%" 2>&1
)

REM ========== [4] Antibiogram cumulative + rolling (CSV) ==========
REM ไม่มี GUI -> ไม่ชนกับ step 1-3. อ่านไฟล์ DBF ที่ step[1] สะสมไว้ แล้วเขียนตารางสรุป (ไม่มี PHI).
REM ABPY = ที่อยู่ daily_etl.py (ปรับถ้า clone repo ไว้ที่อื่น)
set ABPY=D:\antibiogram\daily_etl.py
set ABOUT=D:\HIS_export\antibiogram_summary.csv
REM ดึงโฟลเดอร์ DBF จาก config.py เดิม (ตัวแปร DBF_FOLDER) อัตโนมัติ -> ไม่ต้องกรอก path
set ABDIR=
for /f "usebackq delims=" %%i in (`python -c "import config as cfg; print(cfg.DBF_FOLDER)"`) do set ABDIR=%%i
if "%ABDIR%"=="" (
  echo [%date% %time%] [4] WARN: อ่าน DBF_FOLDER จาก config.py ไม่ได้ - ข้าม antibiogram>> "%LOG%"
) else (
  echo [%date% %time%] [4] antibiogram ETL (DBF=%ABDIR%)...>> "%LOG%"
  python "%ABPY%" --dbf-dir "%ABDIR%" --out "%ABOUT%" >> "%LOG%" 2>&1
)

echo [%date% %time%] ========== MASTER DONE ==========>> "%LOG%"
exit /b 0
