from typing import TypedDict


class TranscriptSegment(TypedDict):
    start: float
    end: float
    text: str
