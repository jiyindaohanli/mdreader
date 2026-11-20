@echo off
chcp 65001 >nul
title 把 MDReader 加入右键菜单

if not exist "%~dp0MDReader.exe" (
  echo.
  echo 没找到 MDReader.exe：请把本文件和 MDReader.exe 放在同一个文件夹。
  echo.
  pause
  exit /b 1
)

echo 正在注册...
start "" /wait "%~dp0MDReader.exe" --register

reg query "HKCU\Software\Classes\cn.evegood.mdreader.md" >nul 2>&1
if errorlevel 1 (
  echo.
  echo 注册失败：Windows 没能写入 HKCU 的注册表项。
  echo.
  pause
  exit /b 1
)

echo.
echo 完成。以后右键 .md 就能看到：
echo   右键 - 显示更多选项 - 用 MDReader 打开
echo   右键 - 打开方式 - MDReader
echo.
echo 注册是永久的，不需要让 MDReader 一直运行，也不用每次先打开它。
echo 移动 exe 后，再双击一次本文件即可。
echo.
pause
