import argparse
import html
import json
import os
from pathlib import Path

import azure.cognitiveservices.speech as speechsdk


def load_env_file(path: Path) -> None:
    """Load the local demo env file without adding a runtime dependency."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Rhyza narration with Azure Speech.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
    parser.add_argument("--rate", default="+5%")
    parser.add_argument("--locale", default="en-US")
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args()

    load_env_file(args.env_file)
    key = os.environ.get("AZURE_TTS_API_KEY") or os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_TTS_REGION") or os.environ.get("AZURE_SPEECH_REGION")
    endpoint = os.environ.get("AZURE_TTS_ENDPOINT")
    if not key or not region:
        raise RuntimeError("AZURE_TTS_API_KEY and AZURE_TTS_REGION are required")

    text = args.input.read_text(encoding="utf-8").strip()
    speech_config = speechsdk.SpeechConfig(
        subscription=key,
        endpoint=endpoint,
    ) if endpoint else speechsdk.SpeechConfig(subscription=key, region=region)
    speech_config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
    )
    audio_config = speechsdk.audio.AudioOutputConfig(filename=str(args.output))
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=speech_config,
        audio_config=audio_config,
    )

    boundaries: list[dict[str, object]] = []

    def on_boundary(event: speechsdk.SpeechSynthesisWordBoundaryEventArgs) -> None:
        duration = event.duration.total_seconds() if event.duration else 0.0
        boundaries.append(
            {
                "audioOffsetSeconds": event.audio_offset / 10_000_000,
                "durationSeconds": duration,
                "textOffset": event.text_offset,
                "wordLength": event.word_length,
                "text": event.text,
                "boundaryType": str(event.boundary_type),
            }
        )

    synthesizer.synthesis_word_boundary.connect(on_boundary)
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xml:lang="{html.escape(args.locale)}">'
        f'<voice name="{html.escape(args.voice)}">'
        f'<prosody rate="{html.escape(args.rate)}">{html.escape(text)}</prosody>'
        "</voice></speak>"
    )
    result = synthesizer.speak_ssml_async(ssml).get()
    if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
        details = speechsdk.SpeechSynthesisCancellationDetails.from_result(result)
        raise RuntimeError(f"Speech synthesis failed: {details.reason}: {details.error_details}")

    duration_seconds = result.audio_duration.total_seconds()
    args.metadata.write_text(
        json.dumps(
            {
                "provider": "Azure AI Speech",
                "region": region,
                "voice": args.voice,
                "rate": args.rate,
                "durationSeconds": duration_seconds,
                "boundaries": boundaries,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"durationSeconds": duration_seconds, "boundaryCount": len(boundaries)}))


if __name__ == "__main__":
    main()
