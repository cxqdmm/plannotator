#!/bin/bash
set -e

REPO="backnotprop/plannotator"
SEM_REPO="Ataraxy-Labs/sem"
SEM_VERSION="v0.8.0"
INSTALL_DIR="$HOME/.local/bin"

# First plannotator release that carries SLSA build-provenance attestations.
# Releases before this tag were cut before release.yml added the
# `actions/attest-build-provenance` step, so `gh attestation verify` will
# fail with "no attestations found" for them regardless of authenticity.
# When provenance verification is enabled (via flag, env var, or
# config.json in the Plannotator data folder), the installer compares the resolved tag
# against this constant and fails fast with a clear message instead of
# downloading a binary, running SHA256, and then hitting a cryptic gh
# failure. Bumped once at the first attested release via the release skill.
MIN_ATTESTED_VERSION="v0.17.2"

# Compare two vMAJOR.MINOR.PATCH tags. Returns 0 (success) if $1 >= $2.
# Uses `sort -V` (version sort) which handles minor/patch width correctly
# unlike plain lexicographic comparison (e.g. v0.9.0 vs v0.10.0).
version_ge() {
    [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]
}

# A plain release tag: "v" and three dot-separated runs of ASCII digits,
# nothing else (no suffix, no slash, no query, no whitespace). Used for the
# tag "latest" resolves to, which comes from the network (the API's
# tag_name, or the releases/latest redirect) and goes into download URLs,
# the attestation --source-ref and git clone --branch. Digits are spelled
# out instead of [0-9] so a non-C locale's collation cannot widen the range.
is_release_tag() {
    case "$1" in
        v*) ;;
        *) return 1 ;;
    esac
    _rt_rest="${1#v}"
    case "$_rt_rest" in
        ''|*[!0123456789.]*|.*|*.|*..*) return 1 ;;
        *.*.*.*) return 1 ;;
        *.*.*) return 0 ;;
        *) return 1 ;;
    esac
}

VERSION="latest"
# Tracks whether a version was explicitly set via --version or positional.
# Used to reject mixing --version <tag> with a stray positional token,
# which would otherwise silently overwrite the earlier value and 404.
VERSION_EXPLICIT=0
# Three-layer opt-in for SLSA build-provenance verification.
# Precedence: CLI flag > env var > config.json in the data folder > default (off).
# -1 = flag not set yet (fall through to lower layers); 0 = disable; 1 = enable.
VERIFY_ATTESTATION_FLAG=-1
# Three-layer opt-in for the CallDiff call-flow runtime (large on-disk
# footprint, default off). The normal path installs it in-app from the review
# UI; this flag exists for scripted installs.
# Precedence: --with-call-flow > PLANNOTATOR_INSTALL_CALLDIFF > config.json
# installCallFlow > default (off).
WITH_CALL_FLOW_FLAG=-1
# T3 support is installed only by an explicit flag, never by the plugin,
# environment auto-detection, config.json or the guided-install wizard.
T3_HOOK_FLAG=-1
# Guided-install answers. Precedence: CLI flags > wizard (terminal, first run
# or --reconfigure) > saved prefs from a previous run > defaults (no extras,
# nothing model-invocable). Empty string = not set by a flag.
EXTRAS_FLAG=""
MODEL_INVOCABLE_FLAG=""
NON_INTERACTIVE=0
RECONFIGURE=0
# Binary-only mode. Installs just the plannotator binary (to $INSTALL_DIR) and
# no persistent state elsewhere — no sem sidecar, no CallDiff or agent-terminal runtime, no
# skills, hooks, slash commands, or per-agent config (Claude, OpenCode).
# Set by --minimal (1) / --no-minimal (0); -1 =
# neither flag given (fall through to the PLANNOTATOR_MINIMAL env var). Resolved
# after arg parsing so a flag overrides the env var in either direction.
MINIMAL_FLAG=-1
# Per-agent integration opt-outs (#1178). Skip means do-not-write: when a
# skipped agent is detected, the installer reports "detected, skipped" and
# writes nothing to that agent's home; it never removes an integration a
# previous install already wired. 1 = flag passed. Resolution (flag > env >
# config skipInstall.<agent> > default off) happens after _config_dir is known.
SKIP_OPENCODE_FLAG=0
# Same shape, but scoped to the skills/slash-command sparse checkout rather
# than one agent's home: --skip-skills turns the whole fetch into a no-op for
# every scope it writes (Claude, ~/.agents, OpenCode), including
# the extras and the skill-scope cleanup sweeps. Needed by any environment that
# cannot reach github.com for the tag being installed — the release smoke test
# installs a synthetic v9.9.9 whose tag has no GitHub counterpart.
SKIP_SKILLS_FLAG=0
# Claude Code plugin update opt-out. Not an agent home: when the claude CLI is
# on PATH and plannotator@plannotator is already installed, the installer runs
# `claude plugin marketplace update plannotator` and `claude plugin update
# plannotator@plannotator --scope user` (Claude Code does not auto-update GitHub
# marketplaces). --skip-claude-plugin turns that off. Same three layers.
SKIP_CLAUDE_PLUGIN_FLAG=0

usage() {
    cat <<'USAGE'
Usage: install.sh [--version <tag>] [--verify-attestation | --skip-attestation]
                  [--extras | --no-extras] [--model-invocable <list>|none]
                  [--minimal | --no-minimal] [--skip-opencode] [--skip-skills]
                  [--with-t3 | --without-t3]
                  [--skip-claude-plugin] [--non-interactive] [--reconfigure] [--help]
       install.sh <tag>

Options:
  --version <tag>        Install a specific version (e.g. vX.Y.Z or X.Y.Z;
                         see https://github.com/backnotprop/plannotator/releases).
                         Defaults to the latest GitHub release.
  --verify-attestation   Require SLSA build-provenance verification via
                         `gh attestation verify`. Fails the install if gh is
                         not available or the check does not pass.
  --skip-attestation     Force-skip provenance verification even if enabled
                         via env var or config.json in your Plannotator
                         data folder (`plannotator data-dir`).
  --with-call-flow       Also install the optional pruned CallDiff core
                         (about 5 MB on macOS arm64, needs Node.js 22.18+).
                         By default it is NOT installed; the review UI offers
                         a one-click install when Call flow is enabled. Also
                         enabled by PLANNOTATOR_INSTALL_CALLDIFF=1 or
                         { "installCallFlow": true } in config.json.
  --extras               Install the extra skills (compound, setup-goal,
                         visual-explainer) via `npx skills add` without asking.
  --with-t3              Install the optional T3 Code Claude Bash hook into
                         ${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json.
                         Off by default. Authorize T3 separately with
                         plannotator t3 login --url <T3 MCP URL>.
  --without-t3           Remove only the T3 Code hook from that Claude profile.
                         Preserves other hooks, settings and T3 credentials.
                         Both T3 flags are skipped by --minimal.
  --no-extras            Skip the extras without asking.
  --model-invocable <l>  Comma-separated skill names to make model-invocable
                         (e.g. plannotator-review,plannotator-compound), or
                         "none". Skills are user-invoked-only by default.
  --minimal              Install only the plannotator binary (aliased
                         --binary-only). Skips the sem semantic-diff sidecar,
                         the CallDiff runtime, the agent-terminal runtime, and every per-agent
                         integration (skills, hooks, slash commands, and config
                         for Claude and OpenCode). No
                         persistent state is written outside $HOME/.local/bin
                         (a temp download file is still used and removed). Also
                         enabled by exporting PLANNOTATOR_MINIMAL=1.
  --no-minimal           Force a full install even when PLANNOTATOR_MINIMAL is
                         set in the environment.
  --skip-opencode        Do not write the OpenCode integration (command stubs
                         under ~/.config/opencode/commands and the OpenCode
                         plugin cache clear). OpenCode has no detection leg,
                         so this is a plain do-not-write switch. Env var:
                         PLANNOTATOR_SKIP_OPENCODE_INSTALL; config key:
                         skipInstall.opencode.
  --skip-skills          Do not fetch or write the /plannotator-* skills and
                         slash commands (the sparse checkout that feeds Claude
                         Code, ~/.agents, and OpenCode), the extras, or the skill-scope
                         cleanup sweeps. Nothing
                         already installed is removed. The binary, hooks, and
                         per-agent config still install. Use it where
                         github.com cannot serve the tag being installed. Env
                         var: PLANNOTATOR_SKIP_SKILLS_INSTALL; config key:
                         skipInstall.skills.
  --skip-claude-plugin   Do not update an installed Claude Code plugin. By
                         default, when the claude CLI is on PATH and the
                         plannotator@plannotator plugin is installed, the
                         installer runs `claude plugin marketplace update
                         plannotator` and `claude plugin update
                         plannotator@plannotator --scope user`. It never
                         installs the plugin, and skips a --version pin. Env
                         var: PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE;
                         config key: skipInstall.claudePlugin.
  --non-interactive      Never prompt, even in a terminal. Uses flags, then
                         saved answers from a previous run, then the defaults
                         (no extras, nothing model-invocable).
  --reconfigure          Re-open the guided questions even if answers were
                         saved by a previous run.
  -h, --help             Show this help and exit.

Guided install: when run in a terminal for the first time (or with
--reconfigure), the installer asks whether to install the extra skills and
whether any skills should be callable by the model. Answers are saved to
<data dir>/install-prefs and
reused silently on re-runs. Piped/CI runs (no terminal) never prompt and
keep the defaults.

Provenance verification is off by default. Enable it by any of:
  - passing --verify-attestation
  - exporting PLANNOTATOR_VERIFY_ATTESTATION=1
  - setting { "verifyAttestation": true } in config.json in your Plannotator data folder (`plannotator data-dir`)
When enabled, the attestation bundle is fetched from GitHub's public
attestations API and verified with `gh attestation verify --bundle`, so no
gh login is required. The credential-free path needs one JSON tool on PATH
(node, python3, or jq) to extract the bundle; without one, and whenever the
public bundle fetch or bundle verification does not complete, gh's
authenticated fetch runs as the fallback.

The optional semantic-diff sidecar (the 'sem' binary, used by code review) is
installed after Plannotator itself. Skip it by exporting
PLANNOTATOR_SKIP_SEM_INSTALL=1. Its download is time-bounded, so a slow network
never blocks an otherwise-complete install.

The optional annotate agent terminal runtime is installed after Plannotator
itself. Skip it by exporting PLANNOTATOR_SKIP_AGENT_TERMINAL_INSTALL=1. If
Node/npm is unavailable, Plannotator still installs and annotate mode works
without the integrated terminal.

Examples:
  curl -fsSL https://plannotator.ai/install.sh | bash
  curl -fsSL https://plannotator.ai/install.sh | bash -s -- --version vX.Y.Z
  curl -fsSL https://plannotator.ai/install.sh | bash -s -- --no-extras --model-invocable none
  bash install.sh vX.Y.Z
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version)
            if [ -z "${2:-}" ]; then
                echo "--version requires an argument" >&2
                usage >&2
                exit 1
            fi
            case "$2" in
                -*)
                    echo "--version requires a tag value, got flag: $2" >&2
                    usage >&2
                    exit 1
                    ;;
            esac
            VERSION="$2"
            VERSION_EXPLICIT=1
            shift 2
            ;;
        --version=*)
            value="${1#--version=}"
            if [ -z "$value" ]; then
                echo "--version requires an argument" >&2
                usage >&2
                exit 1
            fi
            case "$value" in
                -*)
                    echo "--version requires a tag value, got flag: $value" >&2
                    usage >&2
                    exit 1
                    ;;
            esac
            VERSION="$value"
            VERSION_EXPLICIT=1
            shift
            ;;
        --verify-attestation)
            if [ "$VERIFY_ATTESTATION_FLAG" = "0" ]; then
                echo "--verify-attestation and --skip-attestation are mutually exclusive" >&2
                usage >&2
                exit 1
            fi
            VERIFY_ATTESTATION_FLAG=1
            shift
            ;;
        --with-call-flow)
            WITH_CALL_FLOW_FLAG=1
            shift
            ;;
        --skip-attestation)
            if [ "$VERIFY_ATTESTATION_FLAG" = "1" ]; then
                echo "--skip-attestation and --verify-attestation are mutually exclusive" >&2
                usage >&2
                exit 1
            fi
            VERIFY_ATTESTATION_FLAG=0
            shift
            ;;
        --extras)
            EXTRAS_FLAG="yes"
            shift
            ;;
        --no-extras)
            EXTRAS_FLAG="no"
            shift
            ;;
        --model-invocable)
            if [ -z "${2:-}" ]; then
                echo "--model-invocable requires a comma-separated skill list or 'none'" >&2
                usage >&2
                exit 1
            fi
            MODEL_INVOCABLE_FLAG="$2"
            shift 2
            ;;
        --model-invocable=*)
            MODEL_INVOCABLE_FLAG="${1#--model-invocable=}"
            if [ -z "$MODEL_INVOCABLE_FLAG" ]; then
                echo "--model-invocable requires a comma-separated skill list or 'none'" >&2
                usage >&2
                exit 1
            fi
            shift
            ;;
        --non-interactive|--yes)
            NON_INTERACTIVE=1
            shift
            ;;
        --reconfigure)
            RECONFIGURE=1
            shift
            ;;
        --minimal|--binary-only)
            if [ "$MINIMAL_FLAG" = "0" ]; then
                echo "--minimal and --no-minimal are mutually exclusive" >&2
                usage >&2
                exit 1
            fi
            MINIMAL_FLAG=1
            shift
            ;;
        --no-minimal)
            if [ "$MINIMAL_FLAG" = "1" ]; then
                echo "--no-minimal and --minimal are mutually exclusive" >&2
                usage >&2
                exit 1
            fi
            MINIMAL_FLAG=0
            shift
            ;;
        --with-t3|--without-t3)
            _t3_value=1
            [ "$1" = "--without-t3" ] && _t3_value=0
            if [ "$T3_HOOK_FLAG" -ne -1 ] && [ "$T3_HOOK_FLAG" -ne "$_t3_value" ]; then
                echo "--with-t3 and --without-t3 are mutually exclusive" >&2
                exit 1
            fi
            T3_HOOK_FLAG="$_t3_value"
            shift
            ;;
        --skip-opencode)
            SKIP_OPENCODE_FLAG=1
            shift
            ;;
        --skip-skills)
            SKIP_SKILLS_FLAG=1
            shift
            ;;
        --skip-claude-plugin)
            SKIP_CLAUDE_PLUGIN_FLAG=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            # Positional form: install.sh vX.Y.Z (matches install.cmd interface).
            # Reject if --version was already passed — silent overwrite is worse
            # than a clean usage error.
            if [ "$VERSION_EXPLICIT" -eq 1 ]; then
                echo "Unexpected positional argument: $1 (version already set)" >&2
                usage >&2
                exit 1
            fi
            VERSION="$1"
            VERSION_EXPLICIT=1
            shift
            ;;
    esac
done

# Resolve binary-only mode. Precedence: --minimal / --no-minimal flag >
# PLANNOTATOR_MINIMAL env var > default (off). The env var lets `curl ... | bash`
# runs opt in without a flag, matching how PLANNOTATOR_SKIP_SEM_INSTALL et al.
# work; --no-minimal lets a flag override an env var that enables it.
minimal=0
case "${PLANNOTATOR_MINIMAL:-}" in
    1|true|yes|TRUE|YES|True|Yes) minimal=1 ;;
esac
if [ "$MINIMAL_FLAG" -ne -1 ]; then
    minimal="$MINIMAL_FLAG"
fi

case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      echo "Unsupported OS. For Windows, run: irm https://plannotator.ai/install.ps1 | iex" >&2; exit 1 ;;
esac

case "$(uname -m)" in
    x86_64|amd64)   arch="x64" ;;
    arm64|aarch64)  arch="arm64" ;;
    *)              echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

platform="${os}-${arch}"
binary_name="plannotator-${platform}"

# Clean up old Windows install locations (for users running bash on Windows)
if [ -n "$USERPROFILE" ]; then
    # Running on Windows (Git Bash, MSYS, etc.) - clean up old locations
    rm -f "$USERPROFILE/.local/bin/plannotator" "$USERPROFILE/.local/bin/plannotator.exe" 2>/dev/null || true
    rm -f "$LOCALAPPDATA/plannotator/plannotator.exe" 2>/dev/null || true
    echo "Cleaned up old Windows install locations"
fi

