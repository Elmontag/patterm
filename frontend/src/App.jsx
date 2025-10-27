import { useEffect, useMemo, useState } from "react";
import AppointmentCard from "./components/AppointmentCard.jsx";
import ComplianceNotice from "./components/ComplianceNotice.jsx";
import ConsentBadge from "./components/ConsentBadge.jsx";
import {
  bookAppointment,
  getClinics,
  getPatientRecord,
  searchAppointments,
  updateConsent
} from "./hooks/useApi.js";

const specialties = [
  { value: "", label: "Alle Fachrichtungen" },
  { value: "cardiology", label: "Kardiologie" },
  { value: "dermatology", label: "Dermatologie" },
  { value: "general_practice", label: "Hausarzt" },
  { value: "orthopedics", label: "Orthopädie" },
  { value: "pediatrics", label: "Pädiatrie" }
];

const emptyPatient = {
  id: "",
  email: "",
  first_name: "",
  last_name: "",
  date_of_birth: ""
};

export default function App() {
  const [clinics, setClinics] = useState([]);
  const [selectedClinic, setSelectedClinic] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [slots, setSlots] = useState([]);
  const [searching, setSearching] = useState(false);
  const [patient, setPatient] = useState(emptyPatient);
  const [bookingState, setBookingState] = useState({ status: "idle" });
  const [patientRecord, setPatientRecord] = useState(null);
  const [consentMessage, setConsentMessage] = useState("");

  useEffect(() => {
    getClinics()
      .then(setClinics)
      .catch(() => setClinics([]));
  }, []);

  useEffect(() => {
    if (clinics.length > 0) {
      setSelectedClinic(clinics[0].id);
    }
  }, [clinics]);

  const clinicLookup = useMemo(() => {
    const map = new Map();
    clinics.forEach((clinic) => map.set(clinic.id, clinic));
    return map;
  }, [clinics]);

  const handleSearch = async (event) => {
    event.preventDefault();
    setSearching(true);
    try {
      const params = {};
      if (selectedClinic) params.clinic_id = selectedClinic;
      if (selectedSpecialty) params.specialty = selectedSpecialty;
      const results = await searchAppointments(params);
      setSlots(results);
    } catch (error) {
      console.error(error);
    } finally {
      setSearching(false);
    }
  };

  const handleBook = async (slotId) => {
    if (!patient.id || !patient.email || !patient.first_name || !patient.last_name) {
      setBookingState({ status: "error", message: "Bitte alle Patientendaten ausfüllen." });
      return;
    }

    setBookingState({ status: "submitting" });
    try {
      const confirmation = await bookAppointment({
        slot_id: slotId,
        patient
      });
      setBookingState({ status: "success", confirmation });
      const bookedSlot = slots.find((slot) => slot.id === slotId);
      const clinicIdForRecord = bookedSlot?.clinic_id ?? selectedClinic;

      if (clinicIdForRecord) {
        try {
          const record = await getPatientRecord({
            patientId: patient.id,
            clinicId: clinicIdForRecord
          });
          setPatientRecord(record);
        } catch (error) {
          console.error("Failed to refresh patient record", error);
        }
      }
    } catch (error) {
      setBookingState({ status: "error", message: "Buchung fehlgeschlagen. Bitte erneut versuchen." });
    }
  };

  const handlePatientChange = (field, value) => {
    setPatient((prev) => ({ ...prev, [field]: value }));
  };

  const handleConsentChange = async (clinicId, grant) => {
    if (!patient.id) {
      setConsentMessage("Bitte geben Sie zunächst eine Patient:innen-ID an.");
      return;
    }

    try {
      await updateConsent({
        patientId: patient.id,
        requesterClinicId: clinicId,
        grant
      });
      setConsentMessage(
        grant
          ? "Zugriff erfolgreich freigegeben."
          : "Zugriff wurde entzogen."
      );
      if (grant) {
        try {
          const record = await getPatientRecord({
            patientId: patient.id,
            clinicId
          });
          setPatientRecord(record);
        } catch (error) {
          console.error("Konnte aktualisierte Patientendaten nicht laden", error);
        }
      } else {
        setPatientRecord((prev) =>
          prev
            ? {
                ...prev,
                consents: prev.consents.filter((consentId) => consentId !== clinicId)
              }
            : prev
        );
      }
    } catch (error) {
      setConsentMessage("Freigabe konnte nicht aktualisiert werden.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-500">Patterm</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Datenschutzkonformes Termin- und Patientenmanagement
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Buchen Sie klinische Termine DSGVO-konform, bestätigen Sie Behandlungen und behalten Sie
            die Kontrolle über Ihre Gesundheitsdaten.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-6 pt-8 lg:grid-cols-[2fr,1fr]">
        <section>
          <form onSubmit={handleSearch} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Termin finden</h2>
            <p className="mt-1 text-sm text-slate-500">
              Wählen Sie Fachrichtung und Klinik aus. Freie Slots werden nach ISO 27001 Richtlinien
              aus dem geprüften Terminregister geladen.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="text-sm">
                <span className="block text-xs font-semibold uppercase text-slate-500">Fachrichtung</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={selectedSpecialty}
                  onChange={(event) => setSelectedSpecialty(event.target.value)}
                >
                  {specialties.map((specialty) => (
                    <option key={specialty.value} value={specialty.value}>
                      {specialty.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm md:col-span-2">
                <span className="block text-xs font-semibold uppercase text-slate-500">Klinik</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={selectedClinic}
                  onChange={(event) => setSelectedClinic(event.target.value)}
                >
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name} · {clinic.city}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-700"
                disabled={searching}
              >
                {searching ? "Suche läuft…" : "Freie Termine anzeigen"}
              </button>
            </div>
          </form>

          <div className="mt-6 space-y-4">
            {slots.length === 0 && (
              <p className="text-sm text-slate-500">
                Noch keine Slots geladen. Starten Sie die Suche, um verfügbare Termine zu sehen.
              </p>
            )}
            {slots.map((slot) => (
              <AppointmentCard
                key={slot.id}
                slot={slot}
                clinic={clinicLookup.get(slot.clinic_id)}
                onBook={() => handleBook(slot.id)}
                disabled={bookingState.status === "submitting"}
              />
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Patient:innendaten</h2>
            <p className="mt-1 text-sm text-slate-500">
              Angaben werden ausschließlich verschlüsselt übertragen und gespeichert.
            </p>
            <div className="mt-4 space-y-3">
              {[
                { field: "id", label: "Patient:innen-ID" },
                { field: "email", label: "E-Mail" },
                { field: "first_name", label: "Vorname" },
                { field: "last_name", label: "Nachname" },
                { field: "date_of_birth", label: "Geburtsdatum", type: "date" }
              ].map(({ field, label, type = "text" }) => (
                <label key={field} className="block text-sm">
                  <span className="block text-xs font-semibold uppercase text-slate-500">{label}</span>
                  <input
                    type={type}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={patient[field]}
                    onChange={(event) => handlePatientChange(field, event.target.value)}
                    required={field !== "date_of_birth"}
                  />
                </label>
              ))}
            </div>
            {bookingState.status === "error" && (
              <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">
                {bookingState.message}
              </p>
            )}
            {bookingState.status === "success" && (
              <div className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800">
                Termin bestätigt · Vorgangsnummer {bookingState.confirmation.confirmation_number}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Zugriffsfreigaben</h2>
            <p className="mt-1 text-sm text-slate-500">
              Verwalten Sie, welche Klinik auf Ihre Daten zugreifen darf. Jede Änderung wird protokolliert.
            </p>
            <div className="mt-3 space-y-2">
              {clinics.map((clinic) => (
                <div key={clinic.id} className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">{clinic.name}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleConsentChange(clinic.id, true)}
                      className="rounded-lg border border-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      Freigeben
                    </button>
                    <button
                      onClick={() => handleConsentChange(clinic.id, false)}
                      className="rounded-lg border border-rose-400 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Sperren
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {consentMessage && (
              <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{consentMessage}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {patientRecord?.consents?.map((clinicId) => (
                <ConsentBadge
                  key={clinicId}
                  clinicName={clinicLookup.get(clinicId)?.name ?? clinicId}
                  granted
                />
              ))}
              {patientRecord && patientRecord.consents.length === 0 && (
                <span className="text-xs text-slate-500">Keine Freigaben erteilt.</span>
              )}
            </div>
          </section>

          {patientRecord && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Journal</h2>
              <p className="mt-1 text-sm text-slate-500">
                Versionierte Behandlungsnotizen mit vollständigem Audit-Trail.
              </p>
              <div className="mt-3 space-y-2">
                {patientRecord.treatment_notes.length === 0 && (
                  <p className="text-xs text-slate-500">Noch keine Einträge vorhanden.</p>
                )}
                {patientRecord.treatment_notes.map((note) => (
                  <article
                    key={note.version}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
                  >
                    <p className="font-semibold">Version {note.version} · {new Date(note.created_at).toLocaleString("de-DE")}</p>
                    <p className="mt-1">{note.summary}</p>
                    {note.next_steps && <p className="mt-1 text-slate-500">Nächste Schritte: {note.next_steps}</p>}
                  </article>
                ))}
              </div>
            </section>
          )}
        </aside>
      </main>

      <div className="mx-auto max-w-6xl px-6">
        <ComplianceNotice />
      </div>
    </div>
  );
}
