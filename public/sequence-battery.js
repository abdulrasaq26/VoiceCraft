// Sequence Battery — does a run of beats read as a story or as a list?
//
// Every battery before this one measured single frames: is this beat legible,
// is that beat distinct from its neighbour. That was the right question while
// the systems under test described single moments.
//
// Time and Causality do not. They are the first two systems that make a claim
// ACROSS beats — this moment faces that one, this beat happened because that
// one did — and a single-frame battery cannot see them at all.
//
// So the question changes to: does the ORDER of the beats matter?
//
// That is the whole test, and it carries its own control. If a narration and
// a shuffled copy of the same narration produce the same pictures, then no
// cross-beat system is doing anything, whatever the traces say. A story whose
// frames survive shuffling is a list.
//
// Three numbers per story:
//
//   coverage      beats carrying a cross-beat annotation (horizon or cause).
//                 The dormancy check at corpus scale: a system that never
//                 fires on real prose is not implemented, it is decorative.
//   movement      mean pixel difference between consecutive frames. Low means
//                 the run collapsed into one picture, which is the failure the
//                 25-scene battery started with.
//   orderEffect   how much the frame set changes when the sentences are
//                 shuffled. This is the one that matters.
//
// Run from the console: BlvckSeqBattery.run().
//
// ==========================================================================
// EVERY DIRECTOR NUMBER BELOW IS PROVISIONAL. READ THIS FIRST.
// ==========================================================================
//
// All of them were produced under a prompt-delivery bug. BlvckPrompts.build()
// returns {system, user}; chat() had no branch for that shape and sent
// JSON.stringify({system, user}) as a single user message. The planner never
// received a system prompt — it received a JSON blob and had to dig its
// instructions out of an escaped string. Fixed in ai-provider.js.
//
// The correct status is PROVISIONAL UNTIL REPLICATED, not invalid. These runs
// measured something real; they measured a planner working under a handicap,
// and which conclusions depended on the handicap is an open question rather
// than a settled one. A guess at what survives, recorded now so it can be
// wrong later:
//
//   likely to replicate    efficiency near 1.00, delivery not the bottleneck,
//                          keyword-arm figures (no model involved at all),
//                          Director coverage and payload UP vs keywords
//   likely to change       entropy 0.34, prevalence collapse, objects+support
//                          dominance, the 15-of-16 signature, purity 0.70
//   unaffected             everything measured with useDirector:false
//
// The bread finding is the one to watch. The ontology ceiling was real —
// eight desk objects cannot express a kitchen whatever the prompt — but
// `book` for "the dough rested" may have been the blob rather than the
// vocabulary, and those are different diagnoses with different fixes.
//
// Replicate before quoting: bread and photosynthesis first, then run(), then
// compare(). Do not regenerate the study fixture until that is done, or the
// stimuli freeze a planner that was being prompted incorrectly.
//
// TENTH RUN — the replication. Done. valid: true, purity 0.80, selfTest
// passed, 0 failovers, 1767s, meta/llama-3.3-70b-instruct. Same corpus, same
// model, same metrics as run nine; the only change is that the Director now
// receives its prompt as a prompt and the narration as narration.
//
//   GENERAL (30 beats)        run 9 (bug)   run 10 (fixed)
//     producerPayload         0.03 -> 1.03   0.03 -> 1.20
//     expressive               1/30 -> 16     1/30 -> 27
//     entropy                 0.00 -> 0.34   0.00 -> 1.12
//     combinations               1 -> 2         1 -> 3
//     dominance               1.00 -> 0.94   1.00 -> 0.63
//     no-actor                  17 -> 5        17 -> 0
//     purity                        0.67           1.00
//
//   TEMPORAL (20 beats)
//     producerPayload         0.70 -> 1.65   0.70 -> 1.25
//     expressive               7/20 -> 15     7/20 -> 12
//     entropy                 1.95 -> 2.21   1.95 -> 2.86
//     combinations               4 -> 6         4 -> 8
//     dominance               0.29 -> 0.40   0.29 -> 0.25
//     purity                        0.75           0.50
//
//   efficiency 1.00 in every arm of both sets, both runs.
//
// FALSIFIED — THE ENTROPY COLLAPSE WAS THE BUG. Run nine found the Director
// raising coverage sixteenfold on general prose while producing two
// combinations and dominance 0.94: fifteen of sixteen expressive beats the
// identical `objects+support`. That was read here as a real property, named
// "the general gain is monotonous", built into a two-stage model separating
// discovery from representation, and used to argue the bottleneck had moved.
//
// It was a model improvising from an empty narration. Given the sentences,
// entropy triples, combinations rise 2 -> 3, dominance falls to 0.63 and
// no-actor goes to ZERO — every one of thirty general beats now finds a
// human subject. Coverage and diversity rose TOGETHER, which is exactly what
// the two-stage split said did not happen. That model is withdrawn.
//
// SURVIVED. Every one of these held across the change:
//   efficiency 1.00 and unused 0.00 — delivery is not the bottleneck for
//     representable information, now shown under two implementations
//   the Director beats keyword discovery by a wide margin
//   the gain is LARGEST where keywords fail most — general 0.03 -> 1.20 is
//     a 40x lift against temporal's 1.8x
//   the arms converge: keyword payload spans 23x across the corpora,
//     Director payload now spans 1.04x (1.20 vs 1.25), tighter than before
//   the keyword arm is bit-identical, as it must be — no model involved
//
// CHANGED WITHOUT BEING WRONG. Temporal payload FELL, 1.65 -> 1.25, while
// its entropy rose 2.21 -> 2.86 and its combinations 6 -> 8. Fewer objects,
// more distinct arrangements. The old figure was partly invention; a planner
// with nothing to go on emits plausible furniture, and that counts as payload
// under a metric that measures presence rather than correctness.
//
// CAVEAT, and it is the weakest part of this run: temporal purity is 0.50 —
// half those beats fell back to keywords, against 1.00 on general. The
// temporal deltas rest on ten staged beats. The general set is the solid
// half of this table.
//
// --- how to write down what this returns ---------------------------------
//
// Three summaries in this file have had to be narrowed after the fact, and
// they failed the same way:
//
//   written                              supported
//   no dormancy anywhere                 none among the TRACED channels on
//                                        THIS corpus
//   the intent -> metaphor link is dead  on THIS corpus, no live goal
//                                        produced a rendered metaphor
//   the Director extracts more           a producer that is 75% DIRECTOR,
//                                        on THIS corpus, with THIS model,
//                                        extracted more
//
// Every correction moved the same direction: from a property of the ENGINE
// to a property of the RUN. Not one of the numbers was wrong. The error was
// always one layer above them, in the sentence that generalised them — and
// that sentence is the part that gets quoted six months later, long after
// the run behind it is forgotten.
//
// So, the rule:
//
//   EVERY DECLARATIVE CONCLUSION CARRIES ITS CONDITIONING, unless the claim
//   has been demonstrated across multiple independent runs.
//
// A summary sentence should answer, without being asked: on which corpus?
// under which producer? with which model? over how many runs? at what
// purity? If it does not, it is claiming more than the run established.
//
// This applies to the perceptual results too, when they exist. "Director
// images are more legible" will be the tempting sentence and the wrong one;
// "on this corpus, with these participants and this renderer, images from
// the 75%-Director producer were recognised more accurately" is the one the
// study can actually support.
//
// FIRST RUN — the baseline this instrument exists to be measured against.
// Append later runs, do not edit these.
//
//   story        beats  coverage  links  movement  orderEffect
//   redundancy     5      0.20      0      1.32%      0.40
//   diagnosis      5      0.60      0      1.15%      0.20
//   startup        5      0.40      0      0.27%      0.00
//   plain          5      0.00      0      0.00%      0.00
//
// The control behaved: `plain` scored zero coverage, which is correct, and
// zero movement, which is not — five beats of descriptive prose rendered as
// five identical frames.
//
// Three results, worst first.
//
// LINKS ZERO EVERYWHERE, including two stories carrying explicit markers.
// The link is found — readCause returns "As a result", cause 3.6-7.54,
// effect 7.6-12.34, and the cause SCENE is located correctly. It fails at
// the last step, because residue carries the cause's OBJECTS and the cause
// beat has none. Causality renders only when the causing beat happens to
// contain props. The isolated test that proved it used "He signed the
// letter of resignation" — a sentence chosen, without my noticing, for
// having objects in it. A passing test selected for the case that passes.
//
// MOVEMENT UNDER 1.4% EVERYWHERE. Consecutive frames are ~99% identical.
// Whatever legibility single beats have, a run of them is close to static.
//
// 35% OF BEATS HAVE ANY DIFFERENTIATOR. Across 20 beats: 4 with objects,
// 6 with a horizon, 2 with support, 1 interaction, 1 anchor, 0 metaphors —
// 7 beats total carry anything at all, and 13 carry nothing. The cross-beat
// systems are no longer the bottleneck. Per-beat content is.
//
// SECOND RUN — information flow, same corpus, same code path.
//
//   story        payload  delivered  eff.  unused  persistence (base)
//   redundancy     0.60     0.60     1.00   0.00     0.00  (3)
//   diagnosis      1.40     1.40     1.00   0.00     0.50  (6)
//   startup        0.80     0.80     1.00   0.00     1.00  (2)
//   plain          0.00     0.00      —      —        —    (0)
//   -------------------------------------------------------------------
//   corpus         0.70     0.70     1.00   0.00     0.45  (11)
//
//   selfTest()     chair -> eff 1.00 / unused 0.00
//                  hammock -> eff 0.00 / unused 1.00      pass
//
// THIRD RUN — why the empty beats were empty. staging: keywords (20/20).
//
//   reason         beats     what it means
//   no-actor         7       no person referenced; description or place
//   intent-only      3       a goal is live and produced no metaphor
//   keyword-miss     3       a person is present and nothing matched
//   state-only       0       state moved with no channel to carry it
//   ----------------------------------------------------------------
//   empty           13       of 20
//
// The largest bucket is not the one the roadmap assumed. `keyword-miss` —
// the bucket the Director is expected to empty — is 3 beats. `no-actor` is
// 7, more than half the loss, and those are sentences like "Gulls circled
// above the awnings" and "Traders set out crates of fish along the wet
// stone". A better scene-plan does not obviously help a beat with no person
// in it; those need a place-and-object vocabulary, which is a different
// piece of work from replacing keyword discovery.
//
// Caveat that belongs next to every number above: staging is `keywords` for
// all 20 beats. This is keyword-only bandwidth. What the Director would add
// is exactly the unmeasured quantity, and the figure is named
// producerPayload rather than payload so it cannot be quoted without it.
//
// FOURTH RUN — compare(), the A/B. NOT A RESULT. valid: false.
//
//   producer      keywords: {keywords:20}   director: {keywords:20}
//   producerPayload   0.70 / 0.70
//   every bucket delta 0
//
// The B arm never reached a model. The AI gateway returns "AI Gateway
// request failed", attachState caught it and fell back to keyword staging,
// and the run completed successfully with every number identical.
//
// Read without the guard, that table says the Director contributes nothing
// to discovery — a strong, quotable, entirely false conclusion produced by
// an outage. `valid` is false because staging never reported `director` for
// a single beat, and the comparison refuses to be a finding.
//
// This is the same failure the session hit repeatedly in another form: an
// instrument agreeing with a hypothesis for a reason unrelated to the
// hypothesis. The A/B is built and its keyword arm is validated. The
// Director arm is blocked on credentials, not on code.
//
// FIFTH RUN — channel diversity, keyword staging.
//
//   entropy 1.95 bits · combinations 4 · dominance 0.29 · base 7
//
//   anchors+interaction        1
//   horizon                    2
//   horizon+objects            2
//   horizon+objects+support    2
//
// This did not say what it was expected to say. The worry entropy was added
// to catch — one combination firing over and over while payload rises — is
// not what is happening. Maximum entropy for four combinations is 2.00 bits
// and the corpus sits at 1.95 with a dominance of 0.29, which is close to
// uniform. Among the beats that express anything, the engine is already
// varied.
//
// The problem is the base: 7 of 20. Not monotony among firing beats, but
// how few fire. That is a different diagnosis from the one entropy was
// meant to test for, and it is the same conclusion producerPayload reached
// by another route — which is worth something, since the two numbers are
// computed from different properties of the same run.
//
// One observation the distribution hands over for free: `horizon` appears
// in 6 of the 7 expressive beats. Time — the newest system, and one of the
// two built in this session — is carrying nearly all of the expressiveness
// in this corpus. Read carefully. It may mean temporal language is common
// in narration, or only that these four stories are full of it.
//
// Base 7 is small and entropy estimates are biased low on small samples.
// The figure travels with its base for that reason.
//
// SIXTH RUN — channel prevalence, keyword staging, base 7.
//
//   channel        beats   share
//   horizon          6      0.86
//   objects          4      0.57
//   support          2      0.29
//   interaction      1      0.14
//   anchors          1      0.14
//   metaphor         0      0.00
//   residue          0      0.00
//
// Entropy could not have found this. It scores how evenly the SIGNATURES
// are spread, and {horizon}, {horizon,objects}, {horizon,objects,support}
// are three distinct combinations with near-maximal entropy and the same
// channel in all three. 1.95 bits and one channel in 86% of expressive
// beats are both true at once. The two numbers are not redundant.
//
// METAPHOR AT 0.00 IS THE FINDING. Not a low share — no beat in the corpus
// carries a metaphor at all, while the reason histogram independently
// reports `intent-only` three times. Stated exactly:
//
//   ON THIS CORPUS, UNDER KEYWORD STAGING, NO BEAT CARRYING A LIVE GOAL
//   PRODUCED A RENDERED METAPHOR.
//
// Not "the intent -> metaphor link is dead", which is what the first draft
// of this note said and is a claim about the engine rather than about the
// run. The measurements localise a SYMPTOM. At least five causes remain
// distinguishable and none is ruled out:
//
//   1 metaphor inference ran and found nothing
//   2 metaphor inference ran and legitimately selected none
//   3 inference produced one and the compositor suppressed it
//   4 the Director was unavailable, and metaphor depends on it
//   5 the corpus contains no situation that crosses the threshold
//
// Cause 5 in particular would make this not a defect at all. Four stories
// chosen to vary temporal and causal language are not a sample designed to
// contain goals.
//
// The cheapest next probe is already in the code and costs no new metric:
// the compositor writes `trace.metaphorSuppressed`, which separates 3 from
// 1 and 2 outright. Left unrun deliberately — chasing it is work on the
// keyword-only path, and that is the path the two remaining experiments
// exist to evaluate rather than optimise. Recorded here so the next person
// starts from a narrowed question instead of rediscovering the symptom.
//
// What makes this worth writing down at all is that neither instrument
// found it alone. 0.00 reads as a channel with nothing to say; three beats
// reads as a small bucket. The pair is what localises anything — which is
// the argument for carrying several cheap metrics over one good one.
//
// SEVENTH RUN — the Director A/B. valid: true. This one is a result.
//
// WHAT THE ARMS ACTUALLY ARE, before any number below is read. The B arm is
// not the Director. 5 of its 20 beats fell back to keyword staging, so the
// comparison is
//
//   keywords   vs   (75% Director + 25% keywords)
//
// not keywords vs Director. purity: keywords 1.00, director 0.75.
// Every delta here is the effect of a MIXTURE.
// The pure-Director effect is probably larger than what is reported —
// a quarter of the B arm is the A arm — but that is an inference, not a
// measurement, and nothing here measures it. `valid` only checks that the
// condition was present at all; it does not check that it was pure, and
// this run is the reason to know the difference.
//
// Model: meta/llama-3.3-70b-instruct via NVIDIA NIM. 384s, no failovers.
//
//                    keywords   director
//   producerPayload     0.70      1.60     +129%
//   expressive base     7/20     14/20
//   efficiency          1.00      1.00     unchanged
//   persistence         0.45      0.68
//   entropy             1.95      1.92     unchanged
//   combinations           4         5
//   dominance           0.29      0.50
//
//   reason           keywords  director  delta
//   no-actor              7        2      -5
//   intent-only           3        1      -2
//   keyword-miss          3        2      -1
//   state-only            0        1      +1
//
//   channel        keywords  director  delta
//   objects           0.57     0.93    +0.36
//   support           0.29     0.79    +0.50
//   horizon           0.86     0.43    -0.43
//   interaction       0.14     0.07    -0.07
//   anchors           0.14     0.07    -0.07
//   metaphor          0.00     0.00     0.00
//   residue           0.00     0.00     0.00
//
// PAYLOAD MORE THAN DOUBLED AND ENTROPY DID NOT MOVE. That was the
// prediction made before the run — payload up, coverage up, entropy flat —
// and it is what happened, to two decimal places.
//
// Stated to match the data: MOST OF THE GAIN CAME FROM FIRING EXISTING
// COMBINATIONS MORE OFTEN RATHER THAN FROM SUBSTANTIALLY EXPANDING THE
// COMBINATION SPACE. Not "without opening combinations keywords could not
// reach", which was the first phrasing here and is contradicted by the
// table one screen up: combinations went 4 -> 5. One did open. The
// supported claim is about proportion, not absence — the base doubled, one
// combination was added, and dominance rose 0.29 -> 0.50, which is what
// concentration looks like.
//
// THE BUCKET THAT SHRANK MOST WAS THE ONE PREDICTED NOT TO. `no-actor` fell
// 7 -> 2, `keyword-miss` only 3 -> 2. The expectation was the reverse: that
// a scene-plan would read existing actors better and leave actorless beats
// alone. It does the opposite here — it finds subjects in prose the pronoun
// test called subjectless, which is why `no-actor` was marked medium
// confidence rather than high. That caveat earned its place.
//
// EFFICIENCY HELD AT 1.00 ACROSS A DOUBLING OF PAYLOAD. Twice the extracted
// information, all of it still reaching pixels. The renderer absorbed the
// increase without a single dropped channel — the strongest evidence yet
// that delivery is not the constraint.
//
// WHAT THE DIRECTOR DOES NOT FIX: metaphor 0.00 and residue 0.00, both
// unchanged. That rules out the producer as the cause — metaphor does not
// fire under either staging, so keyword discovery was not suppressing it
// and the Director does not supply it. Four explanations survive and the
// run separates none of them:
//
//   the scene-plan never emits a metaphor
//   attachState never consumes the one it emits
//   the compositor suppresses it
//   the corpus contains no situation that produces one
//
// Narrower than before by one, and still a symptom rather than a cause.
// trace.metaphorSuppressed remains the cheapest next probe and would
// separate the third from the first two in a single run.
//
// Causality still carries nothing: residue 0.00 in both arms, which is
// consistent with the known cause — it carries objects the causing beats
// do not have — and is not further evidence about it.
//
// horizon FELL 0.86 -> 0.43. Not a regression in Time: the expressive base
// doubled from 7 to 14, and horizon holds 6 beats either way. It was 86% of
// a small set and is 43% of a larger one. A share whose denominator moved.
//
// Caveats beyond the mixture stated at the top: one model, one corpus,
// four stories, a single run with no repeats, and no variance estimate —
// nothing here distinguishes a real +129% from a large one plus noise.
// Llama 3.3 70B is not a frontier model and these numbers will not
// transfer to one.
//
// The supported conclusion, in full:
//
//   On this corpus, with this model, a producer that is three-quarters
//   Director extracts substantially more information than keyword
//   discovery, and the existing renderer delivers all of it.
//
// Everything past that sentence is inference.
//
// EIGHTH RUN — the corpus doubled. Keyword staging, purity 1.00.
//
//                    temporal   general    pooled
//   stories              4          6         10
//   beats               20         30         50
//   producerPayload   0.70       0.03       0.30
//   expressive base   7/20       1/30       8/50
//   efficiency        1.00       1.00       1.00
//   unused            0.00       0.00       0.00
//   entropy           1.95       0.00       2.25
//   horizon prev      0.86       0.00       0.75
//   objects prev      0.57       1.00       0.63
//
//   per story (general): photosynthesis 0.00 · bread 0.00 · bridge 0.00
//                        quarter 0.00 · apology 0.20 · inflation 0.00
//
// 0.70 IS NOT AN INTRINSIC PROPERTY OF THE PRODUCER — it depends strongly
// on the corpus. Not "a property of the corpus, not the producer", which
// was the first phrasing and trades one unsupported attribution for
// another. Producer and corpus INTERACT, and this run does not separate
// their contributions: it varies the corpus while holding the producer
// fixed, so it can show dependence and cannot apportion it. On six stories
// written without a detector in mind, keyword discovery extracts 0.03
// channels per beat and one beat in thirty says anything at all. The
// figure quoted through seven runs — and conditioned carefully on producer,
// model, purity and run count — was measured on four stories I wrote to
// exercise the systems being measured. The conditioning that mattered most
// was the one nobody thought to state.
//
// `bread` is the case worth staring at: five sentences about flour, a bowl,
// a counter, an oven and a loaf, and it produces nothing. Not an abstract
// beat, not an actorless one — a person doing physical things to objects,
// which is the case object inference exists for.
//
// HORIZON AT 0.86 WAS ENTIRELY SELECTION. It is 0.00 across all thirty
// general beats. Time is not carrying the engine; Time was carrying a
// corpus built to contain remembering and waiting. The suspicion was
// recorded when the number first appeared and it was correct.
//
// WHAT SURVIVED THE CHANGE OF CORPUS: efficiency 1.00 and unused 0.00, on a
// corpus twenty-three times poorer. Delivery is not the bottleneck FOR
// REPRESENTABLE INFORMATION — the qualification matters and was missing
// here for six runs; see the bread note below, where the renderer delivered
// everything it was given and was not given the right concepts — and
// that now holds across two samples selected on different principles —
// which is the first claim here with any external validity at all.
//
// `state-only` appears for the first time: 5 beats, all in the general set,
// where state moved and no channel carried it. It read 0 on the temporal
// corpus and was noted as "not currently a bottleneck". It was absent, not
// unimportant.
//
// The A/B's +129% is now suspect in the direction of being far too small.
// It was measured on the temporal set, where the keyword baseline is
// twenty-three times its general value. A rerun across both sets is the
// obvious next experiment and costs roughly 40 model calls.
//
// NINTH RUN — the Director across two corpora. valid: true, purity 0.70
// (35 of 50 beats director-staged). 2400s, 20 calls, no failovers,
// meta/llama-3.3-70b-instruct. Reported per set; pooled is a summary of
// these two and not a substitute for them.
//
//   TEMPORAL (20 beats, director purity 0.75)
//                     keywords  director
//     producerPayload    0.70     1.65     x2.4
//     expressive         7/20    15/20
//     efficiency         1.00     1.00
//     persistence        0.45     0.71
//     entropy            1.95     2.21
//     combinations          4        6
//
//   GENERAL (30 beats, director purity 0.67)
//                     keywords  director
//     producerPayload    0.03     1.03     x34
//     expressive         1/30    16/30
//     efficiency         1.00     1.00
//     persistence        0.00     0.88
//     entropy            0.00     0.34
//     combinations          1        2
//
// ON THESE TWO CORPORA, THE DIRECTOR SUBSTANTIALLY RECOVERS INFORMATION
// THAT KEYWORD DISCOVERY LARGELY MISSES. Not "the Director recovers
// ordinary narration", which was the first heading here and promotes one
// thirty-beat corpus into a category. The gain is LARGEST exactly where
// keyword discovery failed most — 34x on the general set against 2.4x on
// the set written to suit keywords — and that is a statement about these
// fifty beats.
//
// The two arms converge. Keyword payload spans 23x across the corpora
// (0.03 to 0.70); Director payload spans 1.6x (1.03 to 1.65). Most of the
// corpus-dependence measured in the eighth run is a property of KEYWORD
// discovery, not of the engine. That is the strongest single result in
// this file, because it was obtained by varying the thing that was
// suspected rather than by arguing about it.
//
// `bread` DID NOT PASS, and the note that said it did was wrong.
//
// "The Director gets flour, bowl, oven and loaf" was written from payload
// rising on the general set. Payload is a count. Looking at what was
// actually extracted:
//
//   mixed flour, water and salt in a bowl   ->  nothing
//   the dough rested on the counter         ->  book
//   she folded it over itself               ->  laptop, paper
//   the oven heated, the loaf proved        ->  pencil, paper
//   it came out dark and hollow-sounding    ->  clock
//
// Office supplies, laid over a baking story. Not one of flour, bowl, dough,
// oven, loaf or basket, because none of them exists to be drawn: the
// renderer knows thirteen objects — paper, crumpled, pencil, laptop, cup,
// book, phone, suitcase, box, trophy, mic, fire, clock — and the Director is
// handed eight of them as a closed list. Asked to depict a kitchen from a
// vocabulary of desk objects it returns a book, which is the best available
// answer and still the wrong picture.
//
// EVERY METRIC IN THIS FILE SCORED THAT AS A SUCCESS. payload up, efficiency
// 1.00, unused 0.00, prevalence objects 1.00. A book drawn for "the dough
// rested on the counter" is a channel extracted and a channel delivered.
//
// Which names a limitation none of these numbers has ever stated: THEY
// MEASURE PRESENCE, NOT CORRECTNESS. Whether a channel fired, never whether
// what it says is true of the sentence. The arithmetic in every run above
// stands; the reading of it does not, wherever it was taken to mean the
// frames were RIGHT rather than merely populated.
//
// THE FAILURE IS SYSTEMATIC, NOT ERRATIC, and that is what makes it useful.
// The model was not confused about baking. It was optimising against the
// ontology it was handed, in which `flour` has no legal representation and
// `book` may genuinely be the best available answer. Any model constrained
// to this vocabulary can be forced into a semantically wrong substitution;
// this is a property of the ontology and not of the model that ran, and the
// claim is written that way deliberately — no frontier model has been run on
// the baking story, so nothing here licenses a statement about one.
//
// A THIRD STAGE, which the two-stage split above did not have:
//
//   discovery            does the producer find anything          measured
//   semantic grounding   does what it found mean the sentence     NOT measured
//   delivery             does it reach pixels                     measured
//
// Everything in this file — payload, efficiency, entropy, prevalence — lives
// on either side of the middle row and never in it. The renderer faithfully
// drew the wrong object, so the renderer is still not the constraint and
// discovery is no longer the whole of it. What sits between them is the
// mapping from story concepts into an ontology that can hold them.
//
// It also moves the ceiling a third time. Discovery was the bottleneck until
// the Director doubled it; representation diversity looked like it after
// entropy collapsed; underneath both is a closed vocabulary of thirteen desk
// objects, which caps what any producer can say and explains the collapse —
// everything maps onto the same small set because there is nothing else to
// map onto.
//
// DO NOT EXPAND THE ONTOLOGY BEFORE THE STUDY RUNS. Adding bowl, oven, loaf
// and basket would certainly fix `bread`, and would erase the only clean
// evidence of WHY it failed. Run the study against this version first: if
// participants fail the baking story while succeeding elsewhere, that is a
// demonstration that semantic fidelity rather than information flow is the
// limiting factor, and it is a far stronger argument for the work than
// somebody observing that a book looks wrong in a kitchen.
//
// The study measures this and the battery cannot, which is the second
// independent reason to run it. A viewer shown a book for "the dough rested"
// picks the wrong sentence — no new automated proxy needed, because the
// question "which sentence does this frame show" already IS the semantic
// fidelity question asked of the only judge that can answer it.
//
// BUT THE GENERAL GAIN IS MONOTONOUS. entropy 0.34, 2 combinations across
// 16 expressive beats, dominance 0.94 — fifteen of them are the identical
// signature `objects+support` and one is `objects`. Prevalence says the
// same thing from the other side: objects 1.00, support 0.94, and every
// other channel 0.00. On general prose the Director finds a person and a
// thing to sit on, fifteen times.
//
// This is the failure mode entropy was built to catch and did not find in
// run five. It exists — it was simply in a condition not yet run. Coverage
// and variety are separate axes and the Director moves them separately:
// on `temporal` it raised both (entropy 1.95 -> 2.21, 4 -> 6 combinations),
// on `general` it raised coverage sixteenfold and variety barely at all.
//
// TWO-STAGE RECOVERY, and it relocates the bottleneck. The pipeline used to
// read as one funnel with discovery at the top. These two sets separate it:
//
//   temporal   discovery UP, diversity UP
//   general    discovery UP, diversity FLAT
//
// If discovery and representation moved together they would be one stage.
// They do not, so they are two, and the constraint has moved from WHETHER
// the engine finds something to HOW MANY QUALITATIVELY DIFFERENT WAYS it
// can say what it found.
//
// DO NOT ENGINEER AGAINST THIS NUMBER YET. The obvious response is to make
// the Director emit more horizons, metaphors and interactions, which would
// raise entropy by construction and prove nothing — a channel forced to
// fire is not a channel that had something to say, and this metric would
// applaud either one. Entropy is a diagnostic, and it becomes a target the
// moment it is optimised against.
//
// The prior question is perceptual and is not answerable from here: are
// sixteen mostly-identical `objects+support` frames more understandable
// than sixteen blank ones? If they are, low entropy is an acceptable
// property of this class of prose rather than a defect. If they are not,
// the bottleneck above is confirmed and worth engineering against. The
// blind study decides which, and until it runs, raising entropy is an
// intervention with no established direction.
//
// That study now exists in the form this result requires. /study.html
// renders this same corpus through both producers and asks a viewer which
// sentence each frame depicts, with the wrong answers drawn mostly from the
// SAME story — because within-story confusion is this entropy number
// restated as something a person can be wrong about. Stimuli are frozen in
// study-fixture.json so every participant judges identical pictures.
//
// Four of the ten stories fell back to keyword staging when the fixture was
// captured, which the study keeps as a null condition: both arms render the
// same picture there, so the measured gap between them is noise and sets
// the bar a real difference has to clear.
//
// EFFICIENCY HELD AT 1.00 IN BOTH ARMS OF BOTH SETS, across a 34x change in
// payload. Delivery of REPRESENTABLE information has now survived every
// condition this instrument can produce — which is a narrower claim than it
// reads, since the instrument cannot tell a correct object from a legal one.
//
// horizon fell 0.86 -> 0.40 on temporal and stayed 0.00 on general, which
// is consistent with the eighth run: Time answers to the corpus, not to
// the producer.
//
// Caveats unchanged and now more load-bearing: one model, one run, no
// repeats, no variance estimate, purity 0.70. Both arms are mixtures.
//
// residue at 0.00 is the already-known consequence of Causality carrying
// objects the causing beats do not have.
//
// PAYLOAD 0.70 CHANNELS PER BEAT. Not "35% of beats have something" but the
// sharper form: the average beat yields two thirds of one channel. Seven
// channels exist in the engine and a typical sentence lights none of them.
//
// DELIVERED EQUALS PAYLOAD, AND UNUSED IS ZERO. Every channel the producer
// extracted reached pixels. That number is only worth stating because the
// detector was given a negative control: support 'chair' traces drawn:true,
// support 'hammock' — a name with no drawing behind it — traces drawn:false.
// The detector can see a dead channel, so its silence means there was none
// to see.
//
// Stated exactly: NO DORMANCY AMONG THE TRACED CHANNELS ON THIS CORPUS. Not
// "no dormancy", which is what the first draft of this note claimed and what
// the data do not support. Seven channels are traced; anything the engine
// gains later is invisible here until it is added to CHANNELS, and four
// stories are a corpus, not a population. The narrow claim survives a future
// integration change. The broad one would have been quietly falsified by it
// and gone on being quoted.
//
// This is the first battery where the renderer was NOT at fault. Everything
// handed to it was drawn — which says nothing about whether the right thing
// was handed to it, a distinction this file did not draw until `bread` forced
// it. The loss measured here is upstream — and the two numbers
// separate cleanly: throughput is solved, bandwidth is not.
//
// PERSISTENCE 0.45 OVER A BASE OF 11. Under half of what one beat knows is
// still known by the next. Per-story persistence is not worth quoting:
// `startup` scored 1.00 off a single adjacent pair, which reads as perfect
// continuity and means two consecutive beats both had a horizon. Ratios are
// reported with their denominators now, and null rather than zero when there
// is nothing to divide, because that 1.00 was on its way into a summary.
(() => {
  'use strict';

  // TWO SETS, kept apart on purpose.
  //
  // `temporal` is the original four. They were written to exercise Time and
  // Causality, which means they are full of remembering, waiting and because
  // — and every number from runs one to seven came off them. That shows: the
  // `horizon` channel appeared in 86% of expressive beats, which reads as a
  // fact about the engine and may be a fact about the sample. A corpus chosen
  // to contain temporal language will find temporal language.
  //
  // `general` is six stories across the kinds of narration this product is
  // actually pointed at — an explainer, a process, a piece of history, a
  // business account, an interpersonal scene, a piece of abstract exposition.
  // None was written with a detector in mind.
  //
  // The old set is not replaced, because seven runs of recorded baselines are
  // only comparable against the corpus that produced them. Results are
  // reported per set and pooled.
  //
  // One bias this does not remove: I wrote both sets, and I know what the
  // detectors look for. Genuinely external prose would be better and is the
  // obvious next improvement to this instrument.
  const SETS = {
    temporal: ['redundancy', 'diagnosis', 'startup', 'plain'],
    general: ['photosynthesis', 'bread', 'bridge', 'quarter', 'apology', 'inflation']
  };

  const STORIES = {
    redundancy: [
      'Marcus had worked at the plant for nineteen years.',
      'On a Tuesday in March the company announced the closure.',
      'As a result he lost the only job he had ever held.',
      'He remembered the morning he first walked through those gates.',
      'There were three months left before the savings ran out.'
    ],
    diagnosis: [
      'The results were due on Thursday.',
      'She waited for the call in an empty waiting room.',
      'The doctor explained the scan in a quiet voice.',
      'Consequently everything she had planned for the year stopped.',
      'She thought back to how easily she used to run.'
    ],
    startup: [
      'They built the first version in a rented garage.',
      'The demo went badly and the investors left early.',
      'So they rewrote the product from nothing.',
      'Eighteen months later the same investors called back.',
      'He would one day tell this story on a stage.'
    ],
    // Control story: no temporal words, no causal markers. Coverage here
    // SHOULD be zero. If it is not, the detectors are firing on prose that
    // contains nothing for them to find.
    plain: [
      'The market opened at six in the morning.',
      'Traders set out crates of fish along the wet stone.',
      'A woman weighed a basket of lemons on a brass scale.',
      'Gulls circled above the awnings.',
      'By noon the stalls were bare.'
    ],

    // --- general set: ordinary narration, no detector in mind -------------

    // Expository science. The core explainer case, and the one with no
    // human subject anywhere in it.
    photosynthesis: [
      'A leaf takes in carbon dioxide through pores on its underside.',
      'Water travels up from the roots through narrow vessels.',
      'Chlorophyll in the leaf absorbs energy from sunlight.',
      'That energy splits the water and releases oxygen.',
      'What remains is sugar, which the plant stores or spends.'
    ],
    // CALIBRATION CASE, and it is currently FAILING. Kept permanently, not
    // because it is representative but because it discriminates: five
    // sentences of a person doing physical things to physical objects, which
    // is the case object inference exists for.
    //
    // Keyword discovery extracts nothing. The Director extracts book,
    // laptop, paper, pencil and clock — desk objects laid over a kitchen,
    // because the renderer knows thirteen objects and none of them is a
    // bowl, an oven or a loaf. It is answering correctly from a vocabulary
    // that cannot express the question.
    //
    // PASS CONDITION, in order. The story renders with objects that belong
    // to it; the five beats stop sharing one signature, since mixing is not
    // sitting and an oven is not a counter. Payload rising is not a pass —
    // it already rose, while the frames stayed wrong, and the metrics in
    // sequence-battery.js scored that as success because they count whether
    // a channel fired and never whether it is true.
    //
    // Do not delete, and do not fix it yet. A keyword entry for `flour`
    // satisfies the letter of the case and destroys its purpose; adding bowl,
    // oven and loaf to the object vocabulary is the honest repair and still
    // erases the evidence. This version is the clean demonstration that the
    // ontology, not the producer, is the constraint — worth more than a
    // passing test until the study has been run against it once.
    bread: [
      'She mixed flour, water and salt in a wide bowl.',
      'The dough rested on the counter for an hour.',
      'She folded it over itself and left it again.',
      'The oven heated while the loaf proved in a basket.',
      'It came out dark and hollow-sounding underneath.'
    ],
    // History. Named people, dates, institutions, consequence.
    bridge: [
      'The city council approved the crossing in 1883.',
      'Engineers drove caissons into the riverbed by hand.',
      'Twenty-seven workers died before the towers were finished.',
      'The bridge opened to traffic on a cold morning in May.',
      'It carried more people in a day than the ferries had in a week.'
    ],
    // Business reporting. Numbers, entities, no physical scene at all.
    quarter: [
      'Revenue grew eleven percent over the previous quarter.',
      'Most of the increase came from enterprise renewals.',
      'Marketing spend stayed flat while headcount rose.',
      'The board asked for a hiring freeze until March.',
      'Two competitors cut their prices the same week.'
    ],
    // Interpersonal, dialogue-adjacent, two people.
    apology: [
      'Daniel knocked on the door twice before she answered.',
      'He said he had been wrong about the money.',
      'She listened without interrupting him.',
      'They sat at the kitchen table for a long time.',
      'Neither of them mentioned it again.'
    ],
    // Abstract exposition. No people, no objects, no place.
    inflation: [
      'Inflation measures how quickly money loses its purchasing power.',
      'Central banks raise interest rates to slow it down.',
      'Higher rates make borrowing more expensive for everyone.',
      'Spending falls, and prices rise more slowly than before.',
      'The cost of that adjustment is usually unemployment.'
    ]
  };

  const setOf = (name) => Object.keys(SETS)
    .find((s) => SETS[s].indexOf(name) > -1) || 'unsorted';

  const wordsFrom = (text) => text.split(/\s+/).map((w, i) => ({
    text: w, start: i * 0.4, end: i * 0.4 + 0.34
  }));

  async function frames(sentences, subject, useDirector) {
    const Sc = window.BlvckScenes, Sy = window.BlvckSync, St = window.BlvckStage;
    const subj = subject || 'Subject';
    const words = wordsFrom(sentences.join(' '));
    const tl = Sy.normalize({ words, duration: words[words.length - 1].end }, 'aligned');
    const scenes = Sc.fromTimeline(tl, { minSec: 0.1 });
    const res = await Sc.attachState(scenes, tl,
      { useDirector: !!useDirector, subject: subj });
    const out = [];
    for (const sc of scenes) {
      const trace = {};
      // visualType stickman is what the product queue routes to compose(),
      // so this is the path the app takes and not a harness-only path.
      const blob = await St.compose(Object.assign({}, sc, {
        subject: sc.sceneSummary, visualType: 'stickman'
      }), { trace });
      const payload = payloadOf(sc, trace);
      out.push({
        blob,
        text: sc.sceneSummary || '',
        horizon: trace.horizon || null,
        residue: (trace.residue || []).slice(),
        causedBy: sc.causedBy || null,
        payload,
        reason: reasonFor(sc, trace, payload, subj),
        confidence: confidenceOf(reasonFor(sc, trace, payload, subj))
      });
    }
    // `staging` labels what produced these scenes. It matters because every
    // number this battery reports is keyword-only discovery unless it says
    // otherwise, and quoting payload without that label overstates how much
    // the engine can find when the Director is reachable.
    return { shots: out, linked: (res && res.linked) || 0,
             staging: (res && res.staging) || 'keywords' };
  }

  // --- information flow ----------------------------------------------------
  //
  // Coverage answered "did this beat get anything". It could not answer why a
  // sequence works, because it counts a beat with one channel the same as a
  // beat with five, and it counts a channel that was inferred the same as one
  // that reached pixels.
  //
  // So every channel is recorded twice: what the producer EXTRACTED, and what
  // the trace shows the renderer DREW. The gap between them is the thing that
  // has gone wrong repeatedly in this codebase — a capability implemented,
  // inferred, carried on the scene, and silently ignored downstream. Coverage
  // cannot see that. This can.
  //
  // The channels are named once here so that adding a system to the engine and
  // forgetting to add it to the instrument is a visible omission rather than a
  // quiet one.
  const CHANNELS = [
    ['objects',     (s) => (s.objects || []).some((o) => o && !o.residue),
                    (t) => !!(t.objects && t.objects.length)],
    ['residue',     (s) => (s.objects || []).some((o) => o && o.residue),
                    (t) => !!(t.residue && t.residue.length)],
    ['interaction', (s) => !!s.interaction,          (t) => !!t.interaction],
    ['support',     (s) => !!(s.support && s.support !== 'ground'),
                    (t) => !!(t.support && t.support.drawn)],
    ['anchors',     (s) => !!(s.anchors && s.anchors.length),
                    (t) => !!(t.anchors && t.anchors.length)],
    ['metaphor',    (s) => !!s.metaphor,             (t) => !!t.metaphor],
    // Horizon is not carried on the scene — it is resolved at draw time from
    // the entity — so extraction and render are read from the same place and
    // this row can only ever report agreement. Kept because leaving it out
    // would understate the payload of a beat that genuinely has one.
    ['horizon',     (s, t) => !!t.horizon,           (t) => !!t.horizon]
  ];

  function payloadOf(scene, trace) {
    const extracted = [], drawn = [], dropped = [];
    CHANNELS.forEach(([name, has, shown]) => {
      if (!has(scene, trace)) return;
      extracted.push(name);
      if (shown(trace)) drawn.push(name); else dropped.push(name);
    });
    return { extracted, drawn, dropped };
  }

  // --- why a beat came back empty ------------------------------------------
  //
  // payload says how much was discovered. It does not say why the rest was
  // not, and every zero looks identical — which is the same asymmetry the
  // renderer had before `unused` and `efficiency` existed, one stage upstream.
  //
  // Four reasons, in priority order, all derived from detectors that already
  // run. None of them adds discovery vocabulary: a reason is metadata about a
  // failure and never reaches the renderer, so being approximate here costs
  // nothing on screen.
  //
  //   state-only    the state engine DID find something — a condition moved —
  //                 but no channel carries it. Discovered and unchannelled,
  //                 which is a missing channel rather than a missing reader.
  //   intent-only   a goal is live at this beat and produced no metaphor.
  //   keyword-miss  a person is present and nothing matched. This is the
  //                 bucket the Director is expected to empty.
  //   no-actor      no person referenced at all — a description or a place.
  //                 Arguably not a failure: some beats are bridges.
  //
  // The person test is pronouns plus the caller's subject name. It will call
  // "Traders set out crates of fish" actorless, which is wrong. Named because
  // the alternative is a list of person-nouns, and a list of person-nouns is
  // the keyword table this whole exercise concluded not to build.
  const PRONOUN = /\b(he|she|they|him|her|them|his|their|hers|theirs)\b/i;

  // Confidence in the DIAGNOSIS, not in the renderer. The rule is structural
  // rather than a table of judgements: a classification resting on positive
  // evidence — state demonstrably moved, a goal is demonstrably live, a
  // pronoun is demonstrably present — is high. One resting on the ABSENCE of
  // evidence is medium, because absence is also what a detector looks like
  // when it is simply not looking hard enough.
  //
  // `no-actor` is the case that matters. It is inferred from finding no
  // pronoun, and the pronoun test misses "Traders set out crates of fish".
  // It is also the bucket a Director might legitimately empty by choosing to
  // personify a scene rather than by finding an actor that was already there.
  // Both are reasons to hold it loosely, and it is currently the largest
  // bucket — so marking it medium keeps the biggest number in the histogram
  // from being read as the firmest.
  const CONFIDENCE = {
    'state-only': 'high',
    'intent-only': 'high',
    'keyword-miss': 'high',
    'no-actor': 'medium'
  };

  function reasonFor(scene, trace, payload, subject) {
    if (payload.extracted.length) return null;
    const S = window.BlvckStoryState;
    const ent = scene.entity;
    const t = scene.time || 0;
    // Probed across the beat's SPAN rather than at the instant it ends.
    // scene.time is the end of the beat, and changeAt tests a point with a
    // 0.4s window, so whether a change was found depended on where in the
    // sentence its keyword happened to fall: "She fell ill that winter" was
    // found and "He lost his job at the plant" was not, though both carry
    // three changes. Half the state-only beats were being reported as
    // keyword misses, which would have pointed the next stretch of work at
    // the wrong stage entirely.
    const dur = Number(scene.duration) || 0;
    if (S && ent) {
      if (S.changeAt && S.changeAt(ent, t - dur / 2, dur / 2 + 0.4)) return 'state-only';
      if (S.goalAt && S.goalAt(ent, t)) return 'intent-only';
    }
    const text = String(scene.sceneSummary || '');
    const named = subject && subject.length > 2
      && text.toLowerCase().indexOf(String(subject).toLowerCase()) > -1;
    return (PRONOUN.test(text) || named) ? 'keyword-miss' : 'no-actor';
  }

  const confidenceOf = (reason) => (reason ? CONFIDENCE[reason] || 'low' : null);

  /**
   * Four numbers over a rendered sequence.
   *
   *   producerPayload  mean channels EXTRACTED per beat, GIVEN the producer
   *              that ran. The semantic bandwidth of the narration as this
   *              engine reads it with that half of discovery switched on.
   *   delivered  mean channels DRAWN per beat. What the viewer could act on.
   *   unused     share of extracted channels that never reached pixels. A
   *              dormancy detector that runs on every channel at once instead
   *              of waiting for someone to notice one is dead.
   *   persistence  share of a beat's channels still present in the next beat.
   *              Low means each frame starts from nothing, which is what makes
   *              a run of beats read as unrelated pictures rather than a scene.
   */
  function flowOf(shots) {
    if (!shots.length) return null;
    let ext = 0, drew = 0, drop = 0;
    shots.forEach((s) => {
      ext += s.payload.extracted.length;
      drew += s.payload.drawn.length;
      drop += s.payload.dropped.length;
    });
    let carried = 0, carriable = 0;
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1].payload.extracted;
      const here = new Set(shots[i].payload.extracted);
      carriable += prev.length;
      prev.forEach((c) => { if (here.has(c)) carried++; });
    }
    return {
      // NAMED FOR ITS CONDITION. What this measures is payload GIVEN a
      // producer, and the producer has been `keywords` for every run so far.
      // Called plain `payload` it reads as a property of the engine, and I
      // quoted 0.70 that way more than once before noticing the whole figure
      // was conditional on the half of discovery that was switched off.
      producerPayload: +(ext / shots.length).toFixed(2),
      delivered: +(drew / shots.length).toFixed(2),
      // THE INVARIANT, stated rather than carried in someone's head. It reads
      // as redundant today because it is 1.00 and payload already equals
      // delivered. That is the point: the day a new channel is added and
      // routed nowhere, this is the number that moves, and it moves before
      // anyone thinks to go looking. Computed from the counts rather than
      // from the two rounded means, so it cannot drift by rounding alone.
      efficiency: ext ? +(drew / ext).toFixed(2) : null,
      unused: ext ? +(drop / ext).toFixed(2) : null,
      // Reported WITH its denominator, and null rather than 0 when there is
      // nothing to divide. One story scored a persistence of 1.00 off a single
      // adjacent pair, which reads as perfect continuity and means two beats
      // in a row happened to have a horizon. A ratio without its base is not
      // a measurement.
      persistence: carriable ? +(carried / carriable).toFixed(2) : null,
      carriable,
      extracted: ext
    };
  }

  /**
   * Which COMBINATIONS of channels occur, not just how many fire.
   *
   * producerPayload can rise without the engine becoming more expressive. If
   * nine beats in ten come back `objects` and the tenth comes back
   * `objects+objects again`, the mean goes up and the pictures do not get
   * more various. Firing frequency and representational range are different
   * quantities and payload alone cannot tell them apart — which matters
   * precisely at the Director A/B, where the interesting question is whether
   * a better producer opens combinations that keywords never reach or simply
   * hits the same one more often.
   *
   * Computed over NON-EMPTY beats only, and reported with that base. Folding
   * the empty beats in would make entropy a measure of how much was
   * discovered, which producerPayload already reports, and would let a
   * corpus of silence read as low diversity rather than as no data.
   *
   *   entropy       bits over the distribution of channel signatures
   *   combinations  distinct signatures observed
   *   dominance     share held by the most common one
   */
  function diversityOf(shots) {
    const sigs = shots
      .map((s) => s.payload.extracted.slice().sort().join('+'))
      .filter(Boolean);
    if (!sigs.length) {
      return { entropy: null, combinations: 0, dominance: null, base: 0, dist: {} };
    }
    const counts = {};
    sigs.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    const keys = Object.keys(counts);
    let h = 0;
    keys.forEach((k) => { const p = counts[k] / sigs.length; h -= p * Math.log2(p); });
    const top = keys.reduce((m, k) => Math.max(m, counts[k]), 0);
    return {
      entropy: +h.toFixed(2),
      combinations: keys.length,
      dominance: +(top / sigs.length).toFixed(2),
      base: sigs.length,
      dist: counts
    };
  }

  /**
   * How often each channel appears among the beats that express anything.
   *
   * Entropy is blind to this by construction. It scores a corpus on how
   * evenly the SIGNATURES are spread, and a set of signatures can be close to
   * uniform while one channel sits inside almost all of them: {horizon},
   * {horizon,objects}, {horizon,objects,support} are three distinct
   * combinations, near-maximal entropy, and the same channel in every one.
   * That is exactly the shape this corpus has, and entropy reported 1.95 bits
   * without noticing.
   *
   * Every channel is listed including the ones that never fire, because a
   * zero is a finding — `metaphor` at 0.00 says the Intent path reached no
   * beat in this corpus, and a table that omitted it would leave that to be
   * discovered by someone reading a distribution and noticing an absence.
   */
  function prevalenceOf(shots) {
    const expressive = shots.filter((s) => s.payload.extracted.length);
    const counts = {};
    CHANNELS.forEach(([name]) => { counts[name] = 0; });
    expressive.forEach((s) => {
      s.payload.extracted.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
    });
    const channels = {};
    Object.keys(counts).forEach((k) => {
      channels[k] = {
        beats: counts[k],
        share: expressive.length ? +(counts[k] / expressive.length).toFixed(2) : null
      };
    });
    return { base: expressive.length, channels };
  }

  /** Corpus totals, so no ratio is reported off a denominator of two. */
  function totals(report, allShots) {
    let ext = 0, drew = 0, drop = 0, carried = 0, carriable = 0, beats = 0;
    const why = {}, staging = {}, confidence = {};
    report.forEach((r) => {
      const f = r.flow; if (!f) return;
      staging[r.staging] = (staging[r.staging] || 0) + r.beats;
      Object.keys(r.why || {}).forEach((k) => {
        why[k] = (why[k] || 0) + r.why[k];
        const c = confidenceOf(k);
        confidence[c] = (confidence[c] || 0) + r.why[k];
      });
      beats += r.beats;
      ext += f.extracted;
      drew += Math.round(f.delivered * r.beats);
      drop += (f.unused || 0) * f.extracted;
      carriable += f.carriable;
      carried += (f.persistence || 0) * f.carriable;
    });
    return {
      beats,
      producerPayload: beats ? +(ext / beats).toFixed(2) : 0,
      delivered: beats ? +(drew / beats).toFixed(2) : 0,
      efficiency: ext ? +(drew / ext).toFixed(2) : null,
      unused: ext ? +(drop / ext).toFixed(2) : null,
      persistence: carriable ? +(carried / carriable).toFixed(2) : null,
      carriable,
      // Pooled across the corpus rather than averaged from per-story figures.
      // Entropy of an average is not the average of entropies, and four
      // five-beat stories give bases too small to mean anything alone.
      diversity: diversityOf(allShots || []),
      prevalence: prevalenceOf(allShots || []),
      why,
      confidence,
      staging
    };
  }

  async function pixels(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return { d: c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data,
             n: bmp.width * bmp.height };
  }

  const diff = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.d.length; i += 4) {
      if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1])
        + Math.abs(a.d[i + 2] - b.d[i + 2]) > 24) n++;
    }
    return n / a.n;
  };

  // Deterministic shuffle, so a rerun of the battery compares against the same
  // rearrangement. A random one would make orderEffect drift between runs and
  // there would be no way to tell a code change from a reshuffle.
  function rotate(list) {
    const out = list.slice();
    const first = out.shift();
    out.splice(Math.floor(out.length / 2), 0, first);
    return out;
  }

  async function run(opts) {
    const o = opts || {};
    const names = o.only ? [o.only]
      : (o.set ? (SETS[o.set] || []) : Object.keys(STORIES));
    const report = [];
    const sheets = [];
    const allShots = [];

    for (const name of names) {
      const sents = STORIES[name];
      const ordered = await frames(sents, o.subject, o.useDirector);
      const shuffled = await frames(rotate(sents), o.subject, o.useDirector);

      const ox = []; for (const s of ordered.shots) ox.push(await pixels(s.blob));
      const sx = []; for (const s of shuffled.shots) sx.push(await pixels(s.blob));

      let move = 0;
      for (let i = 1; i < ox.length; i++) move += diff(ox[i - 1], ox[i]);
      move = ox.length > 1 ? move / (ox.length - 1) : 0;

      // Compared BY SENTENCE, not by position. The same sentence rendered in
      // two different neighbourhoods is the only comparison that isolates
      // cross-beat information from the arc, which moves for everyone.
      let sensitive = 0, compared = 0;
      ordered.shots.forEach((shot, i) => {
        const j = shuffled.shots.findIndex((s) => s.text === shot.text);
        if (j < 0) return;
        compared++;
        if (diff(ox[i], sx[j]) > 0.002) sensitive++;
      });

      const annotated = ordered.shots.filter((s) => s.horizon || s.causedBy).length;
      report.push({
        story: name,
        beats: ordered.shots.length,
        coverage: +(annotated / ordered.shots.length).toFixed(2),
        links: ordered.linked,
        movement: +(move * 100).toFixed(2),
        orderEffect: compared ? +(sensitive / compared).toFixed(2) : 0,
        flow: flowOf(ordered.shots),
        diversity: diversityOf(ordered.shots),
        set: setOf(name),
        staging: ordered.staging,
        why: ordered.shots.reduce((acc, s) => {
          if (s.reason) acc[s.reason] = (acc[s.reason] || 0) + 1;
          return acc;
        }, {}),
        detail: ordered.shots.map((s) => ({
          t: s.text.slice(0, 30),
          h: s.horizon ? s.horizon.dir + '/' + s.horizon.push : null,
          c: s.causedBy || null,
          r: s.residue.join(',') || null,
          got: s.payload.extracted.join('+') || null,
          lost: s.payload.dropped.join('+') || null,
          why: s.reason
        }))
      });
      sheets.push({ name, shots: ordered.shots });
      ordered.shots.forEach((s) => { s.set = setOf(name); });
      allShots.push.apply(allShots, ordered.shots);
    }

    if (o.post !== false) await postSheet(sheets, o.post);
    report.totals = totals(report, allShots);
    // Per set as well as pooled. A pooled figure over two corpora chosen on
    // different principles describes neither of them, and the whole reason
    // for splitting the sets is that one of them was selected for the
    // channel that then dominated the results.
    report.bySet = {};
    Object.keys(SETS).forEach((s) => {
      const rows = report.filter((r) => r.set === s);
      if (!rows.length) return;
      report.bySet[s] = totals(rows, allShots.filter((x) => x.set === s));
    });
    return report;
  }

  /** One contact sheet, one row per story, so the run can be looked at. */
  async function postSheet(sheets, url) {
    const CW = 300, CH = 169;
    const cols = Math.max(...sheets.map((s) => s.shots.length));
    const cv = document.createElement('canvas');
    cv.width = CW * cols; cv.height = CH * sheets.length;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < sheets.length; r++) {
      const row = sheets[r];
      for (let c = 0; c < row.shots.length; c++) {
        const bmp = await createImageBitmap(row.shots[c].blob);
        g.drawImage(bmp, c * CW, r * CH, CW, CH);
        const s = row.shots[c];
        g.fillStyle = '#0f0'; g.font = 'bold 10px monospace';
        const tag = [s.horizon ? s.horizon.dir : null, s.causedBy ? 'cause' : null]
          .filter(Boolean).join('+');
        g.fillText((c === 0 ? row.name + ' | ' : '') + (tag || '-'), c * CW + 4, r * CH + 12);
      }
    }
    const b64 = cv.toDataURL('image/jpeg', 0.88).split(',')[1];
    return fetch(typeof url === 'string' ? url : 'http://localhost:4599',
      { method: 'POST', body: b64 }).then((r) => r.text());
  }

  /**
   * Prove the invariant can break.
   *
   * `efficiency` reads 1.00 on the corpus, and a ratio that has only ever
   * been 1.00 is indistinguishable from one that is hardcoded. So a channel
   * is deliberately broken — a support named 'hammock', which the producer
   * will happily carry and the renderer has no drawing for — and the ratio
   * must fall. If it does not, every future 1.00 means nothing.
   *
   * The same argument as the negative control on `unused`, applied to the
   * derived number rather than the raw one.
   */
  async function selfTest() {
    const St = window.BlvckStage;
    const base = { index: 0, sceneSummary: 'She sat by the window.',
                   subject: 'She sat by the window.', visualType: 'stickman', time: 1 };
    const shotFor = async (support) => {
      const trace = {};
      const blob = await St.compose(Object.assign({}, base, { support }), { trace });
      return { blob, text: base.sceneSummary,
               payload: payloadOf(Object.assign({}, base, { support }), trace) };
    };
    const good = flowOf([await shotFor('chair')]);
    const bad = flowOf([await shotFor('hammock')]);
    // The reason classifier needs controls for the same reason `unused` did.
    // A classifier that has only ever returned one label is indistinguishable
    // from a constant, and one that labels a beat which HAS payload is
    // reporting on the wrong beats entirely.
    const Sy = window.BlvckSync, Sc = window.BlvckScenes;
    const classify = async (sentence, subject) => {
      const words = wordsFrom(sentence);
      const tl = Sy.normalize({ words, duration: words[words.length - 1].end }, 'aligned');
      const scenes = Sc.fromTimeline(tl, { minSec: 0.1 });
      await Sc.attachState(scenes, tl, { useDirector: false, subject: subject || 'Subject' });
      const sc = scenes[0], trace = {};
      await St.compose(Object.assign({}, sc, {
        subject: sc.sceneSummary, visualType: 'stickman' }), { trace });
      const p = payloadOf(sc, trace);
      return { reason: reasonFor(sc, trace, p, subject || 'Subject'),
               payload: p.extracted.length };
    };
    const cases = {
      // Has a channel — must not be given a reason at all.
      hasPayload: await classify('She sat at the desk and typed the report.'),
      // Nothing physical, but the state engine moves — discovered, unchannelled.
      // Two sentences, because the first draft used "He was devastated by the
      // news", which moves NO state at all — the word is not in the cue
      // vocabulary — so the control was testing the classifier against a beat
      // that genuinely had nothing. A control has to be verified to contain
      // the thing it is controlling for.
      stateOnly: await classify('She fell ill that winter.'),
      stateOnlyLate: await classify('He lost his job at the plant.'),
      // A person is present and nothing matched.
      keywordMiss: await classify('He considered the matter at length.'),
      // No person referenced at all.
      noActor: await classify('Gulls circled above the awnings.')
    };
    // Entropy is the one number here with a closed-form answer, so it is
    // checked against arithmetic rather than against a rendered frame. All
    // one signature is 0 bits; four equally likely signatures is exactly 2.
    // A diversity metric that cannot distinguish those two cases would make
    // the Director A/B unreadable in exactly the situation it exists for.
    const fake = (sigs) => sigs.map((s) => ({ payload: { extracted: s } }));
    const flat = diversityOf(fake([['objects'], ['objects'], ['objects'], ['objects']]));
    const wide = diversityOf(fake([['objects'], ['support'], ['horizon'], ['metaphor']]));
    // Order must not matter — a signature is a set, not a sequence.
    const perm = diversityOf(fake([['objects', 'support'], ['support', 'objects']]));
    // Prevalence against the case entropy cannot see: three distinct
    // signatures, near-uniform, one channel present in all of them. Entropy
    // must read high and prevalence must read 1.00 for that channel, or the
    // pair is not telling us two different things.
    const shared = fake([['horizon'], ['horizon', 'objects'], ['horizon', 'support']]);
    const pv = prevalenceOf(shared);
    const prevalencePass = pv.base === 3
      && pv.channels.horizon.share === 1
      && pv.channels.objects.share === 0.33
      && pv.channels.metaphor.share === 0
      && diversityOf(shared).entropy > 1.5
      && prevalenceOf(fake([[], []])).base === 0;

    // Purity against the exact case that slipped through: a valid run that
    // is three-quarters its intended condition must not report 1.00.
    const purityPass = purityOf({ director: 15, keywords: 5 }, 'director') === 0.75
      && purityOf({ keywords: 20 }, 'keywords') === 1
      && purityOf({ keywords: 20 }, 'director') === 0
      && purityOf({}, 'director') === null;

    const entropyPass = flat.entropy === 0 && flat.combinations === 1 && flat.dominance === 1
      && wide.entropy === 2 && wide.combinations === 4 && wide.dominance === 0.25
      && perm.combinations === 1
      && diversityOf(fake([[], []])).entropy === null;

    const reasonsPass = cases.hasPayload.reason === null
      && cases.stateOnly.reason === 'state-only'
      && cases.stateOnlyLate.reason === 'state-only'
      && cases.keywordMiss.reason === 'keyword-miss'
      && cases.noActor.reason === 'no-actor';

    return {
      drawable: { efficiency: good.efficiency, unused: good.unused },
      undrawable: { efficiency: bad.efficiency, unused: bad.unused },
      reasons: cases,
      entropy: { flat, wide, permutationCollapses: perm.combinations === 1 },
      prevalence: { sharedChannel: pv, entropyOfSame: diversityOf(shared).entropy },
      // All must hold, or none of these numbers is load-bearing.
      pass: good.efficiency === 1 && bad.efficiency === 0
        && good.unused === 0 && bad.unused === 1
        && reasonsPass && entropyPass && prevalencePass && purityPass
    };
  }

  /**
   * A/B the two producers over the same corpus, same renderer, same metrics.
   *
   * The comparison that matters is NOT producerPayload_B > producerPayload_A.
   * A larger number says migration helped without saying what it helped, and
   * the buckets correspond to different hypotheses:
   *
   *   keyword-miss shrinks, no-actor holds   the Director reads existing
   *                                          actors better but does not
   *                                          invent subjects where none exist
   *   both shrink                            it also does environmental
   *                                          storytelling
   *   neither shrinks                        discovery is not the producer's
   *                                          fault and the channels are the
   *                                          limit
   *
   * Each outcome points at different work, which is why the histogram is the
   * result and payload is a summary of it.
   *
   * COSTS API CALLS — the Director is a model. Nothing here calls it unless
   * this function is invoked deliberately.
   */
  /**
   * How COMPLETELY a condition occurred, which is not whether it occurred.
   *
   * Two orthogonal checks, and the difference is a run that was reported
   * wrong rather than a run that was fabricated:
   *
   *   validity  did the condition occur at all — catches a FALSE experiment
   *   purity    what share of beats it actually staged — catches a
   *             MISDESCRIBED one
   *
   * The Director A/B was valid and 0.75 pure. Nothing failed, nothing was
   * caught, and the write-up called it "keywords vs Director" when it was
   * keywords vs three-quarters Director. `valid` had already gone green, so
   * there was no prompt to look closer. A number that has to be printed is.
   */
  function purityOf(staging, expected) {
    const total = Object.keys(staging || {})
      .reduce((n, k) => n + staging[k], 0);
    if (!total) return null;
    return +((staging[expected] || 0) / total).toFixed(2);
  }

  /** One arm against another, over whatever slice is handed in. */
  function deltasFor(a, b) {
    if (!a || !b) return null;
    const buckets = new Set([...Object.keys(a.why), ...Object.keys(b.why)]);
    const why = {};
    buckets.forEach((k) => {
      const x = a.why[k] || 0, y = b.why[k] || 0;
      why[k] = { keywords: x, director: y, delta: y - x, confidence: confidenceOf(k) };
    });
    const names = new Set([...Object.keys(a.prevalence.channels),
                           ...Object.keys(b.prevalence.channels)]);
    const channels = {};
    names.forEach((n) => {
      const x = (a.prevalence.channels[n] || {}).share;
      const y = (b.prevalence.channels[n] || {}).share;
      channels[n] = { keywords: x, director: y,
                      delta: (x == null || y == null) ? null : +(y - x).toFixed(2) };
    });
    return {
      beats: a.beats,
      producerPayload: { keywords: a.producerPayload, director: b.producerPayload },
      expressive: { keywords: a.prevalence.base, director: b.prevalence.base },
      efficiency: { keywords: a.efficiency, director: b.efficiency },
      persistence: { keywords: a.persistence, director: b.persistence },
      // Payload and entropy answer different questions and the pair is the
      // point. Payload up with entropy flat means the same combinations
      // firing more often; payload up with entropy up means combinations
      // keywords could not reach.
      diversity: { keywords: a.diversity, director: b.diversity },
      // Per channel, so the A/B can answer WHAT the Director adds rather than
      // whether it is better. A producer that lifts payload entirely through
      // one channel and one that spreads the gain across six are different
      // outcomes pointing at different next steps.
      prevalence: { channels },
      why,
      purity: { keywords: purityOf(a.staging, 'keywords'),
                director: purityOf(b.staging, 'director') }
    };
  }

  /**
   * The Director across two qualitatively different corpora.
   *
   * Reported PER SET first and pooled only afterwards. The corpora differ by
   * 23x in their keyword baseline, so a pooled figure is dominated by
   * whichever set happens to carry more beats and would hide the only thing
   * worth learning: whether the gain is uniform or concentrated.
   *
   * If the Director lifts both, it recovers ordinary narration and the
   * earlier +129% was an understatement. If it lifts only `temporal`, it was
   * mostly helping a corpus that already matched the keyword vocabulary, and
   * the architecture conclusion is entirely different. Pooling these from the
   * outset would average those two answers into one meaningless number.
   */
  async function compare(opts) {
    const o = opts || {};
    const A = await run(Object.assign({}, o, { useDirector: false, post: false }));
    const B = await run(Object.assign({}, o, { useDirector: true, post: false }));
    const bySet = {};
    Object.keys(SETS).forEach((s) => {
      if (A.bySet[s] && B.bySet[s]) bySet[s] = deltasFor(A.bySet[s], B.bySet[s]);
    });
    return {
      producer: { keywords: A.totals.staging, director: B.totals.staging },
      // Per set first. Pooled is a summary of these, not a substitute.
      bySet,
      pooled: deltasFor(A.totals, B.totals),
      // Guards against the result that looks like a win and is not one: if
      // staging never says `director`, the B arm silently fell back to
      // keywords and every difference is noise.
      // PIPELINE STATUS, printed above the behavioural numbers rather than
      // beside them, because they are not peers: if any line here is false
      // the numbers below describe a broken experiment and reading them is
      // worse than having none. Every entry is a precondition someone can
      // check in O(1) and that no output metric can substitute for.
      pipeline: {
        'prompt-delivered': true,     // asserted in generateJSON
        'narration-present': !(A.totals.blankNarration || B.totals.blankNarration),
        'model-invoked': !!(B.totals.staging && B.totals.staging.director),
        'director-purity': purityOf(B.totals.staging, 'director'),
        'renderer-completed': A.totals.beats > 0 && B.totals.beats > 0,
        'selftest': undefined         // filled by the caller when run
      },
      valid: !!(B.totals.staging && B.totals.staging.director),
      // Printed whether or not it is 1.00, so a summary cannot be written
      // without it having been on screen.
      purity: { keywords: purityOf(A.totals.staging, 'keywords'),
                director: purityOf(B.totals.staging, 'director') }
    };
  }

  /**
   * Freeze the corpus through both producers into the blind study's stimuli.
   *
   * The study cannot call a model: a Director call takes 30-120s and a
   * re-run mid-study would have different people judging different pictures.
   * So the scenes are captured once, here, and the page renders them offline.
   *
   * Emitted as JS assigning window.STUDY_FIXTURE rather than JSON, because
   * the study has to open from a file:// path and fetch is blocked by CORS
   * there while script tags are not.
   *
   * THE MODEL IS RECORDED, and the reason is the whole history of this file.
   * A fixture is a claim about a producer, and a set of participant answers
   * that does not say which model drew the pictures cannot be interpreted at
   * all — it looks like a result about the Director and is a result about
   * one sampled output of one model on one day.
   *
   * `staged` counts how many stories actually reached the model. A capture
   * taken during an outage silently produces two identical arms and a study
   * that measures nothing; this is the purity check applied one stage
   * earlier, where it is cheaper to notice.
   */
  async function captureFixture(opts) {
    const o = opts || {};
    const Sc = window.BlvckScenes, Sy = window.BlvckSync;
    const names = o.only ? [o.only] : Object.keys(STORIES);
    const out = { model: (window.BlvckAI && window.BlvckAI.chatModel && window.BlvckAI.chatModel()) || 'unknown',
                  at: new Date().toISOString(), sets: SETS, stories: {} };
    for (const name of names) {
      const sents = STORIES[name];
      out.stories[name] = { sentences: sents, arms: {} };
      for (const arm of ['keywords', 'director']) {
        const words = wordsFrom(sents.join(' '));
        const tl = Sy.normalize({ words, duration: words[words.length - 1].end }, 'aligned');
        const scenes = Sc.fromTimeline(tl, { minSec: 0.1 });
        const res = await Sc.attachState(scenes, tl,
          { useDirector: arm === 'director', subject: o.subject || 'Subject' });
        out.stories[name].arms[arm] = {
          staging: res.staging,
          scenes: scenes.map((s) => JSON.parse(JSON.stringify(s)))
        };
      }
    }
    const total = Object.keys(out.stories).length;
    const staged = Object.keys(out.stories)
      .filter((s) => out.stories[s].arms.director.staging === 'director').length;
    out.capture = { stories: total, directorStaged: staged,
                    purity: total ? +(staged / total).toFixed(2) : null };
    return out;
  }

  /** Save a capture as study-fixture.js, ready to sit beside study.html. */
  function downloadFixture(fix) {
    const head = '// Frozen study stimuli. Loaded via a SCRIPT TAG rather than fetch()\n'
      + '// because the study must open from a file:// path and fetch is blocked by\n'
      + '// CORS there. Generated by BlvckSeqBattery.captureFixture().\n'
      + '//\n'
      + '// One sampled run of ' + fix.model + ' on ' + fix.at + '. Director staged '
      + fix.capture.directorStaged + ' of ' + fix.capture.stories + ' stories.\n'
      + 'window.STUDY_FIXTURE = ';
    const blob = new Blob([head + JSON.stringify(fix) + ';\n'],
      { type: 'application/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'study-fixture.js';
    a.click();
    return fix.capture;
  }

  window.BlvckSeqBattery = { run, compare, selfTest, captureFixture, downloadFixture,
                             STORIES, SETS };
})();
