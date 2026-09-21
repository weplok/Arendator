import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";

import { getProducts } from "../api/catalog";
import {
  buildCategoryTree,
  getCategories,
  type Category,
  type CategoryNode,
  type Characteristic,
} from "../api/categories";
import { ArrowRightIcon } from "../ui/Icons";
import { formatAdvertisementCount } from "./formatting";

const FILTER_KEYS = new Set(["category", "price_min", "price_max"]);

interface CatalogFiltersProps {
  appliedParams: URLSearchParams;
  onApply: (filters: URLSearchParams) => void;
}

export function CatalogFilters({ appliedParams, onApply }: CatalogFiltersProps) {
  const appliedFilterSignature = filterParams(appliedParams).toString();
  const [draftState, setDraftState] = useState(() => ({
    source: appliedFilterSignature,
    filters: new URLSearchParams(appliedFilterSignature),
  }));
  const draftFilters = useMemo(
    () =>
      draftState.source === appliedFilterSignature
        ? draftState.filters
        : new URLSearchParams(appliedFilterSignature),
    [appliedFilterSignature, draftState],
  );
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set(),
  );
  const categoriesQuery = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: getCategories,
    staleTime: 60_000,
  });

  const selectedCategory = findCategory(
    categoriesQuery.data,
    draftFilters.get("category"),
  );
  const draftFilterSignature = draftFilters.toString();
  const deferredFilterSignature = useDeferredValue(draftFilterSignature);
  const previewIsCurrent = draftFilterSignature === deferredFilterSignature;
  const previewParams = useMemo(
    () =>
      buildPreviewParams(
        appliedParams,
        new URLSearchParams(deferredFilterSignature),
      ),
    [appliedParams, deferredFilterSignature],
  );
  const validDraft = hasValidRanges(draftFilters, selectedCategory);
  const previewQuery = useQuery({
    queryKey: ["catalog", "preview", previewParams.toString()],
    queryFn: () => getProducts(previewParams),
    enabled: validDraft,
    staleTime: 30_000,
  });

  function updateFilter(key: string, value: string): void {
    setDraftState({
      source: appliedFilterSignature,
      filters: withUpdatedParam(draftFilters, key, value),
    });
  }

  function selectCategory(categoryId: number, hasChildren: boolean): void {
    const next = withoutCharacteristicFilters(draftFilters);
    next.set("category", String(categoryId));
    setDraftState({
      source: appliedFilterSignature,
      filters: next,
    });
    if (hasChildren) toggleExpandedCategory(categoryId, setExpandedCategories);
  }

  return (
    <Paper component="aside" className="catalog-filters" elevation={0}>
      <Stack direction="row" className="catalog-filters__heading">
        <Typography component="h2" variant="h6">
          Фильтры
        </Typography>
        <button
          className="catalog-filters__reset"
          type="button"
          onClick={() => {
            setDraftState({
              source: appliedFilterSignature,
              filters: new URLSearchParams(),
            });
          }}
        >
          Сбросить
        </button>
      </Stack>
      <PriceFilter filters={draftFilters} onChange={updateFilter} />
      <CategoryTree
        categories={categoriesQuery.data}
        isPending={categoriesQuery.isPending}
        expandedCategories={expandedCategories}
        selectedCategoryId={selectedCategory?.id ?? null}
        onSelect={selectCategory}
      />
      <CharacteristicFilters
        category={selectedCategory}
        filters={draftFilters}
        onChange={updateFilter}
      />
      <FilterApplyStatus
        isValid={validDraft}
        isPending={!previewIsCurrent || previewQuery.isPending}
        isError={previewQuery.isError}
      />
      <Button
        className="catalog-filters__apply"
        variant="contained"
        disabled={!validDraft || !previewIsCurrent || !previewQuery.data}
        onClick={() => onApply(draftFilters)}
      >
        {applyButtonLabel(previewQuery.data?.count, validDraft, previewQuery.isError)}
      </Button>
      <Typography className="visually-hidden" aria-live="polite">
        {previewIsCurrent && previewQuery.data
          ? `Подходит ${formatAdvertisementCount(previewQuery.data.count)}`
          : ""}
      </Typography>
    </Paper>
  );
}

interface PriceFilterProps {
  filters: URLSearchParams;
  onChange: (key: string, value: string) => void;
}

function PriceFilter({ filters, onChange }: PriceFilterProps) {
  return (
    <Box component="fieldset" className="catalog-filter-group">
      <Typography component="legend" variant="body2">
        Цена за минуту, ₽
      </Typography>
      <RangeInputs
        fromLabel="Цена от"
        fromName="price_min"
        toLabel="Цена до"
        toName="price_max"
        fromValue={filters.get("price_min") ?? ""}
        toValue={filters.get("price_max") ?? ""}
        onFromChange={(value) => onChange("price_min", value)}
        onToChange={(value) => onChange("price_max", value)}
        minimum={0}
      />
    </Box>
  );
}

