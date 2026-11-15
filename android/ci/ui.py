#!/usr/bin/env python3
"""Drives Srot on the emulator through the screen, the way a person would. CI only."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PKG = "app.srot.android"


def adb(*args):
    return subprocess.run(["adb", *args], capture_output=True, text=True, errors="replace")


def screen():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    out = adb("exec-out", "cat", "/sdcard/ui.xml").stdout
    if "<?xml" not in out:
        return None
    try:
        return ET.fromstring(out[out.index("<?xml"):].strip())
    except ET.ParseError:
        return None


def find(root, text=None, prefix=None):
    for n in root.iter("node"):
        t, d = n.get("text", ""), n.get("content-desc", "")
        if text is not None and (t == text or d == text):
            return n
        if prefix is not None and (t.startswith(prefix) or d.startswith(prefix)):
            return n
    return None


def crashed():
    out = adb("logcat", "-d", "-b", "crash").stdout
    return PKG in out


def wait_node(timeout, text=None, prefix=None):
    end = time.time() + timeout
    while time.time() < end:
        if crashed():
            print("[ui] the app crashed")
            sys.exit(2)
        root = screen()
        if root is not None:
            n = find(root, text, prefix)
            if n is not None:
                return n
        time.sleep(1)
    return None


def visible_texts():
    root = screen()
    if root is None:
        return "(screen could not be read)"
    seen = []
    for n in root.iter("node"):
        for v in (n.get("text", ""), n.get("content-desc", "")):
            if v and v not in seen:
                seen.append(v)
    return " | ".join(seen)[:1500]


def tap(timeout, text=None, prefix=None):
    n = wait_node(timeout, text, prefix)
    if n is None:
        print(f"[ui] not found on screen: {text or prefix!r}")
        print(f"[ui] on screen: {visible_texts()}")
        return 1
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    print(f"[ui] tapped {n.get('text') or n.get('content-desc')!r}")
    return 0


def wait_log(pattern, timeout, fail=None):
    end = time.time() + timeout
    while time.time() < end:
        if crashed():
            print("[ui] the app crashed")
            return 2
        out = adb("logcat", "-d", "-s", "Srot:V").stdout
        m = re.search(pattern, out)
        if m:
            print("[ui] log:", out[m.start():].splitlines()[0])
            return 0
        if fail:
            f = re.search(fail, out)
            if f:
                print("[ui] log (failure):", out[f.start():].splitlines()[0])
                return 1
        time.sleep(2)
    print(f"[ui] timed out waiting for log {pattern!r}")
    return 1


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "tap":
        sys.exit(tap(float(args[1]), text=args[0]))
    if cmd == "tap-prefix":
        sys.exit(tap(float(args[1]), prefix=args[0]))
    if cmd == "wait-text":
        sys.exit(0 if wait_node(float(args[1]), text=args[0]) is not None else 1)
    if cmd == "wait-log":
        sys.exit(wait_log(args[0], float(args[1]), args[2] if len(args) > 2 else None))
    sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
