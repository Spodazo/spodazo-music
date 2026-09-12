export default function SdgFooter({
  imageUrl,
  compact = false,
}: {
  imageUrl?: string;
  compact?: boolean;
}) {
  if (imageUrl) {
    return <img className="footer-image" src={imageUrl} alt="" />;
  }
  return (
    <div className={`sdg${compact ? " sdg-sm" : ""}`}>
      <svg className="sdg-cross" viewBox="0 0 10 11" aria-hidden="true">
        <rect x="4" y="0" width="2" height="11" />
        <rect x="0" y="3.5" width="10" height="2" />
      </svg>
      Soli Deo Gloria
    </div>
  );
}
