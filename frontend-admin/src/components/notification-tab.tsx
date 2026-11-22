import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Bell, FolderKanban, ShieldAlert } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

export const NotificationTab = ({ className }: { className?: string }) => {
    const location = useLocation()

    return (
        <Tabs value={location.pathname} className={className}>
            <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3">
                <TabsTrigger value="/dashboard/notification" asChild className="py-2">
                    <Link to="/dashboard/notification" className="flex items-center gap-1.5">
                        <Bell className="h-3.5 w-3.5" />
                        <span>① 推送渠道（收消息）</span>
                    </Link>
                </TabsTrigger>
                <TabsTrigger value="/dashboard/notification-group" asChild className="py-2">
                    <Link to="/dashboard/notification-group" className="flex items-center gap-1.5">
                        <FolderKanban className="h-3.5 w-3.5" />
                        <span>② 通知分组（打包渠道）</span>
                    </Link>
                </TabsTrigger>
                <TabsTrigger value="/dashboard/alert-rule" asChild className="py-2">
                    <Link to="/dashboard/alert-rule" className="flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        <span>③ 警报规则（触发条件）</span>
                    </Link>
                </TabsTrigger>
            </TabsList>
        </Tabs>
    )
}

export const NotificationFlowGuide = ({ currentStep }: { currentStep: 1 | 2 | 3 }) => {
    const steps = [
        {
            num: 1,
            title: "第 1 步：添加推送渠道",
            desc: "选 Telegram / Bark / 企微等填好密钥（默认自动建好分组！）",
            to: "/dashboard/notification",
        },
        {
            num: 2,
            title: "第 2 步：管理通知分组",
            desc: "可把多个渠道打包成一个收件组（如同时推 TG + 手机）",
            to: "/dashboard/notification-group",
        },
        {
            num: 3,
            title: "第 3 步：开启警报规则",
            desc: "一键套用『机器离线 / CPU 飙高』模板并选择通知分组",
            to: "/dashboard/alert-rule",
        },
    ] as const

    return (
        <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {steps.map((s) => {
                const active = s.num === currentStep
                return (
                    <Link
                        key={s.num}
                        to={s.to}
                        className={`rounded-lg border px-3.5 py-2.5 transition-colors ${
                            active
                                ? "border-primary/50 bg-primary/5 shadow-xs"
                                : "border-border/60 bg-muted/20 hover:bg-muted/40"
                        }`}
                    >
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <span
                                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                                    active
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted-foreground/20 text-muted-foreground"
                                }`}
                            >
                                {s.num}
                            </span>
                            <span className={active ? "text-primary" : "text-foreground"}>
                                {s.title}
                            </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            {s.desc}
                        </p>
                    </Link>
                )
            })}
        </div>
    )
}