if [ "$VERSION" = "latest" ]; then
    echo "Fetching latest version..."

    # api.github.com caps unauthenticated requests at 60/hour per source IP,
    # which fails installs behind shared egress IPs (NAT/CGNAT/corporate
    # proxies) and during repeated/debug runs within an hour. Attach an
    # Authorization header when a token is available (raises the limit to
    # 5000/hour); when none is found, fall back to anonymous (unchanged
    # behavior). Precedence matches `gh`: GITHUB_TOKEN > GH_TOKEN > gh auth token.
    GH_AUTH_HEADER=()
    if [ -n "${GITHUB_TOKEN:-${GH_TOKEN:-}}" ]; then
        GH_AUTH_HEADER=(-H "Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN}}")
    elif command -v gh >/dev/null 2>&1; then
        # --hostname github.com scopes the fallback to github.com credentials,
        # so a gh setup whose default host is a GitHub Enterprise server never
        # leaks a GHES token to api.github.com. On an ancient gh without the
        # flag, stderr is swallowed and we fall back to anonymous.
        if _gh_token="$(gh auth token --hostname github.com 2>/dev/null)" && [ -n "$_gh_token" ]; then
            GH_AUTH_HEADER=(-H "Authorization: Bearer ${_gh_token}")
        fi
    fi
    # A stale/revoked token (expired GITHUB_TOKEN lingering in CI images,
    # dotfiles, direnv) gets a 401 here and would break an install that
    # works fine anonymously today. Retry anonymously ONLY on HTTP 401:
    # requests carrying invalid credentials count against the anonymous
    # 60/hour per-IP pool, so a blind retry on any failure would double the
    # burn, and network failures gain nothing from a second attempt.
    # Note: no -f here, so a 401 body doesn't abort curl before -w prints
    # the status code. See backnotprop/plannotator#1157.
    _api_url="https://api.github.com/repos/${REPO}/releases/latest"
    _api_body=$(curl -sSL -w '\n%{http_code}' "${GH_AUTH_HEADER[@]}" "$_api_url" 2>/dev/null) || true
    _api_code="${_api_body##*$'\n'}"
    if [ "$_api_code" = "401" ] && [ ${#GH_AUTH_HEADER[@]} -gt 0 ]; then
        _api_body=$(curl -sSL -w '\n%{http_code}' "$_api_url" 2>/dev/null) || true
        _api_code="${_api_body##*$'\n'}"
    fi
    if [ "$_api_code" = "200" ]; then
        # Pull "tag_name" out of the JSON by key, not by line: GitHub can serve
        # the response compact (one line), where a line-based grep+cut picks up
        # the first quoted value on that line ("url") instead (#1655). Only a
        # plain vX.Y.Z-style tag is accepted; anything else counts as a failure.
        latest_tag=$(printf '%s' "$_api_body" | tr -d '\n\r' | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
        is_release_tag "$latest_tag" || latest_tag=""
    else
        latest_tag=""
    fi
    # Drop the local token copies; GITHUB_TOKEN / GH_TOKEN themselves remain
    # in the environment exactly as the user set them.
    unset _gh_token GH_AUTH_HEADER _api_url _api_body _api_code

    # The API failed (anonymous rate limit of 60/hour per IP, a proxy that
    # blocks api.github.com): read the tag from the redirect that
    # github.com/<repo>/releases/latest answers with (.../releases/tag/vX.Y.Z),
    # which is not rate-limited and needs no token or gh.
    if [ -z "$latest_tag" ]; then
        _latest_url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" 2>/dev/null) || true
        latest_tag="${_latest_url##*/}"
        is_release_tag "$latest_tag" || latest_tag=""
        unset _latest_url
    fi

    if [ -z "$latest_tag" ]; then
        echo "Failed to fetch latest version (check your connection, or pass --version vX.Y.Z)" >&2
        exit 1
    fi
else
    # Normalize: auto-prefix v if missing (matches install.cmd behaviour)
    case "$VERSION" in
        v*) latest_tag="$VERSION" ;;
        *)  latest_tag="v$VERSION" ;;
    esac
fi

echo "Installing plannotator ${latest_tag}..."

# Resolve SLSA build-provenance verification opt-in BEFORE the download so we
# can fail fast without wasting bandwidth if the requested tag predates
# provenance support. The three layers (config file, env var, CLI flag) are
# all cheap to check — no reason to defer this past the arg parse.
#
# Precedence: CLI flag > env var > config.json in the data folder > default (off).
verify_attestation=0

# Layer 3: config file (lowest precedence of the opt-in sources).
# Crude grep against a flat boolean — PlannotatorConfig has no nested
# verifyAttestation, so false positives are not a concern.
# Resolve the data directory, expanding ~ the same way the runtime does
# (packages/shared/data-dir.ts). Unset: an existing ~/.plannotator (legacy
# default) wins, unless it holds none of Plannotator's data while
# $XDG_DATA_HOME/plannotator does (a stray folder, #2305); otherwise an
# explicitly-set absolute XDG_DATA_HOME places it at
# $XDG_DATA_HOME/plannotator; otherwise ~/.plannotator.
# BEGIN data-dir resolution (tests/data-dir-mirrors.test.ts runs this block)
_holds_plannotator_data() {
    for _marker in history sessions drafts inbox claude-code-mod install-flags.json; do
        [ -e "$1/$_marker" ] && return 0
    done
    return 1
}
_raw_dir="${PLANNOTATOR_DATA_DIR:-}"
case "$_raw_dir" in
    "")
        _config_dir="$HOME/.plannotator"
        _xdg_dir=""
        # Trimmed like the runtime's XDG_DATA_HOME?.trim().
        _xdg_home=$(printf '%s' "${XDG_DATA_HOME:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        case "$_xdg_home" in
            /*) _xdg_dir="$_xdg_home/plannotator" ;;
        esac
        if [ -e "$_config_dir" ]; then
            if [ -n "$_xdg_dir" ] && [ -e "$_xdg_dir" ] && _holds_plannotator_data "$_xdg_dir" && ! _holds_plannotator_data "$_config_dir"; then
                _config_dir="$_xdg_dir"
            fi
        elif [ -n "$_xdg_dir" ]; then
            _config_dir="$_xdg_dir"
        fi
        ;;
    "~")     _config_dir="$HOME" ;;
    "~/"*)   _config_dir="$HOME/${_raw_dir#\~/}" ;;
    *)       _config_dir="$_raw_dir" ;;
esac
# END data-dir resolution
if [ -f "$_config_dir/config.json" ]; then
    if grep -q '"verifyAttestation"[[:space:]]*:[[:space:]]*true' "$_config_dir/config.json" 2>/dev/null; then
        verify_attestation=1
    fi
fi

# Layer 2: env var (overrides config file).
case "${PLANNOTATOR_VERIFY_ATTESTATION:-}" in
    1|true|yes|TRUE|YES|True|Yes) verify_attestation=1 ;;
    0|false|no|FALSE|NO|False|No) verify_attestation=0 ;;
esac

# Layer 1: CLI flag (overrides everything).
if [ "$VERIFY_ATTESTATION_FLAG" -ne -1 ]; then
    verify_attestation="$VERIFY_ATTESTATION_FLAG"
fi

# Resolve the CallDiff call-flow runtime opt-in. Same three-layer shape as
# verifyAttestation: CLI flag > env var > config.json > default (off). The
# config grep targets a flat top-level boolean, matching verifyAttestation.
install_call_flow=0
if [ -f "$_config_dir/config.json" ]; then
    if grep -q '"installCallFlow"[[:space:]]*:[[:space:]]*true' "$_config_dir/config.json" 2>/dev/null; then
        install_call_flow=1
    fi
fi
case "${PLANNOTATOR_INSTALL_CALLDIFF:-}" in
    1|true|yes|TRUE|YES|True|Yes) install_call_flow=1 ;;
    0|false|no|FALSE|NO|False|No) install_call_flow=0 ;;
esac
if [ "$WITH_CALL_FLOW_FLAG" -ne -1 ]; then
    install_call_flow="$WITH_CALL_FLOW_FLAG"
fi

# Resolve the per-agent integration opt-outs (#1178). Same three-layer shape
# as verifyAttestation: CLI flag > env var > config.json > default (off).
# The config layer first extracts JUST the skipInstall object (from the
# first "{" after the "skipInstall" key to its first "}" — the object is a
# flat map of booleans, so the first closing brace ends it) and matches
# per-agent keys only inside that region. This keeps a "opencode": true under
# some OTHER key from opting anyone out (M2), works whether the JSON is
# pretty-printed or single-line, and an explicit `"opencode": false` inside
# skipInstall is honored as a veto rather than being ignored. Each resolved
# skip remembers its source so the detected-but-skipped report can name
# what the user set.
skip_opencode=0
skip_opencode_source=""
# skipInstall.skills is not an agent — it opts out of the skills/slash-command
# checkout for every scope at once — but it shares the same three layers and
# the same key region, so it rides along in the loop below.
skip_skills=0
skip_skills_source=""
# skipInstall.claudePlugin opts out of updating an installed Claude Code plugin.
skip_claude_plugin=0
skip_claude_plugin_source=""
_skip_install_block=""
if [ -f "$_config_dir/config.json" ]; then
    _skip_install_block=$(awk '
        { buf = buf $0 "\n" }
        END {
            # Token check: the key must be followed by optional whitespace,
            # a colon, and the object brace - so a STRING VALUE that merely
            # contains "skipInstall" cannot anchor the extraction. Non-token
            # occurrences are skipped and the scan continues.
            pos = 1
            while (1) {
                i = index(substr(buf, pos), "\"skipInstall\"")
                if (i == 0) exit
                i = pos + i - 1
                rest = substr(buf, i + 13)
                if (match(rest, /^[ \t\r\n]*:[ \t\r\n]*\{/) != 0) {
                    rest = substr(rest, RLENGTH)
                    k = index(rest, "}")
                    if (k == 0) exit
                    print substr(rest, 1, k)
                    exit
                }
                pos = i + 13
            }
        }' "$_config_dir/config.json" 2>/dev/null) || _skip_install_block=""
fi
if [ -n "$_skip_install_block" ]; then
    for _agent in opencode skills claudePlugin; do
        if printf '%s' "$_skip_install_block" | grep -q "\"$_agent\"[[:space:]]*:[[:space:]]*false"; then
            continue # explicit false is a veto, never a skip
        fi
        if printf '%s' "$_skip_install_block" | grep -q "\"$_agent\"[[:space:]]*:[[:space:]]*true"; then
            case "$_agent" in
                opencode)
                    skip_opencode=1
                    skip_opencode_source="config skipInstall.opencode"
                    ;;
                skills)
                    skip_skills=1
                    skip_skills_source="config skipInstall.skills"
                    ;;
                claudePlugin)
                    skip_claude_plugin=1
                    skip_claude_plugin_source="config skipInstall.claudePlugin"
                    ;;
            esac
        fi
    done
    unset _agent
fi
unset _skip_install_block
case "${PLANNOTATOR_SKIP_OPENCODE_INSTALL:-}" in
    1|true|yes|TRUE|YES|True|Yes)
        skip_opencode=1
        skip_opencode_source="PLANNOTATOR_SKIP_OPENCODE_INSTALL"
        ;;
    0|false|no|FALSE|NO|False|No)
        skip_opencode=0
        skip_opencode_source=""
        ;;
esac
case "${PLANNOTATOR_SKIP_SKILLS_INSTALL:-}" in
    1|true|yes|TRUE|YES|True|Yes)
        skip_skills=1
        skip_skills_source="PLANNOTATOR_SKIP_SKILLS_INSTALL"
        ;;
    0|false|no|FALSE|NO|False|No)
        skip_skills=0
        skip_skills_source=""
        ;;
esac
case "${PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE:-}" in
    1|true|yes|TRUE|YES|True|Yes)
        skip_claude_plugin=1
        skip_claude_plugin_source="PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE"
        ;;
    0|false|no|FALSE|NO|False|No)
        skip_claude_plugin=0
        skip_claude_plugin_source=""
        ;;
esac
if [ "$SKIP_OPENCODE_FLAG" -eq 1 ]; then
    skip_opencode=1
    skip_opencode_source="--skip-opencode"
fi
if [ "$SKIP_SKILLS_FLAG" -eq 1 ]; then
    skip_skills=1
    skip_skills_source="--skip-skills"
fi
if [ "$SKIP_CLAUDE_PLUGIN_FLAG" -eq 1 ]; then
    skip_claude_plugin=1
    skip_claude_plugin_source="--skip-claude-plugin"
fi

# Pre-flight: if verification is requested, reject tags older than the first
# attested release before we download anything. This catches both explicit
# `--version <old-tag>` and implicit `latest`-resolves-to-old-tag cases with
# a clean, actionable error — no cryptic `gh: no attestations found` after
# a wasted download.
if [ "$verify_attestation" -eq 1 ]; then
    if ! version_ge "$latest_tag" "$MIN_ATTESTED_VERSION"; then
        echo "Provenance verification was requested, but ${latest_tag} predates" >&2
        echo "plannotator's attestation support. The first release carrying signed" >&2
        echo "build provenance is ${MIN_ATTESTED_VERSION}. Options:" >&2
        echo "  - Pin to ${MIN_ATTESTED_VERSION} or later: --version ${MIN_ATTESTED_VERSION}" >&2
        echo "  - Install without provenance verification: --skip-attestation" >&2
        echo "  - Or unset PLANNOTATOR_VERIFY_ATTESTATION / remove verifyAttestation" >&2
        echo "    from config.json in your Plannotator data folder (\`plannotator data-dir\`)" >&2
        exit 1
    fi
fi

release_download_url_allowed() {
    local url="$1" authority host
    case "$url" in
        https://*) authority="${url#https://}" ;;
        http://*) authority="${url#http://}" ;;
        *) return 1 ;;
    esac
    authority="${authority%%[/?#]*}"
    case "$authority" in
        ""|*@*) return 1 ;;
    esac
    case "$url" in
        https://*) return 0 ;;
    esac
    host="$(printf '%s' "$authority" | tr '[:upper:]' '[:lower:]')"
    case "$host" in
        "[::1]"|"[::1]:"*) return 0 ;;
    esac
    host="${host%%:*}"
    [ "$host" = "localhost" ] && return 0
    [[ "$host" =~ ^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

release_download_base="https://github.com/${REPO}/releases/download"
release_download_override="${PLANNOTATOR_RELEASE_DOWNLOAD_URL:-}"
# Read the value as update-prepare does (trim, then drop trailing slashes), so
# the binary and the checksum Plannotator pinned come from the same place.
release_download_override="${release_download_override#"${release_download_override%%[![:space:]]*}"}"
release_download_override="${release_download_override%"${release_download_override##*[![:space:]]}"}"
while [ "${release_download_override%/}" != "$release_download_override" ]; do
    release_download_override="${release_download_override%/}"
done
if [ -n "$release_download_override" ] && release_download_url_allowed "$release_download_override"; then
    release_download_base="$release_download_override"
fi

binary_url="${release_download_base}/${latest_tag}/${binary_name}"
checksum_url="${binary_url}.sha256"

mkdir -p "$INSTALL_DIR"

# Release downloads retry a dropped connection (#2788): one HTTP/2 reset or
# timeout used to fail the whole install or update. This is for the small
# .sha256; the binary resumes instead (download_release_binary below).
# --retry-all-errors (curl 7.71+) also retries the errors plain
# --retry treats as final, such as an HTTP/2 stream error (curl 92); an older
# curl rejects the option, so it gets --retry alone. The probe puts the
# option before --version, which ends curl's option parsing.
curl_retry_args=(--retry 3 --retry-delay 2)
if curl --retry-all-errors --version >/dev/null 2>&1; then
    curl_retry_args+=(--retry-all-errors)
fi

# download_release_file <url> <file> <max seconds> [<retry seconds>]: each
# attempt must connect within 30 s, gives up after a minute below 1 byte/s (an
# update holds its lock while it runs) and after <max seconds>, and no retry
# starts after <retry seconds> (default: <max seconds>). When curl still ends
# in an HTTP/2 error (92), one more run goes over HTTP/1.1. Returns curl's
# exit status.
download_release_file() {
    _dl_status=0
    curl -fsSL "${curl_retry_args[@]}" --connect-timeout 30 --max-time "$3" --retry-max-time "${4:-$3}" \
        --speed-limit 1 --speed-time 60 -o "$2" "$1" || _dl_status=$?
    if [ "$_dl_status" -eq 92 ]; then
        echo "The download hit an HTTP/2 error; trying again over HTTP/1.1..." >&2
        _dl_status=0
        curl -fsSL --http1.1 "${curl_retry_args[@]}" --connect-timeout 30 --max-time "$3" --retry-max-time "${4:-$3}" \
            --speed-limit 1 --speed-time 60 -o "$2" "$1" || _dl_status=$?
    fi
    return "$_dl_status"
}

# download_release_binary <url> <file>: the binary download continues where a
# dropped or stalled connection stopped, instead of starting the ~200 MB again
# from zero. Each attempt is one curl run: the first starts at byte 0, each
# later one asks for the rest with a Range request (curl -C -), always from
# <url> again (a github.com URL that redirects to a signed one that expires,
# so the redirected URL is never reused). curl's own --retry is not used here:
# it throws away the bytes of the attempt it retries. Bounds: at most 30
# attempts, at most 4 in a row that add no bytes, 2 s apart, and nothing runs
# past 6 hours from the start, so a link at about 10 KB/s still finishes the
# binary and a dead or trickling one stops. A stall (below 1 byte/s for 60 s)
# ends an attempt and the next one continues. A server that ignores the Range
# (curl exit 33) gets the whole file again, and later attempts start from zero.
# After an HTTP/2 error (curl 92) the attempts go over HTTP/1.1. curl's error
# is printed only when it gives up, and the status is its last exit code. The
# SHA-256 check below still covers the whole file.
# PLANNOTATOR_DOWNLOAD_STALL_SECONDS and PLANNOTATOR_DOWNLOAD_RETRY_DELAY are
# internal knobs for the tests.
download_release_binary() {
    _db_url="$1"
    _db_file="$2"
    _db_stall="${PLANNOTATOR_DOWNLOAD_STALL_SECONDS:-60}"
    case "$_db_stall" in ''|*[!0-9]*|0) _db_stall=60 ;; esac
    _db_delay="${PLANNOTATOR_DOWNLOAD_RETRY_DELAY:-2}"
    case "$_db_delay" in ''|*[!0-9]*) _db_delay=2 ;; esac
    _db_deadline=$((SECONDS + 21600))
    _db_attempt=0
    _db_idle=0
    _db_range=1
    _db_http=()
    while :; do
        _db_attempt=$((_db_attempt + 1))
        _db_resume=()
        _db_have=$(wc -c < "$_db_file" 2>/dev/null | tr -d ' ') || _db_have=0
        case "$_db_have" in ''|*[!0-9]*) _db_have=0 ;; esac
        if [ "$_db_have" -gt 0 ]; then
            if [ "$_db_range" -eq 1 ]; then
                _db_resume=(-C -)
            else
                : > "$_db_file"
                _db_have=0
            fi
        fi
        _db_left=$((_db_deadline - SECONDS))
        [ "$_db_left" -ge 1 ] || _db_left=1
        _db_status=0
        _db_err=$(curl -fsSL ${_db_http[@]+"${_db_http[@]}"} ${_db_resume[@]+"${_db_resume[@]}"} \
            --connect-timeout 30 --max-time "$_db_left" --speed-limit 1 --speed-time "$_db_stall" \
            -o "$_db_file" "$_db_url" 2>&1) || _db_status=$?
        [ "$_db_status" -ne 0 ] || return 0
        if [ "$_db_status" -eq 33 ]; then
            _db_range=0
        fi
        if [ "$_db_status" -eq 92 ] && [ "${#_db_http[@]}" -eq 0 ]; then
            echo "The download hit an HTTP/2 error; trying again over HTTP/1.1..." >&2
            _db_http=(--http1.1)
        fi
        _db_now=$(wc -c < "$_db_file" 2>/dev/null | tr -d ' ') || _db_now=0
        case "$_db_now" in ''|*[!0-9]*) _db_now=0 ;; esac
        if [ "$_db_now" -gt "$_db_have" ]; then
            _db_idle=0
        else
            _db_idle=$((_db_idle + 1))
        fi
        if [ "$_db_attempt" -ge 30 ] || [ "$_db_idle" -ge 4 ] || [ "$SECONDS" -ge "$_db_deadline" ]; then
            [ -z "$_db_err" ] || printf '%s\n' "$_db_err" >&2
            return "$_db_status"
        fi
        sleep "$_db_delay"
    done
}

# Safe updates (step 1): `plannotator update`, Update now and auto-update run
# this script after the running Plannotator downloaded it, and the .sha256 of
# both binaries this OS may use, with its OWN connection (not this script's
# curl, which on macOS still trusts the leaked eMudhra root keys). They arrive
# as PLANNOTATOR_EXPECTED_SHA256="<asset>=<hex> [<asset>=<hex>]" (this machine's
# CPU type, and the other one when it was available). A valid value for
# ${binary_name} is the expected checksum, and the .sha256 is not fetched again.
# A mismatch exits 113 before anything is replaced, after touching the marker
# file the updater named in PLANNOTATOR_UPDATE_MISMATCH_FILE (the updater only
# reports a mismatch when that marker exists). Without the variables (a
# person running the script, an older Plannotator) nothing changes.
pinned_checksum=""
for _pin_pair in ${PLANNOTATOR_EXPECTED_SHA256:-}; do
    case "$_pin_pair" in
        "${binary_name}="*) pinned_checksum=$(printf '%s' "${_pin_pair#*=}" | tr 'ABCDEF' 'abcdef') ;;
    esac
done
unset _pin_pair
case "$pinned_checksum" in
    *[!0123456789abcdef]*) pinned_checksum="" ;;
esac
[ "${#pinned_checksum}" -eq 64 ] || pinned_checksum=""
if [ -n "$pinned_checksum" ]; then
    expected_checksum="$pinned_checksum"
else
    if [ -n "${PLANNOTATOR_EXPECTED_SHA256:-}" ]; then
        # Only our own bug can cause this (the value comes from the running
        # Plannotator, never the network): check as before rather than block.
        echo "Note: the update carried no checksum for ${binary_name}; checking the release's .sha256 instead."
    fi
    checksum_file=$(mktemp)
    checksum_status=0
    download_release_file "$checksum_url" "$checksum_file" 120 || checksum_status=$?
    if [ "$checksum_status" -ne 0 ]; then
        rm -f "$checksum_file"
        echo "Could not download the checksum for ${binary_name} ${latest_tag} (curl exit ${checksum_status}). Nothing was changed; try again later." >&2
        exit 1
    fi
    expected_checksum=$(cut -d' ' -f1 < "$checksum_file" | tr -d '\r' | tr 'ABCDEF' 'abcdef')
    rm -f "$checksum_file"
    # The same shape check as the pinned value: an empty or garbled .sha256
    # (a proxy's page, a cut-off file) never gets as far as the compare.
    case "$expected_checksum" in
        *[!0123456789abcdef]*) expected_checksum="" ;;
    esac
    if [ "${#expected_checksum}" -ne 64 ]; then
        echo "The checksum file for ${binary_name} ${latest_tag} is not a SHA-256 checksum. Nothing was changed; try again later." >&2
        exit 1
    fi
fi

sha256_of() {
    if [ "$(uname -s)" = "Darwin" ]; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        sha256sum "$1" | cut -d' ' -f1
    fi
}

packed_suffixes=".tar.xz .gz"
case "${PLANNOTATOR_SKIP_COMPRESSED_DOWNLOAD:-}" in
    1|true|yes|TRUE|YES|True|Yes) packed_suffixes="" ;;
esac

can_unpack() {
    case "$1" in
        .tar.xz) command -v tar >/dev/null 2>&1 && { [ "$(uname -s)" = "Darwin" ] || command -v xz >/dev/null 2>&1; } ;;
        .gz) command -v gzip >/dev/null 2>&1 ;;
        *) return 1 ;;
    esac
}

unpack_release_asset() {
    case "$1" in
        .tar.xz) tar -xJOf "$2" "$binary_name" ;;
        .gz) gzip -dc < "$2" ;;
    esac > "$3" 2>/dev/null
}

tmp_file=$(mktemp)
taken=""
actual_checksum=""
for packed_suffix in $packed_suffixes; do
    can_unpack "$packed_suffix" || continue
    curl -fsSLI -o /dev/null --connect-timeout 30 --max-time 60 "${binary_url}${packed_suffix}" 2>/dev/null || continue
    packed_file=$(mktemp)
    if download_release_binary "${binary_url}${packed_suffix}" "$packed_file" 2>/dev/null &&
        unpack_release_asset "$packed_suffix" "$packed_file" "$tmp_file"; then
        actual_checksum=$(sha256_of "$tmp_file")
        if [ "$actual_checksum" = "$expected_checksum" ]; then
            taken="${binary_name}${packed_suffix}"
        fi
    fi
    rm -f "$packed_file"
    [ -z "$taken" ] || break
    : > "$tmp_file"
    actual_checksum=""
done

if [ -z "$taken" ]; then
    # Exit 1, not curl's code: the updater gives some codes a meaning.
    binary_status=0
    download_release_binary "$binary_url" "$tmp_file" || binary_status=$?
    if [ "$binary_status" -ne 0 ]; then
        rm -f "$tmp_file"
        echo "Could not download ${binary_name} ${latest_tag} (curl exit ${binary_status}). Nothing was changed; try again later." >&2
        exit 1
    fi
    taken="$binary_name"
fi
echo "Downloaded ${taken}."

[ -n "$actual_checksum" ] || actual_checksum=$(sha256_of "$tmp_file")

if [ "$actual_checksum" != "$expected_checksum" ]; then
    rm -f "$tmp_file"
    if [ -n "$pinned_checksum" ]; then
        echo "Stopped: the ${latest_tag} download doesn't match the checksum Plannotator fetched for it." >&2
        echo "Nothing was changed; the Plannotator you have still works." >&2
        echo "Something on the network may have changed the download. Try again later, or on another network." >&2
        case "${PLANNOTATOR_UPDATE_MISMATCH_FILE:-}" in
            /*/checksum-mismatch) : > "$PLANNOTATOR_UPDATE_MISMATCH_FILE" 2>/dev/null || true ;;
        esac
        exit 113
    fi
    echo "Checksum verification failed!" >&2
    exit 1
