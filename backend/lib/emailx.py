"""Centralized transactional email sending with provider selection:

1. SMTP (preferred when configured) — reads SMTP_HOST, SMTP_PORT, SMTP_USER,
   SMTP_PASS and EMAIL_FROM. Stdlib smtplib + asyncio.to_thread (no extra dep).
2. Resend HTTP API (when RESEND_API_KEY is set) — direct equivalent of the
   Node `new Resend(key).emails.send(...)`, but server-side only so the key
   never reaches the browser. From: EMAIL_FROM (+ EMAIL_FROM_NAME display).
3. Emergent managed integration (last fallback) — the platform-owned provider.

All failures raise EmailSendError with a short actionable reason, so HTTP
handlers can return a 5xx and the frontend can show a real error instead of
a fake success screen.
"""

import asyncio
import ipaddress
import logging
import os
import re
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx


logger = logging.getLogger(__name__)


class EmailSendError(RuntimeError):
    """An email could not be sent. Frontend-facing flows must surface this."""


def _env(name: str) -> str | None:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else None


def smtp_config() -> dict | None:
    """Complete SMTP settings, or None when SMTP is not configured.

    HOST alone is enough (unauthenticated relay); USER requires PASS.
    """
    host = _env("SMTP_HOST")
    if not host:
        return None
    try:
        port = int(_env("SMTP_PORT") or 587)
    except ValueError as exc:
        raise EmailSendError("SMTP_PORT inválido — use uma porta numérica (587, 465 ou 25).") from exc
    user, password = _env("SMTP_USER"), _env("SMTP_PASS")
    if user and not password:
        raise EmailSendError("SMTP_USER está definido mas SMTP_PASS não — configure ambos ou remova SMTP_USER.")
    return {"host": host, "port": port, "user": user, "password": password}


def _smtp_from() -> str:
    return _env("EMAIL_FROM") or _env("SMTP_FROM") or _env("SMTP_USER") or ""


def provider_name() -> str:
    if smtp_config():
        return "smtp"
    if _env("RESEND_API_KEY"):
        return "resend"
    return "emergent"


def _resend_from() -> str:
    """Resend requires a full 'Name <addr>' or bare address From header."""
    name = _env("EMAIL_FROM_NAME") or "Gestão Esportiva Escolar"
    addr = _env("EMAIL_FROM") or _env("RESEND_FROM") or ""
    if not addr:
        return ""
    return f"{name} <{addr}>" if name else addr


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
def _smtp_send_sync(cfg: dict, from_addr: str, from_name: str, to: str, subject: str, html: str) -> None:
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = formataddr((from_name, from_addr))
    message["To"] = to
    message.attach(MIMEText(html, "html", "utf-8"))

    if cfg["port"] == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=30)
    else:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=30)
    try:
        server.ehlo()
        if cfg["port"] != 465:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if cfg["user"] and cfg["password"]:
            server.login(cfg["user"], cfg["password"])
        server.sendmail(from_addr, [to], message.as_string())
    finally:
        try:
            server.quit()
        except Exception:
            pass


async def _send_via_smtp(cfg: dict, to: str, subject: str, html: str) -> str | None:
    from_name = _env("EMAIL_FROM_NAME") or "Gestão Esportiva Escolar"
    from_addr = _smtp_from()
    if not from_addr:
        raise EmailSendError(
            "SMTP configurado, mas sem remetente: defina EMAIL_FROM (ou SMTP_FROM/SMTP_USER) no ambiente."
        )
    # smtplib is blocking; run it off the event loop (Render single-worker setups).
    try:
        await asyncio.to_thread(_smtp_send_sync, cfg, from_addr, from_name, to, subject, html)
    except smtplib.SMTPAuthenticationError as exc:
        raise EmailSendError("SMTP recusou as credenciais (SMTP_USER/SMTP_PASS).") from exc
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        logger.error('{"event": "email_send_failed", "provider": "smtp", "error": "%s"}', str(exc)[:200])
        raise EmailSendError(f"Falha SMTP ao enviar para {to}: {exc.__class__.__name__}") from exc
    return None


# Emergent managed email proxy — a CONSTANT, never read from env (survives deployment).
EMAIL_BASE_URL = "https://integrations.emergentagent.com"


async def _send_via_emergent(to: str, subject: str, html: str) -> str | None:
    key = _env("EMERGENT_EMAIL_KEY")
    if not key:
        raise EmailSendError(
            "Nenhum provedor de e-mail configurado: defina SMTP_HOST (e EMAIL_FROM) "
            "ou EMERGENT_EMAIL_KEY no ambiente do backend."
        )
    payload = {"to": [to], "subject": subject, "html": html, "from_name": _env("EMAIL_FROM_NAME") or "Gestão Esportiva Escolar"}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": key},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error('{"event": "email_send_failed", "provider": "emergent", "status": %d, "body": "%s"}',
                     e.response.status_code, e.response.text[:200])
        raise EmailSendError(f"Provedor de e-mail recusou o envio (HTTP {e.response.status_code}).") from e
    except httpx.HTTPError as e:
        logger.error('{"event": "email_send_failed", "provider": "emergent", "error": "%s"}', str(e)[:200])
        raise EmailSendError("Falha de rede ao contatar o provedor de e-mail.") from e


async def _send_via_resend(to: str, subject: str, html: str) -> str | None:
    """Direct Resend HTTP API (equivalent of the Node `new Resend(key).emails.send`).

    Only called server-side: the API key stays in the Render environment, never
    in the browser bundle — frontend code must hit our HTTP routes instead.
    """
    key = _env("RESEND_API_KEY")
    if not key:
        raise EmailSendError("RESEND_API_KEY não configurada no ambiente do backend.")
    from_addr = _resend_from()
    if not from_addr:
        raise EmailSendError(
            "RESEND_API_KEY configurada, mas sem remetente: defina EMAIL_FROM "
            "(ex.: onboarding@resend.dev no plano de testes) no ambiente."
        )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"from": from_addr, "to": [to], "subject": subject, "html": html},
            )
        if resp.status_code >= 400:
            detail = resp.json().get("message", resp.text[:200]) if resp.headers.get("content-type", "").startswith("application/json") else resp.text[:200]
            logger.error('{"event": "email_send_failed", "provider": "resend", "status": %d, "body": "%s"}', resp.status_code, detail)
            raise EmailSendError(f"Resend recusou o envio (HTTP {resp.status_code}): {detail}")
        return resp.json().get("id")
    except EmailSendError:
        raise
    except httpx.HTTPError as e:
        logger.error('{"event": "email_send_failed", "provider": "resend", "error": "%s"}', str(e)[:200])
        raise EmailSendError("Falha de rede ao contatar o Resend.") from e


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    """Send one transactional email through the configured provider.

    Raises EmailSendError on any failure — callers must not swallow it when the
    HTTP response is supposed to promise delivery. Returns the provider id
    (None for SMTP; the SMTP protocol has no provider id).
    """
    _assert_safe_email(subject, html)
    cfg = smtp_config()
    try:
        if cfg:
            return await _send_via_smtp(cfg, to, subject, html)
        if _env("RESEND_API_KEY"):
            return await _send_via_resend(to, subject, html)
        return await _send_via_emergent(to, subject, html)
    except (EmailSendError, ValueError):
        raise
    except Exception as exc:
        logger.error('{"event": "email_send_unexpected", "provider": "%s", "error": "%s"}', provider_name(), str(exc)[:200])
        raise EmailSendError(f"Falha ao enviar e-mail via {provider_name()}: {exc.__class__.__name__}") from exc


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
