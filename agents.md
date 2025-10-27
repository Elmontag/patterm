Patterm is a GDPR and ISO27001-compliant appointment and patient management system for medical practices and hospital outpatient clinics. It is written in React/Vite, TailwindCSS, and FastAPI. It offers encrypted data stores for each patient.

Use cases:
1. Patients can search for available outpatient clinic and medical practice appointments based on specialty and clinic and register for an appointment.
2. Appointments are automatically confirmed by email.
3. Clinics and doctors can create available appointments and offer them for booking.
4. Clinics and doctors can determine the further treatment procedure in the patient record. The history is versioned.

Each patient record with personal data, booked appointments, and treatment history is stored in an audit trail-compatible manner in a patient-specific data store. This is only accessible to the treating physicians and the patient themselves (after login).

The patient can make their data record available to other practices/clinics. Practices and clinics can request the patient to release their data. This process is also auditable.

Translated with DeepL.com (free version)
