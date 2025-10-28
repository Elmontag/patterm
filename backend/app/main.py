"""FastAPI application implementing the Patterm MVP."""
from __future__ import annotations

from datetime import datetime
import hashlib
from pathlib import Path
from typing import Optional, Sequence
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import schemas
from .storage import (
    AccessRegistry,
    AppointmentRepository,
    AuditLogger,
    DuplicateAccountError,
    DuplicateEmailError,
    EmailGateway,
    IdentityStoreError,
    Keyring,
    PatientAccessRequest,
    PatientVault,
    SessionStore,
    UserAccount,
    UserDirectory,
)


DATA_PATH = Path(__file__).resolve().parent / "data"
PATIENT_DATA_PATH = DATA_PATH / "patients"
KEYRING_PATH = DATA_PATH / "patient_keys.json"
AUDIT_LOG_PATH = DATA_PATH / "audit.log"
ACCESS_REQUESTS_PATH = DATA_PATH / "access_requests.json"
APPOINTMENTS_PATH = DATA_PATH / "appointments.json"
IDENTITY_PATH = DATA_PATH / "identity.json"
SESSIONS_PATH = DATA_PATH / "sessions.json"

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
    allow_origins=[],
    allow_origin_regex=r"https?://([a-zA-Z0-9.-]+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_vault() -> PatientVault:
    keyring = Keyring(KEYRING_PATH)
    return PatientVault(PATIENT_DATA_PATH, keyring.get_key)


def get_audit_logger() -> AuditLogger:
    return AuditLogger(AUDIT_LOG_PATH)


def get_email_gateway() -> EmailGateway:
    return EmailGateway()


def get_access_registry() -> AccessRegistry:
    return AccessRegistry(ACCESS_REQUESTS_PATH)


def get_repository() -> AppointmentRepository:
    return AppointmentRepository(APPOINTMENTS_PATH)


def get_user_directory() -> UserDirectory:
    directory = UserDirectory(IDENTITY_PATH)
    try:
        directory.ensure_platform_admin()
    except IdentityStoreError as error:
        raise HTTPException(
            status_code=500, detail="Identitätsregister derzeit nicht verfügbar"
        ) from error
    return directory


def get_session_store() -> SessionStore:
    return SessionStore(SESSIONS_PATH)


security = HTTPBearer(auto_error=False)


def to_public(account: UserAccount) -> schemas.UserPublicProfile:
    return schemas.UserPublicProfile(
        id=account.id,
        email=account.email,
        role=account.role,
        display_name=account.display_name,
        clinic_id=account.clinic_id,
    )


