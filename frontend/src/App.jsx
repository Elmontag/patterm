import { useEffect, useMemo, useState } from "react";
import AppointmentCard from "./components/AppointmentCard.jsx";
import ComplianceNotice from "./components/ComplianceNotice.jsx";
import ConsentBadge from "./components/ConsentBadge.jsx";
import {
  bookPatientAppointment,
  cancelClinicSlot,
  cancelPatientAppointment,
  createClinicSlot,
  fetchPatientRecordForClinic,
  fetchProfile,
  getClinicBookings,
  getClinicProviders,
  getClinicSlots,
  getClinics,
  getOwnRecord,
  login,
  registerClinic,
  registerPatient,
  registerProvider,
  reschedulePatientAppointment,
  searchAppointments,
  setAuthToken,
  updateClinicSlot,
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

const readToken = () => localStorage.getItem("patterm:token") ?? "";
const readUser = () => {
  const raw = localStorage.getItem("patterm:user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const formatDateTime = (iso) =>
  new Date(iso).toLocaleString("de-DE", {
    dateStyle: "long",
    timeStyle: "short"
  });

function FooterPlaceholder() {
  return (
    <footer className="mt-16 border-t border-blue-100 bg-white/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-6 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
        <span>© {new Date().getFullYear()} Patterm Connect</span>
        <div className="flex flex-wrap gap-4">
          <span>Impressum</span>
          <span>Datenschutz</span>
          <span>Copyright</span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const [token, setToken] = useState(readToken);
  const [user, setUser] = useState(readUser);
  const [clinics, setClinics] = useState([]);
  const [searchFilters, setSearchFilters] = useState({ clinicId: "", specialty: "" });
  const [slots, setSlots] = useState([]);
  const [searching, setSearching] = useState(false);
  const [patientRecord, setPatientRecord] = useState(null);
  const [bookingMessage, setBookingMessage] = useState("");
  const [consentMessage, setConsentMessage] = useState("");
  const [rescheduleContext, setRescheduleContext] = useState(null);
  const [medicalSlots, setMedicalSlots] = useState([]);
  const [medicalBookings, setMedicalBookings] = useState([]);
  const [providers, setProviders] = useState([]);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [providerFeedback, setProviderFeedback] = useState("");
  const [clinicPatientId, setClinicPatientId] = useState("");
  const [clinicPatientRecord, setClinicPatientRecord] = useState(null);
  const [clinicPatientError, setClinicPatientError] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [pendingAuth, setPendingAuth] = useState(false);
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [editValues, setEditValues] = useState({ start: "", end: "", isVirtual: false });

  useEffect(() => {
    const initialise = async () => {
      try {
        const data = await getClinics();
        setClinics(data);
      } catch (error) {
        setClinics([]);
      }
    };
    initialise();
  }, []);

  useEffect(() => {
    if (clinics.length > 0 && !searchFilters.clinicId) {
      setSearchFilters((prev) => ({ ...prev, clinicId: clinics[0].id }));
    }
  }, [clinics, searchFilters.clinicId]);

  useEffect(() => {
    if (!token) {
      setAuthToken();
      localStorage.removeItem("patterm:token");
      return;
    }
    setAuthToken(token);
    localStorage.setItem("patterm:token", token);
    const loadProfile = async () => {
      try {
        const profile = await fetchProfile();
        setUser(profile);
        localStorage.setItem("patterm:user", JSON.stringify(profile));
      } catch (error) {
        handleLogout();
      }
    };
    loadProfile();
  }, [token]);

  useEffect(() => {
    if (!user) {
      setPatientRecord(null);
      setMedicalSlots([]);
      setMedicalBookings([]);
      setProviders([]);
      return;
    }
    if (user.role === "patient") {
      refreshPatientRecord();
    }
    if (user.role === "clinic_admin" || user.role === "provider") {
      refreshMedicalData();
    }
  }, [user]);

  const clinicLookup = useMemo(() => {
    const map = new Map();
    clinics.forEach((clinic) => map.set(clinic.id, clinic));
    return map;
  }, [clinics]);

  const handleAuthSuccess = (auth) => {
    setToken(auth.token);
    setUser(auth.user);
    localStorage.setItem("patterm:user", JSON.stringify(auth.user));
    setAuthError("");
  };

  const handleLogout = () => {
    setToken("");
    setUser(null);
    setPatientRecord(null);
    setMedicalSlots([]);
    setMedicalBookings([]);
    setProviders([]);
    setClinicPatientRecord(null);
    setClinicPatientId("");
    setAuthToken();
    localStorage.removeItem("patterm:token");
    localStorage.removeItem("patterm:user");
  };

  const refreshPatientRecord = async () => {
    if (!token || !user || user.role !== "patient") return;
    try {
      const record = await getOwnRecord();
      setPatientRecord(record);
    } catch (error) {
      setPatientRecord(null);
    }
  };

  const refreshMedicalData = async () => {
    if (!token || !user || (user.role !== "clinic_admin" && user.role !== "provider")) {
      return;
    }
    try {
      const [slotsData, bookingsData] = await Promise.all([
        getClinicSlots(),
        getClinicBookings()
      ]);
      setMedicalSlots(slotsData);
      setMedicalBookings(bookingsData);
      if (user.role === "clinic_admin") {
        const providerData = await getClinicProviders();
        setProviders(providerData);
      }
    } catch (error) {
      setMedicalSlots([]);
      setMedicalBookings([]);
      setProviders([]);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    setSearching(true);
    try {
      const params = {};
      if (searchFilters.clinicId) params.clinic_id = searchFilters.clinicId;
      if (searchFilters.specialty) params.specialty = searchFilters.specialty;
      const results = await searchAppointments(params);
      setSlots(results);
    } catch (error) {
      setSlots([]);
    } finally {
      setSearching(false);
    }
  };

  const handleBook = async (slotId) => {
    if (!user || user.role !== "patient") {
      setBookingMessage("Bitte zuerst im Patientendashboard anmelden.");
      return;
    }
    try {
      if (rescheduleContext) {
        await reschedulePatientAppointment({ slotId: rescheduleContext.id, newSlotId: slotId });
        setBookingMessage("Termin erfolgreich verschoben.");
        setRescheduleContext(null);
      } else {
        await bookPatientAppointment(slotId);
        setBookingMessage("Termin erfolgreich gebucht.");
      }
      await refreshPatientRecord();
    } catch (error) {
      setBookingMessage("Termin konnte nicht verarbeitet werden.");
    }
  };

  const handleCancelAppointment = async (slotId) => {
    try {
      await cancelPatientAppointment(slotId);
      setBookingMessage("Termin storniert.");
      await refreshPatientRecord();
    } catch (error) {
      setBookingMessage("Termin konnte nicht storniert werden.");
    }
  };

  const handleConsentChange = async (clinicId, grant) => {
    if (!user) return;
    try {
      await updateConsent({
        patientId: user.id,
        requesterClinicId: clinicId,
        grant
      });
      setConsentMessage(grant ? "Zugriff freigegeben." : "Zugriff entzogen.");
      await refreshPatientRecord();
    } catch (error) {
      setConsentMessage("Freigabe konnte nicht aktualisiert werden.");
    }
  };

  const handleRegisterPatient = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPendingAuth(true);
    try {
      const auth = await registerPatient({
        email: form.get("email"),
        password: form.get("password"),
        first_name: form.get("first_name"),
        last_name: form.get("last_name"),
        date_of_birth: form.get("date_of_birth")
      });
      handleAuthSuccess(auth);
      setAuthMode("login");
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setAuthError(detail ?? "Registrierung fehlgeschlagen. Bitte Angaben prüfen.");
    } finally {
      setPendingAuth(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPendingAuth(true);
    try {
      const auth = await login({
        email: form.get("email"),
        password: form.get("password")
      });
      handleAuthSuccess(auth);
    } catch (error) {
      setAuthError("Login fehlgeschlagen. Bitte Zugangsdaten prüfen.");
    } finally {
      setPendingAuth(false);
    }
  };

  const handleCreateSlot = async (event) => {
    event.preventDefault();
    setCreatingSlot(true);
    const form = new FormData(event.currentTarget);
    const start = form.get("start");
    const end = form.get("end");
    const isVirtual = form.get("is_virtual") === "on";
    try {
      await createClinicSlot({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        is_virtual: isVirtual
      });
      event.currentTarget.reset();
      setAdminFeedback("Slot veröffentlicht.");
      await refreshMedicalData();
    } catch (error) {
      setAdminFeedback("Slot konnte nicht angelegt werden.");
    } finally {
      setCreatingSlot(false);
    }
  };

  const startEditingSlot = (slot) => {
    setEditingSlotId(slot.id);
    setEditValues({
      start: slot.start.slice(0, 16),
      end: slot.end.slice(0, 16),
      isVirtual: slot.is_virtual
    });
  };

  const submitSlotUpdate = async (event) => {
    event.preventDefault();
    if (!editingSlotId) return;
    try {
      await createUpdatePayload();
      setAdminFeedback("Slot aktualisiert.");
      setEditingSlotId(null);
      await refreshMedicalData();
    } catch (error) {
      setAdminFeedback("Slot konnte nicht aktualisiert werden.");
    }
  };

  const createUpdatePayload = async () => {
    const payload = {};
    if (editValues.start) payload.start = new Date(editValues.start).toISOString();
    if (editValues.end) payload.end = new Date(editValues.end).toISOString();
    payload.is_virtual = editValues.isVirtual;
    await updateClinicSlot({ slotId: editingSlotId, ...payload });
  };

  const handleCancelSlot = async (slotId) => {
    try {
      await cancelClinicSlot(slotId);
      setAdminFeedback("Slot abgesagt.");
      await refreshMedicalData();
    } catch (error) {
      setAdminFeedback("Slot konnte nicht storniert werden.");
    }
  };

  const handleRegisterClinic = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await registerClinic({
        clinic: {
          name: form.get("clinic_name"),
          specialty: form.get("clinic_specialty"),
          city: form.get("clinic_city"),
          street: form.get("clinic_street"),
          postal_code: form.get("clinic_postal"),
          contact_email: form.get("clinic_email")
        },
        admin_email: form.get("admin_email"),
        admin_password: form.get("admin_password"),
        admin_display_name: form.get("admin_display")
      });
      setAdminFeedback(`Klinik erfolgreich registriert. ID: ${result.clinic.id}`);
      event.currentTarget.reset();
      const updated = await getClinics();
      setClinics(updated);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setAdminFeedback(
        detail ?? "Klinik konnte nicht registriert werden."
      );
    }
  };

  const handleRegisterProvider = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await registerProvider({
        clinic_id: user?.clinic_id ?? "",
        email: form.get("provider_email"),
        password: form.get("provider_password"),
        display_name: form.get("provider_name"),
        specialty: form.get("provider_specialty")
      });
      setProviderFeedback("Behandler:in angelegt.");
      event.currentTarget.reset();
      await refreshMedicalData();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setProviderFeedback(detail ?? "Registrierung fehlgeschlagen.");
    }
  };

  const handleClinicPatientLookup = async (event) => {
    event.preventDefault();
    if (!clinicPatientId) return;
    try {
      const record = await fetchPatientRecordForClinic({
        patientId: clinicPatientId,
        clinicId: user?.clinic_id ?? ""
      });
      setClinicPatientRecord(record);
      setClinicPatientError("");
    } catch (error) {
      setClinicPatientRecord(null);
      setClinicPatientError("Patientenakte konnte nicht geladen werden.");
    }
  };

  const patientAppointments = patientRecord?.appointments ?? [];
  const consentedClinicIds = patientRecord?.consents ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-blue-100">
      <header className="bg-gradient-to-r from-sky-600 via-blue-600 to-blue-700 pb-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-white md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg font-bold">
                PC
              </span>
              <span className="text-lg font-semibold tracking-wide">Patterm Connect</span>
            </div>
            <h1 className="mt-4 text-3xl font-bold">Verlässliches Termin- und Patientendashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-100">
              Ein Portal, drei Blickwinkel: Patient:innen behalten Termine und Freigaben im Griff,
              medizinische Teams steuern Verfügbarkeiten, die Plattformadministration schaltet neue
              Standorte frei – alles DSGVO- und ISO-konform.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 text-sm">
            {user ? (
              <>
                <span className="rounded-full bg-white/20 px-4 py-1 font-semibold uppercase tracking-wide">
                  Angemeldet als {user.display_name} · {user.role}
                </span>
                <button
                  onClick={handleLogout}
                  className="rounded-lg bg-white/20 px-4 py-2 font-semibold text-white transition hover:bg-white/30"
                >
                  Abmelden
                </button>
              </>
            ) : (
              <span className="rounded-full bg-white/20 px-4 py-1 text-sm text-blue-100">
                Bitte anmelden oder registrieren, um persönliche Bereiche zu nutzen.
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="-mt-12 space-y-12 pb-16">
        {!user && (
          <section className="mx-auto max-w-6xl rounded-3xl bg-white p-8 shadow-xl">
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Schneller Einstieg</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Patterm Connect verbindet sichere Authentifizierung, verschlüsselte Datenräume
                  und einen klaren Workflow für Patient:innen und Behandlungsteams.
                </p>
                <ComplianceNotice />
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-blue-900">
                    {authMode === "login" ? "Anmeldung" : "Patient:innen-Registrierung"}
                  </h3>
                  <button
                    onClick={() => {
                      setAuthMode(authMode === "login" ? "register" : "login");
                      setAuthError("");
                    }}
                    className="text-sm font-semibold text-blue-700 hover:underline"
                  >
                    {authMode === "login" ? "Neu hier?" : "Schon registriert?"}
                  </button>
                </div>
                {authError && <p className="mt-3 text-sm text-rose-600">{authError}</p>}
                {authMode === "login" ? (
                  <form onSubmit={handleLogin} className="mt-4 space-y-4">
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">E-Mail</span>
                      <input
                        name="email"
                        type="email"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Passwort</span>
                      <input
                        name="password"
                        type="password"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={pendingAuth}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      Einloggen
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleRegisterPatient} className="mt-4 grid gap-4 sm:grid-cols-2">
                    <p className="sm:col-span-2 text-xs font-medium text-blue-700">
                      Die Plattform vergibt Ihre Patient:innen-ID automatisch und zeigt sie nach dem Login an.
                    </p>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">E-Mail</span>
                      <input
                        name="email"
                        type="email"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Vorname</span>
                      <input
                        name="first_name"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Nachname</span>
                      <input
                        name="last_name"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Geburtsdatum</span>
                      <input
                        name="date_of_birth"
                        type="date"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Passwort</span>
                      <input
                        name="password"
                        type="password"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        disabled={pendingAuth}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        Konto erstellen
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </section>
        )}

        {user?.role === "patient" && (
          <section className="mx-auto max-w-6xl space-y-10">
            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-900">Mein Zugang</h2>
              <p className="mt-1 text-sm text-slate-600">
                Nutzen Sie diese Kennung bei Rückfragen. Nur berechtigte Stellen sehen Ihre ID.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2">
                <span className="text-xs font-semibold uppercase text-blue-700">Patient:innen-ID</span>
                <code className="text-sm font-mono text-blue-900">{user.id}</code>
              </div>
            </div>
            <div className="rounded-3xl bg-white p-8 shadow-lg">
              <h2 className="text-xl font-semibold text-slate-900">Termin finden</h2>
              <p className="mt-1 text-sm text-slate-600">
                Wählen Sie Fachrichtung und Standort. Freie Slots werden live aus dem
                verschlüsselten Terminregister geladen.
              </p>
              <form onSubmit={handleSearch} className="mt-4 grid gap-4 md:grid-cols-4">
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Klinik</span>
                  <select
                    value={searchFilters.clinicId}
                    onChange={(event) =>
                      setSearchFilters((prev) => ({ ...prev, clinicId: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    {clinics.map((clinic) => (
                      <option key={clinic.id} value={clinic.id}>
                        {clinic.name} · {clinic.city}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtung</span>
                  <select
                    value={searchFilters.specialty}
                    onChange={(event) =>
                      setSearchFilters((prev) => ({ ...prev, specialty: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    {specialties.map((specialty) => (
                      <option key={specialty.value} value={specialty.value}>
                        {specialty.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-2 flex items-end justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white shadow hover:bg-blue-700"
                  >
                    {searching ? "Suche läuft..." : "Verfügbare Slots anzeigen"}
                  </button>
                </div>
              </form>

              {bookingMessage && (
                <p className="mt-3 text-sm font-medium text-blue-700">{bookingMessage}</p>
              )}

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {slots.length === 0 ? (
                  <p className="text-sm text-slate-500">Aktuell keine Slots für die Auswahl verfügbar.</p>
                ) : (
                  slots.map((slot) => (
                    <AppointmentCard
                      key={slot.id}
                      slot={slot}
                      clinic={clinicLookup.get(slot.clinic_id)}
                      onBook={() => handleBook(slot.id)}
                      disabled={false}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-[1.4fr,1fr]">
              <div className="rounded-3xl bg-white p-8 shadow-lg">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-slate-900">Meine Termine</h2>
                  {rescheduleContext && (
                    <button
                      onClick={() => setRescheduleContext(null)}
                      className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                      Verschieben abbrechen
                    </button>
                  )}
                </div>
                <div className="mt-4 space-y-4">
                  {patientAppointments.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Noch keine Termine gebucht. Nutzen Sie die Suche, um verfügbare Slots zu finden.
                    </p>
                  ) : (
                    patientAppointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {clinicLookup.get(appointment.clinic_id)?.name ?? appointment.clinic_id}
                            </p>
                            <p className="text-sm text-slate-600">{formatDateTime(appointment.start)}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setRescheduleContext(appointment)}
                              className="rounded-lg border border-blue-200 px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              Verschieben
                            </button>
                            <button
                              onClick={() => handleCancelAppointment(appointment.id)}
                              className="rounded-lg border border-rose-200 px-3 py-1 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                            >
                              Absagen
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl bg-white p-8 shadow-lg">
                <h2 className="text-xl font-semibold text-slate-900">Freigaben verwalten</h2>
                {consentMessage && (
                  <p className="mt-2 text-sm text-blue-600">{consentMessage}</p>
                )}
                <div className="mt-4 space-y-3">
                  {clinics.map((clinic) => {
                    const granted = consentedClinicIds.includes(clinic.id);
                    return (
                      <div
                        key={clinic.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{clinic.name}</p>
                          <p className="text-xs text-slate-500">{clinic.city}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <ConsentBadge clinicName={clinic.name} granted={granted} />
                          <button
                            onClick={() => handleConsentChange(clinic.id, !granted)}
                            className={`rounded-lg px-3 py-1 text-sm font-semibold ${
                              granted
                                ? "border border-rose-200 text-rose-600 hover:bg-rose-50"
                                : "border border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                            }`}
                          >
                            {granted ? "Entziehen" : "Freigeben"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {patientRecord?.treatment_notes?.length > 0 && (
              <div className="rounded-3xl bg-white p-8 shadow-lg">
                <h2 className="text-xl font-semibold text-slate-900">Behandlungsnotizen</h2>
                <div className="mt-4 space-y-4">
                  {patientRecord.treatment_notes.map((note) => (
                    <div key={note.version} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">
                        Version {note.version} · {note.author}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(note.created_at)}
                      </p>
                      <p className="mt-2 text-sm text-slate-700">{note.summary}</p>
                      {note.next_steps && (
                        <p className="mt-1 text-sm text-blue-700">Nächste Schritte: {note.next_steps}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {(user?.role === "clinic_admin" || user?.role === "provider") && (
          <section className="mx-auto max-w-6xl space-y-10">
            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-900">Klinikkontext</h2>
              <p className="mt-1 text-sm text-slate-600">
                Diese Kennung wird in Audit-Logs und bei Patientenfreigaben verwendet.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2">
                <span className="text-xs font-semibold uppercase text-blue-700">Klinik-ID</span>
                <code className="text-sm font-mono text-blue-900">{user?.clinic_id ?? "unbekannt"}</code>
              </div>
            </div>
            <div className="rounded-3xl bg-white p-8 shadow-lg">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">Terminverwaltung</h2>
                {editingSlotId && (
                  <button
                    onClick={() => setEditingSlotId(null)}
                    className="text-sm font-semibold text-blue-600 hover:underline"
                  >
                    Bearbeitung abbrechen
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Pflegen Sie verfügbare Slots, passen Sie Zeiten an oder setzen Sie Termine ab. Bei
                Änderungen werden Patient:innen automatisch informiert.
              </p>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr,1fr]">
                <div className="space-y-4">
                  {medicalSlots.length === 0 ? (
                    <p className="text-sm text-slate-500">Noch keine Slots angelegt.</p>
                  ) : (
                    medicalSlots.map((slot) => (
                      <div key={slot.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {formatDateTime(slot.start)} · {slot.is_virtual ? "Video" : "Vor Ort"}
                            </p>
                            <p className="text-xs text-slate-500">Status: {slot.status}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEditingSlot(slot)}
                              className="rounded-lg border border-blue-200 px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              Bearbeiten
                            </button>
                            <button
                              onClick={() => handleCancelSlot(slot.id)}
                              className="rounded-lg border border-rose-200 px-3 py-1 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                            >
                              Slot absagen
                            </button>
                          </div>
                        </div>
                        {editingSlotId === slot.id && (
                          <form onSubmit={submitSlotUpdate} className="mt-4 grid gap-4 md:grid-cols-3">
                            <label className="text-xs font-semibold uppercase text-slate-500">
                              Neuer Start
                              <input
                                type="datetime-local"
                                value={editValues.start}
                                onChange={(event) =>
                                  setEditValues((prev) => ({ ...prev, start: event.target.value }))
                                }
                                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                              />
                            </label>
                            <label className="text-xs font-semibold uppercase text-slate-500">
                              Neues Ende
                              <input
                                type="datetime-local"
                                value={editValues.end}
                                onChange={(event) =>
                                  setEditValues((prev) => ({ ...prev, end: event.target.value }))
                                }
                                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                              <input
                                type="checkbox"
                                checked={editValues.isVirtual}
                                onChange={(event) =>
                                  setEditValues((prev) => ({ ...prev, isVirtual: event.target.checked }))
                                }
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              Videosprechstunde
                            </label>
                            <div className="md:col-span-3 flex justify-end">
                              <button
                                type="submit"
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                              >
                                Änderungen speichern
                              </button>
                            </div>
                          </form>
                        )}
                        {slot.patient_snapshot && (
                          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                            <p className="font-semibold">Gebucht von {slot.patient_snapshot.first_name} {slot.patient_snapshot.last_name}</p>
                            <p>{slot.patient_snapshot.email}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
                  <h3 className="text-lg font-semibold text-blue-900">Neuen Slot veröffentlichen</h3>
                  {adminFeedback && (
                    <p className="mt-2 text-sm text-blue-700">{adminFeedback}</p>
                  )}
                  <form onSubmit={handleCreateSlot} className="mt-3 space-y-3">
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Start</span>
                      <input
                        name="start"
                        type="datetime-local"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase text-blue-700">Ende</span>
                      <input
                        name="end"
                        type="datetime-local"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase text-blue-700">
                      <input name="is_virtual" type="checkbox" className="h-4 w-4 rounded border-blue-300" />
                      Videosprechstunde
                    </label>
                    <button
                      type="submit"
                      disabled={creatingSlot}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      Slot veröffentlichen
                    </button>
                  </form>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-8 shadow-lg">
              <h2 className="text-xl font-semibold text-slate-900">Aktuelle Buchungen</h2>
              <p className="mt-1 text-sm text-slate-600">
                Patient:innenprofile werden ausschließlich angezeigt, wenn eine gültige Freigabe vorliegt.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Termin</th>
                      <th className="px-3 py-2">Patient:in</th>
                      <th className="px-3 py-2">Kontakt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {medicalBookings.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-sm text-slate-500" colSpan={3}>
                          Keine Buchungen vorhanden.
                        </td>
                      </tr>
                    ) : (
                      medicalBookings.map((entry) => (
                        <tr key={entry.slot.id} className="bg-white">
                          <td className="px-3 py-3 text-slate-700">{formatDateTime(entry.slot.start)}</td>
                          <td className="px-3 py-3 text-slate-700">
                            {entry.patient
                              ? `${entry.patient.first_name} ${entry.patient.last_name}`
                              : "N/A"}
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            {entry.patient ? entry.patient.email : "Keine Daten"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              <div className="rounded-3xl bg-white p-8 shadow-lg">
                <h2 className="text-xl font-semibold text-slate-900">Patientenakte abrufen</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Zugriff nur bei vorliegender Freigabe. Alle Abrufe werden auditierbar protokolliert.
                </p>
                <form onSubmit={handleClinicPatientLookup} className="mt-4 flex gap-3">
                  <input
                    value={clinicPatientId}
                    onChange={(event) => setClinicPatientId(event.target.value)}
                    placeholder="Patient:innen-ID"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    Akte laden
                  </button>
                </form>
                {clinicPatientError && (
                  <p className="mt-2 text-sm text-rose-600">{clinicPatientError}</p>
                )}
                {clinicPatientRecord && (
                  <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold">
                      {clinicPatientRecord.profile.first_name} {clinicPatientRecord.profile.last_name}
                    </p>
                    <p>{clinicPatientRecord.profile.email}</p>
                    <p>Termine: {clinicPatientRecord.appointments.length}</p>
                  </div>
                )}
              </div>

              {user?.role === "clinic_admin" && (
                <div className="rounded-3xl bg-white p-8 shadow-lg">
                  <h2 className="text-xl font-semibold text-slate-900">Behandler:innen verwalten</h2>
                  {providerFeedback && (
                    <p className="mt-2 text-sm text-blue-700">{providerFeedback}</p>
                  )}
                  <form onSubmit={handleRegisterProvider} className="mt-4 grid gap-3">
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-slate-500">Name</span>
                      <input
                        name="provider_name"
                        required
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-slate-500">E-Mail</span>
                      <input
                        name="provider_email"
                        type="email"
                        required
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-slate-500">Passwort</span>
                      <input
                        name="provider_password"
                        type="password"
                        required
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtung</span>
                      <select
                        name="provider_specialty"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      >
                        {specialties
                          .filter((entry) => entry.value !== "")
                          .map((specialty) => (
                            <option key={specialty.value} value={specialty.value}>
                              {specialty.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                    >
                      Behandler:in anlegen
                    </button>
                  </form>

                  <div className="mt-6 space-y-3">
                    {providers.length === 0 ? (
                      <p className="text-sm text-slate-500">Noch keine Behandler:innen registriert.</p>
                    ) : (
                      providers.map((provider) => (
                        <div
                          key={provider.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                        >
                          <p className="font-semibold text-slate-900">{provider.display_name}</p>
                          <p className="text-slate-600">{provider.email}</p>
                          <p className="text-slate-500 text-xs">{provider.specialty}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {user?.role === "platform_admin" && (
          <section className="mx-auto max-w-6xl rounded-3xl bg-white p-8 shadow-lg">
            <h2 className="text-xl font-semibold text-slate-900">Neue Klinik registrieren</h2>
            {adminFeedback && (
              <p className="mt-2 text-sm text-blue-700">{adminFeedback}</p>
            )}
            <form onSubmit={handleRegisterClinic} className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase text-slate-500">Klinikdaten</h3>
                <p className="text-xs font-medium text-slate-500">
                  Die Plattform vergibt eine Klinik-ID automatisch und blendet sie nach erfolgreicher Registrierung ein.
                </p>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Name</span>
                  <input name="clinic_name" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtung</span>
                  <select name="clinic_specialty" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2">
                    {specialties
                      .filter((entry) => entry.value !== "")
                      .map((specialty) => (
                        <option key={specialty.value} value={specialty.value}>
                          {specialty.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Stadt</span>
                  <input name="clinic_city" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Straße</span>
                  <input name="clinic_street" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">PLZ</span>
                  <input name="clinic_postal" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Kontakt-E-Mail</span>
                  <input
                    name="clinic_email"
                    type="email"
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase text-slate-500">Administrationszugang</h3>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">E-Mail</span>
                  <input
                    name="admin_email"
                    type="email"
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Anzeigename</span>
                  <input name="admin_display" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Passwort</span>
                  <input
                    name="admin_password"
                    type="password"
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <button
                  type="submit"
                  className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                >
                  Klinik anlegen
                </button>
              </div>
            </form>
          </section>
        )}
      </main>

      <FooterPlaceholder />
    </div>
  );
}
