"""
106u 登录代理：账号登录 → 返回最近玩过的区服 → 选区后取 js_gameVars。

启动:  python 106u_game_auth.py
默认:  http://127.0.0.1:8765
"""
from __future__ import annotations

import json
import os
import re
import secrets
import time
import threading
from pathlib import Path
from typing import Any

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

GAME_ID = "376"
GAME_PAGE = f"http://www.106u.com/game/{GAME_ID}"
LOGIN_URL = "http://www.106u.com/home.php"
PLAY_URL = "http://www.106u.com/game.php"
DEFAULT_PLATFORM = "106u"

# 挂机配置按平台+账号落盘（跨设备同步真源）
_DATA_DIR = Path(__file__).resolve().parent / "user_data"
_FILE_LOCKS: dict[str, threading.Lock] = {}
_FILE_LOCKS_GUARD = threading.Lock()

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/151.0.0.0 Safari/537.36"
    ),
    "Referer": GAME_PAGE,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
}

# session_id -> {http: requests.Session, created: float, username: str}
_SESSIONS: dict[str, dict[str, Any]] = {}
_SESSIONS_LOCK = threading.Lock()
SESSION_TTL_SEC = 30 * 60


def _cleanup_sessions() -> None:
    now = time.time()
    with _SESSIONS_LOCK:
        dead = [k for k, v in _SESSIONS.items() if now - v["created"] > SESSION_TTL_SEC]
        for k in dead:
            _SESSIONS.pop(k, None)


def _store_session(http: requests.Session, username: str = "") -> str:
    _cleanup_sessions()
    sid = secrets.token_hex(16)
    with _SESSIONS_LOCK:
        _SESSIONS[sid] = {
            "http": http,
            "created": time.time(),
            "username": (username or "").strip(),
        }
    return sid


def _get_session(sid: str) -> requests.Session | None:
    _cleanup_sessions()
    with _SESSIONS_LOCK:
        item = _SESSIONS.get(sid)
        if not item:
            return None
        item["created"] = time.time()
        return item["http"]


def _get_session_user(sid: str) -> str | None:
    """返回 session 绑定的平台账号；无效则 None。"""
    _cleanup_sessions()
    with _SESSIONS_LOCK:
        item = _SESSIONS.get(sid)
        if not item:
            return None
        item["created"] = time.time()
        user = (item.get("username") or "").strip()
        return user or None


def _new_http() -> requests.Session:
    s = requests.Session()
    s.headers.update(DEFAULT_HEADERS)
    return s


def _safe_name(s: str) -> str:
    return re.sub(r"[^\w.-]", "_", (s or "").strip()) or "_empty"


def _config_path(platform: str, account: str) -> Path:
    return _DATA_DIR / _safe_name(platform) / f"{_safe_name(account)}.json"


def _file_lock(path: Path) -> threading.Lock:
    key = str(path)
    with _FILE_LOCKS_GUARD:
        lock = _FILE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _FILE_LOCKS[key] = lock
        return lock


def load_user_config(platform: str, account: str) -> dict[str, Any] | None:
    path = _config_path(platform, account)
    lock = _file_lock(path)
    with lock:
        if not path.is_file():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None


