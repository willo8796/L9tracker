@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 로드나인 캐릭터 추적기

if not exist "l9tracker.py" goto nozip
if not exist "site\index.html" goto nozip

set "PY="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto havepy
python --version >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto havepy
goto nopy

:havepy
echo [1/2] 필요한 모듈을 확인하는 중입니다...
%PY% -m pip install --disable-pip-version-check -q requests
echo [2/2] 프로그램을 여는 중입니다... 브라우저에 화면이 열립니다. (이 검은 창을 닫으면 프로그램이 종료됩니다)
%PY% l9tracker.py
if errorlevel 1 goto failed
exit /b

:failed
echo.
echo 프로그램 실행 중 오류가 났습니다. 위 메시지나 data\error.txt 내용을 보내주세요.
pause
exit /b

:nopy
echo Python을 찾지 못했습니다.
echo  1) https://www.python.org/downloads/ 에서 Python을 설치하세요.
echo  2) 설치 첫 화면에서 "Add python.exe to PATH"를 꼭 체크하세요.
echo  3) 설치 후 이 파일을 다시 실행하세요.
echo (Microsoft Store 바로가기만 있는 경우에도 이 메시지가 나옵니다)
pause
exit /b

:nozip
echo l9tracker.py 파일이 같은 폴더에 없습니다.
echo 압축 파일을 더블클릭해서 안에서 바로 실행하지 말고, [압축 풀기]를 한 다음 풀린 폴더에서 실행하세요.
pause
exit /b
