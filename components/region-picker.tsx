"use client";
import {
  CONTINENTS,
  countryOptions,
  regionOptions,
  type PlayerRegion,
} from "@/lib/regions";
export default function RegionPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PlayerRegion;
  onChange: (region: PlayerRegion) => void;
  disabled?: boolean;
}) {
  const countries = countryOptions(value.continentCode),
    regions = regionOptions(value.countryCode);
  return (
    <div className="region-picker">
      <label>
        Continent
        <select
          value={value.continentCode}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              continentCode: e.target.value,
              countryCode: "",
              regionCode: "",
            })
          }
        >
          <option value="">Global</option>
          {Object.entries(CONTINENTS).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Country
        <select
          value={value.countryCode}
          disabled={disabled}
          onChange={(e) => {
            const country = countries.find((c) => c.code === e.target.value);
            onChange({
              continentCode: country?.continent ?? value.continentCode,
              countryCode: e.target.value,
              regionCode: "",
            });
          }}
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        State / Region
        <select
          value={value.regionCode}
          disabled={disabled || !regions.length}
          onChange={(e) => onChange({ ...value, regionCode: e.target.value })}
        >
          <option value="">All states / regions</option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
