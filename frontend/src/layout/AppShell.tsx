import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import {
  CURRENT_USER_QUERY_KEY,
  type CurrentUser,
  logout,
} from "../api/auth";

interface AppShellProps {
  children: ReactNode;
  user: CurrentUser | null;
}

export function AppShell({ children, user }: AppShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      navigate("/", { replace: true, flushSync: true });
      queryClient.setQueryData(CURRENT_USER_QUERY_KEY, null);
    },
  });

  return (
    <Box className="site-shell">
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      <AppBar className="site-header" position="sticky" color="inherit" elevation={0}>
        <Container maxWidth="lg">
          <Toolbar disableGutters className="site-toolbar">
            <Stack
              component={RouterLink}
              to="/"
              className="site-brand"
              direction="row"
              spacing={1.25}
              sx={{ alignItems: "center" }}
            >
              <Box className="brand-mark brand-mark--small" aria-hidden="true">
                А
              </Box>
              <Typography component="span" className="site-brand__name">
                Арентатор
              </Typography>
            </Stack>
            <Button component={RouterLink} to="/" color="inherit">
              Каталог
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            {user ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Button component={RouterLink} to="/account" color="inherit">
                  <Avatar src={user.avatar ?? undefined} alt="" className="header-avatar">
                    {user.name.slice(0, 1)}
                  </Avatar>
                  <Box component="span" className="header-user-name">
                    {user.name}
                  </Box>
                </Button>
                <Button
                  color="inherit"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                >
                  {logoutMutation.isPending ? "Выходим…" : "Выйти"}
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1}>
                <Button component={RouterLink} to="/login" color="inherit">
                  Войти
                </Button>
                <Button component={RouterLink} to="/register" variant="contained">
                  Регистрация
                </Button>
              </Stack>
            )}
          </Toolbar>
        </Container>
      </AppBar>
      <Box id="main-content" component="main" tabIndex={-1}>
        {children}
      </Box>
    </Box>
  );
}
