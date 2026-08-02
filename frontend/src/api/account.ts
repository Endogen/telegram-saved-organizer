import { requestJson } from "@/api/client";
import type {
  AccountUser,
  ChangePasswordPayload,
  DeleteAccountPayload,
  RegistrationPayload,
  UpdateAccountPayload,
} from "@/types/account";

const ACCOUNT_ENDPOINT = "/api/account";

export async function registerAccount(payload: RegistrationPayload): Promise<void> {
  await requestJson<void>(`${ACCOUNT_ENDPOINT}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, {
    fallbackMessage: "Could not complete registration.",
    notifyUnauthorized: false,
  });
}

export async function fetchAccount(signal?: AbortSignal): Promise<AccountUser> {
  return requestJson<AccountUser>(ACCOUNT_ENDPOINT, { signal }, {
    fallbackMessage: "Could not load your account.",
  });
}

export async function updateAccount(payload: UpdateAccountPayload): Promise<AccountUser> {
  return requestJson<AccountUser>(ACCOUNT_ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, {
    fallbackMessage: "Could not update your account.",
  });
}

export async function deleteAccount(payload: DeleteAccountPayload): Promise<void> {
  await requestJson<void>(ACCOUNT_ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, {
    fallbackMessage: "Could not delete your account.",
  });
}

export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await requestJson<void>(`${ACCOUNT_ENDPOINT}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, {
    fallbackMessage: "Could not change your password.",
  });
}
