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


class IdentityStoreError(Exception):
    """Base error for identity persistence issues."""


class DuplicateAccountError(IdentityStoreError):
    """Raised when an identifier collision occurs in the identity registry."""


class DuplicateEmailError(IdentityStoreError):
    """Raised when attempting to register an email that already exists."""


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

    facilities: Iterable[schemas.FacilityDetail]
    slots: Iterable[schemas.AppointmentSlot]


def default_dataset() -> AppointmentDataset:
    """Seed data used by the FastAPI application."""

    berlin_departments = [
        schemas.ClinicDepartment(
            id="dep-cardio-berlin",
            name="Kardiologie",
            specialties=['cardiology'],
            provider_ids=["prov-schmidt", "prov-omer"],
        )
    ]
    hamburg_departments = [
        schemas.ClinicDepartment(
            id="dep-derma-hamburg",
            name="Dermatologie",
            specialties=['dermatology'],
            provider_ids=["prov-lu", "prov-isa"],
        )
    ]
    city_practice_providers = [
        schemas.ProviderProfile(
            id="prov-adler",
            display_name="Dr. Jana Adler",
            email="adler@citypraxis.de",
            specialties=['general_practice', 'pediatrics'],
            facility_id="p-berlin-city",
            department_id=None,
        ),
        schemas.ProviderProfile(
            id="prov-kaya",
            display_name="Dr. Mehmet Kaya",
            email="kaya@citypraxis.de",
            specialties=['general_practice'],
            facility_id="p-berlin-city",
            department_id=None,
        ),
    ]
    group_practice_providers = [
        schemas.ProviderProfile(
            id="prov-wagner",
            display_name="Dr. Leonie Wagner",
            email="wagner@medplus.de",
            specialties=['orthopedics'],
            facility_id="gp-hamburg-medplus",
            department_id=None,
        ),
        schemas.ProviderProfile(
            id="prov-maier",
            display_name="Dr. Florian Maier",
            email="maier@medplus.de",
            specialties=['dermatology'],
            facility_id="gp-hamburg-medplus",
            department_id=None,
        ),
    ]
    return AppointmentDataset(
        facilities=[
            schemas.FacilityDetail(
                id="c-berlin-cardio",
                name="GesundHerz Zentrum",
                facility_type=schemas.FacilityType.clinic,
                specialties=['cardiology'],
                city="Berlin",
                street="Friedrichstraße 12",
                postal_code="10117",
                contact_email="kontakt@gesundherz.de",
                phone_number="030-555555",
                opening_hours=[
                    schemas.OpeningHours(weekday=0, opens_at="08:00", closes_at="18:00"),
                    schemas.OpeningHours(weekday=1, opens_at="08:00", closes_at="18:00"),
                    schemas.OpeningHours(weekday=2, opens_at="08:00", closes_at="18:00"),
                    schemas.OpeningHours(weekday=3, opens_at="08:00", closes_at="18:00"),
                    schemas.OpeningHours(weekday=4, opens_at="08:00", closes_at="16:00"),
                ],
                departments=berlin_departments,
                providers=[
                    schemas.ProviderProfile(
                        id="prov-schmidt",
                        display_name="Dr. Anja Schmidt",
                        email="schmidt@gesundherz.de",
                        specialties=['cardiology'],
                        facility_id="c-berlin-cardio",
                        department_id="dep-cardio-berlin",
                    ),
                    schemas.ProviderProfile(
                        id="prov-omer",
                        display_name="Dr. Selim Ömer",
                        email="omer@gesundherz.de",
                        specialties=['cardiology'],
                        facility_id="c-berlin-cardio",
                        department_id="dep-cardio-berlin",
                    ),
                ],
                owners=["GesundHerz Betreiber GmbH"],
            ),
            schemas.FacilityDetail(
                id="c-hamburg-derma",
                name="Hanse Derma Klinik",
                facility_type=schemas.FacilityType.clinic,
                specialties=['dermatology'],
                city="Hamburg",
                street="Jungfernstieg 5",
                postal_code="20095",
                contact_email="team@hanse-derma.de",
                phone_number="040-222222",
                opening_hours=[
                    schemas.OpeningHours(weekday=0, opens_at="09:00", closes_at="17:00"),
                    schemas.OpeningHours(weekday=1, opens_at="09:00", closes_at="17:00"),
                    schemas.OpeningHours(weekday=2, opens_at="09:00", closes_at="17:00"),
                    schemas.OpeningHours(weekday=3, opens_at="09:00", closes_at="17:00"),
                    schemas.OpeningHours(weekday=4, opens_at="09:00", closes_at="15:00"),
                ],
                departments=hamburg_departments,
                providers=[
                    schemas.ProviderProfile(
                        id="prov-lu",
                        display_name="Dr. Yilin Lu",
                        email="lu@hanse-derma.de",
                        specialties=['dermatology'],
                        facility_id="c-hamburg-derma",
                        department_id="dep-derma-hamburg",
                    ),
                    schemas.ProviderProfile(
                        id="prov-isa",
                        display_name="Dr. Isabel Richter",
                        email="richter@hanse-derma.de",
                        specialties=['dermatology'],
                        facility_id="c-hamburg-derma",
                        department_id="dep-derma-hamburg",
                    ),
                ],
                owners=["Hanse Derma Betriebs GmbH"],
            ),
            schemas.FacilityDetail(
                id="p-berlin-city",
                name="City Praxis Mitte",
                facility_type=schemas.FacilityType.practice,
                specialties=['general_practice', 'pediatrics'],
                city="Berlin",
                street="Rosenthaler Platz 3",
                postal_code="10119",
                contact_email="service@citypraxis.de",
                phone_number="030-777777",
                opening_hours=[
                    schemas.OpeningHours(weekday=0, opens_at="08:00", closes_at="18:30"),
                    schemas.OpeningHours(weekday=1, opens_at="08:00", closes_at="18:30"),
                    schemas.OpeningHours(weekday=2, opens_at="08:00", closes_at="18:30"),
                    schemas.OpeningHours(weekday=3, opens_at="08:00", closes_at="18:30"),
                    schemas.OpeningHours(weekday=4, opens_at="08:00", closes_at="17:00"),
                    schemas.OpeningHours(weekday=5, opens_at="09:00", closes_at="13:00"),
                ],
                departments=[],
                providers=city_practice_providers,
                owners=["Dr. Jana Adler"],
            ),
            schemas.FacilityDetail(
                id="gp-hamburg-medplus",
                name="MedPlus Gemeinschaftspraxis",
                facility_type=schemas.FacilityType.group_practice,
                specialties=[
                    'orthopedics',
                    'dermatology',
                ],
                city="Hamburg",
                street="Mönckebergstraße 8",
                postal_code="20095",
                contact_email="kontakt@medplus.de",
                phone_number="040-999999",
                opening_hours=[
                    schemas.OpeningHours(weekday=0, opens_at="08:30", closes_at="18:00"),
                    schemas.OpeningHours(weekday=1, opens_at="08:30", closes_at="18:00"),
                    schemas.OpeningHours(weekday=2, opens_at="08:30", closes_at="18:00"),
                    schemas.OpeningHours(weekday=3, opens_at="08:30", closes_at="18:00"),
                    schemas.OpeningHours(weekday=4, opens_at="08:30", closes_at="16:00"),
                ],
                departments=[],
                providers=group_practice_providers,
                owners=["Dr. Leonie Wagner", "Dr. Florian Maier"],
            ),
        ],
        slots=[
            schemas.AppointmentSlot(
                id="slot-001",
                facility_id="c-berlin-cardio",
                department_id="dep-cardio-berlin",
                provider_id="prov-schmidt",
                provider_name="Dr. Anja Schmidt",
                start=datetime(2024, 6, 25, 9, 0),
                end=datetime(2024, 6, 25, 9, 30),
                is_virtual=False,
                status=schemas.SlotStatus.open,
            ),
            schemas.AppointmentSlot(
                id="slot-002",
                facility_id="c-berlin-cardio",
                department_id="dep-cardio-berlin",
                provider_id="prov-omer",
                provider_name="Dr. Selim Ömer",
                start=datetime(2024, 6, 25, 10, 0),
                end=datetime(2024, 6, 25, 10, 30),
                is_virtual=True,
                status=schemas.SlotStatus.open,
            ),
            schemas.AppointmentSlot(
                id="slot-003",
                facility_id="c-hamburg-derma",
                department_id="dep-derma-hamburg",
                provider_id="prov-lu",
                provider_name="Dr. Yilin Lu",
                start=datetime(2024, 6, 26, 14, 0),
                end=datetime(2024, 6, 26, 14, 30),
                is_virtual=False,
                status=schemas.SlotStatus.open,
            ),
            schemas.AppointmentSlot(
                id="slot-004",
                facility_id="p-berlin-city",
                department_id=None,
                provider_id="prov-adler",
                provider_name="Dr. Jana Adler",
                start=datetime(2024, 6, 24, 11, 0),
                end=datetime(2024, 6, 24, 11, 30),
                is_virtual=False,
                status=schemas.SlotStatus.open,
            ),
            schemas.AppointmentSlot(
                id="slot-005",
                facility_id="gp-hamburg-medplus",
                department_id=None,
                provider_id="prov-maier",
                provider_name="Dr. Florian Maier",
                start=datetime(2024, 6, 27, 13, 0),
                end=datetime(2024, 6, 27, 13, 45),
                is_virtual=False,
                status=schemas.SlotStatus.open,
            ),
        ],
    )


