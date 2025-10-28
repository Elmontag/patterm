"""FastAPI application implementing the Patterm MVP."""
from __future__ import annotations

from datetime import datetime
import hashlib
from pathlib import Path
from typing import Optional, Sequence
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Response
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
        facility_id=account.facility_id,
    )


def to_summary(detail: schemas.FacilityDetail) -> schemas.FacilitySummary:
    return schemas.FacilitySummary(
        id=detail.id,
        name=detail.name,
        facility_type=detail.facility_type,
        specialties=detail.specialties,
        city=detail.city,
        street=detail.street,
        postal_code=detail.postal_code,
        contact_email=detail.contact_email,
        phone_number=detail.phone_number,
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


@app.patch("/auth/profile", response_model=schemas.UserPublicProfile)
async def update_profile(
    payload: schemas.UserProfileUpdate,
    current: UserAccount = Depends(get_current_account),
    users: UserDirectory = Depends(get_user_directory),
    vault: PatientVault = Depends(get_vault),
) -> schemas.UserPublicProfile:
    updated = False
    if payload.display_name:
        current.display_name = payload.display_name
        updated = True
    if (
        payload.phone_number
        and current.role == schemas.UserRole.patient
        and current.patient_profile is not None
    ):
        current.patient_profile.phone_number = payload.phone_number
        record = vault.load(current.id)
        if record:
            record.profile.phone_number = payload.phone_number
            vault.store(record)
        updated = True
    if not updated:
        return to_public(current)
    try:
        users.save(current)
    except IdentityStoreError as error:
        raise HTTPException(
            status_code=500, detail="Profilaktualisierung derzeit nicht möglich"
        ) from error
    return to_public(current)


@app.post(
    "/auth/register/clinic",
    response_model=schemas.FacilityRegistrationResponse,
    status_code=201,
)
async def register_facility(
    payload: schemas.FacilityRegistration,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    users: UserDirectory = Depends(get_user_directory),
) -> schemas.FacilityRegistrationResponse:
    require_roles(current, [schemas.UserRole.platform_admin])
    try:
        facility = repository.add_facility(
            payload.facility,
            departments=payload.departments,
            owners=payload.owners,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    try:
        account = users.create_facility_admin(
            facility_id=facility.id,
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
    return schemas.FacilityRegistrationResponse(
        facility=facility,
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
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Facility context missing for account")
    if payload.facility_id != current.facility_id:
        raise HTTPException(status_code=403, detail="Facility mismatch for provider registration")
    facility = repository.get_facility(payload.facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Einrichtung nicht gefunden")
    if (
        facility.facility_type == schemas.FacilityType.clinic
        and payload.department_id
        and payload.department_id
        not in {department.id for department in facility.departments}
    ):
        raise HTTPException(status_code=404, detail="Fachbereich nicht gefunden")
    if (
        facility.facility_type == schemas.FacilityType.clinic
        and not payload.department_id
    ):
        raise HTTPException(status_code=400, detail="Fachbereich erforderlich")
    if not payload.specialties:
        raise HTTPException(status_code=400, detail="Mindestens ein Fach muss ausgewählt werden")
    if users.get_by_email(payload.email):
        raise HTTPException(status_code=409, detail="E-Mail-Adresse bereits registriert")
    provider_id = f"provider-{uuid4().hex[:8]}"
    try:
        profile = repository.add_provider(
            facility_id=payload.facility_id,
            display_name=payload.display_name,
            email=payload.email,
            specialties=payload.specialties,
            department_id=payload.department_id,
            provider_id=provider_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    try:
        account = users.create_provider(
            facility_id=payload.facility_id,
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
            specialties=payload.specialties,
            provider_id=profile.id,
        )
    except (DuplicateEmailError, DuplicateAccountError) as error:
        repository.remove_provider(payload.facility_id, provider_id)
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IdentityStoreError as error:
        repository.remove_provider(payload.facility_id, provider_id)
        raise HTTPException(
            status_code=500, detail="Identitätsregister derzeit nicht verfügbar"
        ) from error
    return profile


def stable_hash(*components: str) -> str:
    """Create a stable, reproducible hash for audit payloads."""

    payload = "|".join(components)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@app.get("/facilities", response_model=list[schemas.FacilitySummary])
async def list_facilities(
    facility_type: Optional[schemas.FacilityType] = None,
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.FacilitySummary]:
    """List facilities across all types for discovery and filtering."""

    return repository.list_facility_summaries(facility_type=facility_type)


@app.get("/metadata/specialties", response_model=list[str])
async def list_specialties(
    repository: AppointmentRepository = Depends(get_repository),
) -> list[str]:
    """Expose the current specialty catalog for clients."""

    return repository.list_specialties()


@app.put("/admin/specialties", response_model=list[str])
async def update_specialty_catalog(
    payload: schemas.SpecialtyCatalog,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> list[str]:
    """Allow platform administrators to replace the specialty catalog."""

    require_roles(current, [schemas.UserRole.platform_admin])
    try:
        return repository.update_specialties(payload.specialties)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/facilities/{facility_id}", response_model=schemas.FacilityDetail)
async def get_facility_detail(
    facility_id: str,
    repository: AppointmentRepository = Depends(get_repository),
) -> schemas.FacilityDetail:
    """Retrieve the full detail of a facility."""

    facility = repository.get_facility(facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Einrichtung nicht gefunden")
    return facility


@app.get("/admin/facilities", response_model=list[schemas.FacilityDetail])
async def admin_list_facilities(
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.FacilityDetail]:
    require_roles(current, [schemas.UserRole.platform_admin])
    return repository.list_facilities()


@app.patch("/admin/facilities/{facility_id}", response_model=schemas.FacilityDetail)
async def admin_update_facility(
    facility_id: str,
    payload: schemas.FacilityUpdate,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> schemas.FacilityDetail:
    require_roles(current, [schemas.UserRole.platform_admin])
    try:
        return repository.update_facility(
            facility_id,
            name=payload.name,
            contact_email=payload.contact_email,
            phone_number=payload.phone_number,
            street=payload.street,
            city=payload.city,
            postal_code=payload.postal_code,
            specialties=payload.specialties,
            opening_hours=payload.opening_hours,
            owners=payload.owners,
        )
    except ValueError as error:
        message = str(error)
        status_code = 404 if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error


@app.delete("/admin/facilities/{facility_id}", status_code=204)
async def admin_remove_facility(
    facility_id: str,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    users: UserDirectory = Depends(get_user_directory),
) -> Response:
    require_roles(current, [schemas.UserRole.platform_admin])
    try:
        repository.remove_facility(facility_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    users.remove_facility_accounts(facility_id)
    return Response(status_code=204)


@app.get("/clinics", response_model=list[schemas.FacilitySummary])
async def list_clinics(
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.FacilitySummary]:
    """List clinics that are available for booking."""

    return repository.list_facility_summaries(
        facility_type=schemas.FacilityType.clinic
    )


@app.get("/appointments/search", response_model=list[schemas.AppointmentSlot])
async def search_appointments(
    specialty: Optional[str] = None,
    facility_id: Optional[str] = None,
    facility_type: Optional[schemas.FacilityType] = None,
    department_id: Optional[str] = None,
    provider_id: Optional[str] = None,
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.AppointmentSlot]:
    """Search appointments by specialty and facility filters."""

    specialty_filter = specialty.strip() if specialty else None
    return repository.search_slots(
        specialty=specialty_filter,
        facility_id=facility_id,
        facility_type=facility_type,
        department_id=department_id,
        provider_id=provider_id,
    )


@app.get("/facilities/search", response_model=list[schemas.FacilitySearchResult])
async def search_facilities(
    postal_code: Optional[str] = None,
    city: Optional[str] = None,
    specialty: Optional[str] = None,
    facility_type: Optional[schemas.FacilityType] = None,
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.FacilitySearchResult]:
    """Discover nearby facilities and their next available appointments."""

    specialty_filter = specialty.strip() if specialty else None
    results = repository.search_facilities_near(
        postal_code=postal_code,
        city=city,
        specialty=specialty_filter,
    )
    if facility_type:
        results = [
            result
            for result in results
            if result.facility.facility_type == facility_type
        ]
    return results


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

    facility = repository.get_facility(slot.facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Einrichtung für Slot nicht gefunden")

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

    if slot.facility_id not in record.consents:
        record.consents.append(slot.facility_id)

    vault.store(record)

    email_gateway.send_confirmation(
        to=current.patient_profile.email,
        subject="Terminbestätigung",
        body=(
            f"Hallo {current.patient_profile.first_name},\n\n"
            f"Ihr Termin bei {facility.name} am {slot.start:%d.%m.%Y %H:%M} Uhr wurde bestätigt."
        ),
    )

    return schemas.AppointmentConfirmation(
        appointment=slot,
        facility=to_summary(facility),
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
    record.appointments = [
        appointment for appointment in record.appointments if appointment.id != slot_id
    ]
    record.appointments.append(new_slot)
    if new_slot.facility_id not in record.consents:
        record.consents.append(new_slot.facility_id)
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
        facility = repository.get_facility(new_slot.facility_id)
        email_gateway.send_confirmation(
            to=current.patient_profile.email,
            subject="Termin verschoben",
            body=(
                f"Hallo {current.patient_profile.first_name},\n\n"
                f"Ihr Termin bei {(facility.name if facility else new_slot.facility_id)} wurde auf {new_slot.start:%d.%m.%Y %H:%M} Uhr verschoben."
            ),
        )

    return record


@app.get(
    "/medical/slots",
    response_model=list[schemas.AppointmentSlot],
)
async def list_facility_slots(
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.AppointmentSlot]:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    slots = repository.facility_slots(current.facility_id)
    return sorted(slots, key=lambda slot: slot.start)


@app.post(
    "/medical/slots",
    response_model=schemas.AppointmentSlot,
    status_code=201,
)
async def create_facility_slot(
    payload: schemas.SlotCreationRequest,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> schemas.AppointmentSlot:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    facility = repository.get_facility(current.facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Einrichtung nicht gefunden")
    payload_data = payload.model_dump()
    provider_id = payload_data.get("provider_id")
    if provider_id is None:
        if current.role == schemas.UserRole.provider:
            provider_id = current.id
        else:
            raise HTTPException(status_code=400, detail="Behandler erforderlich")
    if facility.facility_type == schemas.FacilityType.clinic:
        department_id = payload_data.get("department_id")
        if department_id is None:
            provider = next(
                (person for person in facility.providers if person.id == provider_id),
                None,
            )
            department_id = provider.department_id if provider else None
            if department_id is None and facility.departments:
                department_id = facility.departments[0].id
        if department_id is None:
            raise HTTPException(status_code=400, detail="Fachbereich erforderlich")
        payload_data["department_id"] = department_id
    payload_data["provider_id"] = provider_id
    slot = repository.create_slot(
        current.facility_id, schemas.SlotCreationRequest(**payload_data)
    )
    return slot


@app.patch(
    "/medical/slots/{slot_id}",
    response_model=schemas.AppointmentSlot,
)
async def update_facility_slot(
    slot_id: str,
    payload: schemas.SlotUpdateRequest,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.AppointmentSlot:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    slot = repository.get_slot(slot_id)
    if slot is None or slot.facility_id != current.facility_id:
        raise HTTPException(status_code=404, detail="Slot nicht gefunden")
    facility = repository.get_facility(current.facility_id)
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
                actor=current.facility_id,
                action="facility_update_slot",
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
                    f"Ihr Termin bei {(facility.name if facility else current.facility_id)} wurde auf {updated.start:%d.%m.%Y %H:%M} Uhr aktualisiert."
                ),
            )

    return updated


@app.post(
    "/medical/slots/{slot_id}/cancel",
    response_model=schemas.AppointmentSlot,
)
async def cancel_facility_slot(
    slot_id: str,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
    vault: PatientVault = Depends(get_vault),
    audit_logger: AuditLogger = Depends(get_audit_logger),
    email_gateway: EmailGateway = Depends(get_email_gateway),
) -> schemas.AppointmentSlot:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    slot = repository.get_slot(slot_id)
    if slot is None or slot.facility_id != current.facility_id:
        raise HTTPException(status_code=404, detail="Slot nicht gefunden")
    facility = repository.get_facility(current.facility_id)
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
                actor=current.facility_id,
                action="facility_cancel_slot",
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
                    f"Ihr Termin bei {(facility.name if facility else current.facility_id)} wurde abgesagt. Bitte buchen Sie einen neuen Termin."
                ),
            )
    return cancelled


@app.get(
    "/medical/bookings",
    response_model=list[schemas.ClinicBooking],
)
async def list_facility_bookings(
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.ClinicBooking]:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    bookings: list[schemas.ClinicBooking] = []
    for slot in repository.facility_slots(current.facility_id):
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
    repository: AppointmentRepository = Depends(get_repository),
) -> list[schemas.ProviderProfile]:
    require_roles(current, [schemas.UserRole.clinic_admin])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    facility = repository.get_facility(current.facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Einrichtung nicht gefunden")
    return facility.providers


@app.get("/medical/facility", response_model=schemas.FacilityDetail)
async def get_facility_profile(
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> schemas.FacilityDetail:
    require_roles(current, [schemas.UserRole.clinic_admin, schemas.UserRole.provider])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    facility = repository.get_facility(current.facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Einrichtung nicht gefunden")
    return facility


@app.patch("/medical/facility", response_model=schemas.FacilityDetail)
async def update_facility_profile(
    payload: schemas.FacilityUpdate,
    current: UserAccount = Depends(get_current_account),
    repository: AppointmentRepository = Depends(get_repository),
) -> schemas.FacilityDetail:
    require_roles(current, [schemas.UserRole.clinic_admin])
    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    try:
        updated = repository.update_facility(
            current.facility_id,
            contact_email=payload.contact_email,
            phone_number=payload.phone_number,
            street=payload.street,
            city=payload.city,
            postal_code=payload.postal_code,
            specialties=payload.specialties,
            opening_hours=payload.opening_hours,
            owners=payload.owners,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    return updated


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

    if current.facility_id is None:
        raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
    if current.facility_id not in record.consents:
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
        current.facility_id,
        event_timestamp.isoformat(),
    )
    audit_logger.append(
        schemas.AuditEvent(
            id=str(uuid4()),
            actor=current.facility_id,
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
    """Grant or revoke consent for a facility to access the patient's record."""

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
        if payload.requester_facility_id not in record.consents:
            record.consents.append(payload.requester_facility_id)
    else:
        record.consents = [
            facility_id
            for facility_id in record.consents
            if facility_id != payload.requester_facility_id
        ]
    vault.store(record)

    registry.record(
        PatientAccessRequest(
            patient_id=patient_id,
            facility_id=payload.requester_facility_id,
            timestamp=datetime.utcnow(),
        )
    )

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        patient_id,
        payload.requester_facility_id,
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
        facility_id=payload.requester_facility_id,
        granted=payload.grant,
        updated_at=datetime.utcnow(),
    )


@app.get("/patients/{patient_id}", response_model=schemas.PatientRecord)
async def get_patient_record(
    patient_id: str,
    requester_facility_id: Optional[str] = Query(
        None,
        description="Facility identifier requesting access to the patient record.",
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
        if current.facility_id is None:
            raise HTTPException(status_code=403, detail="Kontext der Einrichtung fehlt")
        if requester_facility_id is None:
            requester_facility_id = current.facility_id
        if requester_facility_id != current.facility_id:
            raise HTTPException(status_code=403, detail="Kontext der Einrichtung stimmt nicht überein")
        if requester_facility_id not in record.consents:
            raise HTTPException(status_code=403, detail="Access not granted by patient")
        event_actor = requester_facility_id
    elif current.role == schemas.UserRole.platform_admin:
        if requester_facility_id is None:
            requester_facility_id = current.id
    else:
        raise HTTPException(status_code=403, detail="Role not authorised for patient records")

    event_timestamp = datetime.utcnow()
    payload_hash = stable_hash(
        patient_id,
        requester_facility_id or current.id,
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
