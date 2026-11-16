# Plannotator Windows Installer
param(
    [string]$Version = "latest",
    [switch]$VerifyAttestation,
    [switch]$SkipAttestation,
    [switch]$Extras,
    [switch]$NoExtras,
    [string]$ModelInvocable = "",
    [switch]$NonInteractive,
    [switch]$Reconfigure,
    [Alias("BinaryOnly")]
    [switch]$Minimal,
    [switch]$NoMinimal,
    # Opt-in install of the pruned CallDiff call-flow core (default off;
    # the review UI offers a one-click install). Mirrors install.sh's
    # --with-call-flow.
    [switch]$WithCallFlow,
    [switch]$SkipOpencode,
    # Same shape as the per-agent switches, but scoped to the skills/slash
    # command sparse checkout rather than one agent's home: -SkipSkills turns
    # the whole fetch into a no-op for every scope it writes (Claude,
    # ~/.agents, OpenCode), including the extras and the
    # skill-scope cleanup sweeps. Mirrors install.sh's --skip-skills.
    [switch]$SkipSkills,
    # Do not update an installed Claude Code plugin (see
    # Update-ClaudePluginIfInstalled). Mirrors install.sh's --skip-claude-plugin.
    [switch]$SkipClaudePlugin
)

$ErrorActionPreference = "Stop"

# Reject mutually-exclusive flag combinations upfront. Passing both is
# almost always a typo or wrapper-script misconfiguration; guessing which
# one the user meant is worse than failing fast.
if ($VerifyAttestation -and $SkipAttestation) {
    [Console]::Error.WriteLine("-VerifyAttestation and -SkipAttestation are mutually exclusive. Pass one or the other.")
    exit 1
}
if ($Extras -and $NoExtras) {
    [Console]::Error.WriteLine("-Extras and -NoExtras are mutually exclusive. Pass one or the other.")
    exit 1
}
if ($Minimal -and $NoMinimal) {
    [Console]::Error.WriteLine("-Minimal and -NoMinimal are mutually exclusive. Pass one or the other.")
    exit 1
}

# Binary-only mode. Installs just the plannotator binary and no persistent state
# elsewhere - no sem sidecar, CallDiff or agent-terminal runtime, skills, hooks, or per-agent
# config. Precedence: -Minimal / -NoMinimal switch > PLANNOTATOR_MINIMAL env var
# > default (off). Mirrors install.sh's --minimal / --no-minimal.
$minimal = $false
if ($env:PLANNOTATOR_MINIMAL -match '^(1|true|yes)$') {
    $minimal = $true
}
if ($Minimal) { $minimal = $true }
if ($NoMinimal) { $minimal = $false }

$repo = "backnotprop/plannotator"
$semRepo = "Ataraxy-Labs/sem"
$semVersion = "v0.8.0"
$installDir = "$env:LOCALAPPDATA\plannotator"
$targetExe = "$installDir\plannotator.exe"

# A run stopped between the two moves of the binary swap (below) left no
# plannotator.exe, only the one it had moved aside: put the newest of those
# back first, so there is a working binary even if this run stops early.
if (-not (Test-Path -LiteralPath $targetExe)) {
    try {
        $leftAside = Get-ChildItem -Path $installDir -Filter "plannotator.exe.old*" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^plannotator\.exe\.old(-[0-9a-f]{32})?$' } |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if ($leftAside) { Move-Item -LiteralPath $leftAside.FullName -Destination $targetExe -ErrorAction Stop }
    } catch {}
}

# First plannotator release that carries SLSA build-provenance attestations.
# See scripts/install.sh for the full explanation - this constant is bumped
# once at the first attested release via the release skill.
$minAttestedVersion = "v0.17.2"

# Detect architecture. Native ARM64 Windows binaries are built from
# bun-windows-arm64 (stable since Bun v1.3.10), so ARM64 hosts get a
# native binary - no Windows x86-64 emulation tax.
#
# PROCESSOR_ARCHITECTURE reports the architecture the current PowerShell
# process is running under. PROCESSOR_ARCHITEW6432 is set only in 32-bit
# processes running via WoW64 and reflects the HOST architecture. Prefer
# the latter when present so a 32-bit PowerShell on ARM64 Windows still
# selects the native arm64 binary. Matches install.cmd's detection.
if (-not [Environment]::Is64BitOperatingSystem) {
    # Write-Error under $ErrorActionPreference = "Stop" (set at the top
    # of this file) raises a terminating error that exits the process
    # with code 1. No explicit `exit 1` needed here - it would be
    # unreachable. Same applies to every other Write-Error in this file.
    Write-Error "32-bit Windows is not supported"
}
$hostArch = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
} else {
    $env:PROCESSOR_ARCHITECTURE
}
if ($hostArch -eq "ARM64") {
    $arch = "arm64"
} elseif ($hostArch -eq "AMD64") {
    $arch = "x64"
} else {
    Write-Error "Unsupported Windows architecture: $hostArch"
}

$platform = "win32-$arch"
$binaryName = "plannotator-$platform.exe"

# Clean up old install locations that may take precedence in PATH
$oldLocations = @(
    "$env:USERPROFILE\.local\bin\plannotator.exe",
    "$env:USERPROFILE\.local\bin\plannotator"
)

foreach ($oldPath in $oldLocations) {
    if (Test-Path $oldPath) {
        Write-Host "Removing old installation at $oldPath..."
        Remove-Item -Force $oldPath -ErrorAction SilentlyContinue
    }
}

if ($Version -eq "latest") {
    Write-Host "Fetching latest version..."

    # api.github.com caps unauthenticated requests at 60/hour per source IP,
    # which fails installs behind shared egress IPs (NAT/CGNAT/corporate
    # proxies) and during repeated/debug runs within an hour. Attach an
    # Authorization header when a token is available (raises the limit to
    # 5000/hour); when none is found, fall back to anonymous (unchanged
    # behavior). Precedence matches `gh`: GITHUB_TOKEN > GH_TOKEN > gh auth token.
    $ghToken = $env:GITHUB_TOKEN
    if (-not $ghToken) { $ghToken = $env:GH_TOKEN }
    if (-not $ghToken -and (Get-Command gh -ErrorAction SilentlyContinue)) {
        # --hostname github.com scopes the fallback to github.com credentials,
        # so a gh setup whose default host is a GitHub Enterprise server never
        # leaks a GHES token to api.github.com. On an ancient gh without the
        # flag, stderr is swallowed and we fall back to anonymous.
        try { $ghToken = (gh auth token --hostname github.com 2>$null) } catch { }
    }
    $ghHeaders = if ($ghToken) { @{ Authorization = "Bearer $ghToken" } } else { @{} }
    # A stale/revoked token (expired GITHUB_TOKEN lingering in CI images,
    # dotfiles, direnv) gets a 401 here and would break an install that
    # works fine anonymously today. Retry anonymously ONLY on HTTP 401:
    # requests carrying invalid credentials count against the anonymous
    # 60/hour per-IP pool, so a blind retry on any failure would double the
    # burn, and network failures gain nothing from a second attempt. The
    # [int] cast handles both Windows PowerShell 5.1 (HttpWebResponse enum)
    # and PowerShell 7 (HttpResponseMessage); the inner try guards a null
    # Response (e.g. DNS failure). See backnotprop/plannotator#1157.
    $apiUrl = "https://api.github.com/repos/$repo/releases/latest"
    $release = $null
    $apiError = $null
    try {
        $release = Invoke-RestMethod -Uri $apiUrl -Headers $ghHeaders
    } catch {
        $status = $null
        try { $status = [int]$_.Exception.Response.StatusCode } catch { }
        if ($ghHeaders.Count -gt 0 -and $status -eq 401) {
            try {
                $release = Invoke-RestMethod -Uri $apiUrl
            } catch {
                $apiError = "Failed to fetch latest version: $($_.Exception.Message)"
            }
        } else {
            $apiError = "Failed to fetch latest version: $($_.Exception.Message) (if this is HTTP 403, the GitHub API may be rate-limiting your IP; see https://github.com/backnotprop/plannotator/issues/1156)"
        }
    }
    # Drop the local token copies; GITHUB_TOKEN / GH_TOKEN themselves remain
    # in the environment exactly as the user set them.
    $ghToken = $null; $ghHeaders = $null; $apiUrl = $null
    # Only a plain vX.Y.Z tag is accepted, from the API or the redirect below:
    # it goes into download URLs, the attestation --source-ref and git clone
    # --branch. -cmatch: case-sensitive; \z: the very end, with no trailing
    # newline; [0-9], not \d, which also matches non-ASCII digits.
    $releaseTagPattern = '^v[0-9]+\.[0-9]+\.[0-9]+\z'
    $latestTag = if ($release) { [string]$release.tag_name } else { $null }
    if ($latestTag -cnotmatch $releaseTagPattern) { $latestTag = $null }

    # The API failed (anonymous rate limit of 60/hour per IP, a proxy that
    # blocks api.github.com): read the tag from the redirect that
    # github.com/<repo>/releases/latest answers with (.../releases/tag/vX.Y.Z),
    # which is not rate-limited and needs no token or gh.
    if (-not $latestTag) {
        try {
            $req = [System.Net.WebRequest]::Create("https://github.com/$repo/releases/latest")
            $req.Method = "HEAD"
            $resp = $req.GetResponse()
            $candidate = $resp.ResponseUri.Segments[-1]
            $resp.Close()
            if ($candidate -cmatch $releaseTagPattern) { $latestTag = $candidate }
        } catch { }
    }

    if (-not $latestTag) {
        if (-not $apiError) { $apiError = "Failed to fetch latest version" }
        Write-Error "$apiError (check your connection, or pass -Version vX.Y.Z)"
    }
} else {
    # Normalize: auto-prefix v if missing (matches install.cmd behaviour)
    if ($Version -like "v*") {
        $latestTag = $Version
    } else {
        $latestTag = "v$Version"
    }
}

Write-Host "Installing plannotator $latestTag..."

# Resolve SLSA build-provenance verification opt-in BEFORE the download so we
# can fail fast without wasting bandwidth if the requested tag predates
# provenance support. Precedence: CLI flag > env var > config file > default.
$verifyAttestationResolved = $false
# CallDiff call-flow runtime opt-in. Same three-layer shape:
# -WithCallFlow > PLANNOTATOR_INSTALL_CALLDIFF > config installCallFlow >
# default (off).
$installCallFlowResolved = $false

