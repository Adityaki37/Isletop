import catalog from "./regions-data.json";
export const CONTINENTS = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
} as const;
export type PlayerRegion = {
  continentCode: string;
  countryCode: string;
  regionCode: string;
};
type Country = {
  name: string;
  continent: string;
  regions: Record<string, string>;
};
const countries: Record<string, Country> = catalog;
export const EMPTY_REGION: PlayerRegion = {
  continentCode: "",
  countryCode: "",
  regionCode: "",
};
export class RegionSelectionError extends Error {}
export function countryInfo(code: string): Country | undefined {
  return Object.hasOwn(countries, code) ? countries[code] : undefined;
}
export function countryOptions(continent = "") {
  return Object.entries(countries)
    .filter(([, c]) => !continent || c.continent === continent)
    .map(([code, c]) => ({ code, name: c.name, continent: c.continent }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
export function regionOptions(country: string) {
  return Object.entries(countryInfo(country)?.regions ?? {})
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
export function selectRegion(value: unknown): PlayerRegion {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RegionSelectionError("Choose a valid leaderboard region.");
  const v = value as Record<string, unknown>;
  const code = (key: string) => {
    if (v[key] === undefined) return "";
    if (typeof v[key] !== "string")
      throw new RegionSelectionError("Choose a valid leaderboard region.");
    return (v[key] as string).trim().toUpperCase();
  };
  let continentCode = code("continentCode");
  const countryCode = code("countryCode"),
    regionCode = code("regionCode"),
    c = countryInfo(countryCode);
  if (countryCode && !c)
    throw new RegionSelectionError("Choose an available country.");
  if (c) {
    if (continentCode && continentCode !== c.continent)
      throw new RegionSelectionError(
        "That country is in a different continent.",
      );
    continentCode = c.continent;
  }
  if (continentCode && !Object.hasOwn(CONTINENTS, continentCode))
    throw new RegionSelectionError("Choose an available continent.");
  if (regionCode && (!c || !Object.hasOwn(c.regions, regionCode)))
    throw new RegionSelectionError(
      "Choose an available state or region in that country.",
    );
  return { continentCode, countryCode, regionCode };
}
export function storedRegion(row: {
  continent_code?: string;
  country_code?: string;
  region_code?: string;
}): PlayerRegion {
  try {
    return selectRegion({
      continentCode: row.continent_code,
      countryCode: row.country_code,
      regionCode: row.region_code,
    });
  } catch {
    return { ...EMPTY_REGION };
  }
}
export function regionLabel(r: PlayerRegion) {
  const c = countryInfo(r.countryCode);
  return (
    [
      c?.regions[r.regionCode],
      c?.name,
      CONTINENTS[r.continentCode as keyof typeof CONTINENTS],
    ]
      .filter(Boolean)
      .join(", ") || "Global"
  );
}
export function regionFilter(q: URLSearchParams) {
  return selectRegion({
    continentCode: q.get("continent") ?? "",
    countryCode: q.get("country") ?? "",
    regionCode: q.get("region") ?? "",
  });
}
export function flagAsset(code: string) {
  return countryInfo(code) ? `/art/regions/${code}.svg` : undefined;
}
