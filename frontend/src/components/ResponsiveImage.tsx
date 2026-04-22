type Props = {
  src: string;
  alt?: string;
  sizes?: string;
  srcSet?: string;
  className?: string;
};

export function ResponsiveImage({
  src,
  alt = "",
  sizes = "100vw",
  srcSet,
  className,
}: Props) {
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}