# Layer 3: config file (lowest precedence of the opt-in sources).
# Unset PLANNOTATOR_DATA_DIR: an existing ~/.plannotator (legacy default)
# wins, unless it holds none of Plannotator's data while
# $XDG_DATA_HOME\plannotator does (a stray folder, #2305); otherwise an
# explicitly-set absolute XDG_DATA_HOME (rare on Windows but honored the same
# way as the runtime, packages/shared/data-dir.ts) places the directory at
# $XDG_DATA_HOME\plannotator; otherwise ~/.plannotator.
# Paths under XDG_DATA_HOME are built with [System.IO.Path]::Combine, never
# Join-Path: Join-Path throws for a drive that is not mounted, and under
# $ErrorActionPreference = "Stop" that would abort the install for a user
# whose ~/.plannotator was fine. Test-Path only answers false for one.
# BEGIN data-dir resolution (tests/data-dir-mirrors.test.ts and windows.yml run this block)
$dataDirMarkers = @("history", "sessions", "drafts", "inbox", "claude-code-mod", "install-flags.json")
function Test-PlannotatorData([string]$dir) {
    foreach ($marker in $dataDirMarkers) { if (Test-Path -LiteralPath ([System.IO.Path]::Combine($dir, $marker))) { return $true } }
    return $false
}
$configDir = if ($env:PLANNOTATOR_DATA_DIR) { $env:PLANNOTATOR_DATA_DIR.Trim() } else {
    $legacyDir = Join-Path $env:USERPROFILE ".plannotator"
    $xdgDataHome = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME.Trim() } else { "" }
    $xdgDir = if ($xdgDataHome -and [System.IO.Path]::IsPathRooted($xdgDataHome)) { [System.IO.Path]::Combine($xdgDataHome, "plannotator") } else { "" }
    if (Test-Path $legacyDir) {
        if ($xdgDir -and (Test-Path -LiteralPath $xdgDir) -and (Test-PlannotatorData $xdgDir) -and -not (Test-PlannotatorData $legacyDir)) { $xdgDir } else { $legacyDir }
    } elseif ($xdgDir) {
        $xdgDir
    } else {
        $legacyDir
    }
}
if ($configDir -eq "~") {
    $configDir = $env:USERPROFILE
} elseif ($configDir.StartsWith("~/") -or $configDir.StartsWith('~\')) {
    $configDir = Join-Path $env:USERPROFILE ($configDir.Substring(2))
}
# END data-dir resolution

# Remember the install-affecting choices this run took from COMMAND-LINE
# switches (#1634), so a background auto-update re-runs this script with the
# same ones. Only the known switch set is written, as neutral ids shared with
# install.sh / install.cmd (never raw arguments, paths, or secrets); env vars
# and config.json survive on their own and are not recorded. A run with none of
# these switches writes an empty set, which is how a manual re-run with no
# switches goes back to defaults. Best effort: a failed write never fails the
# install.
function Write-InstallFlags {
    $ids = @()
    if ($Minimal) { $ids += "minimal" }
    if ($NoMinimal) { $ids += "no-minimal" }
    if ($VerifyAttestation) { $ids += "verify-attestation" }
    if ($SkipAttestation) { $ids += "skip-attestation" }
    if ($WithCallFlow) { $ids += "with-call-flow" }
    if ($SkipOpencode) { $ids += "skip-opencode" }
    if ($SkipSkills) { $ids += "skip-skills" }
    if ($SkipClaudePlugin) { $ids += "skip-claude-plugin" }
    $quoted = ($ids | ForEach-Object { '"' + $_ + '"' }) -join ","
    $path = Join-Path $configDir "install-flags.json"
    $tmp = "$path.tmp.$PID"
    try {
        New-Item -ItemType Directory -Force -Path $configDir -ErrorAction Stop | Out-Null
        [System.IO.File]::WriteAllText($tmp, ('{"v":1,"flags":[' + $quoted + ']}' + "`n"))
        Move-Item -Force -LiteralPath $tmp -Destination $path -ErrorAction Stop
    } catch {
        Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
}

function Install-SemSidecar {
    if ($env:PLANNOTATOR_SKIP_SEM_INSTALL -match '^(1|true|yes)$') {
        Write-Host "Skipping semantic diff sidecar install (PLANNOTATOR_SKIP_SEM_INSTALL is set)"
        return
    }

    $semAsset = if ($platform -eq "win32-x64") { "sem-windows-x86_64.zip" } else { $null }
    if (-not $semAsset) {
        Write-Host "Skipping semantic diff sidecar install (sem does not publish $platform)"
        return
    }

    $semDir = Join-Path $configDir "vendor\sem\$semVersion"
    $semPath = Join-Path $semDir "sem.exe"
    if (Test-Path $semPath) {
        try {
            $versionText = & $semPath --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $versionText -match '^sem ') {
                Write-Host "Semantic diff sidecar already installed at $semPath"
                return
            }
        } catch {
            # Replace invalid stale sidecar below.
        }
    }

    $tmpSemDir = Join-Path ([System.IO.Path]::GetTempPath()) "plannotator-sem-$([System.Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $tmpSemDir | Out-Null

    try {
        $semBaseUrl = "https://github.com/$semRepo/releases/download/$semVersion"
        $semArchive = Join-Path $tmpSemDir $semAsset
        # Bounded so a slow/hung download of this optional sidecar can't wedge an
        # install where plannotator already landed; the catch below skips it.
        Invoke-WebRequest -Uri "$semBaseUrl/$semAsset" -OutFile $semArchive -UseBasicParsing -TimeoutSec 120

        # Pinned for $semVersion, not read from the release's checksums.txt
        # (same connection as the archive). Keep in step with install.sh / install.cmd.
        $semSha256 = @{ "sem-windows-x86_64.zip" = "2a4b57f8368f0c88ded52f9ecbe0a85771008e37aa09215fc9ce750adab03d06" }
        $expected = $semSha256[$semAsset]
        if (-not $expected) {
            Write-Host "Skipping semantic diff sidecar install (checksum missing for $semAsset)"
            return
        }

        $actual = (Get-FileHash -Path $semArchive -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected.ToLower()) {
            Write-Host "Skipping semantic diff sidecar install (checksum mismatch)"
            return
        }

        Expand-Archive -Force -Path $semArchive -DestinationPath $tmpSemDir
        $extracted = Get-ChildItem -Path $tmpSemDir -Filter "sem.exe" -Recurse | Select-Object -First 1
        if (-not $extracted) {
            Write-Host "Skipping semantic diff sidecar install (binary missing from archive)"
            return
        }

        New-Item -ItemType Directory -Force -Path $semDir | Out-Null
        Copy-Item -Force $extracted.FullName $semPath
        Write-Host "Semantic diff sidecar installed to $semPath"
    } catch {
        Write-Host "Skipping semantic diff sidecar install ($($_.Exception.Message))"
    } finally {
        Remove-Item -Recurse -Force $tmpSemDir -ErrorAction SilentlyContinue
    }
}

function Install-AgentTerminalRuntime {
    if ($env:PLANNOTATOR_SKIP_AGENT_TERMINAL_INSTALL -match '^(1|true|yes)$') {
        Write-Host "Skipping agent terminal runtime install (PLANNOTATOR_SKIP_AGENT_TERMINAL_INSTALL is set)"
        return
    }

    $plannotatorPath = Join-Path $installDir "plannotator.exe"
    try {
        & $plannotatorPath install-runtime agent-terminal
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Skipping agent terminal runtime install (plannotator install-runtime failed)"
        }
    } catch {
        Write-Host "Skipping agent terminal runtime install ($($_.Exception.Message))"
    }
}

# Strictly opt-in: Call flow is off by default, so a default install never
# downloads even its pruned core. Review-specific packs install in-app.
function Install-CallFlowRuntime {
    if (-not $installCallFlowResolved) {
        Write-Host "Call-flow analysis: available as an in-app opt-in install (enable Call flow in review Settings), or run: plannotator install-runtime call-flow"
        return
    }

    $plannotatorPath = Join-Path $installDir "plannotator.exe"
    try {
        & $plannotatorPath install-runtime call-flow
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Call-flow runtime install failed; it remains available as an in-app opt-in install"
        }
    } catch {
        Write-Host "Call-flow runtime install failed ($($_.Exception.Message)); it remains available as an in-app opt-in install"
    }
}

$configPath = Join-Path $configDir "config.json"
$cfg = $null
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content $configPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        # Strict check: only a real JSON `true` (parsed as [bool]$true) opts in.
        # A stringified "true", a number, etc. do not - matches install.sh, which
        # greps for a literal boolean.
        if ($cfg.verifyAttestation -is [bool] -and $cfg.verifyAttestation) {
            $verifyAttestationResolved = $true
        }
        if ($cfg.installCallFlow -is [bool] -and $cfg.installCallFlow) {
            $installCallFlowResolved = $true
        }
    } catch {
        # Malformed config - ignore, fall through to other layers.
    }
}

# Layer 2: env var (overrides config file).
$envVerify = $env:PLANNOTATOR_VERIFY_ATTESTATION
if ($envVerify) {
    if ($envVerify -match '^(1|true|yes)$') {
        $verifyAttestationResolved = $true
    } elseif ($envVerify -match '^(0|false|no)$') {
        $verifyAttestationResolved = $false
    }
}

# Layer 1: CLI flags win. -VerifyAttestation and -SkipAttestation are
# mutually exclusive and already rejected together at the top of this
# script (lines ~13-16), so at most one of these branches can fire.
if ($VerifyAttestation) { $verifyAttestationResolved = $true }
if ($SkipAttestation)   { $verifyAttestationResolved = $false }

# CallDiff runtime opt-in, layers 2 and 1 (config was read above).
$envInstallCallFlow = $env:PLANNOTATOR_INSTALL_CALLDIFF
if ($envInstallCallFlow) {
    if ($envInstallCallFlow -match '^(1|true|yes)$') {
        $installCallFlowResolved = $true
    } elseif ($envInstallCallFlow -match '^(0|false|no)$') {
        $installCallFlowResolved = $false
    }
}
if ($WithCallFlow) { $installCallFlowResolved = $true }

# Resolve the per-agent integration opt-outs (#1178). Same three-layer shape
# as verifyAttestation: CLI flag > env var > config skipInstall.<agent> >
# default (off). Skip means do-not-write: a skipped agent's home is neither
# written to nor cleaned up, and detected-but-skipped is reported honestly
# as its own state. Each resolved skip remembers its source so the report
# can name what the user set.
$skipOpencodeResolved = $false; $skipOpencodeSource = ""
# skipInstall.skills is not an agent - it opts out of the skills/slash-command
# checkout for every scope at once - but it shares the same three layers.
$skipSkillsResolved = $false; $skipSkillsSource = ""
# skipInstall.claudePlugin opts out of updating an installed Claude Code plugin.
$skipClaudePluginResolved = $false; $skipClaudePluginSource = ""
if ($cfg -and $cfg.skipInstall) {
    if ($cfg.skipInstall.opencode -is [bool] -and $cfg.skipInstall.opencode) {
        $skipOpencodeResolved = $true; $skipOpencodeSource = "config skipInstall.opencode"
    }
    if ($cfg.skipInstall.skills -is [bool] -and $cfg.skipInstall.skills) {
        $skipSkillsResolved = $true; $skipSkillsSource = "config skipInstall.skills"
    }
    if ($cfg.skipInstall.claudePlugin -is [bool] -and $cfg.skipInstall.claudePlugin) {
        $skipClaudePluginResolved = $true; $skipClaudePluginSource = "config skipInstall.claudePlugin"
    }
}
if ($env:PLANNOTATOR_SKIP_OPENCODE_INSTALL -match '^(1|true|yes)$') {
    $skipOpencodeResolved = $true; $skipOpencodeSource = "PLANNOTATOR_SKIP_OPENCODE_INSTALL"
} elseif ($env:PLANNOTATOR_SKIP_OPENCODE_INSTALL -match '^(0|false|no)$') {
    $skipOpencodeResolved = $false; $skipOpencodeSource = ""
}
if ($env:PLANNOTATOR_SKIP_SKILLS_INSTALL -match '^(1|true|yes)$') {
    $skipSkillsResolved = $true; $skipSkillsSource = "PLANNOTATOR_SKIP_SKILLS_INSTALL"
} elseif ($env:PLANNOTATOR_SKIP_SKILLS_INSTALL -match '^(0|false|no)$') {
    $skipSkillsResolved = $false; $skipSkillsSource = ""
}
if ($env:PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE -match '^(1|true|yes)$') {
    $skipClaudePluginResolved = $true; $skipClaudePluginSource = "PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE"
} elseif ($env:PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE -match '^(0|false|no)$') {
    $skipClaudePluginResolved = $false; $skipClaudePluginSource = ""
}
if ($SkipOpencode) { $skipOpencodeResolved = $true; $skipOpencodeSource = "-SkipOpencode" }
if ($SkipSkills) { $skipSkillsResolved = $true; $skipSkillsSource = "-SkipSkills" }
if ($SkipClaudePlugin) { $skipClaudePluginResolved = $true; $skipClaudePluginSource = "-SkipClaudePlugin" }

# Pre-flight: if verification is requested, reject tags older than the first
# attested release before we download anything. Uses PowerShell's [version]
# class for proper numeric comparison (lexicographic string cmp gets
# v0.9.0 vs v0.10.0 backwards).
if ($verifyAttestationResolved) {
    # Pre-release and build-metadata tags (e.g. v0.18.0-rc1) are not
    # supported by [System.Version] - the cast throws on any `-` suffix.
    # install.sh handles these correctly via `sort -V`; Windows has no
    # built-in semver comparator, so we detect and reject explicitly
    # with an accurate error rather than surfacing a confusing "could
    # not parse" message from the catch block below.
    if ($latestTag -match '-') {
        [Console]::Error.WriteLine("Pre-release tags like $latestTag aren't currently supported for provenance verification on Windows. [System.Version] doesn't parse semver prerelease suffixes. Options:")
        [Console]::Error.WriteLine("  - Install without provenance verification: -SkipAttestation")
        [Console]::Error.WriteLine("  - Pin to a stable release tag (no -rc, -beta, etc.)")
        exit 1
    }
    try {
        $resolvedVersion = [version]($latestTag -replace '^v', '')
        $minVersion = [version]($minAttestedVersion -replace '^v', '')
    } catch {
        # Write-Error under Stop raises a new terminating error that
        # propagates past this catch and exits the script with code 1.
        Write-Error "Could not parse version tags for provenance check: latest=$latestTag min=$minAttestedVersion"
    }
    if ($resolvedVersion -lt $minVersion) {
        [Console]::Error.WriteLine("Provenance verification was requested, but $latestTag predates plannotator's attestation support.")
        [Console]::Error.WriteLine("The first release carrying signed build provenance is $minAttestedVersion. Options:")
        [Console]::Error.WriteLine("  - Pin to $minAttestedVersion or later: -Version $minAttestedVersion")
        [Console]::Error.WriteLine("  - Install without provenance verification: -SkipAttestation")
        [Console]::Error.WriteLine("  - Or unset PLANNOTATOR_VERIFY_ATTESTATION / remove verifyAttestation from $configPath")
        exit 1
    }
}

$binaryUrl = "https://github.com/$repo/releases/download/$latestTag/$binaryName"
$checksumUrl = "$binaryUrl.sha256"

# Create install directory
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

$tmpFile = [System.IO.Path]::GetTempFileName()

# Release downloads retry a dropped connection (#2788): one reset used to fail
# the whole install or update. Up to 4 attempts, 2 s apart; the last failure
# stops the script as before. -UseBasicParsing avoids security prompts and
# keeps behavior consistent. No progress bar: on Windows PowerShell 5.1,
# drawing it slows a large Invoke-WebRequest download many times over. The
# binary uses this only when Invoke-ResumableDownload below fails.
# -ExpectedLength (when the size is known) makes a short file a failed
# attempt: Windows PowerShell 5.1's Invoke-WebRequest can return without an
# error when the connection closes before the end of the file.
function Invoke-ReleaseDownload {
    param([string]$Uri, [string]$OutFile, [long]$ExpectedLength = -1)
    $ProgressPreference = 'SilentlyContinue'
    $attempts = 4
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        try {
            if ($OutFile) {
                Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
                if ($ExpectedLength -ge 0 -and (Get-Item -LiteralPath $OutFile).Length -ne $ExpectedLength) {
                    throw "the connection closed before the end of the file"
                }
                return
            }
            return Invoke-WebRequest -Uri $Uri -UseBasicParsing
        } catch {
            if ($attempt -eq $attempts) { throw }
            Write-Host "Download failed ($($_.Exception.Message)); trying again..."
            Start-Sleep -Seconds 2
        }
    }
}

