"""Examine email_queue collection for documents missing _id or id fields."""

import asyncio
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from pymongo import MongoClient
from pymongo.errors import PyMongoError


def main():
    # Connect to MongoDB
    uri = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "gestao_esportiva_escolar")

    print(f"Connecting to MongoDB at {uri}, database: {db_name}")
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client[db_name]

    # Check email_queue collection
    collection = db.email_queue
    print(f"\nTotal documents in email_queue: {collection.count_documents({})}")

    # Find documents missing _id
    missing_id = collection.find({"_id": {"$exists": False}})
    missing_id_list = list(missing_id)
    print(f"\nDocuments missing _id: {len(missing_id_list)}")

    # Find documents missing id field
    missing_id_field = collection.find({"id": {"$exists": False}})
    missing_id_field_list = list(missing_id_field)
    print(f"Documents missing id field: {len(missing_id_field_list)}")

    # Find documents missing BOTH _id and id
    missing_both = collection.find({"_id": {"$exists": False}, "id": {"$exists": False}})
    missing_both_list = list(missing_both)
    print(f"Documents missing BOTH _id and id: {len(missing_both_list)}")

    # Show details of malformed documents
    if missing_both_list:
        print("\n=== MALFORMED DOCUMENTS (missing both _id and id) ===")
        for i, doc in enumerate(missing_both_list, 1):
            print(f"\nDocument {i}:")
            print(f"  Keys: {list(doc.keys())}")
            print(f"  type: {doc.get('type')}")
            print(f"  to: {doc.get('to')}")
            print(f"  template: {doc.get('template')}")
            print(f"  status: {doc.get('status')}")
            print(f"  created_at: {doc.get('created_at')}")
            if 'data' in doc:
                print(f"  data: {doc['data']}")

    # Check for vitima test accounts
    if missing_both_list:
        print("\n=== CHECKING FOR VITIMA TEST ACCOUNTS ===")
        vitima_docs = []
        for doc in missing_both_list:
            to_email = doc.get('to', '').lower()
            if 'vitima' in to_email:
                vitima_docs.append(doc)
                print(f"\nVitima document found:")
                print(f"  to: {doc.get('to')}")
                print(f"  type: {doc.get('type')}")
                print(f"  template: {doc.get('template')}")
                print(f"  status: {doc.get('status')}")
                print(f"  created_at: {doc.get('created_at')}")

        if not vitima_docs:
            print("No vitima test accounts found in malformed documents.")

    # Also check all documents for any with vitima in email
    print("\n=== ALL VITIMA DOCUMENTS IN COLLECTION ===")
    all_vitima = collection.find({"to": {"$regex": "vitima", "$options": "i"}})
    vitima_count = 0
    for doc in all_vitima:
        vitima_count += 1
        print(f"\nVitima document {vitima_count}:")
        print(f"  _id: {doc.get('_id', 'MISSING')}")
        print(f"  id: {doc.get('id', 'MISSING')}")
        print(f"  to: {doc.get('to')}")
        print(f"  type: {doc.get('type')}")
        print(f"  template: {doc.get('template')}")
        print(f"  status: {doc.get('status')}")
        print(f"  created_at: {doc.get('created_at')}")

    print(f"\nTotal vitima documents in collection: {vitima_count}")

    # Summary
    print("\n=== SUMMARY ===")
    print(f"Total documents: {collection.count_documents({})}")
    print(f"Missing _id: {len(missing_id_list)}")
    print(f"Missing id field: {len(missing_id_field_list)}")
    print(f"Missing both: {len(missing_both_list)}")

    client.close()


if __name__ == "__main__":
    main()
