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
