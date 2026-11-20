@echo off
chcp 65001 >nul
title 从右键菜单移除 MDReader

if not exist "%~dp0MDReader.exe" (
  echo.
  echo 没找到 MDReader.exe：请把本文件和 MDReader.exe 放在同一个文件夹。
  echo.
  pause
  exit /b 1
)

echo 正在取消...
start "" /wait "%~dp0MDReader.exe" --unregister

reg query "HKCU\Software\Classes\cn.evegood.mdreader.md" >nul 2>&1
if errorlevel 1 (
  echo.
  echo 已取消：右键菜单里的 MDReader 项已经移除。
  echo 不会删除你的文档、历史记录和会话。
) else (
  echo.
  echo 取消失败：注册表项还在，请确认 MDReader.exe 与本文件在同一文件夹后重试。
)
echo.
pause
