import { countryInfo, flagAsset } from "@/lib/regions";
export default function CountryFlag({
  country,
  onSelect,
}: {
  country: string;
  onSelect?: (code: string) => void;
}) {
  const info = countryInfo(country);
  if (!info) return null;
  const label = `View ${info.name} leaderboard`,
    flag = (
      <img src={flagAsset(country)} alt={info.name} width={24} height={24} />
    );
  return onSelect ? (
    <button
      type="button"
      className="country-flag"
      aria-label={label}
      title={label}
      onClick={() => onSelect(country)}
    >
      {flag}
    </button>
  ) : (
    <a
      className="country-flag"
      aria-label={label}
      title={label}
      href={`/leaderboards?country=${country}`}
    >
      {flag}
    </a>
  );
}
