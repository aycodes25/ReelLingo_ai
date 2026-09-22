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
