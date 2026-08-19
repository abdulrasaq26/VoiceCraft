"""The storyboard contract.

This mirrors, field for field, what AETHER's `parseVideoPlan()` in
public/prompts.js actually reads. That parser is unforgiving in two ways worth
stating up front, because getting either wrong makes the director look broken
in a way that produces no error message:

  * a scene whose `index` is not a finite number is DROPPED from the result,
    so an omitted index silently deletes the beat; and
  * `visualType` is snapped onto AETHER's vocabulary, with anything
    unrecognised falling back to 'stock_video' — an invented type is not an
    error, it is a wrong answer that looks like a right one.

These models are compiled into a GBNF grammar by llama.cpp, so the grammar
itself is what keeps the model inside the vocabulary — it cannot emit a token
that leaves the shape. Widening a Literal here widens what the model may say,
so the lists below must stay in step with VISUAL_TYPES / SHOT_TYPES /
CAMERA_MOVES / HOST_OVERLAYS in public/prompts.js.

Note that llama.cpp builds the grammar and never shows the schema to the
model, so the Field descriptions here do not steer generation. Field guidance
belongs in DIRECTOR_SYSTEM_PROMPT; the descriptions are for whoever reads
this file next.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any, List, Literal, Optional, Tuple, Union

from pydantic import BaseModel, Field, model_validator

# Which payload each visual type cannot render without. A grammar cannot say
# "if visualType is stock_video then stockRequirements is required" — JSON
# Schema has no way to express a dependency between a value and another
# field's presence — so the model is free to pick a type and then leave its
# payload null. It does exactly that when given the chance, and the beat
# renders as a blank card. This table is where the rule actually lives.
NEEDS_STOCK = frozenset({"stock_video", "stock_photo", "stock_text"})
NEEDS_TEXT = frozenset({"stock_text", "editorial_text"})
NEEDS_GRAPHIC = frozenset({"stickman", "whiteboard", "chart", "map", "timeline", "diagram"})

# Kept in the same order as public/prompts.js so the two can be diffed by eye.
VisualType = Literal[
    "stock_video", "stock_photo", "stock_text", "editorial_text",
    "t2v", "broll", "presenter",
    "stickman", "whiteboard", "chart", "map", "timeline", "diagram",
]

ShotType = Literal[
    "Extreme Wide", "Wide", "Medium", "Close Up",
    "Extreme Close Up", "Over Shoulder", "POV",
]

CameraMove = Literal[
    "Static", "Slow Push In", "Dolly In", "Dolly Out", "Pan Left", "Pan Right",
    "Crane Up", "Crane Down", "Handheld", "Drone",
]

HostOverlay = Literal["none", "circle", "rect", "corner", "full"]
TextStyle = Literal["stat", "quote", "title", "emphasis", "callout"]
Transition = Literal["cut", "dissolve"]


SourceStrategy = Literal["auto", "modern_stock", "archival", "mixed"]
MediaSource = Literal["pexels", "pixabay", "archive_org"]


class TimePeriod(BaseModel):
    """When the beat is set, when the script actually says so.

    Only fill this in from something the narration establishes. A guessed date
    narrows the archive search onto the wrong decade, which is worse than not
    narrowing it at all.
    """

    from_year: Optional[int] = Field(default=None, ge=1800, le=2100,
                                     description="Earliest year this beat depicts.")
    to_year: Optional[int] = Field(default=None, ge=1800, le=2100,
                                   description="Latest year this beat depicts.")
    label: str = Field(default="", description="How the script says it: '1960s', 'the Cold War'.")


class Excerpt(BaseModel):
    """Which slice of a long archive item this beat wants.

    Archive items are whole films, so a beat needs a window rather than the
    whole reel. `selectionIntent` says what should be on screen; AETHER finds
    the window and flags it for checking, because choosing the right moment
    inside an eleven-minute film means watching it.
    """

    required: bool = Field(default=False, description="True when the source is a long-form film.")
    targetDuration: float = Field(default=6.0, ge=1, le=60,
                                  description="Seconds of it to use.")
    selectionIntent: str = Field(
        default="",
        description="What should be visible in the excerpt: 'workers operating wartime machinery'.",
    )


class _StockCommon(BaseModel):
    """What every stock beat needs, whichever library it is bound for."""

    concept: str = Field(
        description=(
            "One sentence describing THE SHOT - what the camera sees: subject, "
            "action, setting. Not the topic and not the narration rewritten. "
            "'a person browses a collection of scripts' is a topic and fits "
            "every beat in the section; 'hands turning the pages of a bound "
            "screenplay on a lamp-lit desk' is a shot. Two beats in one section "
            "must not share a shot: if a beat adds no new subject - a fragment, "
            "a continuing list - name the concrete thing it does add rather "
            "than repeating the previous beat's picture."
        )
    )
    queries: List[str] = Field(
        description=(
            "3-5 standalone stock-search phrases, written as a stock "
            "photographer would search: subject + action + setting. Describe "
            "what the camera sees, never what the narration says. Good: "
            "'scientist looking into microscope'. Bad: 'the consequences of "
            "inflation'."
        ),
        min_length=1,
        max_length=6,
    )
    fallbackQueries: List[str] = Field(
        default_factory=list,
        description="2-3 broader queries to try if the primary queries find nothing.",
        max_length=4,
    )
    subjectCategory: Optional[Literal["HUMAN", "NATURE", "URBAN", "ABSTRACT", "OBJECT"]] = Field(
        default=None, description="Coarse subject bucket, used to break ties between clips."
    )
    minimumDuration: float = Field(
        default=0,
        ge=0,
        description="Seconds the clip must run at minimum. 0 means half the scene duration.",
    )
    preferredSources: List[MediaSource] = Field(
        min_length=1,
        max_length=3,
        description=(
            "REQUIRED, best first. Name at least one — an empty list is not "
            "'let AETHER choose', it is a beat with no source decision at all. "
            "List each library once."
        ),
    )
    sourceReason: str = Field(
        default="",
        description=(
            "One line on why this source suits the beat, for the producer to "
            "read. 'Authentic 1969 launch footage carries this better than a "
            "modern re-creation.' Not your reasoning — the production rationale."
        ),
    )


class ArchivalRequirements(_StockCommon):
    """An archival beat, and everything AETHER needs to actually use one.

    A film archive is not a stock library with older clips in it. Asking it for
    footage means naming the artefact, choosing a window inside a whole film,
    and saying why that film earns its place. Those are four separate decisions
    and the Director is the only thing that can make them — so on this branch
    they are structurally required, not encouraged.

    Required here rather than validated afterwards because a validation failure
    re-asks the model for the entire plan, and one beat costs about 150 seconds
    against the live 27B. The grammar can simply make the omission unspellable.

    `sourceStrategy` is first so the grammar's alternation resolves on its very
    first field: once the model has written "archival" it is committed to this
    branch and cannot reach the end of the object without the rest.
    """

    sourceStrategy: Literal["archival"] = Field(
        description=(
            "Authentic period film says more here than any modern restaging: a "
            "war, a launch, a protest, a vanished way of working."
        ),
    )
    archiveQueries: List[str] = Field(
        min_length=1,
        max_length=3,
        description=(
            "REQUIRED. Searches phrased for a film archive rather than a stock "
            "library. An archive is catalogued by what a film IS, not by what "
            "it shows: '1940s wartime factory newsreel' finds something, 'happy "
            "worker in factory' does not."
        ),
    )
    excerpt: Excerpt = Field(
        description=(
            "REQUIRED. An archive item is a whole film, so the beat needs a "
            "window into it and a statement of what should be visible there."
        ),
    )
    editorialPurpose: str = Field(
        min_length=1,
        description=(
            "REQUIRED. Why this footage serves the story — 'historical context "
            "for the wartime production figures'. A production note, not a "
            "legal claim: never assert that a use is fair, permitted or safe. "
            "Whether uncleared material may be published is decided by a "
            "person, not here."
        ),
    )
    timePeriod: Optional[TimePeriod] = Field(
        default=None,
        description=(
            "Fill this in whenever the narration establishes a date, and leave "
            "it out when it does not. A guessed decade points the search at the "
            "wrong footage, which is worse than not narrowing it at all."
        ),
    )

    @model_validator(mode="after")
    def _archive_is_among_the_sources(self) -> "ArchivalRequirements":
        # Repaired rather than rejected. The model has already said this beat is
        # archival; a preferredSources list that then omits archive_org is a
        # slip, not a different decision, and rejecting it would cost a full
        # re-plan. "contains" is not expressible in JSON Schema, so this is the
        # one archival rule the grammar cannot carry.
        if "archive_org" not in self.preferredSources:
            self.preferredSources = ["archive_org"] + list(self.preferredSources)[:2]
        return self


class ModernRequirements(_StockCommon):
    """A present-day beat. The archival fields are absent because they are meaningless here.

    Nothing in a modern stock library needs an excerpt window or an archive
    query, and requiring them would teach the model to invent both.
    """

    sourceStrategy: Literal["modern_stock", "auto"] = Field(
        description=(
            "'modern_stock' for present-day life; 'auto' only when either kind "
            "would genuinely serve — not as a way to avoid choosing."
        ),
    )


# Discriminated on sourceStrategy, so the grammar itself decides which fields a
# beat must carry. This is what makes "required for archival, irrelevant for
# modern" expressible at all: a single flat model can only say "optional".
StockRequirements = Annotated[
    Union[ArchivalRequirements, ModernRequirements],
    Field(discriminator="sourceStrategy"),
]


class TextOverlay(BaseModel):
    """Editorial type burned over the beat. Required for stock_text and editorial_text."""

    text: str = Field(
        description="The words on screen. Under 12 words — this is a caption, not the narration."
    )
    emphasis: str = Field(
        default="",
        description="The 1-3 words within `text` to set larger or brighter.",
    )
    style: TextStyle = Field(default="emphasis", description="Which type treatment to use.")


class Graphic(BaseModel):
    """Content for a canvas-drawn beat: stickman, whiteboard, chart, map, timeline, diagram."""

    title: str = Field(default="", description="Heading for the card.")
    subtitle: str = Field(default="", description="Optional second line.")
    items: List[str] = Field(
        default_factory=list,
        max_length=6,
        description=(
            "The actual content to typeset, and the format depends on the type: "
            "'Label: Number' pairs for chart, 'Date: Event' for timeline, place "
            "names for map, steps for whiteboard, labelled parts for diagram, and "
            "'action:expression' pairs such as 'explain:confident' for stickman."
        ),
    )


class Scene(BaseModel):
    """One beat. AETHER calls these scenes and they map 1:1 onto storyboard rows."""

    # -- timing ---------------------------------------------------------------
    # Present only when the narration has been transcribed. These are seconds
    # on the FINISHED video's clock, and they must come from the supplied
    # transcript rather than being estimated from sentence length: application
    # code validates them against the audio duration and rejects a shot that
    # starts before zero, ends after the narration, or overlaps its neighbour.
    #
    # Not to be confused with an archival excerpt's sourceIn/sourceOut, which
    # are positions inside the source film. Two clocks, never interchangeable.
    timelineStart: Optional[float] = Field(
        default=None, ge=0,
        description="When this beat appears, in seconds of the finished video.",
    )
    timelineEnd: Optional[float] = Field(
        default=None, ge=0,
        description="When it leaves. Must be greater than timelineStart.",
    )

    index: int = Field(
        ge=0,
        description=(
            "Zero-based position of this beat, matching the input cue list. "
            "AETHER discards any scene without a numeric index, so never omit it."
        ),
    )
    visualType: VisualType = Field(description="Which renderer this beat is sent to.")

    stockRequirements: Optional[StockRequirements] = Field(
        default=None, description="Required for stock_video, stock_photo and stock_text."
    )
    textOverlay: Optional[TextOverlay] = Field(
        default=None, description="Required for stock_text and editorial_text."
    )
    graphic: Optional[Graphic] = Field(
        default=None,
        description="Required for stickman, whiteboard, chart, map, timeline and diagram.",
    )

    hostOverlay: HostOverlay = Field(
        default="none",
        description=(
            "Where the channel host sits over the visual. 'full' only with "
            "presenter; 'none' for footage beats and anything emotional."
        ),
    )
    shotType: ShotType = Field(default="Medium", description="Shot scale.")
    cameraMovement: CameraMove = Field(default="Static", description="Camera move.")
    motion: str = Field(
        default="",
        description="What physically moves in the shot. A footage beat with no motion is an expensive still.",
    )
    emotion: str = Field(default="", description="One or two words for the intended mood.")
    transition: Transition = Field(
        default="cut", description="How this beat joins the NEXT one."
    )
    note: str = Field(
        default="",
        description="Continuity warnings, or why this visual choice was made. Keep it short.",
    )

    @model_validator(mode="after")
    def _payload_matches_type(self) -> "Scene":
        problems = scene_violations(self.model_dump())
        if problems:
            raise ValueError("; ".join(problems))
        return self


class VideoPlan(BaseModel):
    """The whole director answer. Top-level shape read by parseVideoPlan()."""

    strategy: str = Field(
        default="",
        description="A sentence or two on the visual approach taken across the video.",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Continuity problems: contradictions in place, time of day or weather.",
    )
    scenes: List[Scene] = Field(min_length=1, description="Every beat, in order.")


# Retained so `from .schema import Storyboard` keeps working in older notebooks.
Storyboard = VideoPlan


def scene_violations(scene: dict) -> List[str]:
    """What is wrong with one scene, in words a model can act on.

    Takes a plain dict so it can run on raw model output before Pydantic gets
    a chance to reject it — the repair path needs to see the damage to fix it.
    """
    problems: List[str] = []
    visual = scene.get("visualType")

    index = scene.get("index")
    if not isinstance(index, int) or isinstance(index, bool):
        # AETHER silently drops a scene with no numeric index, so this is the
        # difference between a beat and no beat at all.
        problems.append("index is missing or not a whole number")

    requirements = scene.get("stockRequirements") or {}
    queries = requirements.get("queries") or []
    if visual in NEEDS_STOCK and not queries:
        problems.append(f"{visual} needs stockRequirements.queries — there is nothing to search for")

    if visual in NEEDS_STOCK:
        sources = requirements.get("preferredSources") or []
        if not sources:
            # Left empty, nothing routes this beat and every library gets the
            # same generic search. Measured on the live model: with this field
            # optional, it was empty on every beat including a wartime one.
            problems.append(
                f"{visual} needs stockRequirements.preferredSources — name at least one library"
            )
        if not requirements.get("sourceStrategy"):
            problems.append(f"{visual} needs stockRequirements.sourceStrategy")

    # Deliberately NOT a violation: archive_org preferred with no archiveQueries.
    #
    # It is a real quality problem — an archive is catalogued by what a film IS,
    # so stock phrasing searches it badly — but scene_violations means "this beat
    # cannot be rendered", and this one renders perfectly well: StockMedia falls
    # back to the ordinary queries. Listing it here made every such beat fail
    # validation and triggered a full re-generation of the whole plan, which is
    # a large cost for a beat that was never broken. See archive_query_advice().

    if visual in NEEDS_TEXT and not ((scene.get("textOverlay") or {}).get("text") or "").strip():
        problems.append(f"{visual} needs textOverlay.text — it would render as a blank card")

    if visual in NEEDS_GRAPHIC and not ((scene.get("graphic") or {}).get("items")):
        problems.append(f"{visual} needs graphic.items — it would render as a blank card")

    return problems


def archive_query_advice(plan: dict) -> List[Tuple[Any, str]]:
    """Quality notes that are worth showing but not worth regenerating for.

    Separated from plan_violations because the two have different costs: a
    violation re-asks the model for the entire plan, while these are things a
    producer can see and fix in one click.
    """
    notes: List[Tuple[Any, str]] = []
    for position, scene in enumerate(plan.get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        requirements = scene.get("stockRequirements") or {}
        sources = requirements.get("preferredSources") or []
        if "archive_org" in sources and not (requirements.get("archiveQueries") or []):
            notes.append((
                scene.get("index", position),
                "archive_org is preferred but archiveQueries is empty — the archive "
                "will be searched with stock phrasing, which finds far less",
            ))
    return notes


def plan_violations(plan: dict) -> List[Tuple[Any, str]]:
    """Every problem across a plan, as (index, message) pairs."""
    found: List[Tuple[Any, str]] = []
    for position, scene in enumerate(plan.get("scenes") or []):
        if not isinstance(scene, dict):
            found.append((position, "scene is not an object"))
            continue
        for problem in scene_violations(scene):
            found.append((scene.get("index", position), problem))
    return found


def _tighten(node: object) -> object:
    """Forbid unspecified keys everywhere in the generated JSON schema.

    Guided decoding follows the grammar it is handed. Left open, an object
    permits arbitrary extra keys, and the model will occasionally invent one
    instead of filling the field we asked for — which then arrives as a beat
    with no queries. Closing the objects removes the option.
    """
    if isinstance(node, dict):
        if node.get("type") == "object" and "additionalProperties" not in node:
            node["additionalProperties"] = False
        for value in node.values():
            _tighten(value)
    elif isinstance(node, list):
        for value in node:
            _tighten(value)
    return node


def _inline_refs(node: object, defs: dict, depth: int = 0) -> object:
    """Replace every $ref with the definition it points at.

    llama.cpp compiles the schema into a GBNF grammar, and its converter is
    far less tolerant of `$ref`/`$defs` indirection than a validator is. The
    models here are a plain tree with no recursion, so inlining is safe and
    costs only a slightly larger schema.
    """
    if depth > 32:  # a cycle would otherwise expand forever
        raise ValueError("schema nests deeper than expected — is a model recursive?")

    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/"):
            target = dict(defs[ref.split("/")[-1]])
            # Keep any siblings of the $ref (a description, usually).
            merged = {k: v for k, v in node.items() if k != "$ref"}
            target.update(merged)
            return _inline_refs(target, defs, depth + 1)
        return {k: _inline_refs(v, defs, depth + 1) for k, v in node.items() if k != "$defs"}

    if isinstance(node, list):
        return [_inline_refs(v, defs, depth + 1) for v in node]

    return node


# Annotations that mean something to a validator but nothing to a grammar.
# `minimum` in particular is compiled inconsistently across llama.cpp versions,
# and a numeric bound is not worth risking the whole grammar over — the
# Pydantic model still enforces it on the way back out.
_GRAMMAR_NOISE = ("description", "title", "default", "minimum", "maximum",
                  "exclusiveMinimum", "exclusiveMaximum",
                  # A discriminated union carries a mapping of literal values to
                  # "#/$defs/..." strings. Those are VALUES, so inlining leaves
                  # them behind pointing at definitions that no longer exist —
                  # and the grammar compiler is handed dangling references. The
                  # branches keep their const/enum on sourceStrategy, which is
                  # what actually constrains generation; the mapping is a
                  # validator convenience and nothing here validates with it.
                  "discriminator")


def _grammar_safe(node: object) -> object:
    """Strip keywords the grammar compiler cannot use.

    llama.cpp builds a GBNF grammar from this and never shows it to the model,
    so descriptions here do not steer anything — the field guidance has to live
    in DIRECTOR_SYSTEM_PROMPT instead. Dropping them keeps the grammar inside
    the subset llama.cpp compiles reliably, and roughly halves its size.
    """
    if isinstance(node, dict):
        return {k: _grammar_safe(v) for k, v in node.items() if k not in _GRAMMAR_NOISE}
    if isinstance(node, list):
        return [_grammar_safe(v) for v in node]
    return node


@lru_cache(maxsize=2)
def _build_json_schema(inline: bool) -> str:
    schema = _tighten(VideoPlan.model_json_schema())
    if inline:
        schema = _grammar_safe(_inline_refs(schema, schema.get("$defs", {})))
    # Cached as text, so a caller mutating the returned dict cannot poison the
    # next caller's copy.
    return json.dumps(schema)


def get_json_schema(inline: bool = False) -> dict:
    """The JSON schema used to constrain generation.

    `inline=True` resolves $defs into the tree and drops validator-only
    annotations — the form llama.cpp's grammar compiler needs.

    Memoised because it cannot change between calls in a running process, so
    rebuilding it was the same answer computed again. Measured at 26ms per
    build, which is small — the expensive part is downstream, where the schema
    is compiled into a GBNF grammar, and that is cached on the engine.

    Returned as a fresh dict each time so a caller mutating it cannot poison
    the cache.
    """
    return json.loads(_build_json_schema(inline))
