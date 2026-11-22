import { cn } from "@/lib/utils"
import {
    NavigationMenuLinkProps,
    NavigationMenuTriggerProps,
} from "@radix-ui/react-navigation-menu"
import { motion } from "framer-motion"

import {
    NavigationMenuLink,
    NavigationMenuTrigger,
    navigationMenuTriggerStyle,
} from "../ui/navigation-menu"

export const NzNavigationMenuLink = ({
    className,
    active,
    ...props
}: NavigationMenuLinkProps & React.RefAttributes<HTMLAnchorElement>) => {
    return (
        <div className="relative shrink-0">
            <NavigationMenuLink
                {...props}
                active={active}
                aria-current={active ? "page" : undefined}
                className={cn(
                    navigationMenuTriggerStyle(),
                    "h-10 whitespace-nowrap px-2.5 text-[13px] hover:bg-inherit data-[active]:bg-inherit transition-colors text-foreground/65 data-[active]:font-semibold data-[active]:text-foreground hover:text-foreground/95",
                    className,
                )}
            />
            {active && (
                <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-black dark:bg-white"
                />
            )}
        </div>
    )
}

export const NzNavigationMenuTrigger = (
    props: Omit<NavigationMenuTriggerProps & React.RefAttributes<HTMLButtonElement>, "ref"> &
        React.RefAttributes<HTMLButtonElement>,
) => {
    return (
        <NavigationMenuTrigger
            {...props}
            className={
                navigationMenuTriggerStyle() +
                " hover:bg-inherit data-[active]:bg-inherit transition-colors text-foreground/60 data-[active]:text-foreground hover:text-foreground/90"
            }
        />
    )
}
