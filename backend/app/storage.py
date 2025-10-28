"""Encrypted per-patient storage, identity, and scheduling primitives."""
from __future__ import annotations

import json
import re
import secrets
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from hashlib import pbkdf2_hmac, sha256
from pathlib import Path
from typing import Callable, Iterable, Optional
from uuid import uuid4

from cryptography.fernet import Fernet

from . import schemas


def _ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


@dataclass
class AuditLogger:
    """Append-only audit trail with hash chaining."""

    audit_path: Path

    def append(self, event: schemas.AuditEvent) -> None:
        _ensure_directory(self.audit_path.parent)
        previous_hash = ""
        if self.audit_path.exists():
            with self.audit_path.open("rb") as handle:
                *_, last_line = handle.read().splitlines() or [b""]
            if last_line:
                previous_hash = json.loads(last_line.decode("utf-8")).get(
                    "payload_hash", ""
                )
        chained_hash = sha256(
            f"{event.payload_hash}{previous_hash}".encode("utf-8")
        ).hexdigest()
        payload = event.model_dump()
        payload["payload_hash"] = chained_hash
        with self.audit_path.open("ab") as handle:
            handle.write(json.dumps(payload, default=str).encode("utf-8"))
            handle.write(b"\n")


@dataclass
class PatientVault:
    """Simple encrypted file vault for patient records."""

    base_path: Path
    key_provider: Callable[[str], bytes]

    def _patient_file(self, patient_id: str) -> Path:
        return self.base_path / f"{patient_id}.json.enc"

    def load(self, patient_id: str) -> Optional[schemas.PatientRecord]:
        encrypted_file = self._patient_file(patient_id)
        if not encrypted_file.exists():
            return None
        fernet = Fernet(self.key_provider(patient_id))
        payload = encrypted_file.read_bytes()
        decrypted = fernet.decrypt(payload)
        data = json.loads(decrypted.decode("utf-8"))
        return schemas.PatientRecord.model_validate(data)

    def store(self, record: schemas.PatientRecord) -> None:
        _ensure_directory(self.base_path)
        fernet = Fernet(self.key_provider(record.profile.id))
        payload = record.model_dump_json().encode("utf-8")
        encrypted = fernet.encrypt(payload)
        self._patient_file(record.profile.id).write_bytes(encrypted)


class Keyring:
    """Manages per-patient encryption keys."""

    def __init__(self, key_path: Path) -> None:
        self.key_path = key_path
        _ensure_directory(self.key_path.parent)
        if not self.key_path.exists():
            self.key_path.write_text(json.dumps({}))

    def _load(self) -> dict:
        return json.loads(self.key_path.read_text())

    def _persist(self, keys: dict) -> None:
        self.key_path.write_text(json.dumps(keys))

    def get_key(self, patient_id: str) -> bytes:
        keys = self._load()
        key = keys.get(patient_id)
        if key is None:
            key = Fernet.generate_key().decode("utf-8")
            keys[patient_id] = key
            self._persist(keys)
        return key.encode("utf-8")


@dataclass
class AppointmentDataset:
    """Initial dataset for demo purposes."""

    clinics: Iterable[schemas.Clinic]
    slots: Iterable[schemas.AppointmentSlot]


def default_dataset() -> AppointmentDataset:
    """Seed data used by the FastAPI application."""

    return AppointmentDataset(
        clinics=[
            schemas.Clinic(
                id="c-berlin-cardio",
                name="GesundHerz Zentrum",
                specialty=schemas.Specialty.cardiology,
                city="Berlin",
                street="Friedrichstraße 12",
                postal_code="10117",
                contact_email="kontakt@gesundherz.de",
            ),
            schemas.Clinic(
                id="c-hamburg-derma",
                name="Hanse Derma Klinik",
                specialty=schemas.Specialty.dermatology,
                city="Hamburg",
                street="Jungfernstieg 5",
                postal_code="20095",
                contact_email="team@hanse-derma.de",
            ),
        ],
        slots=[
            schemas.AppointmentSlot(
                id="slot-001",
                clinic_id="c-berlin-cardio",
                start=datetime(2024, 6, 25, 9, 0),
                end=datetime(2024, 6, 25, 9, 30),
                is_virtual=False,
                status=schemas.SlotStatus.open,
            ),
            schemas.AppointmentSlot(
                id="slot-002",
                clinic_id="c-berlin-cardio",
                start=datetime(2024, 6, 25, 10, 0),
                end=datetime(2024, 6, 25, 10, 30),
                is_virtual=True,
                status=schemas.SlotStatus.open,
            ),
            schemas.AppointmentSlot(
                id="slot-003",
                clinic_id="c-hamburg-derma",
                start=datetime(2024, 6, 26, 14, 0),
                end=datetime(2024, 6, 26, 14, 30),
                is_virtual=False,
                status=schemas.SlotStatus.open,
            ),
        ],
    )


