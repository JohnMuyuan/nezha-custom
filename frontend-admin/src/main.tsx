// NOTE: Do not modify the import order unless absolutely necessary.
import { Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom"

import "./index.css"
import "./lib/i18n"

import { AuthProvider } from "./hooks/useAuth"
import { NotificationProvider } from "./hooks/useNotfication"
import { ServerProvider } from "./hooks/useServer"

import Root from "./routes/root"
import ErrorPage from "./error-page"

import ProtectedRoute from "./routes/protect"
import CronPage from "./routes/cron"
import LoginPage from "./routes/login"
import ServerPage from "./routes/server"
import ServicePage from "./routes/service"
import DDNSPage from "./routes/ddns"
import NATPage from "./routes/nat"
import NotificationGroupPage from "./routes/notification-group"
import ServerGroupPage from "./routes/server-group"
import AlertRulePage from "./routes/alert-rule"
import NotificationPage from "./routes/notification"
import OnlineUserPage from "./routes/online-user"
import ProfilePage from "./routes/profile"
import SettingsPage from "./routes/settings"
import TransferPage from "./routes/transfer"
import WAFPage from "./routes/waf"
import ApiTokensPage from "./routes/api-tokens"
import FrontendsPage from "./routes/frontends"
import MCPOAuthAuthorizePage from "./routes/mcp-oauth-authorize"
import MCPOAuthManagementPage from "./routes/mcp-oauth-management"

const TerminalPage = lazy(() =>
    import("./components/terminal").then((m) => ({ default: m.TerminalPage })),
)
const ThemeCustomPage = lazy(() => import("./routes/theme-custom"))
const AIOpsPage = lazy(() => import("./routes/ai-ops"))
const MigrationPage = lazy(() => import("./routes/migration"))

const router = createBrowserRouter([
    {
        path: "/dashboard",
        element: (
            <AuthProvider>
                <ProtectedRoute>
                    <Root />
                </ProtectedRoute>
            </AuthProvider>
        ),
        errorElement: <ErrorPage />,
        children: [
            { path: "/dashboard/mcp/authorize", element: <MCPOAuthAuthorizePage /> },
            {
                path: "/dashboard/login",
                element: <LoginPage />,
            },
            {
                path: "/dashboard",
                element: (
                    <ServerProvider withServerGroup>
                        <ServerPage />
                    </ServerProvider>
                ),
            },
            {
                path: "/dashboard/service",
                element: (
                    <ServerProvider withServer>
                        <NotificationProvider withNotifierGroup>
                            <ServicePage />
                        </NotificationProvider>
                    </ServerProvider>
                ),
            },
            {
                path: "/dashboard/cron",
                element: (
                    <ServerProvider withServer>
                        <NotificationProvider withNotifierGroup>
                            <CronPage />
                        </NotificationProvider>
                    </ServerProvider>
                ),
            },
            {
                path: "/dashboard/alert-rule",
                element: (
                    <ServerProvider withServer>
                        <NotificationProvider withNotifierGroup>
                            <AlertRulePage />
                        </NotificationProvider>
                    </ServerProvider>
                ),
            },
            {
                path: "/dashboard/ddns",
                element: <DDNSPage />,
            },
            {
                path: "/dashboard/nat",
                element: <NATPage />,
            },
            {
                path: "/dashboard/server-group",
                element: (
                    <ServerProvider withServer>
                        <ServerGroupPage />
                    </ServerProvider>
                ),
            },
            {
                path: "/dashboard/notification-group",
                element: (
                    <NotificationProvider withNotifier>
                        <NotificationGroupPage />
                    </NotificationProvider>
                ),
            },
            {
                path: "/dashboard/terminal/:id",
                element: (
                    <Suspense fallback={<div className="p-6 text-xs text-muted-foreground">正在加载终端...</div>}>
                        <TerminalPage />
                    </Suspense>
                ),
            },
            {
                path: "/dashboard/notification",
                element: (
                    <NotificationProvider withNotifierGroup>
                        <NotificationPage />
                    </NotificationProvider>
                ),
            },
            {
                path: "/dashboard/profile",
                element: (
                    <ServerProvider withServer withServerGroup>
                        <ProfilePage />
                    </ServerProvider>
                ),
            },
            {
                path: "/dashboard/settings",
                element: (
                    <NotificationProvider withNotifierGroup>
                        <SettingsPage />
                    </NotificationProvider>
                ),
            },
            {
                path: "/dashboard/settings/theme-custom",
                element: (
                    <NotificationProvider withNotifierGroup>
                        <Suspense fallback={<div className="p-6 text-xs text-muted-foreground">正在加载主题工坊...</div>}>
                            <ThemeCustomPage />
                        </Suspense>
                    </NotificationProvider>
                ),
            },
            {
                path: "/dashboard/settings/frontends",
                element: <FrontendsPage />,
            },
            {
                path: "/dashboard/settings/user",
                element: <Navigate to="/dashboard/settings" replace />,
            },
            {
                path: "/dashboard/settings/waf",
                element: <WAFPage />,
            },
            {
                path: "/dashboard/settings/online-user",
                element: <OnlineUserPage />,
            },
            {
                path: "/dashboard/settings/api-tokens",
                element: <ApiTokensPage />,
            },
            {
                path: "/dashboard/settings/mcp-oauth",
                element: <MCPOAuthManagementPage />,
            },
            {
                path: "/dashboard/transfer",
                element: <TransferPage />,
            },
            {
                path: "/dashboard/ai-ops",
                element: (
                    <NotificationProvider withNotifierGroup>
                        <Suspense fallback={<div className="p-6 text-xs text-muted-foreground">正在加载 AI 运维助手...</div>}>
                            <AIOpsPage />
                        </Suspense>
                    </NotificationProvider>
                ),
            },
            {
                path: "/dashboard/migration",
                element: (
                    <Suspense fallback={<div className="p-6 text-xs text-muted-foreground">正在加载备份与搬家中心...</div>}>
                        <MigrationPage />
                    </Suspense>
                ),
            },
        ],
    },
])

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />)
