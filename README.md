# Patterm MVP

Patterm ist ein DSGVO- und ISO 27001-orientiertes Termin- und Patientenmanagement für ambulante Kliniken.
Dieses Repository enthält ein lauffähiges Minimum Viable Product bestehend aus einem FastAPI-Backend und
einer React/Vite-Oberfläche.

## Architekturüberblick

| Komponente | Technologie | Verantwortung |
| ---------- | ----------- | ------------- |
| `backend/` | FastAPI, Fernet | Verschlüsselte Patient:innendatenspeicherung, Audit-Trail, Terminbuchung |
| `frontend/` | React, TailwindCSS | Terminrecherche, Patienten-Self-Service, Consent-Steuerung |

Der Datenfluss ist so gestaltet, dass personenbezogene Daten ausschließlich verschlüsselt abgelegt werden.
Jeder Zugriff auf Patient:innenakten erzeugt einen kryptografisch verketteten Audit-Eintrag. Dadurch lassen
sich Integrität und Nachvollziehbarkeit nachweisen. Consent-Änderungen werden protokolliert, um
Rechenschaftspflichten aus der DSGVO zu erfüllen.

## Lokales Setup

```bash
# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --app-dir backend

# Frontend
cd frontend
npm install
npm run dev
```

Die React-Anwendung erwartet den API-Endpunkt unter `http://localhost:8000`. Dies lässt sich über die
Umgebungsvariable `VITE_API_URL` anpassen.

## Sicherheit und Compliance

- **Verschlüsselung:** Jeder Patient erhält einen eigenen Fernet-Schlüssel, der getrennt vom Datentresor
  verwaltet wird. Dateien in `backend/app/data/patients` sind nur verschlüsselt abgelegt.
- **Audit Trail:** `backend/app/data/audit.log` speichert Ereignisse mit Hash-Verkettung. Damit lassen sich
  unautorisierte Änderungen erkennen.
- **Datenminimierung:** Das Backend speichert nur die zur Terminabwicklung erforderlichen Attribute.
- **Consent Management:** Der Zugriff auf Behandlungsdaten erfolgt ausschließlich auf Basis aktiver Freigaben.

## Weitere Schritte

1. Anbindung eines E-Mail-Providers für echte Terminbestätigungen.
2. Ergänzung eines rollenbasierten Zugriffsmodells für ärztliches Personal.
3. Automatisierte Sicherheitstests und Policies (z. B. via Open Policy Agent) für ISO 27001 Kontrollmessungen.

