import { ModelProfile, ModelProfileForm, ModelUserForm } from "@/types"

import { FetcherMethod, fetcher } from "./api"

export const getProfile = async (): Promise<ModelProfile> => {
    return fetcher<ModelProfile>(FetcherMethod.GET, "/api/v1/profile", null)
}

export const login = async (
    username: string,
    password: string,
    totpCode?: string,
): Promise<void> => {
    const payload: Record<string, string> = { username, password }
    if (totpCode && totpCode.trim() !== "") {
        payload.totp_code = totpCode.trim()
    }
    return fetcher<void>(FetcherMethod.POST, "/api/v1/login", payload)
}

export interface TOTPSetupResponse {
    secret: string
    otpauth_uri: string
    issuer: string
    account: string
}

export interface TOTPEnableResponse {
    enabled: boolean
    recovery_codes: string[]
}

export const setupTOTP = async (password: string): Promise<TOTPSetupResponse> => {
    return fetcher<TOTPSetupResponse>(FetcherMethod.POST, "/api/v1/profile/2fa/setup", { password })
}

export const enableTOTP = async (code: string): Promise<TOTPEnableResponse> => {
    return fetcher<TOTPEnableResponse>(FetcherMethod.POST, "/api/v1/profile/2fa/enable", { code })
}

export const disableTOTP = async (password: string, code: string): Promise<{ enabled: boolean }> => {
    return fetcher<{ enabled: boolean }>(FetcherMethod.POST, "/api/v1/profile/2fa/disable", {
        password,
        code,
    })
}

export const createUser = async (data: ModelUserForm): Promise<number> => {
    return fetcher<number>(FetcherMethod.POST, "/api/v1/user", data)
}

export const deleteUser = async (id: number[]): Promise<void> => {
    return fetcher<void>(FetcherMethod.POST, "/api/v1/batch-delete/user", id)
}

export interface UpdateProfileResponse {
    rp_id?: string
    user_id?: string
    username?: string
}

export const updateProfile = async (
    data: ModelProfileForm,
): Promise<UpdateProfileResponse | void> => {
    return fetcher<UpdateProfileResponse | void>(FetcherMethod.POST, "/api/v1/profile", data)
}