def get_current_account(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    sessions: SessionStore = Depends(get_session_store),
    users: UserDirectory = Depends(get_user_directory),
) -> UserAccount:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    user_id = sessions.resolve(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid session token")
    account = users.get(user_id)
    if account is None:
        raise HTTPException(status_code=401, detail="Account not found")
    return account


def require_roles(account: UserAccount, roles: Sequence[schemas.UserRole]) -> None:
    if account.role not in roles:
        raise HTTPException(status_code=403, detail="Insufficient permissions")


@app.post("/auth/register/patient", response_model=schemas.AuthToken, status_code=201)
async def register_patient(
    payload: schemas.PatientRegistration,
    users: UserDirectory = Depends(get_user_directory),
    sessions: SessionStore = Depends(get_session_store),
) -> schemas.AuthToken:
    try:
        account = users.create_patient(payload)
    except (DuplicateEmailError, DuplicateAccountError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IdentityStoreError as error:
        raise HTTPException(
            status_code=500, detail="Identitätsregister derzeit nicht verfügbar"
        ) from error
    token = sessions.issue(account.id)
    return schemas.AuthToken(token=token, user=to_public(account))


@app.post("/auth/login", response_model=schemas.AuthToken)
async def login(
    payload: schemas.LoginRequest,
    users: UserDirectory = Depends(get_user_directory),
    sessions: SessionStore = Depends(get_session_store),
) -> schemas.AuthToken:
    account = users.authenticate(payload.email, payload.password)
    if account is None:
        raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten")
    token = sessions.issue(account.id)
    return schemas.AuthToken(token=token, user=to_public(account))


@app.get("/auth/profile", response_model=schemas.UserPublicProfile)
async def get_profile(current: UserAccount = Depends(get_current_account)) -> schemas.UserPublicProfile:
    return to_public(current)


@app.post(
    "/auth/register/clinic",
    response_model=schemas.ClinicRegistrationResponse,
    status_code=201,
)
async def register_clinic(
    payload: schemas.ClinicRegistration,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    users: UserDirectory = Depends(get_user_directory),
) -> schemas.ClinicRegistrationResponse:
    require_roles(current, [schemas.UserRole.platform_admin])
    clinic = repository.add_clinic(payload.clinic)
    try:
        account = users.create_clinic_admin(
            clinic_id=clinic.id,
            email=payload.admin_email,
            password=payload.admin_password,
            display_name=payload.admin_display_name,
        )
    except (DuplicateEmailError, DuplicateAccountError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IdentityStoreError as error:
        raise HTTPException(
            status_code=500, detail="Identitätsregister derzeit nicht verfügbar"
        ) from error
    return schemas.ClinicRegistrationResponse(
        clinic=clinic,
        admin=to_public(account),
    )


@app.post("/auth/register/provider", response_model=schemas.ProviderProfile, status_code=201)
async def register_provider(
    payload: schemas.ProviderRegistration,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    users: UserDirectory = Depends(get_user_directory),
) -> schemas.ProviderProfile:
    require_roles(current, [schemas.UserRole.clinic_admin])
    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    if payload.clinic_id != current.clinic_id:
        raise HTTPException(status_code=403, detail="Clinic mismatch for provider registration")
    if repository.get_clinic(payload.clinic_id) is None:
        raise HTTPException(status_code=404, detail="Clinic not found")
    try:
        account = users.create_provider(
            clinic_id=payload.clinic_id,
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
            specialty=payload.specialty,
        )
    except (DuplicateEmailError, DuplicateAccountError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IdentityStoreError as error:
        raise HTTPException(
            status_code=500, detail="Identitätsregister derzeit nicht verfügbar"
        ) from error
    return schemas.ProviderProfile(
        id=account.id,
        display_name=account.display_name,
        email=account.email,
        specialty=payload.specialty,
    )


def stable_hash(*components: str) -> str:
    """Create a stable, reproducible hash for audit payloads."""

    payload = "|".join(components)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@app.get("/clinics", response_model=list[schemas.Clinic])
async def list_clinics(
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.Clinic]:
    """List clinics that are available for booking."""

    return repository.list_clinics()


@app.get("/appointments/search", response_model=list[schemas.AppointmentSlot])
async def search_appointments(
    specialty: Optional[schemas.Specialty] = None,
    clinic_id: Optional[str] = None,
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.AppointmentSlot]:
    """Search appointments by specialty and/or clinic."""

    return repository.search_slots(specialty=specialty, clinic_id=clinic_id)


@app.post("/appointments", response_model=schemas.AppointmentConfirmation)
async def book_appointment(
    request: schemas.AppointmentRequest,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.AppointmentConfirmation:
    """Book an appointment and update the encrypted patient record."""

    require_roles(current, [schemas.UserRole.patient])
    if current.patient_profile is None:
        raise HTTPException(status_code=400, detail="Patient profile missing for account")

    try:
        slot = repository.book_slot(request.slot_id, current.patient_profile)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message)

    clinic = repository.get_clinic(slot.clinic_id)
    if clinic is None:
        raise HTTPException(status_code=404, detail="Clinic not found for slot")

    record = vault.load(current.id)
    if record is None:
        record = schemas.PatientRecord(
            profile=current.patient_profile,
            appointments=[],
            treatment_notes=[],
        )
    else:
        record.profile = current.patient_profile
    record.appointments = [
        appointment for appointment in record.appointments if appointment.id != slot.id
    ]
    record.appointments.append(slot)

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        current.id,
        slot.id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=current.id,
            action="book_appointment",
            patient_id=current.id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    if slot.clinic_id not in record.consents:
        record.consents.append(slot.clinic_id)

    vault.store(record)

    email_gateway.send_confirmation(
        to=current.patient_profile.email,
        subject="Terminbestätigung",
        body=(
            f"Hallo {current.patient_profile.first_name},\n\n"
            f"Ihr Termin bei {clinic.name} am {slot.start:%d.%m.%Y %H:%M} Uhr wurde bestätigt."
        ),
    )

    return schemas.AppointmentConfirmation(
        appointment=slot,
        clinic=clinic,
        confirmation_number=str(uuid4()),
    )


@app.get("/patient/record", response_model=schemas.PatientRecord)
async def get_own_record(
    current: UserAccount = Depends(get_current_account),
    vault: PatientVault = Depends(get_vault),
) -> schemas.PatientRecord:
    require_roles(current, [schemas.UserRole.patient])
    if current.patient_profile is None:
        raise HTTPException(status_code=400, detail="Patientenprofil nicht gefunden")
    record = vault.load(current.id)
    if record is None:
        record = schemas.PatientRecord(
            profile=current.patient_profile,
            appointments=[],
            treatment_notes=[],
        )
    else:
        record.profile = current.patient_profile
    return record


@app.post("/patient/appointments/{slot_id}/cancel", response_model=schemas.PatientRecord)
async def cancel_appointment(
    slot_id: str,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.PatientRecord:
    require_roles(current, [schemas.UserRole.patient])
    slot = repository.get_slot(slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.booked_patient_id != current.id:
        raise HTTPException(status_code=403, detail="Termin gehört nicht zum Konto")

    repository.release_slot(slot_id)

    record = vault.load(current.id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient record not found")
    if current.patient_profile:
        record.profile = current.patient_profile
    record.appointments = [appointment for appointment in record.appointments if appointment.id != slot_id]
    vault.store(record)

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(current.id, slot_id, event_timestamp.isoformat())
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=current.id,
            action="cancel_appointment",
            patient_id=current.id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    if current.patient_profile:
        email_gateway.send_confirmation(
            to=current.patient_profile.email,
            subject="Termin storniert",
            body=(
                f"Hallo {current.patient_profile.first_name},\n\n"
                "Ihr Termin wurde erfolgreich storniert."
            ),
        )

    return record


@app.post(
    "/patient/appointments/{slot_id}/reschedule",
    response_model=schemas.PatientRecord,
)
async def reschedule_appointment(
    slot_id: str,
    payload: schemas.RescheduleRequest,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.PatientRecord:
    require_roles(current, [schemas.UserRole.patient])
    if current.patient_profile is None:
        raise HTTPException(status_code=400, detail="Patientenprofil nicht gefunden")
    current_slot = repository.get_slot(slot_id)
    if current_slot is None:
        raise HTTPException(status_code=404, detail="Aktueller Slot nicht gefunden")
    if current_slot.booked_patient_id != current.id:
        raise HTTPException(status_code=403, detail="Termin gehört nicht zum Konto")

    try:
        new_slot = repository.book_slot(payload.new_slot_id, current.patient_profile)
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message)

    repository.release_slot(slot_id)

    record = vault.load(current.id)
    if record is None:
        record = schemas.PatientRecord(
            profile=current.patient_profile,
            appointments=[],
            treatment_notes=[],
        )
    else:
        record.profile = current.patient_profile
    record.appointments = [appointment for appointment in record.appointments if appointment.id != slot_id]
    record.appointments.append(new_slot)
    if new_slot.clinic_id not in record.consents:
        record.consents.append(new_slot.clinic_id)
    vault.store(record)

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        current.id,
        slot_id,
        payload.new_slot_id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=current.id,
            action="reschedule_appointment",
            patient_id=current.id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    if current.patient_profile:
        clinic = repository.get_clinic(new_slot.clinic_id)
        email_gateway.send_confirmation(
            to=current.patient_profile.email,
            subject="Termin verschoben",
            body=(
                f"Hallo {current.patient_profile.first_name},\n\n"
                f"Ihr Termin bei {(clinic.name if clinic else new_slot.clinic_id)} wurde auf {new_slot.start:%d.%m.%Y %H:%M} Uhr verschoben."
            ),
        )

    return record


@app.get(
    "/medical/slots",
    response_model=list[schemas.AppointmentSlot],
)
async def list_clinic_slots(
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.AppointmentSlot]:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    slots = repository.clinic_slots(current.clinic_id)
    return sorted(slots, key=lambda slot: slot.start)


@app.post(
    "/medical/slots",
    response_model=schemas.AppointmentSlot,
    status_code=201,
)
async def create_clinic_slot(
    payload: schemas.SlotCreationRequest,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> schemas.AppointmentSlot:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    return repository.create_slot(current.clinic_id, payload)


@app.patch(
    "/medical/slots/{slot_id}",
    response_model=schemas.AppointmentSlot,
)
async def update_clinic_slot(
    slot_id: str,
    payload: schemas.SlotUpdateRequest,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.AppointmentSlot:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    slot = repository.get_slot(slot_id)
    if slot is None or slot.clinic_id != current.clinic_id:
        raise HTTPException(status_code=404, detail="Slot not found for clinic")
    clinic = repository.get_clinic(current.clinic_id)
    try:
        updated = repository.update_slot(slot_id, payload)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))

    if updated.booked_patient_id:
        record = vault.load(updated.booked_patient_id)
        if record:
            record.appointments = [
                appointment
                for appointment in record.appointments
                if appointment.id != updated.id
            ]
            record.appointments.append(updated)
            vault.store(record)
        event_timestamp = datetime.utcnow()
        payload_hash = stable_hash(
            updated.booked_patient_id,
            updated.id,
            event_timestamp.isoformat(),
        )
        audit_logger.append(
            schemas.AuditEvent(
                id=str(uuid4()),
                actor=current.clinic_id,
                action="clinic_update_slot",
                patient_id=updated.booked_patient_id,
                timestamp=event_timestamp,
                payload_hash=payload_hash,
            )
        )
        if updated.patient_snapshot:
            email_gateway.send_confirmation(
                to=updated.patient_snapshot.email,
                subject="Termin aktualisiert",
                body=(
                    f"Hallo {updated.patient_snapshot.first_name},\n\n"
                    f"Ihr Termin bei {(clinic.name if clinic else current.clinic_id)} wurde auf {updated.start:%d.%m.%Y %H:%M} Uhr aktualisiert."
                ),
            )

    return updated


@app.post(
    "/medical/slots/{slot_id}/cancel",
    response_model=schemas.AppointmentSlot,
)
async def cancel_clinic_slot(
    slot_id: str,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.AppointmentSlot:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    slot = repository.get_slot(slot_id)
    if slot is None or slot.clinic_id != current.clinic_id:
        raise HTTPException(status_code=404, detail="Slot not found for clinic")
    clinic = repository.get_clinic(current.clinic_id)
    cancelled = repository.cancel_slot(slot_id)
    if slot.booked_patient_id:
        record = vault.load(slot.booked_patient_id)
        if record:
            record.appointments = [
                appointment for appointment in record.appointments if appointment.id != slot_id
            ]
            vault.store(record)
        event_timestamp = datetime.utcnow()
        payload_hash = stable_hash(
            slot.booked_patient_id,
            slot.id,
            event_timestamp.isoformat(),
        )
        audit_logger.append(
            schemas.AuditEvent(
                id=str(uuid4()),
                actor=current.clinic_id,
                action="clinic_cancel_slot",
                patient_id=slot.booked_patient_id,
                timestamp=event_timestamp,
                payload_hash=payload_hash,
            )
        )
        if slot.patient_snapshot:
            email_gateway.send_confirmation(
                to=slot.patient_snapshot.email,
                subject="Termin abgesagt",
                body=(
                    f"Hallo {slot.patient_snapshot.first_name},\n\n"
                    f"Ihr Termin bei {(clinic.name if clinic else current.clinic_id)} wurde abgesagt. Bitte buchen Sie einen neuen Termin."
                ),
            )
    return cancelled


@app.get(
    "/medical/bookings",
    response_model=list[schemas.ClinicBooking],
)
async def list_clinic_bookings(
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.ClinicBooking]:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    bookings: list[schemas.ClinicBooking] = []
    for slot in repository.clinic_slots(current.clinic_id):
        if slot.status == schemas.SlotStatus.booked:
            bookings.append(
                schemas.ClinicBooking(slot=slot, patient=slot.patient_snapshot)
            )
    return sorted(bookings, key=lambda entry: entry.slot.start)


@app.get(
    "/medical/providers",
    response_model=list[schemas.ProviderProfile],
)
async def list_providers(
    current: UserAccount = Depends(get_current_account),
    users: UserDirectory = Depends(get_user_directory),
) -> list[schemas.ProviderProfile]:
    require_roles(current, [schemas.UserRole.clinic_admin])
    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    return [
        schemas.ProviderProfile(
            id=provider.id,
            display_name=provider.display_name,
            email=provider.email,
            specialty=provider.specialty or schemas.Specialty.general_practice,
        )
        for provider in users.list_providers(current.clinic_id)
    ]


@app.post("/patients/{patient_id}/notes", response_model=schemas.PatientRecord)
async def add_treatment_note(
    patient_id: str,
    payload: schemas.TreatmentNoteRequest,
    current: UserAccount = Depends(get_current_account),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
) -> schemas.PatientRecord:
    """Add a versioned treatment note to the encrypted patient record."""

    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    record = vault.load(patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient record not found")

    if current.clinic_id is None:
        raise HTTPException(status_code=403, detail="Clinic context missing for account")
    if current.clinic_id not in record.consents:
        raise HTTPException(status_code=403, detail="Access not granted by patient")

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
        current.clinic_id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=current.clinic_id,
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
    current: UserAccount = Depends(get_current_account),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    registry: AccessRegistry = Depends(get_access_registry),
) -> schemas.ShareStatus:
    """Grant or revoke consent for a clinic to access the patient's record."""

    require_roles(current, [schemas.UserRole.patient])
    if current.id != patient_id:
        raise HTTPException(status_code=403, detail="Nur der Patient kann Freigaben verwalten")
    if current.patient_profile is None:
        raise HTTPException(status_code=400, detail="Patientenprofil nicht gefunden")

    record = vault.load(patient_id)
    if record is None:
        record = schemas.PatientRecord(
            profile=current.patient_profile,
            appointments=[],
            treatment_notes=[],
        )

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
            actor=current.id,
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
    requester_clinic_id: Optional[str] = Query(
        None,
        description="Clinic identifier requesting access to the patient record.",
    ),
    current: UserAccount = Depends(get_current_account),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
) -> schemas.PatientRecord:
    """Retrieve a patient record, enforcing consent-based access control."""

    record = vault.load(patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Patient record not found")

    event_actor = current.id

    if current.role == schemas.UserRole.patient:
        if current.id != patient_id:
            raise HTTPException(status_code=403, detail="Zugriff verweigert")
    elif current.role in (schemas.UserRole.clinic_admin, schemas.UserRole.provider):
        if current.clinic_id is None:
            raise HTTPException(status_code=403, detail="Clinic context missing for account")
        if requester_clinic_id is None:
            requester_clinic_id = current.clinic_id
        if requester_clinic_id != current.clinic_id:
            raise HTTPException(status_code=403, detail="Clinic context mismatch")
        if requester_clinic_id not in record.consents:
            raise HTTPException(status_code=403, detail="Access not granted by patient")
        event_actor = requester_clinic_id
    elif current.role == schemas.UserRole.platform_admin:
        if requester_clinic_id is None:
            requester_clinic_id = current.id
    else:
        raise HTTPException(status_code=403, detail="Role not authorised for patient records")

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        patient_id,
        requester_clinic_id or current.id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=event_actor,
            action="get_patient_record",
            patient_id=patient_id,
            timestamp=event_timestamp,
            payload_hash=payload_hash,
        )
    )

    return record
