@echo off
chcp 65001 >nul
cd /d %~dp0..
title AgentFarm2 服务器
echo ============================================
echo   AgentFarm2 —— 原版外壳 × Agent 联机
echo   单端口 8080（网页 + 存档 API + 联机 WS）
echo ============================================
if exist server\world.json (
    echo [世界] 已有存档，继续运行
) else (
    echo [世界] 首次启动，将从 seed 创建世界
)
echo [提示] 浏览器打开 http://127.0.0.1:8080/ 进入游戏
echo [提示] 关掉本窗口即停止服务器
echo.
node server\afserver.mjs
pause
