import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";

interface CatalogLoadingProps {
  label: string;
}

export function CatalogLoading({ label }: CatalogLoadingProps) {
  return (
    <Box className="catalog-state" role="status" aria-label={label}>
      <CircularProgress size={36} />
      <Typography color="text.secondary">{label}</Typography>
    </Box>
  );
}

interface CatalogErrorProps {
  message: string;
  onRetry: () => void;
}

export function CatalogError({ message, onRetry }: CatalogErrorProps) {
  return (
    <Box className="catalog-state">
      <Stack spacing={2} sx={{ alignItems: "center" }}>
        <Alert severity="error">{message}</Alert>
        <Button variant="outlined" onClick={onRetry}>
          Повторить
        </Button>
      </Stack>
    </Box>
  );
}

interface CatalogEmptyProps {
  title: string;
  description: string;
}

export function CatalogEmpty({ title, description }: CatalogEmptyProps) {
  return (
    <Box className="catalog-empty">
      <Typography component="h2" variant="h5">
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        {description}
      </Typography>
    </Box>
  );
}
