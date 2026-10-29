# Aluna

**TL;DR:** Aluna is a self-building application where you can turn intent into working capabilities. [How to run it](#how-to-run-it)

Aluna ships with no business logic: no books, no recipes, no expenses, no subject it already knows how to track. What it ships is a platform that builds capabilities on demand from simple promptsß. You say what you want to keep track of, a model writes the capability, and the platform checks it and puts it live while the app runs.

A capability is one subject's records together with everything that works on them: the fields, the rules, the forms, the search and how each record looks. Type *track the books I read* and Aluna builds Books. *add the date I finished* changes it, and *which books did I finish this year?* gets an answer read from your records. You never write a schema or a line of code, and nothing needs a restart or a deploy.

Aluna is not a coding agent, and it does not hand you a codebase. A capability lives only inside Aluna, with no repository, no deploy and no source to edit.

This repository is an architecture more than a product. It proposes how to build an app that builds itself, and Aluna is that proposal built and running. The proposal turns on two questions: how much of an app a model can write, and what a hand-written platform has to check before the model's code runs.

The name comes from the [Kogi](https://en.wikipedia.org/wiki/Kogi_people) of Colombia's Sierra Nevada de Santa Marta. To them *aluna* is the world of thought, and the material world is born from it.

<p>
  <img src="design/assets/logos/reading-journal.svg" width="72" height="72" alt="Logo of a reading journal capability">
  <img src="design/assets/logos/coffee-tasting-log.svg" width="72" height="72" alt="Logo of a coffee tasting log capability">
  <img src="design/assets/logos/telescope-observations.svg" width="72" height="72" alt="Logo of a telescope observations capability">
  <img src="design/assets/logos/recipes.svg" width="72" height="72" alt="Logo of a recipes capability">
  <br>
  <sub>Logos of four capabilities.</sub>
</p>

[See how Aluna works](https://jcospina.github.io/aluna/) · [Open the design system](https://jcospina.github.io/aluna/design/)

## How it works

Aluna bets that a model can write everything that belongs to one subject: its fields, its rules, its queries and how one record looks. Everything else is a fixed platform, written by hand. It stores the records, changes the tables, draws the desk and the forms, and runs the model's code before anyone uses it.

The Intent Resolver reads a sentence and decides what it asks for: a new capability, a change to one, a link between two, a question, or something Aluna should not act on. For a new capability, the Core Builder has the model write a spec, tests from that spec, and then the code. A change gets a new spec as well. The Diff Engine compares it with the old one, and only the code the change touches is written again.

Nothing goes live until it passes the Gate. The Gate runs the code on synthetic data, checks its markup against the design system and runs the tests written from the spec. A version that passes goes live in one SQLite transaction. One that fails changes nothing, and the version you were using keeps working.

A question changes none of your records. The model reads them with read-only SQL and writes the answer.

The [architecture deck](https://jcospina.github.io/aluna/) walks through all of this one slide at a time, from an empty desk to a live Finance tracker and its first change. The whole architecture is in the [architecture document](docs/architecture.md), its vocabulary in [CONTEXT.md](CONTEXT.md), and the reasons behind its decisions in the [architecture decision records](docs/adr/).

## Measurements

Aluna records the tokens, time and outcome of every build in the `generation_lifecycle_metrics` table of its database. The table holds 86 builds from 26 August to 29 October 2026, all on the default `gpt-5.6-terra` at medium reasoning effort.

| | New capability | Change to a capability |
| --- | ---: | ---: |
| Builds that went live | 49 | 15 |
| Tokens per build, median | 38,100 | 34,300 |
| Tokens per build, middle half | 34,300 to 41,300 | 30,200 to 43,900 |
| Output tokens per build, median | 10,800 | 8,000 |
| Prompt to live, median | 1 min 46 s | 1 min 20 s |
| Prompt to live, fastest and slowest | 1 min 15 s and 4 min 27 s | 25 s and 3 min 41 s |
| Builds that failed | 8 of 57 (14%) | 1 of 18 (6%) |

Tokens and times count only the builds that went live. Both include the Intent Resolver's reading of the sentence. The time runs from the moment the prompt arrives to the moment the new version is live, including any wait behind another build. Counting what failed and cancelled builds spent too, each new capability that went live cost about 47,300 tokens and each change about 39,600.

Two of the 18 change requests ended when the Diff Engine found nothing to change, and they count as neither live nor failed. Eleven more builds, 8 new and 3 changes, were cancelled before they finished, and the failure counts leave them out.

Seven of the nine failed builds stopped at the behavioural tests the model writes from the spec. They included a search that missed a record with an accent in its name, a list in the wrong date order and a list of logins that showed a password. The model writes those tests as well as the code, and a failed test does not record which of the two was wrong. The other two builds failed while the model was writing code: a search handler in a new capability still failed the strict TypeScript check after two attempts, and the AI provider took more than the five-minute limit to write one piece of a change.

In 23 of the 49 new capabilities that went live, at least one piece of code failed a check first and the model rewrote it. A change writes only the code it touches, and 2 of the 15 needed a rewrite.

The `intent_resolution_metrics` table has timed 38 questions since 14 September. They took a median of 10 seconds to answer, from 6 to 30.

These are one developer's builds, and they are no benchmark: the prompts were not fixed in advance, and the platform changed between builds.

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
