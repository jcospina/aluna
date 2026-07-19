# Aluna

**Describe what you want to keep track of. Aluna turns it into a working personal app while you watch.**

Aluna is an active research prototype for an app that shapes itself around your intent. It begins with a small, dependable shell and no predefined domain model. When you ask for a capability—notes, recipes, a reading diary, or something entirely your own—Aluna uses AI to define it, build it, check it, and keep the result locally.

[Explore the architecture](https://jcospina.github.io/aluna/) · [Read the canonical architecture](docs/architecture.md) · [Follow the roadmap](docs/modules.md)

> The architecture tour is the only hosted surface. Aluna itself is intentionally not deployed: building capabilities makes paid AI-provider calls, and this proof of concept is designed for a local, single-user runtime with persisted local data.

## What you can explore today

- Ask Aluna to build a new capability from a plain-language prompt.
- Create, browse, edit, delete, and search its records through one consistent interface.
- Watch friendly progress narration while the build moves through generation and checks.
- Open the developer panel to inspect the raw build stages without turning the product into a coding tool.
- Restart the app and find your capabilities and records still there.

Aluna is in active development, not production software. Today the explicit “build me something new” loop is the working path. Extending an existing capability, one-off cross-capability questions, file handling, behavior-driven proposals, and the experiment dashboard remain on the [roadmap](docs/modules.md).

## How Aluna works

Aluna keeps a deliberate boundary between a small platform and everything it creates:

- The platform owns the shell, routing, storage boundaries, shared presentation, and safety checks.
- AI authors each capability’s data shape, behavior, presentation intent, and executable actions.
- A candidate must pass structural, smoke, design, and optionally AI-authored behavioral checks before it can become active.
- SQLite holds the registry, records, events, and generation metrics; generated code is versioned on disk.

The result is the project’s core experiment: can a personal app become what someone needs without asking them to design schemas, routes, forms, or code?

For the full model, decisions, and boundaries, see the [visual architecture tour](https://jcospina.github.io/aluna/), [architecture document](docs/architecture.md), [domain language](CONTEXT.md), and [ADRs](docs/adr/).

## Run Aluna locally

### Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- Git
- A C compiler and SQLite extension headers, used to build Aluna’s search-normalization bridge
- An API key for OpenAI, Anthropic, or another OpenAI-compatible provider when using AI-powered flows

On macOS, install extension-capable SQLite with Homebrew:

```sh
brew install sqlite
```

On Linux, install your distribution’s C build tools and SQLite development package. If your compiler is not available as `cc`, set `CC`; on macOS, if SQLite is outside Homebrew’s standard paths, set `OMNI_CRUD_SQLITE_LIBRARY`.

### Install and start

```sh
git clone https://github.com/jcospina/aluna.git
cd aluna
bun install
cp .env.example .env
```

Add your provider key to `.env`:

```dotenv
OMNI_API_KEY=your-provider-key
```

Then start the development server:

```sh
bun run dev
```

Open [http://localhost:3030](http://localhost:3030), enter a request such as “I want to keep a reading diary with a title, author, rating, and notes,” and watch Aluna put it together. The first run creates `data/omni-crud.db` and applies platform migrations automatically.

Provider calls can incur charges. Usage depends on the model, the capability, and whether the behavioral-test tier is enabled.

## Environment variables

Bun loads `.env` automatically. The checked-in [.env.example](.env.example) documents every supported value.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OMNI_API_KEY` | For AI-powered flows | — | Provider-neutral API key. The server can boot without it, but capability generation cannot. |
| `OMNI_MODEL` | No | `gpt-5.6-terra` | The single model used for generation. |
| `OMNI_BASE_URL` | No | `https://api.openai.com/v1` | Provider endpoint. Change this together with the key and model when switching providers. Anthropic hosts use the Anthropic wire; other non-OpenAI hosts use the OpenAI-compatible wire. |
| `OMNI_BEHAVIORAL_TIER` | No | `on` | Enables AI-authored behavioral checks. Accepts `on/off`, `true/false`, `yes/no`, or `1/0`. |
| `PORT` | No | `3030` | Local HTTP port. `0` asks the operating system for an available port. |
| `OMNI_CRUD_SQLITE_LIBRARY` | No | Standard Homebrew paths on macOS | Full path to an extension-capable `libsqlite3.dylib` when it is installed elsewhere. |
| `CC` | No | `cc` | C compiler used for the SQLite search-normalization bridge. |

## Useful commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Starts Aluna with watch mode on port 3030 by default. |
| `bun test` | Runs the test suite. |
| `bun run typecheck` | Checks server and browser TypeScript. |
| `bun run lint` | Runs Biome checks. |
| `bun run format` | Formats supported files with Biome. |
| `bun run build` | Builds the Bun server into `dist/`. |
| `bun run start` | Starts the built server. Run `bun run build` first. |
| `bun run reset` | **Deletes local runtime content:** generated capabilities, records, metrics/events, and stored blobs. It keeps the database file and tracked directory placeholders. |

## Repository map

```text
src/           Platform runtime, build pipeline, registry, router, and tests
public/        The fixed product shell and authored browser assets
docs/          Architecture, ADRs, design system, and the Pages tour
modules/       Phased plans and the local Markdown issue tracker
capabilities/  Runtime-generated, versioned capability snapshots
data/          Local SQLite database and sidecars
storage/       Local capability-owned file storage
```

Generated contents under `capabilities/`, `data/`, and `storage/` are ignored by Git. Their tracked README files document the runtime contracts.

## Security boundary

Aluna is a local proof of concept. Generated code is checked against deterministic contracts and exercised with synthetic data before activation, but it still runs in-process. Those checks protect against accidental model output; they are not a sandbox for deliberately hostile generated code or untrusted public access. Do not expose this runtime as a multi-user service.

## License

Aluna is open source under the [GNU Affero General Public License v3.0 only](LICENSE). Commercial use, modification, forks, and redistribution are allowed. Covered distributions must remain under the AGPL, and anyone who runs a modified version for users over a network must offer those users the corresponding source code at no charge. Preserve the license and the copyright attribution in [NOTICE](NOTICE).

Third-party dependencies and assets remain under their own licenses, including the Outfit font license in [`public/fonts/OFL.txt`](public/fonts/OFL.txt).
