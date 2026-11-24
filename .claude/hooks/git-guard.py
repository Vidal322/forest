#!/usr/bin/env python3
"""PreToolUse hook (Bash) for the Forest repo.

- Blocks every `git push`, however it is written: the loop works locally only.
- Before every `git commit`, runs the checks for the parts of the checkout being committed
  (backend/ -> `make check`, frontend/ -> `pnpm check`, both at once).
Exit 2 blocks the tool call; stderr is shown to Claude.
"""
import json
import os
import re
import shlex
import subprocess
import sys

SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", "\n"}


def block(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def tokenize(cmd):
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()")
    lex.whitespace = " \t\r"  # keep newlines as separators
    lex.whitespace_split = True
    return list(lex)


def parse(cmd):
    try:
        return tokenize(cmd)
    except ValueError:
        pass
    # Heredoc bodies (commit messages) often have unbalanced quotes: parse only what comes before them.
    if "<<" in cmd:
        try:
            return tokenize(cmd.split("<<", 1)[0])
        except ValueError:
            pass
    return None


def git_calls(tokens, cwd):
    """Yield (subcommand, directory) for each git invocation, following `cd` and `git -C`."""
    here = cwd
    start = True
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in SEPARATORS:
            start = True
            i += 1
            continue
        if not start:
            i += 1
            continue
        start = False
        if t == "cd" and i + 1 < len(tokens) and tokens[i + 1] not in SEPARATORS:
            here = resolve(here, tokens[i + 1])
            i += 2
            continue
        if t == "git":
            d = here
            j = i + 1
            while j < len(tokens):
                o = tokens[j]
                if o == "-C" and j + 1 < len(tokens):
                    d = resolve(d, tokens[j + 1])
                    j += 2
                elif o in ("-c", "--git-dir", "--work-tree", "--namespace") and j + 1 < len(tokens):
                    j += 2
                elif o.startswith("-"):
                    j += 1
                else:
                    break
            if j < len(tokens):
                yield tokens[j], d
            i = j + 1
            continue
        i += 1


def resolve(base, path):
    if base is None or "$" in path or "`" in path:
        return None  # can't know where this runs
    return os.path.normpath(os.path.join(base, os.path.expanduser(path)))


def run_checks(top):
    def lines(*args):
        out = subprocess.run(["git", "-C", top, *args], capture_output=True, text=True).stdout
        return out.splitlines()

    changed = set(lines("diff", "--cached", "--name-only")) | set(lines("diff", "--name-only"))
    changed |= set(lines("ls-files", "--others", "--exclude-standard"))
    jobs = []
    for sub, check in (("backend", "make check"), ("frontend", "pnpm check")):
        if any(f.startswith(sub + "/") for f in changed):
            p = subprocess.Popen(
                ["nix", "develop", top, "-c", "sh", "-c", check],
                cwd=os.path.join(top, sub), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            jobs.append((sub, check, p))
    failed = []
    for sub, check, p in jobs:
        out, _ = p.communicate()
        if p.returncode != 0:
            failed.append(f"`{check}` failed in {sub}/:\n" + "\n".join(out.splitlines()[-40:]))
    if failed:
        block("Commit blocked — fix this, then commit again.\n\n" + "\n\n".join(failed))


def main():
    data = json.load(sys.stdin)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not re.search(r"\bgit\b", cmd):
        return
    tokens = parse(cmd)
    if tokens is None:
        if re.search(r"\bgit\b[^\n]*\b(commit|push)\b", cmd):
            block("Could not parse this command. Commit with a plain `git -C <absolute path> commit -m ...`.")
        return
    for sub, d in git_calls(tokens, data.get("cwd") or os.getcwd()):
        if sub == "push":
            block("git push is not allowed here: this project's loop commits locally only.")
        if sub == "commit":
            if d is None:
                block("Can't tell which checkout this commits in. Use `git -C <absolute path> commit ...`.")
            top = subprocess.run(["git", "-C", d, "rev-parse", "--show-toplevel"], capture_output=True, text=True)
            if top.returncode == 0:
                run_checks(top.stdout.strip())


main()
