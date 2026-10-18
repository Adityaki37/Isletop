"use client";
import { useState } from "react";
import type { AccountProfile } from "@/lib/account-types";
import { EMPTY_REGION, regionLabel, type PlayerRegion } from "@/lib/regions";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import RegionPicker from "./region-picker";
import CountryFlag from "./country-flag";
export default function ProfileRegion({
  account,
  editable,
  onSaved,
}: {
  account: AccountProfile;
  editable: boolean;
  onSaved: (a: AccountProfile) => void;
}) {
  const [open, setOpen] = useState(false),
    region = account.region ?? EMPTY_REGION;
  return (
    <div className="profile-region">
      {editable ? (
        <Button
          className="profile-region-trigger"
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label="Change leaderboard region"
        >
          {region.countryCode && (
            <img
              src={`/art/regions/${region.countryCode}.svg`}
              alt=""
              width={24}
              height={24}
            />
          )}
          {regionLabel(region)} · Edit region
        </Button>
      ) : (
        <>
          <CountryFlag country={region.countryCode} />
          <span>{regionLabel(region)}</span>
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <RegionForm
            initial={region}
            onSaved={(a) => {
              onSaved(a);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Dialog>
    </div>
  );
}
function RegionForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: PlayerRegion;
  onSaved: (a: AccountProfile) => void;
  onCancel: () => void;
}) {
  const [region, setRegion] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <DialogContent className="region-dialog">
      <DialogTitle>Leaderboard Region</DialogTitle>
      <DialogDescription>
        Your chosen region appears on your public profile and regional
        leaderboards. Choose Global to remove it.
      </DialogDescription>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/accounts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ op: "region", region }),
            });
            const data = (await r.json()) as {
              account: AccountProfile;
              error?: string;
            };
            if (!r.ok) throw Error(data.error);
            onSaved(data.account);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Unable to save your region.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <RegionPicker value={region} onChange={setRegion} disabled={busy} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="account-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Region"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