fi
if [ -n "$pinned_checksum" ]; then
    echo "Checksum matches the one Plannotator fetched for ${latest_tag}."
fi

if [ "$verify_attestation" -eq 1 ]; then
    # $verify_attestation was resolved before the download; MIN_ATTESTED_VERSION
    # pre-flight already ran and rejected old tags. At this point we know
    # the tag is attested and gh should find a bundle.
    if command -v gh >/dev/null 2>&1; then
        # Credential-free path first (#1178): the attestations endpoint on
        # api.github.com is world-readable for public repos, so fetch the
        # Sigstore bundle anonymously and hand it to gh via --bundle. The
        # authenticated path fetches the SAME endpoint with an Authorization
        # header it does not need; dropping the login requirement avoids
        # forcing a broadly-scoped plaintext token onto headless machines
        # just to read public data. Single fetch attempt, deliberately never
        # retried: the unauthenticated API allows 60 requests/hour per IP.
        # Any failure on this path (no JSON extractor, network, rate limit,
        # extraction failure, or a gh that cannot handle --bundle) falls
        # back to gh's own authenticated fetch below — verification itself
        # is never skipped.
        #
        # The response is { "attestations": [ { "bundle": {...}, ... } ] }.
        # gh --bundle expects the bundle values themselves, one JSON document
        # per line (the same JSONL format `gh attestation download` writes).
        # The extraction needs a JSON tool: node, then python3, then jq —
        # whichever is present. With none of the three, the credential-free
        # path is unavailable and the fallback runs (M3: the message names
        # that cause instead of blaming a fetch that never happened).
        attestation_bundle=""
        attestation_bundle_dir=""
        bundle_fallback_reason=""
        if ! command -v node >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1 && ! command -v jq >/dev/null 2>&1; then
            bundle_fallback_reason="No JSON extractor found (the credential-free bundle path needs node, python3, or jq)"
        else
            _att_json=$(curl -fsSL --connect-timeout 10 --max-time 30 \
                "https://api.github.com/repos/${REPO}/attestations/sha256:${actual_checksum}" 2>/dev/null) || _att_json=""
            if [ -z "$_att_json" ]; then
                bundle_fallback_reason="Could not fetch the attestation bundle from the public API"
            else
                # Private temp dir with the bundle inside (M5): no
                # rename-into-place of a predictable sibling path, and one
                # rm -rf covers every exit. gh requires a .json/.jsonl
                # extension on --bundle files. A mktemp failure degrades to
                # the authenticated fallback, never aborts under set -e.
                attestation_bundle_dir=$(mktemp -d 2>/dev/null) || attestation_bundle_dir=""
                if [ -z "$attestation_bundle_dir" ]; then
                    bundle_fallback_reason="Could not create a temporary directory for the attestation bundle"
                else
                    _att_bundle_file="$attestation_bundle_dir/bundle.jsonl"
                    _att_extract_ok=0
                    if command -v node >/dev/null 2>&1; then
                        if printf '%s' "$_att_json" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  let p;
  try { p = JSON.parse(d); } catch { process.exit(1); }
  const atts = Array.isArray(p.attestations) ? p.attestations : [];
  const lines = atts.map((a) => a && a.bundle).filter(Boolean).map((b) => JSON.stringify(b));
  if (!lines.length) process.exit(1);
  process.stdout.write(lines.join("\n") + "\n");
});
' > "$_att_bundle_file" 2>/dev/null && [ -s "$_att_bundle_file" ]; then
                            _att_extract_ok=1
                        fi
                    elif command -v python3 >/dev/null 2>&1; then
                        if printf '%s' "$_att_json" | python3 -c '
import json, sys
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(1)
atts = p.get("attestations") or []
lines = [json.dumps(a["bundle"], separators=(",", ":")) for a in atts if isinstance(a, dict) and a.get("bundle")]
if not lines:
    sys.exit(1)
sys.stdout.write("\n".join(lines) + "\n")
' > "$_att_bundle_file" 2>/dev/null && [ -s "$_att_bundle_file" ]; then
                            _att_extract_ok=1
                        fi
                    else
                        if printf '%s' "$_att_json" | jq -c '.attestations[]?.bundle | select(. != null)' > "$_att_bundle_file" 2>/dev/null && [ -s "$_att_bundle_file" ]; then
                            _att_extract_ok=1
                        fi
                    fi
                    if [ "$_att_extract_ok" -eq 1 ]; then
                        attestation_bundle="$_att_bundle_file"
                    else
                        bundle_fallback_reason="Could not extract a bundle from the attestations API response"
                        rm -rf "$attestation_bundle_dir"
                        attestation_bundle_dir=""
                    fi
                    unset _att_bundle_file _att_extract_ok
                fi
            fi
            unset _att_json
        fi
        # Capture combined output so we can surface gh's actual error message
        # (auth, network, missing attestation, etc.) on failure instead of a
        # generic "verification failed" with no diagnostic detail.
        # Constrain verification to the exact tag + signing workflow — not
        # just "built by somewhere in this repo". --source-ref pins the
        # git ref the attestation was produced from; --signer-workflow pins
        # the workflow file that signed it. Together they prevent accepting
        # a misattached asset or an attestation from an unrelated workflow.
        gh_status=0
        used_bundle=0
        if [ -n "$attestation_bundle" ]; then
            used_bundle=1
            gh_output=$(gh attestation verify "$tmp_file" \
                --bundle "$attestation_bundle" \
                --repo "$REPO" \
                --source-ref "refs/tags/${latest_tag}" \
                --signer-workflow "backnotprop/plannotator/.github/workflows/release.yml" 2>&1) || gh_status=$?
            if [ "$gh_status" -ne 0 ]; then
                # H1: a --bundle failure is not necessarily a provenance
                # failure (an older gh rejects the flag outright, a corrupted
                # bundle write fails parsing, etc.). Retry once through the
                # exact authenticated path before classifying anything; only
                # the retry's verdict is reported. A real provenance failure
                # fails again here, so nothing bad ever slips through.
                echo "Bundle-based verification did not complete; retrying via gh's authenticated fetch."
                used_bundle=0
                gh_status=0
                gh_output=$(gh attestation verify "$tmp_file" \
                    --repo "$REPO" \
                    --source-ref "refs/tags/${latest_tag}" \
                    --signer-workflow "backnotprop/plannotator/.github/workflows/release.yml" 2>&1) || gh_status=$?
            fi
        else
            echo "${bundle_fallback_reason}; falling back to gh's authenticated fetch."
            gh_output=$(gh attestation verify "$tmp_file" \
                --repo "$REPO" \
                --source-ref "refs/tags/${latest_tag}" \
                --signer-workflow "backnotprop/plannotator/.github/workflows/release.yml" 2>&1) || gh_status=$?
        fi
        if [ -n "$attestation_bundle_dir" ]; then rm -rf "$attestation_bundle_dir"; fi
        if [ "$gh_status" -eq 0 ]; then
            if [ "$used_bundle" -eq 1 ]; then
                echo "✓ verified build provenance (SLSA, credential-free via the public attestations API)"
            else
                echo "✓ verified build provenance (SLSA)"
            fi
        else
            echo "$gh_output" >&2
            # Classification precedence: TUF connectivity first, then auth,
            # then real provenance failure (matches install.cmd).
            case "$gh_output" in
                *"Sigstore verifiers"*)
                    # gh could not initialize the Sigstore trusted root. The
                    # TUF root is fetched on EVERY run (not embedded, not
                    # cached), so this is a connectivity failure, not a
                    # provenance failure — the two mean very different things.
                    echo "Could not initialize the Sigstore trust root (TUF)." >&2
                    echo "Provenance verification needs network access on every run; the trusted" >&2
                    echo "root is fetched per-run, never cached. This is a connectivity failure," >&2
                    echo "NOT evidence of a bad binary. Refusing to install unverified; retry" >&2
                    echo "with network access or pass --skip-attestation." >&2
                    ;;
                *"gh auth login"*)
                    # Only reachable on the authenticated path: the bundle
                    # path was unavailable or did not complete AND gh has no
                    # login to fetch the attestation itself. Environment
                    # problem, not a provenance failure.
                    echo "The credential-free bundle path did not complete and gh is not logged" >&2
                    echo "in, so the authenticated fallback could not run. Retry with network" >&2
                    echo "access to api.github.com, run 'gh auth login', or pass --skip-attestation." >&2
                    ;;
                *)
                    echo "Attestation verification failed!" >&2
                    echo "The binary's SHA256 matched, but no valid signed provenance was found" >&2
                    echo "for ${REPO}. Refusing to install." >&2
                    ;;
            esac
            rm -f "$tmp_file"
            exit 1
        fi
    else
        echo "verifyAttestation is enabled but gh CLI was not found." >&2
        echo "Install https://cli.github.com (no login is needed when the public" >&2
        echo "attestation bundle fetch succeeds), or unset" >&2
        echo "PLANNOTATOR_VERIFY_ATTESTATION / remove verifyAttestation from" >&2
        echo "config.json in your Plannotator data folder (\`plannotator data-dir\`) / pass --skip-attestation." >&2
        rm -f "$tmp_file"
        exit 1
    fi
