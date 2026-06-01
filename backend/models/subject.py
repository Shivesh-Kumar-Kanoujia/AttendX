"""
AttendX Backend — models/subject.py
Pydantic models for subject payloads and responses.
"""

from pydantic import BaseModel, Field, model_validator


class SubjectPayload(BaseModel):
    """Payload for POST /save-subject."""
    id:        str  = Field(..., description="Unique subject ID (client-generated)")
    name:      str  = Field(..., min_length=1, max_length=100)
    total:     int  = Field(..., ge=0)
    attended:  int  = Field(..., ge=0)
    required:  int  = Field(75, ge=0, le=100)
    updated_at: str = Field(..., description="ISO-8601 timestamp")

    @model_validator(mode="after")
    def validate_attended(self):
        if self.attended > self.total:
            raise ValueError("attended must not exceed total")
        return self


class SubjectResponse(BaseModel):
    """Subject as stored and returned by the API."""
    id:        str
    name:      str
    total:     int
    attended:  int
    required:  int
    updatedAt: str