# Typst Font Assets

This directory vendors the default `text` font assets used by `@myriaddreamin/typst.ts`.

Source: `typst-assets@v0.13.1`, `files/fonts/`

The files are copied into `wasm/typst/fonts/` by File Viewer asset tooling so Typst previews do not fetch fonts from public CDNs at runtime. Keep the filenames stable because `typst.ts` resolves them by name.
