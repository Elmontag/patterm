import { useCallback, useEffect, useMemo, useState } from "react";
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
  getSpecialties,
  getClinicBookings,
  getClinicProviders,
  getClinicSlots,
  getFacilities,
  getFacilityDetail,
  getFacilityProfile,
  getOwnRecord,
  login,
  adminListFacilities,
  adminUpdateFacility,
  adminDeleteFacility,
  registerClinic,
  registerPatient,
  registerProvider,
  reschedulePatientAppointment,
  searchAppointments,
  searchFacilities,
  setAuthToken,
  updateClinicSlot,
  updateConsent,
  updateFacilityProfile,
  updateProfile,
  updateSpecialtyCatalog
} from "./hooks/useApi.js";

const facilityTypes = [
  { value: "", label: "Alle Einrichtungstypen" },
  { value: "clinic", label: "Klinik" },
  { value: "practice", label: "Praxis" },
  { value: "group_practice", label: "Gemeinschaftspraxis" }
];

const facilityTypeLabels = {
  clinic: "Klinik",
  practice: "Praxis",
  group_practice: "Gemeinschaftspraxis"
};

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

const formatSpecialtyLabel = (value) => {
  if (!value) return "";
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
};

const weekdayLookup = {
  mo: 0,
  di: 1,
  mi: 2,
  do: 3,
  fr: 4,
  sa: 5,
  so: 6
};

const weekdayKeys = ["mo", "di", "mi", "do", "fr", "sa", "so"];

const parseOpeningHours = (value) => {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [dayPart, timePart] = line.split(":");
      if (!dayPart || !timePart) return null;
      const weekday = weekdayLookup[dayPart.toLowerCase().slice(0, 2)];
      const [opens_at, closes_at] = timePart.split("-").map((segment) => segment.trim());
      if (weekday === undefined || !opens_at || !closes_at) return null;
      return { weekday, opens_at, closes_at };
    })
    .filter(Boolean);
};

