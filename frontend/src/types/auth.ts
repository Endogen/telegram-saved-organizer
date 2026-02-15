export type TelegramAuthStatus = {
  connected: boolean;
  authorized: boolean;
  has_session: boolean;
  verification_required: boolean;
  password_required: boolean;
};

export type ConnectTelegramPayload = {
  api_id: number;
  api_hash: string;
  phone: string;
};

export type VerifyTelegramPayload = {
  code?: string;
  password?: string;
};
