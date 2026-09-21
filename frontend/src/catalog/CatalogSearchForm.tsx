import { Box, Button, TextField } from "@mui/material";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface CatalogSearchFormProps {
  className: string;
}

export function CatalogSearchForm({ className }: CatalogSearchFormProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const appliedSearch = new URLSearchParams(location.search).get("search") ?? "";
  const [draft, setDraft] = useState({ source: appliedSearch, value: appliedSearch });
  const search = draft.source === appliedSearch ? draft.value : appliedSearch;

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams(location.search);
    const normalizedSearch = search.trim();
    if (normalizedSearch) params.set("search", normalizedSearch);
    else params.delete("search");
    params.delete("page");
    navigate({ pathname: "/", search: params.toString() });
  }

  return (
    <Box
      component="form"
      className={className}
      role="search"
      aria-label="Поиск по каталогу"
      onSubmit={submitSearch}
    >
      <TextField
        autoComplete="off"
        fullWidth
        label="Поиск по названию и описанию"
        name="catalog_search"
        size="small"
        type="search"
        value={search}
        onChange={(event) => {
          setDraft({ source: appliedSearch, value: event.target.value });
        }}
        slotProps={{ htmlInput: { enterKeyHint: "search" } }}
      />
      <Button type="submit" variant="contained">
        Найти
      </Button>
    </Box>
  );
}
