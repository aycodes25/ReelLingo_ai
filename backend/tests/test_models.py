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
