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

Because these models are handed to vLLM as a JSON schema for guided decoding,
the grammar itself is what keeps the model inside the vocabulary. Widening a
Literal here widens what the model may emit, so the lists below must stay in
step with VISUAL_TYPES / SHOT_TYPES / CAMERA_MOVES / HOST_OVERLAYS in
public/prompts.js.
"""

from __future__ import annotations

from typing import List, Optional, Literal

from pydantic import BaseModel, Field

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


class StockRequirements(BaseModel):
    """What to search the stock libraries for. Required for the stock_* types."""

    concept: str = Field(
        description="One sentence naming what this beat is actually about."
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


def get_json_schema() -> dict:
    """The JSON schema handed to vLLM for structured output."""
    return _tighten(VideoPlan.model_json_schema())
