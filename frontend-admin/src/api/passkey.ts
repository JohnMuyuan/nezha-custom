import { FetcherMethod, fetcher } from "./api"

export interface AuthPolicyResponse {
    single_admin: boolean
    passkey_available: boolean
    passkey_only: boolean
    password_login_enabled: boolean
    oauth2_enabled: boolean
    emergency_password_override: boolean
    rp_id: string
}

export interface PasskeyCredentialView {
    id: string
    name: string
    aaguid: string
    credential_device_type: "singleDevice" | "multiDevice"
    credential_backed_up: boolean
    transports: string[]
    counter: number
    registered_at: number
    last_used_at?: number
}

export interface PasskeyListResponse {
    rp_id: string
    user_id: string
    username: string
    passkey_only: boolean
    emergency_password_override: boolean
    credentials: PasskeyCredentialView[]
}

export interface PasskeyBeginResponse {
    challenge_id: string
    rp_id: string
    publicKey: Record<string, any>
}

export interface PasskeyLoginFinishResponse {
    ok: boolean
    trusted_device: boolean
    totp_required: boolean
    pending_token?: string
    username?: string
    token?: string
    expire?: string
}

export interface TrustedDeviceView {
    id: number
    device_name: string
    last_ip: string
    is_current: boolean
    created_at: number
    last_used_at: number
    expires_at: number
}

// Valid unpadded Base64URL check (strictly required before invoking WebAuthn Signal APIs)
export function isValidBase64Url(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length % 4 !== 1 &&
        /^[A-Za-z0-9_-]+$/.test(value)
    )
}

export async function signalAllAcceptedCredentialsSafe(
    rpId: string,
    userId: string,
    credentialIds: string[],
): Promise<void> {
    const pkc = (window as any).PublicKeyCredential
    if (!pkc || typeof pkc.signalAllAcceptedCredentials !== "function") return
    if (!rpId || !isValidBase64Url(userId) || !credentialIds.every(isValidBase64Url)) {
        console.warn("signalAllAcceptedCredentials skipped: invalid rpId, userId, or credentialIds")
        return
    }
    try {
        await pkc.signalAllAcceptedCredentials({
            rpId,
            userId,
            allAcceptedCredentialIds: credentialIds,
        })
    } catch (e) {
        console.warn("signalAllAcceptedCredentials warning:", e)
    }
}

export async function signalUnknownCredentialSafe(
    rpId: string,
    credentialId: string,
): Promise<void> {
    const pkc = (window as any).PublicKeyCredential
    if (!pkc || typeof pkc.signalUnknownCredential !== "function") return
    if (!rpId || !isValidBase64Url(credentialId)) return
    try {
        await pkc.signalUnknownCredential({
            rpId,
            credentialId,
        })
    } catch (e) {
        console.warn("signalUnknownCredential warning:", e)
    }
}

export async function signalCurrentUserDetailsSafe(
    rpId: string,
    userId: string,
    name: string,
    displayName: string,
): Promise<void> {
    const pkc = (window as any).PublicKeyCredential
    if (!pkc || typeof pkc.signalCurrentUserDetails !== "function") return
    if (!rpId || !isValidBase64Url(userId)) return
    try {
        await pkc.signalCurrentUserDetails({
            rpId,
            userId,
            name,
            displayName,
        })
    } catch (e) {
        console.warn("signalCurrentUserDetails warning:", e)
    }
}

export const getAuthPolicy = async (): Promise<AuthPolicyResponse> => {
    return fetcher<AuthPolicyResponse>(FetcherMethod.GET, "/api/v1/auth/policy", null)
}

export const listPasskeys = async (): Promise<PasskeyListResponse> => {
    return fetcher<PasskeyListResponse>(FetcherMethod.GET, "/api/v1/profile/passkeys", null)
}

export const beginPasskeyRegister = async (): Promise<PasskeyBeginResponse> => {
    return fetcher<PasskeyBeginResponse>(
        FetcherMethod.POST,
        "/api/v1/profile/passkey/register/begin",
        {},
    )
}

