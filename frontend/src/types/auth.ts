export type ConnectTelegramPayload = {
  apiId: number;
  apiHash: string;
  phone: string;
};

export type VerifyTelegramPayload =
  | { code: string }
  | { password: string };

export type TelegramAccountSummary = {
  display_name?: string | null;
  phone_masked?: string | null;
  username?: string | null;
};

export type TelegramConnection =
  | { state: "disconnected" }
  | { state: "code_required"; phone_masked?: string | null }
  | { state: "password_required"; phone_masked?: string | null }
  | { state: "connected"; account?: TelegramAccountSummary | null };

/** @deprecated Use TelegramConnection. */
export type TelegramAuthStatus = TelegramConnection;
