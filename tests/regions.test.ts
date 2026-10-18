import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  CONTINENTS,
  EMPTY_REGION,
  countryOptions,
  regionOptions,
  selectRegion,
  RegionSelectionError,
  storedRegion,
  regionFilter,
  flagAsset,
} from "../lib/regions";
test("Every supported geography belongs to one country and continent and has a local flag", () => {
  const countries = countryOptions();
  assert.equal(countries.length, 250);
  for (const c of countries) {
    assert(Object.hasOwn(CONTINENTS, c.continent));
    assert(existsSync(`public${flagAsset(c.code)}`), c.code);
    for (const r of regionOptions(c.code))
      assert.deepEqual(
        selectRegion({ countryCode: c.code, regionCode: r.code }),
        { continentCode: c.continent, countryCode: c.code, regionCode: r.code },
      );
  }
});
test("Region selection normalizes codes and rejects invalid or mismatched hierarchies", () => {
  assert.deepEqual(selectRegion({ countryCode: " us ", regionCode: "oh" }), {
    continentCode: "NA",
    countryCode: "US",
    regionCode: "OH",
  });
  assert.deepEqual(selectRegion({ continentCode: "eu" }), {
    ...EMPTY_REGION,
    continentCode: "EU",
  });
  assert.deepEqual(selectRegion({}), EMPTY_REGION);
  for (const value of [
    null,
    [],
    "US",
    { countryCode: "ZZ" },
    { continentCode: "ZZ" },
    { countryCode: "__proto__" },
    { countryCode: "US", regionCode: "__proto__" },
    { countryCode: "US", continentCode: "EU" },
    { regionCode: "OH" },
    { countryCode: "CA", regionCode: "OH" },
    { countryCode: null },
    { regionCode: 23 },
    { countryCode: "US' OR 1=1--" },
  ])
    assert.throws(() => selectRegion(value), RegionSelectionError);
  assert.deepEqual(regionFilter(new URLSearchParams("country=ca&region=on")), {
    continentCode: "NA",
    countryCode: "CA",
    regionCode: "ON",
  });
  assert.deepEqual(
    storedRegion({ country_code: "US", region_code: "ZZ" }),
    EMPTY_REGION,
  );
  assert.equal(flagAsset("ZZ"), undefined);
});
