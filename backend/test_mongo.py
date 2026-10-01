from dotenv import load_dotenv
import os
from pymongo import MongoClient


load_dotenv(".env")
uri = os.getenv("MONGO_URL")


assert uri, "MONGO_URL is not configured"


client = MongoClient(uri, serverSelectionTimeoutMS=2000, connectTimeoutMS=2000)


client.admin.command("ping")


client.close()


print("MongoDB OK")