# The binary download continues where a dropped or stalled connection stopped
# (as install.sh's download_release_binary; keep the two in step), instead of
# starting the ~200 MB again from zero. Each attempt is one request to $Uri,
# the github.com URL (it redirects to a signed URL that expires, so that one
# is never reused); after the first, it asks only for the rest of the file
# (a Range request). Bounds: at most 30 attempts, at most 4 in a row that add
# no bytes, 2 s apart, and nothing past 6 hours from the start. A read that
# gets no data for 60 s is a stall: that attempt ends and the next continues.
# A server that answers a Range with the whole file (200) has it written from
# the start; a 206 for another part of the file empties the file so the next
# attempt starts from zero; a 416 (nothing left to send) ends it and the
# checksum decides. Throws when it gives up. HttpWebRequest is what
# Invoke-WebRequest uses on Windows PowerShell 5.1 (same proxy and TLS
# settings), and PowerShell 7 still has it.
# PLANNOTATOR_DOWNLOAD_STALL_SECONDS and PLANNOTATOR_DOWNLOAD_RETRY_DELAY are
# internal knobs for the tests.
function Invoke-ResumableDownload {
    param([string]$Uri, [string]$OutFile)
    $stallMs = 60000
    if ($env:PLANNOTATOR_DOWNLOAD_STALL_SECONDS -match '^[1-9][0-9]*$') { $stallMs = [int]$env:PLANNOTATOR_DOWNLOAD_STALL_SECONDS * 1000 }
    $delay = 2
    if ($env:PLANNOTATOR_DOWNLOAD_RETRY_DELAY -match '^[0-9]+$') { $delay = [int]$env:PLANNOTATOR_DOWNLOAD_RETRY_DELAY }
    $deadline = [DateTime]::UtcNow.AddSeconds(21600)
    $idle = 0
    for ($attempt = 1; $true; $attempt++) {
        $before = [long]0
        if (Test-Path -LiteralPath $OutFile) { $before = [long](Get-Item -LiteralPath $OutFile).Length }
        $request = $null
        $response = $null
        $body = $null
        $file = $null
        $failure = $null
        try {
            $request = [System.Net.WebRequest]::Create($Uri)
            $request.UserAgent = "plannotator-install"
            if ($before -gt 0) { $request.AddRange([long]$before) }
            try {
                $response = $request.GetResponse()
            } catch {
                $webError = $_.Exception
                while ($webError -and -not ($webError -is [System.Net.WebException])) { $webError = $webError.InnerException }
                if ($before -gt 0 -and $webError -and $webError.Response -and [int]$webError.Response.StatusCode -eq 416) {
                    $webError.Response.Close()
                    return
                }
                throw
            }
            $total = [long]-1
            $mode = [System.IO.FileMode]::Append
            if ([int]$response.StatusCode -eq 206) {
                $contentRange = [string]$response.Headers["Content-Range"]
                if (-not ($contentRange -match '^bytes ([0-9]+)-[0-9]+/([0-9]+)$') -or [long]$Matches[1] -ne $before) {
                    [System.IO.File]::WriteAllBytes($OutFile, [byte[]]@())
                    throw "the server sent another part of the file ($contentRange)"
                }
                $total = [long]$Matches[2]
            } else {
                $mode = [System.IO.FileMode]::Create
                $before = [long]0
                $total = [long]$response.ContentLength
            }
            # The size, for the fallback below to check its file against.
            if ($total -ge 0) { $script:binaryDownloadTotal = $total }
            $file = New-Object System.IO.FileStream -ArgumentList $OutFile, $mode, ([System.IO.FileAccess]::Write), ([System.IO.FileShare]::Read)
            $body = $response.GetResponseStream()
            $buffer = New-Object byte[] 65536
            while ($true) {
                $read = $body.ReadAsync($buffer, 0, $buffer.Length)
                if (-not $read.Wait($stallMs)) { throw "no data for $($stallMs / 1000) s" }
                $count = $read.Result
                if ($count -le 0) { break }
                $file.Write($buffer, 0, $count)
                if ([DateTime]::UtcNow -ge $deadline) { throw "the download took more than 6 hours" }
            }
            $file.Flush()
            if ($total -ge 0 -and $file.Length -ne $total) { throw "the connection closed before the end of the file" }
        } catch {
            $failure = $_
        } finally {
            # Abort first: closing a response that is still being sent could
            # wait for the rest of it.
            if ($failure -and $request) { try { $request.Abort() } catch { } }
            if ($file) { try { $file.Dispose() } catch { } }
            if ($body) { try { $body.Dispose() } catch { } }
            if ($response) { try { $response.Close() } catch { } }
        }
        if (-not $failure) { return }
        $now = [long]0
        if (Test-Path -LiteralPath $OutFile) { $now = [long](Get-Item -LiteralPath $OutFile).Length }
        if ($now -gt $before) { $idle = 0 } else { $idle++ }
        if ($attempt -ge 30 -or $idle -ge 4 -or [DateTime]::UtcNow -ge $deadline) { throw $failure }
        Write-Host "Download failed ($($failure.Exception.Message)); trying again..."
        Start-Sleep -Seconds $delay
    }
}

