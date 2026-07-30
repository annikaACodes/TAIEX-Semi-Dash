import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "../app/Dashboard";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
