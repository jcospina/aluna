# Writing that carries its weight

The defects in machine-written prose have been measured, and punctuation is not
among them. Across models, LLM text puts fewer ideas into more words, buries
actions inside abstract nouns, and arrives in the same shape whatever it is
about. Repairing that makes prose easier to read. Deleting em dashes does not.

## What the measurements found

Reinhart and colleagues (PNAS, 2025) built matched corpora of human and LLM text
from identical prompts and scored both against Biber's grammatical and
rhetorical features. LLM output carries heavier nominalization, leans on
noun-and-preposition bundles to describe things abstractly, and runs
syntactically more complex, with longer sentences than either student or
published human writing. Its recurring phrase bundles are more rigid than the
human ones. The gap is wider for instruction-tuned models than for base models,
so the training that makes a model helpful also makes it write worse.

Shaib and colleagues set out to measure "slop" directly and landed in the same
place from another angle: low propositional idea density, high templatedness,
verbosity and statements general enough to fit almost any subject.

Two things in training explain much of it. Singhal and colleagues found that the
reward models used in RLHF are easily swayed by length, to the point that a
reward based on length alone reproduces most of what RLHF appears to buy over a
supervised baseline. Kirk and colleagues measured the second: RLHF cuts output
diversity sharply against supervised fine-tuning. Output converges on a narrow
band of the possible range, which is why paragraphs come out the same length,
lists come out the same shape, and the rhythm never changes.

Kobak and colleagues (Science Advances, 2025) tracked excess word frequency
across 15 million PubMed abstracts and found a sharp post-2022 rise in *delve*,
*intricate*, *meticulously*, *realm*, *pivotal* and *showcasing*. Vocabulary is
the smallest of these problems and attracts most of the attention.

## Put the actor in the subject and the action in the verb

Joseph Williams named the central disease: nominalization, which turns a verb
into a noun and then props it up with a weak verb.

> The implementation of the validation of candidate specs occurs during assembly.
>
> The assembler validates candidate specs.

Five words instead of eleven, and the short one says who does it. Nominalization
is among the features the PNAS study measured as distinctive of LLM text.

Hunt for nouns ending in -tion, -ment, -ance and -ing sitting near *is*, *are*,
*occurs*, *provides*, *performs* and *involves*. There is almost always a verb
hiding in one of them.

## Old information first, new information last

Gopen and Swan's finding, from *The Science of Scientific Writing*: readers take
the start of a sentence as context and the end as the point. Meaning is what
readers reconstruct, not what the writer intended, so each piece belongs where
it is expected.

> Because the seed is stored beside the artwork, a retry returns the same drawing.
>
> A retry returns the same drawing, because the seed is stored beside the artwork.

Both are correct English. The second puts the mechanism in the stress position,
which is right when the mechanism is the news. The first is right when the
reader already knows about the seed and the retry behavior is what is new.
Decide which half is news, then put it last.

Paragraphs behave the same way. Open with the link back to what the reader
already has. Close on what you want carried forward.

## Keep the subject next to its verb

Readers hold an unresolved subject in memory until the verb arrives. Gopen and
Swan found that whatever sits in between gets read as an aside, whatever the
writer intended, so an interruption quietly demotes the material inside it.

> The tile, which arrives from the service as a full-bleed square with no mask
> cut into it, is clipped by the shell.
>
> The shell clips the tile, which arrives from the service as a full-bleed
> square with no mask cut into it.

The repair also turns a passive into an active, which is incidental here. Moving
the aside out from between the subject and the verb is the fix, and the voice can
stay passive when the tile is what the passage is about.

## One unit, one point

A sentence, a paragraph and a section should each do one job.

> The shell clips the tile, and a tile that arrives with its own mask already cut
> is rejected.
>
> The shell clips the tile. A tile that arrives with its own mask already cut is
> rejected.

Two rules welded with an *and*. Split apart, each can be found by a reader
looking for it. Joined, the rejection rule sits filed under clipping.

## Concrete beats abstract

Pinker's account of why experts write badly is the curse of knowledge. Once you
know a subject well you stop seeing its physical detail and start naming its
function, so you write "conditions of good acoustic isolation" where you mean "a
quiet room."

This repo has good examples of the cure. "Roughly one generation in four adds a
rounded mask or a frame just inside the edge" beats any sentence about
generation quality being variable. Numbers, names and objects beat categories.

## Cut what can be cut

Orwell's third rule is the one of his six that survives scrutiny: if it is
possible to cut a word out, cut it out. He also named the verbal false limb, a
phrase that replaces a verb with a noun and a helper, as in "make contact with"
for "contact" or "is dependent on" for "depends on." That is nominalization
again, wearing a different coat.

The sentences most worth cutting are the ones that announce, summarize or
admire. Any sentence telling the reader that a passage was careful, important or
worth preserving has spent a line saying nothing.

## Three beliefs that do not hold

The ban on the passive is folklore. Geoffrey Pullum has shown that the people who
repeat it cannot reliably identify a passive, and Strunk and White are among
them: not one pair in their table of corrections actually turns a passive into an
active. Pullum's own count puts about 17% of the transitive verbs in ordinary
prose in the passive, against 26% in Orwell's "Politics and the English
language," the essay that tells you never to use the passive where you can use
the active. The passive is right whenever the affected thing is the topic and the
actor is unknown or beside the point. "The seed is stored beside the artwork" is
correct, because the seed is what the sentence is about.

