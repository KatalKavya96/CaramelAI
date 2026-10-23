# Changelog

## 2.1.0

- `slugify` strips accents (`"Crème"` becomes `"creme"`).

## 2.0.0

Breaking changes:

- The `sep` option is now called `separator`, to match the rest of our packages.
- `maxLength` no longer cuts words in half. The slug is cut after the last whole word that fits.

## 1.2.0

- Added the `maxLength` option.
