# Groupify Your Tabs

A browser extension that automatically groups your open tabs, built with [WXT](https://wxt.dev) and Vue 3.

## How it works

You define rules (via the options page) that match a tab's URL — either by substring or regex — to a named tab group with a color. When a tab navigates to a matching URL, the background service worker moves it into that group, creating the group in that browser window if it doesn't already exist. Rules can also be applied retroactively to tabs that are already open.

## Development

```bash
npm install
npm run dev            # Chrome
npm run dev:firefox    # Firefox
```

WXT loads the extension into a browser instance with hot reload. The popup and options UIs live under `entrypoints/popup` and `entrypoints/options`; shared logic (rules storage, tab/tab-group helpers) lives under `utils/`.

## Building

```bash
npm run build           # Chrome
npm run build:firefox   # Firefox
npm run zip             # Package for distribution
npm run zip:firefox
```

## Type checking

```bash
npm run compile
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar).
