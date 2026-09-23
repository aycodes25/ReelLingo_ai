import subprocess


def merge_audio_video(video_path: str, audio_path: str, output_video_path: str) -> str:
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path, "-i", audio_path,
            "-c:v", "copy", "-map", "0:v:0", "-map", "1:a:0", "-shortest",
            output_video_path,
        ],
        check=True,
        capture_output=True,
    )
    return output_video_path
