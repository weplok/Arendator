import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";

import {
  CURRENT_USER_QUERY_KEY,
  type CurrentUser,
  logout,
} from "../api/auth";
import { MenuIcon } from "../ui/Icons";

interface AppShellProps {
  children: ReactNode;
  user: CurrentUser | null;
}

export function AppShell({ children, user }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const marketplacePage =
    location.pathname === "/" || location.pathname.startsWith("/products/");
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
          <Toolbar
            disableGutters
            className={marketplacePage ? "site-toolbar site-toolbar--marketplace" : "site-toolbar"}
          >
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
            <Button
              component={RouterLink}
              to="/"
              color="inherit"
              className="site-desktop-nav"
            >
              Каталог
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            {marketplacePage ? (
              <TextField
                className="site-header-search"
                size="small"
                label="Поиск по названию"
                disabled
              />
            ) : null}
            {user ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center" }}
                className="site-desktop-account"
              >
                <Button component={RouterLink} to="/account" color="inherit">
                  <Avatar
                    src={user.avatar ?? undefined}
                    alt=""
                    className="header-avatar"
                  >
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
              <Stack direction="row" spacing={1} className="site-desktop-account">
                <Button component={RouterLink} to="/login" color="inherit">
                  Войти
                </Button>
                <Button component={RouterLink} to="/register" variant="contained">
                  Регистрация
                </Button>
              </Stack>
            )}
            {marketplacePage ? (
              <>
                <IconButton
                  className="site-mobile-menu-button"
                  aria-label="Открыть меню"
                  aria-controls={menuAnchor ? "site-mobile-menu" : undefined}
                  aria-expanded={Boolean(menuAnchor)}
                  onClick={(event) => setMenuAnchor(event.currentTarget)}
                >
                  <MenuIcon />
                </IconButton>
                <Menu
                  id="site-mobile-menu"
                  anchorEl={menuAnchor}
                  open={Boolean(menuAnchor)}
                  onClose={() => setMenuAnchor(null)}
                >
                  <MenuItem
                    component={RouterLink}
                    to="/"
                    onClick={() => setMenuAnchor(null)}
                  >
                    Каталог
                  </MenuItem>
                  {user ? (
                    <>
                      <MenuItem
                        component={RouterLink}
                        to="/account"
                        onClick={() => setMenuAnchor(null)}
                      >
                        Мой кабинет
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          setMenuAnchor(null);
                          logoutMutation.mutate();
                        }}
                      >
                        Выйти
                      </MenuItem>
                    </>
                  ) : (
                    <>
                      <MenuItem
                        component={RouterLink}
                        to="/login"
                        onClick={() => setMenuAnchor(null)}
                      >
                        Войти
                      </MenuItem>
                      <MenuItem
                        component={RouterLink}
                        to="/register"
                        onClick={() => setMenuAnchor(null)}
                      >
                        Зарегистрироваться
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </>
            ) : null}
          </Toolbar>
        </Container>
      </AppBar>
      <Box id="main-content" component="main" tabIndex={-1}>
        {children}
      </Box>
    </Box>
  );
}
