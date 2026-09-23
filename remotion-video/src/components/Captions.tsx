import type { Caption } from "@remotion/captions";
import { useCurrentFrame, useVideoConfig } from "remotion";
import captionsJson from "../data/captions.json";

const captions: Caption[] = captionsJson;

export function Captions({ offsetFrames = 0 }: { offsetFrames?: number }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const ms = ((frame + offsetFrames) / fps) * 1000;
	const cue = captions.find((item) => ms >= item.startMs && ms < item.endMs);
	if (!cue) return null;

	return (
		<div
			style={{
				position: "absolute",
				bottom: 35,
				left: 120,
				right: 120,
				minHeight: 66,
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				pointerEvents: "none",
			}}
		>
			<div
				style={{
					color: "#f8fafc",
					background: "#172033",
					padding: "12px 28px",
					borderRadius: 9,
					fontSize: 38,
					fontWeight: 550,
					lineHeight: 1.5,
					textAlign: "center",
					maxWidth: 1590,
					whiteSpace: "pre-wrap",
					textWrap: "pretty",
				}}
			>
				{cue.text}
			</div>
		</div>
	);
}