class AppointmentRepository:
    """Persistent appointment, clinic, and booking store."""

    def __init__(self, path: Path) -> None:
        self.path = path
        _ensure_directory(self.path.parent)
        if not self.path.exists():
            dataset = default_dataset()
            payload = {
                "clinics": [clinic.model_dump(mode="json") for clinic in dataset.clinics],
                "slots": [slot.model_dump(mode="json") for slot in dataset.slots],
            }
            self.path.write_text(json.dumps(payload, indent=2))

    def _load(self) -> dict:
        return json.loads(self.path.read_text())

    def _persist(self, data: dict) -> None:
        self.path.write_text(json.dumps(data, indent=2))

    def list_clinics(self) -> list[schemas.Clinic]:
        data = self._load()
        return [schemas.Clinic.model_validate(item) for item in data.get("clinics", [])]

    def get_clinic(self, clinic_id: str) -> Optional[schemas.Clinic]:
        return next((clinic for clinic in self.list_clinics() if clinic.id == clinic_id), None)

    def _slugify(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value)
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text).strip("-")
        slug = cleaned.lower()
        return slug or "clinic"

    def _generate_clinic_id(self, name: str, city: str) -> str:
        data = self._load()
        existing_ids = {clinic["id"] for clinic in data.get("clinics", [])}
        base = f"c-{self._slugify(name)}"
        if city:
            base = f"{base}-{self._slugify(city)}"
        candidate = base
        suffix = 1
        while candidate in existing_ids:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    def add_clinic(self, clinic: schemas.ClinicCreate) -> schemas.Clinic:
        data = self._load()
        clinic_id = self._generate_clinic_id(clinic.name, clinic.city)
        new_clinic = schemas.Clinic(
            id=clinic_id,
            name=clinic.name,
            specialty=clinic.specialty,
            city=clinic.city,
            street=clinic.street,
            postal_code=clinic.postal_code,
            contact_email=clinic.contact_email,
        )
        data.setdefault("clinics", []).append(new_clinic.model_dump(mode="json"))
        self._persist(data)
        return new_clinic

    def list_slots(self) -> list[schemas.AppointmentSlot]:
        data = self._load()
        return [
            schemas.AppointmentSlot.model_validate(item)
            for item in data.get("slots", [])
        ]

    def get_slot(self, slot_id: str) -> Optional[schemas.AppointmentSlot]:
        return next((slot for slot in self.list_slots() if slot.id == slot_id), None)

    def search_slots(
        self,
        *,
        specialty: Optional[schemas.Specialty] = None,
        clinic_id: Optional[str] = None,
        include_booked: bool = False,
        include_cancelled: bool = False,
    ) -> list[schemas.AppointmentSlot]:
        slots = self.list_slots()
        if specialty:
            clinic_ids = {
                clinic.id
                for clinic in self.list_clinics()
                if clinic.specialty == specialty
            }
            slots = [slot for slot in slots if slot.clinic_id in clinic_ids]
        if clinic_id:
            slots = [slot for slot in slots if slot.clinic_id == clinic_id]
        if not include_cancelled:
            slots = [slot for slot in slots if slot.status != schemas.SlotStatus.cancelled]
        if not include_booked:
            slots = [slot for slot in slots if slot.status == schemas.SlotStatus.open]
        return sorted(slots, key=lambda slot: slot.start)

    def clinic_slots(self, clinic_id: str) -> list[schemas.AppointmentSlot]:
        return [
            slot
            for slot in self.list_slots()
            if slot.clinic_id == clinic_id
        ]

    def _save_slots(self, slots: list[schemas.AppointmentSlot]) -> None:
        data = self._load()
        data["slots"] = [slot.model_dump(mode="json") for slot in slots]
        self._persist(data)

    def create_slot(
        self, clinic_id: str, payload: schemas.SlotCreationRequest
    ) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        slot = schemas.AppointmentSlot(
            id=f"slot-{uuid4().hex[:8]}",
            clinic_id=clinic_id,
            start=payload.start,
            end=payload.end,
            is_virtual=payload.is_virtual,
            status=schemas.SlotStatus.open,
        )
        slots.append(slot)
        self._save_slots(slots)
        return slot

    def update_slot(
        self, slot_id: str, payload: schemas.SlotUpdateRequest
    ) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated = slot
                break
        if updated is None:
            raise ValueError("Slot not found")
        if payload.start:
            updated.start = payload.start
        if payload.end:
            updated.end = payload.end
        if payload.is_virtual is not None:
            updated.is_virtual = payload.is_virtual
        slots[index] = updated
        self._save_slots(slots)
        return updated

    def cancel_slot(self, slot_id: str) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated = slot
                break
        if updated is None:
            raise ValueError("Slot not found")
        updated.status = schemas.SlotStatus.cancelled
        updated.booked_patient_id = None
        updated.patient_snapshot = None
        slots[index] = updated
        self._save_slots(slots)
        return updated

    def book_slot(
        self, slot_id: str, patient: schemas.PatientProfile
    ) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated = slot
                break
        if updated is None:
            raise ValueError("Slot not found")
        if updated.status != schemas.SlotStatus.open:
            raise ValueError("Slot cannot be booked")
        updated.status = schemas.SlotStatus.booked
        updated.booked_patient_id = patient.id
        updated.patient_snapshot = patient
        slots[index] = updated
        self._save_slots(slots)
        return updated

    def release_slot(self, slot_id: str) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated = slot
                break
        if updated is None:
            raise ValueError("Slot not found")
        updated.status = schemas.SlotStatus.open
        updated.booked_patient_id = None
        updated.patient_snapshot = None
        slots[index] = updated
        self._save_slots(slots)
        return updated