interface CategoryTreeProps {
  categories?: Category[];
  isPending: boolean;
  expandedCategories: Set<number>;
  selectedCategoryId: number | null;
  onSelect: (categoryId: number, hasChildren: boolean) => void;
}

function CategoryTree(props: CategoryTreeProps) {
  if (props.isPending) {
    return (
      <Stack direction="row" spacing={1} role="status" sx={{ alignItems: "center" }}>
        <CircularProgress size={18} />
        <Typography variant="body2">Загрузка категорий…</Typography>
      </Stack>
    );
  }
  if (!props.categories?.length) {
    return <Typography variant="body2">Категории пока не добавлены.</Typography>;
  }
  return (
    <Box component="nav" className="catalog-filters__tree" aria-label="Категории">
      {buildCategoryTree(props.categories).map((category) => (
        <CategoryBranch
          key={category.id}
          category={category}
          expandedCategories={props.expandedCategories}
          selectedCategory={props.selectedCategoryId}
          onSelect={props.onSelect}
        />
      ))}
    </Box>
  );
}

interface CategoryBranchProps {
  category: CategoryNode;
  expandedCategories: Set<number>;
  selectedCategory: number | null;
  onSelect: (categoryId: number, hasChildren: boolean) => void;
}

function CategoryBranch(props: CategoryBranchProps) {
  const hasChildren = props.category.children.length > 0;
  const expanded = props.expandedCategories.has(props.category.id);
  return (
    <div className="catalog-filters__branch">
      <button
        aria-expanded={hasChildren ? expanded : undefined}
        aria-pressed={props.selectedCategory === props.category.id}
        className="catalog-filters__category"
        type="button"
        onClick={() => props.onSelect(props.category.id, hasChildren)}
      >
        {hasChildren ? (
          <ArrowRightIcon className={expanded ? "is-expanded" : ""} />
        ) : (
          <span />
        )}
        {props.category.name}
      </button>
      {expanded ? (
        <div className="catalog-filters__children">
          {props.category.children.map((child) => (
            <CategoryBranch
              key={child.id}
              {...props}
              category={child}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface CharacteristicFiltersProps {
  category: Category | undefined;
  filters: URLSearchParams;
  onChange: (key: string, value: string) => void;
}

function CharacteristicFilters(props: CharacteristicFiltersProps) {
  return (
    <div className="catalog-filters__characteristics">
      <Typography component="h3" variant="body2">
        Характеристики
      </Typography>
      {props.category ? (
        props.category.characteristics.length ? (
          props.category.characteristics.map((characteristic) => (
            <CharacteristicFilter
              key={characteristic.id}
              characteristic={characteristic}
              filters={props.filters}
              onChange={props.onChange}
            />
          ))
        ) : (
          <Typography color="text.secondary" variant="body2">
            У этой категории нет характеристик
          </Typography>
        )
      ) : (
        <Typography color="text.secondary" variant="body2">
          Появятся после выбора категории
        </Typography>
      )}
    </div>
  );
}

interface CharacteristicFilterProps {
  characteristic: Characteristic;
  filters: URLSearchParams;
  onChange: (key: string, value: string) => void;
}

function CharacteristicFilter(props: CharacteristicFilterProps) {
  const key = `characteristic_${props.characteristic.id}`;
  if (props.characteristic.type === "NUMBER") {
    return (
      <Box component="fieldset" className="catalog-filter-group">
        <Typography component="legend" variant="body2">
          {characteristicLabel(props.characteristic)}
        </Typography>
        <RangeInputs
          fromLabel={`${props.characteristic.name} от`}
          fromName={`${key}_min`}
          toLabel={`${props.characteristic.name} до`}
          toName={`${key}_max`}
          fromValue={props.filters.get(`${key}_min`) ?? ""}
          toValue={props.filters.get(`${key}_max`) ?? ""}
          onFromChange={(value) => props.onChange(`${key}_min`, value)}
          onToChange={(value) => props.onChange(`${key}_max`, value)}
        />
      </Box>
    );
  }
  if (props.characteristic.type === "BOOLEAN") {
    return (
      <FormControlLabel
        control={
          <Checkbox
            checked={props.filters.get(key) === "true"}
            name={key}
            onChange={(_, checked) => props.onChange(key, checked ? "true" : "")}
          />
        }
        label={props.characteristic.name}
      />
    );
  }
  const selectedOptions = new Set((props.filters.get(key) ?? "").split(","));
  return (
    <Box component="fieldset" className="catalog-filter-group">
      <Typography component="legend" variant="body2">
        {props.characteristic.name}
      </Typography>
      <FormGroup>
        {props.characteristic.options.map((option) => (
          <FormControlLabel
            key={option.id}
            control={
              <Checkbox
                checked={selectedOptions.has(String(option.id))}
                name={key}
                onChange={(_, checked) => {
                  const next = new Set(selectedOptions);
                  if (checked) next.add(String(option.id));
                  else next.delete(String(option.id));
                  next.delete("");
                  props.onChange(key, [...next].join(","));
                }}
              />
            }
            label={option.value}
          />
        ))}
      </FormGroup>
    </Box>
  );
}

interface RangeInputsProps {
  fromLabel: string;
  fromName: string;
  toLabel: string;
  toName: string;
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  minimum?: number;
}

function RangeInputs(props: RangeInputsProps) {
  const invalidRange = !isValidRange(props.fromValue, props.toValue);
  const inputOptions = {
    inputMode: "decimal" as const,
    min: props.minimum,
    step: "any",
  };
  return (
    <div className="catalog-filter-range">
      <TextField
        autoComplete="off"
        error={invalidRange}
        label={props.fromLabel}
        name={props.fromName}
        size="small"
        type="number"
        value={props.fromValue}
        onChange={(event) => props.onFromChange(event.target.value)}
        slotProps={{ htmlInput: inputOptions }}
      />
      <TextField
        autoComplete="off"
        error={invalidRange}
        helperText={invalidRange ? "Значение «до» меньше «от»." : undefined}
        label={props.toLabel}
        name={props.toName}
        size="small"
        type="number"
        value={props.toValue}
        onChange={(event) => props.onToChange(event.target.value)}
        slotProps={{ htmlInput: inputOptions }}
      />
    </div>
  );
}

function FilterApplyStatus(props: {
  isValid: boolean;
  isPending: boolean;
  isError: boolean;
}) {
  if (!props.isValid) {
    return (
      <Typography color="error" variant="caption" aria-live="polite">
        Проверьте границы диапазона.
      </Typography>
    );
  }
  if (props.isError) {
    return (
      <Typography color="error" variant="caption" aria-live="polite">
        Не удалось посчитать объявления. Измените фильтры или повторите позже.
      </Typography>
    );
  }
  if (props.isPending) {
    return (
      <Typography color="text.secondary" variant="caption" aria-live="polite">
        Считаем подходящие объявления…
      </Typography>
    );
  }
  return null;
}

function applyButtonLabel(
  count: number | undefined,
  valid: boolean,
  failed: boolean,
): string {
  if (!valid) return "Проверьте фильтры";
  if (failed) return "Не удалось посчитать";
  if (count === undefined) return "Считаем…";
  return `Показать ${formatAdvertisementCount(count)}`;
}

function filterParams(params: URLSearchParams): URLSearchParams {
  const filters = new URLSearchParams();
  for (const [key, value] of params) {
    if (FILTER_KEYS.has(key) || key.startsWith("characteristic_")) {
      filters.set(key, value);
    }
  }
  return filters;
}

function buildPreviewParams(
  appliedParams: URLSearchParams,
  filters: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams();
  const search = appliedParams.get("search");
  if (search) params.set("search", search);
  for (const [key, value] of filters) params.set(key, value);
  params.set("page", "1");
  params.set("ordering", "newest");
  return params;
}

function withoutCharacteristicFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...next.keys()]) {
    if (key.startsWith("characteristic_")) next.delete(key);
  }
  return next;
}

function withUpdatedParam(
  params: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

function findCategory(
  categories: Category[] | undefined,
  categoryId: string | null,
): Category | undefined {
  return categories?.find((category) => String(category.id) === categoryId);
}

function hasValidRanges(
  filters: URLSearchParams,
  category: Category | undefined,
): boolean {
  if (!isValidRange(filters.get("price_min"), filters.get("price_max"))) {
    return false;
  }
  return (category?.characteristics ?? [])
    .filter((characteristic) => characteristic.type === "NUMBER")
    .every((characteristic) => {
      const key = `characteristic_${characteristic.id}`;
      return isValidRange(filters.get(`${key}_min`), filters.get(`${key}_max`));
    });
}

function isValidRange(minimum: string | null, maximum: string | null): boolean {
  const minimumNumber = parseOptionalNumber(minimum);
  const maximumNumber = parseOptionalNumber(maximum);
  if (minimumNumber === false || maximumNumber === false) return false;
  if (minimumNumber === null || maximumNumber === null) return true;
  return minimumNumber <= maximumNumber;
}

function parseOptionalNumber(value: string | null): number | null | false {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : false;
}

function characteristicLabel(characteristic: Characteristic): string {
  return characteristic.unit
    ? `${characteristic.name}, ${characteristic.unit}`
    : characteristic.name;
}

function toggleExpandedCategory(
  categoryId: number,
  setExpanded: React.Dispatch<React.SetStateAction<Set<number>>>,
): void {
  setExpanded((current) => {
    const next = new Set(current);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    return next;
  });
}
