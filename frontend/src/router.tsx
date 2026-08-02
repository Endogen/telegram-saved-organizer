import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";

import { AppLayout } from "@/components/layout/app-layout";
import { RouteLoading } from "@/components/layout/route-loading";
import { RouteErrorPage } from "@/pages/route-error-page";

const DashboardPage = lazy(() => import("@/pages/dashboard-page").then((module) => ({ default: module.DashboardPage })));
const MessagesPage = lazy(() => import("@/pages/messages-page").then((module) => ({ default: module.MessagesPage })));
const ConnectPage = lazy(() => import("@/pages/connect-page").then((module) => ({ default: module.ConnectPage })));
const NotFoundPage = lazy(() => import("@/pages/not-found-page").then((module) => ({ default: module.NotFoundPage })));

function lazyRoute(element: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: lazyRoute(<DashboardPage />) },
      { path: "messages", element: lazyRoute(<MessagesPage />) },
      { path: "connect", element: lazyRoute(<ConnectPage />) },
    ],
  },
  {
    path: "*",
    element: lazyRoute(<NotFoundPage />),
  },
]);
