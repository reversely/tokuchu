#!/usr/bin/env bash
# First command a new contributor or agent session runs for tokuchu.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> npm install"
npm install
echo "==> Playwright Chromium"
npx playwright install chromium
echo "==> pre-commit hooks"
if command -v pre-commit >/dev/null 2>&1; then pre-commit install || true; else echo "   (pre-commit not found; install it to enable hooks)"; fi
echo "==> .env key check"
if [ -f .env ]; then
  for k in OPENAI_API_KEY CUSTOMILY_SHOP_URL PRINTSHOP_URL; do
    grep -q "^$k=" .env && echo "   $k present" || echo "   $k MISSING (see .env.example)"
  done
else echo "   .env missing; copy .env.example to .env and fill it"; fi
echo "==> typecheck"
npm run typecheck
echo "done"