def save_user_config(platform: str, account: str, config: dict[str, Any]) -> dict[str, Any]:
    path = _config_path(platform, account)
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = dict(config)
    blob["schemaVersion"] = int(blob.get("schemaVersion") or 1)
    blob["platform"] = platform
    blob["account"] = account
    blob["updatedAt"] = int(time.time())
    if not isinstance(blob.get("profiles"), list):
        blob["profiles"] = []
    lock = _file_lock(path)
    with lock:
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(blob, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    return blob


def delete_user_config(platform: str, account: str) -> bool:
    path = _config_path(platform, account)
    lock = _file_lock(path)
    with lock:
        if not path.is_file():
            return False
        path.unlink()
        return True


def parse_recent_servers(html: str) -> list[dict[str, str]]:
    """从游戏详情页解析「我最近玩过的游戏」。"""
    servers: list[dict[str, str]] = []
    seen: set[str] = set()

    section_m = re.search(r"我最近玩过的游戏[\s\S]*?</div>", html)
    chunk = section_m.group(0) if section_m else html

    pattern = re.compile(
        r'href="[^"]*game\.php\?action=play&game_id=(\d+)&server_id=(\d+)"[^>]*>\s*([^<]+)',
        re.I,
    )
    for m in pattern.finditer(chunk):
        game_id, server_id, name = m.group(1), m.group(2), m.group(3)
        name = re.sub(r"\s+", " ", name).strip()
        if not name or server_id in seen:
            continue
        seen.add(server_id)
        servers.append(
            {
                "game_id": game_id,
                "server_id": server_id,
                "name": name,
                "play_url": (
                    f"{PLAY_URL}?action=play&game_id={game_id}&server_id={server_id}"
                ),
            }
        )
    return servers


def _extract_balanced_object(text: str, start: int) -> str | None:
    """从 text[start]=='{' 起做括号配对，忽略字符串内的括号。"""
    if start < 0 or start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    quote = ""
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                in_str = False
            continue
        if ch in ("'", '"'):
            in_str = True
            quote = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _strip_js_comments(s: str) -> str:
    out: list[str] = []
    i = 0
    n = len(s)
    in_str = False
    quote = ""
    escape = False
    while i < n:
        ch = s[i]
        if in_str:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                in_str = False
            i += 1
            continue
        if ch in ("'", '"'):
            in_str = True
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n:
            nxt = s[i + 1]
            if nxt == "/":
                i += 2
                while i < n and s[i] not in "\r\n":
                    i += 1
                continue
            if nxt == "*":
                i += 2
                while i + 1 < n and not (s[i] == "*" and s[i + 1] == "/"):
                    i += 1
                i = min(i + 2, n)
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def js_object_to_dict(js_obj_str: str) -> dict[str, Any]:
    text = _strip_js_comments(js_obj_str)
    text = re.sub(r"'", '"', text)
    text = re.sub(r",\s*}", "}", text)
    text = re.sub(r",\s*]", "]", text)
    text = re.sub(r"([{\s,])([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', text)
    return json.loads(text)


_FIELD_RE = re.compile(
    r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"
    r'(?:"((?:\\.|[^"\\])*)"|\'((?:\\.|[^\'\\])*)\'|(true|false|null|-?\d+(?:\.\d+)?))'
)


def parse_js_object_fields(obj_str: str) -> dict[str, Any]:
    """不依赖完整 JSON：逐字段抽取（容忍注释、尾逗号）。"""
    text = _strip_js_comments(obj_str)
    result: dict[str, Any] = {}
    for m in _FIELD_RE.finditer(text):
        key = m.group(1)
        if m.group(2) is not None:
            result[key] = m.group(2)
        elif m.group(3) is not None:
            result[key] = m.group(3)
        else:
            raw = m.group(4)
            if raw == "true":
                result[key] = True
            elif raw == "false":
                result[key] = False
            elif raw == "null":
                result[key] = None
            else:
                result[key] = raw
    return result


def extract_login_php_url(html_play: str) -> str | None:
    patterns = [
        re.compile(r'https://rk\.yscq-wy\.yscq\.com/\d+/login\.php\?[^"\']+', re.I),
        re.compile(r'https?://[^"\']+/login\.php\?[^"\']+', re.I),
        # frameset / iframe
        re.compile(r'(?:src|SRC)\s*=\s*["\'](https?://[^"\']*login\.php\?[^"\']+)["\']'),
    ]
    for p in patterns:
        m = p.search(html_play)
        if m:
            return m.group(1) if m.lastindex else m.group(0)
    return None


def extract_js_game_vars(game_html: str) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """
    返回 (vars, debug)。
    解析顺序：字段抽取 → JSON → 关键字段正则兜底。
    """
    debug: dict[str, Any] = {
        "html_len": len(game_html),
        "has_js_gameVars": "js_gameVars" in game_html,
        "method": None,
        "parse_error": None,
        "snippet": None,
        "field_keys": None,
    }
    m = re.search(r"(?:var\s+)?js_gameVars\s*=\s*\{", game_html)
    if not m:
        # 再试无空格的写法
        m = re.search(r"js_gameVars\s*=\s*\{", game_html, re.I)
    if not m:
        debug["snippet"] = game_html[:800]
        return None, debug

    brace_at = game_html.find("{", m.start())
    obj = _extract_balanced_object(game_html, brace_at)
    if not obj:
        debug["parse_error"] = "括号配对失败"
        debug["snippet"] = game_html[m.start() : m.start() + 600]
        return None, debug

    debug["snippet"] = obj[:600]
    debug["obj_len"] = len(obj)

    # 1) 字段级解析（最稳）
    try:
        fields = parse_js_object_fields(obj)
        debug["field_keys"] = list(fields.keys())
        if fields.get("token") and (fields.get("username") or fields.get("serverid")):
            debug["method"] = "fields"
            return fields, debug
        if fields.get("token"):
            debug["method"] = "fields_partial"
            return fields, debug
    except Exception as e:
        debug["parse_error"] = f"fields: {e}"

    # 2) JSON 兼容转换
    try:
        data = js_object_to_dict(obj)
        debug["method"] = "json"
        return data, debug
    except Exception as e:
        debug["parse_error"] = f"json: {e}"

    # 3) 关键字段正则兜底
    fallback: dict[str, Any] = {}
    for key in (
        "ip", "username", "token", "serverid", "sNum", "platform",
        "APIlocation", "client", "channel", "qudao", "is_adult", "appid",
    ):
        mm = re.search(
            rf'{key}\s*:\s*["\']([^"\']*)["\']',
            obj,
        )
        if mm:
            fallback[key] = mm.group(1)
        else:
            mm2 = re.search(rf"{key}\s*:\s*(true|false)", obj)
            if mm2:
                fallback[key] = mm2.group(1) == "true"
    if fallback.get("token"):
        debug["method"] = "regex_fallback"
        debug["field_keys"] = list(fallback.keys())
        return fallback, debug

    return None, debug


def do_login(username: str, password: str) -> dict[str, Any]:
    """步骤1~3 + 解析最近玩过的区服。"""
    http = _new_http()

    # 1) 初始化 PHPSESSID
    resp_init = http.get(GAME_PAGE, timeout=30)
    if resp_init.status_code != 200:
        return {"ok": False, "error": f"初始化详情页失败: HTTP {resp_init.status_code}"}

    # 2) 登录
    resp_login = http.post(
        LOGIN_URL,
        data={
            "action": "login_ok",
            "member_username": username,
            "member_password": password,
        },
        timeout=30,
    )
    try:
        login_ret = resp_login.json()
    except Exception:
        return {"ok": False, "error": "登录接口返回非 JSON", "raw": resp_login.text[:300]}

    if login_ret.get("status") != 1:
        return {"ok": False, "error": "登录失败", "login": login_ret}

    # 3) 刷新详情页（更新登录态，页面含「我最近玩过的游戏」）
    resp_reload = http.get(GAME_PAGE, timeout=30)
    if resp_reload.status_code != 200:
        return {"ok": False, "error": f"刷新详情页失败: HTTP {resp_reload.status_code}"}

    servers = parse_recent_servers(resp_reload.text)
    sid = _store_session(http, username)
    return {
        "ok": True,
        "session_id": sid,
        "username": username,
        "servers": servers,
        "login": login_ret,
    }


def do_enter(session_id: str, server_id: str, game_id: str | None = None) -> dict[str, Any]:
    """原步骤4~5：进服 → login.php → 提取 js_gameVars。"""
    http = _get_session(session_id)
    if not http:
        return {"ok": False, "error": "会话已过期，请重新登录"}

    gid = game_id or GAME_ID
    url_play = f"{PLAY_URL}?action=play&game_id={gid}&server_id={server_id}"
    resp_play = http.get(url_play, timeout=30)
    if resp_play.status_code != 200:
        return {"ok": False, "error": f"进入游戏失败: HTTP {resp_play.status_code}"}

    login_php_url = extract_login_php_url(resp_play.text)
    if not login_php_url:
        _save_debug_html("play", resp_play.text)
        return {
            "ok": False,
            "error": "未提取到 login.php 链接",
            "hint": resp_play.text[:800],
            "play_len": len(resp_play.text),
        }

    # 访问 login.php：带上游戏页 Referer，更接近浏览器
    resp_game = http.get(
        login_php_url,
        headers={**DEFAULT_HEADERS, "Referer": url_play},
        timeout=30,
    )
    game_html = resp_game.text or ""
    print(
        f"[enter] login_php={login_php_url}\n"
        f"[enter] status={resp_game.status_code} len={len(game_html)} "
        f"has_js_gameVars={'js_gameVars' in game_html}",
        flush=True,
    )

    js_game_vars, debug = extract_js_game_vars(game_html)
    print(
        f"[enter] parse method={debug.get('method')} err={debug.get('parse_error')} "
        f"keys={debug.get('field_keys')}",
        flush=True,
    )
    if debug.get("snippet"):
        print(f"[enter] snippet:\n{debug['snippet'][:500]}", flush=True)

    if not js_game_vars:
        path = _save_debug_html("login_php", game_html)
        return {
            "ok": False,
            "error": "未找到 js_gameVars（token 可能已过期）",
            "login_php_url": login_php_url,
            "http_status": resp_game.status_code,
            "debug": debug,
            "debug_file": path,
            "hint": game_html[:800],
        }

    return {
        "ok": True,
        "login_php_url": login_php_url,
        "js_gameVars": js_game_vars,
        "debug": {"method": debug.get("method"), "keys": list(js_game_vars.keys())},
    }


def _save_debug_html(tag: str, html: str) -> str:
    path = f"_debug_{tag}.html"
    try:
        with open(path, "w", encoding="utf-8", errors="replace") as f:
            f.write(html)
    except Exception as e:
        return f"(save failed: {e})"
    return path


@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return resp


@app.route("/api/health", methods=["GET", "OPTIONS"])
def api_health():
    if request.method == "OPTIONS":
        return ("", 204)
    return jsonify({"ok": True})


@app.route("/api/login", methods=["POST", "OPTIONS"])
def api_login():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"ok": False, "error": "请输入账号和密码"}), 400
    try:
        result = do_login(username, password)
    except requests.RequestException as e:
        return jsonify({"ok": False, "error": f"网络错误: {e}"}), 502
    status = 200 if result.get("ok") else 400
    return jsonify(result), status


