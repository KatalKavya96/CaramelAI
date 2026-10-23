# Changelog

## 1.4.0

- Settings can now be overridden with `BEACON_*` environment variables, for container deployments.
- `python3 -m beacon check` validates a configuration without starting the server.

## 1.3.2

- Reject ports outside 1–65535 with a clear message.
