import { deleteAlertRules } from "@/api/alert-rule"
import { swrFetcher } from "@/api/api"
import { ActionButtonGroup } from "@/components/action-button-group"
import { AlertRuleCard } from "@/components/alert-rule"
import { CopyButton } from "@/components/copy-button"
import { HeaderButtonGroup } from "@/components/header-button-group"
import { NotificationTab } from "@/components/notification-tab"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { selectableTableFeatures } from "@/lib/table"
import { ModelAlertRule, triggerModes } from "@/types"
import { ColumnDef, flexRender, useTable } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR from "swr"

export default function AlertRulePage() {
    const { t } = useTranslation()

    const { data, mutate, error, isLoading } = useSWR<ModelAlertRule[]>(
        "/api/v1/alert-rule",
        swrFetcher,
    )

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
            header: t("Name"),
            accessorKey: "name",
            accessorFn: (row) => row.name,
            cell: ({ row }) => {
                const s = row.original
                return <div className="max-w-32 whitespace-normal break-words">{s.name}</div>
            },
        },
        {
            header: t("NotifierGroup"),
            accessorKey: "ngroup",
            accessorFn: (row) => row.notification_group_id,
        },
        {
            header: t("TriggerMode"),
            accessorKey: "trigger Mode",
            accessorFn: (row) => triggerModes[row.trigger_mode] || "",
        },
        {
            header: t("Rules"),
            cell: ({ row }) => {
                const s = row.original
                return <CopyButton text={JSON.stringify(s.rules)} />
            },
        },
        {
            header: t("TasksToTriggerOnAlert"),
            accessorKey: "failTriggerTasks",
            accessorFn: (row) => row.fail_trigger_tasks,
        },
        {
            header: t("TasksToTriggerAfterRecovery"),
            accessorKey: "recoverTriggerTasks",
            accessorFn: (row) => row.recover_trigger_tasks,
        },
        {
            header: t("Enable"),
            accessorKey: "enable",
            accessorFn: (row) => row.enable,
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
        <div className="px-3">
            <div className="flex mt-6 mb-4">
                <NotificationTab className="flex-1 mr-4 sm:max-w-[40%]" />
                <HeaderButtonGroup
                    className="flex ml-auto self-end sm:self-auto gap-2 flex-wrap shrink-0"
                    delete={{
                        fn: deleteAlertRules,
                        id: selectedRows.map((r) => r.original.id),
                        mutate: mutate,
                    }}
                >
                    <AlertRuleCard mutate={mutate} />
                </HeaderButtonGroup>
            </div>

            <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                💡 <strong>小白省心提示</strong>：系统已默认开启<strong>「全自动周期流量记录」</strong>！如果你只是想在前台显示每台小鸡的月流量进度条，直接在<strong>「服务器管理 → 编辑 → 公开备注 → 流量配额」</strong>填写（如 <code>1TB/Month</code>）即可自动统计并展示，以后新买小鸡<strong>再也不需要来这里手动建 <code>transfer_all_cycle</code> 警报规则</strong>啦（这里仅用于确实需要发超额告警消息或离线通知的场景）。
            </div>

            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                return (
                                    <TableHead key={header.id} className="text-sm">
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext(),
                                              )}
                                    </TableHead>
                                )
                            })}
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
                            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id} className="text-xsm">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                {t("NoResults")}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