@app.route("/api/enter", methods=["POST", "OPTIONS"])
def api_enter():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    session_id = (data.get("session_id") or "").strip()
    server_id = str(data.get("server_id") or "").strip()
    game_id = str(data.get("game_id") or GAME_ID).strip()
    if not session_id or not server_id:
        return jsonify({"ok": False, "error": "缺少 session_id 或 server_id"}), 400
    try:
        result = do_enter(session_id, server_id, game_id)
    except requests.RequestException as e:
        return jsonify({"ok": False, "error": f"网络错误: {e}"}), 502
    status = 200 if result.get("ok") else 400
    return jsonify(result), status


@app.route("/api/user-config", methods=["GET", "PUT", "DELETE", "OPTIONS"])
def api_user_config():
    """按平台+账号读写挂机方案。

    身份：优先有效 session_id；会话过期或未传时用 account（读写均不强制会话）。
    """
    if request.method == "OPTIONS":
        return ("", 204)

    if request.method == "GET":
        session_id = (request.args.get("session_id") or "").strip()
        account = (request.args.get("account") or "").strip()
        platform = (request.args.get("platform") or DEFAULT_PLATFORM).strip() or DEFAULT_PLATFORM
        data = {}
    else:
        data = request.get_json(silent=True) or {}
        session_id = (data.get("session_id") or "").strip()
        account = (data.get("account") or "").strip()
        platform = (data.get("platform") or DEFAULT_PLATFORM).strip() or DEFAULT_PLATFORM

    username = _get_session_user(session_id) if session_id else None
    session_valid = bool(username)
    if not username:
        username = account

    if not username:
        return jsonify({"ok": False, "error": "缺少 account 或有效 session_id"}), 400

    if request.method == "GET":
        cfg = load_user_config(platform, username)
        return jsonify({
            "ok": True,
            "username": username,
            "platform": platform,
            "config": cfg,
            "session_valid": session_valid,
        })

    if request.method == "DELETE":
        deleted = delete_user_config(platform, username)
        return jsonify({"ok": True, "deleted": deleted, "username": username, "platform": platform})

    # PUT
    config = data.get("config")
    if not isinstance(config, dict):
        return jsonify({"ok": False, "error": "缺少 config 对象"}), 400

    cfg_account = (config.get("account") or "").strip()
    if cfg_account and cfg_account != username:
        return jsonify({"ok": False, "error": "config.account 与请求账号不一致"}), 403

    cfg_platform = (config.get("platform") or platform).strip() or platform
    if cfg_platform != platform:
        return jsonify({"ok": False, "error": "config.platform 与请求 platform 不一致"}), 400

    saved = save_user_config(platform, username, config)
    return jsonify({"ok": True, "config": saved})


