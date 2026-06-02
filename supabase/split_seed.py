#!/usr/bin/env python3
"""Splits seed_demo.sql into smaller chunks for execute_sql calls.

Statements are kept whole (split only on terminating ';' at end-of-line).
Each chunk is capped at ~MAX_BYTES.

Outputs files named seed_chunks/chunk_NN.sql in order.
"""
import os
import re
import sys

SRC = "supabase/seed_demo.sql"
OUT_DIR = "supabase/seed_chunks"
MAX_BYTES = 400_000

os.makedirs(OUT_DIR, exist_ok=True)
for f in os.listdir(OUT_DIR):
    os.remove(os.path.join(OUT_DIR, f))

with open(SRC) as fp:
    content = fp.read()

# Strip the BEGIN/COMMIT — we'll let each chunk run in its own implicit tx.
content = re.sub(r"^begin;\s*$", "", content, flags=re.MULTILINE)
content = re.sub(r"^commit;\s*$", "", content, flags=re.MULTILINE)

# Split into statements: a statement ends with ';' followed by newline.
# Big multi-row inserts span many lines but end with ';' at end of line.
statements = []
buf = []
for line in content.splitlines(keepends=True):
    buf.append(line)
    stripped = line.rstrip()
    if stripped.endswith(";"):
        stmt = "".join(buf)
        if stmt.strip() and not stmt.strip().startswith("--"):
            statements.append(stmt)
        elif stmt.strip().startswith("--"):
            # keep comments attached to the next statement
            statements.append(stmt)
        buf = []
# any trailing buf (e.g. final comment)
if buf:
    leftover = "".join(buf)
    if leftover.strip():
        statements.append(leftover)

# Group into chunks
chunks = []
current = []
current_size = 0
for stmt in statements:
    size = len(stmt.encode("utf-8"))
    if current and current_size + size > MAX_BYTES:
        chunks.append(current)
        current = []
        current_size = 0
    current.append(stmt)
    current_size += size
if current:
    chunks.append(current)

for i, chunk in enumerate(chunks, 1):
    name = f"{OUT_DIR}/chunk_{i:02d}.sql"
    with open(name, "w") as fp:
        fp.write("".join(chunk))
    sz = os.path.getsize(name)
    print(f"{name}\t{sz:>8} bytes\t{len(chunk):>4} statements")

print(f"\nTotal: {len(chunks)} chunks, {sum(len(c) for c in chunks)} statements")
