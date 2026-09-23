from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    user_id: str
    access_token: str


def _client():
    return create_client(settings.supabase_url, settings.supabase_key)


@router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(payload: SignupRequest):
    result = _client().auth.sign_up({"email": payload.email, "password": payload.password})
    if result.user is None or result.session is None:
        raise HTTPException(status_code=400, detail="Signup failed")
    return AuthResponse(user_id=result.user.id, access_token=result.session.access_token)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    result = _client().auth.sign_in_with_password(
        {"email": payload.email, "password": payload.password}
    )
    if result.user is None or result.session is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return AuthResponse(user_id=result.user.id, access_token=result.session.access_token)


@router.post("/logout", status_code=204)
def logout():
    _client().auth.sign_out()
    return None
