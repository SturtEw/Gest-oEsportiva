"""Pre-flight check do MongoDB usado pela task de debug do VS Code.

Existe como arquivo (e nao `python -c "..."`) porque o PowerShell 5.1 do Windows
remove as aspas duplas dos argumentos passados a executaveis nativos, quebrando

o one-liner e fazendo o pre-check falhar sempre.


Este arquivo e ASCII puro de proposito: o Python no Windows assume latin-1 para

arquivos sem BOM, e acentos nesse docstring causam SyntaxError.

"""
import os
import sys


from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError


load_dotenv(".env")


uri = os.getenv("MONGO_URL")


if not uri:
    print("MONGO_CHECK_FAIL: MONGO_URL nao configurado em backend/.env", file=sys.stderr)

    raise SystemExit(1)


try:
    client = MongoClient(uri, serverSelectionTimeoutMS=4000, connectTimeoutMS=4000)

    client.admin.command("ping")

    client.close()


except PyMongoError as exc:
    print("MONGO_CHECK_FAIL: %s: %s" % (type(exc).__name__, exc), file=sys.stderr)

    raise SystemExit(1)


print("MONGO_CHECK_OK")
