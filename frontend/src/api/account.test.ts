import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changePassword, deleteAccount, fetchAccount, registerAccount, updateAccount } from "@/api/account";

function response(payload: unknown): Response {
  return { ok: true, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

describe("account api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("registers without changing the password", async () => {
    const payload = { email: "ada@example.com", display_name: "Ada", password: "  exact password  " };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: vi.fn().mockRejectedValue(new SyntaxError("No response body")),
    } as unknown as Response);
    await expect(registerAccount(payload)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/account/register", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(payload),
    }));
  });

  it("fetches and updates the current account", async () => {
    const user = { id: "u1", email: "ada@example.com", display_name: "Ada", created_at: "2026-01-01" };
    fetchMock.mockResolvedValueOnce(response(user)).mockResolvedValueOnce(response({ ...user, display_name: "Ada L." }));
    await expect(fetchAccount()).resolves.toEqual(user);
    await updateAccount({ display_name: "Ada L." });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/account", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ display_name: "Ada L." }),
    }));
  });

  it("changes a password exactly and deletes the account", async () => {
    fetchMock.mockResolvedValue(response(null));
    await changePassword({ current_password: " old ", new_password: " new password " });
    expect(fetchMock).toHaveBeenCalledWith("/api/account/password", expect.objectContaining({
      body: JSON.stringify({ current_password: " old ", new_password: " new password " }),
    }));
    await deleteAccount({ password: " delete password ", confirmation: "DELETE" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/account", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ password: " delete password ", confirmation: "DELETE" }),
    }));
  });
});
