import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { registerAccount } from "@/api/account";
import { API_UNAUTHORIZED_EVENT } from "@/api/client";
import { createSession, deleteSession, fetchSession } from "@/api/session";
import { useUiStore } from "@/stores/ui-store";
import type { AccountUser, LoginPayload, RegistrationPayload } from "@/types/account";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "unavailable";

export type AuthContextValue = {
  status: AuthStatus;
  user: AccountUser | null;
  login: (payload: LoginPayload) => Promise<AccountUser>;
  register: (payload: RegistrationPayload) => Promise<AccountUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

type AuthProviderProps = {
  children: ReactNode;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_CHANNEL_NAME = "tso:auth";
type AuthChannelMessage = { type: "session-changed" } | { type: "signed-out" };

function resetUiState() {
  useUiStore.getState().reset();
}

function isAccountUser(value: unknown): value is AccountUser {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AccountUser>;
  return typeof candidate.id === "string"
    && typeof candidate.email === "string"
    && typeof candidate.display_name === "string"
    && typeof candidate.created_at === "string";
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AccountUser | null>(null);
  const requestVersion = useRef(0);
  const statusRef = useRef<AuthStatus>("loading");
  const channelRef = useRef<BroadcastChannel | null>(null);

  const broadcastAuthChange = useCallback((message: AuthChannelMessage) => {
    channelRef.current?.postMessage(message);
  }, []);

  const clearIdentity = useCallback(() => {
    const changed = statusRef.current !== "anonymous";
    statusRef.current = "anonymous";
    if (!changed) {
      return false;
    }
    resetUiState();
    setUser(null);
    setStatus("anonymous");
    return true;
  }, []);

  const loadSession = useCallback(async (signal?: AbortSignal, broadcast = false) => {
    const version = ++requestVersion.current;
    const isBackgroundRefresh = statusRef.current === "authenticated";
    if (!isBackgroundRefresh) {
      statusRef.current = "loading";
      setStatus("loading");
    }

    try {
      const session = await fetchSession(signal);
      if (signal?.aborted || version !== requestVersion.current) {
        return;
      }

      if (
        typeof session.authenticated !== "boolean"
        || (session.authenticated && !isAccountUser(session.user))
        || (!session.authenticated && session.user !== null)
      ) {
        throw new Error("The server returned an invalid session response.");
      }

      if (session.authenticated) {
        statusRef.current = "authenticated";
        setUser(session.user);
        setStatus("authenticated");
        if (broadcast) {
          broadcastAuthChange({ type: "session-changed" });
        }
      } else {
        const changed = clearIdentity();
        if (broadcast && changed) {
          broadcastAuthChange({ type: "signed-out" });
        }
      }
    } catch {
      if (signal?.aborted || version !== requestVersion.current) {
        return;
      }
      if (isBackgroundRefresh) {
        return;
      }
      statusRef.current = "unavailable";
      setUser(null);
      setStatus("unavailable");
    }
  }, [broadcastAuthChange, clearIdentity]);

  const refreshSession = useCallback(async () => {
    await loadSession(undefined, true);
  }, [loadSession]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal);
    return () => {
      controller.abort();
      requestVersion.current += 1;
    };
  }, [loadSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      requestVersion.current += 1;
      if (clearIdentity()) {
        broadcastAuthChange({ type: "signed-out" });
      }
    };

    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [broadcastAuthChange, clearIdentity]);

  useEffect(() => {
    if (typeof window.BroadcastChannel === "undefined") {
      return;
    }

    const channel = new window.BroadcastChannel(AUTH_CHANNEL_NAME);
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object" || !("type" in event.data)) {
        return;
      }
      if (event.data.type === "signed-out") {
        requestVersion.current += 1;
        clearIdentity();
      } else if (event.data.type === "session-changed") {
        void loadSession();
      }
    };
    channelRef.current = channel;
    channel.addEventListener("message", handleMessage);
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [clearIdentity, loadSession]);

  const login = useCallback(async (payload: LoginPayload) => {
    const version = ++requestVersion.current;
    const session = await createSession(payload);
    if (!session.authenticated || !isAccountUser(session.user)) {
      throw new Error("The server did not create a session.");
    }
    if (version === requestVersion.current) {
      statusRef.current = "authenticated";
      setUser(session.user);
      setStatus("authenticated");
      broadcastAuthChange({ type: "session-changed" });
    }
    return session.user;
  }, [broadcastAuthChange]);

  const register = useCallback(async (payload: RegistrationPayload) => {
    const version = ++requestVersion.current;
    await registerAccount(payload);
    const session = await createSession({ email: payload.email, password: payload.password });
    if (!session.authenticated || !isAccountUser(session.user)) {
      throw new Error("Your account was created, but the server did not create a session.");
    }
    if (version === requestVersion.current) {
      statusRef.current = "authenticated";
      setUser(session.user);
      setStatus("authenticated");
      broadcastAuthChange({ type: "session-changed" });
    }
    return session.user;
  }, [broadcastAuthChange]);

  const logout = useCallback(async () => {
    requestVersion.current += 1;
    await deleteSession();
    if (clearIdentity()) {
      broadcastAuthChange({ type: "signed-out" });
    }
  }, [broadcastAuthChange, clearIdentity]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    login,
    register,
    logout,
    refreshSession,
  }), [login, logout, refreshSession, register, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
