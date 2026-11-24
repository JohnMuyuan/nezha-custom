import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LatencyMatrix from "@/pages/LatencyMatrix";
import { createTestQueryClient } from "@/test/utils";
import type { LatencyOverviewResponse } from "@/types/nezha-api";

const matrixMocks = vi.hoisted(() => ({
	fetchLatencyOverview: vi.fn(),
	fetchServerGroup: vi.fn(),
	isAuthenticated: false,
}));

vi.mock("@/lib/nezha-api", () => ({
	fetchLatencyOverview: matrixMocks.fetchLatencyOverview,
	fetchServerGroup: matrixMocks.fetchServerGroup,
}));

vi.mock("@/hooks/use-login-user", () => ({
	useLoginUser: () => ({
		isAuthenticated: matrixMocks.isAuthenticated,
		authStatus: matrixMocks.isAuthenticated ? "authenticated" : "anonymous",
	}),
}));

vi.mock("@/features/latency-matrix/LatencyCompareChart", () => ({
	LatencyCompareChart: ({
		selectedMonitorId,
	}: {
		selectedMonitorId: number | null;
	}) => <div data-testid="compare-chart">monitor:{selectedMonitorId}</div>,
}));

function sampleOverview(): LatencyOverviewResponse {
	const now = Date.parse("2026-11-23T12:00:00Z");
	return {
		success: true,
		data: {
			period: "1h",
			generated_at: now,
			bucket_ms: 90_000,
			monitors: [
				{ id: 1, name: "上海电信", display_index: 10 },
				{ id: 2, name: "Cloudflare US", display_index: 5 },
			],
			servers: [
				{
					id: 101,
					name: "HK-Fast-Unstable",
					country_code: "HK",
					display_index: 10,
					online: true,
					avg_ms: 42.5,
					latest_ms: 55.0,
					p95_ms: 145.0,
					jitter_ms: 28.4,
					loss_percent: 4.5,
					stability_score: 36.2,
					monitor_count: 2,
					cells: {
						"1": {
							latest_ms: 50,
							avg_ms: 35,
							min_ms: 20,
							max_ms: 190,
							p95_ms: 140,
							jitter_ms: 32,
							std_dev_ms: 40,
							loss_percent: 5.0,
							sample_count: 40,
							stability_score: 30,
							sparkline: [
								{ ts: now - 180_000, delay: 25, loss: 0 },
								{ ts: now - 90_000, delay: 140, loss: 5 },
								{ ts: now, delay: 50, loss: 0 },
							],
						},
						"2": {
							latest_ms: 60,
							avg_ms: 50,
							min_ms: 42,
							max_ms: 150,
							p95_ms: 150,
							jitter_ms: 24.8,
							std_dev_ms: 28,
							loss_percent: 4.0,
							sample_count: 40,
							stability_score: 42.4,
							sparkline: [
								{ ts: now - 180_000, delay: 45, loss: 0 },
								{ ts: now, delay: 60, loss: 4 },
							],
						},
					},
				},
				{
					id: 102,
					name: "US-CN2-RockSolid",
					country_code: "US",
					display_index: 8,
					online: true,
					avg_ms: 142.0,
					latest_ms: 141.5,
					p95_ms: 144.0,
					jitter_ms: 0.9,
					loss_percent: 0,
					stability_score: 99.1,
					monitor_count: 2,
					cells: {
						"1": {
							latest_ms: 138,
							avg_ms: 139,
							min_ms: 137,
							max_ms: 141,
							p95_ms: 140.5,
							jitter_ms: 0.8,
							std_dev_ms: 0.9,
							loss_percent: 0,
							sample_count: 40,
							stability_score: 99.3,
							sparkline: [
								{ ts: now - 180_000, delay: 139, loss: 0 },
								{ ts: now, delay: 138, loss: 0 },
							],
						},
						"2": {
							latest_ms: 145,
							avg_ms: 145,
							min_ms: 143,
							max_ms: 147,
							p95_ms: 146,
							jitter_ms: 1.0,
							std_dev_ms: 1.1,
							loss_percent: 0,
							sample_count: 40,
							stability_score: 98.9,
							sparkline: [
								{ ts: now - 180_000, delay: 145, loss: 0 },
								{ ts: now, delay: 145, loss: 0 },
							],
						},
					},
				},
				{
					id: 103,
					name: "JP-Balanced",
					country_code: "JP",
					display_index: 5,
					online: true,
					avg_ms: 78.0,
					latest_ms: 79.0,
					p95_ms: 85.0,
					jitter_ms: 2.5,
					loss_percent: 0,
					stability_score: 95.0,
					monitor_count: 2,
					cells: {
						"1": {
							latest_ms: 70,
							avg_ms: 68,
							min_ms: 64,
							max_ms: 76,
							p95_ms: 74,
							jitter_ms: 2.0,
							std_dev_ms: 2.5,
							loss_percent: 0,
							sample_count: 40,
							stability_score: 96,
							sparkline: [
								{ ts: now - 180_000, delay: 68, loss: 0 },
								{ ts: now, delay: 70, loss: 0 },
							],
						},
						"2": {
							latest_ms: 88,
							avg_ms: 88,
							min_ms: 82,
							max_ms: 95,
							p95_ms: 94,
							jitter_ms: 3.0,
							std_dev_ms: 3.2,
							loss_percent: 0,
							sample_count: 40,
							stability_score: 94,
							sparkline: [
								{ ts: now - 180_000, delay: 87, loss: 0 },
								{ ts: now, delay: 88, loss: 0 },
							],
						},
					},
				},
			],
		},
	};
}

