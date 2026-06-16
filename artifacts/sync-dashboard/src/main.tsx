import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Attach API Bearer token to every dashboard → API request.
// Set VITE_API_SECRET_KEY in Replit Secrets to the same value as API_SECRET_KEY.
const apiKey = import.meta.env.VITE_API_SECRET_KEY as string | undefined;
if (apiKey) {
  setAuthTokenGetter(() => apiKey);
} else {
  console.warn("[COW OPS SYNC] VITE_API_SECRET_KEY not set — API requests will be unauthenticated");
}

createRoot(document.getElementById("root")!).render(<App />);
