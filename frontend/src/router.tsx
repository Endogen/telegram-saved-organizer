import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";

import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthProvider } from "@/components/auth/auth-provider";
import { PublicOnly, RequireAuth } from "@/components/auth/route-guards";
import { AppLayout } from "@/components/layout/app-layout";
import { RouteLoading } from "@/components/layout/route-loading";
import { RouteErrorPage } from "@/pages/route-error-page";

const DashboardPage = lazy(() => import("@/pages/dashboard-page").then((module) => ({ default: module.DashboardPage })));
const MessagesPage = lazy(() => import("@/pages/messages-page").then((module) => ({ default: module.MessagesPage })));
const ConnectPage = lazy(() => import("@/pages/connect-page").then((module) => ({ default: module.ConnectPage })));
const LoginPage = lazy(() => import("@/pages/login-page").then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/register-page").then((module) => ({ default: module.RegisterPage })));
const AccountSettingsPage = lazy(() => import("@/pages/account-settings-page").then((module) => ({ default: module.AccountSettingsPage })));
const SessionsPage = lazy(() => import("@/pages/sessions-page").then((module) => ({ default: module.SessionsPage })));
const NotFoundPage = lazy(() => import("@/pages/not-found-page").then((module) => ({ default: module.NotFoundPage })));

function lazyRoute(element: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

function AuthRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <AuthRoot />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: "/login", element: lazyRoute(<LoginPage />) },
              { path: "/register", element: lazyRoute(<RegisterPage />) },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: "/",
            element: <AppLayout />,
            children: [
              { index: true, element: lazyRoute(<DashboardPage />) },
              { path: "messages", element: lazyRoute(<MessagesPage />) },
              { path: "onboarding/telegram", element: lazyRoute(<ConnectPage />) },
              { path: "settings/telegram", element: lazyRoute(<ConnectPage />) },
              { path: "settings/account", element: lazyRoute(<AccountSettingsPage />) },
              { path: "settings/sessions", element: lazyRoute(<SessionsPage />) },
              { path: "connect", element: <Navigate to="/settings/telegram" replace /> },
              { path: "*", element: lazyRoute(<NotFoundPage />) },
            ],
          },
        ],
      },
    ],
  },
]);
