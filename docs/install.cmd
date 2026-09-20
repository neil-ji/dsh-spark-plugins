@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM dsh-spark-plugins 一键安装 / 更新 / 卸载（Windows cmd.exe）
REM
REM 这是一个**薄包装**：cmd 不能直接跑 .ps1，所以这里只做两件事 ——
REM   1. 找到（或下载）install.ps1
REM   2. 用 powershell -ExecutionPolicy Bypass 转发过去，逻辑只有一份
REM
REM 用法（cmd.exe / 双击 均可）：
REM   install.cmd                      安装 / 更新到最新
REM   install.cmd -Profile web         指定 profile
REM   install.cmd -Version v0.2.0      装指定 tag
REM   install.cmd -Only dsh-spark,dsh-connector-npm
REM   install.cmd -DshHome C:\dsh-home 指定 DSH_HOME
REM   install.cmd -DryRun              只打印将做什么
REM   install.cmd -Uninstall           卸载（保留 profile 里其它插件）
REM   install.cmd -Uninstall -DryRun   卸载预演
REM   install.cmd -KeepCache           卸载但保留缓存
REM   install.cmd -FromSource          源码路径（clone + pnpm install + build）
REM
REM 前置：Node.js >= 18；安装/卸载还需要 pnpm（corepack enable 或 npm i -g pnpm）。
REM
REM 也可不下载本文件，直接一行：
REM   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://neil-ji.github.io/dsh-spark-plugins/install.ps1 -OutFile $env:TEMP\install.ps1; & $env:TEMP\install.ps1"
REM ─────────────────────────────────────────────────────────────────────────────
setlocal

set "SCRIPT_URL=https://neil-ji.github.io/dsh-spark-plugins/install.ps1"
set "PS1=%~dp0install.ps1"

REM 优先用同目录的 install.ps1（离线 / 已下载场景），否则从落地页取一份
if exist "%PS1%" goto :run

set "PS1=%TEMP%\dsh-spark-install.ps1"
echo ==^> 下载 install.ps1
echo     %SCRIPT_URL%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%SCRIPT_URL%' -OutFile '%TEMP%\dsh-spark-install.ps1' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :download_failed

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo x  安装器以退出码 %CODE% 结束。
)
endlocal & exit /b %CODE%

:download_failed
echo.
echo x  下载失败：%SCRIPT_URL%
echo    请检查网络，或手动下载 install.ps1 放到本文件同目录后重跑。
endlocal & exit /b 1