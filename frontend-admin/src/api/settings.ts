import { ModelSettingForm } from "@/types"

import { FetcherMethod, fetcher } from "./api"

export const updateSettings = async (data: ModelSettingForm): Promise<void> => {
    return fetcher<void>(FetcherMethod.PATCH, `/api/v1/setting`, data)
}

export const runAllInspections = async (scopes?: string[]): Promise<{ queued: number }> => {
    return fetcher<{ queued: number }>(FetcherMethod.POST, `/api/v1/inspections/run-all`, {
        scopes,
    })
}

export const testExpiryNotification = async (): Promise<{ matched: number; message: string }> => {
    return fetcher<{ matched: number; message: string }>(
        FetcherMethod.POST,
        `/api/v1/setting/expiry-notify/test`,
    )
}
