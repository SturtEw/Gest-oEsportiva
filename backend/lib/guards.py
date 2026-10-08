"""Guards e formatadores compartilhados entre routers.

Antes cada router redefinia o próprio `_require_teacher` (4 cópias idênticas em
analytics.py, class_activities.py, class_enrollment.py e subgroups.py). Uma
divergência futura aí significaria uma rota aceitando professor pendente/inativo.
Mantido em um só lugar para que a regra tenha uma única fonte de verdade.
"""

from fastapi import HTTPException

from models.models import User


def require_teacher(user: User) -> None:
    """Apenas professor aprovado (status ativo)."""
    if user.tipo != "professor" or user.status != "ativo":
        raise HTTPException(status_code=403, detail="Acesso disponível somente para professores aprovados")


def format_duration(seconds: int | None) -> str | None:
    """Duração legível: '1h 05min', '12min 30s' ou '45s'. None em entrada nula.

    Era duplicado como _fmt_duration (analytics.py) e _duration_text (subgroups.py).
    """
    if seconds is None:
        return None
    minutes, sec = divmod(max(0, int(seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}min"
    if minutes:
        return f"{minutes}min {sec:02d}s"
    return f"{sec}s"
