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
