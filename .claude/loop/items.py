#!/usr/bin/env python3
"""Backlog items for the loop.

  items.py              JSON list of the `todo` items in order: [{id, title, areas, alone}]
  items.py --show <id>  the item's full section (status, touches, area, acceptance)

An item's `Area:` line holds short tags (e.g. `map, zone-status`): two items with a common tag never run at the same
time. `Parallel: alone` means the item runs with nothing else.
"""
import json
import os
import re
import sys

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs", "backlog.md")
sections = re.split(r"(?m)^(?=### )", open(path, encoding="utf-8").read())
items = []
for sec in sections:
    m = re.match(r"### (\S+) · (.+)", sec)
    if not m:
        continue
    body = re.split(r"(?m)^## ", sec)[0].rstrip()  # stop at the next top-level heading
    field = lambda name: (re.search(rf"(?m)^{name}:\s*(.*)$", body) or [None, ""])[1].strip()
    areas = [a.strip() for a in field("Area").split(",") if a.strip()]
    alone = field("Parallel") == "alone"
    if not areas and not alone:
        alone = True  # no Area tags: we can't know what it clashes with, so it runs by itself
        if field("Status") == "todo":
            print(f"warning: {m[1]} has no Area line; it will run alone", file=sys.stderr)
    items.append({"id": m[1], "title": m[2].strip(), "status": field("Status"), "areas": areas, "alone": alone,
                  "text": body})

if len(sys.argv) == 3 and sys.argv[1] == "--show":
    found = [i for i in items if i["id"] == sys.argv[2]]
    if not found:
        sys.exit(f"no item {sys.argv[2]}")
    print(found[0]["text"])
else:
    todo = [{k: i[k] for k in ("id", "title", "areas", "alone")} for i in items if i["status"] == "todo"]
    print(json.dumps(todo))
