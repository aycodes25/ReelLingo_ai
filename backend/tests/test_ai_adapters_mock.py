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
