import axios from "axios";

const resolveBaseURL = () => {
  const explicit = import.meta.env.VITE_API_URL;
  if (explicit && explicit.trim() !== "") {
    return explicit;
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const configuredPort = import.meta.env.VITE_API_PORT;
    const portSegment = configuredPort && configuredPort.trim() !== ""
      ? `:${configuredPort.trim()}`
      : ":8000";
    return `${protocol}//${hostname}${portSegment}`;
  }
  return "http://127.0.0.1:8000";
};

const client = axios.create({
  baseURL: resolveBaseURL(),
  headers: {
    "Content-Type": "application/json"
  }
});

export const setAuthToken = (token) => {
  if (token) {
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete client.defaults.headers.common.Authorization;
  }
};

const extractData = async (promise) => {
  const { data } = await promise;
  return data;
};

export const getClinics = async () => extractData(client.get("/clinics"));

export const searchAppointments = async (params) =>
  extractData(client.get("/appointments/search", { params }));

export const registerPatient = async (payload) =>
  extractData(client.post("/auth/register/patient", payload));

export const login = async (payload) => extractData(client.post("/auth/login", payload));

export const fetchProfile = async () => extractData(client.get("/auth/profile"));

export const registerClinic = async (payload) =>
  extractData(client.post("/auth/register/clinic", payload));

export const registerProvider = async (payload) =>
  extractData(client.post("/auth/register/provider", payload));

export const bookPatientAppointment = async (slotId) =>
  extractData(client.post("/appointments", { slot_id: slotId }));

export const getOwnRecord = async () => extractData(client.get("/patient/record"));

export const cancelPatientAppointment = async (slotId) =>
  extractData(client.post(`/patient/appointments/${slotId}/cancel`));

export const reschedulePatientAppointment = async ({ slotId, newSlotId }) =>
  extractData(
    client.post(`/patient/appointments/${slotId}/reschedule`, { new_slot_id: newSlotId })
  );

export const updateConsent = async ({ patientId, requesterClinicId, grant }) =>
  extractData(
    client.post(`/patients/${patientId}/consents`, {
      requester_clinic_id: requesterClinicId,
      grant
    })
  );

export const fetchPatientRecordForClinic = async ({ patientId, clinicId }) =>
  extractData(
    client.get(`/patients/${patientId}`, {
      params: { requester_clinic_id: clinicId }
    })
  );

export const getClinicSlots = async () => extractData(client.get("/medical/slots"));

export const createClinicSlot = async (payload) =>
  extractData(client.post("/medical/slots", payload));

export const updateClinicSlot = async ({ slotId, ...payload }) =>
  extractData(client.patch(`/medical/slots/${slotId}`, payload));

export const cancelClinicSlot = async (slotId) =>
  extractData(client.post(`/medical/slots/${slotId}/cancel`));

export const getClinicBookings = async () => extractData(client.get("/medical/bookings"));

export const getClinicProviders = async () => extractData(client.get("/medical/providers"));
