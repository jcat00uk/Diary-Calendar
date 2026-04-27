@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: Chronicle — Build Script
:: Run from: S:\Coding\Diary Calendar\
:: ============================================================

set "SRC=%~dp0"
set "WWWDIR=S:\Coding\Chronicle Android\Chronicle\Chronicle\www"
set "ANDROIDDIR=S:\Coding\Chronicle Android\Chronicle\Chronicle"
set "GRADLEDIR=S:\Coding\Chronicle Android\Chronicle\Chronicle\android"
set PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe
set TERSER=%ANDROIDDIR%\node_modules\.bin\terser
set CAPCMD=%ANDROIDDIR%\node_modules\.bin\cap.cmd
set CAPBIN=%ANDROIDDIR%\node_modules\@capacitor\cli\bin\capacitor

:: ============================================================
:: MENU
:: ============================================================

echo.
echo =========================================
echo        Chronicle Build Script
echo =========================================
echo.
echo Select build mode:
echo   1. Prep only (copy files + cap sync, open Android Studio manually)
echo   2. Auto build signed AAB (for Google Play upload)
echo.
set /p BUILDMODE=Choose (1/2):

if "%BUILDMODE%"=="1" goto start_build
if "%BUILDMODE%"=="2" goto start_build

echo Invalid selection.
pause
exit /b 1

:start_build

:: ============================================================
:: STEP 1: Check prerequisites
:: ============================================================
echo.
echo Step 1: Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install Node.js.
    pause
    exit /b 1
)

if not exist "%ANDROIDDIR%" (
    echo ERROR: Android folder not found at %ANDROIDDIR%
    echo Please run: npx cap init and npx cap add android first.
    pause
    exit /b 1
)

if not exist "%WWWDIR%" (
    echo Creating www folder...
    mkdir "%WWWDIR%"
)

if not exist "%WWWDIR%\js" mkdir "%WWWDIR%\js"
if not exist "%WWWDIR%\css" mkdir "%WWWDIR%\css"
if not exist "%WWWDIR%\assets" mkdir "%WWWDIR%\assets"

:: Install terser if needed
if not exist "%TERSER%" (
    echo Installing terser...
    cd /d "%ANDROIDDIR%"
    call npm install terser --save-dev
    if errorlevel 1 ( echo ERROR: Failed to install terser. & pause & exit /b 1 )
    cd /d "%SRC%"
)

:: Install Capacitor CLI if needed
if not exist "%CAPCMD%" (
    if not exist "%CAPBIN%" (
        echo Installing @capacitor/cli...
        cd /d "%ANDROIDDIR%"
        call npm install @capacitor/cli --save-dev
        if errorlevel 1 ( echo ERROR: Failed to install @capacitor/cli. & pause & exit /b 1 )
        cd /d "%SRC%"
    )
)

:: ============================================================
:: STEP 2: Version timestamp
:: ============================================================
echo.
echo Step 2: Generating version...
"%PS%" -Command "$v = Get-Date -Format 'yyyyMMdd-HHmmss'; [System.IO.File]::WriteAllText('%SRC%ver.tmp', $v)"
set /p version=<"%SRC%ver.tmp"
del "%SRC%ver.tmp"
echo Version: %version%

:: ============================================================
:: STEP 3: Minify JavaScript into www\js\
:: ============================================================
echo.
echo Step 3: Minifying JavaScript...

cd /d "%SRC%"

call "%TERSER%" js\app.js           --compress --mangle -o "%WWWDIR%\js\app.js"
if errorlevel 1 ( echo WARNING: app.js minify failed - copying raw & copy /Y "js\app.js" "%WWWDIR%\js\app.js" >nul )

call "%TERSER%" js\calendar.js      --compress --mangle -o "%WWWDIR%\js\calendar.js"
if errorlevel 1 ( echo WARNING: calendar.js minify failed - copying raw & copy /Y "js\calendar.js" "%WWWDIR%\js\calendar.js" >nul )

call "%TERSER%" js\diary.js         --compress --mangle -o "%WWWDIR%\js\diary.js"
if errorlevel 1 ( echo WARNING: diary.js minify failed - copying raw & copy /Y "js\diary.js" "%WWWDIR%\js\diary.js" >nul )

call "%TERSER%" js\events.js        --compress --mangle -o "%WWWDIR%\js\events.js"
if errorlevel 1 ( echo WARNING: events.js minify failed - copying raw & copy /Y "js\events.js" "%WWWDIR%\js\events.js" >nul )

call "%TERSER%" js\gestures.js      --compress --mangle -o "%WWWDIR%\js\gestures.js"
if errorlevel 1 ( echo WARNING: gestures.js minify failed - copying raw & copy /Y "js\gestures.js" "%WWWDIR%\js\gestures.js" >nul )

call "%TERSER%" js\sync.js          --compress --mangle -o "%WWWDIR%\js\sync.js"
if errorlevel 1 ( echo WARNING: sync.js minify failed - copying raw & copy /Y "js\sync.js" "%WWWDIR%\js\sync.js" >nul )

call "%TERSER%" js\undo.js          --compress --mangle -o "%WWWDIR%\js\undo.js"
if errorlevel 1 ( echo WARNING: undo.js minify failed - copying raw & copy /Y "js\undo.js" "%WWWDIR%\js\undo.js" >nul )

