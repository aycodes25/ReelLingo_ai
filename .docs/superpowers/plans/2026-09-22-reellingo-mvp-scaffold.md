# ReelLingo MVP Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a runnable ReelLingo MVP: a Next.js frontend and a FastAPI backend that together run the full video-dubbing pipeline (upload → extract audio → transcribe → translate → dub → merge → subtitles) end-to-end locally using mocked AI adapters, backed by a real Supabase project for Postgres/Auth/Storage.

**Architecture:** Two services in a monorepo — `backend/` (FastAPI, SQLAlchemy, Supabase Postgres/Storage/Auth, FFmpeg via subprocess) and `frontend/` (Next.js App Router, TypeScript, Tailwind). Each AI/payment integration (Whisper, DeepL, ElevenLabs, Paystack/Stripe) is wrapped in an adapter with a `MOCK_MODE` flag so it runs without paid API keys and can be flipped to real calls later with no code changes.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.x, pytest, supabase-py, openai, deepl, elevenlabs SDKs, FFmpeg (subprocess). Next.js 14 (App Router), TypeScript, Tailwind CSS.

## Global Constraints

- `MOCK_MODE` defaults to `true`; when true, `transcribe`/`translate`/`dub` return canned data instead of calling paid APIs.
- Storage uses Supabase Storage (not Cloudflare R2) — one external service (Supabase) covers Postgres, Auth, and Storage.
- No SQLite fallback for real local persistence — the app's own `DATABASE_URL` must point at Supabase Postgres to run for real. Tests are the only place SQLite (in-memory or temp-file) is used, purely as a fast, isolated stand-in for the ORM layer.
- Paystack/Stripe checkout is stubbed, not implemented, in this scaffold — no real payment collection code.
- FFmpeg must be installed and on `PATH` — `extract_audio` and `merge` always run for real, in both mock and non-mock mode.
- Max upload size referenced in validation: 2GB (per `readme.md`).
- Frontend has no automated test framework in this scaffold — verification is manual (run dev server, exercise the flow).

---

### Task 1: Backend project skeleton

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/pytest.ini`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.config.settings` (a `Settings` instance with fields `database_url: str`, `supabase_url: str`, `supabase_key: str`, `mock_mode: bool`, `openai_api_key: str`, `deepl_api_key: str`, `elevenlabs_api_key: str`), and `app.main.app` (the FastAPI instance), both imported by every later backend task.

- [ ] **Step 1: Create the Python dependency list**

Create `backend/requirements.txt`:

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
sqlalchemy==2.0.35
psycopg2-binary==2.9.9
pydantic-settings==2.5.2
supabase==2.9.1
python-multipart==0.0.12
openai==1.51.0
deepl==1.19.1
elevenlabs==1.9.0
pytest==8.3.3
httpx==0.27.2
```

- [ ] **Step 2: Install dependencies**

Run (from `backend/`):
```bash
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
```
Expected: install completes with no errors.

- [ ] **Step 3: Write the failing test**

Create `backend/tests/__init__.py` (empty file).

Create `backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it fails**

Run (from `backend/`): `pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app'` (or `app.main` not found).

- [ ] **Step 5: Create pytest config so `app` is importable**

Create `backend/pytest.ini`:

```ini
[pytest]
pythonpath = .
```

- [ ] **Step 6: Implement config and app**

Create `backend/app/__init__.py` (empty file).

Create `backend/app/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./local.db"
    supabase_url: str = ""
    supabase_key: str = ""
    mock_mode: bool = True
    openai_api_key: str = ""
    deepl_api_key: str = ""
    elevenlabs_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
```

Create `backend/app/main.py`:

```python
from fastapi import FastAPI

app = FastAPI(title="ReelLingo API")


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/test_health.py -v`
Expected: PASS (1 passed).

- [ ] **Step 8: Create the env template**

Create `backend/.env.example`:

```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
SUPABASE_KEY=[YOUR-SUPABASE-SERVICE-ROLE-OR-ANON-KEY]
MOCK_MODE=true
OPENAI_API_KEY=
DEEPL_API_KEY=
ELEVENLABS_API_KEY=
```

- [ ] **Step 9: Commit**

```bash
git add backend/requirements.txt backend/.env.example backend/pytest.ini backend/app/__init__.py backend/app/config.py backend/app/main.py backend/tests/__init__.py backend/tests/test_health.py
git commit -m "$(cat <<'EOF'
Scaffold FastAPI backend skeleton with health check

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Database models and connection

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: `app.config.settings` (Task 1).
- Produces: `app.db.Base` (SQLAlchemy declarative base), `app.db.engine`, `app.db.SessionLocal` (sessionmaker), `app.db.get_db` (FastAPI dependency yielding a `Session`), `app.models.Job` (columns: `id: int`, `user_id: str | None`, `status: str`, `current_step: str`, `source_language: str`, `target_language: str`, `voice_clone: bool`, `input_storage_path: str`, `output_video_path: str | None`, `output_srt_path: str | None`, `error_message: str | None`, `created_at: datetime`), `app.models.Subscription` (columns: `id: int`, `user_id: str`, `tier: str`, `videos_used_this_month: int`, `max_video_minutes: int`, `max_videos_per_month: int`). Used by every task that touches persistence (3 does not, 4 does not, 5 does not, 6, 7, 8 all do).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_models.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db import Base
from app.models import Job


def test_create_and_query_job():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine)
    session = TestSession()

    job = Job(
        status="queued",
        current_step="queued",
        source_language="yo",
        target_language="en",
        voice_clone=True,
        input_storage_path="uploads/test.mp4",
    )
    session.add(job)
    session.commit()

    fetched = session.query(Job).first()
    assert fetched.source_language == "yo"
    assert fetched.target_language == "en"
    assert fetched.voice_clone is True
    assert fetched.status == "queued"
    session.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db'`.

- [ ] **Step 3: Implement db.py**

