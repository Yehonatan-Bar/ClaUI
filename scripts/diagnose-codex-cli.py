#!/usr/bin/env python3
"""
Diagnose why ClaUi cannot find/run the Codex CLI.

What it checks:
- OS / Python / current workspace
- PATH + `where.exe codex` / `which -a codex`
- Common Windows install locations for codex(.cmd/.exe)
- VS Code user/workspace settings for `claudeMirror.codex.cliPath`
- Running `--version` using PATH and configured paths

Usage:
  python scripts/diagnose-codex-cli.py
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


IS_WIN = os.name == "nt"


def hr() -> str:
    return "=" * 78


def section(title: str) -> None:
    print()
    print(hr())
    print(title)
    print(hr())


def run_cmd(
    args: list[str] | str,
    *,
    shell: bool = False,
    timeout: int = 8,
    cwd: str | None = None,
) -> dict[str, Any]:
    try:
        cp = subprocess.run(
            args,
            shell=shell,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return {
            "ok": cp.returncode == 0,
            "returncode": cp.returncode,
            "stdout": cp.stdout.strip(),
            "stderr": cp.stderr.strip(),
            "cmd": args if isinstance(args, str) else " ".join(args),
        }
    except FileNotFoundError as e:
        return {
            "ok": False,
            "returncode": None,
            "stdout": "",
            "stderr": str(e),
            "cmd": args if isinstance(args, str) else " ".join(args),
        }
    except subprocess.TimeoutExpired as e:
        return {
            "ok": False,
            "returncode": None,
            "stdout": (e.stdout or "").strip() if isinstance(e.stdout, str) else "",
            "stderr": f"Timeout after {timeout}s",
            "cmd": args if isinstance(args, str) else " ".join(args),
        }
    except Exception as e:  # pragma: no cover - diagnostic script
        return {
            "ok": False,
            "returncode": None,
            "stdout": "",
            "stderr": f"{type(e).__name__}: {e}",
            "cmd": args if isinstance(args, str) else " ".join(args),
        }


def print_cmd_result(label: str, result: dict[str, Any]) -> None:
    status = "OK" if result["ok"] else "FAIL"
    print(f"[{status}] {label}: {result['cmd']}")
    print(f"  returncode: {result['returncode']}")
    if result["stdout"]:
        print("  stdout:")
        for line in result["stdout"].splitlines():
            print(f"    {line}")
    if result["stderr"]:
        print("  stderr:")
        for line in result["stderr"].splitlines():
            print(f"    {line}")


def parse_json_loose(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def extract_setting_from_file(settings_path: Path, key: str) -> tuple[str, str | None, str | None]:
    if not settings_path.exists():
        return ("missing", None, None)

    try:
        raw = settings_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return ("read_error", None, str(e))

    parsed = parse_json_loose(raw)
    if parsed is not None and key in parsed:
        value = parsed.get(key)
        return ("json", str(value) if value is not None else None, None)

    # Fallback regex for VS Code JSON with comments/trailing commas.
    match = re.search(r'"claudeMirror\.codex\.cliPath"\s*:\s*"([^"]*)"', raw)
    if match:
        return ("regex", match.group(1), None)

    return ("not_set", None, None)


def is_path_like_cli(value: str) -> bool:
    if not value:
        return False
    if any(sep in value for sep in ("/", "\\")):
        return True
    lower = value.lower()
    return lower.endswith((".exe", ".cmd", ".bat", ".ps1"))


def probe_cli_command(cli_value: str, *, cwd: str | None = None) -> dict[str, Any]:
    cli_value = (cli_value or "").strip()
    if not cli_value:
        return {"label": "empty", "ok": False, "note": "Empty value"}

    if IS_WIN:
        # cmd.exe handles .cmd/.bat consistently.
        probe = run_cmd(f'"{cli_value}" --version', shell=True, cwd=cwd)
    else:
        probe = run_cmd([cli_value, "--version"], cwd=cwd)

    return {
        "label": cli_value,
        "ok": probe["ok"],
        "result": probe,
    }


def get_path_entries() -> list[str]:
    raw = os.environ.get("PATH", "")
    return [p for p in raw.split(os.pathsep) if p]


def which_all_codex() -> list[str]:
    if IS_WIN:
        result = run_cmd(["where.exe", "codex"])
    else:
        result = run_cmd("which -a codex", shell=True)
    if not result["stdout"]:
        return []
    lines = [line.strip() for line in result["stdout"].splitlines() if line.strip()]
    deduped: list[str] = []
    for line in lines:
        if line not in deduped:
            deduped.append(line)
    return deduped


def common_windows_codex_candidates() -> list[Path]:
    if not IS_WIN:
        return []
    env = os.environ
    appdata = env.get("APPDATA", "")
    localapp = env.get("LOCALAPPDATA", "")
    userprofile = env.get("USERPROFILE", str(Path.home()))
    candidates = [
        Path(appdata) / "npm" / "codex.cmd",
        Path(appdata) / "npm" / "codex.exe",
        Path(appdata) / "npm" / "codex",
        Path(userprofile) / ".npm-global" / "bin" / "codex.cmd",
        Path(userprofile) / ".npm-global" / "bin" / "codex.exe",
        Path(localapp) / "Programs" / "Codex" / "codex.exe",
        Path(localapp) / "Programs" / "OpenAI Codex" / "codex.exe",
        Path(userprofile) / "scoop" / "shims" / "codex.cmd",
        Path(userprofile) / "scoop" / "shims" / "codex.exe",
    ]
    # Deduplicate while preserving order.
    seen: set[str] = set()
    out: list[Path] = []
    for c in candidates:
        s = str(c)
        if s not in seen:
            seen.add(s)
            out.append(c)
    return out


def vscode_settings_candidates(workspace: Path) -> list[tuple[str, Path]]:
    items: list[tuple[str, Path]] = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        for name in ("Code", "Code - Insiders", "Cursor", "VSCodium"):
            items.append((f"{name} User", Path(appdata) / name / "User" / "settings.json"))
    items.append(("Workspace .vscode/settings.json", workspace / ".vscode" / "settings.json"))

    for p in workspace.glob("*.code-workspace"):
        items.append((f"Workspace file {p.name}", p))
    return items


def read_official_codex_extension_presence() -> list[Path]:
    home = Path.home()
    bases = [
        home / ".vscode" / "extensions",
        home / ".vscode-insiders" / "extensions",
        home / ".cursor" / "extensions",
    ]
    found: list[Path] = []
    for base in bases:
        if not base.exists():
            continue
        for child in base.iterdir():
            name = child.name.lower()
            if "codex" in name:
                found.append(child)
    return found


def main() -> int:
    workspace = Path.cwd()
    now = _dt.datetime.now().isoformat(timespec="seconds")

    section("Codex CLI Diagnostic (ClaUi)")
    print(f"Timestamp: {now}")
    print(f"Platform : {platform.platform()}")
    print(f"Python   : {sys.version.split()[0]}")
    print(f"CWD      : {workspace}")
    print(f"OS       : {'Windows' if IS_WIN else os.name}")

    section("PATH / Command Discovery")
    path_entries = get_path_entries()
    print(f"PATH entries count: {len(path_entries)}")
    for i, entry in enumerate(path_entries[:12], start=1):
        print(f"  {i:02d}. {entry}")
    if len(path_entries) > 12:
        print(f"  ... ({len(path_entries) - 12} more)")

    if IS_WIN:
        appdata_npm = str(Path(os.environ.get("APPDATA", "")) / "npm")
        print(f"APPDATA\\npm in PATH: {any(p.lower() == appdata_npm.lower() for p in path_entries if appdata_npm)}")

    which_first = shutil.which("codex")
    print(f"shutil.which('codex'): {which_first or '<not found>'}")

    where_result = run_cmd(["where.exe", "codex"]) if IS_WIN else run_cmd("which -a codex", shell=True)
    print_cmd_result("where.exe codex" if IS_WIN else "which -a codex", where_result)

    all_found = which_all_codex()
    if all_found:
        print("Discovered codex candidates from PATH:")
        for p in all_found:
            print(f"  - {p}")
    else:
        print("No codex candidates discovered from PATH.")

    if IS_WIN:
        print()
        print("Common Windows candidate locations:")
        existing_common: list[Path] = []
        for c in common_windows_codex_candidates():
            exists = c.exists()
            if exists:
                existing_common.append(c)
            print(f"  [{'OK' if exists else '--'}] {c}")
    else:
        existing_common = []

    section("VS Code / ClaUi Settings (claudeMirror.codex.cliPath)")
    key = "claudeMirror.codex.cliPath"
    configured_values: list[tuple[str, str]] = []
    for label, settings_path in vscode_settings_candidates(workspace):
        status, value, err = extract_setting_from_file(settings_path, key)
        print(f"{label}: {settings_path}")
        if status == "missing":
            print("  - file not found")
        elif status == "read_error":
            print(f"  - read error: {err}")
        elif status == "not_set":
            print("  - setting not set")
        elif status in ("json", "regex"):
            print(f"  - {key} = {value!r} (parsed via {status})")
            if value is not None:
                configured_values.append((label, value))
        else:
            print(f"  - unexpected status: {status}")

    section("Probe Codex CLI (--version)")
    probe_targets: list[tuple[str, str]] = []
    probe_targets.append(("PATH target", "codex"))
    for label, value in configured_values:
        probe_targets.append((f"Configured in {label}", value))
    for c in all_found:
        probe_targets.append(("PATH-discovered full path", c))
    for c in existing_common:
        probe_targets.append(("Common Windows location", str(c)))

    # Deduplicate by actual command string.
    seen_probe_values: set[str] = set()
    deduped_targets: list[tuple[str, str]] = []
    for label, value in probe_targets:
        val = (value or "").strip()
        if not val or val in seen_probe_values:
            continue
        seen_probe_values.add(val)
        deduped_targets.append((label, val))

    working_targets: list[str] = []
    for label, cmd in deduped_targets:
        probe = probe_cli_command(cmd, cwd=str(workspace))
        result = probe.get("result")
        if result:
            print_cmd_result(label, result)
            if probe.get("ok"):
                working_targets.append(cmd)
        else:
            print(f"[FAIL] {label}: {probe.get('note', 'unknown')}")

    section("Official Codex VS Code Extension (FYI)")
    ext_hits = read_official_codex_extension_presence()
    if not ext_hits:
        print("No locally-detected VS Code/Cursor extension folders containing 'codex'.")
    else:
        print("Detected extension folders containing 'codex' (FYI only):")
        for p in ext_hits:
            print(f"  - {p}")
        print("Note: This does NOT make the `codex` CLI command available to ClaUi.")

    section("Recommended Next Step")
    configured_user = next((v for (lbl, v) in configured_values if "User" in lbl), None)
    configured_workspace = next((v for (lbl, v) in configured_values if "Workspace" in lbl), None)

    if working_targets:
        preferred = working_targets[0]
        print("[GOOD] A working Codex CLI was found.")
        print(f"Use this in ClaUi setting `claudeMirror.codex.cliPath`: {preferred!r}")
        if preferred == "codex":
            print("If ClaUi still fails, restart VS Code completely (not only window reload) and retry.")
        print("Then run in a NEW terminal:")
        if IS_WIN and preferred != "codex" and preferred.lower().endswith((".cmd", ".bat")):
            print(f'  "{preferred}" login')
        else:
            print(f"  {preferred} login")
    else:
        print("[ACTION NEEDED] No working Codex CLI was found.")
        if all_found or existing_common:
            print("A file may exist but is not runnable as `codex`. Set `claudeMirror.codex.cliPath` to a full path shown above.")
        else:
            print("Install the Codex CLI first, then rerun this script.")
            print("Install guide: https://github.com/openai/codex")
        print("Windows quick checks:")
        print("  1. Open a new PowerShell window")
        print("  2. Run: where.exe codex")
        print("  3. If found, copy the full path into `claudeMirror.codex.cliPath`")
        print("  4. Run: codex login (or the full path + login)")

    print()
    print("Share the full output above if you want help interpreting it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

