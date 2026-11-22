import { swrFetcher } from "@/api/api"
import { deleteNotificationGroups } from "@/api/notification-group"
import { ActionButtonGroup } from "@/components/action-button-group"
import { HeaderButtonGroup } from "@/components/header-button-group"
import { NotificationGroupCard } from "@/components/notification-group"
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
import { selectableTableFeatures } from "@/lib/table"
import { ModelNotificationGroupResponseItem } from "@/types"
import { ColumnDef, flexRender, useTable } from "@tanstack/react-table"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import useSWR from "swr"

type NotificationGroupColumn = ColumnDef<
    typeof selectableTableFeatures,
    ModelNotificationGroupResponseItem
>

export default function NotificationGroupPage() {
    const { t } = useTranslation()
    const { data, mutate, error, isLoading } = useSWR<ModelNotificationGroupResponseItem[]>(
        "/api/v1/notification-group",
        swrFetcher,
    )
    const { notifiers } = useNotification()

    const notifierNameMap = useMemo(() => {
        const m = new Map<number, string>()
        for (const n of notifiers ?? []) {
            m.set(n.id, n.name)
        }
        return m
    }, [notifiers])

    useEffect(() => {
        if (error)
            toast(t("Error"), {
                description: t("Results.ErrorFetchingResource", {
                    error: error.message,
                }),
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error])

    const columns: NotificationGroupColumn[] = [
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
            accessorFn: (row) => row.group.id,
        },
        {
            header: "通知分组名称",
            accessorKey: "name",
            accessorFn: (row) => row.group.name,
            cell: ({ row }) => {
                const s = row.original
                return <div className="font-medium">{s.group.name}</div>
            },
        },
        {
            header: "包含的推送渠道",
            accessorKey: "notifications",
            accessorFn: (row) => row.notifications,
            cell: ({ row }) => {
                const ids = row.original.notifications || []
                if (ids.length === 0) {
                    return <span className="text-xs text-muted-foreground">尚未勾选渠道</span>
                }
                return (
                    <div className="flex flex-wrap gap-1.5">
                        {ids.map((id) => (
                            <span
                                key={id}
                                className="rounded-md border bg-muted/60 px-2 py-0.5 text-xs"
                            >
                                {notifierNameMap.get(id) || `渠道 #${id}`}
                            </span>
                        ))}
                    </div>
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
                            fn: deleteNotificationGroups,
                            id: s.group.id,
                            mutate: mutate,
                        }}
                    >
                        <NotificationGroupCard mutate={mutate} data={s} />
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
                        fn: deleteNotificationGroups,
                        id: selectedRows.map((r) => r.original.group.id),
                        mutate: mutate,
                    }}
                >
                    <NotificationGroupCard mutate={mutate} />
                </HeaderButtonGroup>
            </div>

            <NotificationFlowGuide currentStep={2} />

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
                                还没有任何通知分组，点击右上角「新建通知分组」并勾选你刚才创建的推送渠道即可！
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
