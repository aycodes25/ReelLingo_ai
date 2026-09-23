from fastapi.testclient import TestClient
from app.main import app
import app.routers.auth as auth_module


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
