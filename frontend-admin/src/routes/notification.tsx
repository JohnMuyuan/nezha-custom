import { swrFetcher } from "@/api/api"
import { deleteNotification } from "@/api/notification"
import { ActionButtonGroup } from "@/components/action-button-group"
import { CopyButton } from "@/components/copy-button"
import { HeaderButtonGroup } from "@/components/header-button-group"
import { NotificationFlowGuide, NotificationTab } from "@/components/notification-tab"
import { NotifierCard } from "@/components/notifier"
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
import { detectNotifierPlatform } from "@/lib/notification-presets"
import { selectableTableFeatures } from "@/lib/table"
import { ModelNotification } from "@/types"
import { ColumnDef, flexRender, useTable } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR from "swr"

export default function NotificationPage() {
    const { t } = useTranslation()
    const { data, mutate, error, isLoading } = useSWR<ModelNotification[]>(
        "/api/v1/notification",
        swrFetcher,
    )
    const { notifierGroup } = useNotification()

    useEffect(() => {
        if (error)
            toast(t("Error"), {
                description: t("Results.ErrorFetchingResource", {
                    error: error.message,
                }),
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error])

    const columns: ColumnDef<typeof selectableTableFeatures, ModelNotification>[] = [
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
            header: "渠道名称",
            accessorKey: "name",
            accessorFn: (row) => row.name,
            cell: ({ row }) => {
                const s = row.original
                const plat = detectNotifierPlatform(s.url, s.request_body)
                return (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                            {plat.label}
                        </span>
                        <span className="font-medium">{s.name}</span>
                    </div>
                )
            },
        },
        {
            header: "已加入的通知分组",
            accessorKey: "groups",
            cell: ({ row }) => {
                const s = row.original
                const matched =
                    notifierGroup?.filter((ng) => ng.notifications?.includes(s.id)) || []
                if (matched.length === 0) {
                    return (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                            暂未加入分组（去第 ② 步添加）
                        </span>
                    )
                }
                return (
                    <div className="flex flex-wrap gap-1">
                        {matched.map((ng) => (
                            <span
                                key={ng.group.id}
                                className="rounded-md border bg-muted/60 px-2 py-0.5 text-xs"
                            >
                                {ng.group.name}
                            </span>
                        ))}
                    </div>
                )
            },
        },
        {
            header: "接口地址",
            accessorKey: "url",
            accessorFn: (row) => row.url,
            cell: ({ row }) => {
                const s = row.original
                return <CopyButton text={s.url} />
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
                            fn: deleteNotification,
                            id: s.id,
                            mutate: mutate,
                        }}
                    >
                        <NotifierCard mutate={mutate} data={s} />
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
                        fn: deleteNotification,
                        id: selectedRows.map((r) => r.original.id),
                        mutate: mutate,
                    }}
                >
                    <NotifierCard mutate={mutate} />
                </HeaderButtonGroup>
            </div>

            <NotificationFlowGuide currentStep={1} />

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
                                还没有添加任何消息接收渠道，点击右上角「✨ 添加推送渠道」即可一键接入 Telegram、Bark、企业微信、飞书或钉钉！
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
