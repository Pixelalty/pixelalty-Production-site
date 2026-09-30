# US lead timezone lookup

`us-timezones.json` is a reduced, offline index of 41,062 active US ZIP codes and
39,285 city/state names from the Zipcodes project’s `scripts/data/zip_code_database.csv`
at commit `427e664995b5e0c7d44eab740ea5a46cb12f7581` (retrieved 2026-09-30).

Source: https://github.com/seanpianka/Zipcodes/tree/427e664995b5e0c7d44eab740ea5a46cb12f7581
Base data attribution: UnitedStatesZipCodes.org. The upstream MIT license is included
in `ZIPCODES-LICENSE.txt`. Only ZIP membership, state, IANA timezone, city and accepted
city aliases are retained. Coordinates and personal/business information are absent.

Contiguous ZIPs with the same state/timezone are compressed into exact ranges;
unassigned gaps are not filled. Duplicate city/state matches keep all candidate
zones. Ambiguous cities and split states require row-level review rather than a
guessed timezone. ZIP lookup is preferred to city/state. A provided IANA timezone
or a deliberately reviewed default can resolve rows absent from this dataset.

The dataset is bundled locally: no per-import API, geocoding charge, or third-party
disclosure of uploaded lead addresses. Refresh from a reviewed, pinned upstream
revision when postal geography changes; retain source attribution and run the
split-state and exact-workbook tests after any refresh.
