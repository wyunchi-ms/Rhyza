import { Interactive, interpolate, useCurrentFrame } from "remotion";

export function PathCompressionGuide() {
	const frame = useCurrentFrame();
	return (
		<Interactive.Div
			name="无分叉路径压缩 · 同一会话的显示示意"
			style={{
				position: "absolute",
				bottom: 24,
				left: 64,
				right: 64,
				height: 248,
				border: "1px solid #c8c2e2",
				borderRadius: 12,
				backgroundColor: "#faf9ff",
				boxShadow: "0 6px 24px #24213915",
				opacity: interpolate(frame, [0, 12, 464, 479], [0, 1, 1, 0], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				}),
			}}
		>
			<div style={{ padding: "16px 26px 0", fontSize: 26, color: "#51479b", fontWeight: 650 }}>
				同一会话：A → B → C 中间没有分叉，就合成一个列表项
				<span style={{ float: "right", fontSize: 20, color: "#71788a", fontWeight: 400 }}>
					显示结构示意 · 完整聊天仍保留
				</span>
			</div>
			<svg
				width="100%"
				height="190"
				viewBox="0 0 1664 190"
				aria-label="Node View 的 A、B、C 连续三个节点，在 List View 合成一项；D、E、F 分叉保持独立"
			>
				<text x="28" y="110" fill="#667084" fontSize="25">
					Node View
				</text>
				<g fill="none" stroke="#b7b0d5" strokeWidth="3">
					<path d="M284 100 H335 M399 100 H450 M514 100 H566 V38 H626" />
					<path d="M566 100 H626 M566 100 V162 H626" />
					<path d="M1240 100 H1300 V38 H1370 M1300 100 H1370 M1300 100 V162 H1370" />
				</g>
				<g fill="#ffffff" stroke="#c4bfdc" strokeWidth="2">
					<rect x="220" y="80" width="64" height="40" rx="7" />
					<rect x="335" y="80" width="64" height="40" rx="7" />
					<rect x="450" y="80" width="64" height="40" rx="7" />
					<rect x="626" y="18" width="64" height="40" rx="7" />
					<rect x="626" y="80" width="64" height="40" rx="7" />
					<rect x="626" y="142" width="64" height="40" rx="7" />
					<rect x="1370" y="18" width="64" height="40" rx="7" />
					<rect x="1370" y="80" width="64" height="40" rx="7" />
					<rect x="1370" y="142" width="64" height="40" rx="7" />
				</g>
				<g fill="#2d3344" fontSize="26" textAnchor="middle">
					<text x="252" y="109">
						A
					</text>
					<text x="367" y="109">
						B
					</text>
					<text x="482" y="109">
						C
					</text>
					<text x="658" y="47">
						D
					</text>
					<text x="658" y="109">
						E
					</text>
					<text x="658" y="171">
						F
					</text>
					<text x="1402" y="47">
						D
					</text>
					<text x="1402" y="109">
						E
					</text>
					<text x="1402" y="171">
						F
					</text>
				</g>
				<text x="795" y="113" fontSize="38" fill="#7366b9">
					→
				</text>
				<text x="884" y="110" fontSize="25" fill="#667084">
					List View
				</text>
				<rect
					x="1050"
					y="73"
					width="190"
					height="54"
					rx="9"
					fill="#eae5fc"
					stroke="#9081c8"
					strokeWidth="2"
				/>
				<text x="1145" y="110" fill="#51479b" fontSize="26" textAnchor="middle">
					A · B · C
				</text>
				<text x="1470" y="100" fill="#667084" fontSize="23">
					分叉保留
				</text>
				<text x="1470" y="133" fill="#667084" fontSize="23">
					逐条可选
				</text>
			</svg>
		</Interactive.Div>
	);
}
