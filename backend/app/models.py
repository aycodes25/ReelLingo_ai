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
