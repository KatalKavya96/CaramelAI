import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { ThemeProvider } from "./app/theme";
import { UiStateProvider } from "./app/ui-state";
import { ApiContext, createApiClient } from "./data";
import { TooltipProvider } from "./ui";
import "./tokens/base.css";

const api = createApiClient();
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
});

const root = document.getElementById("root");
if (root === null) throw new Error("index.html is missing #root.");

createRoot(root).render(
  <StrictMode>
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <UiStateProvider>
            <TooltipProvider delayDuration={300}>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </TooltipProvider>
          </UiStateProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  </StrictMode>,
);