class AppointmentRepository:
    """Persistent facility, provider, and booking store."""

    def __init__(self, path: Path) -> None:
        self.path = path
        _ensure_directory(self.path.parent)
        if not self.path.exists():
            dataset = default_dataset()
            catalog: set[str] = set()
            for facility in dataset.facilities:
                catalog.update(filter(None, facility.specialties))
                for department in facility.departments:
                    catalog.update(filter(None, department.specialties))
                for provider in facility.providers:
                    catalog.update(filter(None, provider.specialties))
            payload = {
                "facilities": [
                    facility.model_dump(mode="json") for facility in dataset.facilities
                ],
                "slots": [slot.model_dump(mode="json") for slot in dataset.slots],
                "specialties": sorted(catalog),
            }
            self.path.write_text(json.dumps(payload, indent=2))

    def _load(self) -> dict:
        return json.loads(self.path.read_text())

    def _persist(self, data: dict) -> None:
        self.path.write_text(json.dumps(data, indent=2))

    def _summary_from_detail(
        self, facility: schemas.FacilityDetail
    ) -> schemas.FacilitySummary:
        return schemas.FacilitySummary(
            id=facility.id,
            name=facility.name,
            facility_type=facility.facility_type,
            specialties=facility.specialties,
            city=facility.city,
            street=facility.street,
            postal_code=facility.postal_code,
            contact_email=facility.contact_email,
            phone_number=facility.phone_number,
        )

    def list_specialties(self) -> list[str]:
        data = self._load()
        stored = data.get("specialties")
        if stored:
            return stored
        catalog: set[str] = set()
        for facility in self.list_facilities():
            catalog.update(filter(None, facility.specialties))
            for department in facility.departments:
                catalog.update(filter(None, department.specialties))
            for provider in facility.providers:
                catalog.update(filter(None, provider.specialties))
        specialties = sorted(catalog)
        data["specialties"] = specialties
        self._persist(data)
        return specialties

    def update_specialties(self, specialties: list[str]) -> list[str]:
        normalised: list[str] = []
        seen: set[str] = set()
        for entry in specialties:
            if entry is None:
                continue
            cleaned = re.sub(r"\s+", " ", entry.strip())
            if not cleaned:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            normalised.append(cleaned)
            seen.add(key)
        if not normalised:
            raise ValueError("Mindestens eine Fachdisziplin erforderlich")
        data = self._load()
        data["specialties"] = normalised
        self._persist(data)
        return normalised

    def list_facilities(self) -> list[schemas.FacilityDetail]:
        data = self._load()
        facilities = [
            schemas.FacilityDetail.model_validate(item)
            for item in data.get("facilities", [])
        ]
        return [self._prepare_facility(facility) for facility in facilities]

    def list_facility_summaries(
        self, *, facility_type: Optional[schemas.FacilityType] = None
    ) -> list[schemas.FacilitySummary]:
        facilities = self.list_facilities()
        if facility_type:
            facilities = [
                facility
                for facility in facilities
                if facility.facility_type == facility_type
            ]
        return [self._summary_from_detail(facility) for facility in facilities]

    def get_facility(self, facility_id: str) -> Optional[schemas.FacilityDetail]:
        facility = next(
            (facility for facility in self.list_facilities() if facility.id == facility_id),
            None,
        )
        return self._prepare_facility(facility) if facility else None

    def _slugify(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKD", value)
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text).strip("-")
        slug = cleaned.lower()
        return slug or "facility"

    def _prefix_for_type(self, facility_type: schemas.FacilityType) -> str:
        if facility_type == schemas.FacilityType.practice:
            return "p"
        if facility_type == schemas.FacilityType.group_practice:
            return "gp"
        return "c"

    def _generate_facility_id(
        self, name: str, city: str, facility_type: schemas.FacilityType
    ) -> str:
        data = self._load()
        existing_ids = {facility["id"] for facility in data.get("facilities", [])}
        base = f"{self._prefix_for_type(facility_type)}-{self._slugify(name)}"
        if city:
            base = f"{base}-{self._slugify(city)}"
        candidate = base
        suffix = 1
        while candidate in existing_ids:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    def _save_facilities(self, facilities: list[schemas.FacilityDetail]) -> None:
        data = self._load()
        prepared = [self._prepare_facility(facility) for facility in facilities]
        data["facilities"] = [
            facility.model_dump(mode="json") for facility in prepared
        ]
        self._persist(data)

    def _prepare_facility(
        self, facility: schemas.FacilityDetail
    ) -> schemas.FacilityDetail:
        prepared = facility.model_copy(deep=True)
        provider_map = {provider.id: provider for provider in prepared.providers}
        for department in prepared.departments:
            department.providers = [
                provider_map[provider_id]
                for provider_id in department.provider_ids
                if provider_id in provider_map
            ]
        if prepared.facility_type in {
            schemas.FacilityType.practice,
            schemas.FacilityType.group_practice,
        }:
            seen: set[str] = set()
            ordered: list[str] = []
            for specialty in prepared.specialties:
                if specialty not in seen:
                    ordered.append(specialty)
                    seen.add(specialty)
            for provider in prepared.providers:
                for specialty in provider.specialties:
                    if specialty not in seen:
                        ordered.append(specialty)
                        seen.add(specialty)
            prepared.specialties = ordered
        return prepared

    def add_facility(
        self,
        facility: schemas.FacilityCreate,
        *,
        departments: Optional[list[schemas.DepartmentCreate]] = None,
        owners: Optional[list[str]] = None,
    ) -> schemas.FacilityDetail:
        facilities = self.list_facilities()
        facility_id = self._generate_facility_id(
            facility.name, facility.city, facility.facility_type
        )
        owners = owners or []
        if not facility.specialties:
            raise ValueError("Mindestens eine Fachdisziplin erforderlich")
        catalog = set(self.list_specialties())
        missing = [spec for spec in facility.specialties if spec not in catalog]
        if missing:
            raise ValueError(
                "Fachdisziplin nicht im Katalog: " + ", ".join(sorted(set(missing)))
            )
        if (
            facility.facility_type == schemas.FacilityType.group_practice
            and len(owners) < 2
        ):
            raise ValueError(
                "Gemeinschaftspraxen benötigen mindestens zwei Eigentümer:innen"
            )
        department_models: list[schemas.ClinicDepartment] = []
        if facility.facility_type == schemas.FacilityType.clinic:
            for index, department in enumerate(departments or [], start=1):
                department_missing = [
                    spec for spec in department.specialties if spec not in catalog
                ]
                if department_missing:
                    raise ValueError(
                        "Fachbereich enthält unbekannte Fächer: "
                        + ", ".join(sorted(set(department_missing)))
                    )
                department_models.append(
                    schemas.ClinicDepartment(
                        id=f"dep-{self._slugify(department.name)}-{index}",
                        name=department.name,
                        specialties=department.specialties,
                        provider_ids=[],
                    )
                )
            if not department_models:
                default_specialty = facility.specialties[0]
                department_models.append(
                    schemas.ClinicDepartment(
                        id=f"dep-{self._slugify(default_specialty)}",
                        name=re.sub(r"[_-]+", " ", default_specialty).title(),
                        specialties=facility.specialties,
                        provider_ids=[],
                    )
                )
        detail = schemas.FacilityDetail(
            id=facility_id,
            name=facility.name,
            facility_type=facility.facility_type,
            specialties=facility.specialties,
            city=facility.city,
            street=facility.street,
            postal_code=facility.postal_code,
            contact_email=facility.contact_email,
            phone_number=facility.phone_number,
            opening_hours=facility.opening_hours,
            departments=department_models,
            providers=[],
            owners=owners,
        )
        facilities.append(detail)
        self._save_facilities(facilities)
        return self._prepare_facility(detail)

    def update_facility(
        self,
        facility_id: str,
        *,
        name: Optional[str] = None,
        contact_email: Optional[str] = None,
        phone_number: Optional[str] = None,
        street: Optional[str] = None,
        city: Optional[str] = None,
        postal_code: Optional[str] = None,
        specialties: Optional[list[str]] = None,
        opening_hours: Optional[list[schemas.OpeningHours]] = None,
        owners: Optional[list[str]] = None,
    ) -> schemas.FacilityDetail:
        facilities = self.list_facilities()
        updated = None
        for index, facility in enumerate(facilities):
            if facility.id == facility_id:
                updated = facility
                break
        if updated is None:
            raise ValueError("Facility not found")
        if name:
            updated.name = name
        if contact_email:
            updated.contact_email = contact_email
        if phone_number:
            updated.phone_number = phone_number
        if street:
            updated.street = street
        if city:
            updated.city = city
        if postal_code:
            updated.postal_code = postal_code
        if specialties is not None:
            if not specialties:
                raise ValueError("Mindestens eine Fachdisziplin erforderlich")
            catalog = set(self.list_specialties())
            missing = [spec for spec in specialties if spec not in catalog]
            if missing:
                raise ValueError(
                    "Fachdisziplin nicht im Katalog: "
                    + ", ".join(sorted(set(missing)))
                )
            updated.specialties = specialties
        if opening_hours is not None:
            updated.opening_hours = opening_hours
        if owners is not None:
            updated.owners = owners
        facilities[index] = updated
        self._save_facilities(facilities)
        return self._prepare_facility(updated)

    def remove_facility(self, facility_id: str) -> None:
        data = self._load()
        facilities = data.get("facilities", [])
        remaining = [
            facility for facility in facilities if facility.get("id") != facility_id
        ]
        if len(remaining) == len(facilities):
            raise ValueError("Facility not found")
        data["facilities"] = remaining
        data["slots"] = [
            slot for slot in data.get("slots", []) if slot.get("facility_id") != facility_id
        ]
        self._persist(data)

    def _save_slots(self, slots: list[schemas.AppointmentSlot]) -> None:
        data = self._load()
        data["slots"] = [slot.model_dump(mode="json") for slot in slots]
        self._persist(data)

    def list_slots(self) -> list[schemas.AppointmentSlot]:
        data = self._load()
        return [
            schemas.AppointmentSlot.model_validate(item)
            for item in data.get("slots", [])
        ]

    def get_slot(self, slot_id: str) -> Optional[schemas.AppointmentSlot]:
        return next((slot for slot in self.list_slots() if slot.id == slot_id), None)

    def facility_slots(self, facility_id: str) -> list[schemas.AppointmentSlot]:
        return [
            slot
            for slot in self.list_slots()
            if slot.facility_id == facility_id
        ]

    def list_providers(self, facility_id: str) -> list[schemas.ProviderProfile]:
        facility = self.get_facility(facility_id)
        return facility.providers if facility else []

    def add_provider(
        self,
        *,
        facility_id: str,
        display_name: str,
        email: str,
        specialties: list[str],
        department_id: Optional[str] = None,
        provider_id: Optional[str] = None,
    ) -> schemas.ProviderProfile:
        facilities = self.list_facilities()
        target_index = None
        for index, facility in enumerate(facilities):
            if facility.id == facility_id:
                target_index = index
                break
        if target_index is None:
            raise ValueError("Facility not found")
        facility = facilities[target_index]
        catalog = set(self.list_specialties())
        missing_specialties = [spec for spec in specialties if spec not in catalog]
        if missing_specialties:
            raise ValueError(
                "Fachdisziplin nicht im Katalog: "
                + ", ".join(sorted(set(missing_specialties)))
            )
        specialties = list(dict.fromkeys(specialties))
        provider_id = provider_id or f"provider-{uuid4().hex[:8]}"
        profile = schemas.ProviderProfile(
            id=provider_id,
            display_name=display_name,
            email=email,
            specialties=specialties,
            facility_id=facility_id,
            department_id=department_id,
        )
        facility.providers.append(profile)
        if department_id:
            for department in facility.departments:
                if department.id == department_id:
                    if provider_id not in department.provider_ids:
                        department.provider_ids.append(provider_id)
                    if not any(
                        provider.id == provider_id for provider in department.providers
                    ):
                        department.providers.append(profile)
        facilities[target_index] = facility
        self._save_facilities(facilities)
        return profile

    def remove_provider(self, facility_id: str, provider_id: str) -> None:
        facilities = self.list_facilities()
        target_index = None
        for index, facility in enumerate(facilities):
            if facility.id == facility_id:
                target_index = index
                break
        if target_index is None:
            return
        facility = facilities[target_index]
        facility.providers = [
            provider for provider in facility.providers if provider.id != provider_id
        ]
        for department in facility.departments:
            if provider_id in department.provider_ids:
                department.provider_ids = [
                    pid for pid in department.provider_ids if pid != provider_id
                ]
            department.providers = [
                provider
                for provider in department.providers
                if provider.id != provider_id
            ]
        facilities[target_index] = facility
        self._save_facilities(facilities)

    def search_slots(
        self,
        *,
        specialty: Optional[str] = None,
        facility_id: Optional[str] = None,
        facility_type: Optional[schemas.FacilityType] = None,
        department_id: Optional[str] = None,
        provider_id: Optional[str] = None,
        include_booked: bool = False,
        include_cancelled: bool = False,
    ) -> list[schemas.AppointmentSlot]:
        slots = self.list_slots()
        if facility_id:
            slots = [slot for slot in slots if slot.facility_id == facility_id]
        if department_id:
            slots = [slot for slot in slots if slot.department_id == department_id]
        if provider_id:
            slots = [slot for slot in slots if slot.provider_id == provider_id]
        if specialty:
            facility_ids = {
                facility.id
                for facility in self.list_facilities()
                if specialty in facility.specialties
                or any(
                    specialty in department.specialties
                    for department in facility.departments
                )
            }
            slots = [slot for slot in slots if slot.facility_id in facility_ids]
        if facility_type:
            allowed_ids = {
                facility.id
                for facility in self.list_facilities()
                if facility.facility_type == facility_type
            }
            slots = [slot for slot in slots if slot.facility_id in allowed_ids]
        if not include_cancelled:
            slots = [slot for slot in slots if slot.status != schemas.SlotStatus.cancelled]
        if not include_booked:
            slots = [slot for slot in slots if slot.status == schemas.SlotStatus.open]
        return sorted(slots, key=lambda slot: slot.start)

    def create_slot(
        self, facility_id: str, payload: schemas.SlotCreationRequest
    ) -> schemas.AppointmentSlot:
        facility = self.get_facility(facility_id)
        if facility is None:
            raise ValueError("Facility not found")
        provider_id = payload.provider_id
        if provider_id is None and facility.providers:
            provider_id = facility.providers[0].id
        provider_name = None
        if provider_id and not any(
            provider.id == provider_id for provider in facility.providers
        ):
            raise ValueError("Provider not part of facility")
        if provider_id:
            provider = next(
                (prov for prov in facility.providers if prov.id == provider_id),
                None,
            )
            provider_name = provider.display_name if provider else None
        department_id = payload.department_id
        if department_id and not any(
            department.id == department_id for department in facility.departments
        ):
            raise ValueError("Department not part of facility")
        if facility.facility_type == schemas.FacilityType.clinic and not department_id:
            department_id = facility.departments[0].id if facility.departments else None
        slots = self.list_slots()
        slot = schemas.AppointmentSlot(
            id=f"slot-{uuid4().hex[:8]}",
            facility_id=facility_id,
            department_id=department_id,
            provider_id=provider_id,
            provider_name=provider_name,
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
        updated_index = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated_index = index
                break
        if updated_index is None:
            raise ValueError("Slot not found")
        updated = slots[updated_index]
        if payload.start:
            updated.start = payload.start
        if payload.end:
            updated.end = payload.end
        if payload.is_virtual is not None:
            updated.is_virtual = payload.is_virtual
        if payload.provider_id is not None:
            facility = self.get_facility(updated.facility_id)
            if facility and any(
                provider.id == payload.provider_id for provider in facility.providers
            ):
                updated.provider_id = payload.provider_id
                provider = next(
                    (
                        provider
                        for provider in facility.providers
                        if provider.id == payload.provider_id
                    ),
                    None,
                )
                updated.provider_name = (
                    provider.display_name if provider else updated.provider_name
                )
        if payload.department_id is not None:
            facility = self.get_facility(updated.facility_id)
            if facility and any(
                department.id == payload.department_id
                for department in facility.departments
            ):
                updated.department_id = payload.department_id
        slots[updated_index] = updated
        self._save_slots(slots)
        return updated

    def cancel_slot(self, slot_id: str) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated_index = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated_index = index
                break
        if updated_index is None:
            raise ValueError("Slot not found")
        updated = slots[updated_index]
        updated.status = schemas.SlotStatus.cancelled
        updated.booked_patient_id = None
        updated.patient_snapshot = None
        slots[updated_index] = updated
        self._save_slots(slots)
        return updated

    def book_slot(
        self, slot_id: str, patient: schemas.PatientProfile
    ) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated_index = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated_index = index
                break
        if updated_index is None:
            raise ValueError("Slot not found")
        updated = slots[updated_index]
        if updated.status != schemas.SlotStatus.open:
            raise ValueError("Slot cannot be booked")
        updated.status = schemas.SlotStatus.booked
        updated.booked_patient_id = patient.id
        updated.patient_snapshot = patient
        slots[updated_index] = updated
        self._save_slots(slots)
        return updated

    def release_slot(self, slot_id: str) -> schemas.AppointmentSlot:
        slots = self.list_slots()
        updated_index = None
        for index, slot in enumerate(slots):
            if slot.id == slot_id:
                updated_index = index
                break
        if updated_index is None:
            raise ValueError("Slot not found")
        updated = slots[updated_index]
        updated.status = schemas.SlotStatus.open
        updated.booked_patient_id = None
        updated.patient_snapshot = None
        slots[updated_index] = updated
        self._save_slots(slots)
        return updated

    def next_open_slots(
        self, facility_id: str, *, limit: int = 3
    ) -> list[schemas.AppointmentSlot]:
        slots = self.search_slots(
            facility_id=facility_id, include_booked=False, include_cancelled=False
        )
        return slots[:limit]

    def search_facilities_near(
        self,
        *,
        postal_code: Optional[str] = None,
        city: Optional[str] = None,
        specialty: Optional[str] = None,
        limit: int = 10,
    ) -> list[schemas.FacilitySearchResult]:
        facilities = self.list_facilities()
        if specialty:
            facilities = [
                facility
                for facility in facilities
                if specialty in facility.specialties
                or any(
                    specialty in department.specialties
                    for department in facility.departments
                )
            ]

        def score(facility: schemas.FacilityDetail) -> int:
            points = 0
            if postal_code:
                if facility.postal_code == postal_code:
                    points += 4
                elif facility.postal_code[:2] == postal_code[:2]:
                    points += 2
            if city and facility.city.lower() == city.lower():
                points += 3
            return points

        facilities.sort(key=lambda facility: (-score(facility), facility.name))
        results = []
        for facility in facilities[:limit]:
            results.append(
                schemas.FacilitySearchResult(
                    facility=facility,
                    next_slots=self.next_open_slots(facility.id, limit=3),
                )
            )
        return results


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
    facility_id: str
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
                "facility_id": request.facility_id,
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
    facility_id: Optional[str] = None
    patient_profile: Optional[schemas.PatientProfile] = None
    specialties: Optional[list[str]] = None


class UserDirectory:
    """Persists accounts and handles secure password storage."""

    def __init__(self, path: Path) -> None:
        self.path = path
        _ensure_directory(self.path.parent)
        if not self.path.exists():
            payload = {"users": []}
            self.path.write_text(json.dumps(payload, indent=2))

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except json.JSONDecodeError as error:
            raise IdentityStoreError("Identitätsregister beschädigt") from error

    def _persist(self, payload: dict) -> None:
        self.path.write_text(json.dumps(payload, indent=2))

    def _normalize_email(self, email: str) -> str:
        return email.strip().lower()

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
            email=self._normalize_email(raw["email"]),
            role=schemas.UserRole(raw["role"]),
            display_name=raw["display_name"],
            password_hash=raw["password_hash"],
            salt=raw["salt"],
            facility_id=raw.get("facility_id"),
            patient_profile=
                schemas.PatientProfile.model_validate(raw["patient_profile"])
                if raw.get("patient_profile")
                else None,
            specialties=raw.get("specialties") or None,
        )

    def _dump(self, account: UserAccount) -> dict:
        payload = {
            "id": account.id,
            "email": account.email,
            "role": account.role.value,
            "display_name": account.display_name,
            "password_hash": account.password_hash,
            "salt": account.salt,
            "facility_id": account.facility_id,
            "patient_profile": account.patient_profile.model_dump(mode="json")
            if account.patient_profile
            else None,
            "specialties": account.specialties or None,
        }
        return payload

    def _all_accounts(self) -> list[UserAccount]:
        data = self._load()
        return [self._hydrate(item) for item in data.get("users", [])]

    def get_by_email(self, email: str) -> Optional[UserAccount]:
        normalized = self._normalize_email(email)
        return next(
            (
                user
                for user in self._all_accounts()
                if self._normalize_email(user.email) == normalized
            ),
            None,
        )

    def get(self, user_id: str) -> Optional[UserAccount]:
        return next((user for user in self._all_accounts() if user.id == user_id), None)

    def add(self, account: UserAccount) -> UserAccount:
        data = self._load()
        users = data.setdefault("users", [])
        normalized_email = self._normalize_email(account.email)
        for existing in users:
            if existing["id"] == account.id:
                raise DuplicateAccountError("Benutzerkennung bereits vergeben")
            if self._normalize_email(existing["email"]) == normalized_email:
                raise DuplicateEmailError("E-Mail-Adresse bereits registriert")
        users.append(self._dump(account))
        self._persist(data)
        return account

    def save(self, account: UserAccount) -> UserAccount:
        data = self._load()
        users = data.setdefault("users", [])
        for index, existing in enumerate(users):
            if existing["id"] == account.id:
                users[index] = self._dump(account)
                self._persist(data)
                return account
        raise IdentityStoreError("Benutzerkonto nicht gefunden")

    def _generate_patient_id(self) -> str:
        existing_ids = {user.id for user in self._all_accounts()}
        while True:
            candidate = f"pat-{uuid4().hex[:10]}"
            if candidate not in existing_ids:
                return candidate

    def create_patient(self, registration: schemas.PatientRegistration) -> UserAccount:
        password_hash, salt = self._hash_password(registration.password)
        patient_id = self._generate_patient_id()
        normalized_email = self._normalize_email(registration.email)
        profile = schemas.PatientProfile(
            id=patient_id,
            email=normalized_email,
            first_name=registration.first_name,
            last_name=registration.last_name,
            date_of_birth=registration.date_of_birth,
            phone_number=registration.phone_number,
        )
        account = UserAccount(
            id=patient_id,
            email=normalized_email,
            role=schemas.UserRole.patient,
            display_name=f"{registration.first_name} {registration.last_name}",
            password_hash=password_hash,
            salt=salt,
            patient_profile=profile,
        )
        return self.add(account)

    def create_facility_admin(
        self, *, facility_id: str, email: str, password: str, display_name: str
    ) -> UserAccount:
        password_hash, salt = self._hash_password(password)
        account = UserAccount(
            id=f"admin-{facility_id}",
            email=self._normalize_email(email),
            role=schemas.UserRole.clinic_admin,
            display_name=display_name,
            password_hash=password_hash,
            salt=salt,
            facility_id=facility_id,
        )
        return self.add(account)

    def create_provider(
        self,
        *,
        facility_id: str,
        email: str,
        password: str,
        display_name: str,
        specialties: list[str],
        provider_id: Optional[str] = None,
    ) -> UserAccount:
        password_hash, salt = self._hash_password(password)
        identifier = provider_id or f"provider-{uuid4().hex[:8]}"
        unique_specialties = list(dict.fromkeys(specialties)) or None
        account = UserAccount(
            id=identifier,
            email=self._normalize_email(email),
            role=schemas.UserRole.provider,
            display_name=display_name,
            password_hash=password_hash,
            salt=salt,
            facility_id=facility_id,
            specialties=unique_specialties,
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
            email=self._normalize_email("admin@patterm.io"),
            role=schemas.UserRole.platform_admin,
            display_name="Patterm Platform Admin",
            password_hash=password_hash,
            salt=salt,
        )
        return self.add(account)

    def authenticate(self, email: str, password: str) -> Optional[UserAccount]:
        account = self.get_by_email(self._normalize_email(email))
        if not account:
            return None
        digest = self._hash_with_salt(password, account.salt)
        if secrets.compare_digest(digest, account.password_hash):
            return account
        return None

    def list_providers(self, facility_id: str) -> list[UserAccount]:
        return [
            user
            for user in self._all_accounts()
            if user.role == schemas.UserRole.provider and user.facility_id == facility_id
        ]

    def remove_facility_accounts(self, facility_id: str) -> None:
        data = self._load()
        users = data.setdefault("users", [])
        filtered = [
            user for user in users if user.get("facility_id") != facility_id
        ]
        if len(filtered) != len(users):
            data["users"] = filtered
            self._persist(data)


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

