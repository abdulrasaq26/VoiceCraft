from pydantic import BaseModel, Field
from typing import List, Optional, Literal

class ProjectInfo(BaseModel):
    title: str = Field(description="Title of the project")
    summary: str = Field(description="A brief summary of the narrative")
    tone: str = Field(description="The emotional or editorial tone (e.g., serious, energetic, educational)")
    visual_style: str = Field(description="The overarching visual style of the video")
    target_audience: str = Field(description="The intended audience")

class StockSearch(BaseModel):
    queries: List[str] = Field(
        description="3 to 5 optimized stock media search queries. Focus on physical, searchable concepts rather than abstract narrative sentences (e.g., 'exhausted office worker at night' instead of 'inflation hurts purchasing power').",
        min_length=1
    )
    negative_terms: List[str] = Field(
        description="Terms to exclude from the stock search to prevent irrelevant results.",
        default_factory=list
    )

class TextOverlay(BaseModel):
    enabled: bool = Field(description="Whether a text overlay should be displayed during this shot")
    text: Optional[str] = Field(description="The exact concise text to display (e.g., '$10 BILLION', 'THE PROBLEM'). Do not put the entire narration on screen.")
    purpose: Optional[str] = Field(description="Why this text is needed")
    emphasis_level: Optional[Literal["low", "medium", "high", "hero"]] = Field(description="The visual emphasis of the text")
    animation: Optional[str] = Field(description="Suggested animation style (e.g., typewriter, fade in, pop)")

class EditorialGraphic(BaseModel):
    enabled: bool = Field(description="Whether this shot requires an editorial graphic (e.g., chart, map, diagram, timeline) instead of stock footage")
    type: Optional[Literal["chart", "diagram", "map", "timeline", "infographic", "quote_card", "split_screen", "intentional_minimal", "other"]]
    description: Optional[str] = Field(description="Detailed description of what the graphic should communicate")

class VisualRequirements(BaseModel):
    type: Literal["stock_video", "stock_image", "text_graphic", "editorial_graphic"] = Field(description="The primary visual strategy for this shot")
    subject: str = Field(description="The main subject of the visual")
    action: str = Field(description="What is happening in the visual")
    context: str = Field(description="The environment or background context")
    composition: str = Field(description="Suggested camera angle, framing, or composition")
    mood: str = Field(description="The mood of the visual")

class Shot(BaseModel):
    shot_id: str = Field(description="Unique identifier for the shot (e.g., shot_001)")
    start: float = Field(description="Approximate start time in seconds")
    end: float = Field(description="Approximate end time in seconds")
    narration: str = Field(description="The exact spoken narration during this shot")
    visual: VisualRequirements
    stock_search: StockSearch
    importance: Literal["filler", "context", "key_beat", "hero"] = Field(description="Narrative importance of the shot")
    text_overlay: TextOverlay
    editorial_graphic: EditorialGraphic

class Scene(BaseModel):
    scene_id: str = Field(description="Unique identifier for the scene (e.g., scene_001)")
    purpose: str = Field(description="The narrative purpose of this scene")
    start: float = Field(description="Approximate start time of the scene in seconds")
    end: float = Field(description="Approximate end time of the scene in seconds")
    shots: List[Shot] = Field(description="The individual shots that make up this scene")

class Storyboard(BaseModel):
    schema_version: str = Field(default="1.0", description="Schema version")
    project: ProjectInfo
    scenes: List[Scene] = Field(description="The chronological sequence of scenes")

def get_json_schema():
    return Storyboard.model_json_schema()
