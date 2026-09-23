from fastapi import Header, HTTPException
from supabase import create_client, Client
from app.config import settings


def _client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_key)


def get_current_user_id(authorization: str | None = Header(None)) -> str:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        response = _client().auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if response.user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return response.user.id