else
    echo "SHA256 verified. For build provenance verification, see"
    echo "https://docs.plannotator.ai/open-source/start/installation#pin-or-verify-a-release"
fi

# Replace the binary atomically: stage the new file next to the target (same
# directory, so the final mv is a rename(2), never a copy), then rename it over
# the old one. A plannotator process that is running right now keeps its open
# inode and finishes normally, and there is no moment where the path is missing
# or half-written — which is what makes a background auto-update run (#1634)
# safe while other sessions are live. A stale .exe from a Windows-style layout
# is still removed as before.
staged_file="$INSTALL_DIR/.plannotator.new.$$"
if ! mv -f "$tmp_file" "$staged_file"; then
    rm -f "$tmp_file" "$staged_file" 2>/dev/null || true
    echo "Could not stage the new binary in ${INSTALL_DIR}." >&2
    exit 1
fi
chmod +x "$staged_file"
if ! mv -f "$staged_file" "$INSTALL_DIR/plannotator"; then
    rm -f "$staged_file" 2>/dev/null || true
    echo "Could not replace ${INSTALL_DIR}/plannotator." >&2
    exit 1
fi
rm -f "$INSTALL_DIR/plannotator.exe" 2>/dev/null || true

echo ""
echo "plannotator ${latest_tag} installed to ${INSTALL_DIR}/plannotator"

# Print the PATH-setup hint if $INSTALL_DIR isn't already on PATH. Extracted so
# both the normal flow and the --minimal early exit below can reuse it.
print_path_advice() {
    if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
        echo ""
        echo "${INSTALL_DIR} is not in your PATH. Add it with:"
        echo ""

        case "$SHELL" in
            */zsh)  shell_config="~/.zshrc" ;;
            */bash) shell_config="~/.bashrc" ;;
            *)      shell_config="your shell config" ;;
        esac

        echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ${shell_config}"
        echo "  source ${shell_config}"
    fi
    echo ""
    echo "To uninstall later: plannotator uninstall"
}

# Remember the install-affecting choices this run took from COMMAND-LINE flags
# (#1634), so a background auto-update re-runs this script with the same ones:
# someone who installed with --minimal or a --skip-* opt-out must not get a full
# install back on the next update. Only the known flag set is written, as
# neutral ids (never raw argv, paths, or secrets); env vars and config.json
# already survive on their own and are not recorded. A run with none of these
# flags writes an empty set, which is how a manual re-run with no flags goes
# back to defaults. Best effort: a failed write never fails the install.
write_install_flags() {
    _if_list=""
    _if_add() { if [ -z "$_if_list" ]; then _if_list="\"$1\""; else _if_list="$_if_list,\"$1\""; fi; }
    [ "$MINIMAL_FLAG" = "1" ] && _if_add minimal
    [ "$MINIMAL_FLAG" = "0" ] && _if_add no-minimal
    [ "$VERIFY_ATTESTATION_FLAG" = "1" ] && _if_add verify-attestation
    [ "$VERIFY_ATTESTATION_FLAG" = "0" ] && _if_add skip-attestation
    [ "$WITH_CALL_FLOW_FLAG" = "1" ] && _if_add with-call-flow
    [ "$T3_HOOK_FLAG" = "1" ] && _if_add with-t3
    [ "$T3_HOOK_FLAG" = "0" ] && _if_add without-t3
    [ "$SKIP_OPENCODE_FLAG" = "1" ] && _if_add skip-opencode
    [ "$SKIP_SKILLS_FLAG" = "1" ] && _if_add skip-skills
    [ "$SKIP_CLAUDE_PLUGIN_FLAG" = "1" ] && _if_add skip-claude-plugin
    _if_path="$_config_dir/install-flags.json"
    {
        mkdir -p "$_config_dir" &&
        printf '{"v":1,"flags":[%s]}\n' "$_if_list" > "$_if_path.tmp.$$" &&
        mv -f "$_if_path.tmp.$$" "$_if_path"
    } 2>/dev/null || rm -f "$_if_path.tmp.$$" 2>/dev/null || true
}

# Binary-only mode stops here: the binary is installed, so print PATH advice and
# exit before any sidecar download, agent integration, skill checkout, config
# write, cache clear, or cleanup migration runs. No persistent state is written
# outside $INSTALL_DIR except install-flags.json (write_install_flags above),
# which is what lets a later auto-update stay binary-only. See the MINIMAL_FLAG /
# PLANNOTATOR_MINIMAL resolution near the top.
if [ "$minimal" -eq 1 ]; then
    write_install_flags
    print_path_advice
    echo ""
    echo "Minimal install complete — only the plannotator binary was installed."
    echo "No skills, hooks, agent integrations, or config files were written."
    exit 0
fi

# Optional T3 Code hook (only with --with-t3 / --without-t3). A step that
# fails never fails the install, like the Claude Code plugin update: the
# reason is printed with the command to retry, and the install goes on.
if [ "$T3_HOOK_FLAG" -ne -1 ]; then
    _t3_settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
    if [ "$T3_HOOK_FLAG" -eq 1 ]; then
        if PLANNOTATOR_DATA_DIR="$_config_dir" "$INSTALL_DIR/plannotator" t3-hook install --settings "$_t3_settings" --executable "$INSTALL_DIR/plannotator"; then
            echo "T3 authorization is separate: plannotator t3 login --url <T3 MCP URL>"
        else
            echo "T3 Code hook: could not install it (see above); the rest of the install continues. Retry with: plannotator t3-hook install --settings \"$_t3_settings\" --executable \"$INSTALL_DIR/plannotator\"" >&2
        fi
    else
        if ! PLANNOTATOR_DATA_DIR="$_config_dir" "$INSTALL_DIR/plannotator" t3-hook remove --settings "$_t3_settings"; then
            echo "T3 Code hook: could not remove it (see above); the rest of the install continues. Retry with: plannotator t3-hook remove --settings \"$_t3_settings\"" >&2
        fi
    fi
fi

# The sem archives' SHA-256 for SEM_VERSION, pinned here instead of read from
# the release's checksums.txt, which would come over the same connection as
# the archive. Bump them with SEM_VERSION (keep install.ps1 / install.cmd in step).
sem_sha256_for_asset() {
    case "$1" in
        sem-darwin-arm64.tar.gz) echo "a98235ac9f8fae93364ddb7c681036fbe33af756db40e067331ef2091ecc8e6a" ;;
        sem-linux-arm64.tar.gz)  echo "c0d4ccede55e166481358013c397f2772e4d76b72df45d567c45792b8033aec9" ;;
        sem-linux-x86_64.tar.gz) echo "d3476497d8e5648ddb4aa6f82f75ad1a21d0155a5941744c744f464109928707" ;;
        *)                       return 1 ;;
    esac
}

sem_asset_for_platform() {
    case "$platform" in
        darwin-arm64) echo "sem-darwin-arm64.tar.gz" ;;
        linux-arm64)  echo "sem-linux-arm64.tar.gz" ;;
        linux-x64)    echo "sem-linux-x86_64.tar.gz" ;;
        *)            return 1 ;;
    esac
}

install_sem_sidecar() {
    case "${PLANNOTATOR_SKIP_SEM_INSTALL:-}" in
        1|true|yes|TRUE|YES|True|Yes)
            echo "Skipping semantic diff sidecar install (PLANNOTATOR_SKIP_SEM_INSTALL is set)"
            return 0
            ;;
    esac

    sem_asset="$(sem_asset_for_platform 2>/dev/null || true)"
    if [ -z "$sem_asset" ]; then
        echo "Skipping semantic diff sidecar install (sem does not publish ${platform})"
        return 0
    fi

    sem_dir="${_config_dir}/vendor/sem/${SEM_VERSION}"
    sem_bin="${sem_dir}/sem"
    if [ -x "$sem_bin" ] && "$sem_bin" --version 2>/dev/null | grep -q '^sem '; then
        echo "Semantic diff sidecar already installed at ${sem_bin}"
        return 0
    fi

    tmp_sem_dir="$(mktemp -d)"
    sem_archive="${tmp_sem_dir}/${sem_asset}"
    sem_base_url="https://github.com/${SEM_REPO}/releases/download/${SEM_VERSION}"

    # Bounded so a slow/hung download of this optional sidecar can't wedge an
    # install where plannotator itself already landed. On timeout curl fails and
    # we skip gracefully. Opt out entirely with PLANNOTATOR_SKIP_SEM_INSTALL=1.
    if ! curl -fsSL --connect-timeout 10 --max-time 120 -o "$sem_archive" "${sem_base_url}/${sem_asset}"; then
        echo "Skipping semantic diff sidecar install (download failed)"
        rm -rf "$tmp_sem_dir"
        return 0
    fi

    expected_sem_checksum="$(sem_sha256_for_asset "$sem_asset" 2>/dev/null || true)"
    if [ -z "$expected_sem_checksum" ]; then
        echo "Skipping semantic diff sidecar install (checksum missing for ${sem_asset})"
        rm -rf "$tmp_sem_dir"
        return 0
    fi

    if [ "$(uname -s)" = "Darwin" ]; then
        actual_sem_checksum="$(shasum -a 256 "$sem_archive" | cut -d' ' -f1)"
    else
        actual_sem_checksum="$(sha256sum "$sem_archive" | cut -d' ' -f1)"
    fi

    if [ "$actual_sem_checksum" != "$expected_sem_checksum" ]; then
        echo "Skipping semantic diff sidecar install (checksum mismatch)"
        rm -rf "$tmp_sem_dir"
        return 0
    fi

    if ! tar -xzf "$sem_archive" -C "$tmp_sem_dir"; then
        echo "Skipping semantic diff sidecar install (extract failed)"
        rm -rf "$tmp_sem_dir"
        return 0
    fi

    extracted_sem="$(find "$tmp_sem_dir" -type f -name sem -print -quit)"
    if [ -z "$extracted_sem" ]; then
        echo "Skipping semantic diff sidecar install (binary missing from archive)"
        rm -rf "$tmp_sem_dir"
        return 0
    fi

    if ! mkdir -p "$sem_dir"; then
        echo "Skipping semantic diff sidecar install (directory creation failed)"
        rm -rf "$tmp_sem_dir"
        return 0
    fi
    if ! cp "$extracted_sem" "$sem_bin"; then
        echo "Skipping semantic diff sidecar install (copy failed)"
        rm -rf "$tmp_sem_dir"
        return 0
    fi
    if ! chmod +x "$sem_bin"; then
        echo "Skipping semantic diff sidecar install (chmod failed)"
        rm -f "$sem_bin"
        rm -rf "$tmp_sem_dir"
        return 0
    fi
    rm -rf "$tmp_sem_dir"
    echo "Semantic diff sidecar installed to ${sem_bin}"
}

install_agent_terminal_runtime() {
    case "${PLANNOTATOR_SKIP_AGENT_TERMINAL_INSTALL:-}" in
        1|true|yes|TRUE|YES|True|Yes)
            echo "Skipping agent terminal runtime install (PLANNOTATOR_SKIP_AGENT_TERMINAL_INSTALL is set)"
            return 0
            ;;
    esac

    if ! "$INSTALL_DIR/plannotator" install-runtime agent-terminal; then
        echo "Skipping agent terminal runtime install (plannotator install-runtime failed)"
    fi
}

# Strictly opt-in: Call flow is off by default, so a default install never
# downloads even its pruned core. Review-specific packs install in-app.
install_call_flow_runtime() {
    if [ "$install_call_flow" -ne 1 ]; then
        echo "Call-flow analysis: available as an in-app opt-in install (enable Call flow in review Settings), or run: plannotator install-runtime call-flow"
        return 0
    fi

    if ! "$INSTALL_DIR/plannotator" install-runtime call-flow; then
        echo "Call-flow runtime install failed; it remains available as an in-app opt-in install"
    fi
}

install_sem_sidecar
install_agent_terminal_runtime
install_call_flow_runtime

print_path_advice

# Claude Code plugin: repair the marketplace clone, never rewrite it.
#
# ${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/marketplaces/plannotator is Claude
# Code's own git clone of this repository; installing or updating the plugin
# copies apps/hook from it into the plugin cache. Installers used to overwrite
# its apps/hook/hooks/hooks.json with a hard-coded copy (added in #230 to fix
# a stale 1800s timeout, extended in #267 to pin the Windows exe path). That
# copy drifted from the repo file twice: #689 found it dropping the
# EnterPlanMode hook, and it later dropped "modules" (the Claude Code mod).
# The clone's own file is the source of truth, so nothing writes it now.
#
# An earlier installer's rewrite can still be sitting in the clone as a local
# edit, and a plugin installed or updated from it loses the mod. Restore the
# file from the clone's HEAD, but only when it differs from HEAD AND its
# content (whitespace removed) is exactly one of the shapes those installers
# wrote, so a user's own edit is never discarded. Needs git; without it this
# is a no-op. install.ps1 / install.cmd carry the same pattern as a .NET
# regex (keep the three in step).
PLUGIN_MARKETPLACE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/plannotator"
PLUGIN_HOOKS="$PLUGIN_MARKETPLACE_DIR/apps/hook/hooks/hooks.json"
LEGACY_PLUGIN_HOOKS_RE='^\{"hooks":\{("PreToolUse":\[\{"matcher":"EnterPlanMode","hooks":\[\{"type":"command","command":"(\\")?[^"\\]*plannotator(\.exe)?(\\")?improve-context","timeout":5\}\]\}\],)?"PermissionRequest":\[\{"matcher":"ExitPlanMode","hooks":\[\{"type":"command","command":"(\\")?[^"\\]*plannotator(\.exe)?(\\")?","timeout":345600\}\]\}\]\}\}$'

repair_legacy_plugin_hooks() {
    _clone="$1"
    _rel="apps/hook/hooks/hooks.json"
    [ -f "$_clone/$_rel" ] || return 0
    command -v git >/dev/null 2>&1 || return 0
    # Only a git clone that tracks the file...
    git -C "$_clone" cat-file -e "HEAD:$_rel" 2>/dev/null || return 0
    # ...and only while it differs from HEAD (exit 1; 0 is clean, >1 an error).
    _diff_rc=0
    git -C "$_clone" diff --quiet HEAD -- "$_rel" 2>/dev/null || _diff_rc=$?
    [ "$_diff_rc" -eq 1 ] || return 0
    _compact=$(tr -d ' \t\r\n' < "$_clone/$_rel" 2>/dev/null) || return 0
    printf '%s' "$_compact" | grep -Eq "$LEGACY_PLUGIN_HOOKS_RE" || return 0
    if git -C "$_clone" checkout -q -- "$_rel" 2>/dev/null; then
        echo "Restored ${_clone}/${_rel} from its git checkout (an earlier installer had rewritten it)."
    fi
}
repair_legacy_plugin_hooks "$PLUGIN_MARKETPLACE_DIR" || true

