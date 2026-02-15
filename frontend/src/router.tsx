import { createBrowserRouter } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-layout";
import { ConnectPage } from "@/pages/connect-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { MessagesPage } from "@/pages/messages-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { RouteErrorPage } from "@/pages/route-error-page";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "messages", element: <MessagesPage /> },
      { path: "connect", element: <ConnectPage /> },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
