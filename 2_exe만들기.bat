@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "l9tracker.py" goto nozip
set "PY="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto havepy
python --version >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto havepy
echo Python을 찾지 못했습니다. 1_실행.bat 안내에 따라 먼저 Python을 설치하세요.
pause
exit /b

:havepy
echo exe 파일을 만듭니다. 1~3분 정도 걸립니다.
%PY% -m pip install --disable-pip-version-check -q requests pyinstaller
%PY% -m PyInstaller --noconfirm --onefile --windowed --name L9Tracker --hidden-import crawler --add-data "site;site" l9tracker.py
if not exist "dist\L9Tracker.exe" goto failed
copy /y "dist\L9Tracker.exe" . >nul
echo.
echo 완료: 이 폴더에 L9Tracker.exe 가 만들어졌습니다.
pause
exit /b

:failed
echo 만들기에 실패했습니다. 위의 오류 메시지를 보내주세요.
pause
exit /b

:nozip
echo 압축을 먼저 풀고, 풀린 폴더에서 실행하세요.
pause
exit /b