# Claude Code plugin: update it when it is already installed.
#
# The plugin comes from a GitHub marketplace, which Claude Code does not
# auto-update by default, so a binary update used to leave an old plugin behind
# (without the mod's Inbox connection and every mod fix since). When the claude
# CLI is on PATH and plannotator@plannotator is in Claude Code's plugin registry
# (${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/installed_plugins.json, at user
# scope), run the two commands this script used to only print. This runs after
# the repair above, so a repaired clone is what gets copied. It never installs
# the plugin, never touches another marketplace or plugin, never prompts (stdin
# is /dev/null), and never fails the install: each command is time-bounded and
# a failure prints the manual commands. Opt out with --skip-claude-plugin,
# PLANNOTATOR_SKIP_CLAUDE_PLUGIN_UPDATE=1 or skipInstall.claudePlugin; --minimal
# exits before this. install.ps1 / install.cmd carry the same steps.
CLAUDE_PLUGIN_ID="plannotator@plannotator"
CLAUDE_PLUGIN_REGISTRY="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"
# none | manual (installed, no claude CLI) | skipped | updated | current | failed
# | no-marketplace (the plannotator marketplace is gone; re-add it)
claude_plugin_state="none"
claude_plugin_version=""
# The installed plugin's version before this run (for notify_claude_plugin_reload).
claude_plugin_from_version=""

# The registry value for plannotator@plannotator (a JSON array of per-scope
# install records; an object in the older v1 file), or nothing.
claude_plugin_registry_entry() {
    [ -f "$CLAUDE_PLUGIN_REGISTRY" ] || return 0
    awk -v key="\"$CLAUDE_PLUGIN_ID\"" '
        { buf = buf $0 "\n" }
        END {
            pos = 1
            while (1) {
                i = index(substr(buf, pos), key)
                if (i == 0) exit
                i = pos + i - 1
                rest = substr(buf, i + length(key))
                if (match(rest, /^[ \t\r\n]*:[ \t\r\n]*[[{]/) != 0) {
                    rest = substr(rest, RLENGTH)
                    depth = 0; instr = 0; esc = 0
                    n = length(rest)
                    for (j = 1; j <= n; j++) {
                        c = substr(rest, j, 1)
                        if (instr) {
                            if (esc) esc = 0
                            else if (c == "\\") esc = 1
                            else if (c == "\"") instr = 0
                            continue
                        }
                        if (c == "\"") instr = 1
                        else if (c == "[" || c == "{") depth++
                        else if (c == "]" || c == "}") {
                            depth--
                            if (depth == 0) { print substr(rest, 1, j); exit }
                        }
                    }
                    exit
                }
                pos = i + length(key)
            }
        }' "$CLAUDE_PLUGIN_REGISTRY" 2>/dev/null || true
}

# The user-scope install record (flat JSON object text), or nothing. A record
# without a "scope" field (the v1 registry) counts as the user install. A
# project- or local-scope-only install is left alone, because `claude plugin
# update` works on the user scope by default.
claude_plugin_user_record() {
    _cp_entry=$(claude_plugin_registry_entry | tr -d '\r\n')
    [ -n "$(printf '%s' "$_cp_entry" | tr -d ' \t[]{}')" ] || return 0
    if printf '%s' "$_cp_entry" | grep -q '"scope"[[:space:]]*:'; then
        printf '%s' "$_cp_entry" | tr '}' '\n' |
            grep '"scope"[[:space:]]*:[[:space:]]*"user"' | head -n 1
    else
        printf '%s\n' "$_cp_entry"
    fi
}

# One string field of an install record.
claude_plugin_field() {
    printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 |
        sed 's/.*"\([^"]*\)"$/\1/'
}

# Run a command with a time limit in plain shell (macOS has no timeout(1)).
# $1 is the limit in seconds, $2 a path the watchdog creates on a timeout (in
# a private mktemp directory), the rest the command. Returns the command's
# status, or 124 when it ran out of time and was stopped.
run_with_time_limit() {
    _rtl_secs="$1"
    _rtl_flag="$2"
    shift 2
    rm -f "$_rtl_flag" 2>/dev/null || true
    "$@" </dev/null &
    _rtl_pid=$!
    # The watchdog sleeps in the background and waits for it, so stopping the
    # watchdog (TERM, below) runs its trap at once: the trap stops the sleep
    # and exits before anything is flagged or killed.
    (
        _rtl_sleep=""
        trap '[ -n "$_rtl_sleep" ] && kill "$_rtl_sleep" 2>/dev/null; exit 0' TERM
        sleep "$_rtl_secs" &
        _rtl_sleep=$!
        wait "$_rtl_sleep"
        : > "$_rtl_flag"
        kill -TERM "$_rtl_pid" 2>/dev/null
        sleep 5 &
        _rtl_sleep=$!
        wait "$_rtl_sleep"
        kill -KILL "$_rtl_pid" 2>/dev/null
    ) >/dev/null 2>&1 </dev/null &
    _rtl_dog=$!
    _rtl_rc=0
    wait "$_rtl_pid" || _rtl_rc=$?
    kill -TERM "$_rtl_dog" 2>/dev/null || true
    wait "$_rtl_dog" 2>/dev/null || true
    if [ -f "$_rtl_flag" ]; then
        return 124
    fi
    return "$_rtl_rc"
}

# --scope user always: `claude plugin update` auto-detects the scope on current
# Claude Code, and from inside a project with a project-scope install it would
# update that record and leave the user install old.
print_claude_plugin_manual_update() {
    echo "  claude plugin marketplace update plannotator"
    echo "  claude plugin update ${CLAUDE_PLUGIN_ID} --scope user"
}

print_claude_plugin_marketplace_readd() {
    echo "  claude plugin marketplace add backnotprop/plannotator"
    echo "  claude plugin update ${CLAUDE_PLUGIN_ID} --scope user"
}

# The claude CLI: on PATH, else in Claude Code's own install folders (its
# native installer's ~/.local/bin, the older ~/.claude/local), the folders the
# Inbox's launcher also looks in. An update the Inbox or a review window starts
# runs with that process's PATH, which often lacks ~/.local/bin (an Inbox
# started outside a login shell), and the plugin was then never updated.
find_claude_cli() {
    command -v claude 2>/dev/null && return 0
    for _fc_dir in "$HOME/.local/bin" "$HOME/.claude/local"; do
        if [ -f "$_fc_dir/claude" ] && [ -x "$_fc_dir/claude" ]; then
            printf '%s\n' "$_fc_dir/claude"
            return 0
        fi
    done
    return 1
}

update_claude_plugin_if_installed() {
    _cp_record=$(claude_plugin_user_record)
    [ -n "$_cp_record" ] || return 0
    claude_plugin_from_version=$(claude_plugin_field "$_cp_record" version)
    _cp_claude=$(find_claude_cli) || _cp_claude=""
    if [ -z "$_cp_claude" ]; then
        claude_plugin_state="manual"
        return 0
    fi
    if [ "$skip_claude_plugin" -eq 1 ]; then
        claude_plugin_state="skipped"
        echo "Claude Code plugin: not updated (${skip_claude_plugin_source})."
        return 0
    fi
    # A pinned install (--version naming a tag) keeps the plugin it has: the
    # plugin update always installs the newest plugin, which would not match
    # an older binary. Background auto-update passes the newest release it
    # just resolved as --version and exports the same tag as
    # PLANNOTATOR_UPDATE_VERSION, so that run is not pinned. No network call.
    if [ "$VERSION_EXPLICIT" -eq 1 ] && [ "${PLANNOTATOR_UPDATE_VERSION:-}" != "$latest_tag" ]; then
        claude_plugin_state="skipped"
        echo "Claude Code plugin: not updated: pinned to ${latest_tag}; updating would install the newest plugin."
        return 0
    fi
    # Seconds per command. Internal knob for the tests. Claude Code stops its
    # own git clone or fetch of the marketplace after 120 s unless
    # CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS says otherwise, which failed updates on
    # slow links: the commands get 10 minutes for git (a value the person set
    # is kept), and 11 for the whole command.
    _cp_secs="${PLANNOTATOR_CLAUDE_PLUGIN_TIMEOUT:-660}"
    case "$_cp_secs" in ''|*[!0-9]*|0) _cp_secs=660 ;; esac
    _cp_git_ms="${CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS:-600000}"
    # One private directory for claude's output and the timeout marker.
    _cp_tmp=$(mktemp -d "${TMPDIR:-/tmp}/plannotator-claude-plugin.XXXXXX" 2>/dev/null) || _cp_tmp=""
    if [ -z "$_cp_tmp" ] || [ ! -d "$_cp_tmp" ]; then
        claude_plugin_state="failed"
        echo "Claude Code plugin: could not update it (no temporary directory). Run these, then restart Claude Code:"
        print_claude_plugin_manual_update
        return 0
    fi
    _cp_log="$_cp_tmp/claude.log"
    _cp_before="$(claude_plugin_field "$_cp_record" version)|$(claude_plugin_field "$_cp_record" gitCommitSha)|$(claude_plugin_field "$_cp_record" installPath)"
    # CLAUDECODE is cleared for these commands: an auto-update started from a
    # Claude Code session inherits it, and it marks a nested Claude Code.
    echo "Updating the Claude Code plugin..."
    _cp_failed=""
    _cp_missing=0
    for _cp_step in marketplace plugin; do
        _cp_rc=0
        if [ "$_cp_step" = "marketplace" ]; then
            run_with_time_limit "$_cp_secs" "$_cp_tmp/timed-out" env -u CLAUDECODE CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS="$_cp_git_ms" "$_cp_claude" plugin marketplace update plannotator >"$_cp_log" 2>&1 || _cp_rc=$?
        else
            run_with_time_limit "$_cp_secs" "$_cp_tmp/timed-out" env -u CLAUDECODE CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS="$_cp_git_ms" "$_cp_claude" plugin update "$CLAUDE_PLUGIN_ID" --scope user >"$_cp_log" 2>&1 || _cp_rc=$?
        fi
        if [ "$_cp_rc" -eq 124 ]; then
            _cp_failed="timed out after ${_cp_secs}s"
        elif [ "$_cp_rc" -ne 0 ]; then
            # The plannotator marketplace itself is gone (removed by hand):
            # updating cannot work, re-adding it does.
            if grep -i 'marketplace' "$_cp_log" 2>/dev/null | grep -Eqi 'not found|not exist|no such|unknown'; then
                _cp_missing=1
            fi
            _cp_last=$(tr -cd '[:print:]\n' < "$_cp_log" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1 | cut -c 1-200)
            _cp_failed="claude exited ${_cp_rc}${_cp_last:+: ${_cp_last}}"
        fi
        [ -z "$_cp_failed" ] || break
    done
    rm -rf "$_cp_tmp" 2>/dev/null || true
    if [ "$_cp_missing" -eq 1 ]; then
        claude_plugin_state="no-marketplace"
        echo "Claude Code plugin: could not update it (the plannotator marketplace is not registered). Re-add it, then restart Claude Code:"
        print_claude_plugin_marketplace_readd
        return 0
    fi
    if [ -n "$_cp_failed" ]; then
        claude_plugin_state="failed"
        echo "Claude Code plugin: could not update it (${_cp_failed}). Run these, then restart Claude Code:"
        print_claude_plugin_manual_update
        return 0
    fi
    _cp_record=$(claude_plugin_user_record)
    claude_plugin_version=$(claude_plugin_field "$_cp_record" version)
    _cp_after="${claude_plugin_version}|$(claude_plugin_field "$_cp_record" gitCommitSha)|$(claude_plugin_field "$_cp_record" installPath)"
    if [ "$_cp_after" = "||" ] || [ "$_cp_before" != "$_cp_after" ]; then
        claude_plugin_state="updated"
        echo "Claude Code plugin: updated${claude_plugin_version:+ to ${claude_plugin_version}} (restart Claude Code to load it)."
    else
        claude_plugin_state="current"
        echo "Claude Code plugin: already up to date${claude_plugin_version:+ (${claude_plugin_version})}."
    fi
}
update_claude_plugin_if_installed || true

# OpenCode 2 runs as a background service that keeps the plugin it loaded.
# When that service is running, ask it for the new plugin now:
# `opencode2 plugin update <spec>` loads it without stopping a running turn, a
# pending permission or question, or an open Plannotator review (measured on
# OpenCode 2.0.22; `opencode2 reload` would cancel the permission and the
# question). The step only asks the service: it writes nothing itself, and
# any failure (no service, a hang, an exit code, the old version still
# loaded) leaves the install as it was and prints the command to run.
#   - Only when `opencode2` is on PATH, the run is not pinned (the same rule as
#     the Claude Code plugin above), `opencode2 service status` prints a URL,
#     and `opencode2 plugin list` has a `plannotator` row whose SOURCE is
#     `@plannotator/opencode` or `@plannotator/opencode@latest`. A pinned spec
#     (`@plannotator/opencode@0.28.31`) is left alone.
#   - Every opencode2 call has a time limit, stdin from /dev/null, and its
#     exit code checked.
#   - A broken download or a registry that is down still exits 0 with the old
#     plugin active, so the result is read back from `plugin list`, never
#     trusted from the exit code.
#   - It runs BEFORE the cache clearing below, and the OpenCode 2 cache is
#     kept while the service has the plugin: with that entry gone the service
#     answers "No plugin updates available", and the Inbox would read the
#     loaded generation as deleted.
# PLANNOTATOR_OPENCODE2_TIMEOUT (seconds for the update) and
# PLANNOTATOR_OPENCODE2_WAIT (seconds to wait for the plugin to show in
# `plugin list`, before and after the update) are internal knobs for the tests.
opencode2_service_has_plugin=0
oc2_version_at_least() {
    awk -v a="$1" -v b="$2" 'BEGIN {
        if (a !~ /^v?[0-9]+\.[0-9]+\.[0-9]+/ || b !~ /^v?[0-9]+\.[0-9]+\.[0-9]+/) exit 1
        sub(/^v/, "", a); sub(/^v/, "", b); sub(/[-+].*/, "", a); sub(/[-+].*/, "", b)
        split(a, x, "."); split(b, y, ".")
        for (i = 1; i <= 3; i++) { p = x[i] + 0; q = y[i] + 0; if (p > q) exit 0; if (p < q) exit 1 }
        exit 0
    }'
}
# "<version> <source>" of the plannotator row of `opencode2 plugin list`, run
# from $HOME. `plugin list` answers for the folder it runs in, and a folder
# the service has not opened yet answers "No plugins found" for about a
# second, so it asks again, once a second, up to $2 more times. A call that
# runs out of time stops the asking. $1 is the private temp directory; the
# time limit per call is $_oc_short (set by the caller).
opencode2_plannotator_row() {
    _ocr_tmp="$1"
    _ocr_left="$2"
    while :; do
        _ocr_rc=0
        (cd "$HOME" && run_with_time_limit "$_oc_short" "$_ocr_tmp/list-timed-out" opencode2 plugin list) >"$_ocr_tmp/list.out" 2>&1 || _ocr_rc=$?
        [ "$_ocr_rc" -eq 124 ] && return 1
        _ocr_row=$(tr -d '\r' < "$_ocr_tmp/list.out" 2>/dev/null | awk '$1 == "plannotator" { print $2 " " $3; exit }')
        if [ "$_ocr_rc" -eq 0 ] && [ -n "$_ocr_row" ]; then
            printf '%s\n' "$_ocr_row"
            return 0
        fi
        [ "$_ocr_left" -gt 0 ] || return 1
        _ocr_left=$((_ocr_left - 1))
        sleep 1
    done
}
update_opencode2_service_plugin() {
    command -v opencode2 >/dev/null 2>&1 || return 0
    if [ "$VERSION_EXPLICIT" -eq 1 ] && [ "${PLANNOTATOR_UPDATE_VERSION:-}" != "$latest_tag" ]; then
        return 0
    fi
    _oc_want="${latest_tag#v}"
    oc2_version_at_least "$_oc_want" "0.0.0" || return 0
    _oc_secs="${PLANNOTATOR_OPENCODE2_TIMEOUT:-90}"
    case "$_oc_secs" in ''|*[!0-9]*|0) _oc_secs=90 ;; esac
    _oc_wait="${PLANNOTATOR_OPENCODE2_WAIT:-15}"
    case "$_oc_wait" in ''|*[!0-9]*) _oc_wait=15 ;; esac
    # `service status` and `plugin list` answer at once; 15 s is a hang.
    _oc_short=15
    if [ "$_oc_secs" -lt "$_oc_short" ]; then
        _oc_short="$_oc_secs"
    fi
    _oc_tmp=$(mktemp -d "${TMPDIR:-/tmp}/plannotator-opencode2.XXXXXX" 2>/dev/null) || _oc_tmp=""
    if [ -z "$_oc_tmp" ] || [ ! -d "$_oc_tmp" ]; then
        return 0
    fi
    _oc_rc=0
    (cd "$HOME" && run_with_time_limit "$_oc_short" "$_oc_tmp/status-timed-out" opencode2 service status) >"$_oc_tmp/status.out" 2>&1 || _oc_rc=$?
    if [ "$_oc_rc" -ne 0 ] || ! grep -Eq '^[[:space:]]*https?://' "$_oc_tmp/status.out" 2>/dev/null; then
        # Not running (or no answer): the next start loads the newest plugin.
        rm -rf "$_oc_tmp" 2>/dev/null || true
        return 0
    fi
    _oc_row=$(opencode2_plannotator_row "$_oc_tmp" "$_oc_wait") || _oc_row=""
    if [ -z "$_oc_row" ]; then
        rm -rf "$_oc_tmp" 2>/dev/null || true
        return 0
    fi
    _oc_have="${_oc_row%% *}"
    _oc_spec="${_oc_row#* }"
    case "$_oc_spec" in
        @plannotator/opencode|@plannotator/opencode@latest) ;;
        @plannotator/opencode@[0-9]*.[0-9]*.[0-9]*|@plannotator/opencode@v[0-9]*.[0-9]*.[0-9]*)
            opencode2_service_has_plugin=1
            rm -rf "$_oc_tmp" 2>/dev/null || true
            echo "OpenCode 2: the Plannotator plugin is pinned to ${_oc_spec#@plannotator/opencode@}; left as it is."
            return 0
            ;;
        *)
            rm -rf "$_oc_tmp" 2>/dev/null || true
            return 0
            ;;
    esac
    opencode2_service_has_plugin=1
    if oc2_version_at_least "$_oc_have" "$_oc_want"; then
        rm -rf "$_oc_tmp" 2>/dev/null || true
        echo "OpenCode 2: the running service already uses Plannotator ${_oc_have}."
        return 0
    fi
    echo "Updating the Plannotator plugin in the running OpenCode 2 service..."
    _oc_rc=0
    (cd "$HOME" && run_with_time_limit "$_oc_secs" "$_oc_tmp/update-timed-out" opencode2 plugin update "$_oc_spec") >"$_oc_tmp/update.out" 2>&1 || _oc_rc=$?
    _oc_failed=""
    if [ "$_oc_rc" -eq 124 ]; then
        _oc_failed="timed out after ${_oc_secs}s"
    elif [ "$_oc_rc" -ne 0 ]; then
        _oc_last=$(tr -cd '[:print:]\n' < "$_oc_tmp/update.out" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1 | cut -c 1-200)
        _oc_failed="opencode2 exited ${_oc_rc}${_oc_last:+: ${_oc_last}}"
    fi
    _oc_now="$_oc_have"
    if [ -z "$_oc_failed" ]; then
        # The service loads the new plugin a moment after the update returns.
        _oc_left="$_oc_wait"
        while :; do
            _oc_row=$(opencode2_plannotator_row "$_oc_tmp" 0) || _oc_row=""
            if [ -n "$_oc_row" ]; then
                _oc_now="${_oc_row%% *}"
            fi
            if oc2_version_at_least "$_oc_now" "$_oc_want"; then
                break
            fi
            [ "$_oc_left" -gt 0 ] || break
            _oc_left=$((_oc_left - 1))
            sleep 1
        done
    fi
    rm -rf "$_oc_tmp" 2>/dev/null || true
    if [ -z "$_oc_failed" ] && oc2_version_at_least "$_oc_now" "$_oc_want"; then
        echo "OpenCode 2: the running service now uses Plannotator ${_oc_now}. Nothing was restarted."
        return 0
    fi
    # `models` first waits for the plugin in a folder the service has not
    # opened yet, where `plugin update` alone can fail (the Inbox's command).
    # A plugin that failed to load is listed as "-".
    if oc2_version_at_least "$_oc_now" "0.0.0"; then
        _oc_state="still uses Plannotator ${_oc_now}"
    else
        _oc_state="has not loaded Plannotator ${_oc_want}"
    fi
    echo "OpenCode 2: the running service ${_oc_state}${_oc_failed:+ (${_oc_failed})}. To load ${_oc_want}, run: opencode2 models && opencode2 plugin update ${_oc_spec}"
}
if [ "$skip_opencode" -eq 0 ]; then
    update_opencode2_service_plugin || true