# Verify checksum
# Note: In Windows PowerShell 5.1, Invoke-WebRequest returns .Content as byte[] for non-HTML responses.
# We must handle both byte[] (PS 5.1) and string (PS 7+) for cross-version compatibility.
$checksumResponse = Invoke-ReleaseDownload -Uri $checksumUrl
if ($checksumResponse.Content -is [byte[]]) {
    $checksumContent = [System.Text.Encoding]::UTF8.GetString($checksumResponse.Content)
} else {
    $checksumContent = $checksumResponse.Content
}
$expectedChecksum = $checksumContent.Split(" ")[0].Trim().ToLower()
# The value must be 64 hex characters, as install.sh checks: an empty or
# garbled .sha256 (a proxy's page, a cut-off file) never gets as far as the compare.
if ($expectedChecksum -notmatch '^[0-9a-f]{64}$') {
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    [Console]::Error.WriteLine("The checksum file for $binaryName $latestTag is not a SHA-256 checksum. Nothing was changed; try again later.")
    exit 1
}
$packedSuffixes = @('.gz')
if ($env:PLANNOTATOR_SKIP_COMPRESSED_DOWNLOAD -match '^(1|true|yes)$') { $packedSuffixes = @() }
$taken = $null
foreach ($packedSuffix in $packedSuffixes) {
    $packedFile = [System.IO.Path]::GetTempFileName()
    try {
        $probe = [System.Net.WebRequest]::Create("$binaryUrl$packedSuffix")
        $probe.Method = "HEAD"
        $probe.UserAgent = "plannotator-install"
        $probe.Timeout = 30000
        $probe.GetResponse().Close()
        Invoke-ResumableDownload -Uri "$binaryUrl$packedSuffix" -OutFile $packedFile 6>$null
        $source = [System.IO.File]::OpenRead($packedFile)
        try {
            $gzip = New-Object System.IO.Compression.GZipStream -ArgumentList $source, ([System.IO.Compression.CompressionMode]::Decompress)
            $target = [System.IO.File]::Create($tmpFile)
            try { $gzip.CopyTo($target) } finally { $target.Dispose(); $gzip.Dispose() }
        } finally {
            $source.Dispose()
        }
        if ((Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash.ToLower() -eq $expectedChecksum) { $taken = "$binaryName$packedSuffix" }
    } catch {
    } finally {
        Remove-Item -Force -LiteralPath $packedFile -ErrorAction SilentlyContinue
    }
    if ($taken) { break }
    [System.IO.File]::WriteAllBytes($tmpFile, [byte[]]@())
}

if (-not $taken) {
    $binaryDownloadTotal = [long]-1
    try {
        Invoke-ResumableDownload -Uri $binaryUrl -OutFile $tmpFile
    } catch {
        # The download that came before the resumable one gets the last word, in
        # case something in the one above does not work on this machine.
        Write-Host "Download failed ($($_.Exception.Message)); trying again..."
        try {
            Invoke-ReleaseDownload -Uri $binaryUrl -OutFile $tmpFile -ExpectedLength $binaryDownloadTotal
        } catch {
            Remove-Item -Force -LiteralPath $tmpFile -ErrorAction SilentlyContinue
            throw
        }
    }
    $taken = $binaryName
}
Write-Host "Downloaded $taken."

$actualChecksum = (Get-FileHash -Path $tmpFile -Algorithm SHA256).Hash.ToLower()

if ($actualChecksum -ne $expectedChecksum) {
    Remove-Item $tmpFile -Force
    Write-Error "Checksum verification failed!"
}

if ($verifyAttestationResolved) {
    # $verifyAttestationResolved was decided before the download and the
    # MIN_ATTESTED_VERSION pre-flight already rejected older tags. At this
    # point we know the tag is attested and gh should find a bundle.
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        # Credential-free path first (#1178): the attestations endpoint on
        # api.github.com is world-readable for public repos, so fetch the
        # Sigstore bundle anonymously and hand it to gh via --bundle. This
        # drops the gh-login requirement; gh's own authenticated fetch is
        # only used as a fallback when the public fetch fails. Single fetch
        # attempt, deliberately never retried: the unauthenticated API
        # allows 60 requests/hour per IP.
        $bundleFile = $null
        $bundleFallbackReason = ""
        try {
            $attUrl = "https://api.github.com/repos/$repo/attestations/sha256:$actualChecksum"
            # Raw text via Invoke-WebRequest, NOT Invoke-RestMethod: the
            # bundle is extracted below as a byte-exact substring of the
            # response, never round-tripped through PowerShell's JSON
            # parser. ConvertFrom-Json coerces date-shaped strings into
            # DateTime objects and ConvertTo-Json re-serializes them
            # differently across PowerShell 5.1 and 7, which could corrupt
            # a bundle field and turn into a false verification failure.
            $attResp = Invoke-WebRequest -Uri $attUrl -UseBasicParsing -TimeoutSec 30
            $attRaw = if ($attResp.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($attResp.Content) } else { [string]$attResp.Content }
            # The response is { "attestations": [ { "bundle": {...} } ] }.
            # gh --bundle expects the bundle values themselves, one JSON
            # document per line (the JSONL format `gh attestation download`
            # writes). Scan for each `"bundle":` key and copy its balanced
            # object verbatim; the scanner is string-literal aware so
            # braces inside JSON strings cannot derail the depth count.
            $bundles = @()
            $searchFrom = 0
            while ($true) {
                # Ordinal comparison: culture-sensitive IndexOf can mismatch
                # under exotic locales; byte-literal key search must not.
                $keyIdx = $attRaw.IndexOf('"bundle"', $searchFrom, [System.StringComparison]::Ordinal)
                if ($keyIdx -lt 0) { break }
                $searchFrom = $keyIdx + 8
                $i = $keyIdx + 8
                while ($i -lt $attRaw.Length -and [char]::IsWhiteSpace($attRaw[$i])) { $i++ }
                if ($i -ge $attRaw.Length -or $attRaw[$i] -ne ':') { continue }
                $i++
                while ($i -lt $attRaw.Length -and [char]::IsWhiteSpace($attRaw[$i])) { $i++ }
                if ($i -ge $attRaw.Length -or $attRaw[$i] -ne '{') { continue }
                $depth = 0
                $inString = $false
                $escaped = $false
                $start = $i
                for (; $i -lt $attRaw.Length; $i++) {
                    $ch = $attRaw[$i]
                    if ($escaped) { $escaped = $false; continue }
                    if ($inString) {
                        if ($ch -eq '\') { $escaped = $true }
                        elseif ($ch -eq '"') { $inString = $false }
                        continue
                    }
                    if ($ch -eq '"') { $inString = $true; continue }
                    if ($ch -eq '{') { $depth++; continue }
                    if ($ch -eq '}') {
                        $depth--
                        if ($depth -eq 0) {
                            $bundles += $attRaw.Substring($start, $i - $start + 1)
                            $searchFrom = $i + 1
                            break
                        }
                    }
                }
            }
            if ($bundles.Count -gt 0) {
                # WriteAllText writes UTF-8 without a BOM so gh's JSON
                # parser accepts the first line.
                $bundleFile = Join-Path ([System.IO.Path]::GetTempPath()) "plannotator-bundle-$([System.Guid]::NewGuid().ToString('N')).jsonl"
                [System.IO.File]::WriteAllText($bundleFile, (($bundles -join "`n") + "`n"))
            } else {
                $bundleFallbackReason = "Could not extract a bundle from the attestations API response"
            }
        } catch {
            $bundleFile = $null
            $bundleFallbackReason = "Could not fetch the attestation bundle from the public API"
        }
        # Constrain verification to the exact tag + signing workflow - see
        # install.sh comment for rationale.
        $usedBundle = $false
        if ($bundleFile) {
            $usedBundle = $true
            $verifyOutput = & gh attestation verify $tmpFile `
                --bundle $bundleFile `
                --repo $repo `
                --source-ref "refs/tags/$latestTag" `
                --signer-workflow "backnotprop/plannotator/.github/workflows/release.yml" 2>&1
            if ($LASTEXITCODE -ne 0) {
                # H1: a --bundle failure is not necessarily a provenance
                # failure (an older gh rejects the flag outright, a corrupt
                # bundle fails parsing, etc.). Retry once through the exact
                # authenticated path before classifying anything; only the
                # retry's verdict is reported. A real provenance failure
                # fails again here, so nothing bad ever slips through.
                Write-Host "Bundle-based verification did not complete; retrying via gh's authenticated fetch."
                $usedBundle = $false
                $verifyOutput = & gh attestation verify $tmpFile `
                    --repo $repo `
                    --source-ref "refs/tags/$latestTag" `
                    --signer-workflow "backnotprop/plannotator/.github/workflows/release.yml" 2>&1
            }
        } else {
            Write-Host "$bundleFallbackReason; falling back to gh's authenticated fetch."
            $verifyOutput = & gh attestation verify $tmpFile `
                --repo $repo `
                --source-ref "refs/tags/$latestTag" `
                --signer-workflow "backnotprop/plannotator/.github/workflows/release.yml" 2>&1
        }
        $verifyExitCode = $LASTEXITCODE
        if ($bundleFile) { Remove-Item $bundleFile -Force -ErrorAction SilentlyContinue }
        if ($verifyExitCode -eq 0) {
            if ($usedBundle) {
                Write-Host "Verified build provenance (SLSA, credential-free via the public attestations API)"
            } else {
                Write-Host "Verified build provenance (SLSA)"
            }
        } else {
            # Write to stderr directly - Write-Host goes to PowerShell's
            # Information stream, which is silently dropped when callers
            # redirect stderr for error reporting in CI/CD pipelines.
            #
            # `& gh ... 2>&1` captures multi-line output as an object[]
            # array. Passing the array directly to [Console]::Error.WriteLine
            # binds to the WriteLine(object) overload, which calls ToString()
            # on the array and yields the useless literal "System.Object[]".
            # Out-String normalizes the array back into a single formatted
            # string so the actual gh diagnostic is visible.
            $verifyText = ($verifyOutput | Out-String).TrimEnd()
            [Console]::Error.WriteLine($verifyText)
            Remove-Item $tmpFile -Force
            if ($verifyText -match "Sigstore verifiers") {
                # gh could not initialize the Sigstore trusted root. The TUF
                # root is fetched on EVERY run (not embedded, not cached), so
                # this is a connectivity failure, not a provenance failure.
                Write-Error "Could not initialize the Sigstore trust root (TUF). Provenance verification needs network access on every run; the trusted root is fetched per-run, never cached. This is a connectivity failure, NOT evidence of a bad binary. Refusing to install unverified; retry with network access or pass -SkipAttestation."
            } elseif ($verifyText -match "gh auth login") {
                # Only reachable on the authenticated path: the bundle path
                # was unavailable or did not complete AND gh has no login to
                # fetch the attestation itself. Environment problem, not a
                # provenance failure.
                Write-Error "The credential-free bundle path did not complete and gh is not logged in, so the authenticated fallback could not run. Retry with network access to api.github.com, run 'gh auth login', or pass -SkipAttestation."
            } else {
                Write-Error "Attestation verification failed! The binary's SHA256 matched, but no valid signed provenance was found for $repo. Refusing to install."
            }
        }
    } else {
        Remove-Item $tmpFile -Force
        Write-Error "verifyAttestation is enabled but gh CLI was not found. Install https://cli.github.com (no login is needed when the public attestation bundle fetch succeeds), or unset PLANNOTATOR_VERIFY_ATTESTATION / remove verifyAttestation from $configPath / pass -SkipAttestation."
    }
} else {
    Write-Host "SHA256 verified. For build provenance verification, see"
    Write-Host "https://docs.plannotator.ai/open-source/start/installation#pin-or-verify-a-release"
}

# Stage the new binary next to the target first (a copy when %TEMP% is on
# another volume), so the swap below is two renames on one volume, back to
# back: plannotator.exe is missing for no longer than that.
$stagedExe = "$installDir\plannotator.exe.new"
try {
    Remove-Item -Force -LiteralPath $stagedExe -ErrorAction SilentlyContinue
    Move-Item -Force -LiteralPath $tmpFile -Destination $stagedExe -ErrorAction Stop
    $tmpFile = $stagedExe
} catch {
    Remove-Item -Force -LiteralPath $tmpFile -ErrorAction SilentlyContinue
    Remove-Item -Force -LiteralPath $stagedExe -ErrorAction SilentlyContinue
    throw
}

# Windows cannot overwrite or delete a running .exe, but it can RENAME one.
# Move any current binary aside to plannotator.exe.old (a running plannotator
# keeps working from the renamed file), then move the new one into place. The
# .old file from an earlier run is removed first when nothing still holds it;
# one that is still locked is left under a unique name and swept next time.
# This is what lets a background auto-update (#1634) run while a session is open.
$targetExe = "$installDir\plannotator.exe"
# Only the two names this block creates are swept (-Filter alone would also
# match any other file that happens to start with the prefix).
Get-ChildItem -Path $installDir -Filter "plannotator.exe.old*" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^plannotator\.exe\.old(-[0-9a-f]{32})?$' } |
    ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
$asideExe = $null
if (Test-Path $targetExe) {
    $asideExe = "$targetExe.old"
    if (Test-Path $asideExe) { $asideExe = "$targetExe.old-$([System.Guid]::NewGuid().ToString('N'))" }
    try {
        Move-Item -Force $targetExe $asideExe -ErrorAction Stop
    } catch {
        $asideExe = $null
    }
}
try {
    Move-Item -Force $tmpFile "$installDir\plannotator.exe" -ErrorAction Stop
} catch {
    if ($asideExe -and -not (Test-Path $targetExe)) {
        Move-Item -Force $asideExe $targetExe -ErrorAction SilentlyContinue
    }
    Remove-Item -Force $tmpFile -ErrorAction SilentlyContinue
    throw
}
if ($asideExe) { Remove-Item -Force $asideExe -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "plannotator $latestTag installed to $installDir\plannotator.exe"

# Add $installDir to the user PATH if not already there. Extracted so both the
# -Minimal early exit and the normal flow reuse it (mirrors install.sh's
# print_path_advice).
function Show-PathAdvice {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$installDir*") {
        Write-Host ""
        Write-Host "$installDir is not in your PATH. Adding it..."
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
        Write-Host "Added to PATH. Restart your terminal for changes to take effect."
    }
    Write-Host ""
    Write-Host "To uninstall later: plannotator uninstall"
}

# Binary-only mode stops here (see the $minimal resolution near the top): the
# binary is installed, so add it to PATH and exit before any sidecar download,
# agent integration, skill checkout, config write, or cleanup runs. Only the
# binary, its PATH entry, and install-flags.json (Write-InstallFlags, so a
# later auto-update stays binary-only) are added - none of the sem sidecar, CallDiff, agent-terminal
# runtime, or per-agent skills, hooks, or config.
if ($minimal) {
    Write-InstallFlags
    Show-PathAdvice
    Write-Host ""
    Write-Host "Minimal install complete - only the plannotator binary was installed."
    Write-Host "No skills, hooks, agent integrations, or config files were written."
    exit 0
}

Install-SemSidecar
Install-AgentTerminalRuntime
Install-CallFlowRuntime

Show-PathAdvice

# Claude Code plugin: repair the marketplace clone, never rewrite it.
#
# <claude config>\plugins\marketplaces\plannotator is Claude Code's own git
# clone of this repository; installing or updating the plugin copies
# apps/hook from it into the plugin cache. Installers used to overwrite its
# apps/hook/hooks/hooks.json with a hard-coded copy (#230 stale timeout, #267
# Windows exe path). That copy drifted from the repo file (#689 dropped the
# EnterPlanMode hook; later it dropped "modules", the Claude Code mod), so
# nothing writes it now: the clone's own file is the source of truth.
#
# An earlier installer's rewrite can still be sitting in the clone as a local
# edit. Restore the file from the clone's HEAD, but only when it differs from
# HEAD AND its content (whitespace removed) is exactly one of the shapes those
# installers wrote, so a user's own edit is never discarded. Needs git. Same
# pattern as LEGACY_PLUGIN_HOOKS_RE in install.sh and install.cmd (keep the
# three in step); written with \x22 / \x5c and \A / \z so it carries no
# quote, pipe, percent or exclamation mark and cmd.exe can carry it verbatim.
$pluginMarketplaceDir = if ($env:CLAUDE_CONFIG_DIR) { "$env:CLAUDE_CONFIG_DIR\plugins\marketplaces\plannotator" } else { "$env:USERPROFILE\.claude\plugins\marketplaces\plannotator" }
$pluginHooks = "$pluginMarketplaceDir\apps\hook\hooks\hooks.json"
$legacyPluginHooksRe = '\A\{\x22hooks\x22:\{(\x22PreToolUse\x22:\[\{\x22matcher\x22:\x22EnterPlanMode\x22,\x22hooks\x22:\[\{\x22type\x22:\x22command\x22,\x22command\x22:\x22(\x5c\x22)?[^\x22\x5c]*plannotator(\.exe)?(\x5c\x22)?improve-context\x22,\x22timeout\x22:5\}\]\}\],)?\x22PermissionRequest\x22:\[\{\x22matcher\x22:\x22ExitPlanMode\x22,\x22hooks\x22:\[\{\x22type\x22:\x22command\x22,\x22command\x22:\x22(\x5c\x22)?[^\x22\x5c]*plannotator(\.exe)?(\x5c\x22)?\x22,\x22timeout\x22:345600\}\]\}\]\}\}\z'

function Repair-LegacyPluginHooks {
    param([string]$Clone)
    $rel = "apps/hook/hooks/hooks.json"
    $file = Join-Path $Clone "apps\hook\hooks\hooks.json"
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return }
    # $ErrorActionPreference=Stop would turn git's stderr into a terminating
    # error under Windows PowerShell 5.1; every step here is best effort.
    $local:ErrorActionPreference = 'Continue'
    # Only a git clone that tracks the file...
    & git -C $Clone cat-file -e "HEAD:$rel" 2>$null
    if ($LASTEXITCODE -ne 0) { return }
    # ...and only while it differs from HEAD (exit 1; 0 is clean, >1 an error).
    & git -C $Clone diff --quiet HEAD -- $rel 2>$null
    if ($LASTEXITCODE -ne 1) { return }
    $raw = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
    if ($null -eq $raw) { return }
    $compact = $raw -replace '[\s\uFEFF]', ''
    if ($compact -notmatch $legacyPluginHooksRe) { return }
    & git -C $Clone checkout -q -- $rel 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Restored $file from its git checkout (an earlier installer had rewritten it)."
    }
}
try { Repair-LegacyPluginHooks -Clone $pluginMarketplaceDir } catch { }

# Claude Code plugin: update it when it is already installed.
#
# The plugin comes from a GitHub marketplace, which Claude Code does not
# auto-update by default, so a binary update used to leave an old plugin
# behind. When the claude CLI is on PATH and plannotator@plannotator is in
# Claude Code's plugin registry (<claude config>\plugins\installed_plugins.json,
# at user scope), run the two commands this script used to only print. Runs
# after the repair above, so a repaired clone is what gets copied. It never
# installs the plugin, never touches another marketplace or plugin, never
# prompts (stdin is a pipe closed at once), and never fails the install: each command
# is time-bounded and a failure prints the manual commands. Opt out with
# -SkipClaudePlugin, PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE=1 or
# skipInstall.claudePlugin; -Minimal exits before this. Same steps as
# install.sh and install.cmd (keep the three in step).
$claudePluginId = "plannotator@plannotator"
$claudePluginRegistry = if ($env:CLAUDE_CONFIG_DIR) { "$env:CLAUDE_CONFIG_DIR\plugins\installed_plugins.json" } else { "$env:USERPROFILE\.claude\plugins\installed_plugins.json" }
# none | manual (installed, no claude CLI) | skipped | updated | current | failed
# | no-marketplace (the plannotator marketplace is gone; re-add it)
$claudePluginState = "none"
$claudePluginVersion = ""
# The installed plugin's version before this run (for Show-ClaudePluginReloadAlert).
$claudePluginFromVersion = ""