function renderMatrix() {
	const client = createTestQueryClient();
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/latency"]}>
				<LatencyMatrix />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("LatencyMatrix page", () => {
	beforeEach(() => {
		matrixMocks.isAuthenticated = false;
		matrixMocks.fetchLatencyOverview.mockReset();
		matrixMocks.fetchServerGroup.mockReset();
		matrixMocks.fetchLatencyOverview.mockResolvedValue(sampleOverview());
		matrixMocks.fetchServerGroup.mockResolvedValue({ success: true, data: [] });
	});

	it("surfaces fastest, most stable, and most unstable servers and supports accessible column sorting", async () => {
		const user = userEvent.setup();
		renderMatrix();

		const table = await screen.findByRole("table");
		// Default sort is avg delay ascending: HK (42.5) -> JP (78.0) -> US (142.0)
		const getBodyRowHeaders = () =>
			within(table)
				.getAllByRole("row")
				.slice(1)
				.map((row) => within(row).getByRole("rowheader").textContent ?? "");

		expect(getBodyRowHeaders().map((t) => t.trim())).toEqual([
			"HK-Fast-Unstable",
			"JP-Balanced",
			"US-CN2-RockSolid",
		]);

		// Only the active sorted column header carries aria-sort
		const colHeaders = within(table).getAllByRole("columnheader");
		const sortedHeaders = colHeaders.filter((th) => th.hasAttribute("aria-sort"));
		expect(sortedHeaders).toHaveLength(1);
		expect(sortedHeaders[0]).toHaveAttribute("aria-sort", "ascending");

		// Click "最不稳优先" preset or Stability header -> HK-Fast-Unstable (36.2) first; click again -> US-CN2-RockSolid (99.1) first
		const stabilityHeaderBtn = within(table).getByRole("button", {
			name: /latencyMatrix\.colStability|稳定性/,
		});
		await user.click(stabilityHeaderBtn);
		expect(getBodyRowHeaders().map((t) => t.trim())[0]).toBe("HK-Fast-Unstable");
		expect(stabilityHeaderBtn.closest("th")).toHaveAttribute(
			"aria-sort",
			"ascending",
		);

		await user.click(stabilityHeaderBtn);
		expect(getBodyRowHeaders().map((t) => t.trim())[0]).toBe("US-CN2-RockSolid");
		expect(stabilityHeaderBtn.closest("th")).toHaveAttribute(
			"aria-sort",
			"descending",
		);
		expect(screen.getByRole("status")).toHaveTextContent("共 3 台服务器");

		// Search filter narrows servers immediately
		const searchBox = screen.getByRole("searchbox");
		await user.type(searchBox, "US-CN2");
		expect(getBodyRowHeaders().map((t) => t.trim())).toEqual([
			"US-CN2-RockSolid",
		]);
	});

	it("switches periods and locks 7d for anonymous guests", async () => {
		const user = userEvent.setup();
		renderMatrix();

		await screen.findByRole("table");
		expect(matrixMocks.fetchLatencyOverview).toHaveBeenCalledWith("1h");

		const btn6h = screen.getByRole("button", {
			name: /latencyMatrix\.period6h|6 小时/,
		});
		await user.click(btn6h);
		expect(matrixMocks.fetchLatencyOverview).toHaveBeenCalledWith("6h");

		const btn7d = screen.getByRole("button", {
			name: /latencyMatrix\.period7d|7 天/,
		});
		expect(btn7d).toBeDisabled();
	});
});
