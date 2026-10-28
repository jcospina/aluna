# Aluna

**Tell Aluna what you want to keep track of, and it builds you a small app for it while you watch.**

<p>
  <img src="design/assets/logos/reading-journal.svg" width="72" height="72" alt="Logo of a reading journal capability">
  <img src="design/assets/logos/coffee-tasting-log.svg" width="72" height="72" alt="Logo of a coffee tasting log capability">
  <img src="design/assets/logos/telescope-observations.svg" width="72" height="72" alt="Logo of a telescope observations capability">
  <img src="design/assets/logos/recipes.svg" width="72" height="72" alt="Logo of a recipes capability">
  <br>
  <sub>Four capability logos, each drawn by Recraft from a subject and two colour families a model picked.</sub>
</p>

[See how Aluna works](https://jcospina.github.io/aluna/) · [Open the design system](https://jcospina.github.io/aluna/design/)

## Contents

1. [What is Aluna](#what-is-aluna)
2. [How it works](#how-it-works)
3. [The design system](#the-design-system)
4. [How to run it](#how-to-run-it)
   - [What you need](#what-you-need)
   - [Getting your keys](#getting-your-keys)
   - [Install and start](#install-and-start)
   - [Environment variables](#environment-variables)
   - [Commands](#commands)
   - [Keep it local](#keep-it-local)
5. [License](#license)

## What is Aluna

Aluna starts as a desk with a prompt bar that asks "What would you like to keep track of?" Type *track the books I read* and Aluna narrates the build as it goes: a sketch of the window being made fills in part by part while she says what she is doing ("Tinkering · Kneading the part that adds books."). When it finishes, Books has its own tile on the desk. Its window holds a form for adding a book, a search that ignores accents so *garcia* finds García, and a card for each book in a design the model wrote for books. Aluna calls each of these small apps a capability. You never have to write a schema or a line of code, though the developer panel on the desk shows both as they are written.

Soon after, if Aluna has a Recraft key, that tile gets a logo of its own, drawn by [Recraft](https://www.recraft.ai/) from a subject and two colour families the model chose. Books keeps it through every change that follows.

Every change after that starts the way Books did, with a sentence. Typing *add the date I finished* gives every book a new field, which stays empty on the books you saved before it. Another sentence, *lay my books out as a grid*, turns the list into a grid. Books can hold more than words, too: *add a photo of each cover* gives every book a file field. File fields hold photos, video you can play and seek through, audio, PDFs that open in the browser and Word documents, and one that takes audio records a voice note straight from your microphone.

Not every sentence becomes a change. Aluna declines *move that button 2px right*, since what Books shows is yours to decide, down to a list or a grid, while spacing, colour and fonts are Aluna's call. Asking for *track my books* a second time gets the answer "You already have Books, so I didn't create another one."

Months of reading later, once your books carry finish dates, ask *which Le Guin books did I finish this year?* An answer window opens beside Books. Aluna tells the model to read the names in your author field before it answers, so it can see that the "Ursula K. Le Guin" you typed in March and the "LeGuin" you typed in a hurry are one writer. A title in the answer opens that book when you press it.

Le Guin can have a record of her own. Once you keep Authors, *link each book to its author* turns the author field into a dropdown of your authors. Every book whose author matches a name in Authors, capital letters aside, links on the spot. The hurried "LeGuin" matches no one, so that book keeps its text and gets a mark asking you to pick her from the list. Fix a spelling in Authors and every linked book follows. Her own record lists her books under her details, in the same cards Books uses.

Every version of Books you have seen went live only after it passed the Gate, the checks Aluna runs on the code the model writes for a capability. When a change fails them, the version you were using carries on untouched.

The name is a [Kogi](https://en.wikipedia.org/wiki/Kogi_people) word for the realm of thought from which the material world is born.

## How it works

Aluna splits the work between a fixed platform and a model. The platform puts up the desk, stores records, changes tables, renders forms and runs the Gate. The model writes what belongs to one capability: its fields, the design of its cards, the five handlers that create, read, update, delete and search its records, and the subject and colours of its logo.

A sentence that builds or changes a capability passes three stages:

1. **The resolver** decides what the sentence asks for: a new capability, a change to what one holds or does, a change to how one is presented, a question, a link between two capabilities, or nothing Aluna should act on.
2. **The builder** writes a spec describing the capability, then the behavioural tests when they are switched on, then the code. For a capability you already have, the Diff Engine works out which parts the change touches. Only those are written again, and the rest is copied byte for byte.
3. **The Gate** checks the result on up to four rungs: a structural check, a smoke run on synthetic data, a design lint that rejects anything outside the design system's rules, and the behavioural tests, written from the spec before any code existed. Smoke, design lint and the behavioural tests can each send the code back for a few repair attempts, and a rung that still fails stops the change.

A change that clears the Gate goes live in one SQLite transaction, so it lands whole or not at all. Its code is kept as a new version on disk, beside every version before it.

A question skips the builder and the Gate. The model runs up to ten read-only SQL steps, sees what each one returns, and then writes the answer, and nothing on the desk changes. A request to link two capabilities you already have skips them too: Aluna matches the names you already typed and writes the links in place.

The [architecture deck](https://jcospina.github.io/aluna/) walks through this a slide at a time, from the first sentence on an empty desk to deleting a capability, and each slide opens a deeper view with the detail behind it. Press Present to show it full screen. The whole architecture is in the [architecture document](docs/architecture.md), its vocabulary in [CONTEXT.md](CONTEXT.md), and its decisions in the [architecture decision records](docs/adr/).

## The design system

Aluna looks like a desk on a meadow wallpaper. Every boundary on it is inked to look hand-drawn, so windows, fields and record cards run slightly off true and meet at mitred corners. Each record card's line is seeded from the record itself, so a card keeps its wobble when you move or resize its window.

Every colour in the interface comes from one closed palette called High Meadow, and logo artwork is the one exception. Titles are set in Fraunces and everything a capability generates in Outfit. Only the developer panel uses a monospace face.

The markup a model writes for a record may only use colours from High Meadow and sizes and spacing from the design system's scales. It may not set its own borders, rounded corners, shadows or fonts, because the platform inks every line. The Gate rejects a capability that breaks either rule, so a capability you build today and one you build next month look like they belong on the same desk.

The design system is three working pages, built on the same stylesheets Aluna ships. On the first you can drag and resize a window, press one logo and then another to swap what the window holds, and grow a new capability from the prompt bar, with fixtures and a timer standing in for the model. The second walks every form control through its states, from a long-text field to the voice recorder. The third shows how a capability's logo is put together.

[Open the design system](https://jcospina.github.io/aluna/design/) · [Read the names and rules](design/design-system.md) · [Serve it locally](design/README.md)

## How to run it

Aluna is a research prototype. It does not yet watch how you use a capability and suggest a change, so every change starts with a sentence you type. It keeps your PDFs and Word files but cannot answer a question about what they say, and it turns away photos in HEIC, the iPhone's default format. Every version of a capability stays on disk, but the desk cannot take you back to an earlier one, and there is no dashboard yet for comparing builds over time.

Aluna runs on your own machine, for one person, and is not hosted anywhere. Every build calls an AI provider you pay for, and the code a model writes runs inside the server (see [Keep it local](#keep-it-local)). Your records are stored only on your machine, but a question sends the rows it reads to your AI provider so the model can answer.

### What you need

- [Bun](https://bun.com/docs/installation) 1.3 or newer, and Git
- A C compiler and a SQLite that can load extensions: Aluna compiles a small bridge into SQLite so that search can ignore accents
- An API key from OpenAI, Anthropic or any OpenAI-compatible provider
- A [Recraft](https://www.recraft.ai/docs/api-reference/getting-started) API key, if you want capability logos
- Node.js, only for `bun run mutate`

Aluna is developed on macOS, where Homebrew's SQLite can load extensions:

```sh
brew install sqlite
```

If your SQLite lives outside Homebrew's standard paths, set `OMNI_CRUD_SQLITE_LIBRARY` to its `libsqlite3.dylib`. The matching `sqlite3.h` and `sqlite3ext.h` must sit in the `include` folder beside the library's `lib` folder.

On Linux, install your distribution's C build tools and its SQLite development package, and set `CC` if your compiler is not called `cc`. Nothing tests Aluna on Linux routinely.

### Getting your keys

Put your AI provider's key in `OMNI_API_KEY`. With nothing else set, Aluna calls OpenAI's `gpt-5.6-terra`, so an OpenAI key works on its own. Any other provider needs two more variables beside the key: its endpoint and a model ID that endpoint serves.

```dotenv
OMNI_API_KEY=your-provider-key
OMNI_BASE_URL=https://your-provider-endpoint/v1
OMNI_MODEL=your-model-id
```

Aluna reads the endpoint to choose which API to speak. An endpoint on a subdomain of `openai.com` gets OpenAI's Responses API, and one on a subdomain of `anthropic.com` gets Anthropic's Messages API. Every other endpoint gets OpenAI's Chat Completions API, which DeepSeek, Qwen, GLM, Kimi, MiniMax and many other providers serve.

Logos come from Recraft, which only issues a key once your account holds API units. [Buy a unit package](https://www.recraft.ai/docs/api-reference/pricing) first, then sign in, open the [API page of your profile](https://app.recraft.ai/profile/api) and press **Generate**. A logo costs roughly $0.08, and a failed request is tried at most three times in all. Without the key a capability still builds and works, and keeps its placeholder tile.

Both providers charge per call. While you run `bun run dev`, the developer panel shows each build's token counts, so you can see what your model costs.

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

Do not run Aluna anywhere other people can reach it. The server listens only on `127.0.0.1`. Generated code passes the Gate before it goes live, but it runs inside the server process. The Gate catches a model's mistakes. It is no sandbox against code written to do harm, so it cannot protect a server that strangers can reach.

## License

Aluna is free software under the [GNU Affero General Public License v3.0 only](LICENSE). You may use it commercially, change it and share it. Anyone who distributes it must keep it under the AGPL. Anyone who runs a changed version for users over a network must offer those users its source code at no charge. Keep the license and the copyright notice in [NOTICE](NOTICE).

Third-party dependencies and assets keep their own licenses, including the Outfit and Fraunces font licenses in [design/assets/fonts/](design/assets/fonts/README.md) and the Alpine.js license in [public/vendor/](public/vendor/MIT-Alpine.txt).
