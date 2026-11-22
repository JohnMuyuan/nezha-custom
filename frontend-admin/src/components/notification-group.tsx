import { createNotificationGroup, updateNotificationGroup } from "@/api/notification-group"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconButton } from "@/components/xui/icon-button"
import { MultiSelect } from "@/components/xui/multi-select"
import { useNotification } from "@/hooks/useNotfication"
import { ModelNotificationGroupResponseItem } from "@/types"
import { zodResolver } from "@hookform/resolvers/zod"
import { FolderPlus } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyedMutator } from "swr"
import { z } from "zod"

interface NotificationGroupCardProps {
    data?: ModelNotificationGroupResponseItem
    mutate: KeyedMutator<ModelNotificationGroupResponseItem[]>
}

const notificationGroupFormSchema = z.object({
    name: z.string().min(1, "请填写分组名称"),
    notifications: z.array(z.number()),
})

export const NotificationGroupCard: React.FC<NotificationGroupCardProps> = ({ data, mutate }) => {
    const { t } = useTranslation()
    const form = useForm<z.infer<typeof notificationGroupFormSchema>>({
        resolver: zodResolver(notificationGroupFormSchema),
        defaultValues: data
            ? {
                  name: data.group.name,
                  notifications: data.notifications,
              }
            : {
                  name: "",
                  notifications: [],
              },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    const [open, setOpen] = useState(false)

    const onSubmit = async (values: z.infer<typeof notificationGroupFormSchema>) => {
        try {
            if (data?.group.id) {
                await updateNotificationGroup(data.group.id, values)
            } else {
                await createNotificationGroup(values)
            }
            toast.success("通知分组已保存")
        } catch (e) {
            console.error(e)
            toast(t("Error"), {
                description: t("Results.UnExpectedError"),
            })
            return
        }
        setOpen(false)
        await mutate()
        form.reset()
    }

    const { notifiers } = useNotification()
    const notifierList =
        notifiers?.map((n) => ({
            value: `${n.id}`,
            label: `${n.name} (#${n.id})`,
        })) || []

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {data ? (
                    <IconButton variant="outline" icon="edit" />
                ) : (
                    <Button size="sm" className="gap-1.5">
                        <FolderPlus className="h-3.5 w-3.5" />
                        新建通知分组
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="mx-1 items-center">
                        <DialogHeader>
                            <DialogTitle>
                                {data ? "编辑通知分组" : "新建通知分组"}
                            </DialogTitle>
                            <DialogDescription className="text-xs">
                                通知分组就像一个「收件人名单」：你可以只勾 1 个渠道（比如 Telegram），也可以把 Telegram + 手机 Bark 同时勾进来一起收通知。
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...form}>
                            <form
                                onSubmit={form.handleSubmit(onSubmit)}
                                className="my-3 space-y-4"
                            >
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>分组名称</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="例如：主力告警通知组"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="notifications"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>勾选要接收消息的渠道（可多选）</FormLabel>
                                            <MultiSelect
                                                type="button"
                                                modalPopover
                                                placeholder="点击选择推送渠道..."
                                                options={notifierList}
                                                onValueChange={(e) => {
                                                    const arr = e.map(Number)
                                                    field.onChange(arr)
                                                }}
                                                defaultValue={field.value?.map(String)}
                                            />
                                            <FormDescription className="text-xs">
                                                如果下拉框为空，请先去「① 推送渠道」添加一个渠道。
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <DialogFooter className="justify-end gap-2">
                                    <DialogClose asChild>
                                        <Button type="button" variant="secondary">
                                            {t("Close")}
                                        </Button>
                                    </DialogClose>
                                    <Button type="submit">{t("Confirm")}</Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
