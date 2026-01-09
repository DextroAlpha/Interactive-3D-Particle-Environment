@echo off
REM run_app.bat - Starts the hand tracking server, static file server, and opens the particle app in default browser

setlocal enabledelayedexpansion

REM Resolve script directory
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo Checking for Python installation...
set "PY="

REM Check for Python 3.11 venv first (preferred)
if exist "%SCRIPT_DIR%\.venv311\Scripts\python.exe" (
    set "PY=%SCRIPT_DIR%\.venv311\Scripts\python.exe"
    echo Found Python 3.11 virtual environment
    goto :found_python
)

REM Check for regular venv
if exist "%SCRIPT_DIR%\.venv\Scripts\python.exe" (
    set "PY=%SCRIPT_DIR%\.venv\Scripts\python.exe"
    echo Found Python virtual environment
    goto :found_python
)

REM Try Python 3.11 launcher
where py >nul 2>&1
if %errorlevel% equ 0 (
    set "PY=py -3.11"
    echo Found Python 3.11 launcher
    goto :found_python
)

REM Try system Python
where python >nul 2>&1
if %errorlevel% equ 0 (
    for /f "delims=" %%p in ('where python') do (
        set "PY=%%p"
        echo Found system Python
        goto :found_python
    )
)

REM Python not found
echo.
echo ERROR: Python executable not found!
echo Please ensure:
echo   1. Python 3.11 or 3.10 is installed
echo   2. A virtual environment exists (.venv311 or .venv)
echo   3. Python is added to system PATH
echo.
pause
exit /b 1

:found_python
echo Using: %PY%
echo.

REM Start hand tracking server in new window
echo Starting hand tracking server...
start "Hand Tracking Server" cmd /k "cd /d "%SCRIPT_DIR%" && %PY% hand_tracking.py"

REM Wait a moment for hand tracking to initialize
timeout /t 2 /nobreak >nul

REM Start HTTP server in new window
echo Starting HTTP server on port 8000...
start "Static Server" cmd /k "cd /d "%SCRIPT_DIR%" && %PY% -m http.server 8000"

REM Wait for servers to initialize
echo Waiting for servers to start...
timeout /t 3 /nobreak >nul

REM Open browser
echo Opening particle app in browser...
start "" "http://localhost:8000/particle_app.html"

echo.
echo ========================================
echo Servers are running!
echo ========================================
echo - Hand Tracking Server: Check the "Hand Tracking Server" window
echo - HTTP Server: Check the "Static Server" window  
echo - Browser: Should open automatically
echo.
echo To stop: Close the server windows or press Ctrl+C
echo.
pause
