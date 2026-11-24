import { signalCurrentUserDetailsSafe } from "@/api/passkey"
import { getProfile, updateProfile } from "@/api/user"
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
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useMainStore } from "@/hooks/useMainStore"
import { asOptionalField } from "@/lib/utils"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

const profileFormSchema = z.object({
    original_password: z.string().max(72).optional(),
    new_password: z.string().max(72).optional(),
    new_username: z.string().min(1).max(32),
    reject_password: asOptionalField(z.boolean()),
})

export const ProfileCard = ({ className }: { className: string }) => {
    const { t } = useTranslation()
    const { profile, setProfile } = useMainStore()
    const passkeyOnly = Boolean(profile?.passkey_only)

    const form = useForm({
        resolver: zodResolver(profileFormSchema) as any,
        defaultValues: {
            original_password: "",
            new_password: "",
            new_username: profile?.username,
            reject_password: profile?.reject_password,
        },
        resetOptions: {
            keepDefaultValues: false,
        },
    })

    const [open, setOpen] = useState(false)

    const onSubmit = async (values: any) => {
        try {
            const res = await updateProfile({
                new_username: values.new_username,
                original_password: passkeyOnly ? "" : values.original_password,
                new_password: passkeyOnly ? "" : values.new_password,
                reject_password: values.reject_password,
            })
            if (res && res.rp_id && res.user_id && res.username) {
                await signalCurrentUserDetailsSafe(
                    res.rp_id,
                    res.user_id,
                    res.username,
                    res.username,
                )
            }
        } catch (e: any) {
            console.error(e)
            toast(t("Error"), {
                description: e?.message || t("Results.UnExpectedError"),
            })
            return
        }
        const updated = await getProfile()
        setProfile(updated)
        setOpen(false)
        form.reset()
        toast.success("个人资料已更新")
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className={className}>
                    {t("UpdateProfile")}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
                <ScrollArea className="max-h-[calc(100dvh-5rem)] p-3">
                    <div className="items-center mx-1">
                        <DialogHeader>
                            <DialogTitle>{t("UpdateProfile")}</DialogTitle>
                            <DialogDescription />
                        </DialogHeader>
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2 my-2">
                                <FormField
                                    control={form.control}
                                    name="new_username"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t("NewUsername")}</FormLabel>
                                            <FormControl>
                                                <Input autoComplete="username" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {!passkeyOnly && (
                                    <>
                                        <FormField
                                            control={form.control}
                                            name="original_password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("OriginalPassword")}</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="password"
                                                            autoComplete="current-password"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="new_password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("NewPassword")}</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="password"
                                                            autoComplete="new-password"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </>
                                )}

                                <DialogFooter className="justify-end">
                                    <DialogClose asChild>
                                        <Button type="button" className="my-2" variant="secondary">
                                            {t("Close")}
                                        </Button>
                                    </DialogClose>
                                    <Button type="submit" className="my-2">
                                        {t("Confirm")}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
