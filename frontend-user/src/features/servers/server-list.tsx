import ServerCard from "@/components/ServerCard";
import ServerCardInline from "@/components/ServerCardInline";
import type { NezhaServer } from "@/types/nezha-api";
import { ServerEmptyState } from "./server-states";

export function ServerList({
	hasServers,
	filteredServers,
	inline,
	now,
}: {
	hasServers: boolean;
	filteredServers: NezhaServer[];
	inline: string;
	now: number;
}) {
	return !hasServers ? (
		<ServerEmptyState />
	) : filteredServers.length > 0 ? (
		inline === "1" ? (
			<section className="flex flex-col gap-2 overflow-x-scroll p-px scrollbar-hidden mt-6 server-inline-list">
				{filteredServers.map((serverInfo, index) =>
					index >= 12 ? (
						<div key={serverInfo.id} className="nz-deferred-card-inline">
							<ServerCardInline now={now} serverInfo={serverInfo} />
						</div>
					) : (
						<ServerCardInline
							key={serverInfo.id}
							now={now}
							serverInfo={serverInfo}
						/>
					),
				)}
			</section>
		) : (
			<section className="grid grid-cols-1 gap-2 md:grid-cols-2 mt-6 server-card-list">
				{filteredServers.map((serverInfo, index) =>
					index >= 10 ? (
						<div key={serverInfo.id} className="nz-deferred-card">
							<ServerCard now={now} serverInfo={serverInfo} />
						</div>
					) : (
						<ServerCard key={serverInfo.id} now={now} serverInfo={serverInfo} />
					),
				)}
			</section>
		)
	) : (
		<ServerEmptyState filtered />
	);
}
