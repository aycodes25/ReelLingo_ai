from fastapi import Header, HTTPException
from supabase import create_client
from app.config import settings


def get_current_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")
    client = create_client(settings.supabase_url, settings.supabase_key)
    response = client.auth.get_user(token)
    if response.user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return response.user.id
