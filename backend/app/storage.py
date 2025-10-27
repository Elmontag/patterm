"""Encrypted per-patient storage and auditable logging."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import Callable, Iterable, Optional

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
class InMemoryDataset:
    """Initial dataset for demo purposes."""

    clinics: Iterable[schemas.Clinic]
    slots: Iterable[schemas.AppointmentSlot]


def default_dataset() -> InMemoryDataset:
    """Seed data used by the FastAPI application."""

    return InMemoryDataset(
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
            ),
            schemas.AppointmentSlot(
                id="slot-002",
                clinic_id="c-berlin-cardio",
                start=datetime(2024, 6, 25, 10, 0),
                end=datetime(2024, 6, 25, 10, 30),
                is_virtual=True,
            ),
            schemas.AppointmentSlot(
                id="slot-003",
                clinic_id="c-hamburg-derma",
                start=datetime(2024, 6, 26, 14, 0),
                end=datetime(2024, 6, 26, 14, 30),
                is_virtual=False,
            ),
        ],
    )


@dataclass
class AppointmentCatalog:
    """Read-only appointment catalog derived from the dataset."""

    dataset: InMemoryDataset

    def search(
        self,
        *,
        specialty: Optional[schemas.Specialty] = None,
        clinic_id: Optional[str] = None,
    ) -> list[schemas.AppointmentSlot]:
        results = [slot for slot in self.dataset.slots]
        if specialty:
            clinic_ids = {
                clinic.id for clinic in self.dataset.clinics if clinic.specialty == specialty
            }
            results = [slot for slot in results if slot.clinic_id in clinic_ids]
        if clinic_id:
            results = [slot for slot in results if slot.clinic_id == clinic_id]
        return sorted(results, key=lambda slot: slot.start)

    def clinic_by_id(self, clinic_id: str) -> Optional[schemas.Clinic]:
        return next((clinic for clinic in self.dataset.clinics if clinic.id == clinic_id), None)

    def slot_by_id(self, slot_id: str) -> Optional[schemas.AppointmentSlot]:
        return next((slot for slot in self.dataset.slots if slot.id == slot_id), None)


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

