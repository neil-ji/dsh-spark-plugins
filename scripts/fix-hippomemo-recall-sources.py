#!/usr/bin/env python3
"""One-shot sanitizer: strip non-v0-whitelist members (`query`, `memoryIds`)
from hippomemo-context recall plugin sources inside DSH session logs
(session.jsonl.zstd). Each modified file is backed up as session.jsonl.zstd.bak.
"""
import json
import os
import subprocess
import sys
import tempfile

SESSIONS_ROOT = os.path.expanduser('~/.dsh/sessions')
BAD_PLUGIN = 'hippomemo-context'
STRIP_KEYS = ('query', 'memoryIds')


def find_bad_sources(obj):
    """Yield dicts that are plugin sources of the offending shape."""
    if isinstance(obj, dict):
        if obj.get('kind') == 'plugin' and obj.get('plugin') == BAD_PLUGIN:
            yield obj
        for v in obj.values():
            yield from find_bad_sources(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from find_bad_sources(v)


def sanitize_file(path):
    try:
        raw = subprocess.run(['zstd', '-dc', path], check=True,
                             capture_output=True).stdout
    except subprocess.CalledProcessError as exc:
        return 'skip (decompress failed: %s)' % exc.stderr.decode()[:80]
    changed = 0
    out_lines = []
    for line in raw.splitlines(keepends=True):
        stripped = line.strip()
        if not stripped:
            out_lines.append(line)
            continue
        try:
            event = json.loads(stripped)
        except json.JSONDecodeError:
            out_lines.append(line)
            continue
        n = 0
        for src in find_bad_sources(event):
            for key in STRIP_KEYS:
                if key in src:
                    del src[key]
                    n += 1
        if n:
            changed += 1
            new = json.dumps(event, ensure_ascii=False, separators=(',', ':'))
            out_lines.append(new.encode('utf-8') + b'\n')
        else:
            out_lines.append(line)
    if changed == 0:
        return 'clean'
    backup = path + '.bak'
    if not os.path.exists(backup):
        with open(path, 'rb') as f:
            data = f.read()
        with open(backup, 'wb') as f:
            f.write(data)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix='.zst')
    with os.fdopen(fd, 'wb') as f:
        f.write(b''.join(out_lines))
    subprocess.run(['zstd', '-q', '-f', tmp, '-o', path], check=True)
    os.unlink(tmp)
    return 'fixed (%d events, backup: %s)' % (changed, os.path.basename(backup))


def main():
    fixed = clean = skipped = 0
    for dirpath, _dirnames, filenames in os.walk(SESSIONS_ROOT):
        if 'session.jsonl.zstd' not in filenames:
            continue
        path = os.path.join(dirpath, 'session.jsonl.zstd')
        result = sanitize_file(path)
        if result.startswith('fixed'):
            fixed += 1
            print('%s: %s' % (os.path.basename(dirpath), result))
        elif result == 'clean':
            clean += 1
        else:
            skipped += 1
            print('%s: %s' % (os.path.basename(dirpath), result))
    print('\nsummary: fixed=%d clean=%d skipped=%d' % (fixed, clean, skipped))


if __name__ == '__main__':
    sys.exit(main())
