@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 分数最优推进

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [提示] 本机没找到 Node.js，改为直接用默认浏览器打开 index.html
  echo.
  start "" "%~dp0index.html"
  echo   已打开。关闭本窗口即可。
  pause >nul
  exit /b
)

echo.
echo   正在启动本地服务，浏览器会自动打开 http://localhost:8080
echo   手机想一起用的话，看下面打印出的「手机浏览器」地址（需同一 WiFi）。
echo   用完按 Ctrl+C 或直接关掉本窗口即可。
echo.

rem 先让服务起来，2 秒后再开浏览器，避免打开时服务还没就绪
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8080"
node "%~dp0serve.js" 8080
