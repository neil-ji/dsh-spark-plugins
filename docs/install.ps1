<#
.SYNOPSIS
  dsh-spark-plugins 一键安装 / 更新（Windows / PowerShell）。

.DESCRIPTION
  默认路径（推荐）：从 GitHub Release 下载 CI 预构建的 tarball —— 不 clone、不构建。
    但仍需要 pnpm（把 tarball 解析进 profile 的 node_modules），见下方「前置」。
    1. 取 manifest.json（版本、dsh 兼容区间、每个包的 sha256）
    2. 取 release-install.mjs 并按 manifest 校验其 sha256
    3. 安装器下载各包 tarball、逐个校验 sha256，再写进目标 dsh profile

  与 docs/install.sh 行为一致（-FromSource 对应 clone + 构建的老路径）。

  目标 home 解析顺序：-DshHome > $env:DSH_HOME > $env:USERPROFILE\.dsh。

  前置：Node.js >= 18；**安装/卸载都需要 pnpm**（把 tarball 解析进 profile 的
  node_modules）。没有 pnpm 时用 `corepack enable`（Node 16.9+ 自带）或
  `npm install -g pnpm`。安装器会在改动任何 profile 文件前先检查。

.EXAMPLE
  irm https://neil-ji.github.io/dsh-spark-plugins/install.ps1 -OutFile install.ps1; .\install.ps1
.EXAMPLE
  .\install.ps1 -Profile web -Version v0.2.0
.EXAMPLE
  .\install.ps1 -DshHome .\.dev\home -Profile devweb -DryRun
.EXAMPLE
  .\install.ps1 -Uninstall                 # 卸载（保留 profile 里其它插件）
.EXAMPLE
  .\install.ps1 -Uninstall -DryRun         # 卸载预演
.EXAMPLE
  .\install.ps1 -FromSource -LocalDir F:\AgentStudio\dsh-spark-plugins -NoProfile
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Version,
  [Alias('Home')][string]$DshHome,
  [string]$Only,
  [string]$BaseUrl,
  [string]$Repo = 'https://github.com/neil-ji/dsh-spark-plugins',
  [switch]$DryRun,
  # ── 卸载 ──
  [switch]$Uninstall,
  [switch]$KeepCache,
  # ── -FromSource 老路径专用 ──
  [switch]$FromSource,
  [string]$Ref = 'main',
  [string]$Dir,
  [string]$LocalDir,
  [switch]$NoProfile,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

function Resolve-DshHome {
  if ($DshHome) {
    $resolved = Resolve-Path -LiteralPath $DshHome -ErrorAction SilentlyContinue
    if ($resolved) { return $resolved.Path }
    return [System.IO.Path]::GetFullPath($DshHome)
  }
  if ($env:DSH_HOME -and $env:DSH_HOME.Trim() -ne '') { return [System.IO.Path]::GetFullPath($env:DSH_HOME) }
  $userHome = $env:USERPROFILE
  if (-not $userHome) { $userHome = $HOME }
  return (Join-Path $userHome '.dsh')
}

$homeDir = Resolve-DshHome

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "OK  $message" -ForegroundColor Green }
function Fail($message) { Write-Host "x   $message" -ForegroundColor Red; exit 1 }

function Assert-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail '需要 Node.js >= 18（https://nodejs.org）' }
  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -lt 18) { Fail "Node.js 版本过低（$major），需要 >= 18" }
}

# 安装/卸载都需要 pnpm（安装器要它把 tarball 解析进 profile 的 node_modules）。
# 与 install.sh 同口径：先试 corepack，再退回 npm -g。必须在改动 profile 之前失败。
function Assert-Pnpm {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { return }
  Write-Step '未检测到 pnpm，尝试 corepack 启用'
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    try { Invoke-Checked 'corepack' @('enable') } catch { }
  }
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { return }
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    try { Invoke-Checked 'npm' @('install', '-g', 'pnpm') } catch { }
  }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail "找不到 pnpm —— 安装需要它把 tarball 解析进 profile 的 node_modules。`n   装法（任选一）：`n     corepack enable          # Node 16.9+ 自带，最省事`n     npm install -g pnpm`n   装完重跑本命令即可；本次尚未改动任何 profile 文件。"
  }
}

