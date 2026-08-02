import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { PublicOnly, RequireAuth, getSafeReturnTo } from "@/components/auth/route-guards";

const authMocks = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("@/components/auth/auth-provider", () => authMocks);

function LocationProbe() {
  const location = useLocation();
  return <div>{`${location.pathname}|${String(location.state?.returnTo ?? "")}`}</div>;
}

describe("auth route guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends anonymous users to login with their full return path", async () => {
    authMocks.useAuth.mockReturnValue({ status: "anonymous" });
    render(
      <MemoryRouter initialEntries={["/messages?category=links#saved"]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="messages" element={<div>Private</div>} />
          </Route>
          <Route path="login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("/login|/messages?category=links#saved")).toBeInTheDocument();
  });

  it("renders protected routes for authenticated users", () => {
    authMocks.useAuth.mockReturnValue({ status: "authenticated" });
    render(
      <MemoryRouter initialEntries={["/messages"]}>
        <Routes>
          <Route element={<RequireAuth />}><Route path="messages" element={<div>Private</div>} /></Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("keeps anonymous users on public routes and redirects authenticated users", () => {
    authMocks.useAuth.mockReturnValue({ status: "anonymous" });
    const first = render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes><Route element={<PublicOnly />}><Route path="login" element={<div>Login</div>} /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Login")).toBeInTheDocument();
    first.unmount();

    authMocks.useAuth.mockReturnValue({ status: "authenticated" });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { returnTo: "/messages?q=one" } }]}>
        <Routes>
          <Route element={<PublicOnly />}><Route path="login" element={<div>Login</div>} /></Route>
          <Route path="messages" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("/messages|")).toBeInTheDocument();
  });

  it("continues an authenticated registration to Telegram onboarding", async () => {
    authMocks.useAuth.mockReturnValue({ status: "authenticated" });
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route element={<PublicOnly />}><Route path="register" element={<div>Register</div>} /></Route>
          <Route path="onboarding/telegram" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("/onboarding/telegram|")).toBeInTheDocument();
  });

  it("rejects external and recursive auth return targets", () => {
    expect(getSafeReturnTo({ returnTo: "https://example.com" })).toBeNull();
    expect(getSafeReturnTo({ returnTo: "//example.com" })).toBeNull();
    expect(getSafeReturnTo({ returnTo: "/\\evil.example" })).toBeNull();
    expect(getSafeReturnTo({ returnTo: "/messages\n/evil" })).toBeNull();
    expect(getSafeReturnTo({ from: { pathname: "/login" } })).toBeNull();
    expect(getSafeReturnTo({ from: { pathname: "/messages", search: "?q=one" } })).toBe("/messages?q=one");
  });
});