Create `backend/app/db.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 4: Implement models.py**

Create `backend/app/models.py`:

```python
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, func
from app.db import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default="queued")
    current_step = Column(String, nullable=False, default="queued")
    source_language = Column(String, nullable=False)
    target_language = Column(String, nullable=False)
    voice_clone = Column(Boolean, nullable=False, default=False)
    input_storage_path = Column(String, nullable=False)
    output_video_path = Column(String, nullable=True)
    output_srt_path = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=False, unique=True)
    tier = Column(String, nullable=False, default="free")
    videos_used_this_month = Column(Integer, nullable=False, default=0)
    max_video_minutes = Column(Integer, nullable=False, default=3)
    max_videos_per_month = Column(Integer, nullable=False, default=1)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (1 passed).

- [ ] **Step 6: Wire table creation into app startup**

Modify `backend/app/main.py` to:

```python
from fastapi import FastAPI
from app.db import Base, engine
from app import models  # noqa: F401  (registers models with Base)

app = FastAPI(title="ReelLingo API")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Run full test suite to confirm nothing broke**

Run: `pytest -v`
Expected: 2 passed (`test_health.py`, `test_models.py`).

- [ ] **Step 8: Commit**

```bash
git add backend/app/db.py backend/app/models.py backend/app/main.py backend/tests/test_models.py
git commit -m "$(cat <<'EOF'
Add SQLAlchemy models and Postgres connection for jobs and subscriptions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: FFmpeg pipeline stages (extract audio, merge)

**Files:**
- Create: `backend/app/pipeline/__init__.py`
- Create: `backend/app/pipeline/extract_audio.py`
- Create: `backend/app/pipeline/merge.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_ffmpeg_pipeline.py`

**Interfaces:**
- Produces: `extract_audio(video_path: str, output_audio_path: str) -> str` and `merge_audio_video(video_path: str, audio_path: str, output_video_path: str) -> str`, both used by `app.worker` (Task 6). Produces the `sample_video` pytest fixture (a 2-second synthetic mp4 with video+audio, path as `str`), used by Tasks 3, 6, and 7's tests.

**Prerequisite:** FFmpeg must be installed and on `PATH`, built with `libx264`/`aac` support (e.g. the gyan.dev "full" builds on Windows, or `apt install ffmpeg` on Linux).

- [ ] **Step 1: Add the shared test fixture**

Create `backend/tests/conftest.py`:

```python
import subprocess
import pytest


@pytest.fixture
def sample_video(tmp_path):
    video_path = tmp_path / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-c:v", "libx264", "-c:a", "aac", "-shortest",
            str(video_path),
        ],
        check=True,
        capture_output=True,
    )
    return str(video_path)
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_ffmpeg_pipeline.py`:

```python
import os
from app.pipeline.extract_audio import extract_audio
from app.pipeline.merge import merge_audio_video


def test_extract_audio_creates_wav_file(tmp_path, sample_video):
    output_path = str(tmp_path / "audio.wav")
    result = extract_audio(sample_video, output_path)
    assert result == output_path
    assert os.path.exists(output_path)
    assert os.path.getsize(output_path) > 0


def test_merge_audio_video_creates_output_file(tmp_path, sample_video):
    audio_path = str(tmp_path / "audio.wav")
    extract_audio(sample_video, audio_path)
    output_path = str(tmp_path / "merged.mp4")

    result = merge_audio_video(sample_video, audio_path, output_path)

    assert result == output_path
    assert os.path.exists(output_path)
    assert os.path.getsize(output_path) > 0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_ffmpeg_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.pipeline'`.

- [ ] **Step 4: Implement the pipeline package and stages**

Create `backend/app/pipeline/__init__.py` (empty file).

Create `backend/app/pipeline/extract_audio.py`:

```python
import subprocess


def extract_audio(video_path: str, output_audio_path: str) -> str:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "44100",
            output_audio_path,
        ],
        check=True,
        capture_output=True,
    )
    return output_audio_path
```

Create `backend/app/pipeline/merge.py`:

```python
import subprocess


def merge_audio_video(video_path: str, audio_path: str, output_video_path: str) -> str:
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path, "-i", audio_path,
            "-c:v", "copy", "-map", "0:v:0", "-map", "1:a:0", "-shortest",
            output_video_path,
        ],
        check=True,
        capture_output=True,
    )
    return output_video_path
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_ffmpeg_pipeline.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/pipeline/__init__.py backend/app/pipeline/extract_audio.py backend/app/pipeline/merge.py backend/tests/conftest.py backend/tests/test_ffmpeg_pipeline.py
git commit -m "$(cat <<'EOF'
Add FFmpeg audio extraction and merge pipeline stages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Mocked AI pipeline adapters (transcribe, translate, dub, subtitles)

**Files:**
- Create: `backend/app/pipeline/types.py`
- Create: `backend/app/pipeline/transcribe.py`
- Create: `backend/app/pipeline/translate.py`
- Create: `backend/app/pipeline/dub.py`
- Create: `backend/app/pipeline/subtitles.py`
- Test: `backend/tests/test_ai_adapters_mock.py`

**Interfaces:**
- Consumes: `app.config.settings.mock_mode` (Task 1) as the `mock_mode` argument callers pass in.
- Produces: `TranscriptSegment` (a `TypedDict` with `start: float`, `end: float`, `text: str`); `transcribe(audio_path: str, source_language: str, mock_mode: bool) -> list[TranscriptSegment]`; `translate(segments: list[TranscriptSegment], target_language: str, mock_mode: bool) -> list[TranscriptSegment]`; `dub(segments: list[TranscriptSegment], source_audio_path: str, output_path: str, voice_id: str, mock_mode: bool) -> str`; `generate_srt(segments: list[TranscriptSegment]) -> str`. All four are used by `app.worker` (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ai_adapters_mock.py`:

