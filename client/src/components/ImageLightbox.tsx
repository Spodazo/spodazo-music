import { useEffect, type MouseEvent } from "react";
import { imageIsHot, revealLoadedImage } from "../lib/images";

export function IconEye() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c-5.2 0-9.4 3.3-11 7 1.6 3.7 5.8 7 11 7s9.4-3.3 11-7c-1.6-3.7-5.8-7-11-7zm0 11.5A4.5 4.5 0 1 1 16.5 12 4.5 4.5 0 0 1 12 16.5zm0-7A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5z" />
    </svg>
  );
}

export function CoverEye({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cover-eye"
      aria-label={label}
      title={label}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <IconEye />
    </button>
  );
}

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt || "Image"} onClick={onClose}>
      <div className="lightbox-card" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="lightbox-close" aria-label="Close image" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
        <img
          className={imageIsHot(src) ? "is-hot" : undefined}
          src={src}
          alt={alt}
          decoding="async"
          ref={(img) => revealLoadedImage(img, src)}
          onLoad={(event) => revealLoadedImage(event.currentTarget, src)}
        />
      </div>
    </div>
  );
}
