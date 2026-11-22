import { deleteAlertRules } from "@/api/alert-rule"
import { swrFetcher } from "@/api/api"
import { ActionButtonGroup } from "@/components/action-button-group"
import { AlertRuleCard } from "@/components/alert-rule"
import { CopyButton } from "@/components/copy-button"
import { HeaderButtonGroup } from "@/components/header-button-group"
import { NotificationFlowGuide, NotificationTab } from "@/components/notification-tab"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { useNotification } from "@/hooks/useNotfication"
import { summarizeAlertRules } from "@/lib/notification-presets"
import { selectableTableFeatures } from "@/lib/table"
import { ModelAlertRule } from "@/types"
import { ColumnDef, flexRender, useTable } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR from "swr"

export default function AlertRulePage() {
    const { t } = useTranslation()
    const { notifierGroup } = useNotification()

    const { data, mutate, error, isLoading } = useSWR<ModelAlertRule[]>(
        "/api/v1/alert-rule",
        swrFetcher,
    )

    const groupNameMap = useMemo(() => {
        const m = new Map<number, string>()
        for (const ng of notifierGroup ?? []) {
            m.set(ng.group.id, ng.group.name)
        }
        return m
    }, [notifierGroup])

    useEffect(() => {
        if (error)
            toast(t("Error"), {
                description: t("Results.ErrorFetchingResource", { error: error.message }),
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error])

    const columns: ColumnDef<typeof selectableTableFeatures, ModelAlertRule>[] = [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && "indeterminate")
                    }
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                />
            ),
            enableHiding: false,
        },
        {
            header: "ID",
            accessorKey: "id",
            accessorFn: (row) => row.id,
        },
        {
            header: "规则名称",
            accessorKey: "name",
            accessorFn: (row) => row.name,
            cell: ({ row }) => {
                const s = row.original
                return (
                    <div className="max-w-44 whitespace-normal break-words font-medium">
                        {s.name}
                    </div>
                )
            },
        },
        {
            header: "触发条件（白话摘要）",
            cell: ({ row }) => {
                const s = row.original
                const summaries = summarizeAlertRules(
                    s.rules as unknown as Array<Record<string, any>>,
                )
                return (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {summaries.map((txt, idx) => (
                            <span
                                key={idx}
                                className="rounded-md border bg-muted/60 px-2 py-0.5 text-xs"
                            >
                                {txt}
                            </span>
                        ))}
                        <CopyButton text={JSON.stringify(s.rules)} />
                    </div>
                )
            },
        },
        {
            header: "接收通知分组",
            accessorKey: "ngroup",
            accessorFn: (row) => row.notification_group_id,
            cell: ({ row }) => {
                const gid = row.original.notification_group_id
                if (!gid) {
                    return (
                        <span className="text-xs text-muted-foreground">
                            🔇 不发消息（仅统计）
                        </span>
                    )
                }
                const gName = groupNameMap.get(gid)
                return (
                    <span className="rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
                        📢 {gName || `分组 #${gid}`}
                    </span>
                )
            },
        },
        {
            header: "通知频率",
            accessorKey: "trigger_mode",
            cell: ({ row }) => {
                const mode = row.original.trigger_mode
                return (
                    <span className="text-xs text-muted-foreground">
                        {mode === 1 ? "每次故障 1 次" : "持续重复发送"}
                    </span>
                )
            },
        },
        {
            header: "状态",
            accessorKey: "enable",
            cell: ({ row }) => {
                const enabled = Boolean(row.original.enable)
                return enabled ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        ● 已启用
                    </span>
                ) : (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        ○ 已停用
                    </span>
                )
            },
        },
        {
            id: "actions",
            header: t("Actions"),
            cell: ({ row }) => {
                const s = row.original
                return (
                    <ActionButtonGroup
                        className="flex gap-2"
                        delete={{
                            fn: deleteAlertRules,
                            id: s.id,
                            mutate: mutate,
                        }}
                    >
                        <AlertRuleCard mutate={mutate} data={s} />
                    </ActionButtonGroup>
                )
            },
        },
    ]

    const dataCache = useMemo(() => {
        return data ?? []
    }, [data])

    const table = useTable({
        features: selectableTableFeatures,
        data: dataCache,
        columns,
    })

    const selectedRows = table.getSelectedRowModel().rows

    return (
        <div className="mx-auto max-w-5xl px-3 pb-8">
            <div className="mt-6 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <NotificationTab className="w-full sm:max-w-xl" />
                <HeaderButtonGroup
                    className="flex gap-2 self-end sm:self-auto shrink-0"
                    delete={{
                        fn: deleteAlertRules,
                        id: selectedRows.map((r) => r.original.id),
                        mutate: mutate,
                    }}
                >
                    <AlertRuleCard mutate={mutate} />
                </HeaderButtonGroup>
            </div>

            <NotificationFlowGuide currentStep={3} />

            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                💡 <strong>小白省心提示</strong>：系统已默认开启<strong>「全自动周期流量记录」</strong>！如果你只是想在前台显示每台小鸡的月流量进度条，直接在<strong>「服务器管理 → 编辑 → 公开备注 → 流量配额」</strong>填写（如{" "}
                <code>1TB/Month</code>）即可自动统计并展示，以后新买小鸡<strong>再也不需要来这里手动建周期流量警报规则</strong>啦！这里只需开启「机器离线提醒」或「CPU/内存告警」即可。
            </div>

            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id} className="text-sm">
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(
                                              header.column.columnDef.header,
                                              header.getContext(),
                                          )}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                {t("Loading")}...
                            </TableCell>
                        </TableRow>
                    ) : table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id} className="text-xsm">
                                        {flexRender(
                                            cell.column.columnDef.cell,
                                            cell.getContext(),
                                        )}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell
                                colSpan={columns.length}
                                className="h-28 text-center text-sm text-muted-foreground"
                            >
                                还没有创建任何警报规则，点击右上角「新建警报规则」，一键点选「🔴 离线必开」即可保护所有服务器！
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
