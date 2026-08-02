import { RouterProvider } from "react-router/dom";

import { ApiSessionGate } from "@/components/auth/api-session-gate";
import { router } from "@/router";

export default function App() {
  return (
    <ApiSessionGate>
      <RouterProvider router={router} />
    </ApiSessionGate>
  );
}
