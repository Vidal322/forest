#!/usr/bin/env bash
# Should the backlog loop keep going? Reads the snapshots the status line writes to .claude/loop/usage/<session>.json
# (see ~/.claude/statusline-command.sh): 5-hour usage from the newest one, context from the loop's own session.
#   budget.sh [<session id>]   (the loop session's id; without it, the newest snapshot's context is used)
# Exit 0 = go on, 1 = stop (reason printed), 2 = no usable snapshot.
set -uo pipefail
dir=$(cd "$(dirname "$0")" && pwd)/usage
max5=${LOOP_MAX_5H:-75}
maxctx=${LOOP_MAX_CONTEXT:-40}
newest=$(ls -t "$dir"/*.json 2>/dev/null | head -1)
[ -n "$newest" ] || { echo "no usage snapshot in $dir (is the status line writing it?)"; exit 2; }
own=$newest
[ -n "${1:-}" ] && [ -f "$dir/$1.json" ] && own=$dir/$1.json
read -r at five < <(jq -r '"\(.at // 0) \(.five_hour // "")"' "$newest" 2>/dev/null) || { echo "unreadable snapshot"; exit 2; }
ctx=$(jq -r '.context // ""' "$own" 2>/dev/null) || { echo "unreadable snapshot"; exit 2; }
age=$(($(date +%s) - ${at:-0}))
[ "$age" -le 600 ] || { echo "newest usage snapshot is ${age}s old"; exit 2; }
echo "5h usage ${five:-?}% (stop at $max5%), context ${ctx:-?}% (stop at $maxctx%)"
over() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a != "" && a + 0 >= b + 0) }'; }
if over "$five" "$max5"; then echo "STOP: 5-hour usage limit"; exit 1; fi
if over "$ctx" "$maxctx"; then echo "STOP: context is getting full"; exit 1; fi
[ -n "$five" ] || { echo "5-hour usage not reported"; exit 2; }
exit 0
