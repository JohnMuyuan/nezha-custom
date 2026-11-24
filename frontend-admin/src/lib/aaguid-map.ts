// Curated AAGUID registry for UX hints only (per WebAuthn passkeys guidance:
// NEVER use AAGUID for cryptographic trust or access decisions).

export interface PasskeyProviderMeta {
    name: string
    shortCode: string
    accentClass: string
}

const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000"

const AAGUID_MAP: Record<string, PasskeyProviderMeta> = {
    // Apple / iCloud Keychain
    "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": {
        name: "iCloud 钥匙串 / Apple 密码",
        shortCode: "AP",
        accentClass: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    },
    "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": {
        name: "iCloud 钥匙串 (受管)",
        shortCode: "AP",
        accentClass: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    },
    "adce0002-35bc-c60a-648b-0b25f1f05503": {
        name: "Chrome Touch ID (macOS)",
        shortCode: "CH",
        accentClass: "bg-sky-600 text-white",
    },
    // Google Password Manager
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": {
        name: "Google 密码管理工具",
        shortCode: "GP",
        accentClass: "bg-blue-600 text-white",
    },
    // Windows Hello
    "08987058-cadc-4b81-b6e1-30de50dcbe96": {
        name: "Windows Hello (软件)",
        shortCode: "WH",
        accentClass: "bg-cyan-600 text-white",
    },
    "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": {
        name: "Windows Hello (硬件 TPM)",
        shortCode: "WH",
        accentClass: "bg-cyan-600 text-white",
    },
    "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": {
        name: "Windows Hello (VBS)",
        shortCode: "WH",
        accentClass: "bg-cyan-600 text-white",
    },
    // 1Password
    "bada5566-a7aa-401f-bd96-45619a55120d": {
        name: "1Password",
        shortCode: "1P",
        accentClass: "bg-blue-700 text-white",
    },
    // Bitwarden / Vaultwarden
    "d548826e-79b4-db40-a3d8-11116f7e8349": {
        name: "Bitwarden / Vaultwarden",
        shortCode: "BW",
        accentClass: "bg-indigo-600 text-white",
    },
    // KeePassXC
    "53414d53-554e-4700-0000-000000000000": {
        name: "Samsung Pass",
        shortCode: "SP",
        accentClass: "bg-blue-800 text-white",
    },
    "771b48fd-d3d4-4f74-9232-fc157ab0507a": {
        name: "KeePassXC",
        shortCode: "KP",
        accentClass: "bg-emerald-700 text-white",
    },
    // Proton Pass
    "c7026d82-c62f-4919-838b-9843152354a3": {
        name: "Proton Pass",
        shortCode: "PP",
        accentClass: "bg-violet-600 text-white",
    },
    // Dashlane
    "531126d6-e717-415c-9320-3d9aa6981239": {
        name: "Dashlane",
        shortCode: "DL",
        accentClass: "bg-teal-700 text-white",
    },
    // YubiKey 5 Series
    "2fc0579f-8113-47ea-b116-bb5a8db9202a": {
        name: "YubiKey 5 NFC / USB",
        shortCode: "YK",
        accentClass: "bg-lime-700 text-white",
    },
    "cb69481e-8ff7-4039-93ec-0a2729a154a8": {
        name: "YubiKey 5 Series",
        shortCode: "YK",
        accentClass: "bg-lime-700 text-white",
    },
    "ee882879-721c-4913-9775-3dfcce97072a": {
        name: "YubiKey 5 FIPS",
        shortCode: "YK",
        accentClass: "bg-lime-700 text-white",
    },
    // Edge
    "d548826e-79b4-db40-a3d8-11116f7e8348": {
        name: "Microsoft Edge",
        shortCode: "ED",
        accentClass: "bg-sky-700 text-white",
    },
}

export function lookupPasskeyProvider(aaguid?: string): PasskeyProviderMeta | null {
    const normalized = (aaguid || "").trim().toLowerCase()
    if (!normalized || normalized === ZERO_AAGUID) {
        return null
    }
    return AAGUID_MAP[normalized] ?? null
}