# The user-scope install record for plannotator@plannotator, or $null. A record
# without a scope (the v1 registry) counts as the user install; a project- or
# local-scope-only install is left alone (the update below targets
# --scope user).
function Get-ClaudePluginUserRecord {
    if (-not (Test-Path -LiteralPath $claudePluginRegistry -PathType Leaf)) { return $null }
    try {
        $registry = Get-Content -LiteralPath $claudePluginRegistry -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch { return $null }
    if ($null -eq $registry -or $null -eq $registry.plugins) { return $null }
    $entry = $registry.plugins.$claudePluginId
    if ($null -eq $entry) { return $null }
    return @($entry) | Where-Object { $null -ne $_ -and ((-not $_.scope) -or ($_.scope -eq "user")) } | Select-Object -First 1
}

function Get-ClaudePluginFingerprint {
    param($Record)
    if ($null -eq $Record) { return "||" }
    return "$($Record.version)|$($Record.gitCommitSha)|$($Record.installPath)"
}

# Run claude with arguments and a time limit. Returns "" on success, else why
# it failed. The process is started directly (not Start-Process, whose
# -RedirectStandardInput copies a file into the pipe after the start and throws
# "Broken pipe" when claude exits first): stdin is a pipe closed right away in
# its own try/catch, so a claude that exits before that is not an error, and
# only a failing start is reported as "could not run claude".
function Invoke-ClaudeWithTimeLimit {
    param([string]$ClaudePath, [string[]]$Arguments, [int]$Seconds)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $ClaudePath
    $info.Arguments = ($Arguments -join " ")
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.CreateNoWindow = $true
    try {
        $p = [System.Diagnostics.Process]::Start($info)
    } catch {
        return "could not run claude: $($_.Exception.Message)"
    }
    try { $p.StandardInput.Close() } catch { }
    # Read both pipes asynchronously so a chatty claude can never fill one and
    # block while we wait.
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($Seconds * 1000)) {
        try { $p.Kill($true) } catch { try { $null = & taskkill /T /F /PID $p.Id 2>$null } catch { }; try { $p.Kill() } catch { } }
        return "timed out after ${Seconds}s"
    }
    $p.WaitForExit()
    if ($p.ExitCode -eq 0) { return "" }
    # A process claude left behind may keep a pipe open; never wait long.
    $texts = @()
    foreach ($task in @($errTask, $outTask)) {
        $text = ""
        try { if ($task.Wait(5000)) { $text = [string]$task.Result } } catch { }
        $texts += $text
    }
    # The last non-empty line claude printed, stderr first.
    $last = $null
    foreach ($text in $texts) {
        $last = @($text -split "\r?\n") |
            ForEach-Object { ($_ -replace '[^\x20-\x7E]', '').Trim() } |
            Where-Object { $_ } | Select-Object -Last 1
        if ($last) { break }
    }
    # The plannotator marketplace itself is gone (removed by hand): updating
    # cannot work, re-adding it does.
    foreach ($line in @($texts | ForEach-Object { $_ -split "\r?\n" })) {
        if ($line -match 'marketplace' -and $line -match 'not found|not exist|no such|unknown') { $script:claudeMarketplaceMissing = $true }
    }
    if ($last -and $last.Length -gt 200) { $last = $last.Substring(0, 200) }
    if ($last) { return "claude exited $($p.ExitCode): $last" }
    return "claude exited $($p.ExitCode)"
}

# --scope user always: `claude plugin update` auto-detects the scope on current
# Claude Code, and from inside a project with a project-scope install it would
# update that record and leave the user install old.
function Write-ClaudePluginManualUpdate {
    Write-Host "  claude plugin marketplace update plannotator"
    Write-Host "  claude plugin update $claudePluginId --scope user"
}

function Write-ClaudePluginMarketplaceReadd {
    Write-Host "  claude plugin marketplace add backnotprop/plannotator"
    Write-Host "  claude plugin update $claudePluginId --scope user"
}

function Update-ClaudePluginIfInstalled {
    $local:ErrorActionPreference = 'Continue'
    $record = Get-ClaudePluginUserRecord
    if ($null -eq $record) { return }
    $script:claudePluginFromVersion = if ($record.version) { "$($record.version)" } else { "" }
    $claude = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    # Not on PATH: Claude Code's own install folders (its native installer's
    # .local\bin, the older .claude\local), as the Inbox's launcher looks. An
    # update started by the Inbox or a review window runs with that process's
    # PATH, which can lack them.
    foreach ($dir in @(@('.local', 'bin'), @('.claude', 'local'))) {
        if (-not $claude -and $env:USERPROFILE) {
            $candidate = [System.IO.Path]::Combine($env:USERPROFILE, $dir[0], $dir[1], 'claude')
            $claude = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        }
    }
    if (-not $claude) {
        $script:claudePluginState = "manual"
        return
    }
    if ($skipClaudePluginResolved) {
        $script:claudePluginState = "skipped"
        Write-Host "Claude Code plugin: not updated ($skipClaudePluginSource)."
        return
    }
    # A pinned install (-Version naming a tag) keeps the plugin it has: the
    # plugin update always installs the newest plugin, which would not match
    # an older binary. Background auto-update passes the newest release it
    # just resolved as -Version and exports the same tag as
    # PLANNOTATOR_UPDATE_VERSION, so that run is not pinned. No network call.
    if (($Version -ne "latest") -and ($env:PLANNOTATOR_UPDATE_VERSION -ne $latestTag)) {
        $script:claudePluginState = "skipped"
        Write-Host "Claude Code plugin: not updated: pinned to $latestTag; updating would install the newest plugin."
        return
    }
    # Seconds per command. Internal knob for the tests. Claude Code stops its
    # own git clone or fetch of the marketplace after 120 s unless
    # CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS says otherwise, which failed updates on
    # slow links: the commands get 10 minutes for git (a value the person set
    # is kept), and 11 for the whole command.
    $seconds = 660
    if ($env:PLANNOTATOR_CLAUDE_PLUGIN_TIMEOUT -match '^[1-9][0-9]*$') { $seconds = [int]$env:PLANNOTATOR_CLAUDE_PLUGIN_TIMEOUT }
    if (-not $env:CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS) { $env:CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS = "600000" }
    $before = Get-ClaudePluginFingerprint $record
    # CLAUDECODE is cleared for these commands: an auto-update started from a
    # Claude Code session inherits it, and it marks a nested Claude Code.
    Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue
    Write-Host "Updating the Claude Code plugin..."
    $script:claudeMarketplaceMissing = $false
    $failed = Invoke-ClaudeWithTimeLimit -ClaudePath $claude.Source -Arguments @("plugin", "marketplace", "update", "plannotator") -Seconds $seconds
    if (-not $failed) {
        $failed = Invoke-ClaudeWithTimeLimit -ClaudePath $claude.Source -Arguments @("plugin", "update", $claudePluginId, "--scope", "user") -Seconds $seconds
    }
    if ($failed -and $script:claudeMarketplaceMissing) {
        $script:claudePluginState = "no-marketplace"
        Write-Host "Claude Code plugin: could not update it (the plannotator marketplace is not registered). Re-add it, then restart Claude Code:"
        Write-ClaudePluginMarketplaceReadd
        return
    }
    if ($failed) {
        $script:claudePluginState = "failed"
        Write-Host "Claude Code plugin: could not update it ($failed). Run these, then restart Claude Code:"
        Write-ClaudePluginManualUpdate
        return
    }
    $record = Get-ClaudePluginUserRecord
    $after = Get-ClaudePluginFingerprint $record
    $script:claudePluginVersion = if ($record -and $record.version) { "$($record.version)" } else { "" }
    if ($after -eq "||" -or $before -ne $after) {
        $script:claudePluginState = "updated"
        $to = if ($script:claudePluginVersion) { " to $($script:claudePluginVersion)" } else { "" }
        Write-Host "Claude Code plugin: updated$to (restart Claude Code to load it)."
    } else {
        $script:claudePluginState = "current"
        $at = if ($script:claudePluginVersion) { " ($($script:claudePluginVersion))" } else { "" }
        Write-Host "Claude Code plugin: already up to date$at."
    }
}
try { Update-ClaudePluginIfInstalled } catch { }

# Clear OpenCode plugin cache. Both OpenCode generations root their cache at
# $env:XDG_CACHE_HOME\opencode, else $env:USERPROFILE\.cache\opencode (on
# Windows too: OpenCode uses XDG paths off os.homedir(), not %LOCALAPPDATA%).
#   OpenCode 1: node_modules\@plannotator and packages\@plannotator
#   OpenCode 2: npm\<name>@<spec>\<generation>\ (packages/util/src/npm.ts), so
#               our plugin is npm\@plannotator\opencode@<spec>.
# Only our own package's entries are removed. An OpenCode opt-out (#1178)
# leaves OpenCode's own cache directory alone; the Bun package cache is a
# shared cache, not OpenCode's home, and is always cleared.
if (-not $skipOpencodeResolved) {
    $opencodeCacheDir = if ($env:XDG_CACHE_HOME) { "$env:XDG_CACHE_HOME\opencode" } else { "$env:USERPROFILE\.cache\opencode" }
    Remove-Item -Recurse -Force -LiteralPath "$opencodeCacheDir\node_modules\@plannotator" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -LiteralPath "$opencodeCacheDir\packages\@plannotator" -ErrorAction SilentlyContinue
    $opencodeNpmScope = "$opencodeCacheDir\npm\@plannotator"
    Get-ChildItem -LiteralPath $opencodeNpmScope -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'opencode@*' } |
        ForEach-Object { Remove-Item -Recurse -Force -LiteralPath $_.FullName -ErrorAction SilentlyContinue }
    # The scope directory goes only when nothing else is left in it.
    if ((Test-Path -LiteralPath $opencodeNpmScope) -and -not (Get-ChildItem -LiteralPath $opencodeNpmScope -Force -ErrorAction SilentlyContinue)) {
        Remove-Item -Force -LiteralPath $opencodeNpmScope -ErrorAction SilentlyContinue
    }
}
Remove-Item -Recurse -Force "$env:USERPROFILE\.bun\install\cache\@plannotator" -ErrorAction SilentlyContinue

# Clear Pi jiti cache to force fresh download on next run
Remove-Item -Recurse -Force "$env:TEMP\jiti" -ErrorAction SilentlyContinue

# Pi extension (#902). `pi install npm:@plannotator/pi-extension` runs a bare
# `npm install @plannotator/pi-extension` in <agent dir>\npm. npm may settle on
# an older version and still exit 0 ("up to date"): it passes over a release
# whose `engines` the running Node does not meet (0.28.32's Node floor), and a
# registry mirror can lag. `pi update <source>` is Pi's own update: it asks the
# registry for the newest version and installs `<name>@latest` by name (older
# Pi reinstalls with `npm install -g`), and it leaves Pi's settings as they are.
# So an existing install is updated with `pi update`, a first install that
# landed on an older version gets the same `pi update`, the version on disk is
# read back where Pi loads it from, and "installed"/"updated" is said only when
# it reached this release; otherwise one line names the cause it can see and
# the command to run. The step never pins a version in Pi's settings (a pinned
# source is skipped by every later `pi update`). A source the person pinned
# (npm:@plannotator/pi-extension@0.28.20) is left alone and the line says how
# to move it. Nothing is removed first, so a failed step leaves the install as
# it was. `pi update` shipped together with `pi install`, and it runs here only
# when Pi's settings list the extension. Same logic in install.sh and
# install.cmd's :UpdatePiExtension.
$piExtensionSource = "npm:@plannotator/pi-extension"

