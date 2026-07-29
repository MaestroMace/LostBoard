#!/bin/sh
# Every logic and behavioural suite, in one command, so "verified" is one thing
# to run rather than nine things to remember.
#
#   npx vite --port 5273 &        # the suites drive a dev build
#   tools/logic/run.sh
#
# The dev build is required: the suites read project state through the
# `__lostboard` handle, which `import.meta.env.DEV` strips from production.
#
# Environment:
#   PORT               dev server port (default 5273)
#   CHROME_PATH        Chromium binary; omit to use Playwright's own download
#   PLAYWRIGHT_MODULE  import specifier for Playwright (default 'playwright')
cd "$(dirname "$0")" || exit 1
fail=0
for s in logic.mjs logic2.mjs logic3.mjs logic4.mjs logic5.mjs logic6.mjs correctness.mjs touchswipe.mjs; do
  printf '%-18s' "$s"
  out=$(node "$s" 2>&1)
  code=$?
  [ $code -ne 0 ] && fail=1
  printf '%s  %s\n' "$code" "$(printf '%s' "$out" | grep -E 'passed|violations|PASS —|FAIL —' | tail -1)"
done
echo
if [ $fail -eq 0 ]; then echo 'ALL SUITES GREEN'; else echo 'SOME SUITES FAILED'; fi
exit $fail
