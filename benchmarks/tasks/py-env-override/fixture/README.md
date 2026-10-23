# beacon

A small status-page server.

## Configuration

Settings come from three places, later ones winning:

1. built-in defaults,
2. the `[server]` section of an INI file passed with `--config`,
3. environment variables named `BEACON_<SETTING>`, for example `BEACON_PORT=9000`.

| Setting     | Default     | Type             |
|-------------|-------------|------------------|
| `host`      | `127.0.0.1` | text             |
| `port`      | `8000`      | whole number     |
| `debug`     | `false`     | true/false       |
| `workers`   | `2`         | whole number     |
| `log_level` | `info`      | text             |

True/false settings accept `true/false`, `yes/no`, `on/off` and `1/0`.

Check a configuration without starting the server:

```sh
python3 -m beacon check --config beacon.ini
```