# Pi's agent dir: $env:PI_CODING_AGENT_DIR (~ expanded, as Pi does), else ~\.pi\agent.
function Get-PiAgentDir {
    $dir = $env:PI_CODING_AGENT_DIR
    if (-not $dir) { return (Join-Path (Join-Path $env:USERPROFILE ".pi") "agent") }
    if ($dir -eq "~") { return $env:USERPROFILE }
    if ($dir.StartsWith("~/") -or $dir.StartsWith("~\")) { return (Join-Path $env:USERPROFILE $dir.Substring(2)) }
    return $dir
}

# How Pi's user settings list the extension: "none", "unpinned", or
# "pinned:<version>" for an exact version (what `pi update` skips).
function Get-PiExtensionState {
    $settings = Join-Path (Get-PiAgentDir) "settings.json"
    if (-not (Test-Path -LiteralPath $settings -PathType Leaf)) { return "none" }
    $text = ""
    try { $text = [string](Get-Content -LiteralPath $settings -Raw -ErrorAction Stop) } catch { return "none" }
    if ($text -notmatch '"npm:@plannotator/pi-extension(@[^"]*)?"') { return "none" }
    if ($text -match '"npm:@plannotator/pi-extension@v?([0-9]+\.[0-9]+\.[0-9][0-9A-Za-z.+-]*)"') { return "pinned:" + $Matches[1] }
    return "unpinned"
}

# The installed extension's version, read where Pi loads it from: the managed
# <agent dir>\npm\node_modules copy when it exists, else the global npm root
# (where older Pi installed user packages). Empty when it can't be read.
function Get-PiExtensionVersion {
    $local:ErrorActionPreference = 'Continue'
    $pkg = Join-Path (Join-Path (Join-Path (Join-Path (Get-PiAgentDir) "npm") "node_modules") "@plannotator") "pi-extension"
    if (-not (Test-Path -LiteralPath $pkg -PathType Container)) {
        $pkg = $null
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            $root = $null
            try { $root = & npm root -g 2>$null | Select-Object -First 1 } catch { }
            if ($root) { $pkg = Join-Path (Join-Path ([string]$root).Trim() "@plannotator") "pi-extension" }
        }
    }
    if (-not $pkg) { return "" }
    $json = Join-Path $pkg "package.json"
    if (-not (Test-Path -LiteralPath $json -PathType Leaf)) { return "" }
    try { return [string](Get-Content -LiteralPath $json -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop).version } catch { return "" }
}

# Whether version $a is at least $b (major.minor.patch; any suffix ignored).
function Test-PiVersionAtLeast($a, $b) {
    $x = @(([string]$a -replace '^v', '' -replace '[-+].*$', '').Split('.'))
    $y = @(([string]$b -replace '^v', '' -replace '[-+].*$', '').Split('.'))
    for ($i = 0; $i -lt 3; $i++) {
        $p = 0; $q = 0
        if ($i -lt $x.Count) { [void][int]::TryParse($x[$i], [ref]$p) }
        if ($i -lt $y.Count) { [void][int]::TryParse($y[$i], [ref]$q) }
        if ($p -gt $q) { return $true }
        if ($p -lt $q) { return $false }
    }
    return $true
}

function Update-PiExtensionIfPresent {
    if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
        return
    }
    $local:ErrorActionPreference = 'Continue'

    $target = ([string]$latestTag) -replace '^v', ''
    $state = Get-PiExtensionState
    $fresh = $false
    if ($state.StartsWith("pinned:")) {
        Write-Host ("Pi extension: pinned to " + $state.Substring(7) + " in Pi's settings, left as is. To move it: pi install " + $piExtensionSource + "@" + $target)
        return
    }
    if ($state -eq "none") {
        $fresh = $true
        Write-Host "Installing Pi extension..."
        pi install $piExtensionSource
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Skipping Pi extension install (pi install failed)"
            return
        }
        $before = Get-PiExtensionVersion
        if (-not $before -or -not (Test-PiVersionAtLeast $before $target)) {
            # npm settled on an older version (or it can't be read): Pi's own
            # update asks for the newest one by name.
            pi update $piExtensionSource
        }
    } else {
        Write-Host "Updating Pi extension..."
        $before = Get-PiExtensionVersion
        pi update $piExtensionSource
        if ($LASTEXITCODE -ne 0) {
            # The update failed, or this Pi's update takes no source: the
            # install command, as before. Neither removes anything first.
            pi install $piExtensionSource
        }
    }

    $after = Get-PiExtensionVersion
    if (-not $after) {
        Write-Host ("Pi extension: could not read its installed version. To update it: pi update " + $piExtensionSource)
    } elseif (-not (Test-PiVersionAtLeast $after $target)) {
        # The one cause visible from here: the registry npm uses does not have
        # this release yet (a mirror catching up, or npm not published).
        $view = ""
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            try { $view = (& npm view "@plannotator/pi-extension@$target" version --fetch-timeout=10000 --fetch-retries=0 2>&1 | Out-String) } catch { $view = "" }
        }
        if ($view -match 'E404') {
            Write-Host ("Pi extension: still " + $after + " (" + $target + " is not on your npm registry yet). Run this later: pi update " + $piExtensionSource)
        } else {
            Write-Host ("Pi extension: still " + $after + " (this release is " + $target + "). To update it: pi update " + $piExtensionSource)
        }
    } elseif ($fresh) {
        Write-Host "Pi extension installed ($after)."
    } elseif ($before -eq $after) {
        Write-Host "Pi extension already up to date ($after)."
    } else {
        Write-Host "Pi extension updated to $after."
    }
}

# Aggressive cleanup of stale install locations from prior versions.
# Echo each removal and ignore anything that is already gone.

# NOTE: legacy Claude command cleanup happens AFTER the skill install below -
# a command file is only removed once its replacement skill is on disk, so a
# failed or skipped skill install never leaves users with neither.
$claudeCommandsDir = if ($env:CLAUDE_CONFIG_DIR) { "$env:CLAUDE_CONFIG_DIR\commands" } else { "$env:USERPROFILE\.claude\commands" }

# Old installers (pre core/extra split) ran a wholesale skills copy against a
# new-layout tag and could leave junk `core`/`extra` directory copies in the
# Claude skills scope. Never valid skill names - always safe to remove.
$claudeSkillsScope = if ($env:CLAUDE_CONFIG_DIR) { "$env:CLAUDE_CONFIG_DIR\skills" } else { "$env:USERPROFILE\.claude\skills" }
foreach ($junk in @("core", "extra")) {
    $junkPath = Join-Path $claudeSkillsScope $junk
    if (Test-Path $junkPath) {
        Write-Host "Removing stale layout directory $junkPath (left by an older installer)"
        Remove-Item -Recurse -Force $junkPath -ErrorAction SilentlyContinue
    }
}

# Extras (compound / setup-goal / visual-explainer) are no longer managed in
# the Claude or shared-agent skill scopes. Remove previously default-installed
# copies ONCE per machine - recorded in the migrations ledger under the
# Plannotator data dir - because copies the user reinstalls via `npx skills
# add` are byte-identical to ours and can only be told apart by remembering
# that this cleanup already ran.
$claudeSkillsDir = if ($env:CLAUDE_CONFIG_DIR) { "$env:CLAUDE_CONFIG_DIR\skills" } else { "$env:USERPROFILE\.claude\skills" }
$agentsSkillsDir = "$env:USERPROFILE\.agents\skills"
$migrationsDir = Join-Path $configDir "migrations"
$extrasMigration = Join-Path $migrationsDir "2026-06-extras-default-install-removed"
if (-not (Test-Path $extrasMigration)) {
    foreach ($skill in @("plannotator-compound", "plannotator-setup-goal", "plannotator-visual-explainer")) {
        foreach ($scopeDir in @($claudeSkillsDir, $agentsSkillsDir)) {
            $extraSkillPath = Join-Path $scopeDir $skill
            if (Test-Path $extraSkillPath) {
                Write-Host "Removing unmanaged extra skill $extraSkillPath (reinstall via npx skills add)"
                Remove-Item -Recurse -Force $extraSkillPath -ErrorAction SilentlyContinue
            }
        }
    }
    New-Item -ItemType Directory -Force -Path $migrationsDir | Out-Null
    New-Item -ItemType File -Force -Path $extrasMigration | Out-Null
}

# --- Guided install (interactive consoles only) ---
# Mirrors install.sh: two questions (extras? model-invocable skills?), answers
# persisted to install-prefs in the Plannotator data dir and reused silently on
# re-runs. -Reconfigure re-opens the wizard; -NonInteractive forces silence;
# redirected/CI runs never prompt. Flags win over everything.
$prefsFile = Join-Path $configDir "install-prefs"
$coreSkillNames = @("plannotator-review", "plannotator-annotate", "plannotator-last")
$extraSkillNames = @("plannotator-compound", "plannotator-setup-goal", "plannotator-visual-explainer")

$savedExtras = ""
$savedInvocable = ""
if (Test-Path $prefsFile) {
    foreach ($line in Get-Content $prefsFile) {
        if ($line -match '^extras=(.*)$') { $savedExtras = $Matches[1] }
        if ($line -match '^model_invocable=(.*)$') { $savedInvocable = $Matches[1] }
    }
}

# Extras already on disk (pre-existing or previously npx-installed)? Then the
# extras question is moot - they still count toward the checkbox list, and we
# never launch the npx flow over them.
$extrasPresent = $false
foreach ($skill in $extraSkillNames) {
    if ((Test-Path (Join-Path $claudeSkillsDir $skill)) -or (Test-Path (Join-Path $agentsSkillsDir $skill))) {
        $extrasPresent = $true
        break
    }
}

# A wizard needs a real console. `irm | iex` keeps the console attached;
# CI and redirected runs do not.
$canPrompt = $false
if (-not $NonInteractive) {
    try {
        $canPrompt = (-not [Console]::IsInputRedirected) -and (-not [Console]::IsOutputRedirected)
    } catch {
        $canPrompt = $false
    }
}

$runWizard = $canPrompt -and ($Reconfigure -or -not (Test-Path $prefsFile))

# Bound interactive prompts so an unattended-but-attached console (e.g. a
# PsExec / provisioner first-run) can't hang the install. Override with
# PLANNOTATOR_PROMPT_TIMEOUT (0 = wait forever); non-numeric/negative -> 30.
$script:promptTimeout = 30
if ($env:PLANNOTATOR_PROMPT_TIMEOUT) {
    $parsed = 0
    if ([int]::TryParse($env:PLANNOTATOR_PROMPT_TIMEOUT, [ref]$parsed) -and $parsed -ge 0) {
        $script:promptTimeout = $parsed
    }
}

# Read a line with a timeout (seconds); $null if no input arrives in time.
# 0 waits indefinitely. Echoes typed chars since ReadKey($true) intercepts them.
function Read-LineWithTimeout {
    param([int]$TimeoutSeconds)
    if ($TimeoutSeconds -le 0) { return [Console]::ReadLine() }
    $line = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq "Enter") { Write-Host ""; return $line }
            elseif ($key.Key -eq "Backspace") {
                if ($line.Length -gt 0) { $line = $line.Substring(0, $line.Length - 1); Write-Host "`b `b" -NoNewline }
            }
            else { $line += $key.KeyChar; Write-Host $key.KeyChar -NoNewline }
        }
        else { Start-Sleep -Milliseconds 50 }
    }
    return $null
}

function Read-YesNo {
    param([string]$Prompt, [string]$Default)
    $suffix = if ($Default -eq "yes") { "[Y/n]" } else { "[y/N]" }
    Write-Host "$Prompt $suffix " -NoNewline
    # On timeout nobody is there -> return the SAFE "no", never $Default, so a
    # yes-default prompt can't auto-run unattended.
    $answer = Read-LineWithTimeout $script:promptTimeout
    if ($null -eq $answer) {
        Write-Host ""
        return "no"
    }
    switch -regex ($answer) {
        '^(y|yes)$' { return "yes" }
        '^(n|no)$'  { return "no" }
        default     { return $Default }
    }
}

# Space-toggle checkbox. Up/down (or j/k) moves, space toggles, enter
# confirms. Returns the chosen names as a comma list, or "none".
function Select-SkillsCheckbox {
    param([string[]]$Names, [string]$Preselected)
    $pre = ",$Preselected,"
    $sel = @()
    foreach ($n in $Names) { $sel += ($pre -like "*,$n,*") }
    $idx = 0
    Write-Host "Space toggles, enter confirms, up/down or j/k moves:"
    $top = [Console]::CursorTop
    while ($true) {
        [Console]::SetCursorPosition(0, $top)
        for ($i = 0; $i -lt $Names.Count; $i++) {
            $mark = if ($sel[$i]) { "x" } else { " " }
            $cursor = if ($i -eq $idx) { "> " } else { "  " }
            Write-Host ("{0}[{1}] {2}    " -f $cursor, $mark, $Names[$i])
        }
        $key = [Console]::ReadKey($true)
        switch ($key.Key) {
            "Spacebar"  { $sel[$idx] = -not $sel[$idx] }
            "UpArrow"   { if ($idx -gt 0) { $idx-- } }
            "DownArrow" { if ($idx -lt $Names.Count - 1) { $idx++ } }
            "K"         { if ($idx -gt 0) { $idx-- } }
            "J"         { if ($idx -lt $Names.Count - 1) { $idx++ } }
            "Enter"     {
                $chosen = @()
                for ($i = 0; $i -lt $Names.Count; $i++) {
                    if ($sel[$i]) { $chosen += $Names[$i] }
                }
                if ($chosen.Count -eq 0) { return "none" }
                return ($chosen -join ",")
            }
        }
    }
}

$extrasChoice = ""
$invocableChoice = ""

if ($runWizard) {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "  PLANNOTATOR GUIDED INSTALL"
    Write-Host "=========================================="
    Write-Host ""
    if ($extrasPresent) {
        Write-Host "Extra skills already installed - keeping them."
        $extrasChoice = "yes"
    } elseif ($Extras -or $NoExtras) {
        # Flag already answered this question - don't ask and then ignore.
        $extrasChoice = if ($Extras) { "yes" } else { "no" }
    } else {
        $defaultExtras = if ($savedExtras) { $savedExtras } else { "no" }
        $extrasChoice = Read-YesNo "Install the extra skills (compound planning, setup-goal, visual explainer)?" $defaultExtras
    }
    $invocableList = $coreSkillNames
    if ($extrasChoice -eq "yes") { $invocableList = $coreSkillNames + $extraSkillNames }
    if ($ModelInvocable) {
        # Flag already answered this question - don't ask and then ignore.
        $invocableChoice = $ModelInvocable
    } else {
        $wantInvocable = Read-YesNo "Make any skills callable by the model (instead of user-invoked only)?" "no"
        if ($wantInvocable -eq "yes") {
            $invocableChoice = Select-SkillsCheckbox -Names $invocableList -Preselected $savedInvocable
        } else {
            $invocableChoice = "none"
        }
    }
}

# Flags override the wizard and saved answers; otherwise saved, then defaults.
if ($Extras) { $extrasChoice = "yes" }
if ($NoExtras) { $extrasChoice = "no" }
if ($ModelInvocable) { $invocableChoice = $ModelInvocable }
if (-not $extrasChoice) { $extrasChoice = if ($savedExtras) { $savedExtras } else { "no" } }
if (-not $invocableChoice) { $invocableChoice = if ($savedInvocable) { $savedInvocable } else { "none" } }

# Persist only when the wizard ran or a flag set something - silent re-runs
# must not clobber saved answers with defaults.
if ($runWizard -or $Extras -or $NoExtras -or $ModelInvocable) {
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    @("extras=$extrasChoice", "model_invocable=$invocableChoice") | Set-Content $prefsFile
}

