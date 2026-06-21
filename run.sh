#!/usr/bin/env bash
#
# Velvet Comet — one script to run / test the whole project.
#
#   ./run.sh            full demo path: setup → eval → CLI sample → live stack
#   ./run.sh all        everything: setup → gates (typecheck/lint/test) → eval → CLI → stack
#   ./run.sh setup      install toolchain + dependencies
#   ./run.sh check      quality gates only (typecheck + lint + tests)
#   ./run.sh eval       print the completeness lift (+67% on the synthetic corpus)
#   ./run.sh cli "<q>"  run one research query through the CLI
#   ./run.sh stack      start the API + web console together (Ctrl+C to stop)
#   ./run.sh api        start just the API (:3000)
#   ./run.sh web        start just the console (:4321)
#   ./run.sh help
#
# Offline by default (mock search + heuristic expansion — deterministic, no credits).
# Append --live to use real Firecrawl/Anthropic from .env, e.g.:
#   ./run.sh cli "industrial iot sensors" --live
#   ./run.sh stack --live
#
set -uo pipefail

# ---------- locate repo root ----------
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- pretty output ----------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else BOLD=; DIM=; CYAN=; GREEN=; YELLOW=; RED=; RESET=; fi
say()  { printf '%s\n' "${CYAN}${BOLD}▸ $*${RESET}"; }
ok()   { printf '%s\n' "${GREEN}  ✓ $*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}  ! $*${RESET}"; }
die()  { printf '%s\n' "${RED}  ✗ $*${RESET}"; exit 1; }

# ---------- parse a global --live flag out of the args ----------
LIVE=0; ARGS=()
for a in "$@"; do
  if [[ "$a" == "--live" ]]; then LIVE=1; else ARGS+=("$a"); fi
done
set -- "${ARGS[@]:-}"

maybe_load_env() {
  if [[ "$LIVE" == "1" ]]; then
    [[ -f .env ]] || die "--live needs a .env file (copy .env.example and add your keys)"
    set -a; # shellcheck disable=SC1091
    source .env; set +a
    ok "live mode: loaded keys from .env (real Firecrawl/Anthropic)"
  else
    # ensure no stray keys leak in from the shell → force offline mock mode
    unset FIRECRAWL_API_KEY ANTHROPIC_API_KEY 2>/dev/null || true
  fi
}

# ---------- helpers ----------
have() { command -v "$1" >/dev/null 2>&1; }

