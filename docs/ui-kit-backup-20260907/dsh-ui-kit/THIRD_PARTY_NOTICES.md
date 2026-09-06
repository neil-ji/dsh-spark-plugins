# Third-Party Notices

This project is an independent re-packaging and faithful visual re-creation of the
UI primitives and design tokens originally authored by DeepSeek for the DeepSeek
Harness web interface. Both source packages are MIT-licensed; their copyright
notices are reproduced below.

## Design source

- **@deepseek-ai/dsh-client-ui-primitives** — "Pure React atoms for the dsh web UI:
  controls, icons, markdown, and JSON inspectors (zero cordis)".
  Source: https://github.com/deepseek-ai/deepseek-harness (packages/client/ui-primitives)
- **@deepseek-ai/dsh-client-ui-theme** — design token sheets (`--dsw-*` custom
  properties, `--shiki-*` palette, scrollbar skin).
  Source: https://github.com/deepseek-ai/deepseek-harness (packages/client/ui-theme/src/styles)

License (both): MIT License, Copyright (c) 2026 DeepSeek.
Full text: https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE

## What was copied

- `src/styles/*.css` — verbatim copies of the ui-theme token sheets
  (design-platform.css, base.css, gradient-shadow-text.css, scrollbar.css, shiki.css).
- `src/**/*.module.css` — verbatim copies of the ui-primitives component styles.
- `src/**/*.tsx|ts` — source copies of the ui-primitives components, adapted only
  where the original wired into the DeepSeek Harness runtime (the `invariant`
  registration module was removed; nothing else was changed).

## Dependencies

See package.json. Notable: KaTeX (MIT), Shiki (MIT), micromark / mdast (MIT),
react (MIT).
