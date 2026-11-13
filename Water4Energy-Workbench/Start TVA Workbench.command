#!/bin/sh
# One Mac launcher: prepare the included VISTA project, then open the interface.
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)" || exit 1
W4E_PYTHON=""
for candidate in /Applications/VISTA/python/*/bin/python3 /Applications/VISTA/python/*/bin/python3.[0-9]* "$HOME"/Applications/VISTA/python/*/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$candidate" ] && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; then
    W4E_PYTHON="$candidate"
    break
  fi
done
if [ -z "$W4E_PYTHON" ] && command -v python3 >/dev/null 2>&1; then
  candidate="$(command -v python3)"
  if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; then
    W4E_PYTHON="$candidate"
  fi
fi
if [ -z "$W4E_PYTHON" ]; then
  printf '%s\n' 'Install VISTA (which includes Python), or Python 3.9+, then open this same launcher again.'
  printf '%s' 'Press Return to close… '
  read W4E_UNUSED
  exit 1
fi
"$W4E_PYTHON" launch_workbench.py "$@"
W4E_EXIT=$?
if [ "$W4E_EXIT" -ne 0 ]; then
  printf '%s' 'Press Return to close… '
  read W4E_UNUSED
fi
exit "$W4E_EXIT"
