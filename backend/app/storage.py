from supabase import create_client, Client
from app.config import settings

BUCKET_NAME = "reellingo-videos"


def get_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_key)


def upload_file(path: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    client = get_client()
    client.storage.from_(BUCKET_NAME).upload(path, data, {"content-type": content_type})
    return path


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    client = get_client()
    response = client.storage.from_(BUCKET_NAME).create_signed_url(path, expires_in)
    return response["signedURL"]
