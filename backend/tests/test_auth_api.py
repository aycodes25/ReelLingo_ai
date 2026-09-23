from fastapi.testclient import TestClient
from fastapi import FastAPI, Depends
from app.main import app
from app.security import get_current_user_id
import app.routers.auth as auth_module
import app.security as security_module


class FakeUser:
    def __init__(self, user_id):
        self.id = user_id


class FakeSession:
    def __init__(self, token):
        self.access_token = token


class FakeAuthResult:
    def __init__(self, user_id, token):
        self.user = FakeUser(user_id)
        self.session = FakeSession(token)


class FakeAuthClient:
    def sign_up(self, credentials):
        return FakeAuthResult("user-123", "fake-token-signup")

    def sign_in_with_password(self, credentials):
        return FakeAuthResult("user-123", "fake-token-login")

    def sign_out(self):
        return None


class FakeSupabaseClient:
    def __init__(self):
        self.auth = FakeAuthClient()


def test_signup_returns_user_and_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_client", lambda: FakeSupabaseClient())
    client = TestClient(app)

    response = client.post(
        "/auth/signup", json={"email": "creator@example.com", "password": "s3cret123"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_id"] == "user-123"
    assert body["access_token"] == "fake-token-signup"


def test_login_returns_user_and_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_client", lambda: FakeSupabaseClient())
    client = TestClient(app)

    response = client.post(
        "/auth/login", json={"email": "creator@example.com", "password": "s3cret123"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == "user-123"
    assert body["access_token"] == "fake-token-login"


def test_get_current_user_id_rejects_missing_header():
    test_app = FastAPI()

    @test_app.get("/protected")
    def protected(user_id: str = Depends(get_current_user_id)):
        return {"user_id": user_id}

    client = TestClient(test_app)
    response = client.get("/protected")
    assert response.status_code == 401


def test_get_current_user_id_rejects_invalid_token(monkeypatch):
    test_app = FastAPI()

    @test_app.get("/protected")
    def protected(user_id: str = Depends(get_current_user_id)):
        return {"user_id": user_id}

    class FailingAuthClient:
        def get_user(self, token):
            raise Exception("invalid token")

    class FailingSupabaseClient:
        def __init__(self):
            self.auth = FailingAuthClient()

    monkeypatch.setattr(security_module, "_client", lambda: FailingSupabaseClient())

    client = TestClient(test_app)
    response = client.get("/protected", headers={"Authorization": "Bearer badtoken"})
    assert response.status_code == 401


def test_signup_failure_returns_400(monkeypatch):
    class FailingAuthClient:
        def sign_up(self, credentials):
            raise Exception("Email already registered")

    class FailingSupabaseClient:
        def __init__(self):
            self.auth = FailingAuthClient()

    monkeypatch.setattr(auth_module, "_client", lambda: FailingSupabaseClient())
    client = TestClient(app)

    response = client.post("/auth/signup", json={"email": "creator@example.com", "password": "s3cret123"})

    assert response.status_code == 400


def test_login_failure_returns_401(monkeypatch):
    class FailingAuthClient:
        def sign_in_with_password(self, credentials):
            raise Exception("Invalid login credentials")

    class FailingSupabaseClient:
        def __init__(self):
            self.auth = FailingAuthClient()

    monkeypatch.setattr(auth_module, "_client", lambda: FailingSupabaseClient())
    client = TestClient(app)

    response = client.post("/auth/login", json={"email": "creator@example.com", "password": "wrongpassword"})

    assert response.status_code == 401