# 取一个资产：支持 http(s) / file:// / 本地目录（后者便于离线镜像与自测）
function Get-Asset {
  param([string]$Url, [string]$Destination)
  if ($DryRun) { Write-Host "    [dry-run] 取 $Url" -ForegroundColor DarkGray; return }
  if ($Url -match '^https?://') {
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
  } elseif ($Url -match '^file://') {
    Copy-Item -LiteralPath ([uri]$Url).LocalPath -Destination $Destination -Force
  } else {
    Copy-Item -LiteralPath $Url -Destination $Destination -Force
  }
}

function Invoke-Checked {
  param([string]$File, [string[]]$Arguments, [string]$WorkDir)
  $rendered = ($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  if ($DryRun) { Write-Host "    [dry-run] $File $rendered" -ForegroundColor DarkGray; return }
  if ($WorkDir) { Push-Location $WorkDir }
  # git/pnpm 会往 stderr 写正常进度信息；PS 5.1 在 ErrorActionPreference=Stop 下会把它当异常。
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $code = 0
  try {
    & $File @Arguments
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
    if ($WorkDir) { Pop-Location }
  }
  if ($code -ne 0) { Fail "$File $rendered 失败（exit $code）" }
}

# ── 默认路径：Release 资产 ──────────────────────────────────────────────────
if (-not $FromSource) {
  $versionLabel = if ($Version) { $Version } else { 'latest' }
  $modeLabel = if ($Uninstall) { '卸载器' } else { '安装器' }
  Write-Step "dsh-spark-plugins $modeLabel（release 资产，profile=$Profile version=$versionLabel home=$homeDir）"
  Assert-Node
  # dry-run 不写 profile，不需要 pnpm
  if (-not $DryRun) { Assert-Pnpm }

  if (-not $BaseUrl) {
    if ($Version) { $BaseUrl = "$Repo/releases/download/$Version" }
    else { $BaseUrl = "$Repo/releases/latest/download" }
  }

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-spark-install-" + [System.Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    # ── 卸载：只下载卸载器（不碰 tarball / 清单） ──
    if ($Uninstall) {
      $uninstallerPath = Join-Path $tmp 'release-uninstall.mjs'
      Write-Step "下载卸载器：$BaseUrl/release-uninstall.mjs"
      Get-Asset "$BaseUrl/release-uninstall.mjs" $uninstallerPath
      $uninstallArgs = @($uninstallerPath, '--profile', $Profile, '--home', $homeDir)
      if ($DryRun) { $uninstallArgs += '--dry-run' }
      if ($KeepCache) { $uninstallArgs += '--keep-cache' }
      Write-Step '卸载'
      Invoke-Checked 'node' $uninstallArgs
      Write-Host ''
      Write-Ok "卸载完成。重启 dsh 生效："
      Write-Host "   dsh --profile $Profile" -ForegroundColor White
      exit 0
    }

    $manifestPath = Join-Path $tmp 'manifest.json'
    $installerPath = Join-Path $tmp 'release-install.mjs'
    Write-Step "下载清单：$BaseUrl/manifest.json"
    Get-Asset "$BaseUrl/manifest.json" $manifestPath
    Write-Step "下载安装器：$BaseUrl/release-install.mjs"
    Get-Asset "$BaseUrl/release-install.mjs" $installerPath

    if (-not $DryRun) {
      Write-Step '校验安装器 sha256'
      $verify = @'
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const [manifestPath, filePath] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const want = manifest.installer && manifest.installer.sha256
if (!want) { console.error('清单里没有 installer.sha256'); process.exit(1) }
const got = createHash('sha256').update(readFileSync(filePath)).digest('hex')
if (got !== want) { console.error('安装器校验失败：期望 ' + want + '，实际 ' + got); process.exit(1) }
console.log('    OK sha256 ' + got.slice(0, 12) + '... (' + manifest.tag + ')')
'@
      $verifyPath = Join-Path $tmp 'verify.cjs'
      [System.IO.File]::WriteAllText($verifyPath, $verify, (New-Object System.Text.UTF8Encoding($false)))
      Invoke-Checked 'node' @($verifyPath, $manifestPath, $installerPath)
    }

    $installArgs = @($installerPath, '--base-url', $BaseUrl, '--profile', $Profile, '--home', $homeDir)
    if ($Only) { $installArgs += @('--only', $Only) }
    if ($DryRun) { $installArgs += '--dry-run' }
    Write-Step '安装'
    Invoke-Checked 'node' $installArgs
  } finally {
    if (-not $DryRun) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  }

  Write-Host ''
  Write-Ok "完成。重启 dsh 生效："
  Write-Host "   dsh --profile $Profile" -ForegroundColor White
  Write-Host "   卸载：.\install.ps1 -Uninstall -Profile $Profile" -ForegroundColor DarkGray
  exit 0
}