```python
from app.pipeline.transcribe import transcribe
from app.pipeline.translate import translate
from app.pipeline.dub import dub
from app.pipeline.subtitles import generate_srt


def test_transcribe_mock_mode_returns_placeholder_segment():
    segments = transcribe("unused/path.wav", "yo", mock_mode=True)
    assert len(segments) == 1
    assert "yo" in segments[0]["text"]
    assert segments[0]["start"] == 0.0


def test_translate_mock_mode_prefixes_text():
    segments = [{"start": 0.0, "end": 4.0, "text": "hello"}]
    translated = translate(segments, "es", mock_mode=True)
    assert "es" in translated[0]["text"]
    assert "hello" in translated[0]["text"]
    assert translated[0]["start"] == 0.0


def test_dub_mock_mode_copies_source_audio(tmp_path):
    source = tmp_path / "source.wav"
    source.write_bytes(b"fake-audio-bytes")
    output = tmp_path / "dubbed.wav"

    result_path = dub([], str(source), str(output), voice_id="default", mock_mode=True)

    assert result_path == str(output)
    assert output.read_bytes() == b"fake-audio-bytes"


def test_generate_srt_formats_timestamps():
    segments = [{"start": 0.0, "end": 1.5, "text": "Hello"}]
    srt = generate_srt(segments)
    assert "00:00:00,000 --> 00:00:01,500" in srt
    assert "Hello" in srt
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_ai_adapters_mock.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.pipeline.transcribe'`.

- [ ] **Step 3: Implement the shared segment type**

Create `backend/app/pipeline/types.py`:

```python
from typing import TypedDict


class TranscriptSegment(TypedDict):
    start: float
    end: float
    text: str
```

- [ ] **Step 4: Implement transcribe.py**

Create `backend/app/pipeline/transcribe.py`:

```python
import os
from openai import OpenAI
from app.pipeline.types import TranscriptSegment


def transcribe(audio_path: str, source_language: str, mock_mode: bool) -> list[TranscriptSegment]:
    if mock_mode:
        return [
            {
                "start": 0.0,
                "end": 4.0,
                "text": f"[mock transcript in {source_language}] Hello, this is a placeholder transcript.",
            }
        ]

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    with open(audio_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=source_language,
            response_format="verbose_json",
        )
    return [
        {"start": segment["start"], "end": segment["end"], "text": segment["text"].strip()}
        for segment in response.segments
    ]
```

- [ ] **Step 5: Implement translate.py**

Create `backend/app/pipeline/translate.py`:

```python
import os
import deepl
from app.pipeline.types import TranscriptSegment


def translate(
    segments: list[TranscriptSegment], target_language: str, mock_mode: bool
) -> list[TranscriptSegment]:
    if mock_mode:
        return [
            {**segment, "text": f"[mock translation to {target_language}] {segment['text']}"}
            for segment in segments
        ]

    translator = deepl.Translator(os.environ["DEEPL_API_KEY"])
    translated: list[TranscriptSegment] = []
    for segment in segments:
        result = translator.translate_text(segment["text"], target_lang=target_language)
        translated.append({**segment, "text": result.text})
    return translated
```

- [ ] **Step 6: Implement dub.py**

Create `backend/app/pipeline/dub.py`:

```python
import os
import shutil
from elevenlabs.client import ElevenLabs
from app.pipeline.types import TranscriptSegment


def dub(
    segments: list[TranscriptSegment],
    source_audio_path: str,
    output_path: str,
    voice_id: str,
    mock_mode: bool,
) -> str:
    if mock_mode:
        shutil.copyfile(source_audio_path, output_path)
        return output_path

    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    full_text = " ".join(segment["text"] for segment in segments)
    audio = client.text_to_speech.convert(voice_id=voice_id, text=full_text)
    with open(output_path, "wb") as f:
        for chunk in audio:
            f.write(chunk)
    return output_path
```

- [ ] **Step 7: Implement subtitles.py**

Create `backend/app/pipeline/subtitles.py`:

```python
from app.pipeline.types import TranscriptSegment


def _format_timestamp(seconds: float) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    milliseconds = int(round((secs % 1) * 1000))
    return f"{int(hours):02d}:{int(minutes):02d}:{int(secs):02d},{milliseconds:03d}"


def generate_srt(segments: list[TranscriptSegment]) -> str:
    lines = []
    for index, segment in enumerate(segments, start=1):
        lines.append(str(index))
        lines.append(f"{_format_timestamp(segment['start'])} --> {_format_timestamp(segment['end'])}")
        lines.append(segment["text"])
        lines.append("")
    return "\n".join(lines)
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest tests/test_ai_adapters_mock.py -v`
Expected: PASS (4 passed).

- [ ] **Step 9: Commit**

```bash
git add backend/app/pipeline/types.py backend/app/pipeline/transcribe.py backend/app/pipeline/translate.py backend/app/pipeline/dub.py backend/app/pipeline/subtitles.py backend/tests/test_ai_adapters_mock.py
git commit -m "$(cat <<'EOF'
Add mocked transcribe/translate/dub/subtitle pipeline adapters

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Supabase Storage helper

**Files:**
- Create: `backend/app/storage.py`
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Consumes: `app.config.settings` (Task 1).
- Produces: `BUCKET_NAME: str`, `get_client() -> supabase.Client`, `upload_file(path: str, data: bytes, content_type: str = "application/octet-stream") -> str` (returns `path` unchanged), `get_signed_url(path: str, expires_in: int = 3600) -> str`. Used by `app.worker` (Task 6) and `app.routers.jobs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_storage.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.storage'`.

- [ ] **Step 3: Implement storage.py**

Create `backend/app/storage.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_storage.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/storage.py backend/tests/test_storage.py
git commit -m "$(cat <<'EOF'
Add Supabase Storage upload/signed-URL helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Worker orchestration

**Files:**
- Create: `backend/app/worker.py`
- Test: `backend/tests/test_worker.py`

**Interfaces:**
- Consumes: `app.db` module (`Base`, `SessionLocal`, accessed via `import app.db as db_module` so tests can monkeypatch `SessionLocal`), `app.models.Job` (Task 2); `extract_audio`, `merge_audio_video` (Task 3); `transcribe`, `translate`, `dub`, `generate_srt` (Task 4); `app.storage` module (`upload_file`) (Task 5); `app.config.settings.mock_mode` (Task 1).
- Produces: `run_pipeline(job_id: int, local_video_path: str) -> None`. Opens its own DB session (does not receive one as a parameter), so it is safe to call from a `BackgroundTasks` callback after the request's own session has closed. Used by `app.routers.jobs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_worker.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app import db as db_module
from app.models import Job
from app import worker