fi

# Clear any cached OpenCode plugin to force fresh download on next run.
# Both OpenCode generations root their cache at ${XDG_CACHE_HOME:-~/.cache}/opencode:
#   OpenCode 1: node_modules/@plannotator and packages/@plannotator
#   OpenCode 2: npm/<name>@<spec>/<generation>/ (packages/util/src/npm.ts),
#               so our plugin is npm/@plannotator/opencode@<spec>
#               (opencode@latest for the documented config entry).
# Only our own package's entries are removed. An OpenCode opt-out (#1178)
# leaves OpenCode's own cache directory alone; the Bun package cache is a
# shared cache, not OpenCode's home, and is always cleared.
if [ "$skip_opencode" -eq 0 ]; then
    OPENCODE_CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/opencode"
    rm -rf "$OPENCODE_CACHE_DIR/node_modules/@plannotator" "$OPENCODE_CACHE_DIR/packages/@plannotator" 2>/dev/null || true
    # A running OpenCode 2 service that has the plugin was asked above and keeps its cache.
    if [ "$opencode2_service_has_plugin" -eq 0 ]; then
        for _oc_entry in "$OPENCODE_CACHE_DIR"/npm/@plannotator/opencode@*; do
            [ -e "$_oc_entry" ] || [ -L "$_oc_entry" ] || continue
            rm -rf "$_oc_entry" 2>/dev/null || true
        done
    fi
    # The scope directory goes only when nothing else is left in it.
    rmdir "$OPENCODE_CACHE_DIR/npm/@plannotator" 2>/dev/null || true
fi
rm -rf "$HOME/.bun/install/cache/@plannotator" 2>/dev/null || true

# Clear Pi jiti cache to force fresh download on next run
rm -rf /tmp/jiti 2>/dev/null || true

# Pi extension (#902). `pi install npm:@plannotator/pi-extension` runs a bare
# `npm install @plannotator/pi-extension` in <agent dir>/npm. npm may settle on
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
# when Pi's settings list the extension. Same logic in install.ps1 and
# install.cmd's :UpdatePiExtension.
PI_EXTENSION_SOURCE="npm:@plannotator/pi-extension"

# Pi's agent dir: $PI_CODING_AGENT_DIR (~ expanded, as Pi does), else ~/.pi/agent.
pi_agent_dir() {
    case "${PI_CODING_AGENT_DIR:-}" in
        "") printf '%s\n' "$HOME/.pi/agent" ;;
        "~") printf '%s\n' "$HOME" ;;
        "~/"*) printf '%s\n' "$HOME/${PI_CODING_AGENT_DIR#\~/}" ;;
        *) printf '%s\n' "$PI_CODING_AGENT_DIR" ;;
    esac
}

# How Pi's user settings list the extension: "none", "unpinned", or
# "pinned:<version>" for an exact version (what `pi update` skips).
pi_extension_configured() {
    _pi_settings="$(pi_agent_dir)/settings.json"
    if [ ! -f "$_pi_settings" ] || ! grep -Eq '"npm:@plannotator/pi-extension(@[^"]*)?"' "$_pi_settings" 2>/dev/null; then
        echo "none"
        return 0
    fi
    _pi_pin=$(sed -n 's/.*"npm:@plannotator\/pi-extension@v\{0,1\}\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9A-Za-z.+-]*\)".*/\1/p' "$_pi_settings" 2>/dev/null | head -n 1)
    if [ -n "$_pi_pin" ]; then
        echo "pinned:$_pi_pin"
    else
        echo "unpinned"
    fi
}

# The installed extension's version, read where Pi loads it from: the managed
# <agent dir>/npm/node_modules copy when it exists, else the global npm root
# (where older Pi installed user packages). Empty when it can't be read.
pi_extension_installed_version() {
    _pi_pkg="$(pi_agent_dir)/npm/node_modules/@plannotator/pi-extension"
    if [ ! -d "$_pi_pkg" ]; then
        _pi_pkg=""
        if command -v npm >/dev/null 2>&1; then
            _pi_root=$(npm root -g 2>/dev/null | head -n 1)
            if [ -n "$_pi_root" ]; then
                _pi_pkg="$_pi_root/@plannotator/pi-extension"
            fi
        fi
    fi
    [ -n "$_pi_pkg" ] && [ -f "$_pi_pkg/package.json" ] || return 0
    sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_pi_pkg/package.json" 2>/dev/null | head -n 1
}

# Whether version $1 is at least $2 (major.minor.patch; any suffix ignored).
pi_version_at_least() {
    awk -v a="$1" -v b="$2" 'BEGIN {
        sub(/^v/, "", a); sub(/^v/, "", b); sub(/[-+].*/, "", a); sub(/[-+].*/, "", b)
        split(a, x, "."); split(b, y, ".")
        for (i = 1; i <= 3; i++) { p = x[i] + 0; q = y[i] + 0; if (p > q) exit 0; if (p < q) exit 1 }
        exit 0
    }'
}

update_pi_extension_if_present() {
    if ! command -v pi &>/dev/null; then
        return 0
    fi

    _pi_target="${latest_tag#v}"
    _pi_state=$(pi_extension_configured)
    _pi_fresh=0
    case "$_pi_state" in
        none)
            _pi_fresh=1
            echo "Installing Pi extension..."
            if ! pi install "$PI_EXTENSION_SOURCE"; then
                echo "Skipping Pi extension install (pi install failed)"
                return 0
            fi
            _pi_before=$(pi_extension_installed_version)
            if [ -z "$_pi_before" ] || ! pi_version_at_least "$_pi_before" "$_pi_target"; then
                # npm settled on an older version (or it can't be read): Pi's
                # own update asks for the newest one by name.
                pi update "$PI_EXTENSION_SOURCE" || true
            fi
            ;;
        pinned:*)
            echo "Pi extension: pinned to ${_pi_state#pinned:} in Pi's settings, left as is. To move it: pi install ${PI_EXTENSION_SOURCE}@${_pi_target}"
            return 0
            ;;
        *)
            echo "Updating Pi extension..."
            _pi_before=$(pi_extension_installed_version)
            if ! pi update "$PI_EXTENSION_SOURCE"; then
                # The update failed, or this Pi's update takes no source: the
                # install command, as before. Neither removes anything first.
                pi install "$PI_EXTENSION_SOURCE" || true
            fi
            ;;
    esac

    _pi_after=$(pi_extension_installed_version)
    if [ -z "$_pi_after" ]; then
        echo "Pi extension: could not read its installed version. To update it: pi update ${PI_EXTENSION_SOURCE}"
    elif ! pi_version_at_least "$_pi_after" "$_pi_target"; then
        # The one cause visible from here: the registry npm uses does not
        # have this release yet (a mirror catching up, or npm not published).
        _pi_view=""
        if command -v npm >/dev/null 2>&1; then
            _pi_view=$(npm view "@plannotator/pi-extension@${_pi_target}" version --fetch-timeout=10000 --fetch-retries=0 2>&1 || true)
        fi
        case "$_pi_view" in
            *E404*) echo "Pi extension: still ${_pi_after} (${_pi_target} is not on your npm registry yet). Run this later: pi update ${PI_EXTENSION_SOURCE}" ;;
            *) echo "Pi extension: still ${_pi_after} (this release is ${_pi_target}). To update it: pi update ${PI_EXTENSION_SOURCE}" ;;
        esac
    elif [ "$_pi_fresh" -eq 1 ]; then
        echo "Pi extension installed (${_pi_after})."
    elif [ "$_pi_before" = "$_pi_after" ]; then
        echo "Pi extension already up to date (${_pi_after})."
    else
        echo "Pi extension updated to ${_pi_after}."
    fi
}

# --- Aggressive cleanup of skills/commands we no longer manage ---
# Echo each removal; ignore missing entries.

# NOTE: legacy Claude command cleanup happens AFTER the skill install below —
# a command file is only removed once its replacement skill is on disk, so a
# failed or skipped skill install never leaves users with neither.

# Old installers (pre core/extra split) ran `cp -r apps/skills/*` against a
# new-layout tag and could leave junk `core`/`extra` directory copies in the
# Claude skills scope. Never valid skill names — always safe to remove.
for junk in core extra; do
    if [ -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/$junk" ]; then
        rm -rf "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/$junk"
        echo "Removed stale layout directory ~/.claude/skills/$junk (left by an older installer)"
    fi
done

# Extras are no longer installed by this script. Remove
# previously default-installed copies ONCE per machine — recorded in the
# migrations ledger under the Plannotator data dir — because copies the user
# reinstalls via `npx skills add` are byte-identical to ours and can only be
# told apart by remembering that this cleanup already ran.
CLAUDE_SKILLS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"
MIGRATIONS_DIR="$_config_dir/migrations"
EXTRAS_MIGRATION="$MIGRATIONS_DIR/2026-06-extras-default-install-removed"
if [ ! -f "$EXTRAS_MIGRATION" ]; then
    for scope in "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"; do
        for skill in plannotator-compound plannotator-setup-goal plannotator-visual-explainer; do
            if [ -d "$scope/$skill" ]; then
                rm -rf "$scope/$skill"
                echo "Removed extra Plannotator skill from ${scope}/$skill (reinstall via npx skills add)"
            fi
        done
    done
    mkdir -p "$MIGRATIONS_DIR"
    : > "$EXTRAS_MIGRATION"
fi

# --- Guided install (interactive terminals only) ---
# Two questions: install the extra skills? make any skills callable by the
# model? Answers persist to $PREFS_FILE and are reused silently on re-runs.
# --reconfigure re-opens the wizard; --non-interactive forces silence; piped
# CI runs without a terminal never prompt. CLI flags win over everything.
PREFS_FILE="$_config_dir/install-prefs"
CORE_SKILL_NAMES="plannotator-review plannotator-annotate plannotator-last"
EXTRA_SKILL_NAMES="plannotator-compound plannotator-setup-goal plannotator-visual-explainer"

saved_extras=""
saved_invocable=""
if [ -f "$PREFS_FILE" ]; then
    saved_extras=$(sed -n 's/^extras=//p' "$PREFS_FILE" | head -1)
    saved_invocable=$(sed -n 's/^model_invocable=//p' "$PREFS_FILE" | head -1)
fi

# Extras already on disk (pre-existing or previously npx-installed)? Then the
# extras question is moot — they still count toward the checkbox list, and we
# never launch the npx flow over them.
extras_present=0
for skill in $EXTRA_SKILL_NAMES; do
    if [ -d "$CLAUDE_SKILLS_DIR/$skill" ] || [ -d "$AGENTS_SKILLS_DIR/$skill" ]; then
        extras_present=1
        break
    fi
done

# A wizard needs a real human at the keyboard. Piped installs (curl | bash)
# still have a terminal at /dev/tty even though stdin is the pipe; CI and
# scripts do not. Some automated contexts (docker run -t, devcontainer and
# provisioner shells) DO expose an openable /dev/tty with nobody behind it —
# opening /dev/tty succeeds, yet a read would block forever. The per-prompt
# timeout below (see PROMPT_TIMEOUT / ask_yes_no) handles that: a mis-detected
# terminal falls through to the safe non-interactive defaults (extras=no,
# model-invocable=none) instead of wedging. We deliberately do NOT
# gate on $CI here — an exported CI var must not silently suppress an explicit
# --reconfigure or --extras in an otherwise interactive shell.
can_prompt=0
if [ "$NON_INTERACTIVE" -eq 0 ] && { : < /dev/tty; } 2>/dev/null; then
    can_prompt=1
fi

# Bound every interactive read so an unattended-but-open /dev/tty auto-takes
# the default rather than hanging. Set PLANNOTATOR_PROMPT_TIMEOUT=0 to wait
# indefinitely (restores the old unbounded behavior); non-numeric falls to 30.
PROMPT_TIMEOUT="${PLANNOTATOR_PROMPT_TIMEOUT:-30}"
case "$PROMPT_TIMEOUT" in
    ''|*[!0-9]*) PROMPT_TIMEOUT=30 ;;
esac

run_wizard=0
if [ "$can_prompt" -eq 1 ]; then
    if [ "$RECONFIGURE" -eq 1 ] || [ ! -f "$PREFS_FILE" ]; then
        run_wizard=1
    fi
fi

# Ask a y/n question on the terminal. $1 prompt, $2 default (yes/no).
ask_yes_no() {
    local prompt="$1" default="$2" answer suffix rc
    suffix="[y/N]"
    [ "$default" = "yes" ] && suffix="[Y/n]"
    printf '%s %s ' "$prompt" "$suffix" > /dev/tty
    # Bounded read so an unattended-but-open /dev/tty (e.g. docker run -t with
    # no human) can't hang the install. Distinguish a human pressing Enter
    # (read succeeds with an empty answer -> use the prompt's $default) from a
    # timeout/EOF with nobody there (read fails -> use the SAFE "no", never the
    # default). Otherwise a prompt whose default is "yes" could
    # silently install software on an unattended terminal.
    # Keep the read in a tested context (`|| rc=$?`) so the read itself never
    # trips `set -e` (active at the top of this script), without relying on the
    # subtle rule that -e is suppressed inside a function called in a tested
    # context. ask_yes_no still returns non-zero on timeout/EOF to signal "no
    # human", so every caller consumes it with `|| wizard_timed_out=1`.
    rc=0
    if [ "$PROMPT_TIMEOUT" -gt 0 ]; then
        IFS= read -r -t "$PROMPT_TIMEOUT" answer < /dev/tty || rc=$?
    else
        IFS= read -r answer < /dev/tty || rc=$?
    fi
    if [ "$rc" -ne 0 ]; then
        printf '\n' > /dev/tty
        echo "no"
        return 1
    fi
    case "$answer" in
        y|Y|yes|YES|Yes) echo "yes" ;;
        n|N|no|NO|No)    echo "no" ;;
        *)               echo "$default" ;;
    esac
}

