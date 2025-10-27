import axios from "axios";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  headers: {
    "Content-Type": "application/json"
  }
});

export const getClinics = async () => {
  const { data } = await client.get("/clinics");
  return data;
};

export const searchAppointments = async (params) => {
  const { data } = await client.get("/appointments/search", { params });
  return data;
};

export const bookAppointment = async (payload) => {
  const { data } = await client.post("/appointments", payload);
  return data;
};

export const getPatientRecord = async ({ patientId, clinicId }) => {
  const { data } = await client.get(`/patients/${patientId}`, {
    params: clinicId ? { requester_clinic_id: clinicId } : {}
  });
  return data;
};

export const updateConsent = async ({ patientId, requesterClinicId, grant }) => {
  const { data } = await client.post(`/patients/${patientId}/consents`, {
    requester_clinic_id: requesterClinicId,
    grant
  });
  return data;
};