# Extras install is delegated to the skills CLI (its UI picks the agents).
# Interactive only - silent runs and CI get the printed command instead.
# Never runs when the extras already exist. The extras ARE skills, so
# -SkipSkills suppresses them too - a saved extras=yes preference must not
# smuggle a skill install past the opt-out.
if ((-not $skipSkillsResolved) -and ($extrasChoice -eq "yes") -and (-not $extrasPresent)) {
    if ($canPrompt -and (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-Host "Launching the skills CLI for the extras (pick your agents in its UI)..."
        npx skills add backnotprop/plannotator/apps/skills/extra --global
        if ($LASTEXITCODE -ne 0) {
            Write-Host "skills CLI did not complete - install later with: npx skills add backnotprop/plannotator/apps/skills/extra --global"
        }
    } else {
        Write-Host "Install the extras with: npx skills add backnotprop/plannotator/apps/skills/extra --global"
    }
}

# Install skills and command stubs (requires git).
#
# Core skills and OpenCode command stubs are all copied verbatim from a sparse
# checkout of the release tag.
# copy-if-present means older pinned tags that lack a given path simply skip it
# rather than failing. Hard requirement: without git we cannot install the
# /plannotator-* skills, so fail loudly instead of leaving a partial install.
# Hook/config writing above has already run; the Pi update below is skipped on
# failure and completes when the user re-runs.
#
# Skills/commands opt-out (-SkipSkills / PLANNOTATOR_SKIP_SKILLS_INSTALL /
# skipInstall.skills). HONEST reporting like the per-agent family: the skipped
# state is announced, and skip means do-not-write - nothing already on disk in
# any skill or command scope is fetched, replaced, or removed on this run.
# Nothing is fetched, so git also stops being a requirement here.
if ($skipSkillsResolved) {
    Write-Host ""
    Write-Host "Skills: skipped ($skipSkillsSource)."
    Write-Host "No skills or slash commands were fetched, and none already installed"
    Write-Host "were changed or removed. The /plannotator-* commands are NOT installed"
    Write-Host "by this run - re-run without the opt-out to install them."
} elseif (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Error: git is required to install Plannotator's skills and slash commands."
    Write-Host "Install git, then run this installer again."
    Write-Host "To install without them, re-run with -SkipSkills."
    exit 1
}

$checkoutFailed = $false
$skillsTmp = Join-Path ([System.IO.Path]::GetTempPath()) "plannotator-skills-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $skillsTmp | Out-Null

function Copy-SkillIfPresent {
    param(
        [string]$SourceDir,
        [string]$TargetDir
    )

    if (Test-Path $SourceDir) {
        # Remove any existing copy first so re-runs replace rather than
        # nest. PowerShell's `Copy-Item -Recurse` into an existing target
        # dir copies the source INSIDE it (dest\skill\skill); mirror
        # install.sh's `rm -rf` guard so upgrades stay clean.
        $dest = Join-Path $TargetDir (Split-Path $SourceDir -Leaf)
        $existing = Get-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
        if ($existing -and ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            # A link (made by the `skills` CLI). Remove the link itself:
            # Windows PowerShell 5.1's Remove-Item -Recurse follows a
            # directory link and deletes what it points to.
            try { [System.IO.Directory]::Delete($existing.FullName, $false) } catch { [System.IO.File]::Delete($existing.FullName) }
        } elseif ($existing) {
            Remove-Item -Recurse -Force -LiteralPath $dest
        }
        Copy-Item -Recurse -Force $SourceDir $TargetDir
    }
}

# Captured tail of git's stderr from the most recent failed clone attempt,
# surfaced with the "network or git error" message below so the real failure
# self-diagnoses instead of being swallowed (#1238). Read before $skillsTmp
# is removed.
$gitStderrTail = @()
$sparseClone = $true

try {
    # Scoped Continue preference: on PowerShell < 7.2 (and profiles that
    # restore the old behavior), redirecting a native command's stderr under
    # $ErrorActionPreference=Stop turns its FIRST stderr line into a
    # terminating error, and git prints its normal "Cloning into ..."
    # progress on stderr, so the clone "failed" on the message announcing it
    # started (#1162). Real failures stay detectable: the clone is verified
    # by Test-Path below, never by a throw. Stderr goes to a file instead of
    # $null (#1238) so failures can be diagnosed.
    $gitErrFile = Join-Path $skillsTmp "git-stderr.txt"
    if (-not $skipSkillsResolved) {
        # LC_ALL=C pins git's error strings to English for the capability
        # probe below: a localized git would emit a translated "unknown
        # option" message the match misses, sending old-git non-English
        # users to a hard failure instead of the fallback. Saved/restored
        # around the call because $env: changes are process-wide. Kept on
        # one line for the install.test.ts scoped-git-call scanner.
        & { $local:ErrorActionPreference = 'Continue'; $prevLcAll = $env:LC_ALL; $env:LC_ALL = 'C'; git clone --depth 1 --filter=blob:none --sparse "https://github.com/$repo.git" --branch $latestTag "$skillsTmp\repo" 2>$gitErrFile; if ($null -eq $prevLcAll) { Remove-Item Env:LC_ALL -ErrorAction SilentlyContinue } else { $env:LC_ALL = $prevLcAll } }
        if (-not (Test-Path "$skillsTmp\repo")) {
            $cloneErr = ""
            if (Test-Path $gitErrFile) { $cloneErr = [System.IO.File]::ReadAllText($gitErrFile) }
            # Capability probe, not a version parse (same philosophy as the
            # GitButler flag probing in packages/shared/gitbutler-core.ts):
            # `git clone --sparse` needs git >= 2.25, and an older git rejects
            # the flag instantly with "error: unknown option `sparse'" before
            # any network call (#1238). Fall back to a plain shallow clone -
            # it costs download size, not correctness: every path the copy
            # steps below read is present in the full checkout, and
            # `git sparse-checkout set` (equally missing on that git) is
            # skipped because there is nothing to narrow.
            if ($cloneErr -match '(?i)unknown option' -and $cloneErr -match '(?i)sparse') {
                Write-Host "This git does not support 'git clone --sparse' (needs git >= 2.25) - falling back to a plain shallow clone."
                $sparseClone = $false
                & { $local:ErrorActionPreference = 'Continue'; git clone --depth 1 "https://github.com/$repo.git" --branch $latestTag "$skillsTmp\repo" 2>$gitErrFile }
            }
        }
        if ((-not (Test-Path "$skillsTmp\repo")) -and (Test-Path $gitErrFile)) {
            $gitStderrTail = @(Get-Content $gitErrFile -ErrorAction SilentlyContinue | Select-Object -Last 5)
        }
    }
    # git is a native executable - it does not throw under
    # $ErrorActionPreference=Stop on non-zero exit. Guard with
    # Test-Path so we only Push-Location if the clone actually
    # produced a repo directory.
    if ($skipSkillsResolved) {
        # Opt-out: no clone was attempted, so there is nothing to copy and
        # $checkoutFailed stays $false - an opt-out is not a fetch failure
        # and must not trip the guard below. Reported above the git check.
    } elseif (Test-Path "$skillsTmp\repo") {
        Push-Location "$skillsTmp\repo"
        # Inner try/finally guarantees Pop-Location runs exactly once
        # after a successful Push-Location, regardless of whether the
        # copy operations below throw. The naive pattern (Pop-Location
        # only on the success path) leaks the location stack if a
        # PS-native cmdlet (Copy-Item etc.) throws under Stop.
        try {
            # Same scoped Continue as the clone above: sparse-checkout may
            # write advice to stderr, which must not become a terminating
            # error on PowerShell < 7.2 (#1162). Skipped entirely on the
            # plain-clone fallback (#1238): that git has no sparse-checkout
            # subcommand, and the full checkout needs no narrowing.
            if ($sparseClone) {
                & { $local:ErrorActionPreference = 'Continue'; git sparse-checkout set apps/skills apps/opencode-plugin/commands 2>$null }
            }

            # Claude Code reads apps/skills/claude/* (dynamic-context injection
            # `!`plannotator ... $ARGUMENTS`` + allowed-tools, so /plannotator-*
            # run with no permission prompt - like the old slash commands).
            # Shared agents read apps/skills/core/* (prose the model follows
            # via its own shell). The `!`...`` injection is a
            # Claude-Code-only extension, so the two are sourced separately
            # rather than sharing one body.
            # Route each through Copy-SkillIfPresent (which pre-removes the
            # existing target dir) so re-runs replace rather than nest.
            if ((Test-Path "apps\skills\claude") -and (Get-ChildItem "apps\skills\claude" -ErrorAction SilentlyContinue)) {
                New-Item -ItemType Directory -Force -Path $claudeSkillsDir | Out-Null
                foreach ($skill in @("plannotator-review", "plannotator-annotate", "plannotator-last", "plannotator-inbox")) {
                    Copy-SkillIfPresent "apps\skills\claude\$skill" $claudeSkillsDir
                }
                # The plannotator knowledge skill (CLI reference) has no
                # Claude-only injection form, so Claude installs the same
                # single-sourced copy every shared agent gets from
                # apps\skills\core.
                Copy-SkillIfPresent "apps\skills\core\plannotator" $claudeSkillsDir
                Write-Host "Installed Claude Code skills to $claudeSkillsDir\"
            } else {
                Write-Host "Tag $latestTag predates the per-agent skill layout - skipping Claude Code skill install"
            }
            if ((Test-Path "apps\skills\core") -and (Get-ChildItem "apps\skills\core" -ErrorAction SilentlyContinue)) {
                New-Item -ItemType Directory -Force -Path $agentsSkillsDir | Out-Null
                foreach ($skill in @("plannotator-review", "plannotator-annotate", "plannotator-last", "plannotator-inbox")) {
                    Copy-SkillIfPresent "apps\skills\core\$skill" $agentsSkillsDir
                }
                Copy-SkillIfPresent "apps\skills\core\plannotator" $agentsSkillsDir
                Write-Host "Installed shared agent skills to $agentsSkillsDir\"
            } else {
                Write-Host "Tag $latestTag predates the core/extra skill layout - skipping shared agent skill install"
            }

            # OpenCode command stubs -> ~/.config/opencode/commands (always,
            # unless opted out via -SkipOpencode: #1178). The plugin
            # intercepts execution; these stubs just register the slash
            # commands in OpenCode.
            if ((-not $skipOpencodeResolved) -and (Test-Path "apps\opencode-plugin\commands")) {
                $opencodeCommandsDir = "$env:USERPROFILE\.config\opencode\commands"
                $opencodeCmds = Get-ChildItem "apps\opencode-plugin\commands\*.md" -ErrorAction SilentlyContinue
                if ($opencodeCmds) {
                    New-Item -ItemType Directory -Force -Path $opencodeCommandsDir | Out-Null
                    Copy-Item -Force "apps\opencode-plugin\commands\*.md" $opencodeCommandsDir
                    Write-Host "Installed OpenCode commands to $opencodeCommandsDir\"
                }
            }
        } finally {
            Pop-Location
        }
    } else {
        $checkoutFailed = $true
    }
} catch {
    Write-Host "Command/skill install failed: $($_.Exception.Message)"
    $checkoutFailed = $true
}


Remove-Item -Recurse -Force $skillsTmp -ErrorAction SilentlyContinue

if ($checkoutFailed) {
    Write-Host "Error: unable to fetch $repo at $latestTag (network or git error)."
    if ($gitStderrTail.Count -gt 0) {
        Write-Host "git reported:"
        foreach ($line in $gitStderrTail) { Write-Host "  $line" }
    }
    Write-Host "Something went wrong - run the installer again."
    exit 1
}

# Claude Code commands are deprecated in favor of skills. Remove a legacy
# command file only once its replacement skill is actually on disk - running
# AFTER the install above guarantees a failed or skipped skill install never
# leaves users with neither the command nor the skill.
foreach ($cmd in @("plannotator-review", "plannotator-annotate", "plannotator-last")) {
    # A skills opt-out installed no replacement this run, so it removes
    # nothing either - skip means do-not-write, never remove.
    if ($skipSkillsResolved) { continue }
    $cmdPath = Join-Path $claudeCommandsDir "$cmd.md"
    $skillPath = Join-Path $claudeSkillsDir $cmd
    if ((Test-Path $skillPath) -and (Test-Path $cmdPath)) {
        Write-Host "Removing stale Claude command $cmdPath (replaced by the $cmd skill)"
        Remove-Item -Force $cmdPath -ErrorAction SilentlyContinue
    }
}

# plannotator-archive no longer ships as a skill. Remove any stale installed
# copy from every skill scope so upgraders don't keep a dead skill around.
foreach ($scope in @($claudeSkillsDir, $agentsSkillsDir)) {
    # A skills opt-out leaves every skill scope untouched, sweep included.
    if ($skipSkillsResolved) { continue }
    $staleArchivePath = Join-Path $scope "plannotator-archive"
    if (Test-Path $staleArchivePath) {
        Write-Host "Removing stale plannotator-archive skill $staleArchivePath"
        Remove-Item -Recurse -Force $staleArchivePath -ErrorAction SilentlyContinue
    }
}
# The /plannotator-archive OpenCode command was removed too - sweep the stub.
# An OpenCode opt-out suspends the sweep: skip means do-not-write, never remove.
# A skills opt-out suspends it for the same reason.
$staleOpencodeArchive = "$env:USERPROFILE\.config\opencode\commands\plannotator-archive.md"
if ((-not $skipOpencodeResolved) -and (-not $skipSkillsResolved) -and (Test-Path $staleOpencodeArchive)) {
    Write-Host "Removing stale plannotator-archive command $staleOpencodeArchive"
    Remove-Item -Force $staleOpencodeArchive -ErrorAction SilentlyContinue
}

# Apply the saved model-invocation choices. Installed skill copies always
# arrive locked (disable-model-invocation: true in SKILL.md); for each chosen
# skill we unlock the INSTALLED copy by removing that line, and flip the
# sidecar's allow_implicit_invocation to match. Re-applied on every run
# because installs replace the skill folders wholesale. Repo sources never
# change.
# A skills opt-out installed no skill copies this run, so there is nothing to
# unlock - and rewriting a PREVIOUS run's SKILL.md would be a write the opt-out
# promised not to make.
if ((-not $skipSkillsResolved) -and $invocableChoice -and ($invocableChoice -ne "none")) {
    foreach ($skill in ($invocableChoice -split ",")) {
        foreach ($scope in @($claudeSkillsDir, $agentsSkillsDir)) {
            $skillMd = Join-Path $scope (Join-Path $skill "SKILL.md")
            if (Test-Path $skillMd) {
                $content = Get-Content $skillMd
                if ($content -contains "disable-model-invocation: true") {
                    $content | Where-Object { $_ -ne "disable-model-invocation: true" } | Set-Content $skillMd
                    Write-Host "Enabled model invocation: $scope\$skill"
                }
            }
            $sidecar = Join-Path $scope (Join-Path $skill "agents\openai.yaml")
            if (Test-Path $sidecar) {
                $yaml = Get-Content $sidecar -Raw
                if ($yaml -match "allow_implicit_invocation: false") {
                    ($yaml -replace "allow_implicit_invocation: false", "allow_implicit_invocation: true") | Set-Content $sidecar -NoNewline
                }
            }
        }
    }
}

# Update Pi extension if pi is installed. Pi keeps its extension commands and
# the plannotator_submit_plan tool; it no longer bundles skills.
Update-PiExtensionIfPresent

Write-Host ""
Write-Host "=========================================="
Write-Host "  OPENCODE USERS"
Write-Host "=========================================="
Write-Host ""
if ($skipOpencodeResolved) {
    Write-Host "OpenCode: integration skipped ($skipOpencodeSource)."
    Write-Host "No command stubs were written and OpenCode's plugin cache was left alone."
    Write-Host "Re-run without the opt-out to install the command stubs."
} elseif ($skipSkillsResolved) {
    # The stubs ship in the skills checkout, so this run installed none.
    Write-Host "Add the plugin to your opencode.json:"
    Write-Host ""
    Write-Host '  "plugin": ["@plannotator/opencode@latest"]'
    Write-Host ""
    Write-Host "Skills were skipped ($skipSkillsSource), so no /plannotator-* command"
    Write-Host "stubs were installed. Re-run without the opt-out to add them."
} else {
    Write-Host "Add the plugin to your opencode.json:"
    Write-Host ""
    Write-Host '  "plugin": ["@plannotator/opencode@latest"]'
    Write-Host ""
    Write-Host "Then restart OpenCode (OpenCode 2: run opencode2 reload). The /plannotator-review, /plannotator-annotate, and /plannotator-last commands are ready!"
}
# Agent-specific closing sections print only for agents this run detected,
# reusing the detection the integration steps above already ran (Pi: `pi` on
# PATH, as Update-PiExtensionIfPresent checks). A
# detected-but-skipped agent keeps its honest "detected, skipped" section.
# OpenCode has no detection leg and its command stubs are written for everyone,
# so its section stays universal, as does the Claude Code block. Output only:
# nothing here decides what installs.
$piDetected = [bool](Get-Command pi -ErrorAction SilentlyContinue)
if ($piDetected) {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "  PI USERS"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Install the extension:"
    Write-Host ""
    Write-Host "  pi install npm:@plannotator/pi-extension"
    Write-Host ""
    Write-Host "Update it (pi install leaves an existing install as it is):"
    Write-Host ""
    Write-Host "  pi update npm:@plannotator/pi-extension"
}
# Oh My Pi (OMP) loads the Pi extension as an OMP plugin (#1814). This run
# installs nothing into OMP: the section says how, because "Ask this session"
# in OMP comes only from the extension, never from the CLI run in OMP's shell.
$ompDetected = [bool](Get-Command omp -ErrorAction SilentlyContinue)
if ($ompDetected) {
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "  OH MY PI (OMP) USERS"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "Install or update the Plannotator extension in OMP:"
    Write-Host ""
    Write-Host "  omp plugin install @plannotator/pi-extension"
    Write-Host ""
    Write-Host "Then restart OMP and open reviews with /plannotator-review, /plannotator-annotate and"
    Write-Host "/plannotator-last. Reviews opened that way can use Ask this session."
}
Write-Host ""
Write-Host "=========================================="
if ($skipSkillsResolved) {
    # Never claim the /plannotator-* commands are ready when nothing was
    # installed - that false banner is exactly what the skills-checkout
    # guard exists to prevent.
    Write-Host "  CLAUDE CODE USERS: BINARY INSTALLED"
} else {
    Write-Host "  CLAUDE CODE USERS: YOU ARE ALL SET!"
}
Write-Host "=========================================="
Write-Host ""
switch ($claudePluginState) {
    "updated" {
        $to = if ($claudePluginVersion) { " to $claudePluginVersion" } else { "" }
        Write-Host "The Claude Code plugin was updated$to. Restart Claude Code to load it."
    }
    "current" {
        $at = if ($claudePluginVersion) { " ($claudePluginVersion)" } else { "" }
        Write-Host "The Claude Code plugin is up to date$at."
    }
    "no-marketplace" {
        Write-Host "Re-add the Claude Code plugin's marketplace: run these in a terminal, then restart Claude Code:"
        Write-ClaudePluginMarketplaceReadd
    }
    { $_ -in @("skipped", "failed", "manual") } {
        Write-Host "Update the Claude Code plugin: run these in a terminal, then restart Claude Code:"
        Write-ClaudePluginManualUpdate
    }
    default {
        Write-Host "Install the Claude Code plugin:"
        Write-Host "  /plugin marketplace add backnotprop/plannotator"
        Write-Host "  /plugin install plannotator@plannotator"
        Write-Host ""
        Write-Host "Updating the plugin? Run these in a terminal, then restart Claude Code:"
        Write-ClaudePluginManualUpdate
    }
}
Write-Host ""
if ($skipSkillsResolved) {
    Write-Host "Skills were skipped ($skipSkillsSource), so the /plannotator-review,"
    Write-Host "/plannotator-annotate, and /plannotator-last commands are NOT installed."
    Write-Host "Re-run the installer without the opt-out to add them."
} else {
    Write-Host "The /plannotator-review, /plannotator-annotate, and /plannotator-last commands are ready to use after you restart Claude Code!"
}

if ((-not $skipSkillsResolved) -and ($extrasChoice -ne "yes")) {
    Write-Host ""
    Write-Host "Optional skills (compound planning, setup-goal, visual explainer):"
    Write-Host "  npx skills add backnotprop/plannotator/apps/skills/extra --global"
}

# Warn if plannotator is configured in both settings.json hooks AND the plugin (causes double execution)
# Only warn when the plugin is installed - manual-only users won't have overlap
$claudeSettings = if ($env:CLAUDE_CONFIG_DIR) { "$env:CLAUDE_CONFIG_DIR\settings.json" } else { "$env:USERPROFILE\.claude\settings.json" }
if ((Test-Path $pluginHooks) -and (Test-Path $claudeSettings)) {
    $settingsContent = Get-Content -Path $claudeSettings -Raw -ErrorAction SilentlyContinue
    if ($settingsContent -match '"command".*plannotator') {
        Write-Host ""
        Write-Host "!!! WARNING: DUPLICATE HOOK DETECTED !!!"
        Write-Host ""
        Write-Host "  plannotator was found in your settings.json hooks:"
        Write-Host "  $claudeSettings"
        Write-Host ""
        Write-Host "  This will cause plannotator to run TWICE on each plan review."
        Write-Host "  Remove the plannotator hook from settings.json and rely on the"
        Write-Host "  plugin instead (installed automatically via marketplace)."
        Write-Host ""
        Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    }
}

# The full install completed: remember its command-line switches for auto-update.
Write-InstallFlags

# When Claude Code sessions that are open right now cannot load the plugin by
# themselves: one Windows notification and the plugin-update page on
# plannotator.ai in the default browser (same rule and URL as install.sh's
# notify_claude_plugin_reload): updated from a plugin older than 0.28.52, the
# first release whose mod reloads itself (#2356), state=reload; or not updated
# (manual / failed / no-marketplace) while older than this release,
# state=manual. Never on a fresh install, a skipped or current plugin, with no
# live Claude Code session (sessions\<pid>.json), in CI, over SSH, in a
# non-interactive session or under PLANNOTATOR_TEST_SANDBOX. Opt out with
# PLANNOTATOR_INSTALL_NOTIFY=0; PLANNOTATOR_BROWSER is honored for the page (a
# "none" value opens none). The toast is shown by Windows PowerShell
# (powershell.exe; PowerShell 7 has no WinRT types), time-bounded; nothing here
# fails the install.
function Get-ClaudePluginReloadAlert {
    param([string]$State, [string]$From, [string]$To, [string]$Tag)
    if ($env:PLANNOTATOR_INSTALL_NOTIFY -match '^(0|false|no|off|disabled)$') { return $null }
    if ($env:PLANNOTATOR_TEST_SANDBOX -or $env:CI -or $env:SSH_CONNECTION -or $env:SSH_CLIENT -or $env:SSH_TTY) { return $null }
    if (-not [Environment]::UserInteractive) { return $null }
    $plain = { param($v) if ([string]$v -match '^v?(\d+)\.(\d+)\.(\d+)$') { "$($Matches[1]).$($Matches[2]).$($Matches[3])" } else { "" } }
    $have = & $plain $From
    if (-not $have) { return $null }
    $tagPlain = & $plain $Tag
    if ($State -eq "updated") {
        if ([version]$have -ge [version]"0.28.52") { return $null }
        $kind = "reload"
        $to = & $plain $To
        if (-not $to) { $to = $tagPlain }
        $alert = @{ Title = "Plannotator updated its Claude Code plugin"; Body = "Type /reload-plugins in each open Claude Code session to load it." }
    } elseif ($State -in @("manual", "failed", "no-marketplace")) {
        if (-not $tagPlain -or [version]$have -ge [version]$tagPlain) { return $null }
        $kind = "manual"
        $to = $tagPlain
        $alert = @{ Title = "Plannotator could not update its Claude Code plugin"; Body = "See Settings > Agents in the Plannotator Inbox for the two commands to run." }
    } else {
        return $null
    }
    $sessions = if ($env:CLAUDE_CONFIG_DIR) { Join-Path $env:CLAUDE_CONFIG_DIR "sessions" } else { Join-Path $env:USERPROFILE ".claude\sessions" }
    if (-not (Test-Path -LiteralPath $sessions -PathType Container)) { return $null }
    $open = $false
    foreach ($f in @(Get-ChildItem -LiteralPath $sessions -Filter "*.json" -File -ErrorAction SilentlyContinue)) {
        if ($f.BaseName -match '^\d+$' -and (Get-Process -Id ([int]$f.BaseName) -ErrorAction SilentlyContinue)) { $open = $true; break }
    }
    if (-not $open) { return $null }
    $alert.Url = "https://plannotator.ai/plugin-update?state=$kind&from=$have" + $(if ($to) { "&to=$to" } else { "" })
    return $alert
}

function Show-ClaudePluginReloadAlert {
    param($Alert)
    if ($null -eq $Alert) { return }
    $ps = Get-Command powershell.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ps) {
        $t = $Alert.Title -replace "'", "''"
        $b = $Alert.Body -replace "'", "''"
        $toast = "`$m = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]; " +
            "`$x = `$m::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); " +
            "`$n = `$x.GetElementsByTagName('text'); " +
            "`$null = `$n.Item(0).AppendChild(`$x.CreateTextNode('$t')); " +
            "`$null = `$n.Item(1).AppendChild(`$x.CreateTextNode('$b')); " +
            "`$m::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new(`$x))"
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $ps.Source
        $info.Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand " + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($toast))
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        try {
            $p = [System.Diagnostics.Process]::Start($info)
            if (-not $p.WaitForExit(10000)) { try { $p.Kill() } catch { } }
        } catch { }
    }
    $browser = [string]$env:PLANNOTATOR_BROWSER
    if ($browser.Trim().ToLowerInvariant() -in @("none", "false", "0", "off", "no", "true", "1", ":")) { return }
    try {
        if ($browser) { Start-Process -FilePath $browser -ArgumentList $Alert.Url -ErrorAction Stop }
        else { Start-Process -FilePath $Alert.Url -ErrorAction Stop }
    } catch { }
}
try { Show-ClaudePluginReloadAlert (Get-ClaudePluginReloadAlert -State $claudePluginState -From $claudePluginFromVersion -To $claudePluginVersion -Tag $latestTag) } catch { }
