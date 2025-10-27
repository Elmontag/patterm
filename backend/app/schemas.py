"""Pydantic schemas for the Patterm MVP API."""
from datetime import datetime, date
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class Specialty(str, Enum):
    """Medical specialties supported by the MVP."""

    cardiology = "cardiology"
    dermatology = "dermatology"
    general_practice = "general_practice"
    orthopedics = "orthopedics"
    pediatrics = "pediatrics"


class Clinic(BaseModel):
    """Public clinic information exposed to patients."""

    id: str = Field(..., description="Stable identifier of the clinic")
    name: str
    specialty: Specialty
    city: str
    street: str
    postal_code: str
    contact_email: EmailStr


class AppointmentSlot(BaseModel):
    """A bookable appointment slot."""

    id: str
    clinic_id: str
    start: datetime
    end: datetime
    is_virtual: bool = Field(
        False,
        description="Whether the appointment takes place virtually (telemedicine)",
    )


class PatientProfile(BaseModel):
    """Minimal patient profile stored in the encrypted data store."""

    id: str
    email: EmailStr
    first_name: str
    last_name: str
    date_of_birth: date


class TreatmentNote(BaseModel):
    """Versioned treatment note written by medical staff."""

    version: int
    author: str
    created_at: datetime
    summary: str
    next_steps: Optional[str] = None


class PatientRecord(BaseModel):
    """Complete patient record stored per patient."""

    profile: PatientProfile
    appointments: List[AppointmentSlot] = []
    treatment_notes: List[TreatmentNote] = []
    consents: List[str] = Field(
        default_factory=list,
        description="Identifiers of clinics that currently have access to the record.",
    )


class AppointmentRequest(BaseModel):
    """Incoming booking request."""

    patient: PatientProfile
    slot_id: str


class AppointmentConfirmation(BaseModel):
    """Response that confirms the booking."""

    appointment: AppointmentSlot
    clinic: Clinic
    confirmation_number: str


class TreatmentNoteRequest(BaseModel):
    """New treatment note payload."""

    author: str
    summary: str
    next_steps: Optional[str] = None


class ConsentRequest(BaseModel):
    """Request to share a patient record with another clinic."""

    requester_clinic_id: str
    grant: bool = Field(
        True,
        description="Whether the patient approves (True) or revokes (False) the consent.",
    )


class ShareStatus(BaseModel):
    """Current consent status for a given clinic."""

    clinic_id: str
    granted: bool
    updated_at: datetime


class AuditEvent(BaseModel):
    """Structured audit trail event."""

    id: str
    actor: str
    action: str
    patient_id: Optional[str]
    timestamp: datetime
    payload_hash: str
