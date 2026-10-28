# Aluna

**A self-building app. It ships with no business logic and builds what you ask for while it runs.**

<p>
  <img src="design/assets/logos/reading-journal.svg" width="72" height="72" alt="Logo of a reading journal capability">
  <img src="design/assets/logos/coffee-tasting-log.svg" width="72" height="72" alt="Logo of a coffee tasting log capability">
  <img src="design/assets/logos/telescope-observations.svg" width="72" height="72" alt="Logo of a telescope observations capability">
  <img src="design/assets/logos/recipes.svg" width="72" height="72" alt="Logo of a recipes capability">
  <br>
  <sub>Logos of four capabilities.</sub>
</p>

[See how Aluna works](https://jcospina.github.io/aluna/) · [Open the design system](https://jcospina.github.io/aluna/design/)

## Contents

1. [What Aluna is](#what-aluna-is)
2. [How it works](#how-it-works)
3. [The design system](#the-design-system)
4. [Not built yet](#not-built-yet)
5. [How to run it](#how-to-run-it)
   - [What you need](#what-you-need)
   - [Getting your keys](#getting-your-keys)
   - [Install and start](#install-and-start)
   - [Environment variables](#environment-variables)
   - [Commands](#commands)
   - [Keep it local](#keep-it-local)
6. [License](#license)

## What Aluna is

Aluna is an app that builds itself. It ships with no business logic: no books, no recipes, no expenses, no subject it already knows how to track. What it ships is a platform that builds capabilities on demand, from prompts. You say what you want to keep track of, a model writes the capability, and the platform checks it and puts it live while the app runs.

A capability is one subject's records together with everything that works on them: the fields, the rules, the forms, the search and how each record looks. Type *track the books I read* and Aluna builds Books. *add the date I finished* changes it, and *which books did I finish this year?* gets an answer read from your records. You never write a schema or a line of code, and nothing needs a restart or a deploy.

Aluna is not a coding agent, and it does not hand you a codebase. A capability lives only inside Aluna, with no repository, no deploy and no source to edit.

The name comes from the [Kogi](https://en.wikipedia.org/wiki/Kogi_people) of Colombia's Sierra Nevada de Santa Marta. To them *aluna* is the world of thought, and the material world is born from it.

## How it works

Aluna bets that a model can write everything that belongs to one subject: its fields, its rules, its queries and how one record looks. Everything else is a fixed platform, written by hand. It stores the records, changes the tables, draws the desk and the forms, and runs the model's code before anyone uses it.

The Intent Resolver reads a sentence and decides what it asks for: a new capability, a change to one, a link between two, a question, or something Aluna should not act on. For a new capability, the Core Builder has the model write a spec, tests from that spec, and then the code. A change gets a new spec as well. The Diff Engine compares it with the old one, and only the code the change touches is written again.

Nothing goes live until it passes the Gate. The Gate runs the code on synthetic data, checks its markup against the design system and runs the tests written from the spec. A version that passes goes live in one SQLite transaction. One that fails changes nothing, and the version you were using keeps working.

A question changes none of your records. The model reads them with read-only SQL and writes the answer.

The [architecture deck](https://jcospina.github.io/aluna/) walks through all of this one slide at a time, from an empty desk to a live Finance tracker and its first change. The whole architecture is in the [architecture document](docs/architecture.md), its vocabulary in [CONTEXT.md](CONTEXT.md), and the reasons behind its decisions in the [architecture decision records](docs/adr/).

## The design system

Aluna looks like a desk on a meadow wallpaper, with every line inked as if by hand in the colours of one closed palette, High Meadow. The model writes the markup for each capability's cards, but only with the design system's colours, sizes and spacing. Fonts, borders and shadows belong to the platform. The Gate rejects markup that breaks these rules, so a capability you build today and one you build next month look like they belong on the same desk.

The design system is three working pages built on the stylesheets Aluna ships, and you can try them without running Aluna. One is the desk, with fixtures and a timer standing in for the model. One puts every control a generated form can use through its states. One shows how a capability's logo is put together.

[Open the design system](https://jcospina.github.io/aluna/design/) · [Read the names and rules](design/design-system.md) · [Serve it locally](design/README.md)

## Not built yet

Aluna is a research prototype, and some things are missing:

- Suggestions from use. Aluna does not watch how you use a capability or suggest changes from it.
- Reading documents. Aluna keeps your PDFs and Word files, but a question cannot reach what they say.
- Going back to an earlier version. Every version stays on disk, but nothing on the desk restores one.
- A dashboard for comparing builds over time.

## How to run it

Aluna runs on your own machine, for one person, and is not hosted anywhere. Your records are stored only there, though a question sends the rows it reads to your AI provider so the model can answer. The code a model writes runs inside the server, so [keep it local](#keep-it-local).

### What you need

- [Bun](https://bun.com/docs/installation) 1.3 or newer, and Git
- A C compiler and a SQLite that can load extensions. Aluna compiles a small bridge into SQLite so that search can ignore accents.
- An API key from OpenAI, Anthropic or any OpenAI-compatible provider
- A [Recraft](https://www.recraft.ai/docs/api-reference/getting-started) API key, if you want capability logos
- Node.js, only for `bun run mutate`

Aluna is developed on macOS, where Homebrew's SQLite can load extensions:

```sh
brew install sqlite
```

If your SQLite lives outside Homebrew's standard paths, set `OMNI_CRUD_SQLITE_LIBRARY` to its `libsqlite3.dylib`. The matching `sqlite3.h` and `sqlite3ext.h` must sit in the `include` folder beside the library's `lib` folder.

On Linux, install your distribution's C build tools and its SQLite development package, and set `CC` if your compiler is not called `cc`. Aluna is not regularly tested on Linux.

### Getting your keys

Put your AI provider's key in `OMNI_API_KEY`. With nothing else set, Aluna calls OpenAI's `gpt-5.6-terra`, so an OpenAI key is enough on its own. Any other provider also needs its endpoint and a model ID that endpoint serves:

```dotenv
OMNI_API_KEY=your-provider-key
OMNI_BASE_URL=https://your-provider-endpoint/v1
OMNI_MODEL=your-model-id
```

The endpoint decides which API Aluna speaks. An endpoint on a subdomain of `openai.com` gets OpenAI's Responses API, and one on a subdomain of `anthropic.com` gets Anthropic's Messages API. Every other endpoint gets OpenAI's Chat Completions API, which DeepSeek, Qwen, GLM, Kimi, MiniMax and many other providers serve.

Logos come from Recraft, which issues a key only after your account holds API units. [Buy a unit package](https://www.recraft.ai/docs/api-reference/pricing) first, then sign in, open the [API page of your profile](https://app.recraft.ai/profile/api) and press **Generate**. A logo costs roughly $0.08, and a failed request is tried at most three times in all. Without a Recraft key, capabilities build and work as usual and keep their placeholder tile.

Both providers charge per call. While `bun run dev` runs, the developer panel shows the tokens each build used.

### Install and start

```sh
git clone https://github.com/jcospina/aluna.git
cd aluna
bun install
cp .env.example .env
```

Put your keys in `.env`:

```dotenv
OMNI_API_KEY=your-provider-key
RECRAFT_API_KEY=your-recraft-key
```

Start the server:

```sh
bun run dev
```

Open <http://localhost:3030> and type *track the books I read*. Add a few books, then try *add the date I finished* and *which Le Guin books did I finish this year?* You can also name the fields yourself: *I want to keep a reading diary with a title, author, rating and notes*.

The first run creates `data/omni-crud.db` and applies the platform migrations on its own. Omni-crud is the project's engineering name.

### Environment variables

Bun loads `.env` on its own. [.env.example](.env.example) documents every value below.

| Variable | Needed | Default | What it does |
| --- | --- | --- | --- |
| `OMNI_API_KEY` | For any request | none | Your AI provider key. The server boots without it, but cannot build, change or answer anything. |
| `RECRAFT_API_KEY` | For logos | none | Your Recraft key. Without it, capabilities keep their placeholder tile. |
| `OMNI_MODEL` | No | `gpt-5.6-terra` | The one model every request uses, from builds to questions. |
| `OMNI_BASE_URL` | No | `https://api.openai.com/v1` | The provider endpoint. Change it together with the key and the model. |
| `RECRAFT_BASE_URL` | No | `https://external.api.recraft.ai/v1` | The logo service endpoint. |
| `OMNI_BEHAVIORAL_TIER` | No | `on` | Turns the behavioural tests on or off. Takes `on/off`, `true/false`, `yes/no` or `1/0`, and any other value fails every build. |
| `PORT` | No | `3030` | The local HTTP port. `0` picks a free one, and a value that is not a port number falls back to 3030. |
| `OMNI_MAX_FILE_BYTES` | No | `524288000` (500 MiB) | The largest file one upload may carry. |
| `OMNI_MAX_LIST_FILES` | No | `20` | The most files a multi-file field may hold. |
| `OMNI_DB_PATH` | No | `data/omni-crud.db` | The SQLite database file. |
| `OMNI_OBJECT_STORE_ROOT` | No | `storage` | Where uploaded files are kept. |
| `OMNI_ARTIFACTS_ROOT` | No | `capabilities` | Where capability versions and logos are kept. `bun run reset` empties it, so give it a directory of its own. |
| `OMNI_CRUD_SQLITE_LIBRARY` | No | Homebrew's paths | macOS only: an extension-capable `libsqlite3.dylib`, with its headers in the `include` folder beside it. |
| `CC` | No | `cc` | The C compiler for the search bridge. |

The server refuses to start when a file size or file count is not a positive whole number.

### Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Starts Aluna on `PORT` (3030 by default) and restarts it when server code under `src/` changes. A restart stops any build in flight. |
| `bun run test` | Runs the test suite sharded across processes. No test calls a real AI provider, so a run costs nothing. |
| `bun run typecheck` | Type-checks the server and the browser code. |
| `bun run lint` | Runs Biome plus the repo's own rules: comment length and references, at most ten files per folder, and every `*.policy.ts` check. |
| `bun run mutate <file>` | Plants small bugs in one file and runs its tests against each, to prove they catch them. Needs Node.js. |
| `bun run build`, then `bun run start` | Builds a production server into `dist/` and runs it. A production build leaves out the developer panel's build metrics. |
| `bun run reset` | Deletes every capability, record, stored file, logo and link, and clears the metrics. Keeps the database file and its tables. |

### Keep it local

Do not run Aluna anywhere other people can reach it. Generated code passes the Gate before it goes live, and from then on it runs inside the server process. The Gate and the platform's other checks catch a model's mistakes. They are no sandbox, and cannot hold back code written to escape them. That is why the server listens only on `127.0.0.1`.

## License

Aluna is free software under the [GNU Affero General Public License v3.0 only](LICENSE). You may use it commercially, change it and share it. Anyone who distributes it must keep it under the AGPL. Anyone who runs a changed version for users over a network must offer those users its source code at no charge. Keep the license and the copyright notice in [NOTICE](NOTICE).

Third-party dependencies and assets keep their own licenses, including the Outfit and Fraunces font licenses in [design/assets/fonts/](design/assets/fonts/README.md) and the Alpine.js license in [public/vendor/](public/vendor/MIT-Alpine.txt).
