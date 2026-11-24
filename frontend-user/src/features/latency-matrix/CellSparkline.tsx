import { memo } from "react";
import type { LatencySparkPoint } from "@/types/nezha-api";

export const CellSparkline = memo(function CellSparkline({
	points,
	strokeColor,
	width = 68,
	height = 18,
}: {
	points?: LatencySparkPoint[];
	strokeColor: string;
	width?: number;
	height?: number;
}) {
	if (!points || points.length < 2) {
		return (
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				aria-hidden="true"
				className="block shrink-0 opacity-35"
			>
				<line
					x1={2}
					y1={height / 2}
					x2={width - 2}
					y2={height / 2}
					stroke="currentColor"
					strokeWidth="1"
					strokeDasharray="2 2"
				/>
			</svg>
		);
	}

	const validDelays = points
		.map((p) => p.delay)
		.filter((d): d is number => d != null && Number.isFinite(d) && d > 0);

	const minD = validDelays.length > 0 ? Math.min(...validDelays) : 0;
	const maxD = validDelays.length > 0 ? Math.max(...validDelays) : 1;
	const span = Math.max(maxD - minD, 4);
	const padX = 2;
	const padY = 2.5;
	const innerW = width - padX * 2;
	const innerH = height - padY * 2;
	const stepX = innerW / Math.max(points.length - 1, 1);

	const segments: string[] = [];
	let currentPath = "";
	const lossTicks: number[] = [];

	points.forEach((pt, idx) => {
		const x = padX + idx * stepX;
		if (pt.loss > 0) {
			lossTicks.push(x);
		}
		if (pt.delay != null && Number.isFinite(pt.delay) && pt.delay > 0) {
			const norm = (pt.delay - minD) / span;
			const y = padY + innerH * (1 - norm);
			currentPath += `${currentPath ? " L " : "M "}${x.toFixed(1)} ${y.toFixed(1)}`;
		} else if (currentPath) {
			segments.push(currentPath);
			currentPath = "";
		}
	});
	if (currentPath) segments.push(currentPath);

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			aria-hidden="true"
			className="block shrink-0 overflow-visible"
		>
			{lossTicks.map((x, idx) => (
				<line
					key={idx}
					x1={x}
					y1={1}
					x2={x}
					y2={height - 1}
					stroke="#e11d48"
					strokeWidth="1.5"
					strokeOpacity="0.6"
				/>
			))}
			{segments.map((d, idx) => (
				<path
					key={idx}
					d={d}
					fill="none"
					stroke={strokeColor}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			))}
		</svg>
	);
});
