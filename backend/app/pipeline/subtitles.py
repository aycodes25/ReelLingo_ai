from app.pipeline.types import TranscriptSegment


def _format_timestamp(seconds: float) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    milliseconds = int(round((secs % 1) * 1000))
    return f"{int(hours):02d}:{int(minutes):02d}:{int(secs):02d},{milliseconds:03d}"


def generate_srt(segments: list[TranscriptSegment]) -> str:
    lines = []
    for index, segment in enumerate(segments, start=1):
        lines.append(str(index))
        lines.append(f"{_format_timestamp(segment['start'])} --> {_format_timestamp(segment['end'])}")
        lines.append(segment["text"])
        lines.append("")
    return "\n".join(lines)
