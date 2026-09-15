import {
  Box,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useState, type KeyboardEvent } from "react";

import type { ProductPhoto } from "../api/catalog";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
} from "../ui/Icons";

interface ProductGalleryProps {
  photos: ProductPhoto[];
  productName: string;
}

export function ProductGallery({ photos, productName }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

  if (photos.length === 0) {
    return <EmptyGallery />;
  }

  function openViewer(index: number): void {
    setSelectedIndex(index);
    setViewerOpen(true);
  }

  return (
    <Box>
      <button
        type="button"
        className="gallery-main-button"
        onClick={() => openViewer(selectedIndex)}
        aria-label={`Открыть фотографию ${selectedIndex + 1} из ${photos.length}`}
      >
        <img
          className="gallery-main-image"
          src={photos[selectedIndex].url}
          alt={`${productName}, фотография ${selectedIndex + 1}`}
          width="1200"
          height="900"
          fetchPriority="high"
        />
        <span className="gallery-open-hint">Открыть фото</span>
      </button>
      {photos.length > 1 ? (
        <Stack className="gallery-thumbnails" direction="row" spacing={1.25}>
          {photos.map((photo, index) => (
            <button
              type="button"
              key={photo.id}
              className="gallery-thumbnail"
              data-selected={index === selectedIndex}
              onClick={() => setSelectedIndex(index)}
              aria-label={`Показать фотографию ${index + 1} из ${photos.length}`}
              aria-pressed={index === selectedIndex}
            >
              <img
                src={photo.url}
                alt=""
                width="160"
                height="120"
                loading="lazy"
              />
            </button>
          ))}
        </Stack>
      ) : null}
      {viewerOpen ? (
        <PhotoViewer
          photos={photos}
          productName={productName}
          initialIndex={selectedIndex}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </Box>
  );
}

function EmptyGallery() {
  return (
    <Box className="gallery-empty">
      <ImageIcon width="56" height="56" />
      <Typography>Фотографии пока не добавлены</Typography>
    </Box>
  );
}

interface PhotoViewerProps {
  photos: ProductPhoto[];
  productName: string;
  initialIndex: number;
  onClose: () => void;
}

function PhotoViewer({
  photos,
  productName,
  initialIndex,
  onClose,
}: PhotoViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);

  function showPhoto(nextIndex: number): void {
    setIndex(normalizeIndex(nextIndex, photos.length));
    setZoom(1);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPhoto(index - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showPhoto(index + 1);
    }
  }

  if (photos.length === 0) {
    return null;
  }

  return (
    <Dialog
      fullScreen
      open
      onClose={onClose}
      onKeyDown={handleKeyDown}
      className="photo-viewer"
      slotProps={{ paper: { "aria-label": "Фотографии товара" } }}
    >
      <Box className="photo-viewer__header">
        <Typography component="h2" variant="h6" sx={{ fontWeight: 700 }}>
          Фотографии товара
        </Typography>
        <Typography component="span" aria-live="polite">
          {index + 1} из {photos.length}
        </Typography>
        <IconButton color="inherit" onClick={onClose} aria-label="Закрыть просмотр">
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent className="photo-viewer__content">
        <IconButton
          className="photo-viewer__previous"
          color="inherit"
          onClick={() => showPhoto(index - 1)}
          aria-label="Предыдущая фотография"
        >
          <ArrowLeftIcon />
        </IconButton>
        <Box className="photo-viewer__canvas">
          <img
            src={photos[index].url}
            alt={`${productName}, фотография ${index + 1}`}
            width="1600"
            height="1200"
            style={{
              width: zoom === 1 ? "auto" : `${zoom * 100}%`,
              maxWidth: zoom === 1 ? "100%" : "none",
              maxHeight: zoom === 1 ? "100%" : "none",
            }}
          />
        </Box>
        <IconButton
          className="photo-viewer__next"
          color="inherit"
          onClick={() => showPhoto(index + 1)}
          aria-label="Следующая фотография"
        >
          <ArrowRightIcon />
        </IconButton>
        <Stack className="photo-viewer__zoom" direction="row" spacing={0.5}>
          <IconButton
            color="inherit"
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
            disabled={zoom === 1}
            aria-label="Уменьшить"
          >
            <MinusIcon />
          </IconButton>
          <Button
            color="inherit"
            size="small"
            onClick={() => setZoom(1)}
            aria-label="Сбросить масштаб"
          >
            <Typography aria-live="polite">{Math.round(zoom * 100)}%</Typography>
          </Button>
          <IconButton
            color="inherit"
            onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
            disabled={zoom === 3}
            aria-label="Увеличить"
          >
            <PlusIcon />
          </IconButton>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function normalizeIndex(index: number, length: number): number {
  return (index + length) % length;
}
