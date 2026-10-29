@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 매일 12:00 에 자동 수집 (사이트 갱신 10~12시 이후), 13:00 에 한 번 더 확인 (갱신이 늦은 날 대비)
if not exist "%~dp0L9Tracker.exe" goto noexe
schtasks /create /f /sc daily /st 12:00 /tn "L9Tracker 자동조회" /tr "\"%~dp0L9Tracker.exe\" --auto"
schtasks /create /f /sc daily /st 13:00 /tn "L9Tracker 자동조회 재확인" /tr "\"%~dp0L9Tracker.exe\" --auto"
if errorlevel 1 goto failed
goto done

:noexe
set "PYW="
for /f "delims=" %%p in ('where pythonw 2^>nul') do if not defined PYW set "PYW=%%p"
if not defined PYW goto nopyw
schtasks /create /f /sc daily /st 12:00 /tn "L9Tracker 자동조회" /tr "\"%PYW%\" \"%~dp0l9tracker.py\" --auto"
schtasks /create /f /sc daily /st 13:00 /tn "L9Tracker 자동조회 재확인" /tr "\"%PYW%\" \"%~dp0l9tracker.py\" --auto"
if errorlevel 1 goto failed

:done
echo.
echo 등록 완료: 매일 낮 12시에 자동 수집합니다 (갱신이 늦은 날은 13시에 다시 확인). (컴퓨터가 켜져 있어야 합니다)
echo 해제하려면: schtasks /delete /tn "L9Tracker 자동조회" /f  그리고  schtasks /delete /tn "L9Tracker 자동조회 재확인" /f
pause
exit /b

:nopyw
echo pythonw 를 찾지 못했습니다. 먼저 2_exe만들기.bat 로 exe를 만든 뒤 다시 실행하세요.
pause
exit /b

:failed
echo 등록에 실패했습니다. 위 메시지를 보내주세요.
pause
exit /b
