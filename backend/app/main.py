"""FastAPI application implementing the Patterm MVP."""
from __future__ import annotations

from datetime import datetime
import hashlib
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import schemas
from .storage import (
    AccessRegistry,
    AppointmentCatalog,
    AuditLogger,
    EmailGateway,
    Keyring,
    PatientAccessRequest,
    PatientVault,
    default_dataset,
)


DATA_PATH = Path(__file__).resolve().parent / "data"
PATIENT_DATA_PATH = DATA_PATH / "patients"
KEYRING_PATH = DATA_PATH / "patient_keys.json"
AUDIT_LOG_PATH = DATA_PATH / "audit.log"
ACCESS_REQUESTS_PATH = DATA_PATH / "access_requests.json"

app = FastAPI(
    title="Patterm MVP API",
    description=(
        "Secure appointment booking and patient record management for outpatient clinics. "
        "The API uses encrypted per-patient storage, audit logging, and explicit consent "
        "tracking to align with GDPR and ISO 27001 controls."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_catalog() -> AppointmentCatalog:
    return AppointmentCatalog(default_dataset())


def get_vault() -> PatientVault:
    keyring = Keyring(KEYRING_PATH)
    return PatientVault(PATIENT_DATA_PATH, keyring.get_key)


def get_audit_logger() -> AuditLogger:
    return AuditLogger(AUDIT_LOG_PATH)


def get_email_gateway() -> EmailGateway:
    return EmailGateway()


def get_access_registry() -> AccessRegistry:
    return AccessRegistry(ACCESS_REQUESTS_PATH)


def stable_hash(*components: str) -> str:
    """Create a stable, reproducible hash for audit payloads."""

    payload = "|".join(components)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@app.get("/clinics", response_model=list[schemas.Clinic])
async def list_clinics(catalog: AppointmentCatalog = Depends(get_catalog)) -> list[schemas.Clinic]:
    """List clinics that are available for booking."""

    return list(catalog.dataset.clinics)


@app.get("/appointments/search", response_model=list[schemas.AppointmentSlot])
async def search_appointments(
    specialty: Optional[schemas.Specialty] = None,
    clinic_id: Optional[str] = None,
    catalog: AppointmentCatalog = Depends(get_catalog),
) -> list[schemas.AppointmentSlot]:
    """Search appointments by specialty and/or clinic."""

    return catalog.search(specialty=specialty, clinic_id=clinic_id)


@app.post("/appointments", response_model=schemas.AppointmentConfirmation)
async def book_appointment(
    request: schemas.AppointmentRequest,
    catalog: AppointmentCatalog = Depends(get_catalog),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.AppointmentConfirmation:
    """Book an appointment and create/update the encrypted patient record."""

    slot = catalog.slot_by_id(request.slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Appointment slot not found")
    clinic = catalog.clinic_by_id(slot.clinic_id)
    if clinic is None:
        raise HTTPException(status_code=404, detail="Clinic not found for slot")

    record = vault.load(request.patient.id)
    if record is None:
        record = schemas.PatientRecord(profile=request.patient, appointments=[], treatment_notes=[])
    record.appointments = [
        appointment
        for appointment in record.appointments
        if appointment.id != slot.id
    ]
    record.appointments.append(slot)

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        request.patient.id,
        slot.id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=request.patient.id,
            action="book_appointment",
            patient_id=request.patient.id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    if slot.clinic_id not in record.consents:
        record.consents.append(slot.clinic_id)

    vault.store(record)

    email_gateway.send_confirmation(
        to=request.patient.email,
        subject="Terminbestätigung",
        body=(
            f"Hallo {request.patient.first_name},\n\n"
            f"Ihr Termin bei {clinic.name} am {slot.start:%d.%m.%Y %H:%M} Uhr wurde bestätigt."
        ),
    )

    return schemas.AppointmentConfirmation(
        appointment=slot,
        clinic=clinic,
        confirmation_number=str(uuid4()),
    )


@app.post("/patients/{patient_id}/notes", response_model=schemas.PatientRecord)
async def add_treatment_note(
    patient_id: str,
    payload: schemas.TreatmentNoteRequest,
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
) -> schemas.PatientRecord:
    """Add a versioned treatment note to the encrypted patient record."""

    record = vault.load(patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient record not found")

    next_version = (record.treatment_notes[-1].version + 1) if record.treatment_notes else 1
    note = schemas.TreatmentNote(
        version=next_version,
        author=payload.author,
        created_at=datetime.utcnow(),
        summary=payload.summary,
        next_steps=payload.next_steps,
    )
    record.treatment_notes.append(note)
    vault.store(record)

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        patient_id,
        str(note.version),
        note.summary,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=payload.author,
            action="add_treatment_note",
            patient_id=patient_id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    return record


@app.post("/patients/{patient_id}/consents", response_model=schemas.ShareStatus)
async def update_consent(
    patient_id: str,
    payload: schemas.ConsentRequest,
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    registry: AccessRegistry = Depends(get_access_registry),
) -> schemas.ShareStatus:
    """Grant or revoke consent for a clinic to access the patient's record."""

    record = vault.load(patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient record not found")

    if payload.grant:
        if payload.requester_clinic_id not in record.consents:
            record.consents.append(payload.requester_clinic_id)
    else:
        record.consents = [
            clinic_id for clinic_id in record.consents if clinic_id != payload.requester_clinic_id
        ]
    vault.store(record)

    registry.record(
        PatientAccessRequest(
            patient_id=patient_id,
            clinic_id=payload.requester_clinic_id,
            timestamp=datetime.utcnow(),
        )
    )

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        patient_id,
        payload.requester_clinic_id,
        str(payload.grant),
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=payload.requester_clinic_id,
            action="update_consent",
            patient_id=patient_id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    return schemas.ShareStatus(
        clinic_id=payload.requester_clinic_id,
        granted=payload.grant,
        updated_at=datetime.utcnow(),
    )


@app.get("/patients/{patient_id}", response_model=schemas.PatientRecord)
async def get_patient_record(
    patient_id: str,
    requester_clinic_id: str = Query(
        ...,
        description="Clinic identifier requesting access to the patient record.",
    ),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
) -> schemas.PatientRecord:
    """Retrieve a patient record, enforcing consent-based access control."""

    record = vault.load(patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient record not found")

    if requester_clinic_id not in record.consents:
        raise HTTPException(status_code=403, detail="Access not granted by patient")

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        patient_id,
        requester_clinic_id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=requester_clinic_id,
            action="get_patient_record",
            patient_id=patient_id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    return record
