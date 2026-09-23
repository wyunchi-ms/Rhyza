import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";

export function Branching({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="branching">
			<Sequence name="04-reading-anchor · 在阅读途中发现一个疑问" from={0} durationInFrames={240}>
				<Shot id="04-reading-anchor" directorMode={directorMode} />
			</Sequence>
			<Sequence name="05-explain · Explain：先创建解释节点" from={240} durationInFrames={480}>
				<Shot id="05-explain" directorMode={directorMode} />
			</Sequence>
			<Sequence name="06-select-ask · Ask：把自己的问题放进支线" from={720} durationInFrames={480}>
				<Shot id="06-select-ask" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="07-keep-reading · 新回答完成，也不抢走阅读位置"
				from={1200}
				durationInFrames={360}
			>
				<Shot id="07-keep-reading" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="08-revisit-branches · 看完这一段，再回头看支线"
				from={1560}
				durationInFrames={360}
			>
				<Shot id="08-revisit-branches" directorMode={directorMode} />
			</Sequence>
		</ChapterFrame>
	);
}
