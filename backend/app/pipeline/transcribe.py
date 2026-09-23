from openai import OpenAI
from app.config import settings
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

    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to backend/.env to use real transcription.")
    client = OpenAI(api_key=settings.openai_api_key)
    with open(audio_path, "rb") as audio_file:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=source_language,
            response_format="verbose_json",
        )
    return [
        {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
        for segment in response.segments
    ]
