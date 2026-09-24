from unittest.mock import MagicMock
from app import storage


def test_upload_file_calls_supabase_storage(monkeypatch):
    fake_bucket = MagicMock()
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "get_client", lambda: fake_client)

    result = storage.upload_file("jobs/1/output.mp4", b"video-bytes", "video/mp4")

    assert result == "jobs/1/output.mp4"
    fake_client.storage.from_.assert_called_once_with(storage.BUCKET_NAME)
    fake_bucket.upload.assert_called_once_with(
        "jobs/1/output.mp4", b"video-bytes", {"content-type": "video/mp4"}
    )


def test_get_signed_url_returns_url(monkeypatch):
    fake_bucket = MagicMock()
    fake_bucket.create_signed_url.return_value = {"signedURL": "https://example.test/signed"}
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "get_client", lambda: fake_client)

    url = storage.get_signed_url("jobs/1/output.mp4")

    assert url == "https://example.test/signed"
    fake_bucket.create_signed_url.assert_called_once_with("jobs/1/output.mp4", 3600)
