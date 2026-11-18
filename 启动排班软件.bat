@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 排班工作台

set "APP=%~dp0排班工作台\排班工作台.exe"
if not exist "%APP%" (
  echo 未找到桌面程序，请确认本目录下的“排班工作台”文件夹完整。
  pause
  exit /b 1
)
start "" "%APP%"
endlocal
