import json
import urllib.request
import urllib.error


BASE = "http://127.0.0.1:5173"


def call(path, payload=None, method=None, headers=None):
    url = BASE + path

    data = json.dumps(payload).encode() if payload is not None else None

    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))

    req.add_header("Content-Type", "application/json")

    for k, v in (headers or {}).items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()[:300]

    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

    except Exception as e:
        return None, "TRANSPORT FAIL: %s: %s" % (type(e).__name__, e)


print("health           :", call("/api/health"))


print("csrf             :", call("/api/auth/me"), call("/api/auth/google-config"), call("/api/auth/login", {"login":"inexistente@exemplo.com","senha":"errada123","tipo_esperado":"aluno"}))
