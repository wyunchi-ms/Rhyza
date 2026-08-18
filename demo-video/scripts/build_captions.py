import argparse
import json
import re
from pathlib import Path


def timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def split_phrases(text: str, max_chars: int = 34) -> list[tuple[int, int, str]]:
    clauses = []
    for match in re.finditer(r"[^，。！？；：.!?;:]+[，。！？；：.!?;:]?", text):
        value = match.group().strip()
        if value:
            clauses.append((match.start(), match.end(), value))

    groups: list[tuple[int, int, str]] = []
    cursor_start = -1
    cursor_end = -1
    cursor_text = ""
    for start, end, value in clauses:
        compact_length = len(re.sub(r"\s", "", cursor_text + value))
        if cursor_text and compact_length > max_chars:
            groups.append((cursor_start, cursor_end, cursor_text))
            cursor_start, cursor_text = start, value
        else:
            if cursor_start < 0:
                cursor_start = start
            cursor_text += value
        cursor_end = end
        if value.endswith(("。", "！", "？", "；", ".", "!", "?", ";")) and len(re.sub(r"\s", "", cursor_text)) >= 18:
            groups.append((cursor_start, cursor_end, cursor_text))
            cursor_start, cursor_end, cursor_text = -1, -1, ""
    if cursor_text:
        groups.append((cursor_start, cursor_end, cursor_text))
    return groups


def main() -> None:
    parser = argparse.ArgumentParser(description="Build captions from Azure word boundaries.")
    parser.add_argument("--text", required=True, type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--json", required=True, type=Path)
    parser.add_argument("--vtt", required=True, type=Path)
    parser.add_argument("--video-offset", type=float, default=1.5)
    args = parser.parse_args()

    text = args.text.read_text(encoding="utf-8").strip()
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    boundaries = metadata["boundaries"]
    text_offset_base = boundaries[0]["textOffset"] if boundaries else 0
    captions = []

    for text_start, text_end, caption_text in split_phrases(text):
        matches = [
            boundary
            for boundary in boundaries
            if text_start <= boundary["textOffset"] - text_offset_base < text_end
        ]
        if not matches:
            continue
        first = matches[0]
        last = matches[-1]
        start = first["audioOffsetSeconds"] + args.video_offset
        end = (
            last["audioOffsetSeconds"]
            + max(last["durationSeconds"], 0.08)
            + args.video_offset
        )
        captions.append({"start": round(start, 3), "end": round(end, 3), "text": caption_text})

    args.json.write_text(json.dumps(captions, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["WEBVTT", ""]
    for index, cue in enumerate(captions, start=1):
        lines.extend(
            [
                str(index),
                f"{timestamp(cue['start'])} --> {timestamp(cue['end'])}",
                cue["text"],
                "",
            ]
        )
    args.vtt.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"captions": len(captions), "end": captions[-1]["end"]}))


if __name__ == "__main__":
    main()
