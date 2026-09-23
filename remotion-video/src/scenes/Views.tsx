import { Sequence } from "remotion";
import { ChapterFrame } from "../components/ChapterFrame";
import { Shot } from "../components/Shot";
import { PathCompressionGuide } from "../components/PathCompressionGuide";

export function Views({ directorMode }: { directorMode: boolean }) {
	return (
		<ChapterFrame chapterId="views">
			<Sequence name="09-node-view · Node View：展开每一轮探索" from={0} durationInFrames={420}>
				<Shot id="09-node-view" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="10-list-compression · List View：把没有分叉的一段收成一项"
				from={420}
				durationInFrames={720}
			>
				<Shot id="10-list-compression" directorMode={directorMode} />
			</Sequence>
			<Sequence
				name="11-switch-views · 看全貌用节点，日常阅读用列表"
				from={1140}
				durationInFrames={420}
			>
				<Shot id="11-switch-views" directorMode={directorMode} />
			</Sequence>
			<Sequence name="显示压缩原理 · 对比示意" from={600} durationInFrames={480}>
				<PathCompressionGuide />
			</Sequence>
		</ChapterFrame>
	);
}
