@echo off
chcp 65001 >nul
title Antibiogram Generator (CLSI M39)
cd /d "%~dp0"

echo ============================================
echo   Antibiogram Generator (CLSI M39)
echo ============================================
echo.

REM --- ตรวจ Python ---
python --version >nul 2>&1
if errorlevel 1 (
    echo [!] ไม่พบ Python — กรุณาติดตั้ง Python 3.12 จาก https://www.python.org/downloads/
    echo     ตอนติดตั้งให้ติ๊ก "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

REM --- ตรวจ/ติดตั้งไลบรารีให้ครบทุกครั้ง (ครั้งแรกช้าหน่อย ครั้งต่อไปเร็ว) ---
python -c "import streamlit, pandas, openpyxl, yaml" >nul 2>&1
if errorlevel 1 (
    echo [*] กำลังติดตั้ง/อัปเดตไลบรารี... รอสักครู่
    python -m pip install -r requirements.txt
    echo.
)

echo [*] กำลังเปิดโปรแกรม... เบราว์เซอร์จะเปิดขึ้นเอง
echo     ปิดโปรแกรม: กลับมาที่หน้าต่างนี้แล้วกด Ctrl + C
echo.
python -m streamlit run app.py

pause