# Space-toggle checkbox over the skill names in $1 (space-separated), with
# the names in $2 (comma-separated) preselected. Echoes the chosen names as
# a comma list, or "none". Up/down (or j/k) moves, space toggles, enter
# confirms. All I/O goes to /dev/tty so piped stdout is unaffected.
select_skills_checkbox() {
    local names=($1) pre=",$2," idx=0 count key seq i mark cursor
    count=${#names[@]}
    local sel=()
    for ((i = 0; i < count; i++)); do
        case "$pre" in
            *",${names[$i]},"*) sel[i]=1 ;;
            *)                  sel[i]=0 ;;
        esac
    done
    printf 'Space toggles, enter confirms, up/down or j/k moves:\n' > /dev/tty
    while true; do
        for ((i = 0; i < count; i++)); do
            mark=" "; [ "${sel[$i]}" -eq 1 ] && mark="x"
            cursor="  "; [ "$i" -eq "$idx" ] && cursor="> "
            printf '%s[%s] %s\033[K\n' "$cursor" "$mark" "${names[$i]}" > /dev/tty
        done
        IFS= read -rsn1 key < /dev/tty || key=""
        if [ -z "$key" ]; then
            break # enter
        fi
        case "$key" in
            " ") sel[idx]=$((1 - sel[idx])) ;;
            j)   [ "$idx" -lt $((count - 1)) ] && idx=$((idx + 1)) ;;
            k)   [ "$idx" -gt 0 ] && idx=$((idx - 1)) ;;
            $'\x1b')
                seq=""
                IFS= read -rsn2 -t 1 seq < /dev/tty || seq=""
                case "$seq" in
                    '[A') [ "$idx" -gt 0 ] && idx=$((idx - 1)) ;;
                    '[B') [ "$idx" -lt $((count - 1)) ] && idx=$((idx + 1)) ;;
                esac
                ;;
        esac
        printf '\033[%dA' "$count" > /dev/tty
    done
    local out=""
    for ((i = 0; i < count; i++)); do
        if [ "${sel[$i]}" -eq 1 ]; then
            [ -n "$out" ] && out="$out,"
            out="$out${names[$i]}"
        fi
    done
    echo "${out:-none}"
}

extras_choice=""
invocable_choice=""
# Set if any wizard prompt times out / hits EOF (no human answered). A run whose
# answers are synthetic timeout fallbacks must not be persisted as install-prefs.
wizard_timed_out=0

if [ "$run_wizard" -eq 1 ]; then
    {
        echo ""
        echo "=========================================="
        echo "  PLANNOTATOR GUIDED INSTALL"
        echo "=========================================="
        echo ""
    } > /dev/tty
    if [ "$extras_present" -eq 1 ]; then
        echo "Extra skills already installed — keeping them." > /dev/tty
        extras_choice="yes"
    elif [ -n "$EXTRAS_FLAG" ]; then
        # Flag already answered this question — don't ask and then ignore.
        extras_choice="$EXTRAS_FLAG"
    else
        extras_choice=$(ask_yes_no "Install the extra skills (compound planning, setup-goal, visual explainer)?" "${saved_extras:-no}") || wizard_timed_out=1
    fi
    invocable_list="$CORE_SKILL_NAMES"
    if [ "$extras_choice" = "yes" ]; then
        invocable_list="$CORE_SKILL_NAMES $EXTRA_SKILL_NAMES"
    fi
    if [ -n "$MODEL_INVOCABLE_FLAG" ]; then
        # Flag already answered this question — don't ask and then ignore.
        invocable_choice="$MODEL_INVOCABLE_FLAG"
    else
        want_invocable=$(ask_yes_no "Make any skills callable by the model (instead of user-invoked only)?" "no") || wizard_timed_out=1
        if [ "$want_invocable" = "yes" ]; then
            invocable_choice=$(select_skills_checkbox "$invocable_list" "$saved_invocable")
        else
            invocable_choice="none"
        fi
    fi
fi

# Flags override the wizard and saved answers; otherwise saved, then defaults.
[ -n "$EXTRAS_FLAG" ] && extras_choice="$EXTRAS_FLAG"
[ -n "$MODEL_INVOCABLE_FLAG" ] && invocable_choice="$MODEL_INVOCABLE_FLAG"
[ -z "$extras_choice" ] && extras_choice="${saved_extras:-no}"
[ -z "$invocable_choice" ] && invocable_choice="${saved_invocable:-none}"

# Persist only when the wizard ran with real answers, or a flag set something.
# Silent re-runs must not clobber saved answers with defaults, and a wizard that
# timed out to synthetic fallbacks (unattended /dev/tty) must not become sticky
# prefs that suppress the wizard on a later genuine interactive install.
if [ "$wizard_timed_out" -eq 0 ] && { [ "$run_wizard" -eq 1 ] || [ -n "$EXTRAS_FLAG" ] || [ -n "$MODEL_INVOCABLE_FLAG" ]; }; then
    mkdir -p "$_config_dir"
    {
        echo "extras=$extras_choice"
        echo "model_invocable=$invocable_choice"
    } > "$PREFS_FILE"
fi

# Extras install is delegated to the skills CLI (its UI picks the agents).
# Interactive only — the CLI needs the keyboard, so silent runs and CI get
# the printed command instead. Never runs when the extras already exist.
# The extras ARE skills, so --skip-skills suppresses them too — a saved
# extras=yes preference must not smuggle a skill install past the opt-out.
if [ "$skip_skills" -eq 0 ] && [ "$extras_choice" = "yes" ] && [ "$extras_present" -eq 0 ]; then
    if [ "$can_prompt" -eq 1 ] && command -v npx >/dev/null 2>&1; then
        echo "Launching the skills CLI for the extras (pick your agents in its UI)..."
        npx skills add backnotprop/plannotator/apps/skills/extra --global < /dev/tty || \
            echo "skills CLI did not complete — install later with: npx skills add backnotprop/plannotator/apps/skills/extra --global"
    else
        echo "Install the extras with: npx skills add backnotprop/plannotator/apps/skills/extra --global"
    fi
fi

# Skills/commands opt-out. HONEST reporting like the per-agent family: the
# skipped state is announced, and skip means do-not-write — nothing already on
# disk in any skill or command scope is fetched, replaced, or removed on this
# run. Announced here, before the checkout, so the reason precedes the silence.
if [ "$skip_skills" -eq 1 ]; then
    echo ""
    echo "Skills: skipped (${skip_skills_source})."
    echo "No skills or slash commands were fetched, and none already installed"
    echo "were changed or removed. The /plannotator-* commands are NOT installed"
    echo "by this run — re-run without the opt-out to install them."
fi

# Install skills and slash commands from a sparse checkout (requires git).
# Hard requirement: without git we cannot install the /plannotator-* skills,
# so fail loudly instead of leaving a partial install. Hook/config writing
# above has already run by this point; the Pi update below
# is skipped on failure and completes when the user re-runs the installer.
# Nothing is fetched under --skip-skills, so git stops being a requirement
# there — a git-less machine must still get the binary, hooks, and config.
if [ "$skip_skills" -eq 0 ] && ! command -v git &>/dev/null; then
    echo "Error: git is required to install Plannotator's skills and slash commands." >&2
    echo "Install git, then run this installer again." >&2
    echo "To install without them, re-run with --skip-skills." >&2
    exit 1
fi

OPENCODE_COMMANDS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/commands"
skills_tmp=$(mktemp -d)

copy_skill_if_present() {
    local source_dir="$1"
    local target_dir="$2"

    if [ -d "$source_dir" ]; then
        # Remove any existing copy first so re-runs replace rather than
        # nest (cp -r dir dest/dir would otherwise create dest/dir/dir).
        rm -rf "$target_dir/$(basename "$source_dir")"
        cp -r "$source_dir" "$target_dir/"
    fi
}