if exist "js\holidays.js" (
    call "%TERSER%" js\holidays.js  --compress --mangle -o "%WWWDIR%\js\holidays.js"
    if errorlevel 1 ( copy /Y "js\holidays.js" "%WWWDIR%\js\holidays.js" >nul )
)

if exist "js\ical.js" (
    call "%TERSER%" js\ical.js      --compress --mangle -o "%WWWDIR%\js\ical.js"
    if errorlevel 1 ( copy /Y "js\ical.js" "%WWWDIR%\js\ical.js" >nul )
)

if exist "js\notifications.js" (
    call "%TERSER%" js\notifications.js --compress --mangle -o "%WWWDIR%\js\notifications.js"
    if errorlevel 1 ( copy /Y "js\notifications.js" "%WWWDIR%\js\notifications.js" >nul )
)

if exist "js\themes.js" (
    call "%TERSER%" js\themes.js    --compress --mangle -o "%WWWDIR%\js\themes.js"
    if errorlevel 1 ( copy /Y "js\themes.js" "%WWWDIR%\js\themes.js" >nul )
)

if exist "js\themeEditor.js" (
    call "%TERSER%" js\themeEditor.js --compress --mangle -o "%WWWDIR%\js\themeEditor.js"
    if errorlevel 1 ( copy /Y "js\themeEditor.js" "%WWWDIR%\js\themeEditor.js" >nul )
)

echo JavaScript minification complete.

:: ============================================================
:: STEP 4: Copy HTML
:: ============================================================
echo.
echo Step 4: Copying HTML...
copy /Y index.html "%WWWDIR%\index.html" >nul
if errorlevel 1 ( echo ERROR: Failed to copy index.html & pause & exit /b 1 )
echo Copied index.html.

:: ============================================================
:: STEP 5: Copy CSS
:: ============================================================
echo.
echo Step 5: Copying CSS...
for %%f in (base.css ribbon.css week-view.css day-card.css expanded-day.css modals.css agenda.css themes.css responsive.css) do (
    if exist "css\%%f" copy /Y "css\%%f" "%WWWDIR%\css\%%f" >nul
)
echo Copied CSS files.

:: ============================================================
:: STEP 6: Copy assets
:: ============================================================
echo.
echo Step 6: Copying assets...
if exist assets\icons.svg   copy /Y "assets\icons.svg"   "%WWWDIR%\assets\icons.svg"   >nul
if exist assets\favicon.ico copy /Y "assets\favicon.ico" "%WWWDIR%\assets\favicon.ico" >nul
if exist favicon.ico        copy /Y "favicon.ico"        "%WWWDIR%\favicon.ico"        >nul
if exist assets\images xcopy /E /I /Q /Y "assets\images" "%WWWDIR%\assets\images" >nul
echo Copied assets.

:: ============================================================
:: STEP 7: Cache buster — stamp version into index.html
:: ============================================================
echo.
echo Step 7: Stamping version %version%...
"%PS%" -Command "(Get-Content '%WWWDIR%\index.html') -replace '\?v=[.\d-]+', '?v=%version%' | Set-Content '%WWWDIR%\index.html'"
echo Version stamped.

:: ============================================================
:: STEP 8: Copy capacitor.config.json
:: ============================================================
echo.
echo Step 8: Copying capacitor.config.json...
if exist capacitor.config.json (
    copy /Y capacitor.config.json "%ANDROIDDIR%\capacitor.config.json" >nul
    echo Copied capacitor.config.json.
) else (
    echo WARNING: capacitor.config.json not found at %SRC%capacitor.config.json
)

:: ============================================================
:: STEP 9: Cap sync
:: ============================================================
echo.
echo Step 9: Running cap sync...
cd /d "%ANDROIDDIR%"

if exist "%CAPCMD%" (
    call "%CAPCMD%" sync
) else (
    call node "%CAPBIN%" sync
)
if errorlevel 1 (
    echo ERROR: cap sync failed.
    pause
    exit /b 1
)
echo Cap sync complete.

:: ============================================================
:: STEP 10: Build AAB or prep only
:: ============================================================
if not "%BUILDMODE%"=="2" goto prep_only

echo.
echo Step 10: Building signed AAB...
cd /d "%GRADLEDIR%"
call gradlew.bat :app:bundleRelease
if errorlevel 1 (
    echo ERROR: AAB build failed. Check Android Studio for details.
    pause
    exit /b 1
)

set "AAB_SRC=%GRADLEDIR%\app\build\outputs\bundle\release\app-release.aab"
set "AAB_DEST=%GRADLEDIR%\app\build\outputs\bundle\release\chronicle-release-%version%.aab"

if exist "%AAB_SRC%" (
    copy "%AAB_SRC%" "%AAB_DEST%" >nul
    echo.
    echo AAB ready: chronicle-release-%version%.aab
)

%SystemRoot%\explorer.exe "%GRADLEDIR%\app\build\outputs\bundle\release\"
goto done

:prep_only
echo.
echo =========================================
echo  Prep complete!
echo  Files copied and cap sync done.
echo  Open Android Studio to run or build.
echo =========================================
echo.
echo  Android project: %ANDROIDDIR%
echo.

:done
echo.
echo === Chronicle build complete: v%version% ===
echo.
pause
endlocal
goto :eof