The belief that AI hedges more than people is backwards, at least as measured.
Jiang and Hyland compared ChatGPT essays with student essays and found the
machine text carried *fewer* hedges, boosters and attitude markers, and fewer of
the moves that address a reader directly. What reads as hedging is usually
refusal to commit to a claim, which is a problem of substance and does not get
fixed by deleting the word "generally."

The belief that shorter is always clearer is a heuristic mistaken for a law.
GOV.UK advises splitting sentences over 25 words and holding paragraphs to five
sentences, which is right for a benefits page read by someone under stress. Prose
built only from short sentences reads as choppy and hides which ideas depend on
which.

## Shape

Uniformity gives the game away because it is what happens when nobody thought
about structure. Paragraphs all four lines long, sections all carrying three
bullets, every list item opening with a bold term and a colon: that is a
template pressed onto content with a different shape.

Prose beats bullets for anything containing an argument, because bullets strip
out the connectives that carry the reasoning. Lists earn their place when items
are genuinely parallel. Tables earn theirs when the data is tabular, and a
two-row table is a sentence.

## Habits to drop

Most of these are ways of claiming something the writing has not established.

The plainest is telling the reader that a thing matters. Four phrases do most of
that work: "marks a pivotal moment," "represents a significant shift," "stands as
a testament to," "contributes to the broader understanding of." Each asserts
importance in place of demonstrating it, and each survives transplanting into any
subject at all, which is the tell. Stacking credentials onto a claim does the
same job: "widely regarded," "profiled in multiple independent outlets," "has
received considerable attention." So does the participle clause bolted onto a
finished sentence, as in "...further enhancing its significance as a hub of
activity" or "...highlighting the collaborative nature of the work." When such a
clause states a fact, give it a verb of its own. When it awards importance,
delete it.

Attribution is the other thing routinely faked. "Experts argue," "industry
reports suggest," "it is widely considered" and "observers have noted" name
nobody. Watch for one source inflated into several, and for lists implied to be
partial when nothing supports that.

Three shapes get pressed onto content that does not have them. The manufactured
contrast invents an opposition so a plain statement sounds like a finding: "not
just X, but Y," "it is not X, it is Y," and the reversed "X rather than Y." Keep
only the ones where the reader needs the rejected alternative. The
challenges-and-prospects ending gets filled in whether or not anything is known
about either half: "Despite its success, it faces challenges including... Future
developments may include..." And the triad implies a completeness the content
rarely has, whether it is adjectives or clauses. Three is fine when there are
three.

Two habits work at the level of the word. Cut brochure vocabulary: *vibrant*,
*rich*, *nestled*, *seamless*, *groundbreaking*, *robust*, *comprehensive*, *a
commitment to*. And write *is* and *has* rather than *serves as*, *stands as*,
*functions as*, *features*, *offers* or *boasts*, which buy syllables and a faint
smell of marketing.

Repetition is not a fault. Reaching for a synonym every time a term recurs makes
a specification unusable, because one subject collects three names in a paragraph
and the reader cannot tell whether three things are under discussion or one. Call
the same thing the same thing.

The rest are mechanical:

- Set headings in sentence case, and do not skip heading levels.
- Use straight quotes and apostrophes.
- Put no horizontal rule above a heading.
- Keep emoji out of prose.
- Check for unfilled placeholders before shipping.

Say nothing to the reader about the writing. No "I hope this helps," no paragraph
announcing what the next section covers, no "as of my last update," no "while
specific details are limited." That last one is usually a guess dressed as a
caveat: when the information was not found, say what was searched and what came
back.

## The editing loop

Read it aloud. Empty sentences and broken rhythm are audible before they are
visible.

For each paragraph, ask what it gives the reader that the one before it did not.
Delete it when the answer is nothing.

Then the part that got the first version of this document thrown out: counting
symptoms is not editing. A paragraph scrubbed of every em dash, every "rather
than" and every word on a banned list can still be four sentences of nothing.
Fix what it says. The shape follows.

## Sources

- [Do LLMs write like humans? Variation in grammatical and rhetorical styles](https://www.pnas.org/doi/10.1073/pnas.2422455122), Reinhart et al., PNAS 2025
- [Delving into LLM-assisted writing in biomedical publications through excess vocabulary](https://www.science.org/doi/10.1126/sciadv.adt3813), Kobak et al., Science Advances 2025
- [Measuring AI "Slop" in Text](https://arxiv.org/abs/2509.19163), Shaib, Chakrabarty, Garcia-Olano and Wallace, 2025
- [A Long Way to Go: Investigating Length Correlations in RLHF](https://arxiv.org/abs/2310.03716), Singhal, Goyal, Xu and Durrett, 2023
- [Understanding the Effects of RLHF on LLM Generalisation and Diversity](https://arxiv.org/abs/2310.06452), Kirk et al., ICLR 2024
- [Rhetorical distinctions: Comparing metadiscourse in essays by ChatGPT and students](https://www.sciencedirect.com/science/article/abs/pii/S0889490625000134), Jiang and Hyland, *English for Specific Purposes* 79, 2025
- The Science of Scientific Writing, Gopen and Swan, *American Scientist* 78 (1990), [copy online](https://www.crowl.org/Lawrence/writing/GopenSwan90.html)
- Joseph Williams, *Style: Lessons in Clarity and Grace*
- Steven Pinker, *The Sense of Style*, on the curse of knowledge
- [Fear and Loathing of the English Passive](https://pullum.ppls.ed.ac.uk/passive_loathing.pdf), Geoffrey Pullum
- [GOV.UK: use clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)
- [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), Wikipedia, for the symptom catalogue
