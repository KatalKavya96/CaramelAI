import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing";
import "./styles/site.css";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html is missing #root.");

createRoot(root).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
