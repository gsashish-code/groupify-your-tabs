# Privacy Policy — Groupify Your Tabs

_Last updated: 2026-07-28_

Groupify Your Tabs does not collect, store, transmit, or sell any user data to any
external server or third party. The extension operates entirely on your device.

## What the extension accesses

- **Tab URLs and tab group state** (via the `tabs` and `tabGroups` browser APIs) —
  used only to match your open tabs against the grouping rules you define, and to
  create/move tabs into the corresponding tab group.
- **Your grouping rules** (via the `storage` browser API) — saved locally in your
  browser's extension storage so your rules persist between sessions.

## What the extension does NOT do

- It does not send any browsing data, tab URLs, or rules to a remote server.
- It does not use analytics, tracking, or third-party scripts.
- It does not share or sell data to any third party.

## Data retention and control

All data (your rules) is stored locally via `browser.storage.local` and is removed
automatically if you uninstall the extension. You can also clear all rules at any
time from the options page ("Reset Rules").

## Contact

For questions about this policy, open an issue on the
[GitHub repository](https://github.com/gsashish-code/groupify-your-tabs).
