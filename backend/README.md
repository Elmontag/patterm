# Patterm Backend

This FastAPI project delivers the secure core services for the Patterm MVP:

- encrypted, per-patient storage that aligns with GDPR data-minimisation requirements
- append-only audit logging with hash chaining for ISO 27001 control evidence
- appointment search and booking workflows for patients and clinics
- consent management to govern cross-clinic access to patient records

## Getting started

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --app-dir backend
```

The API docs are available at `http://127.0.0.1:8000/docs` once the server is running.

## Demo dataset

The application ships with a small in-memory dataset of clinics and appointment slots. Patient data is
persisted per patient in `backend/app/data/patients/` using Fernet symmetric encryption keys managed in
`backend/app/data/patient_keys.json`.

## Testing the patient vault

```bash
http POST :8000/appointments slot_id=slot-001 \
  patient:='{"id":"p-001","email":"anna@example.com","first_name":"Anna","last_name":"Muster","date_of_birth":"1984-05-01"}'
```

The booking call creates the encrypted patient store, sends a confirmation mail through the in-memory
email gateway, and appends an audit event. Treatment notes and consent updates behave similarly.

