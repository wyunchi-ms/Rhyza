import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Settings({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="settings">
			<Sequence name="25-providers · 选择 Provider 和模型" from={0} durationInFrames={420}>
				<Shot id="25-providers" directorMode={directorMode} />
			</Sequence>
			<Sequence name="26-appearance · 调整阅读外观" from={420} durationInFrames={300}>
				<Shot id="26-appearance" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
