#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

RUN_TESTS=false
for arg in "$@"; do
  case "$arg" in
    --test|-t) RUN_TESTS=true ;;
  esac
done

AMBER='\033[38;2;240;160;48m'
DIM='\033[2m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

step() { printf "${AMBER}▸ %s${RESET}\n" "$1"; }
ok()   { printf "${GREEN}  ✓ %s${RESET}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${RESET}\n" "$1"; exit 1; }

echo ""
printf "${AMBER}  F.R.I.D.A.Y. Build${RESET}\n"
echo ""

# 1. Install dependencies
step "Installing dependencies..."
bun install || fail "bun install failed"
ok "Dependencies installed"

# 2. Install web dependencies
step "Installing web dependencies..."
(cd web && bun install) || fail "web bun install failed"
ok "Web dependencies installed"

# 3. Type check
step "Type checking..."
bun run typecheck || fail "Type check failed"
ok "Types clean"

# 4. Lint
step "Linting..."
bun run lint || fail "Lint failed"
ok "Lint clean"

# 5. Tests (opt-in via --test or -t)
if [ "$RUN_TESTS" = true ]; then
  step "Running tests..."
  bun test || fail "Tests failed"
  ok "All tests pass"
else
  printf "${DIM}  ⊘ Tests skipped (use --test to run)${RESET}\n"
fi

# 6. Build web UI
step "Building web UI..."
bun run web:build || fail "Web build failed"
ok "Web UI built"

# 7. Link binary
step "Linking friday binary..."
bun link || fail "bun link failed"
ok "friday command available"

echo ""
printf "${GREEN}  Build complete.${RESET}\n"
printf "${DIM}  Run: friday chat    — interactive TUI${RESET}\n"
printf "${DIM}  Run: friday serve   — web UI + socket server${RESET}\n"
echo ""
