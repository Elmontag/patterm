# Patterm Backend

This FastAPI project delivers the secure core services for the Patterm MVP:

- encrypted, per-patient storage that aligns with GDPR data-minimisation requirements
- append-only audit logging with hash chaining for ISO 27001 control evidence
- appointment search and booking workflows with role-aware endpoints
- consent management and GDPR-grade access governance for cross-clinic data sharing
- session/token handling with PBKDF2 password hashing and server-side session revocation

## Getting started

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --app-dir backend
```

The API docs are available at `http://127.0.0.1:8000/docs` once the server is running.

## Identity & data stores

- **Appointments & clinics:** Persisted in `backend/app/data/appointments.json` (including patient snapshots for
  gebuchte Slots). Die Datei wird initial mit Demo-Daten befüllt und kann durch die API erweitert werden.
- **Patient vault:** Verschlüsselte JSON-Dateien je Patient unter `backend/app/data/patients/`. Schlüsselverwaltung
  erfolgt über `backend/app/data/patient_keys.json`.
- **Benutzer & Sessions:** Passwörter werden per PBKDF2 gehasht in `backend/app/data/identity.json` abgelegt.
  Session-Tokens liegen serverseitig in `backend/app/data/sessions.json`.

## Facilities & scheduling endpoints

- `GET /facilities` liefert eine Übersicht aller Kliniken, Praxen und Gemeinschaftspraxen. Ein optionaler
  `facility_type`-Query-Parameter filtert auf einzelne Kategorien.
- `GET /facilities/{facility_id}` stellt Detailinformationen bereit: Öffnungszeiten, Telefonnummern,
  Fachbereiche (für Kliniken), Behandler:innen und Eigentümer:innen.
- `GET /facilities/search` kombiniert Standortparameter (PLZ, Stadt) mit medizinischen Filtern (Fachrichtung) und
  liefert zusätzlich die drei nächsten freien Slots je Einrichtung.
- `GET /appointments/search` greift auf die reine Slotliste zu. Filter für Einrichtung, Fachbereich, Behandler:in
  oder Fachrichtung lassen sich kombinieren.
- `PATCH /auth/profile` erlaubt Patient:innen und Klinik-/Praxispersonal, Anzeige-Namen sowie Telefonnummern
  anzupassen.

Kliniken definieren Fachbereiche mit einer Liste zugehöriger Behandler:innen. Praxen und Gemeinschaftspraxen
aggregieren Fachrichtungen aus den hinterlegten Ärzt:innenprofilen. Für Gemeinschaftspraxen erzwingt das Backend
mindestens zwei Eigentümer:innen, um Verantwortlichkeiten eindeutig zu dokumentieren.

## Authentifizierungsablauf (per HTTPie)

```bash
# 1) Patient:innen-Registrierung
http POST :8000/auth/register/patient \
  email=p.demo@example.com \
  password='Sicher!123' \
  first_name=Pat \
  last_name=Demo \
  date_of_birth=1990-01-01

# 2) Token aus der Antwort setzen
export TOKEN="<response.token>"
#    Die automatisch vergebene Patient:innen-ID finden Sie unter `response.user.id`.

# 3) Authentifiziert buchen (Authorization Header erforderlich)
http POST :8000/appointments \
  slot_id=slot-001 \
  "Authorization:Bearer $TOKEN"

# 4) Patient:innenakte abrufen
http GET :8000/patient/record "Authorization:Bearer $TOKEN"
```

Clinic-Admins und Behandler:innen verwenden `POST /auth/login`, erhalten ein Session-Token und greifen anschließend
auf `/medical/...`-Ressourcen zu. Alle abrufenden Endpunkte prüfen Rollen & Klinik-Kontext, bevor Einträge aus dem
verschlüsselten Tresor geliefert werden.

