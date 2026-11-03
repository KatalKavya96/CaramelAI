# Provider plugins: design

Status: proposal, not built yet.

## Problem

Caramél ships seven providers in `src/model/providers.ts`. One of them, the custom endpoint,
covers any server that speaks the OpenAI chat API: Ollama, LM Studio, Groq, Together and most
new labs. A provider that is not OpenAI-compatible still needs a code change and a release.
Examples:

- A different wire format, such as Gemini's native API or Bedrock's.
- Request signing, such as AWS SigV4, or a sign-in flow instead of a pasted key.
- Cost reporting, model listing or a key test that the generic endpoint cannot know about.

A plugin closes that gap: the user installs a small program, and Caramél gains a provider
without changing its own code.

## Goals

- Add a model provider without editing or rebuilding Caramél.
- A broken or hostile plugin cannot read the repository, other providers' keys, or the server's
  memory, and a crashed plugin cannot crash a run's controller.
- Plugins reuse the existing retry, backoff, timeout and error handling in
  `StructuredModelAdapter`, so a plugin provider behaves like a built-in one.
- Plugins can be written in any language.

## Non-goals (for now)

- **Tool plugins**, meaning new agent actions such as "query the database". A tool runs against
  the user's repository, so it needs the command sandbox and a much stricter review. It should get
  its own design once provider plugins have proved the protocol.
- **Plugins on the shared server.** A hosted server never loads plugins, in the same way that it
  refuses custom endpoints today (`allowCustomEndpoint`). Plugins are a desktop feature.
- **A marketplace.** Installing a plugin means pointing Caramél at a folder.

## Options considered

| Option | How it works | Why not |
| --- | --- | --- |
| In-process module | `import()` a JS file that exports a `ProviderInfo` | The module shares the server process. It can read every key in the key store, the filesystem and the run directories. One bad plugin compromises everything. |
| HTTP sidecar | The plugin is a local server, and the custom endpoint points at it | This already works today for OpenAI-compatible shims. But the user has to run and secure a server, and Caramél cannot pass usage, cost or typed errors through the OpenAI format. |
| **Subprocess over stdio** (chosen) | Caramél starts the plugin as a child process and exchanges JSON lines on stdin and stdout | It is isolated by the OS, works in any language, can run inside the existing native sandbox, and has nothing to listen on a port. |

## Design

### Layout and manifest

A plugin is a folder under `~/.caramel/plugins/<id>/` with a `caramel-plugin.json` file:

```json
{
  "protocol": 1,
  "id": "gemini",
  "label": "Google Gemini",
  "command": ["./gemini-plugin"],
  "defaultModel": "gemini-2.5-pro",
  "keyUrl": "https://aistudio.google.com/apikey",
  "reportsCost": false,
  "network": ["generativelanguage.googleapis.com"]
}
```

`network` lists the only hosts the plugin may reach. Today's native sandbox can only switch the
network fully on or off (Seatbelt and network namespaces filter by address, not by host name), so
enforcing the list needs a small local proxy that the plugin's traffic must go through. Phase 2
builds that proxy. Until then, the list is shown to the user at install but not enforced.

### Protocol

Requests and replies are one JSON object per line, matched by `id`. Version 1 has three methods:

| Method | Params | Result |
| --- | --- | --- |
| `describe` | none | The manifest fields, so Caramél can check them against the file |
| `testKey` | `{ key }` | The existing `KeyTestResult`: `{ ok: true }` or `{ ok: false, error, message }` |
| `complete` | `{ key, model, messages, responseFormat }` | `{ output, usage }`, the same shape `ModelTransport.send` returns now |

An error reply carries a kind that maps one-to-one onto `ModelTransportError`:

```json
{ "id": 7, "error": { "kind": "rate_limit", "message": "Quota exceeded", "retryAfterMs": 20000 } }
```

The kinds are `rate_limit`, `authentication`, `transient` and `permanent`. Because a plugin
reports the kind, the adapter's backoff (5, 15 and 30 seconds for rate limits) works unchanged.

### Where it plugs in

- `PluginTransport implements ModelTransport`. It writes a `complete` request, waits for the
  matching reply, and maps an error reply to a `ModelTransportError`. Wrapping it in
  `StructuredModelAdapter` gives a plugin provider the same retries, timeouts and JSON validation
  as a built-in one.
- `Provider` widens from the fixed `PROVIDERS` list to that list plus `` `plugin:${id}` ``. The
  registry builds a `ProviderInfo` for each installed plugin from its manifest. The web picker,
  the key store and run requests already work in terms of `ProviderInfo`, so they need no special
  cases.
- The key stays in the Keychain, as it does today. Caramél sends it in each `complete` request,
  never in the environment or on the command line, where other processes could see it. A plugin
  only ever sees its own provider's key.

### Sandboxing and trust

- The plugin runs under the native sandbox already used for agent commands. It has no read access
  to run directories or the key store, and it writes only to its own folder. Once phase 2's proxy
  exists, it can reach only the hosts in `network`.
- On install, Caramél shows the manifest and the hosts the plugin may reach, and records the
  sha256 of the plugin folder. If the folder changes, the plugin is disabled until the user
  approves it again.
- Limits: a request timeout comes from the adapter's existing `requestTimeoutMs`, each reply is
  capped at 4 MB, and a plugin that exits is restarted once per run. After that, the run fails
  with a clear provider error.

### Testing

- A fake plugin (a few lines of TypeScript run with Bun) goes in `tests/fixtures`. Tests cover the
  round trip, each error kind, a timeout, a crash and restart, and an oversized reply.
- `caramel plugin check <folder>` runs `describe` and `testKey`, plus one `complete` call if the
  user agrees to it. Plugin authors can use it to check their plugin before installing it.

## Phases

1. Protocol, `PluginTransport`, the manifest loader, the fake-plugin tests, and a CLI flag
   `--provider plugin:<id>`.
2. Sandboxed launch with the host allowlist, plus install and approve-on-change in the desktop
   app's provider settings.
3. Revisit tool plugins using what phases 1 and 2 taught.

## Open questions

- Should a plugin be able to list its models, so the picker can show them, or is a free-text
  model id enough for version 1?
- Is restarting a crashed plugin once per run right, or should the first crash fail the run so
  bugs are not hidden?
- Is a folder hash enough of a trust check, or should installs also require a signature?
