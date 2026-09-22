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