# Copy every command file in a directory if the source dir exists.
# Used for the OpenCode (.md stubs), which are checked out from the repo
# rather than generated by heredocs.
copy_commands_if_present() {
    local source_dir="$1"
    local target_dir="$2"

    if [ -d "$source_dir" ] && [ -n "$(ls -A "$source_dir" 2>/dev/null)" ]; then
        mkdir -p "$target_dir"
        cp "$source_dir"/* "$target_dir/"
    fi
}

# Wrap the cd-bearing block in a subshell so any `cd` is scoped to
# the subshell and can't leave the parent script with a dangling CWD.
# Previous version chained `cd` inside an `&&` condition, and if
# sparse-checkout failed the else branch ran without restoring the
# directory — then `rm -rf "$skills_tmp"` below executed while the
# shell's CWD was still inside the directory being deleted. No
# production failure (subsequent code uses absolute paths) but
# structurally incorrect. install.ps1 and install.cmd use
# Push-Location/pushd for the same logic; a subshell is bash's
# equivalent — the parent shell's CWD is inherited in, and any
# cd inside the subshell disappears when the subshell exits.
#
# Do NOT rely on `set -e` in here. POSIX says -e is ignored for every
# command of an AND-OR list except the last, and every shell we tested
# (bash 3.2.57, which is what `curl | bash` gets on macOS, plus bash 5.3,
# dash, zsh, and ksh) carries that suppression into the subshell. Writing
# it as `if ! ( ... ); then` suppresses -e the same way. So the fetch
# steps below carry an explicit `|| exit 1`: without them a failed clone
# ran the whole block anyway, the subshell exited 0 on its trailing `if`,
# and the installer printed "YOU'RE ALL SET!" with no skills installed.
# Everything after the checkout stays best-effort on purpose, matching
# install.cmd, which only checks git clone and lets every xcopy run
# unchecked. A local cp/mkdir/rm hiccup must not be reported through the
# "network or git error" message below.
checkout_failed=0
(
    # --skip-skills / PLANNOTATOR_SKIP_SKILLS_INSTALL / skipInstall.skills.
    # Exit 0 BEFORE the clone so no network call is made and checkout_failed
    # stays 0 — an opt-out is not a fetch failure and must not trip the guard
    # below. The report was already printed above the git check.
    if [ "$skip_skills" -eq 1 ]; then
        exit 0
    fi

    cd "$skills_tmp" || exit 1
    # Capture git's stderr instead of discarding it (#1238): on failure the
    # real error is surfaced below so incompatibilities self-diagnose instead
    # of hiding behind the generic "network or git error" message.
    git_err="$skills_tmp/git-stderr"
    surface_git_error() {
        echo "git reported:" >&2
        tail -n 5 "$git_err" >&2
    }
    sparse_clone=1
    # LC_ALL=C pins git's error strings to English: the capability probe below
    # matches the literal "unknown option ... sparse" text, and a localized
    # git (standard Linux NLS builds) would otherwise emit a translated
    # message the match misses, sending old-git non-English users to a hard
    # failure instead of the fallback.
    if ! LC_ALL=C LANGUAGE=C git clone --depth 1 --filter=blob:none --sparse \
        "https://github.com/${REPO}.git" --branch "$latest_tag" repo 2>"$git_err"; then
        # Capability probe, not a version parse (same philosophy as the
        # GitButler flag probing in packages/shared/gitbutler-core.ts):
        # `git clone --sparse` needs git >= 2.25, and an older git (macOS
        # with stale Xcode CLT ships 2.23) rejects the flag instantly with
        # "error: unknown option `sparse'" before any network call (#1238).
        # Fall back to a plain shallow clone — it costs download size, not
        # correctness: every path the copy steps below read is present in
        # the full checkout, and `git sparse-checkout set` (equally missing
        # on that git) is skipped because there is nothing to narrow.
        if grep -qi "unknown option" "$git_err" && grep -qi "sparse" "$git_err"; then
            echo "This git does not support 'git clone --sparse' (needs git >= 2.25) — falling back to a plain shallow clone."
            sparse_clone=0
            rm -rf repo
            if ! git clone --depth 1 \
                "https://github.com/${REPO}.git" --branch "$latest_tag" repo 2>"$git_err"; then
                surface_git_error
                exit 1
            fi
        else
            surface_git_error
            exit 1
        fi
    fi
    cd repo || exit 1
    if [ "$sparse_clone" -eq 1 ]; then
        if ! git sparse-checkout set apps/skills apps/opencode-plugin/commands 2>"$git_err"; then
            surface_git_error
            exit 1
        fi
    fi

    # Core skills -> Claude Code (also serve as /plannotator-* slash commands)
    # and the shared-agent path (~/.agents/skills). SOFT guard: a tag pinned
    # via --version may predate the core/extra layout — skip core skills
    # but keep installing the command files below (matches install.ps1 and
    # install.cmd, which guard each block independently).
    # Claude Code and the shared-agent path consume different skill bodies.
    # Claude Code reads the apps/skills/claude/* copies, which use
    # dynamic-context injection (`!`plannotator … $ARGUMENTS``) + allowed-tools
    # so /plannotator-* run the binary directly with no permission prompt —
    # matching the old slash commands. The shared-agent path reads
    # apps/skills/core/*, whose prose bodies the model follows via its own
    # shell; the `!`…`` injection is a Claude-Code-only extension, so the two
    # are sourced separately rather than sharing one body.
    if [ -d "apps/skills/claude" ] && [ -n "$(ls -A apps/skills/claude 2>/dev/null)" ]; then
        mkdir -p "$CLAUDE_SKILLS_DIR"
        copy_skill_if_present apps/skills/claude/plannotator-review "$CLAUDE_SKILLS_DIR"
        copy_skill_if_present apps/skills/claude/plannotator-annotate "$CLAUDE_SKILLS_DIR"
        copy_skill_if_present apps/skills/claude/plannotator-last "$CLAUDE_SKILLS_DIR"
        copy_skill_if_present apps/skills/claude/plannotator-inbox "$CLAUDE_SKILLS_DIR"
        # The plannotator knowledge skill (CLI reference) has no Claude-only
        # injection form — its body is pure prose — so Claude installs the
        # same single-sourced copy the shared-agent path gets from
        # apps/skills/core.
        copy_skill_if_present apps/skills/core/plannotator "$CLAUDE_SKILLS_DIR"
        echo "Installed Claude Code skills to ${CLAUDE_SKILLS_DIR}/"
    else
        echo "Tag ${latest_tag} predates the per-agent skill layout — skipping Claude Code skill install"
    fi
    if [ -d "apps/skills/core" ] && [ -n "$(ls -A apps/skills/core 2>/dev/null)" ]; then
        mkdir -p "$AGENTS_SKILLS_DIR"
        copy_skill_if_present apps/skills/core/plannotator-review "$AGENTS_SKILLS_DIR"
        copy_skill_if_present apps/skills/core/plannotator-annotate "$AGENTS_SKILLS_DIR"
        copy_skill_if_present apps/skills/core/plannotator-last "$AGENTS_SKILLS_DIR"
        copy_skill_if_present apps/skills/core/plannotator-inbox "$AGENTS_SKILLS_DIR"
        copy_skill_if_present apps/skills/core/plannotator "$AGENTS_SKILLS_DIR"
        echo "Installed shared agent skills to ${AGENTS_SKILLS_DIR}/"
    else
        echo "Tag ${latest_tag} predates the core/extra skill layout — skipping shared agent skill install"
    fi

    # OpenCode slash command stubs (the plugin intercepts execution) —
    # always installed when the checkout provides them. Guard the echo on
    # the same condition as the copy so old pinned tags don't report a
    # success that never happened (ps1/cmd already gate this way).
    if [ "$skip_opencode" -eq 0 ] && [ -d "apps/opencode-plugin/commands" ] && [ -n "$(ls -A apps/opencode-plugin/commands 2>/dev/null)" ]; then
        copy_commands_if_present apps/opencode-plugin/commands "$OPENCODE_COMMANDS_DIR"
        echo "Installed OpenCode commands to ${OPENCODE_COMMANDS_DIR}/"
    fi
) || checkout_failed=1

rm -rf "$skills_tmp"

if [ "${checkout_failed:-0}" -eq 1 ]; then
    echo "Error: unable to fetch ${REPO} at ${latest_tag} (network or git error)." >&2
    echo "Something went wrong — run the installer again." >&2
    exit 1
fi

# Claude Code commands are deprecated in favor of skills. Remove a legacy
# command file only once its replacement skill is actually on disk — running
# AFTER the install above guarantees a failed or skipped skill install never
# leaves users with neither the command nor the skill.
CLAUDE_COMMANDS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/commands"
for cmd in plannotator-review plannotator-annotate plannotator-last; do
    # A skills opt-out installed no replacement this run, so it removes
    # nothing either — skip means do-not-write, never remove.
    if [ "$skip_skills" -eq 1 ]; then
        continue
    fi
    if [ -d "$CLAUDE_SKILLS_DIR/$cmd" ] && [ -f "$CLAUDE_COMMANDS_DIR/$cmd.md" ]; then
        rm -f "$CLAUDE_COMMANDS_DIR/$cmd.md"
        echo "Removed legacy Claude command ${CLAUDE_COMMANDS_DIR}/$cmd.md (replaced by the $cmd skill)"
    fi
done

# plannotator-archive no longer ships as a skill. Remove any stale installed
# copy from every skill scope so upgraders don't keep a dead skill around.
for scope in "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"; do
    # A skills opt-out leaves every skill scope untouched, sweep included.
    if [ "$skip_skills" -eq 1 ]; then
        continue
    fi
    if [ -d "$scope/plannotator-archive" ]; then
        rm -rf "$scope/plannotator-archive"
        echo "Removed stale plannotator-archive skill from ${scope}/plannotator-archive"
    fi
done
# The /plannotator-archive OpenCode command was removed too — sweep the stub
# (only npm-plugin-postinstall users ever had it written here). An OpenCode
# opt-out suspends the sweep: skip means do-not-write, never remove.
# A skills opt-out suspends it for the same reason.
if [ "$skip_opencode" -eq 0 ] && [ "$skip_skills" -eq 0 ] && [ -f "$OPENCODE_COMMANDS_DIR/plannotator-archive.md" ]; then
    rm -f "$OPENCODE_COMMANDS_DIR/plannotator-archive.md"
    echo "Removed stale plannotator-archive command from ${OPENCODE_COMMANDS_DIR}/"
fi

# Apply the saved model-invocation choices. Installed skill copies always
# arrive locked (disable-model-invocation: true in SKILL.md); for each chosen
# skill we unlock the INSTALLED copy by removing that line, and flip the
# shared-agent sidecar's allow_implicit_invocation to match. Re-applied on every run
# because installs replace the skill folders wholesale. Source files in the
# repo never change.
# A skills opt-out installed no skill copies this run, so there is nothing to
# unlock — and rewriting a PREVIOUS run's SKILL.md would be a write the opt-out
# promised not to make.
if [ "$skip_skills" -eq 0 ] && [ -n "$invocable_choice" ] && [ "$invocable_choice" != "none" ]; then
    for skill in $(echo "$invocable_choice" | tr ',' ' '); do
        for scope in "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"; do
            skill_md="$scope/$skill/SKILL.md"
            if [ -f "$skill_md" ] && grep -q '^disable-model-invocation: true$' "$skill_md"; then
                grep -v '^disable-model-invocation: true$' "$skill_md" > "$skill_md.tmp" && mv "$skill_md.tmp" "$skill_md"
                echo "Enabled model invocation: ${scope}/${skill}"
            fi
            sidecar="$scope/$skill/agents/openai.yaml"
            if [ -f "$sidecar" ] && grep -q 'allow_implicit_invocation: false' "$sidecar"; then
                sed 's/allow_implicit_invocation: false/allow_implicit_invocation: true/' "$sidecar" > "$sidecar.tmp" && mv "$sidecar.tmp" "$sidecar"
            fi
        done
    done
fi

# Update Pi extension if pi is installed. The extension bundles only the
# plannotator knowledge skill, and offers it to Pi only when no other copy is
# loaded, so it yields to the ~/.agents/skills copy installed above instead of
# colliding with it (#1642). Updating is also what clears that collision for
# anyone on an older extension that declared the skill in its manifest.
update_pi_extension_if_present

echo ""
echo "=========================================="
echo "  OPENCODE USERS"
echo "=========================================="
echo ""
if [ "$skip_opencode" -eq 1 ]; then
    echo "OpenCode: integration skipped (${skip_opencode_source})."
    echo "No command stubs were written and OpenCode's plugin cache was left alone."
    echo "Re-run without the opt-out to install the command stubs."
elif [ "$skip_skills" -eq 1 ]; then
    # The stubs ship in the skills checkout, so this run installed none.
    echo "Add the plugin to your opencode.json:"
    echo ""
    echo '  "plugin": ["@plannotator/opencode@latest"]'
    echo ""
    echo "Skills were skipped (${skip_skills_source}), so no /plannotator-* command"
    echo "stubs were installed. Re-run without the opt-out to add them."
else
    echo "Add the plugin to your opencode.json:"
    echo ""
    echo '  "plugin": ["@plannotator/opencode@latest"]'
    echo ""
    echo "Then restart OpenCode (OpenCode 2: run opencode2 reload). The /plannotator-review, /plannotator-annotate, and /plannotator-last commands are ready!"
fi
# Agent-specific closing sections print only for agents this run detected,
# reusing the detection each integration block above already ran (Pi: `pi` on
# PATH, as update_pi_extension_if_present checks). A detected-but-skipped
# agent keeps its honest "detected, skipped" section. OpenCode has no
# detection leg and its
# command stubs are written for everyone, so its section stays universal, as
# does the Claude Code block. Output only: nothing here decides what installs.
pi_detected=0
if command -v pi >/dev/null 2>&1; then
    pi_detected=1
fi
if [ "$pi_detected" -eq 1 ]; then
    echo ""
    echo "=========================================="
    echo "  PI USERS"
    echo "=========================================="
    echo ""
    echo "Install the extension:"
    echo ""
    echo "  pi install npm:@plannotator/pi-extension"
    echo ""
    echo "Update it (pi install leaves an existing install as it is):"
    echo ""
    echo "  pi update npm:@plannotator/pi-extension"
fi
# Oh My Pi (OMP) loads the Pi extension as an OMP plugin (#1814). This run
# installs nothing into OMP: the section says how, because "Ask this session"
# in OMP comes only from the extension, never from the CLI run in OMP's shell.
if command -v omp >/dev/null 2>&1; then
    echo ""
    echo "=========================================="
    echo "  OH MY PI (OMP) USERS"
    echo "=========================================="
    echo ""
    echo "Install or update the Plannotator extension in OMP:"
    echo ""
    echo "  omp plugin install @plannotator/pi-extension"
    echo ""
    echo "Then restart OMP and open reviews with /plannotator-review, /plannotator-annotate and"
    echo "/plannotator-last. Reviews opened that way can use Ask this session."
fi
echo ""
echo "=========================================="
if [ "$skip_skills" -eq 1 ]; then
    # Never claim the /plannotator-* commands are ready when nothing was
    # installed — that false banner is exactly what the skills-checkout guard
    # exists to prevent.
    echo "  CLAUDE CODE USERS: BINARY INSTALLED"
else
    echo "  CLAUDE CODE USERS: YOU'RE ALL SET!"
fi
echo "=========================================="
echo ""
case "$claude_plugin_state" in
    updated)
        echo "The Claude Code plugin was updated${claude_plugin_version:+ to ${claude_plugin_version}}. Restart Claude Code to load it."
        ;;
    current)
        echo "The Claude Code plugin is up to date${claude_plugin_version:+ (${claude_plugin_version})}."
        ;;
    no-marketplace)
        echo "Re-add the Claude Code plugin's marketplace: run these in a terminal, then restart Claude Code:"
        print_claude_plugin_marketplace_readd
        ;;
    skipped|failed|manual)
        echo "Update the Claude Code plugin: run these in a terminal, then restart Claude Code:"
        print_claude_plugin_manual_update
        ;;
    *)
        echo "Install the Claude Code plugin:"
        echo "  /plugin marketplace add backnotprop/plannotator"
        echo "  /plugin install plannotator@plannotator"
        echo ""
        echo "Updating the plugin? Run these in a terminal, then restart Claude Code:"
        print_claude_plugin_manual_update
        ;;
esac
echo ""
if [ "$skip_skills" -eq 1 ]; then
    echo "Skills were skipped (${skip_skills_source}), so the /plannotator-review,"
    echo "/plannotator-annotate, and /plannotator-last commands are NOT installed."
    echo "Re-run the installer without the opt-out to add them."
else
    echo "The /plannotator-review, /plannotator-annotate, and /plannotator-last commands are ready to use after you restart Claude Code!"
fi

if [ "$skip_skills" -eq 0 ] && [ "$extras_choice" != "yes" ]; then
    echo ""
    echo "Optional skills (compound planning, setup-goal, visual explainer):"
    echo "  npx skills add backnotprop/plannotator/apps/skills/extra --global"
fi

# Warn if plannotator is configured in both settings.json hooks AND the plugin (causes double execution)
# Only warn when the plugin is installed — manual-only users won't have overlap
CLAUDE_SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
duplicate_plan_hook=0
if [ -f "$PLUGIN_HOOKS" ] && [ -f "$CLAUDE_SETTINGS" ] && grep -q '"command".*plannotator' "$CLAUDE_SETTINGS" 2>/dev/null; then
    # The opt-in T3 Bash hook has no counterpart in the default plugin.
    # Inspect event/matcher pairs so compact JSON with a real plan-hook
    # overlap still warns even when it also contains the T3 hook.
    if grep -q 't3-hook' "$CLAUDE_SETTINGS"; then
        if "$INSTALL_DIR/plannotator" t3-hook plan-hook-present "$CLAUDE_SETTINGS"; then duplicate_plan_hook=1; fi
    else
        duplicate_plan_hook=1
    fi
fi
if [ "$duplicate_plan_hook" -eq 1 ]; then
    echo ""
    echo "⚠️ ⚠️ ⚠️  WARNING: DUPLICATE HOOK DETECTED  ⚠️ ⚠️ ⚠️"
    echo ""
    echo "  plannotator was found in your settings.json hooks:"
    echo "  $CLAUDE_SETTINGS"
    echo ""
    echo "  This will cause plannotator to run TWICE on each plan review."
    echo "  Remove the plannotator hook from settings.json and rely on the"
    echo "  plugin instead (installed automatically via marketplace)."
    echo ""
    echo "⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️ ⚠️"
fi

# The full install completed: remember its command-line flags for auto-update.
write_install_flags

# When Claude Code sessions that are open right now cannot load the plugin by
# themselves, tell the person the one thing to do, even when this ran in the
# background (Update now in the Inbox, auto-update): one operating-system
# notification, and the plugin-update page on plannotator.ai in the default
# browser, which says what happened and shows the commands to copy. Two cases:
# - updated, from a plugin older than 0.28.52, the first release whose mod
#   reloads itself after an update (#2356, auto-reload): open sessions run that
#   older mod, so /reload-plugins must be typed once in each (state=reload).
# - manual / failed / no-marketplace, while the installed plugin is older than
#   this release: the plugin could not be updated at all (state=manual).
# The page URL carries only the case and the two versions:
#   https://plannotator.ai/plugin-update?state=reload|manual[&from=X.Y.Z][&to=X.Y.Z]
# Never on a fresh install, an opted-out or pinned plugin (skipped), or a
# current one; never when no Claude Code session is open (no live pid among
# Claude Code's sessions/<pid>.json); never in CI, over SSH, without a desktop
# session or under the test sandbox (PLANNOTATOR_TEST_SANDBOX); once per run
# (it runs once, here). Opt out of both with PLANNOTATOR_INSTALL_NOTIFY=0;
# PLANNOTATOR_BROWSER is honored for the page as everywhere else (a "none"
# value opens no page, a path is run with the URL). Uses only what the system
# has (osascript and open on macOS, notify-send and xdg-open on Linux), each
# time-bounded, and never fails the install. install.ps1 / install.cmd carry
# the same rule.
CLAUDE_PLUGIN_SELF_RELOAD_VERSION="0.28.52"
CLAUDE_PLUGIN_UPDATE_PAGE="https://plannotator.ai/plugin-update"
claude_code_session_open() {
    _cs_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions"
    [ -d "$_cs_dir" ] || return 1
    for _cs_file in "$_cs_dir"/*.json; do
        [ -f "$_cs_file" ] || continue
        _cs_pid=$(basename "$_cs_file" .json)
        case "$_cs_pid" in ''|*[!0-9]*) continue ;; esac
        kill -0 "$_cs_pid" 2>/dev/null && return 0
    done
    return 1
}
# A plain X.Y.Z (a leading v dropped), or nothing: only versions go in the URL.
plain_version() {
    _pv="${1#v}"
    case "$_pv" in
        ''|*[!0123456789.]*|.*|*.|*..*|*.*.*.*) return 0 ;;
        *.*.*) printf '%s' "$_pv" ;;
    esac
}
notify_claude_plugin_reload() {
    case "${PLANNOTATOR_INSTALL_NOTIFY:-}" in
        0|false|no|off|disabled|FALSE|NO|OFF|False|No|Off) return 0 ;;
    esac
    [ -z "${PLANNOTATOR_TEST_SANDBOX:-}" ] || return 0
    [ -z "${CI:-}" ] || return 0
    [ -z "${SSH_CONNECTION:-}${SSH_CLIENT:-}${SSH_TTY:-}" ] || return 0
    _nt_from=$(plain_version "$claude_plugin_from_version")
    [ -n "$_nt_from" ] || return 0
    case "$claude_plugin_state" in
        updated)
            oc2_version_at_least "$_nt_from" "$CLAUDE_PLUGIN_SELF_RELOAD_VERSION" && return 0
            _nt_state="reload"
            _nt_to=$(plain_version "$claude_plugin_version")
            [ -n "$_nt_to" ] || _nt_to=$(plain_version "$latest_tag")
            _nt_title="Plannotator updated its Claude Code plugin"
            _nt_body="Type /reload-plugins in each open Claude Code session to load it."
            ;;
        manual|failed|no-marketplace)
            oc2_version_at_least "$_nt_from" "$latest_tag" && return 0
            _nt_state="manual"
            _nt_to=$(plain_version "$latest_tag")
            _nt_title="Plannotator could not update its Claude Code plugin"
            _nt_body="See Settings > Agents in the Plannotator Inbox for the two commands to run."
            ;;
        *) return 0 ;;
    esac
    claude_code_session_open || return 0
    _nt_url="${CLAUDE_PLUGIN_UPDATE_PAGE}?state=${_nt_state}&from=${_nt_from}${_nt_to:+&to=${_nt_to}}"
    _nt_browser="${PLANNOTATOR_BROWSER:-}"
    _nt_browser_trim=$(printf '%s' "$_nt_browser" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
    case "$_nt_browser_trim" in
        none|false|0|off|no|true|1|:) _nt_page=0 ;;
        *) _nt_page=1 ;;
    esac
    _nt_tmp=$(mktemp -d "${TMPDIR:-/tmp}/plannotator-notify.XXXXXX" 2>/dev/null) || return 0
    case "$(uname -s)" in
        Darwin)
            if command -v osascript >/dev/null 2>&1; then
                # The words go in as arguments, never into the script text.
                run_with_time_limit 10 "$_nt_tmp/timed-out" osascript \
                    -e 'on run argv' \
                    -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
                    -e 'end run' "$_nt_title" "$_nt_body" >/dev/null 2>&1 || true
            fi
            if [ "$_nt_page" -eq 1 ]; then
                case "$_nt_browser" in
                    '') run_with_time_limit 10 "$_nt_tmp/timed-out" open "$_nt_url" >/dev/null 2>&1 || true ;;
                    */*) run_with_time_limit 10 "$_nt_tmp/timed-out" "$_nt_browser" "$_nt_url" >/dev/null 2>&1 || true ;;
                    *) run_with_time_limit 10 "$_nt_tmp/timed-out" open -a "$_nt_browser" "$_nt_url" >/dev/null 2>&1 || true ;;
                esac
            fi
            ;;
        Linux)
            # A desktop session: a display (and, for the notification, a session bus).
            if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
                if command -v notify-send >/dev/null 2>&1; then
                    if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
                        DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
                        export DBUS_SESSION_BUS_ADDRESS
                    fi
                    if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
                        run_with_time_limit 10 "$_nt_tmp/timed-out" notify-send -a Plannotator \
                            "$_nt_title" "$_nt_body" >/dev/null 2>&1 || true
                    fi
                fi
                if [ "$_nt_page" -eq 1 ]; then
                    _nt_opener="${_nt_browser:-xdg-open}"
                    if command -v "$_nt_opener" >/dev/null 2>&1; then
                        run_with_time_limit 10 "$_nt_tmp/timed-out" "$_nt_opener" "$_nt_url" >/dev/null 2>&1 || true
                    fi
                fi
            fi
            ;;
    esac
    rm -rf "$_nt_tmp" 2>/dev/null || true
    return 0
}
notify_claude_plugin_reload || true