const parseListInput = (value) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseDepartments = (value) => {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, specialtiesRaw] = line.split(":");
      return {
        name: name?.trim() ?? "",
        specialties: parseListInput(specialtiesRaw ?? "")
      };
    })
    .filter((entry) => entry.name);
};

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
  const [facilitySummaries, setFacilitySummaries] = useState([]);
  const [facilityDetailCache, setFacilityDetailCache] = useState({});
  const [specialtyCatalog, setSpecialtyCatalog] = useState([]);
  const [searchFilters, setSearchFilters] = useState({
    facilityId: "",
    specialty: "",
    providerId: "",
    departmentId: "",
    facilityType: ""
  });
  const [patientSection, setPatientSection] = useState("search");
  const [appointmentsViewMode, setAppointmentsViewMode] = useState("list");
  const [medicalSection, setMedicalSection] = useState("availability");
  const [adminSection, setAdminSection] = useState("manage");
  const [adminCatalogDraft, setAdminCatalogDraft] = useState([]);
  const [adminCatalogFeedback, setAdminCatalogFeedback] = useState("");
  const [adminFacilities, setAdminFacilities] = useState([]);
  const [adminFacilitySelection, setAdminFacilitySelection] = useState(null);
  const [adminFacilityForm, setAdminFacilityForm] = useState(null);
  const [adminFacilityFeedback, setAdminFacilityFeedback] = useState("");
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
  const [facilityResults, setFacilityResults] = useState([]);
  const [facilitySearch, setFacilitySearch] = useState({
    postalCode: "",
    city: "",
    specialty: "",
    facilityType: ""
  });
  const [facilityProfile, setFacilityProfile] = useState(null);
  const [profileMessage, setProfileMessage] = useState("");
  const [facilityMessage, setFacilityMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [pendingAuth, setPendingAuth] = useState(false);
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [editValues, setEditValues] = useState({ start: "", end: "", isVirtual: false });

  const patientMenu = useMemo(
    () => [
      { id: "search", label: "Terminsuche" },
      { id: "appointments", label: "Meine Termine" },
      { id: "profile", label: "Meine Daten" },
      { id: "consents", label: "Meine Freigaben" },
    ],
    []
  );

  const medicalMenu = useMemo(() => {
    const base = [
      { id: "availability", label: "Terminangebote" },
      { id: "bookings", label: "Gebuchte Termine" },
      { id: "patients", label: "Patientenakten" },
      { id: "profile", label: "Stammdaten" },
    ];
    if (user?.role === "clinic_admin") {
      base.splice(2, 0, { id: "team", label: "Team & Fachbereiche" });
    }
    return base;
  }, [user?.role]);

  const adminMenu = useMemo(
    () => [
      { id: "manage", label: "Einrichtungen verwalten" },
      { id: "create", label: "Neue Einrichtung" },
      { id: "specialties", label: "Fachdisziplinen" },
    ],
    []
  );

  useEffect(() => {
    const initialise = async () => {
      try {
        const data = await getFacilities();
        setFacilitySummaries(data);
      } catch (error) {
        setFacilitySummaries([]);
      }
    };
    initialise();
  }, []);

  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const catalog = await getSpecialties();
        setSpecialtyCatalog(catalog);
      } catch (error) {
        setSpecialtyCatalog([]);
      }
    };
    loadCatalog();
  }, []);

  useEffect(() => {
    if (user?.role === "platform_admin") {
      setAdminCatalogDraft((prev) => {
        const sameLength = prev.length === specialtyCatalog.length;
        const sameOrder = sameLength
          ? prev.every((entry, index) => entry === specialtyCatalog[index])
          : false;
        return sameOrder ? prev : specialtyCatalog;
      });
    } else {
      setAdminCatalogDraft([]);
    }
  }, [user?.role, specialtyCatalog]);

  useEffect(() => {
    void refreshAdminFacilities();
  }, [refreshAdminFacilities]);

  const cacheFacilityDetail = useCallback((detail) => {
    if (!detail) return detail;
    setFacilityDetailCache((prev) => ({ ...prev, [detail.id]: detail }));
    return detail;
  }, []);

  const refreshAdminFacilities = useCallback(async () => {
    if (!token || user?.role !== "platform_admin") {
      setAdminFacilities([]);
      setAdminFacilitySelection(null);
      setAdminFacilityForm(null);
      return;
    }
    try {
      const facilities = await adminListFacilities();
      setAdminFacilities(facilities);
    } catch (error) {
      setAdminFacilities([]);
    }
  }, [token, user?.role]);

  const prepareAdminFacilityForm = useCallback((facility) => {
    if (!facility) {
      setAdminFacilityForm(null);
      return;
    }
    const opening = (facility.opening_hours ?? [])
      .map((entry) => `${weekdayKeys[entry.weekday] ?? entry.weekday}:${entry.opens_at}-${entry.closes_at}`)
      .join("\n");
    setAdminFacilityForm({
      name: facility.name,
      contact_email: facility.contact_email,
      phone_number: facility.phone_number,
      street: facility.street,
      city: facility.city,
      postal_code: facility.postal_code,
      specialties: facility.specialties ?? [],
      opening_hours: opening,
      owners: (facility.owners ?? []).join("\n"),
    });
  }, []);

  const handleAdminFacilitySelect = useCallback(
    (facilityId) => {
      const facility = adminFacilities.find((entry) => entry.id === facilityId) ?? null;
      setAdminFacilitySelection(facility);
      prepareAdminFacilityForm(facility ?? null);
      setAdminFacilityFeedback("");
    },
    [adminFacilities, prepareAdminFacilityForm]
  );

  useEffect(() => {
    if (adminFacilities.length === 0) {
      return;
    }
    if (!adminFacilitySelection) {
      handleAdminFacilitySelect(adminFacilities[0].id);
    }
  }, [adminFacilities, adminFacilitySelection, handleAdminFacilitySelect]);

  const handleAdminFacilityFieldChange = (field, value) => {
    setAdminFacilityForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleAdminFacilitySpecialtiesChange = (event) => {
    const values = Array.from(event.target.selectedOptions).map((option) => option.value);
    handleAdminFacilityFieldChange("specialties", values);
  };

  const handleAdminFacilitySave = async (event) => {
    event.preventDefault();
    if (!adminFacilitySelection || !adminFacilityForm) {
      return;
    }
    const payload = {
      name: adminFacilityForm.name?.trim() || undefined,
      contact_email: adminFacilityForm.contact_email?.trim() || undefined,
      phone_number: adminFacilityForm.phone_number?.trim() || undefined,
      street: adminFacilityForm.street?.trim() || undefined,
      city: adminFacilityForm.city?.trim() || undefined,
      postal_code: adminFacilityForm.postal_code?.trim() || undefined,
      specialties: adminFacilityForm.specialties,
      opening_hours: parseOpeningHours(adminFacilityForm.opening_hours),
      owners: parseListInput(adminFacilityForm.owners),
    };
    try {
      const updated = await adminUpdateFacility({ facilityId: adminFacilitySelection.id, ...payload });
      setAdminFacilityFeedback("Einrichtung erfolgreich aktualisiert.");
      setAdminFacilitySelection(updated);
      prepareAdminFacilityForm(updated);
      await refreshAdminFacilities();
      const summaries = await getFacilities();
      setFacilitySummaries(summaries);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setAdminFacilityFeedback(detail ?? "Aktualisierung fehlgeschlagen.");
    }
  };

  const handleAdminFacilityDelete = async (facilityId) => {
    try {
      await adminDeleteFacility(facilityId);
      setAdminFacilityFeedback("Einrichtung wurde entfernt.");
      if (adminFacilitySelection?.id === facilityId) {
        setAdminFacilitySelection(null);
        setAdminFacilityForm(null);
      }
      await refreshAdminFacilities();
      const summaries = await getFacilities();
      setFacilitySummaries(summaries);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setAdminFacilityFeedback(detail ?? "Löschen nicht möglich.");
    }
  };

  const handleSpecialtyDraftChange = (index, value) => {
    setAdminCatalogDraft((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSpecialtyAdd = () => {
    setAdminCatalogDraft((prev) => [...prev, ""]);
  };

  const handleSpecialtyRemove = (index) => {
    setAdminCatalogDraft((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSpecialtySave = async (event) => {
    event.preventDefault();
    const cleaned = adminCatalogDraft
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry && array.indexOf(entry) === index);
    try {
      const updated = await updateSpecialtyCatalog(cleaned);
      setSpecialtyCatalog(updated);
      setAdminCatalogFeedback("Fachdisziplinen aktualisiert.");
      await refreshAdminFacilities();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setAdminCatalogFeedback(detail ?? "Speichern nicht möglich.");
    }
  };

  const ensureFacilityDetail = useCallback(
    async (facilityId) => {
      if (!facilityId) return null;
      if (facilityDetailCache[facilityId]) {
        return facilityDetailCache[facilityId];
      }
      try {
        const detail = await getFacilityDetail(facilityId);
        return cacheFacilityDetail(detail);
      } catch (error) {
        return null;
      }
    },
    [cacheFacilityDetail, facilityDetailCache]
  );

  const filteredFacilities = useMemo(() => {
    if (!searchFilters.facilityType) {
      return facilitySummaries;
    }
    return facilitySummaries.filter(
      (facility) => facility.facility_type === searchFilters.facilityType
    );
  }, [facilitySummaries, searchFilters.facilityType]);

  const allSpecialtyOptions = useMemo(
    () => [
      { value: "", label: "Alle Fachrichtungen" },
      ...specialtyCatalog.map((entry) => ({
        value: entry,
        label: formatSpecialtyLabel(entry)
      }))
    ],
    [specialtyCatalog]
  );

  const specialtyMultiOptions = useMemo(
    () => specialtyCatalog.map((entry) => ({ value: entry, label: formatSpecialtyLabel(entry) })),
    [specialtyCatalog]
  );

  useEffect(() => {
    if (filteredFacilities.length > 0 && !searchFilters.facilityId) {
      const initial = filteredFacilities[0];
      setSearchFilters((prev) => ({
        ...prev,
        facilityId: initial.id,
        facilityType: prev.facilityType || initial.facility_type,
        specialty: prev.specialty || initial.specialties?.[0] || "",
      }));
      void ensureFacilityDetail(initial.id);
    }
  }, [filteredFacilities, searchFilters.facilityId, ensureFacilityDetail]);

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

  const facilityLookup = useMemo(() => {
    const map = new Map();
    facilitySummaries.forEach((facility) => map.set(facility.id, facility));
    Object.values(facilityDetailCache).forEach((facility) =>
      map.set(facility.id, facility)
    );
    facilityResults.forEach((entry) => map.set(entry.facility.id, entry.facility));
    if (facilityProfile) {
      map.set(facilityProfile.id, facilityProfile);
    }
    return map;
  }, [facilitySummaries, facilityDetailCache, facilityResults, facilityProfile]);

  const selectedFacility = searchFilters.facilityId
    ? facilityLookup.get(searchFilters.facilityId)
    : null;

  const departmentOptions = useMemo(() => {
    if (!selectedFacility || selectedFacility.facility_type !== "clinic") {
      return [];
    }
    return selectedFacility.departments ?? [];
  }, [selectedFacility]);

  const providerOptions = useMemo(() => {
    if (!selectedFacility) {
      return [];
    }
    let providers = selectedFacility.providers ?? [];
    if (
      selectedFacility.facility_type === "clinic" &&
      searchFilters.departmentId
    ) {
      const department = selectedFacility.departments?.find(
        (entry) => entry.id === searchFilters.departmentId
      );
      if (department?.providers?.length) {
        providers = department.providers;
      } else if (department?.provider_ids?.length) {
        providers = providers.filter((provider) =>
          department.provider_ids.includes(provider.id)
        );
      }
    }
    return providers;
  }, [selectedFacility, searchFilters.departmentId]);

  const facilitySpecialtyOptions = useMemo(() => {
    if (selectedFacility?.specialties?.length) {
      const unique = Array.from(new Set(selectedFacility.specialties));
      return [
        allSpecialtyOptions[0],
        ...unique.map((value) => ({ value, label: formatSpecialtyLabel(value) })),
      ];
    }
    return allSpecialtyOptions;
  }, [selectedFacility, allSpecialtyOptions]);

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
    setFacilityProfile(null);
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
        const [providerData, facilityData] = await Promise.all([
          getClinicProviders(),
          getFacilityProfile()
        ]);
        setProviders(providerData);
        setFacilityProfile(facilityData);
        cacheFacilityDetail(facilityData);
      } else {
        const facilityData = await getFacilityProfile();
        setFacilityProfile(facilityData);
        cacheFacilityDetail(facilityData);
      }
    } catch (error) {
      setMedicalSlots([]);
      setMedicalBookings([]);
      setProviders([]);
      setFacilityProfile(null);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    setSearching(true);
    try {
      const params = {};
      if (searchFilters.facilityId) params.facility_id = searchFilters.facilityId;
      if (searchFilters.specialty) params.specialty = searchFilters.specialty;
      if (searchFilters.providerId) params.provider_id = searchFilters.providerId;
      if (searchFilters.departmentId) params.department_id = searchFilters.departmentId;
      if (searchFilters.facilityType) params.facility_type = searchFilters.facilityType;
      const results = await searchAppointments(params);
      setSlots(results);
      results.forEach((slot) => void ensureFacilityDetail(slot.facility_id));
    } catch (error) {
      setSlots([]);
    } finally {
      setSearching(false);
    }
  };

  const handleFacilityTypeChange = (event) => {
    const value = event.target.value;
    setSearchFilters((prev) => ({
      ...prev,
      facilityType: value,
      facilityId: "",
      departmentId: "",
      providerId: "",
    }));
  };

  const handleFacilityChange = async (event) => {
    const value = event.target.value;
    if (!value) {
      setSearchFilters((prev) => ({
        ...prev,
        facilityId: "",
        departmentId: "",
        providerId: "",
      }));
      return;
    }
    const detail = await ensureFacilityDetail(value);
    const summary =
      facilitySummaries.find((entry) => entry.id === value) ||
      facilityLookup.get(value);
    const facilityType = detail?.facility_type ?? summary?.facility_type ?? "";
    const firstSpecialty =
      detail?.specialties?.[0] ?? summary?.specialties?.[0] ?? "";
    setSearchFilters((prev) => ({
      ...prev,
      facilityId: value,
      facilityType: facilityType || prev.facilityType,
      departmentId: "",
      providerId: "",
      specialty: firstSpecialty || "",
    }));
  };

  const handleDepartmentChange = (event) => {
    const value = event.target.value;
    setSearchFilters((prev) => ({
      ...prev,
      departmentId: value,
      providerId: "",
    }));
  };

  const handleProviderChange = (event) => {
    const value = event.target.value;
    setSearchFilters((prev) => ({ ...prev, providerId: value }));
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

  const handleFacilitySearch = async (event) => {
    event.preventDefault();
    try {
      const params = {};
      if (facilitySearch.postalCode) params.postal_code = facilitySearch.postalCode;
      if (facilitySearch.city) params.city = facilitySearch.city;
      if (facilitySearch.specialty) params.specialty = facilitySearch.specialty;
      if (facilitySearch.facilityType) params.facility_type = facilitySearch.facilityType;
      const results = await searchFacilities(params);
      results.forEach((entry) => cacheFacilityDetail(entry.facility));
      setFacilityResults(results);
    } catch (error) {
      setFacilityResults([]);
    }
  };

  const loadFacilitySlots = async (facility) => {
    const detail = await ensureFacilityDetail(facility.id);
    const defaultSpecialty =
      detail?.specialties?.[0] || facility.specialties?.[0] || "";
    setSearchFilters((prev) => ({
      ...prev,
      facilityId: facility.id,
      facilityType: facility.facility_type,
      specialty: defaultSpecialty,
      departmentId: "",
      providerId: ""
    }));
    setSearching(true);
    try {
      const results = await searchAppointments({ facility_id: facility.id });
      setSlots(results);
      results.forEach((slot) => void ensureFacilityDetail(slot.facility_id));
    } catch (error) {
      setSlots([]);
    } finally {
      setSearching(false);
    }
  };

  const handleFacilityUpdate = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await updateFacilityProfile({
        contact_email: form.get("facility_email") || undefined,
        phone_number: form.get("facility_phone") || undefined,
        street: form.get("facility_street") || undefined,
        city: form.get("facility_city") || undefined,
        postal_code: form.get("facility_postal") || undefined,
        opening_hours: parseOpeningHours(form.get("facility_hours")),
        owners: parseListInput(form.get("facility_owners"))
      });
      setFacilityMessage("Einrichtung aktualisiert.");
      await refreshMedicalData();
    } catch (error) {
      setFacilityMessage("Aktualisierung fehlgeschlagen.");
    }
  };

  const handleProfileUpdate = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await updateProfile({
        display_name: form.get("display_name") || undefined,
        phone_number: form.get("profile_phone") || undefined
      });
      setProfileMessage("Profil aktualisiert.");
      if (user?.role === "patient") {
        await refreshPatientRecord();
      }
      const refreshed = await fetchProfile();
      setUser(refreshed);
      localStorage.setItem("patterm:user", JSON.stringify(refreshed));
    } catch (error) {
      setProfileMessage("Profil konnte nicht aktualisiert werden.");
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

  const handleConsentChange = async (facilityId, grant) => {
    if (!user) return;
    try {
      await updateConsent({
        patientId: user.id,
        requesterFacilityId: facilityId,
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
        date_of_birth: form.get("date_of_birth"),
        phone_number: form.get("phone_number")
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
    const providerId = form.get("slot_provider") || (user?.role === "provider" ? user.id : "");
    const departmentId = form.get("slot_department") || undefined;
    try {
      await createClinicSlot({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        is_virtual: isVirtual,
        provider_id: providerId || undefined,
        department_id: departmentId
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
      const facilityType = form.get("facility_type");
      const specialtiesRaw = form.getAll("clinic_specialties");
      const specialties = specialtiesRaw.length > 0
        ? specialtiesRaw.filter(Boolean)
        : parseListInput(form.get("clinic_specialties") ?? "");
      if (!facilityType) {
        setAdminFeedback("Bitte Einrichtungstyp auswählen.");
        return;
      }
      if (specialties.length === 0) {
        setAdminFeedback("Mindestens ein Fach auswählen.");
        return;
      }
      const result = await registerClinic({
        facility: {
          name: form.get("clinic_name"),
          facility_type: facilityType,
          specialties,
          city: form.get("clinic_city"),
          street: form.get("clinic_street"),
          postal_code: form.get("clinic_postal"),
          contact_email: form.get("clinic_email"),
          phone_number: form.get("clinic_phone"),
          opening_hours: parseOpeningHours(form.get("clinic_hours"))
        },
        departments: parseDepartments(form.get("clinic_departments")),
        owners: parseListInput(form.get("facility_owners")),
        admin_email: form.get("admin_email"),
        admin_password: form.get("admin_password"),
        admin_display_name: form.get("admin_display")
      });
      setAdminFeedback(`Einrichtung erfolgreich registriert. ID: ${result.facility.id}`);
      event.currentTarget.reset();
      cacheFacilityDetail(result.facility);
      const updated = await getFacilities();
      setFacilitySummaries(updated);
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
      const specialtiesRaw = form.getAll("provider_specialties");
      const specialties = specialtiesRaw.length > 0
        ? specialtiesRaw.filter(Boolean)
        : parseListInput(form.get("provider_specialties") ?? "");
      if (!user?.facility_id) {
        setProviderFeedback("Keine Einrichtung im Profil gefunden.");
        return;
      }
      if (specialties.length === 0) {
        setProviderFeedback("Bitte mindestens ein Fach auswählen.");
        return;
      }
      await registerProvider({
        facility_id: user.facility_id,
        email: form.get("provider_email"),
        password: form.get("provider_password"),
        display_name: form.get("provider_name"),
        specialties,
        department_id: form.get("provider_department") || undefined
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
        clinicId: user?.facility_id ?? ""
      });
      setClinicPatientRecord(record);
      setClinicPatientError("");
    } catch (error) {
      setClinicPatientRecord(null);
      setClinicPatientError("Patientenakte konnte nicht geladen werden.");
    }
  };

  const patientAppointments = patientRecord?.appointments ?? [];
  const consentedFacilityIds = patientRecord?.consents ?? [];

  const sortedPatientAppointments = useMemo(() => {
    return [...patientAppointments].sort(
      (a, b) => new Date(a.start) - new Date(b.start)
    );
  }, [patientAppointments]);

  const appointmentDays = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const jsDay = base.getDay();
    const offset = jsDay === 0 ? -6 : 1 - jsDay;
    base.setDate(base.getDate() + offset);
    const map = new Map();
    sortedPatientAppointments.forEach((appointment) => {
      const key = appointment.start.slice(0, 10);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(appointment);
    });
    return Array.from({ length: 28 }, (_, index) => {
      const day = new Date(base);
      day.setDate(base.getDate() + index);
      const key = day.toISOString().slice(0, 10);
      return { date: day, iso: key, appointments: map.get(key) ?? [] };
    });
  }, [sortedPatientAppointments]);

  const consentedFacilities = useMemo(() => {
    const summaries = facilitySummaries.filter((facility) =>
      consentedFacilityIds.includes(facility.id)
    );
    const summaryIds = new Set(summaries.map((facility) => facility.id));
    const extras = consentedFacilityIds
      .filter((id) => !summaryIds.has(id))
      .map((id) => facilityDetailCache[id])
      .filter(Boolean)
      .map((detail) => ({
        id: detail.id,
        name: detail.name,
        facility_type: detail.facility_type,
        city: detail.city,
        street: detail.street,
        postal_code: detail.postal_code,
        contact_email: detail.contact_email,
        phone_number: detail.phone_number,
      }));
    return [...summaries, ...extras];
  }, [facilitySummaries, facilityDetailCache, consentedFacilityIds]);

  const renderPatientSearch = () => (
    <div className="space-y-8">
      <div className="rounded-3xl bg-white p-8 shadow-lg">
        <h3 className="text-xl font-semibold text-slate-900">Terminsuche</h3>
        <p className="mt-1 text-sm text-slate-600">
          Wählen Sie Fachrichtung und Standort. Freie Slots werden live aus dem verschlüsselten Terminregister geladen.
        </p>
        {rescheduleContext && (
          <p className="mt-3 text-sm font-medium text-blue-600">
            Verschiebung aktiv – wählen Sie einen neuen Termin, um {formatDateTime(rescheduleContext.start)} zu ersetzen.
          </p>
        )}
        <form onSubmit={handleSearch} className="mt-4 grid gap-4 md:grid-cols-5">
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Einrichtungstyp</span>
            <select
              value={searchFilters.facilityType}
              onChange={handleFacilityTypeChange}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              {facilityTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="text-xs font-semibold uppercase text-slate-500">Einrichtung</span>
            <select
              value={searchFilters.facilityId}
              onChange={handleFacilityChange}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option value="">Alle Einrichtungen</option>
              {filteredFacilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name} · {facility.city}
                </option>
              ))}
            </select>
          </label>
          {selectedFacility?.facility_type === "clinic" && (
            <label className="text-sm">
              <span className="text-xs font-semibold uppercase text-slate-500">Fachbereich</span>
              <select
                value={searchFilters.departmentId}
                onChange={handleDepartmentChange}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="">Alle Fachbereiche</option>
                {departmentOptions.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Behandler:in</span>
            <select
              value={searchFilters.providerId}
              onChange={handleProviderChange}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option value="">Alle Behandler:innen</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtung</span>
            <select
              value={searchFilters.specialty}
              onChange={(event) =>
                setSearchFilters((prev) => ({
                  ...prev,
                  specialty: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              {facilitySpecialtyOptions.map((specialty) => (
                <option key={specialty.value} value={specialty.value}>
                  {specialty.label}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-5 flex items-end justify-end">
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
                clinic={facilityLookup.get(slot.facility_id)}
                onBook={() => handleBook(slot.id)}
              />
            ))
          )}
        </div>
      </div>
      <div className="rounded-3xl bg-white p-8 shadow-lg">
        <h3 className="text-xl font-semibold text-slate-900">Einrichtungen in Ihrer Nähe</h3>
        <p className="mt-1 text-sm text-slate-600">
          Nutzen Sie die Filtersuche, um passende Kliniken und Praxen zu finden und freie Slots direkt zu übernehmen.
        </p>
        <form onSubmit={handleFacilitySearch} className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">PLZ</span>
            <input
              name="facility_postal"
              value={facilitySearch.postalCode}
              onChange={(event) =>
                setFacilitySearch((prev) => ({ ...prev, postalCode: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              placeholder="z. B. 10117"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Stadt</span>
            <input
              name="facility_city"
              value={facilitySearch.city}
              onChange={(event) =>
                setFacilitySearch((prev) => ({ ...prev, city: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              placeholder="z. B. Berlin"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtung</span>
            <select
              value={facilitySearch.specialty}
              onChange={(event) =>
                setFacilitySearch((prev) => ({ ...prev, specialty: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              {allSpecialtyOptions.map((specialty) => (
                <option key={specialty.value} value={specialty.value}>
                  {specialty.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Einrichtungstyp</span>
            <select
              value={facilitySearch.facilityType}
              onChange={(event) =>
                setFacilitySearch((prev) => ({ ...prev, facilityType: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              {facilityTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-4 flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-600"
            >
              Einrichtungen suchen
            </button>
          </div>
        </form>
        <div className="mt-6 space-y-4">
          {facilityResults.length === 0 ? (
            <p className="text-sm text-slate-500">
              Noch keine Suche durchgeführt oder keine Einrichtungen gefunden.
            </p>
          ) : (
            facilityResults.map((result) => (
              <div
                key={result.facility.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{result.facility.name}</p>
                    <p className="text-xs font-semibold uppercase text-blue-600">
                      {facilityTypeLabels[result.facility.facility_type] ?? result.facility.facility_type}
                    </p>
                    <p className="text-sm text-slate-600">
                      {result.facility.street}, {result.facility.postal_code} {result.facility.city}
                    </p>
                    <p className="text-sm text-slate-600">Telefon {result.facility.phone_number}</p>
                  </div>
                  <button
                    onClick={() => loadFacilitySlots(result.facility)}
                    className="mt-2 inline-flex items-center justify-center rounded-lg border border-blue-200 px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50 md:mt-0"
                  >
                    In Suche übernehmen
                  </button>
                </div>
                {result.next_slots.length > 0 ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    {result.next_slots.map((slot) => {
                      const providerLabel =
                        slot.provider_name ??
                        result.facility.providers?.find((provider) => provider.id === slot.provider_id)?.display_name ??
                        (slot.provider_id ? `ID ${slot.provider_id}` : "Teamtermin");
                      return (
                        <div
                          key={slot.id}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                        >
                          <p className="font-semibold text-slate-900">{formatDateTime(slot.start)}</p>
                          <p>{providerLabel}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">Keine offenen Slots gefunden.</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderPatientAppointments = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-slate-900">Meine Termine</h3>
        <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setAppointmentsViewMode("list")}
            className={`rounded-full px-3 py-1 transition ${
              appointmentsViewMode === "list"
                ? "bg-blue-600 text-white shadow"
                : "text-blue-600 hover:bg-blue-100"
            }`}
          >
            Liste
          </button>
          <button
            type="button"
            onClick={() => setAppointmentsViewMode("calendar")}
            className={`rounded-full px-3 py-1 transition ${
              appointmentsViewMode === "calendar"
                ? "bg-blue-600 text-white shadow"
                : "text-blue-600 hover:bg-blue-100"
            }`}
          >
            Kalender
          </button>
        </div>
      </div>
      {rescheduleContext && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <span>
            Verschiebung aktiv für {formatDateTime(rescheduleContext.start)}.
          </span>
          <button
            type="button"
            onClick={() => setRescheduleContext(null)}
            className="rounded-full border border-blue-400 px-3 py-1 text-xs font-semibold hover:bg-blue-100"
          >
            Abbrechen
          </button>
        </div>
      )}
      {appointmentsViewMode === "list" ? (
        <div className="space-y-4">
          {sortedPatientAppointments.length === 0 ? (
            <p className="text-sm text-slate-500">
              Noch keine Termine gebucht. Nutzen Sie die Terminsuche, um verfügbare Slots zu finden.
            </p>
          ) : (
            sortedPatientAppointments.map((appointment) => {
              const facility = facilityLookup.get(appointment.facility_id);
              const isActive = rescheduleContext?.id === appointment.id;
              return (
                <div
                  key={appointment.id}
                  className={`rounded-2xl border p-4 transition ${
                    isActive
                      ? "border-blue-300 bg-blue-50 shadow"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {facility?.name ?? appointment.facility_id}
                      </p>
                      <p className="text-sm text-slate-600">{formatDateTime(appointment.start)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRescheduleContext(appointment)}
                        className="rounded-lg border border-blue-200 px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        Verschieben
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelAppointment(appointment.id)}
                        className="rounded-lg border border-rose-200 px-3 py-1 text-sm font-semibold text-rose-600 hover:bg-rose-100"
                      >
                        Absagen
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-4">
          {appointmentDays.length === 0 ? (
            <p className="text-sm text-slate-500">
              Keine zukünftigen Termine geplant.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-7">
              {appointmentDays.map((entry) => {
                const isToday = entry.iso === new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={entry.iso}
                    className={`rounded-2xl border px-3 py-2 text-xs ${
                      isToday
                        ? "border-blue-300 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {entry.date.toLocaleDateString("de-DE", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                    {entry.appointments.length === 0 ? (
                      <p className="mt-2 text-[11px] text-slate-400">Keine Termine</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {entry.appointments.map((appointment) => {
                          const facility = facilityLookup.get(appointment.facility_id);
                          return (
                            <li
                              key={appointment.id}
                              className="rounded-lg bg-white/80 px-2 py-1 text-[11px] text-slate-600"
                            >
                              <p className="font-semibold text-slate-900">
                                {new Date(appointment.start).toLocaleTimeString("de-DE", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                              <p className="uppercase text-[10px] tracking-wide text-slate-400">
                                {facility?.name ?? appointment.facility_id}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderPatientProfile = () => (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-lg">
        <h3 className="text-xl font-semibold text-slate-900">Mein Zugang</h3>
        <p className="mt-1 text-sm text-slate-600">
          Nutzen Sie diese Kennung bei Rückfragen. Nur berechtigte Stellen sehen Ihre ID.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-2">
          <span className="text-xs font-semibold uppercase text-blue-700">Patient:innen-ID</span>
          <code className="text-sm font-mono text-blue-900">{user.id}</code>
        </div>
      </div>
      <div className="rounded-3xl bg-white p-8 shadow-lg">
        <h3 className="text-xl font-semibold text-slate-900">Profildaten</h3>
        <p className="mt-2 text-sm text-slate-500">
          Passen Sie Ihren Anzeigenamen und Ihre Telefonnummer an. Änderungen werden sofort wirksam.
        </p>
        {profileMessage && (
          <p className="mt-2 text-sm text-blue-700">{profileMessage}</p>
        )}
        <form onSubmit={handleProfileUpdate} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Anzeigename</span>
            <input
              name="display_name"
              defaultValue={user?.display_name ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Telefonnummer</span>
            <input
              name="profile_phone"
              defaultValue={patientRecord?.profile?.phone_number ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              Profil speichern
            </button>
          </div>
        </form>
      </div>
      {patientRecord?.treatment_notes?.length > 0 && (
        <div className="rounded-3xl bg-white p-8 shadow-lg">
          <h3 className="text-xl font-semibold text-slate-900">Behandlungsnotizen</h3>
          <p className="mt-1 text-sm text-slate-500">
            Jede Notiz stammt aus dem verschlüsselten Verlauf und ist auditierbar versioniert.
          </p>
          <div className="mt-4 space-y-3">
            {patientRecord.treatment_notes.map((note) => (
              <div
                key={note.version}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">Version {note.version}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(note.created_at).toLocaleString("de-DE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
                <p className="mt-2 font-medium text-slate-900">{note.summary}</p>
                {note.next_steps && (
                  <p className="mt-1 text-sm text-slate-600">Nächste Schritte: {note.next_steps}</p>
                )}
                <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Autor: {note.author}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderPatientConsents = () => (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-8 shadow-lg">
        <h3 className="text-xl font-semibold text-slate-900">Meine Freigaben</h3>
        <p className="mt-2 text-sm text-slate-500">
          Hier sehen Sie Praxen und Kliniken mit Zugriff auf Ihre Akte. Sie können Freigaben jederzeit entziehen.
        </p>
        {consentMessage && (
          <p className="mt-2 text-sm text-blue-600">{consentMessage}</p>
        )}
        <div className="mt-4 space-y-3">
          {consentedFacilities.length === 0 ? (
            <p className="text-sm text-slate-500">
              Noch keine Freigaben erteilt. Einrichtungen können über die Terminbuchung Zugriff anfragen.
            </p>
          ) : (
            consentedFacilities.map((facility) => {
              const granted = consentedFacilityIds.includes(facility.id);
              return (
                <div
                  key={facility.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{facility.name}</p>
                    <p className="text-xs text-slate-500">
                      {facilityTypeLabels[facility.facility_type] ?? facility.facility_type} · {facility.city}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <ConsentBadge clinicName={facility.name} granted={granted} />
                    <button
                      type="button"
                      onClick={() => handleConsentChange(facility.id, !granted)}
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
            })
          )}
        </div>
      </div>
    </div>
  );

  const renderMedicalProfile = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Einrichtungsübersicht</h3>
            <p className="text-sm text-slate-600">
              Diese Kennung wird für Freigaben und Audit-Logs verwendet.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl bg-blue-100 px-4 py-2">
            <span className="text-xs font-semibold uppercase text-blue-700">Einrichtungs-ID</span>
            <code className="text-sm font-mono text-blue-900">{user?.facility_id ?? "unbekannt"}</code>
          </div>
        </div>
        {facilityProfile && (
          <dl className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Typ</dt>
              <dd className="text-slate-800">
                {facilityTypeLabels[facilityProfile.facility_type] ?? facilityProfile.facility_type}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Telefon</dt>
              <dd className="text-slate-800">{facilityProfile.phone_number || "—"}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs font-semibold uppercase text-slate-500">Adresse</dt>
              <dd className="text-slate-800">
                {facilityProfile.street}, {facilityProfile.postal_code} {facilityProfile.city}
              </dd>
            </div>
            {facilityProfile.owners?.length ? (
              <div className="md:col-span-2">
                <dt className="text-xs font-semibold uppercase text-slate-500">Eigentümer:innen</dt>
                <dd className="text-slate-800">{facilityProfile.owners.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
      {facilityMessage && <p className="text-sm text-blue-700">{facilityMessage}</p>}
      {user?.role === "clinic_admin" && facilityProfile && (
        <form
          key={facilityProfile.id}
          onSubmit={handleFacilityUpdate}
          className="grid gap-3 md:grid-cols-3"
        >
          <label className="text-xs font-semibold uppercase text-slate-500">
            Kontakt-E-Mail
            <input
              name="facility_email"
              type="email"
              defaultValue={facilityProfile.contact_email}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-500">
            Telefon
            <input
              name="facility_phone"
              defaultValue={facilityProfile.phone_number}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-500">
            Straße
            <input
              name="facility_street"
              defaultValue={facilityProfile.street}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-500">
            PLZ
            <input
              name="facility_postal"
              defaultValue={facilityProfile.postal_code}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-500">
            Stadt
            <input
              name="facility_city"
              defaultValue={facilityProfile.city}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-500 md:col-span-3">
            Öffnungszeiten
            <textarea
              name="facility_hours"
              rows={3}
              defaultValue={facilityProfile.opening_hours
                ?.map((entry) => `${weekdayKeys[entry.weekday] ?? entry.weekday}:${entry.opens_at}-${entry.closes_at}`)
                .join("\n")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-slate-500 md:col-span-3">
            Eigentümer:innen
            <textarea
              name="facility_owners"
              rows={2}
              defaultValue={facilityProfile.owners?.join("\n")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              Einrichtung speichern
            </button>
          </div>
        </form>
      )}
    </div>
  );

  const renderMedicalAvailability = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Terminangebote</h3>
          <p className="text-sm text-slate-600">
            Pflegen Sie verfügbare Slots, passen Sie Zeiten an oder setzen Sie Termine ab.
          </p>
        </div>
        {editingSlotId && (
          <button
            onClick={() => setEditingSlotId(null)}
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            Bearbeitung abbrechen
          </button>
        )}
      </div>
      {adminFeedback && <p className="text-sm text-blue-700">{adminFeedback}</p>}
      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
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
                    <p className="font-semibold">
                      Gebucht von {slot.patient_snapshot.first_name} {slot.patient_snapshot.last_name}
                    </p>
                    <p>{slot.patient_snapshot.email}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="text-base font-semibold text-slate-900">Neuen Slot anlegen</h4>
          <p className="mt-1 text-sm text-slate-600">
            Start und Ende werden in lokaler Zeitzone gespeichert.
          </p>
          <form onSubmit={handleCreateSlot} className="mt-4 grid gap-3">
            <label className="text-xs font-semibold uppercase text-slate-500">
              Startzeit
              <input
                name="start"
                type="datetime-local"
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <label className="text-xs font-semibold uppercase text-slate-500">
              Endzeit
              <input
                name="end"
                type="datetime-local"
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
              <input type="checkbox" name="is_virtual" className="h-4 w-4 rounded border-slate-300" />
              Videosprechstunde
            </label>
            {facilityProfile?.departments?.length ? (
              <label className="text-xs font-semibold uppercase text-slate-500">
                Fachbereich (optional)
                <select
                  name="slot_department"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Keiner</option>
                  {facilityProfile.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {user?.role === "clinic_admin" && providers.length > 0 ? (
              <label className="text-xs font-semibold uppercase text-slate-500">
                Behandler:in (optional)
                <select
                  name="slot_provider"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Alle</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.display_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
  );

  const renderMedicalBookings = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Aktuelle Buchungen</h3>
        <p className="text-sm text-slate-600">
          Patient:innenprofile werden ausschließlich angezeigt, wenn eine gültige Freigabe vorliegt.
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-xs font-semibold uppercase text-slate-500">
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
  );

  const renderMedicalPatients = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Patientenakten</h3>
        <p className="text-sm text-slate-600">
          Zugriff nur bei vorliegender Freigabe. Alle Abrufe werden auditierbar protokolliert.
        </p>
      </div>
      <form onSubmit={handleClinicPatientLookup} className="flex flex-col gap-3 sm:flex-row">
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
      {clinicPatientError && <p className="text-sm text-rose-600">{clinicPatientError}</p>}
      {clinicPatientRecord && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold">
            {clinicPatientRecord.profile.first_name} {clinicPatientRecord.profile.last_name}
          </p>
          <p>{clinicPatientRecord.profile.email}</p>
          <p>Termine: {clinicPatientRecord.appointments.length}</p>
        </div>
      )}
    </div>
  );

  const renderMedicalTeam = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Team & Fachbereiche</h3>
        <p className="text-sm text-slate-600">Legen Sie Behandler:innen an und pflegen Sie ihre Fachgebiete.</p>
      </div>
      {providerFeedback && <p className="text-sm text-blue-700">{providerFeedback}</p>}
      <form onSubmit={handleRegisterProvider} className="grid gap-3 lg:grid-cols-2">
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
          <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtungen</span>
          <select
            name="provider_specialties"
            multiple
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {specialtyMultiOptions.map((specialty) => (
              <option key={specialty.value} value={specialty.value}>
                {specialty.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">Mehrfachauswahl mit Strg/Cmd.</p>
        </label>
        {facilityProfile?.departments?.length ? (
          <label className="text-sm">
            <span className="text-xs font-semibold uppercase text-slate-500">Fachbereich</span>
            <select
              name="provider_department"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            >
              <option value="">Keiner</option>
              {facilityProfile.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="lg:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            Behandler:in anlegen
          </button>
        </div>
      </form>
      <div className="space-y-3">
        {providers.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Behandler:innen registriert.</p>
        ) : (
          providers.map((provider) => {
            const departmentName = facilityProfile?.departments?.find(
              (dept) => dept.id === provider.department_id
            )?.name;
            return (
              <div
                key={provider.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
              >
                <p className="font-semibold text-slate-900">{provider.display_name}</p>
                <p className="text-slate-600">{provider.email}</p>
                <p className="text-xs text-slate-500">
                  {provider.specialties?.length
                    ? provider.specialties.map(formatSpecialtyLabel).join(", ")
                    : "Keine Fachrichtung hinterlegt"}
                  {departmentName ? ` · ${departmentName}` : ""}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderAdminManage = () => (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Einrichtungen</h3>
            <button
              type="button"
              onClick={() => void refreshAdminFacilities()}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              Aktualisieren
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {adminFacilities.length === 0 ? (
              <p className="text-sm text-slate-500">Noch keine Einrichtungen registriert.</p>
            ) : (
              adminFacilities.map((facility) => {
                const active = adminFacilitySelection?.id === facility.id;
                return (
                  <button
                    type="button"
                    key={facility.id}
                    onClick={() => handleAdminFacilitySelect(facility.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                      active
                        ? "border-blue-300 bg-white text-blue-700 shadow"
                        : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
                    }`}
                  >
                    <p className="font-semibold">{facility.name}</p>
                    <p className="text-xs text-slate-500">
                      {facilityTypeLabels[facility.facility_type] ?? facility.facility_type} · {facility.city}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          {adminFacilitySelection && adminFacilityForm ? (
            <form onSubmit={handleAdminFacilitySave} className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{adminFacilitySelection.name}</h3>
                  <p className="text-xs uppercase text-slate-500">
                    ID {adminFacilitySelection.id} · {facilityTypeLabels[adminFacilitySelection.facility_type] ?? adminFacilitySelection.facility_type}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleAdminFacilityDelete(adminFacilitySelection.id)}
                  className="rounded-lg border border-rose-200 px-3 py-1 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Einrichtung entfernen
                </button>
              </div>
              {adminFacilityFeedback && (
                <p className="text-sm text-blue-700">{adminFacilityFeedback}</p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Name</span>
                  <input
                    value={adminFacilityForm.name ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("name", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Kontakt-E-Mail</span>
                  <input
                    type="email"
                    value={adminFacilityForm.contact_email ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("contact_email", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Telefon</span>
                  <input
                    value={adminFacilityForm.phone_number ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("phone_number", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Straße</span>
                  <input
                    value={adminFacilityForm.street ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("street", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">PLZ</span>
                  <input
                    value={adminFacilityForm.postal_code ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("postal_code", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase text-slate-500">Stadt</span>
                  <input
                    value={adminFacilityForm.city ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("city", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtungen</span>
                  <select
                    multiple
                    value={adminFacilityForm.specialties ?? []}
                    onChange={handleAdminFacilitySpecialtiesChange}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  >
                    {specialtyMultiOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Mehrfachauswahl mit Strg/Cmd.</p>
                </label>
                <label className="text-sm md:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">Öffnungszeiten</span>
                  <textarea
                    value={adminFacilityForm.opening_hours ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("opening_hours", event.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Mo:08:00-16:00"
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">Eigentümer:innen</span>
                  <textarea
                    value={adminFacilityForm.owners ?? ""}
                    onChange={(event) => handleAdminFacilityFieldChange("owners", event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    placeholder="Name je Zeile"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                >
                  Änderungen speichern
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-500">Bitte wählen Sie eine Einrichtung aus der Liste.</p>
          )}
        </div>
      </div>
    </div>
  );

  const renderAdminCreate = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Neue Einrichtung</h3>
        <p className="text-sm text-slate-600">
          Die Plattform vergibt eine ID automatisch und blendet sie nach erfolgreicher Registrierung ein.
        </p>
      </div>
      {adminFeedback && <p className="text-sm text-blue-700">{adminFeedback}</p>}
      <form onSubmit={handleRegisterClinic} className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs font-semibold uppercase text-slate-500">Name</span>
          <input name="clinic_name" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="text-xs font-semibold uppercase text-slate-500">Einrichtungstyp</span>
          <select
            name="facility_type"
            required
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="clinic">Klinik</option>
            <option value="practice">Praxis</option>
            <option value="group_practice">Gemeinschaftspraxis</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-xs font-semibold uppercase text-slate-500">Fachrichtungen</span>
          <select
            name="clinic_specialties"
            multiple
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {specialtyMultiOptions.map((specialty) => (
              <option key={specialty.value} value={specialty.value}>
                {specialty.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">Mehrfachauswahl mit Strg/Cmd.</p>
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
        <label className="text-sm">
          <span className="text-xs font-semibold uppercase text-slate-500">Telefon</span>
          <input
            name="clinic_phone"
            required
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Öffnungszeiten</span>
          <textarea
            name="clinic_hours"
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Mo:08:00-16:00\nDi:08:00-16:00"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Fachbereiche</span>
          <textarea
            name="clinic_departments"
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Kardiologie:cardiology\nDermatologie:dermatology"
          />
          <p className="mt-1 text-xs text-slate-400">Optional, Format: Name:fach1,fach2</p>
        </label>
        <label className="text-sm md:col-span-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Eigentümer:innen</span>
          <textarea
            name="facility_owners"
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Name je Zeile"
          />
        </label>
        <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="text-sm font-semibold uppercase text-slate-500">Administrationszugang</h4>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
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
              <input
                name="admin_display"
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
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
          </div>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            Einrichtung anlegen
          </button>
        </div>
      </form>
    </div>
  );

  const renderAdminSpecialties = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Fachdisziplinen</h3>
        <p className="text-sm text-slate-600">
          Pflegen Sie den zentralen Katalog. Änderungen stehen Patient:innen und Einrichtungen sofort zur Verfügung.
        </p>
      </div>
      {adminCatalogFeedback && <p className="text-sm text-blue-700">{adminCatalogFeedback}</p>}
      <form onSubmit={handleSpecialtySave} className="space-y-4">
        <div className="space-y-3">
          {adminCatalogDraft.length === 0 ? (
            <p className="text-sm text-slate-500">Noch keine Einträge. Fügen Sie Fachdisziplinen hinzu.</p>
          ) : (
            adminCatalogDraft.map((entry, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={entry}
                  onChange={(event) => handleSpecialtyDraftChange(index, event.target.value)}
                  placeholder="z. B. cardiology"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => handleSpecialtyRemove(index)}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Entfernen
                </button>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSpecialtyAdd}
            className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Fach hinzufügen
          </button>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            Katalog speichern
          </button>
        </div>
      </form>
    </div>
  );

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
                      <span className="text-xs font-semibold uppercase text-blue-700">Telefonnummer</span>
                      <input
                        name="phone_number"
                        required
                        className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2"
                        placeholder="z. B. +49 30 123456"
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
          <section className="mx-auto max-w-6xl space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  {patientMenu.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPatientSection(item.id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        patientSection === item.id
                          ? "bg-blue-600 text-white shadow"
                          : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {rescheduleContext && patientSection !== "appointments" && (
                  <span className="text-sm text-blue-600">
                    Verschiebung aktiv für {formatDateTime(rescheduleContext.start)}.
                  </span>
                )}
              </div>
              <div className="mt-6 space-y-6">
                {patientSection === "search" && renderPatientSearch()}
                {patientSection === "appointments" && renderPatientAppointments()}
                {patientSection === "profile" && renderPatientProfile()}
                {patientSection === "consents" && renderPatientConsents()}
              </div>
            </div>
          </section>
        )}

        {(user?.role === "clinic_admin" || user?.role === "provider") && (
          <section className="mx-auto max-w-6xl space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-lg space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Praxis &amp; Klinik Cockpit</h2>
                  <p className="text-sm text-slate-600">
                    Steuern Sie Angebote, Buchungen, Patient:innenzugriffe und Stammdaten.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl bg-blue-100 px-4 py-2">
                  <span className="text-xs font-semibold uppercase text-blue-700">Einrichtungs-ID</span>
                  <code className="text-sm font-mono text-blue-900">{user?.facility_id ?? "unbekannt"}</code>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {medicalMenu.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMedicalSection(item.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      medicalSection === item.id
                        ? "bg-blue-600 text-white shadow"
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="space-y-6">
                {medicalSection === "availability" && renderMedicalAvailability()}
                {medicalSection === "bookings" && renderMedicalBookings()}
                {medicalSection === "patients" && renderMedicalPatients()}
                {medicalSection === "profile" && renderMedicalProfile()}
                {medicalSection === "team" && user?.role === "clinic_admin" && renderMedicalTeam()}
              </div>
            </div>
          </section>
        )}

        {user?.role === "platform_admin" && (
          <section className="mx-auto max-w-6xl space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-lg space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Plattformverwaltung</h2>
                <p className="text-sm text-slate-600">
                  Verwalten Sie Einrichtungen und den zentralen Fachkatalog der Plattform.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {adminMenu.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAdminSection(item.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      adminSection === item.id
                        ? "bg-blue-600 text-white shadow"
                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="space-y-6">
                {adminSection === "manage" && renderAdminManage()}
                {adminSection === "create" && renderAdminCreate()}
                {adminSection === "specialties" && renderAdminSpecialties()}
              </div>
            </div>
          </section>
        )}
      </main>

      <FooterPlaceholder />
    </div>
  );
}
