# Aluna

**TL;DR:** Aluna is a self-building application where you can turn intent into working capabilities. [How to run it](#how-to-run-it)

Aluna starts out empty. It doesn't come with anything built in for books, recipes, expenses or anything else you might want to keep track of. You tell it what you need, and it builds it for you while it's running.

You can type "track the books I read" and Aluna will build you a place to keep your books, with a form for adding them, a search and a card for each book. If you want to change something or add more to it, just ask, for example "add the date I finished". You can also ask questions about what you've saved, like "which books did I finish this year?", and Aluna will look through your records and answer. You never write code or design a database, and nothing needs a restart.

Aluna calls each thing it builds a capability. Your books are one capability, your recipes could be another, and they all sit side by side on the desk, Aluna's main screen.

Aluna isn't a coding agent, and it won't hand you code to host or maintain. Everything it builds lives inside Aluna, so there's nothing for you to deploy.

This repository is mostly an architecture, not a finished product. It's a proposal for how an app could build itself, and Aluna is that proposal built so you can try it. Behind it are two questions: how much of an app can a model write, and what does the rest of the app need to check before that code is allowed to run?

The name comes from the [Kogi people](https://en.wikipedia.org/wiki/Kogi_people) of Colombia's Sierra Nevada de Santa Marta. For them, *aluna* is the world of thought, the place where the material world is born.

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

Aluna is split into two parts. A model writes everything that's specific to one subject: its fields, its rules, how you search it and how each record looks. Everything else is a fixed platform written by hand. The platform stores your records, updates the database tables, draws the desk and the forms, and tests the model's code before anyone gets to use it.

When you type something, a part called the Intent Resolver reads it first and works out what you're asking for. You might want a new capability, a change to one you already have, a link between two of them, or an answer to a question. Or it might be something Aluna shouldn't act on at all.

For a new capability, the Core Builder asks the model for three things, in order: a spec that describes what to build, tests based on that spec, and then the code itself. A change works the same way, with one difference: the Diff Engine compares the new spec with the old one, and only the code the change affects gets rewritten.

Nothing goes live until it passes the Gate. The Gate runs the new code against made-up data, checks that its markup sticks to the design system, and runs the tests that came from the spec. If everything passes, the new version goes live all at once, in a single SQLite transaction. If anything fails, nothing changes, and the version you were using keeps working.

Questions never change your records. To answer one, the model reads your records with read-only SQL and then writes you an answer.

If you'd like to see all of this step by step, the [architecture deck](https://jcospina.github.io/aluna/) walks through it one slide at a time, from an empty desk to a working Finance tracker and its first change. For the full picture, read the [architecture document](docs/architecture.md). The words Aluna uses are explained in [CONTEXT.md](CONTEXT.md), and the reasons behind each decision are in the [architecture decision records](docs/adr/).

## Measurements

Every time Aluna builds or changes something, it writes down how many tokens it used, how long it took and whether it worked. These records live in the `generation_lifecycle_metrics` table of its database. Between 26 August and 29 October 2026 that table recorded 86 builds, all made with the default model, `gpt-5.6-terra`, at medium reasoning effort.

| | New capability | Change to a capability |
| --- | ---: | ---: |
| Builds that went live | 49 | 15 |
| Tokens per build (median) | 38,100 | 34,300 |
| Tokens per build (middle half of builds) | 34,300 to 41,300 | 30,200 to 43,900 |
| Output tokens per build (median) | 10,800 | 8,000 |
| Time from prompt to live (median) | 1 min 46 s | 1 min 20 s |
| Time from prompt to live (fastest and slowest) | 1 min 15 s and 4 min 27 s | 25 s and 3 min 41 s |
| Builds that failed | 8 of 57 (14%) | 1 of 18 (6%) |

So a new capability usually takes a little under two minutes and about 38,000 tokens, and a change takes a bit less. The clock starts when you send your prompt and stops when the new version is live, so it includes the Intent Resolver and any time spent waiting for another build to finish. The token and time figures only count builds that went live. If you also count what the failed and cancelled builds used, each new capability that went live cost about 47,300 tokens, and each change about 39,600.

Two of the change requests ended with nothing to do, because the Diff Engine found nothing that needed changing. They count as neither live nor failed. Another 11 builds, 8 new capabilities and 3 changes, were cancelled before they finished, so they don't count as failures either.

Most failures, seven out of nine, came from the tests the model writes from the spec. Among other things, those tests caught a search that missed a record with an accent in its name, a list sorted in the wrong date order and a list of logins that showed a password. Keep in mind that the model writes the tests as well as the code, so when a test fails, the records don't say which of the two was wrong. The other two builds failed while the model was still writing code. In one, a search handler still didn't pass the strict TypeScript check after two tries. In the other, the AI provider took longer than the five-minute limit to write part of a change.

Builds that went live often needed a second try along the way. In 23 of the 49 new capabilities, at least one piece of code failed a check, and the model rewrote it before the build went live. A change only rewrites the code it touches, and 2 of the 15 changes needed a fix like this.

Questions are much quicker. The `intent_resolution_metrics` table has timed 38 of them since 14 September, and they usually took about 10 seconds to answer, anywhere from 6 to 30.

These numbers all come from one developer's own use, so please don't read them as a benchmark. The prompts weren't planned in advance, and the platform kept changing between builds.

## How to run it

Aluna runs on your own computer, for one person, and isn't hosted anywhere. Your records stay on your machine, with one exception: when you ask a question, the rows the model needs to read are sent to your AI provider so it can answer. The code the model writes runs inside Aluna's server, so please [keep it local](#keep-it-local).

### What you need

- [Bun](https://bun.com/docs/installation) 1.3 or newer, and Git
- A C compiler, and a version of SQLite that can load extensions. Aluna compiles a small add-on into SQLite so that searching for "cafe" also finds "café".
- An API key from OpenAI, Anthropic or any OpenAI-compatible provider
- A [Recraft](https://www.recraft.ai/docs/api-reference/getting-started) API key, if you want logos for your capabilities
- Node.js, but only if you want to run `bun run mutate`

Aluna is developed on macOS. There, Homebrew's SQLite can load extensions, so this is all you need:

```sh
brew install sqlite
```

If your SQLite is installed somewhere other than Homebrew's usual folders, point `OMNI_CRUD_SQLITE_LIBRARY` at its `libsqlite3.dylib`. Aluna expects the matching `sqlite3.h` and `sqlite3ext.h` headers in an `include` folder next to the library's `lib` folder.

On Linux, install your distribution's C build tools and its SQLite development package. If your compiler isn't called `cc`, set `CC` to its name. Aluna isn't regularly tested on Linux.

### Getting your keys

Put your AI provider's key in `OMNI_API_KEY`. If you don't set anything else, Aluna uses OpenAI's `gpt-5.6-terra`, so an OpenAI key is all you need. For any other provider, also set its endpoint and the ID of a model it serves:

```dotenv
OMNI_API_KEY=your-provider-key
OMNI_BASE_URL=https://your-provider-endpoint/v1
OMNI_MODEL=your-model-id
```

Aluna works out which API to use from the endpoint. For an endpoint on a subdomain of `openai.com` it uses OpenAI's Responses API, and for one on a subdomain of `anthropic.com` it uses Anthropic's Messages API. Every other endpoint gets OpenAI's Chat Completions API, which DeepSeek, Qwen, GLM, Kimi, MiniMax and many other providers support.

Logos come from Recraft. Recraft only gives you an API key once your account has API units, so [buy a unit package](https://www.recraft.ai/docs/api-reference/pricing) first. Then sign in, open the [API page of your profile](https://app.recraft.ai/profile/api) and press **Generate**. Each logo costs about $0.08, and if a request fails, Aluna tries at most three times in total. Without a Recraft key everything still works, and your capabilities just keep a placeholder tile instead of a logo.

Both services charge for every call. While `bun run dev` is running, the developer panel shows how many tokens each build used, and [Measurements](#measurements) shows what builds have cost so far.

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

Open <http://localhost:3030> and type "track the books I read". Add a few books, then try "add the date I finished", and after that ask "which Le Guin books did I finish this year?". If you already know what you want, you can also name the fields yourself: "I want to keep a reading diary with a title, author, rating and notes".

The first time you run it, Aluna creates `data/omni-crud.db` and sets up its tables by itself. Omni-crud is the project's engineering name.

### Environment variables

Bun reads `.env` automatically, and [.env.example](.env.example) explains every value below.

| Variable | Needed | Default | What it does |
| --- | --- | --- | --- |
| `OMNI_API_KEY` | For any request | none | Your AI provider key. The server starts without it, but it can't build, change or answer anything. |
| `RECRAFT_API_KEY` | For logos | none | Your Recraft key. Without it, capabilities keep their placeholder tile. |
| `OMNI_MODEL` | No | `gpt-5.6-terra` | The model Aluna uses for everything, from builds to questions. |
| `OMNI_BASE_URL` | No | `https://api.openai.com/v1` | Your provider's endpoint. If you change it, change the key and the model too. |
| `RECRAFT_BASE_URL` | No | `https://external.api.recraft.ai/v1` | The endpoint of the logo service. |
| `OMNI_BEHAVIORAL_TIER` | No | `on` | Turns the behavioural tests on or off. It accepts `on/off`, `true/false`, `yes/no` or `1/0`, and any other value makes every build fail. |
| `PORT` | No | `3030` | The port Aluna listens on. `0` picks any free port, and anything that isn't a valid port number falls back to 3030. |
| `OMNI_MAX_FILE_BYTES` | No | `524288000` (500 MiB) | The biggest file a single upload can be. |
| `OMNI_MAX_LIST_FILES` | No | `20` | The most files a field that holds several files can keep. |
| `OMNI_DB_PATH` | No | `data/omni-crud.db` | The SQLite database file. |
| `OMNI_OBJECT_STORE_ROOT` | No | `storage` | Where uploaded files are kept. |
| `OMNI_ARTIFACTS_ROOT` | No | `capabilities` | Where capability versions and logos are kept. `bun run reset` empties it, so give it a folder of its own. |
| `OMNI_CRUD_SQLITE_LIBRARY` | No | Homebrew's paths | macOS only. A `libsqlite3.dylib` that can load extensions, with its headers in an `include` folder next to it. |
| `CC` | No | `cc` | The C compiler that builds the search add-on. |

If a file size or file count isn't a positive whole number, the server won't start.

### Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Starts Aluna on `PORT` (3030 by default) and restarts it whenever server code under `src/` changes. A restart stops any build that's running. |
| `bun run test` | Runs the test suite, split across several processes. No test calls a real AI provider, so running them costs nothing. |
| `bun run typecheck` | Type-checks the server and the browser code. |
| `bun run lint` | Runs Biome plus the repo's own rules: how long comments can be and what they may refer to, at most ten files per folder, and every `*.policy.ts` check. |
| `bun run mutate <file>` | Plants small bugs in one file and runs its tests against each one, to prove the tests catch them. Needs Node.js. |
| `bun run build`, then `bun run start` | Builds a production server into `dist/` and runs it. A production build leaves out the build metrics in the developer panel. |
| `bun run reset` | Deletes every capability, record, stored file, logo and link, and clears the metrics. The database file and its tables stay. |

### Keep it local

Don't run Aluna anywhere other people can reach it. The code a model writes has to pass the Gate before it goes live, but after that it runs inside the server process like any other code. The Gate and the platform's other checks are there to catch a model's mistakes. They aren't a sandbox, and they can't stop code that was written on purpose to get around them. That's why the server only listens on `127.0.0.1`.

## License

Aluna is free software under the [GNU Affero General Public License v3.0 only](LICENSE). You can use it commercially, change it and share it. If you distribute it, it has to stay under the AGPL. If you run a changed version that other people use over a network, you have to offer them its source code for free. Please keep the license and the copyright notice in [NOTICE](NOTICE).

Third-party dependencies and assets keep their own licenses. These include the Outfit and Fraunces fonts, whose licenses are in [design/assets/fonts/](design/assets/fonts/README.md), and Alpine.js, whose license is in [public/vendor/](public/vendor/MIT-Alpine.txt).