class EmailGateway:
    """Simple email gateway stub used to simulate confirmations."""

    def __init__(self) -> None:
        self.sent_messages: list[dict] = []

    def send_confirmation(self, to: str, subject: str, body: str) -> None:
        """Store the message in-memory. A real implementation would use SMTP."""
        self.sent_messages.append({"to": to, "subject": subject, "body": body})


@dataclass
class PatientAccessRequest:
    """Record of an access request for GDPR/ISO auditability."""

    patient_id: str
    clinic_id: str
    timestamp: datetime


class AccessRegistry:
    """Tracks which clinic requested access to which patient record."""

    def __init__(self, path: Path) -> None:
        self.path = path
        _ensure_directory(self.path.parent)
        if not self.path.exists():
            self.path.write_text(json.dumps([]))

    def record(self, request: PatientAccessRequest) -> None:
        data = json.loads(self.path.read_text())
        data.append(
            {
                "patient_id": request.patient_id,
                "clinic_id": request.clinic_id,
                "timestamp": request.timestamp.isoformat(),
            }
        )
        self.path.write_text(json.dumps(data, indent=2))


@dataclass
class UserAccount:
    """Internal representation of an authenticated user."""

    id: str
    email: str
    role: schemas.UserRole
    display_name: str
    password_hash: str
    salt: str
    clinic_id: Optional[str] = None
    patient_profile: Optional[schemas.PatientProfile] = None
    specialty: Optional[schemas.Specialty] = None


