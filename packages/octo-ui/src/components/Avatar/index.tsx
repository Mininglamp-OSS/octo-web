import { forwardRef, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AvatarProps } from "./types";

const splitCharacters = (value: string) => Array.from(value.trim());

export const getAvatarFallback = (
  fallbackText: string | undefined,
  kind: AvatarProps["kind"]
): ReactNode => {
  const characters = splitCharacters(fallbackText ?? "");

  if (kind !== "group") {
    return characters.slice(0, 2).join("");
  }

  const visible = characters.slice(0, 4);
  const isCjk = visible.some((character) => /[\u3400-\u9fff]/.test(character));

  if (!isCjk || visible.length < 3) return visible.join("");

  const splitAt = visible.length === 3 ? 1 : 2;
  return (
    <span className="octo-ui-avatar__lines">
      <span>{visible.slice(0, splitAt).join("")}</span>
      <span>{visible.slice(splitAt).join("")}</span>
    </span>
  );
};

const DefaultGroupIcon = () => (
  <svg
    className="octo-ui-avatar__group-icon"
    viewBox="0 0 18 18"
    aria-hidden="true"
  >
    <path d="M9.09 16.37H6.13c-2.79 0-4.99 0-4.99-1.4v-.3c0-2.7 2.24-4.9 4.99-4.9h2.96c2.75 0 4.99 2.2 4.99 4.9v.3c0 1.4-2.31 1.4-4.99 1.4ZM7.47 9.4a3.92 3.92 0 1 1 0-7.77 3.92 3.92 0 1 1 0 7.77Z" />
    <path
      className="octo-ui-avatar__group-icon-secondary"
      d="M14.93 15.42c.25-1.65-.3-3.17-1.62-4.57 1.97 0 3.57 1.54 3.57 3.43v.2c0 .98-.9.91-1.95.94Zm-2.02-4.98c-1.67-1.1-.66-.64-2.72-1.28 1.44-.83 1.93-1.47 2.06-3.84a2.77 2.77 0 0 1 .66 5.12Z"
    />
  </svg>
);

const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  {
    src,
    alt,
    size = 32,
    kind = "person",
    fallbackText,
    fallbackIcon,
    tone = 0,
    imageLoading = "lazy",
    imageDecoding = "async",
    onImageError,
    className,
    ...rest
  },
  ref
) {
  const [failedSrc, setFailedSrc] = useState<string>();

  useEffect(() => {
    setFailedSrc(undefined);
  }, [src]);

  const showImage = Boolean(src && failedSrc !== src);
  const fallback = getAvatarFallback(fallbackText, kind);
  const content =
    fallback ||
    fallbackIcon ||
    (kind === "group" ? <DefaultGroupIcon /> : null);
  const classes = [
    "octo-ui-avatar",
    `octo-ui-avatar--${kind}`,
    `octo-ui-avatar--size-${size}`,
    `octo-ui-avatar--tone-${tone}`,
    showImage && "octo-ui-avatar--has-image",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      ref={ref}
      className={classes}
      role={!showImage && alt ? "img" : undefined}
      aria-label={!showImage && alt ? alt : undefined}
      aria-hidden={!showImage && !alt ? true : undefined}
      {...rest}
    >
      {showImage ? (
        <img
          className="octo-ui-avatar__image"
          src={src}
          alt={alt}
          loading={imageLoading}
          decoding={imageDecoding}
          onError={(event) => {
            setFailedSrc(src);
            onImageError?.(event);
          }}
        />
      ) : (
        content
      )}
    </span>
  );
});

export default Avatar;
export { Avatar };