free_port() { # kill whatever is listening on a port (our stale servers)
  local p="$1"
  if have lsof; then
    lsof -ti "tcp:${p}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

wait_for() { # wait_for <url> <name> <timeout-seconds>
  local url="$1" name="$2" timeout="${3:-60}" i=0
  printf '%s' "${DIM}  waiting for ${name}${RESET}"
  while ! curl -fsS "$url" >/dev/null 2>&1; do
    sleep 1; i=$((i+1)); printf '.'
    [[ $i -ge $timeout ]] && { printf '\n'; warn "${name} not ready after ${timeout}s (check the log)"; return 1; }
  done
  printf '\n'; ok "${name} is up"
}

PN="pnpm"

ensure_pnpm() {
  if ! have pnpm; then
    say "Enabling pnpm via corepack"
    have corepack || die "corepack not found (need Node 18+). Install Node, then re-run."
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@9.15.0 --activate >/dev/null 2>&1 || true
    have pnpm || die "could not activate pnpm"
  fi
  ok "pnpm $($PN --version)  ·  node $(node --version)"
}

# ---------- commands ----------
cmd_setup() {
  say "Toolchain"; ensure_pnpm
  say "Installing dependencies (this can take a minute the first time)"
  $PN install || die "pnpm install failed"
  ok "dependencies installed"
}

cmd_check() {
  ensure_pnpm
  local rc=0
  say "Typecheck (strict, all packages)"
  if $PN -r typecheck >/dev/null 2>&1; then ok "typecheck clean"; else warn "typecheck FAILED — re-run 'pnpm -r typecheck' to see why"; rc=1; fi
  say "Lint"
  if $PN lint >/dev/null 2>&1; then ok "lint clean"; else warn "lint FAILED — re-run 'pnpm lint'"; rc=1; fi
  say "Tests"
  if $PN test; then ok "all tests passed"; else warn "some tests FAILED"; rc=1; fi
  [[ $rc -eq 0 ]] && ok "all gates green" || warn "one or more gates failed (see above)"
  return $rc
}

cmd_eval() {
  ensure_pnpm
  say "Completeness eval — engine vs. flat /search baseline"
  $PN --filter @velvet-comet/eval eval
  if [[ "$LIVE" == "1" ]]; then
    say "Live coverage on real Firecrawl (novel domains vs the strongest flat baseline)"
    $PN --filter @velvet-comet/eval eval:live -- "${1:-competitive landscape for industrial IoT sensors}"
  fi
}

cmd_cli() {
  ensure_pnpm; maybe_load_env
  local q="${1:-competitive landscape for industrial IoT sensors}"
  say "CLI research: \"$q\"  (coverage=high, deepen on)"
  $PN --filter @velvet-comet/cli research "$q" --coverage high --deepen
}

cmd_api() {
  ensure_pnpm; maybe_load_env
  say "Starting API on http://localhost:3000  (Ctrl+C to stop)"
  free_port 3000
  PORT=3000 $PN --filter @velvet-comet/api start
}

cmd_web() {
  ensure_pnpm
  say "Starting console on http://localhost:4321  (Ctrl+C to stop)"
  free_port 4321
  NEXT_PUBLIC_API_BASE=http://localhost:3000 $PN --filter @velvet-comet/web dev
}

cmd_stack() {
  ensure_pnpm; maybe_load_env
  local logdir; logdir="$(mktemp -d)"
  local api_log="$logdir/api.log" web_log="$logdir/web.log"

  cleanup() { printf '\n'; say "Shutting down"; free_port 3000; free_port 4321; ok "stopped"; }
  trap cleanup EXIT INT TERM

  say "Starting full stack (offline mock by default; pass --live for real Firecrawl)"
  free_port 3000; free_port 4321

  PORT=3000 $PN --filter @velvet-comet/api start >"$api_log" 2>&1 &
  wait_for "http://localhost:3000/health" "API (:3000)" 60 || { warn "see $api_log"; tail -20 "$api_log"; }

  NEXT_PUBLIC_API_BASE=http://localhost:3000 $PN --filter @velvet-comet/web dev >"$web_log" 2>&1 &
  wait_for "http://localhost:4321" "Console (:4321)" 120 || { warn "see $web_log"; tail -20 "$web_log"; }

  printf '\n'
  printf '%s\n' "${GREEN}${BOLD}  ☄  Velvet Comet is running${RESET}"
  printf '%s\n' "     Console : ${BOLD}http://localhost:4321${RESET}   ${DIM}(submit one query per line)${RESET}"
  printf '%s\n' "     API     : ${BOLD}http://localhost:3000${RESET}   ${DIM}(GET /health · POST /v1/research)${RESET}"
  printf '%s\n' "     Logs    : ${DIM}tail -f $api_log   |   tail -f $web_log${RESET}"
  printf '%s\n' "     Mode    : $([[ "$LIVE" == "1" ]] && echo "${YELLOW}LIVE (real Firecrawl)${RESET}" || echo "${DIM}offline mock (free, deterministic)${RESET}")"
  printf '\n%s\n' "${DIM}  Press Ctrl+C to stop both.${RESET}"
  wait
}

cmd_demo() {
  cmd_setup
  printf '\n'; cmd_eval
  printf '\n'; cmd_cli "${1:-}"
  printf '\n'; cmd_stack
}

cmd_all() {
  cmd_setup
  printf '\n'; cmd_check || true
  printf '\n'; cmd_eval
  printf '\n'; cmd_cli "${1:-}"
  printf '\n'; cmd_stack
}

cmd_help() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

# ---------- dispatch ----------
banner() { printf '%s\n\n' "${BOLD}${CYAN}☄ Velvet Comet${RESET} ${DIM}· run / test harness${RESET}"; }
banner
case "${1:-demo}" in
  setup) cmd_setup ;;
  check|test|gates) cmd_check ;;
  eval) cmd_eval "${2:-}" ;;
  cli) cmd_cli "${2:-}" ;;
  api) cmd_api ;;
  web) cmd_web ;;
  stack|start|serve) cmd_stack ;;
  demo) cmd_demo "${2:-}" ;;
  all) cmd_all "${2:-}" ;;
  help|-h|--help) cmd_help ;;
  *) warn "unknown command: ${1}"; cmd_help; exit 2 ;;
esac
