"""Real email sending via Emergent's managed Resend integration (replaces
enviarEmailMock). The platform owns the provider account and the From address;
we set the display name (EMAIL_FROM_NAME) and never touch provider keys.

"""

import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse


import httpx


logger = logging.getLogger(__name__)


# Emergent managed email proxy — a CONSTANT, never read from env (survives deployment).
EMAIL_BASE_URL = "https://integrations.emergentagent.com"


def _env_required(name: str) -> str:
    """Read a required env var, or raise a clear error at send time.

    Read lazily (not at import): dotenv runs in server.py's startup, so an import-time
    lookup breaks `python -c "import server"` and any other entry point that has not
    loaded the .env yet — with a bare KeyError that says nothing about where it came
    from.
    """
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"{name} não configurado. Preencha backend/.env e reinicie o backend."
        )
    return value


# ---------- Guardrail gate (G2 + G3 structural checks — call on every send) ----------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")


_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",

             "send us your password", "enter your password below", "confirm your card number",

             "your full card number", "seed phrase", "recovery phrase", "verify your card",

             "social security number", "confirm your bank details")


_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)



def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False

    try:
        ipaddress.ip_address(host)

        return False

    except ValueError:
        pass

    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)



def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)



class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()

        self.tags, self.urls, self.anchors = set(), [], []

        self._href, self._text = None, []


    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())

        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]

        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")

            self._text = []


    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)


    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))

            self._href, self._text = None, []



def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()

    scan.feed(html)

    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")

    body = f"{subject}\n{html}".lower()

    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")

    for url in scan.urls:
        low = url.strip().lower()

        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue

        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")

        host = urlparse(low).hostname or ""

        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")

    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""

        if not real:
            continue

        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


# ---------- Send (async, non-blocking) ----------
async def send_email(*, to: str, subject: str, html: str) -> str | None:
    """Send one transactional email; returns the provider id. Raises on failure —
    callers decide whether a per-recipient failure fails the batch."""
    _assert_safe_email(subject, html)

    payload = {"to": [to], "subject": subject, "html": html, "from_name": _env_required("EMAIL_FROM_NAME")}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(

                f"{EMAIL_BASE_URL}/api/v1/email/send",

                headers={"X-Email-Key": _env_required("EMERGENT_EMAIL_KEY")},

                json=payload,

            )

        resp.raise_for_status()

        return resp.json().get("id")

    except httpx.HTTPStatusError as e:
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)

        raise

    except Exception as e:
        logger.error("Email send error: %s", str(e))

        raise


# ---------- Server-side template (G4: callers pass IDs, never markup) ----------
def comunicados_email_html(titulo: str, mensagem: str, urgente: bool, turma_nome: str, autor_nome: str) -> str:
    """Fixed PT-BR announcement template — all interpolated values escaped."""
    tag = (
        '<span style="background:#DC2626;color:#fff;font-size:12px;padding:2px 10px;'

        'border-radius:999px">URGENTE</span>'

        if urgente

        else ""

    )

    body = escape(mensagem).replace("\n", "<br>")

    return (

        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'

        f'<tr><td style="padding:24px;font-family:Arial,sans-serif;background:#F8FAFC">'

        f'<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;'

        f'background:#fff;border:1px solid #E2E8F0;border-radius:12px">'

        f'<tr><td style="background:#090D16;border-radius:12px 12px 0 0;padding:20px 24px">'

        f'<span style="color:#38BDF8;font-size:13px;font-weight:bold;letter-spacing:2px">'

        f'GESTÃO ESPORTIVA ESCOLAR</span></td></tr>'

        f'<tr><td style="padding:24px">'

        f'<p style="margin:0 0 4px;color:#64748B;font-size:13px">Comunicado — {escape(turma_nome)} {tag}</p>'

        f'<h1 style="margin:0 0 12px;color:#0F172A;font-size:20px">{escape(titulo)}</h1>'

        f'<p style="margin:0 0 16px;color:#0F172A;font-size:15px;line-height:1.6">{body}</p>'

        f'<p style="margin:0;color:#64748B;font-size:13px">Enviado por {escape(autor_nome)}</p>'

        f'</td></tr>'

        f'<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0">'

        f'<p style="margin:0;font-size:12px;color:#94A3B8">Enviado por {escape(os.environ.get("EMAIL_FROM_NAME", "Gestão Esportiva Escolar"))}'

        f' via Gestão Esportiva Escolar. Nunca pedimos senhas ou dados de cartão por e-mail.</p>'

        f'</td></tr></table></td></tr></table>'

    )