class UserDirectory:
    """Persists accounts and handles secure password storage."""

    def __init__(self, path: Path) -> None:
        self.path = path
        _ensure_directory(self.path.parent)
        if not self.path.exists():
            payload = {"users": []}
            self.path.write_text(json.dumps(payload, indent=2))

    def _load(self) -> dict:
        return json.loads(self.path.read_text())

    def _persist(self, payload: dict) -> None:
        self.path.write_text(json.dumps(payload, indent=2))

    def _hash_password(self, password: str) -> tuple[str, str]:
        salt_bytes = secrets.token_bytes(16)
        digest = pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, 480_000)
        return digest.hex(), salt_bytes.hex()

    def _hash_with_salt(self, password: str, salt_hex: str) -> str:
        salt_bytes = bytes.fromhex(salt_hex)
        return pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt_bytes, 480_000
        ).hex()

    def _hydrate(self, raw: dict) -> UserAccount:
        return UserAccount(
            id=raw["id"],
            email=raw["email"],
            role=schemas.UserRole(raw["role"]),
            display_name=raw["display_name"],
            password_hash=raw["password_hash"],
            salt=raw["salt"],
            clinic_id=raw.get("clinic_id"),
            patient_profile=
                schemas.PatientProfile.model_validate(raw["patient_profile"])
                if raw.get("patient_profile")
                else None,
            specialty=
                schemas.Specialty(raw["specialty"])
                if raw.get("specialty")
                else None,
        )

    def _dump(self, account: UserAccount) -> dict:
        payload = {
            "id": account.id,
            "email": account.email,
            "role": account.role.value,
            "display_name": account.display_name,
            "password_hash": account.password_hash,
            "salt": account.salt,
            "clinic_id": account.clinic_id,
            "patient_profile": account.patient_profile.model_dump(mode="json")
            if account.patient_profile
            else None,
            "specialty": account.specialty.value if account.specialty else None,
        }
        return payload

    def _all_accounts(self) -> list[UserAccount]:
        data = self._load()
        return [self._hydrate(item) for item in data.get("users", [])]

    def get_by_email(self, email: str) -> Optional[UserAccount]:
        return next((user for user in self._all_accounts() if user.email == email), None)

    def get(self, user_id: str) -> Optional[UserAccount]:
        return next((user for user in self._all_accounts() if user.id == user_id), None)

    def add(self, account: UserAccount) -> UserAccount:
        data = self._load()
        if any(existing["id"] == account.id for existing in data.get("users", [])):
            raise ValueError("User identifier already exists")
        if any(existing["email"] == account.email for existing in data.get("users", [])):
            raise ValueError("Email already registered")
        data.setdefault("users", []).append(self._dump(account))
        self._persist(data)
        return account

    def _generate_patient_id(self) -> str:
        existing_ids = {user.id for user in self._all_accounts()}
        while True:
            candidate = f"pat-{uuid4().hex[:10]}"
            if candidate not in existing_ids:
                return candidate

    def create_patient(self, registration: schemas.PatientRegistration) -> UserAccount:
        password_hash, salt = self._hash_password(registration.password)
        patient_id = self._generate_patient_id()
        profile = schemas.PatientProfile(
            id=patient_id,
            email=registration.email,
            first_name=registration.first_name,
            last_name=registration.last_name,
            date_of_birth=registration.date_of_birth,
        )
        account = UserAccount(
            id=patient_id,
            email=registration.email,
            role=schemas.UserRole.patient,
            display_name=f"{registration.first_name} {registration.last_name}",
            password_hash=password_hash,
            salt=salt,
            patient_profile=profile,
        )
        return self.add(account)

    def create_clinic_admin(
        self, *, clinic_id: str, email: str, password: str, display_name: str
    ) -> UserAccount:
        password_hash, salt = self._hash_password(password)
        account = UserAccount(
            id=f"admin-{clinic_id}",
            email=email,
            role=schemas.UserRole.clinic_admin,
            display_name=display_name,
            password_hash=password_hash,
            salt=salt,
            clinic_id=clinic_id,
        )
        return self.add(account)

    def create_provider(
        self,
        *,
        clinic_id: str,
        email: str,
        password: str,
        display_name: str,
        specialty: schemas.Specialty,
    ) -> UserAccount:
        password_hash, salt = self._hash_password(password)
        account = UserAccount(
            id=f"provider-{uuid4().hex[:8]}",
            email=email,
            role=schemas.UserRole.provider,
            display_name=display_name,
            password_hash=password_hash,
            salt=salt,
            clinic_id=clinic_id,
            specialty=specialty,
        )
        return self.add(account)

    def ensure_platform_admin(self) -> UserAccount:
        existing = next(
            (
                user
                for user in self._all_accounts()
                if user.role == schemas.UserRole.platform_admin
            ),
            None,
        )
        if existing:
            return existing
        password_hash, salt = self._hash_password("PattermAdmin!2024")
        account = UserAccount(
            id="platform-admin",
            email="admin@patterm.io",
            role=schemas.UserRole.platform_admin,
            display_name="Patterm Platform Admin",
            password_hash=password_hash,
            salt=salt,
        )
        return self.add(account)

    def authenticate(self, email: str, password: str) -> Optional[UserAccount]:
        account = self.get_by_email(email)
        if not account:
            return None
        digest = self._hash_with_salt(password, account.salt)
        if secrets.compare_digest(digest, account.password_hash):
            return account
        return None

    def list_providers(self, clinic_id: str) -> list[UserAccount]:
        return [
            user
            for user in self._all_accounts()
            if user.role == schemas.UserRole.provider and user.clinic_id == clinic_id
        ]


class SessionStore:
    """Persists issued session tokens."""

    def __init__(self, path: Path) -> None:
        self.path = path
        _ensure_directory(self.path.parent)
        if not self.path.exists():
            self.path.write_text(json.dumps({}))

    def _load(self) -> dict:
        return json.loads(self.path.read_text())

    def _persist(self, payload: dict) -> None:
        self.path.write_text(json.dumps(payload, indent=2))

    def issue(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        data = self._load()
        data[token] = {
            "user_id": user_id,
            "issued_at": datetime.utcnow().isoformat(),
        }
        self._persist(data)
        return token

    def resolve(self, token: str) -> Optional[str]:
        data = self._load()
        entry = data.get(token)
        return entry.get("user_id") if entry else None

