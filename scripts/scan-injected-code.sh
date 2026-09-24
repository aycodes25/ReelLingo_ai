#!/bin/sh
# Fails if any file in the repo contains the obfuscated loader that was
# injected into config files (jest.config.js, postcss.config.js, cli.js, ...).
# Signatures: global.e='NPM' / global['e'], global.o= / global['o'],
# global.i='*8-11' / global.j=1, the _$_xxxx=(function loader, and code
# hidden after a long run of spaces.
PATTERN='global\.[eoij][[:space:]]*=[^=]|global\[[[:space:]]*["'"'"'][eoij]["'"'"'][[:space:]]*\]|global\[_\$_|_\$_[0-9a-f]{4}[[:space:]]*=[[:space:]]*\(function| {300,}'

if [ "$1" = "--cached" ]; then
	MODE="--cached"
else
	MODE="--untracked" # also scan new files that are not committed yet (.gitignore'd ones like node_modules are skipped)
fi

matches=$(git grep -I -l -E $MODE "$PATTERN" -- . ':!*.md' ':!scripts/scan-injected-code.sh')

if [ -n "$matches" ]; then
	echo "BLOCKED: possible injected malware found in:"
	echo "$matches" | sed 's/^/  - /'
	echo ""
	echo "Do NOT run npm install/dev/build/test in this repo until these files are cleaned."
	echo "Also check your machine: open C:\\Program Files\\nodejs\\node_modules\\npm\\lib\\cli.js"
	echo "and make sure it has no hidden code after a long run of spaces."
	exit 1
fi

echo "No injected code found."
