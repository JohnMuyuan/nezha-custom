import { ModelProfile } from "@/types"

export type LoginResult = "ok" | "totp_required" | "totp_invalid" | "error"

export interface AuthContextProps {
    profile: ModelProfile | undefined
    loading: boolean
    login: (username: string, password: string, totpCode?: string) => Promise<LoginResult>
    loginOauth2: () => void
    logout: () => void
}