def main_cli() -> None:
    """本地命令行调试（固定账号）。"""
    username = "lovelkj"
    password = "lovelkj"
    print("=== CLI 登录 ===")
    ret = do_login(username, password)
    print(json.dumps(ret, ensure_ascii=False, indent=2))
    if not ret.get("ok"):
        return
    servers = ret.get("servers") or []
    if not servers:
        print("没有最近玩过的区服")
        return
    picked = servers[0]
    print(f"\n=== 进入区服: {picked['name']} ({picked['server_id']}) ===")
    ent = do_enter(ret["session_id"], picked["server_id"], picked.get("game_id"))
    if not ent.get("ok"):
        print(json.dumps(ent, ensure_ascii=False, indent=2))
        return
    vars_ = ent["js_gameVars"]
    print("==== js_gameVars 关键字段 ====")
    for k in ("username", "serverid", "sNum", "token", "APIlocation", "platform"):
        print(f"{k}: {vars_.get(k)}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "cli":
        main_cli()
    else:
        print("Auth API: http://127.0.0.1:8765")
        print("  POST /api/login, /api/enter")
        print("  GET|PUT|DELETE /api/user-config  (platform+account 挂机方案)")
        print(f"  user_data: {_DATA_DIR}")
        print("CLI debug: python 106u_game_auth.py cli")
        app.run(host="127.0.0.1", port=8765, debug=False, threaded=True)
