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
