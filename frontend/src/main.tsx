import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./styles.css";

const queryClient = new QueryClient();
const theme = createTheme({
  palette: {
    mode: "light",
    background: { default: "#f4f7f5", paper: "#ffffff" },
    primary: { main: "#286452", dark: "#173f35", contrastText: "#ffffff" },
    text: { primary: "#17201d", secondary: "#596561" },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily:
      'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h3: { fontWeight: 750, letterSpacing: "-0.035em" },
    h4: { fontWeight: 750, letterSpacing: "-0.025em" },
    h2: { fontWeight: 780, letterSpacing: "-0.045em" },
    h5: { fontWeight: 750, letterSpacing: "-0.015em" },
    h6: { fontWeight: 750 },
    body1: { lineHeight: 1.6 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { minHeight: 48, borderRadius: 12, textTransform: "none" },
      },
      defaultProps: { disableElevation: true },
    },
    MuiTextField: {
      defaultProps: { fullWidth: true },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { width: 44, height: 44 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 52, textTransform: "none", fontWeight: 700 },
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
