# Changelog

## 0.4.1

- Fixed: amounts with a thousands separator, such as `"1,234.50"`, crashed the import with
  `decimal.InvalidOperation` (#212).

## 0.4.0

- Accounting-style negatives such as `(12.00)` are read as -12.00.
- A leading `$` is ignored.