# ── -FromSource：clone + 构建 ───────────────────────────────────────────────
if (-not $Dir) { $Dir = Join-Path $homeDir 'spark-plugins' }
if ($LocalDir) { $Dir = (Resolve-Path -LiteralPath $LocalDir).Path }

Write-Step "dsh-spark-plugins 安装器（源码构建，profile=$Profile ref=$Ref dir=$Dir home=$homeDir）"
Assert-Node
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '需要 git（winget install --id Git.Git -e 或 https://git-scm.com/download/win）' }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Step '未检测到 pnpm，尝试 corepack 启用'
  if (Get-Command corepack -ErrorAction SilentlyContinue) { Invoke-Checked 'corepack' @('enable') }
  else { Invoke-Checked 'npm' @('install', '-g', 'pnpm') }
}

if ($LocalDir) {
  Write-Step "使用本地检出：$Dir（跳过 clone/update）"
} elseif (Test-Path -LiteralPath (Join-Path $Dir '.git')) {
  Write-Step "更新已有克隆：$Dir"
  Invoke-Checked 'git' @('-C', $Dir, 'fetch', '--depth', '1', 'origin', $Ref)
  Invoke-Checked 'git' @('-C', $Dir, 'checkout', '-q', 'FETCH_HEAD')
} else {
  Write-Step "克隆仓库到 $Dir"
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dir) | Out-Null }
  Invoke-Checked 'git' @('clone', '--depth', '1', '-b', $Ref, "$Repo.git", $Dir)
}

Write-Step '安装依赖（首次较慢）'
Invoke-Checked 'pnpm' @('install', '--config.confirmModulesPurge=false') $Dir

if ($NoBuild) {
  Write-Step '跳过构建（-NoBuild）'
} else {
  Write-Step '构建全部包'
  Invoke-Checked 'pnpm' @('-r', 'build') $Dir
}

if ($NoProfile) {
  Write-Step '跳过 profile 安装（-NoProfile）'
} else {
  Write-Step "安装到 dsh profile：$Profile（home=$homeDir）"
  $installer = Join-Path $Dir 'scripts\install-profile.mjs'
  if (-not $DryRun -and -not (Test-Path -LiteralPath $installer)) { Fail "找不到 $installer（源码可能太旧，请更新）" }
  Invoke-Checked 'node' @($installer, $Profile, '--home', $homeDir, '--no-build', '--register-bundles') $Dir
}

Write-Host ''
Write-Ok "完成。重启 dsh 生效："
Write-Host "   dsh --profile $Profile" -ForegroundColor White
Write-Host "   卸载：.\install.ps1 -Uninstall -Profile $Profile" -ForegroundColor DarkGray
