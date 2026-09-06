@echo off
chcp 65001 >nul
title AgentFarm2 联机版 - 开房
cd /d "%~dp0"
echo ============================================
echo   AgentFarm2 联机版 - 启动器
echo   本窗口 = 你的房间服务器（别关它）
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/  (LTS 版)
  echo 安装完成后重新双击本文件。
  pause
  exit /b 1
)

:: 检查是否指定了存档位（默认1）
set SLOT=1
if not "%~1"=="" set SLOT=%~1

echo [1/2] 启动房间服务器（存档位 %SLOT%，端口 8080）...
start "AgentFarm2 房间" /min cmd /c "node server\afserver.mjs --slot=%SLOT%"
timeout /t 2 /nobreak >nul
echo [2/2] 打开游戏窗口...
start http://127.0.0.1:8080/
echo.
echo 房间已开！把下面地址发给朋友（同一局域网可直接连）：
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=*" %%b in ("%%a") do echo   http://%%b:8080/
)
echo.
echo 不同网络的朋友：用 cpolar/ngrok 做内网穿透（见 联机教程.md）
echo 本窗口可关闭（房间服务器在最小化窗口里运行）。
timeout /t 8 /nobreak >nul
exit /b 0
