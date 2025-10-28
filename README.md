# Patterm MVP

Patterm ist ein DSGVO- und ISO 27001-orientiertes Termin- und Patientenmanagement für ambulante Kliniken.
Dieses Repository enthält ein lauffähiges Minimum Viable Product bestehend aus einem FastAPI-Backend und
einer React/Vite-Oberfläche.

## Architekturüberblick

| Komponente | Technologie | Verantwortung |
| ---------- | ----------- | ------------- |
| `backend/` | FastAPI, Fernet | Verschlüsselte Patient:innendatenspeicherung, Audit-Trail, Terminbuchung |
| `frontend/` | React, TailwindCSS | Rollenbasiertes Patienten-, Medical- und Admin-Dashboard |

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

## Docker-Compose-Setup

Für einen vollständig containerisierten Start existiert ein `docker-compose.yml`, das Backend und Frontend
inklusive Health-Checks orchestriert.

```bash
# Erstaufbau und Start
docker compose up --build

# Stoppen (Container bleiben erhalten)
docker compose down

# Stoppen und Daten löschen (verschlüsselter Patient:innentresor wird zurückgesetzt)
docker compose down -v
```

Die Dienste laufen anschließend unter folgenden Endpunkten:

- Backend API: http://localhost:8000 (persistente Vault-Daten via Volume `backend-data`)
- Frontend UI: http://localhost:5173 (nutzt standardmäßig `http://localhost:8000` als API-Basis)

Möchten Sie eine andere API-URL verwenden, kann `VITE_API_URL` in der `docker-compose.yml` oder über
`docker compose run -e VITE_API_URL=…` überschrieben werden.

## Rollen, Authentifizierung und Workflows

Die Anwendung stellt mehrere fein granulare Rollen bereit:

- **Patient:innen** registrieren sich frei, buchen und verschieben Termine, verwalten Freigaben und sehen
  Behandlungsnotizen im persönlichen Dashboard (`/patient`).
- **Clinic Admins** werden von der Plattformadministration angelegt, pflegen Slots, verwalten Behandler:innen und
  rufen Patientenakten ihrer Klinik ab (`/medical`).
- **Behandler:innen** erhalten ihre Zugänge durch die Klinikverwaltung und sehen ausschließlich medizinische
  Arbeitsansichten mit Slotsteuerung und Konsultationsakten.
- **Platform Admin** kann neue Praxen/Kliniken registrieren und initiale Clinic-Admins provisionieren.

### Standardzugänge

Nach dem ersten Start erzeugt das Backend automatisch einen Plattform-Admin:

- Benutzer: `admin@patterm.io`
- Passwort: `PattermAdmin!2024`

### Registrierungsschritte

1. **Patient:innen** wählen „Patient:innen-Registrierung“ im Landing-Formular, erhalten sofort einen Login und
   sehen anschließend das Patientendashboard. Die persönliche Patient:innen-ID wird automatisch vergeben und im
   Dashboard angezeigt.
2. **Platform Admin** meldet sich mit dem Standardzugang an, legt über das Admin-Dashboard neue Kliniken inkl.
   Klinik-Admin an und teilt die Zugangsdaten aus. Die Klinik-ID generiert das System und blendet sie nach der
   Registrierung im Portal ein.
3. **Clinic Admin** loggt sich ein, erstellt Behandler:innenaccounts und pflegt Terminslots (erstellen, ändern,
   absagen). Bei Slotänderungen oder -absagen werden Patient:innen automatisch informiert und der Audit-Trail
   ergänzt.
4. **Behandler:innen** authentifizieren sich mit ihren Klinikzugängen und sehen aktuelle Buchungen inkl.
   Patient:innensnapshot bei vorliegender Freigabe.

### Sicherheits- und Compliance-Maßnahmen

- **Verschlüsselung:** Jeder Patient erhält einen eigenen Fernet-Schlüssel, der getrennt vom Datentresor
  verwaltet wird. Dateien in `backend/app/data/patients` sind ausschließlich verschlüsselt abgelegt.
- **Audit Trail:** `backend/app/data/audit.log` speichert Ereignisse mit SHA-256-verketteten Hashes. Damit lassen
  sich unautorisierte Änderungen erkennen und revisionssicher belegen.
- **Feingranulare Autorisierung:** Tokens werden per PBKDF2 gehasht gespeichert. Sitzungen werden serverseitig
  verwaltet, Rollenprüfungen sichern jeden Endpoint ab (Patient vs. Clinic vs. Admin).
- **Consent Management:** Freigaben werden ausschließlich von Patient:innen gesteuert. Clinic-Abrufe prüfen
  automatisch, ob eine gültige Zustimmung für die anfragende Klinik vorliegt.

## Weitere Schritte

1. Anbindung eines produktiven E-Mail-Providers für DSGVO-konforme Terminkommunikation.
2. Erweiterung um SSO-/IdP-Integration (z. B. OpenID Connect) für Unternehmenskunden.
3. Automatisierte Sicherheitstests und Compliance-Monitoring (z. B. Open Policy Agent, CIS Benchmarks).