def _setup_test_db(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    db_module.Base.metadata.create_all(bind=engine)
    db_module.SessionLocal = sessionmaker(bind=engine)
    return db_module.SessionLocal


def _create_queued_job(SessionLocal):
    session = SessionLocal()
    job = Job(
        status="queued",
        current_step="queued",
        source_language="yo",
        target_language="en",
        voice_clone=False,
        input_storage_path="uploads/test.mp4",
    )
    session.add(job)
    session.commit()
    job_id = job.id
    session.close()
    return job_id


def test_run_pipeline_success(tmp_path, sample_video, monkeypatch):
    SessionLocal = _setup_test_db(tmp_path)
    monkeypatch.setattr(
        "app.storage.upload_file",
        lambda path, data, content_type="application/octet-stream": path,
    )
    job_id = _create_queued_job(SessionLocal)

    worker.run_pipeline(job_id, sample_video)

    session = SessionLocal()
    result = session.get(Job, job_id)
    assert result.status == "done"
    assert result.current_step == "done"
    assert result.output_video_path == f"jobs/{job_id}/output.mp4"
    assert result.output_srt_path == f"jobs/{job_id}/subtitles.srt"
    session.close()


def test_run_pipeline_failure_marks_job_failed(tmp_path, sample_video, monkeypatch):
    SessionLocal = _setup_test_db(tmp_path)
    monkeypatch.setattr(
        "app.storage.upload_file",
        lambda path, data, content_type="application/octet-stream": path,
    )

    def _boom(*args, **kwargs):
        raise RuntimeError("ffmpeg exploded")

    monkeypatch.setattr("app.worker.extract_audio", _boom)
    job_id = _create_queued_job(SessionLocal)

    worker.run_pipeline(job_id, sample_video)

    session = SessionLocal()
    result = session.get(Job, job_id)
    assert result.status == "failed"
    assert "ffmpeg exploded" in result.error_message
    session.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_worker.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.worker'`.

- [ ] **Step 3: Implement worker.py**

Create `backend/app/worker.py`:

```python
import os
import tempfile
from app import db as db_module
from app import storage
from app.models import Job
from app.config import settings
from app.pipeline.extract_audio import extract_audio
from app.pipeline.merge import merge_audio_video
from app.pipeline.transcribe import transcribe
from app.pipeline.translate import translate
from app.pipeline.dub import dub
from app.pipeline.subtitles import generate_srt


def run_pipeline(job_id: int, local_video_path: str) -> None:
    session = db_module.SessionLocal()
    try:
        job = session.get(Job, job_id)
        if job is None:
            return

        try:
            with tempfile.TemporaryDirectory() as workdir:
                job.status = "processing"
                job.current_step = "extracting_audio"
                session.commit()
                audio_path = extract_audio(local_video_path, os.path.join(workdir, "audio.wav"))

                job.current_step = "transcribing"
                session.commit()
                segments = transcribe(audio_path, job.source_language, settings.mock_mode)

                job.current_step = "translating"
                session.commit()
                translated_segments = translate(segments, job.target_language, settings.mock_mode)

                job.current_step = "dubbing"
                session.commit()
                dubbed_audio_path = dub(
                    translated_segments,
                    audio_path,
                    os.path.join(workdir, "dubbed_audio.wav"),
                    voice_id="default",
                    mock_mode=settings.mock_mode,
                )

                job.current_step = "merging"
                session.commit()
                output_video_path = merge_audio_video(
                    local_video_path, dubbed_audio_path, os.path.join(workdir, "output.mp4")
                )

                job.current_step = "generating_subtitles"
                session.commit()
                srt_content = generate_srt(translated_segments)

                with open(output_video_path, "rb") as f:
                    video_storage_path = storage.upload_file(
                        f"jobs/{job_id}/output.mp4", f.read(), "video/mp4"
                    )
                srt_storage_path = storage.upload_file(
                    f"jobs/{job_id}/subtitles.srt", srt_content.encode("utf-8"), "text/plain"
                )

                job.output_video_path = video_storage_path
                job.output_srt_path = srt_storage_path
                job.status = "done"
                job.current_step = "done"
                session.commit()
        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)
            session.commit()
    finally:
        session.close()
        if os.path.exists(local_video_path):
            os.remove(local_video_path)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_worker.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/worker.py backend/tests/test_worker.py
git commit -m "$(cat <<'EOF'
Add pipeline worker that orchestrates job stages and updates job status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Auth (Supabase Auth wrapper)

**Files:**
- Create: `backend/app/security.py`
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/auth.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth_api.py`

**Interfaces:**
- Consumes: `app.config.settings` (Task 1).
- Produces: `app.security.get_current_user_id` (a FastAPI dependency: reads the `Authorization: Bearer <token>` header, validates it against Supabase Auth, returns the user's `id: str`, or raises `HTTPException(401)`), and the `auth` router mounted at `/auth` with `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`. `get_current_user_id` is used by `app.routers.jobs` (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_auth_api.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_auth_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.routers'`.

- [ ] **Step 3: Implement security.py**

Create `backend/app/security.py`:

```python
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
```

- [ ] **Step 4: Implement the auth router**

Create `backend/app/routers/__init__.py` (empty file).

Create `backend/app/routers/auth.py`:

```python
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
```

- [ ] **Step 5: Register the auth router and CORS in main.py**

Modify `backend/app/main.py` to:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db import Base, engine
from app import models  # noqa: F401  (registers models with Base)
from app.routers import auth

app = FastAPI(title="ReelLingo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(auth.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_auth_api.py -v`
Expected: PASS (2 passed).

- [ ] **Step 7: Run full test suite to confirm nothing broke**

Run: `pytest -v`
Expected: all prior tests plus these 2 pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/security.py backend/app/routers/__init__.py backend/app/routers/auth.py backend/app/main.py backend/tests/test_auth_api.py
git commit -m "$(cat <<'EOF'
Add Supabase Auth signup/login/logout endpoints and bearer-token dependency

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Jobs API router

**Files:**
- Create: `backend/app/routers/jobs.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_jobs_api.py`

**Interfaces:**
- Consumes: `app.db.get_db` (Task 2), `app.models.Job`, `app.models.Subscription` (Task 2), `app.security.get_current_user_id` (Task 7), `app.storage.upload_file`, `app.storage.get_signed_url` (Task 5), `app.worker.run_pipeline` (Task 6).
- Produces: `router` mounted at `/jobs` with `POST /jobs` (multipart form: `file`, `source_language`, `target_language`, `voice_clone`; requires `Authorization: Bearer <token>`) returning `JobOut`, and `GET /jobs/{job_id}` returning `JobOut`. `JobOut` fields: `id: int`, `status: str`, `current_step: str`, `source_language: str`, `target_language: str`, `voice_clone: bool`, `output_video_url: str | None`, `output_srt_url: str | None`, `error_message: str | None`. This is the shape the frontend's `lib/types.ts` `Job` type (Task 10) must match. `POST /jobs` rejects non-video content types (400), files over 2GB (413), videos longer than the caller's subscription tier allows (402), and monthly video-count overages (402) — all before any pipeline work starts, using `ffprobe` (bundled with FFmpeg) to read duration.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_jobs_api.py`:

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from app.main import app
from app.db import get_db, Base
from app.security import get_current_user_id
from app import db as db_module
from app import storage as storage_module


def _override_get_db(tmp_path):
    db_path = tmp_path / "api_test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(bind=engine)

    def override():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    return override, TestSessionLocal


def test_create_and_fetch_job(tmp_path, sample_video, monkeypatch):
    override, TestSessionLocal = _override_get_db(tmp_path)
    app.dependency_overrides[get_db] = override
    app.dependency_overrides[get_current_user_id] = lambda: "test-user-1"
    db_module.SessionLocal = TestSessionLocal

    monkeypatch.setattr(
        storage_module,
        "upload_file",
        lambda path, data, content_type="application/octet-stream": path,
    )
    monkeypatch.setattr(
        storage_module,
        "get_signed_url",
        lambda path, expires_in=3600: f"https://fake-storage.test/{path}",
    )

    client = TestClient(app)

    with open(sample_video, "rb") as f:
        response = client.post(
            "/jobs",
            files={"file": ("sample.mp4", f, "video/mp4")},
            data={"source_language": "yo", "target_language": "en", "voice_clone": "false"},
        )

    assert response.status_code == 201
    job_id = response.json()["id"]

    status_response = client.get(f"/jobs/{job_id}")
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["status"] == "done"
    assert body["output_video_url"] == f"https://fake-storage.test/jobs/{job_id}/output.mp4"
    assert body["output_srt_url"] == f"https://fake-storage.test/jobs/{job_id}/subtitles.srt"

    app.dependency_overrides.clear()


def test_create_job_rejects_unsupported_content_type(tmp_path, monkeypatch):
    override, TestSessionLocal = _override_get_db(tmp_path)
    app.dependency_overrides[get_db] = override
    app.dependency_overrides[get_current_user_id] = lambda: "test-user-1"
    db_module.SessionLocal = TestSessionLocal

    client = TestClient(app)

    response = client.post(
        "/jobs",
        files={"file": ("notes.txt", b"not a video", "text/plain")},
        data={"source_language": "yo", "target_language": "en", "voice_clone": "false"},
    )

    assert response.status_code == 400
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_jobs_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.routers.jobs'`.

- [ ] **Step 3: Implement the jobs router**

Create `backend/app/routers/jobs.py`:

```python
import json
import os
import shutil
import subprocess
import tempfile
from fastapi import APIRouter, UploadFile, Form, File, HTTPException, BackgroundTasks, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.db import get_db
from app.models import Job, Subscription
from app.security import get_current_user_id
from app import storage, worker

router = APIRouter(prefix="/jobs", tags=["jobs"])

MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2GB, per readme.md
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/x-msvideo"}


def _get_duration_seconds(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


class JobOut(BaseModel):
    id: int
    status: str
    current_step: str
    source_language: str
    target_language: str
    voice_clone: bool
    output_video_url: str | None = None
    output_srt_url: str | None = None
    error_message: str | None = None


def _job_to_out(job: Job) -> JobOut:
    return JobOut(
        id=job.id,
        status=job.status,
        current_step=job.current_step,
        source_language=job.source_language,
        target_language=job.target_language,
        voice_clone=job.voice_clone,
        output_video_url=storage.get_signed_url(job.output_video_path) if job.output_video_path else None,
        output_srt_url=storage.get_signed_url(job.output_srt_path) if job.output_srt_path else None,
        error_message=job.error_message,
    )


@router.post("", response_model=JobOut, status_code=201)
def create_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_language: str = Form(...),
    target_language: str = Form(...),
    voice_clone: bool = Form(False),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload MP4, MOV, or AVI.")

    subscription = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    videos_used = subscription.videos_used_this_month if subscription else 0
    max_videos = subscription.max_videos_per_month if subscription else 1
    max_video_minutes = subscription.max_video_minutes if subscription else 3
    if videos_used >= max_videos:
        raise HTTPException(status_code=402, detail="Monthly video limit reached. Please upgrade your plan.")

    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        local_video_path = tmp.name

    if os.path.getsize(local_video_path) > MAX_UPLOAD_BYTES:
        os.remove(local_video_path)
        raise HTTPException(status_code=413, detail="Video exceeds the 2GB upload limit.")

    duration_seconds = _get_duration_seconds(local_video_path)
    if duration_seconds > max_video_minutes * 60:
        os.remove(local_video_path)
        raise HTTPException(
            status_code=402,
            detail=f"Video exceeds the {max_video_minutes}-minute limit for your plan. Please upgrade or trim your video.",
        )

    with open(local_video_path, "rb") as f:
        input_storage_path = storage.upload_file(
            f"uploads/{os.path.basename(local_video_path)}",
            f.read(),
            file.content_type or "video/mp4",
        )

    job = Job(
        user_id=user_id,
        status="queued",
        current_step="queued",
        source_language=source_language,
        target_language=target_language,
        voice_clone=voice_clone,
        input_storage_path=input_storage_path,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(worker.run_pipeline, job.id, local_video_path)

    return _job_to_out(job)


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_out(job)
```

- [ ] **Step 4: Register the jobs router in main.py**

Modify `backend/app/main.py`, adding the import and include call:

```python
from app.routers import auth, jobs
```

(replaces the `from app.routers import auth` line)

and add, after `app.include_router(auth.router)`:

```python
app.include_router(jobs.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_jobs_api.py -v`
Expected: PASS (2 passed). This exercises the real FFmpeg stages and mocked AI adapters end-to-end through the actual HTTP API, and confirms unsupported file types are rejected before any processing starts.

- [ ] **Step 6: Run full backend test suite**

Run: `pytest -v`
Expected: all tests across every backend task pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/jobs.py backend/app/main.py backend/tests/test_jobs_api.py
git commit -m "$(cat <<'EOF'
Add jobs API: create job, poll status, enforce subscription video limits

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Frontend project scaffold (Next.js + TypeScript + Tailwind)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.js`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/.env.local.example`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/globals.css`

**Interfaces:**
- Produces: a running Next.js dev server on port 3000, the `@/*` path alias resolving to the `frontend/` root, and Tailwind utility classes available in every `.tsx` file under `app/` and `components/`. No frontend task after this one touches these config files.

There is no automated test framework for the frontend in this scaffold (per spec). Verification is manual: install, run the dev server, and confirm it responds.

- [ ] **Step 1: Create package.json**

Create `frontend/package.json`:

```json
{
  "name": "reellingo-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.15",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "@types/node": "20.16.11",
    "@types/react": "18.3.11",
    "@types/react-dom": "18.3.1",
    "tailwindcss": "3.4.13",
    "postcss": "8.4.47",
    "autoprefixer": "10.4.20"
  }
}
```

- [ ] **Step 2: Create TypeScript and Next.js config**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `frontend/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = nextConfig;
```

- [ ] **Step 3: Create Tailwind config**

Create `frontend/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

Create `frontend/postcss.config.js`:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Create the root layout and global styles**

Create `frontend/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Create `frontend/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReelLingo",
  description: "AI Video Translator & Dubber for African Creators",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0A0A0A] text-white">{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Create the env template**

Create `frontend/.env.local.example`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 6: Install and verify the dev server runs**

Run (from `frontend/`):
```bash
npm install
npm run dev
```
Expected: server starts on `http://localhost:3000` with no build errors (a placeholder 404 page is fine — `app/page.tsx` doesn't exist yet, that's Task 11). Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/tsconfig.json frontend/next.config.js frontend/tailwind.config.ts frontend/postcss.config.js frontend/.env.local.example frontend/app/layout.tsx frontend/app/globals.css frontend/package-lock.json
git commit -m "$(cat <<'EOF'
Scaffold Next.js + TypeScript + Tailwind frontend project

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Frontend API client and shared types

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/api.ts`

**Interfaces:**
- Consumes: the `JobOut` JSON shape produced by `GET /jobs/{id}` and `POST /jobs` (Task 8): `{ id, status, current_step, source_language, target_language, voice_clone, output_video_url, output_srt_url, error_message }`.
- Produces: `Job` type, `JobStatus` type, `createJob(file, sourceLanguage, targetLanguage, voiceClone) -> Promise<Job>`, `getJob(jobId) -> Promise<Job>`. Used by the dashboard (Task 12), job status page, and result page (Task 13).

- [ ] **Step 1: Create shared types**

Create `frontend/lib/types.ts`:

```typescript
export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: number;
  status: JobStatus;
  current_step: string;
  source_language: string;
  target_language: string;
  voice_clone: boolean;
  output_video_url: string | null;
  output_srt_url: string | null;
  error_message: string | null;
}
```

- [ ] **Step 2: Create the API client**

Create `frontend/lib/api.ts`:

```typescript
import type { Job } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function createJob(
  file: File,
  sourceLanguage: string,
  targetLanguage: string,
  voiceClone: boolean
): Promise<Job> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source_language", sourceLanguage);
  formData.append("target_language", targetLanguage);
  formData.append("voice_clone", String(voiceClone));

  const response = await fetch(`${API_URL}/jobs`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to create job: ${response.status}`);
  }

  return response.json();
}

export async function getJob(jobId: number): Promise<Job> {
  const response = await fetch(`${API_URL}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch job: ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 3: Verify it compiles**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "$(cat <<'EOF'
Add typed API client for the jobs backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Landing page

**Files:**
- Create: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: nothing (static page). Links to `/dashboard` (built in Task 12).

- [ ] **Step 1: Implement the landing page**

Create `frontend/app/page.tsx`:

```tsx
import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text text-5xl font-bold text-transparent">
        Speak Local. Reach Global.
      </h1>
      <p className="max-w-xl text-gray-400">
        ReelLingo automatically translates and dubs your videos from African languages into
        English, Spanish, French, and more — in minutes, not days.
      </p>
      <Link
        href="/dashboard"
        className="rounded-full bg-gradient-to-r from-violet-600 to-pink-500 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-violet-900/50"
      >
        Try for Free (No Credit Card)
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Manually verify**

Run (from `frontend/`): `npm run dev`
Open `http://localhost:3000` in a browser.
Expected: the headline "Speak Local. Reach Global.", the description paragraph, and a "Try for Free (No Credit Card)" button that navigates to `/dashboard` (a 404 is expected there until Task 12). Stop the server once confirmed.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "$(cat <<'EOF'
Add ReelLingo landing page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Dashboard page and upload components

**Files:**
- Create: `frontend/components/UploadDropzone.tsx`
- Create: `frontend/components/LanguagePicker.tsx`
- Create: `frontend/components/VoiceToggle.tsx`
- Create: `frontend/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `createJob` from `frontend/lib/api.ts` (Task 10).
- Produces: `UploadDropzone` (props: `onFileSelected: (file: File) => void`), `LanguagePicker` (props: `label: string`, `options: { code: string; label: string; flag: string }[]`, `value: string`, `onChange: (code: string) => void`), `VoiceToggle` (props: `checked: boolean`, `onChange: (checked: boolean) => void`). On submit, the dashboard navigates to `/jobs/[id]` (built in Task 13) with the created job's id.

- [ ] **Step 1: Implement UploadDropzone**

Create `frontend/components/UploadDropzone.tsx`:

```tsx
"use client";

import { useState, useRef, type DragEvent, type ChangeEvent } from "react";

interface UploadDropzoneProps {
  onFileSelected: (file: File) => void;
}

export default function UploadDropzone({ onFileSelected }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      setFileName(file.name);
      onFileSelected(file);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      onFileSelected(file);
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
        isDragging ? "border-violet-500 bg-violet-500/10" : "border-gray-600"
      }`}
    >
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleChange} />
      <p className="text-gray-100">{fileName ?? "Drop your video here or click to browse"}</p>
    </div>
  );
}
```

- [ ] **Step 2: Implement LanguagePicker**

Create `frontend/components/LanguagePicker.tsx`:

```tsx
interface LanguageOption {
  code: string;
  label: string;
  flag: string;
}

interface LanguagePickerProps {
  label: string;
  options: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
}

export default function LanguagePicker({ label, options, value, onChange }: LanguagePickerProps) {
  return (
    <div>
      <p className="mb-2 text-sm text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => onChange(option.code)}
            className={`rounded-full border px-4 py-2 text-sm ${
              value === option.code
                ? "border-violet-500 bg-violet-500/20 text-white"
                : "border-gray-700 text-gray-300"
            }`}
          >
            {option.flag} {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement VoiceToggle**

Create `frontend/components/VoiceToggle.tsx`:

```tsx
interface VoiceToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function VoiceToggle({ checked, onChange }: VoiceToggleProps) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-violet-500"
      />
      <span className="text-gray-100">Clone my exact voice (Recommended)</span>
    </label>
  );
}
```

- [ ] **Step 4: Implement the dashboard page**

Create `frontend/app/dashboard/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UploadDropzone from "@/components/UploadDropzone";
import LanguagePicker from "@/components/LanguagePicker";
import VoiceToggle from "@/components/VoiceToggle";
import { createJob } from "@/lib/api";

const SOURCE_LANGUAGES = [
  { code: "yo", label: "Yoruba", flag: "🇳🇬" },
  { code: "pcm", label: "Pidgin", flag: "🇳🇬" },
  { code: "tw", label: "Twi", flag: "🇬🇭" },
];

const TARGET_LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
  { code: "fr", label: "French", flag: "🇫🇷" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("yo");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [voiceClone, setVoiceClone] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!file) {
      setErrorMessage("Please select a video first.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const job = await createJob(file, sourceLanguage, targetLanguage, voiceClone);
      router.push(`/jobs/${job.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-3xl font-bold text-white">Dashboard</h1>
      <UploadDropzone onFileSelected={setFile} />
      <LanguagePicker
        label="Source language"
        options={SOURCE_LANGUAGES}
        value={sourceLanguage}
        onChange={setSourceLanguage}
      />
      <LanguagePicker
        label="Target language"
        options={TARGET_LANGUAGES}
        value={targetLanguage}
        onChange={setTargetLanguage}
      />
      <VoiceToggle checked={voiceClone} onChange={setVoiceClone} />
      {errorMessage && <p className="text-red-400">{errorMessage}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="rounded-full bg-gradient-to-r from-violet-600 to-pink-500 px-6 py-3 font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? "Uploading..." : "Dub My Video"}
      </button>
    </main>
  );
}
```

- [ ] **Step 5: Manually verify**

Start the backend (`uvicorn app.main:app --reload` from `backend/`, with `.env` configured) and the frontend (`npm run dev` from `frontend/`). Open `http://localhost:3000/dashboard`, drop in any small video file, pick languages, and click "Dub My Video".
Expected: no console errors selecting the file and toggling languages; clicking submit either navigates to `/jobs/<id>` (Task 13 not yet built, 404 expected) or shows a network error if the backend isn't running — both confirm the request was attempted correctly.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/UploadDropzone.tsx frontend/components/LanguagePicker.tsx frontend/components/VoiceToggle.tsx frontend/app/dashboard/page.tsx
git commit -m "$(cat <<'EOF'
Add dashboard page with upload, language picker, and voice-clone toggle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Job status page and result page

**Files:**
- Create: `frontend/components/StatusTimeline.tsx`
- Create: `frontend/app/jobs/[id]/page.tsx`
- Create: `frontend/app/result/[id]/page.tsx`

**Interfaces:**
- Consumes: `getJob` from `frontend/lib/api.ts` (Task 10), `Job` type (Task 10).
- Produces: `StatusTimeline` (props: `currentStep: string`), the `/jobs/[id]` page (polls every 3s, redirects to `/result/[id]` on `status === "done"`), and the `/result/[id]` page (shows the finished video and download links).

- [ ] **Step 1: Implement StatusTimeline**

Create `frontend/components/StatusTimeline.tsx`:

```tsx
const STEPS = [
  { key: "extracting_audio", label: "Extracting audio" },
  { key: "transcribing", label: "Transcribing" },
  { key: "translating", label: "Translating" },
  { key: "dubbing", label: "Synthesizing voice clone" },
  { key: "merging", label: "Stitching it all together" },
  { key: "generating_subtitles", label: "Generating subtitles" },
];

interface StatusTimelineProps {
  currentStep: string;
}

export default function StatusTimeline({ currentStep }: StatusTimelineProps) {
  const currentIndex = STEPS.findIndex((step) => step.key === currentStep);

  return (
    <ul className="space-y-3">
      {STEPS.map((step, index) => {
        const isDone = currentIndex > index || currentStep === "done";
        const isActive = currentIndex === index;
        return (
          <li
            key={step.key}
            className={`flex items-center gap-3 ${
              isActive ? "text-violet-400" : isDone ? "text-emerald-400" : "text-gray-500"
            }`}
          >
            <span>{isDone ? "✅" : isActive ? "⏳" : "◯"}</span>
            <span>{step.label}...</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Implement the job status page**

Create `frontend/app/jobs/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusTimeline from "@/components/StatusTimeline";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function JobStatusPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    const jobId = Number(params.id);
    const interval = setInterval(async () => {
      const updated = await getJob(jobId);
      setJob(updated);
      if (updated.status === "done") {
        clearInterval(interval);
        router.push(`/result/${jobId}`);
      }
      if (updated.status === "failed") {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [params.id, router]);

  return (
    <main className="mx-auto max-w-xl space-y-8 p-8">
      <h1 className="text-3xl font-bold text-white">Processing your video</h1>
      {job ? (
        job.status === "failed" ? (
          <p className="text-red-400">{job.error_message ?? "Something went wrong."}</p>
        ) : (
          <StatusTimeline currentStep={job.current_step} />
        )
      ) : (
        <p className="text-gray-400">Loading status...</p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Implement the result page**

Create `frontend/app/result/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getJob } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    getJob(Number(params.id)).then(setJob);
  }, [params.id]);

  if (!job) {
    return <p className="p-8 text-gray-400">Loading...</p>;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8 text-center">
      <h1 className="text-3xl font-bold text-white">Your video is ready! 🎉</h1>
      {job.output_video_url && (
        <video src={job.output_video_url} controls className="w-full rounded-2xl" />
      )}
      <div className="flex justify-center gap-4">
        {job.output_video_url && (
          <a
            href={job.output_video_url}
            download
            className="rounded-full bg-violet-600 px-6 py-3 font-semibold text-white"
          >
            Download Video
          </a>
        )}
        {job.output_srt_url && (
          <a
            href={job.output_srt_url}
            download
            className="rounded-full border border-gray-600 px-6 py-3 font-semibold text-white"
          >
            Download Subtitles (.SRT)
          </a>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Manually verify the full flow**

With the backend running (`MOCK_MODE=true`) and the frontend running, go to `http://localhost:3000/dashboard`, upload a short real video file, pick languages, and submit.
Expected: redirect to `/jobs/<id>` showing the step timeline advancing every ~3 seconds, then an automatic redirect to `/result/<id>` showing a playable video and both download links working.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/StatusTimeline.tsx frontend/app/jobs frontend/app/result
git commit -m "$(cat <<'EOF'
Add job status page with live step timeline and result/download page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Docker Compose, README setup instructions, final verification

**Files:**
- Create: `docker-compose.yml`
- Modify: `readme.md`

**Interfaces:**
- Consumes: all prior tasks — this is the final integration/documentation pass, no new interfaces produced.

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml` at the repo root:

```yaml
services:
  backend:
    image: python:3.11-slim
    working_dir: /app
    volumes:
      - ./backend:/app
    command: sh -c "pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env

  frontend:
    image: node:20-slim
    working_dir: /app
    volumes:
      - ./frontend:/app
    command: sh -c "npm install && npm run dev"
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on:
      - backend
```

- [ ] **Step 2: Add a "Getting Started" section to readme.md**

Append this section to the end of `readme.md` (after the existing `*Built with purpose. Built for Africa. Built for the world.*` line):

```markdown

---

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js 20+
- Python 3.11+
- FFmpeg installed and on your `PATH` (confirm with `ffmpeg -version`)
- A free [Supabase](https://supabase.com) account
- Docker Desktop (optional, only needed for the Docker Compose path below)

### 1. Create your Supabase project
1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**, pick a name and a database password (save the password), and wait for
   provisioning to finish.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key (or the
   **service_role** key if you want the backend to bypass Row Level Security during development).
4. In **Project Settings → Database**, copy the **Connection string** (URI format) — this is your
   `DATABASE_URL`.
5. In **Storage**, create a new bucket named `reellingo-videos`.

### 2. Backend setup
```bash
cd backend
cp .env.example .env
# Edit .env: paste in DATABASE_URL, SUPABASE_URL, SUPABASE_KEY from the Supabase dashboard.
# Leave MOCK_MODE=true and the OPENAI/DEEPL/ELEVENLABS keys blank until you have them.
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Backend runs at `http://localhost:8000` (check `http://localhost:8000/health`).

### 3. Frontend setup
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```
Frontend runs at `http://localhost:3000`.

### 4. Or run both with Docker Compose
```bash
docker compose up
```

### Notes
- With `MOCK_MODE=true` (the default), the full pipeline runs without any OpenAI/DeepL/ElevenLabs
  keys — transcription, translation, and dubbing return placeholder data, while audio
  extraction/merging and subtitle generation are real. Set `MOCK_MODE=false` and fill in the three
  API keys in `backend/.env` once you have them to switch to real calls.
- Paystack/Stripe checkout is not implemented yet — the pricing tiers are modeled in the database
  but billing is a stub.
```

- [ ] **Step 3: Run the full backend test suite one more time**

Run (from `backend/`): `pytest -v`
Expected: every test from Tasks 1–8 passes.

- [ ] **Step 4: Manually verify the frontend still builds**

Run (from `frontend/`): `npm run build`
Expected: build completes with no type or compile errors.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml readme.md
git commit -m "$(cat <<'EOF'
Add Docker Compose setup and local development instructions to README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