export interface RawHttpJsonResult<T> {
    ok: boolean
    status: number
    data?: T
    error?: string
}

function getCsrfTokenFromCookie(): string {
    const match = document.cookie
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("nz-csrf="))
    return match ? decodeURIComponent(match.slice("nz-csrf=".length)) : ""
}

// Raw fetch helpers so callers can inspect HTTP status (e.g. 404 for signalUnknownCredential)
export const finishPasskeyRegisterRaw = async (
    challengeId: string,
    credential: unknown,
    name?: string,
): Promise<RawHttpJsonResult<PasskeyCredentialView>> => {
    const res = await fetch("/api/v1/profile/passkey/register/finish", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": getCsrfTokenFromCookie(),
        },
        body: JSON.stringify({
            challenge_id: challengeId,
            name: name || "",
            credential,
        }),
    })
    let json: any
    try {
        json = await res.json()
    } catch {
        json = null
    }
    if (!res.ok || !json?.success) {
        return {
            ok: false,
            status: res.status,
            error: json?.error || `HTTP ${res.status}`,
        }
    }
    return { ok: true, status: res.status, data: json.data }
}

export const renamePasskey = async (
    id: string,
    name: string,
): Promise<PasskeyCredentialView> => {
    return fetcher<PasskeyCredentialView>(
        FetcherMethod.PUT,
        `/api/v1/profile/passkeys/${encodeURIComponent(id)}`,
        { name },
    )
}

export const deletePasskey = async (id: string): Promise<void> => {
    return fetcher<void>(
        FetcherMethod.DELETE,
        `/api/v1/profile/passkeys/${encodeURIComponent(id)}`,
        null,
    )
}

export const updateAuthPolicy = async (passkeyOnly: boolean): Promise<AuthPolicyResponse> => {
    return fetcher<AuthPolicyResponse>(FetcherMethod.PUT, "/api/v1/profile/auth-policy", {
        passkey_only: passkeyOnly,
    })
}

export const beginPasskeyLogin = async (): Promise<PasskeyBeginResponse> => {
    return fetcher<PasskeyBeginResponse>(FetcherMethod.POST, "/api/v1/passkey/login/begin", {})
}

export const finishPasskeyLoginRaw = async (
    challengeId: string,
    credential: unknown,
): Promise<RawHttpJsonResult<PasskeyLoginFinishResponse>> => {
    const res = await fetch("/api/v1/passkey/login/finish", {
        method: "POST",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            challenge_id: challengeId,
            credential,
        }),
    })
    let json: any
    try {
        json = await res.json()
    } catch {
        json = null
    }
    if (!res.ok || !json?.success) {
        return {
            ok: false,
            status: res.status,
            error: json?.error || `HTTP ${res.status}`,
        }
    }
    return { ok: true, status: res.status, data: json.data }
}

export const completePasskeyLoginTOTP = async (
    pendingToken: string,
    totpCode: string,
): Promise<PasskeyLoginFinishResponse> => {
    return fetcher<PasskeyLoginFinishResponse>(FetcherMethod.POST, "/api/v1/passkey/login/totp", {
        pending_token: pendingToken,
        totp_code: totpCode,
    })
}

export const listTrustedDevices = async (): Promise<TrustedDeviceView[]> => {
    return fetcher<TrustedDeviceView[]>(FetcherMethod.GET, "/api/v1/profile/trusted-devices", null)
}

export const revokeTrustedDevice = async (id: number): Promise<void> => {
    return fetcher<void>(FetcherMethod.DELETE, `/api/v1/profile/trusted-devices/${id}`, null)
}

export const revokeAllTrustedDevices = async (keepCurrent = false): Promise<void> => {
    const q = keepCurrent ? "?keep_current=true" : ""
    return fetcher<void>(FetcherMethod.DELETE, `/api/v1/profile/trusted-devices${q}`, null)
}
