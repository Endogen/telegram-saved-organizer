export type AccountUser = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
};

export type SessionStatus = {
  authenticated: boolean;
  user: AccountUser | null;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegistrationPayload = {
  email: string;
  display_name: string;
  password: string;
};

export type UpdateAccountPayload = {
  display_name: string;
};

export type ChangePasswordPayload = {
  current_password: string;
  new_password: string;
};

export type DeleteAccountPayload = {
  password: string;
  confirmation: "DELETE";
};

export type ActiveSession = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
  user_agent: string | null;
  ip_address: string | null;
};
