import { ShieldCheckIcon } from "@heroicons/react/24/outline";

export default function ComplianceNotice() {
  return (
    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="flex items-start gap-3">
        <ShieldCheckIcon className="mt-0.5 h-6 w-6" />
        <div>
          <h3 className="font-semibold">Datenschutz und Informationssicherheit</h3>
          <p>
            Patterm speichert personenbezogene Daten ausschließlich verschlüsselt in
            patientenspezifischen Tresoren. Jeder Zugriff wird protokolliert und kann im
            Audit-Trail nachvollzogen werden. So erfüllen wir zentrale Anforderungen der
            DSGVO (u. a. Integrität, Vertraulichkeit, Zweckbindung) sowie ISO 27001
            Kontrollziele für Zugriffs- und Änderungsmanagement.
          </p>
        </div>
      </div>
    </div>
  );
}
