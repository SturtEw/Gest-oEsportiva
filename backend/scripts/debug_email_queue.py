"""Examine email_queue collection in detail."""

import os
import sys
from pymongo import MongoClient

uri = os.getenv("MONGO_URL", "mongodb://localhost:27017")
db_name = os.getenv("DB_NAME", "gestao_esportiva_escolar")

client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client[db_name]
collection = db.email_queue

print(f"=== ALL DOCUMENTS IN email_queue ===")
for doc in collection.find({}):
    print(f"\nDocument:")
    print(f"  _id: {doc.get('_id', 'MISSING')}")
    print(f"  id: {doc.get('id', 'MISSING')}")
    print(f"  to: {doc.get('to')}")
    print(f"  type: {doc.get('type')}")
    print(f"  template: {doc.get('template')}")
    print(f"  status: {doc.get('status')}")
    print(f"  created_at: {doc.get('created_at')}")
    print(f"  All keys: {list(doc.keys())}")

print(f"\n=== Testing worker query with _id projection ===")
cursor = collection.find(
    {"status": "pending"},
    {"_id": 0}
)
print("With {'_id': 0} projection (current worker code):")
for doc in cursor.limit(8):
    print(f"  _id in doc: {'_id' in doc}")
    print(f"  id in doc: {'id' in doc}")
    print(f"  qid would be: {doc.get('id') or doc.get('_id')}")

print("\nWith no projection (or {'_id': 1}):")
cursor = collection.find(
    {"status": "pending"},
    {"_id": 1}
)
for doc in cursor.limit(8):
    print(f"  _id in doc: {'_id' in doc}")
    print(f"  id in doc: {'id' in doc}")
    print(f"  qid would be: {doc.get('id') or doc.get('_id')}")

client.close()
