import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Split narration into review segments.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()

    paragraphs = [
        paragraph.strip()
        for paragraph in args.input.read_text(encoding="utf-8").split("\n\n")
        if paragraph.strip()
    ]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index, paragraph in enumerate(paragraphs, start=1):
        path = args.output_dir / f"segment-{index:02d}.txt"
        path.write_text(paragraph + "\n", encoding="utf-8")
    print(f"Created {len(paragraphs)} narration segments")


if __name__ == "__main__":
    main()
