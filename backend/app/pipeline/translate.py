import deepl
from app.config import settings
from app.pipeline.types import TranscriptSegment


def translate(
    segments: list[TranscriptSegment], target_language: str, mock_mode: bool
) -> list[TranscriptSegment]:
    if mock_mode:
        return [
            {**segment, "text": f"[mock translation to {target_language}] {segment['text']}"}
            for segment in segments
        ]

    if not settings.deepl_api_key:
        raise RuntimeError("DEEPL_API_KEY is not set. Add it to backend/.env to use real translation.")
    translator = deepl.Translator(settings.deepl_api_key)
    translated: list[TranscriptSegment] = []
    for segment in segments:
        result = translator.translate_text(segment["text"], target_lang=target_language)
        translated.append({**segment, "text": result.text})
    return translated
