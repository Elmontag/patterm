import { CalendarIcon, ClockIcon, VideoCameraIcon } from "@heroicons/react/24/outline";

const formatDateTime = (iso) => new Date(iso).toLocaleString("de-DE", {
  dateStyle: "full",
  timeStyle: "short"
});

export default function AppointmentCard({ slot, clinic, onBook, disabled }) {
  const facilityName = clinic?.name ?? slot.facility_id;
  const address = clinic
    ? `${clinic.street}, ${clinic.postal_code} ${clinic.city}`
    : "Adresse wird nachgeladen";
  const providerName = slot.provider_name
    ?? clinic?.providers?.find((provider) => provider.id === slot.provider_id)?.display_name
    ?? (slot.provider_id ? `Team ${slot.provider_id}` : "Teamtermin");
  const departmentName = slot.department_id
    ? clinic?.departments?.find((department) => department.id === slot.department_id)?.name
    : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{facilityName}</h3>
          <p className="text-sm text-slate-500">{address}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-700">
          <CalendarIcon className="h-4 w-4" />
          {formatDateTime(slot.start)}
        </span>
      </div>
      <div className="mt-3 text-sm text-slate-700">
        <p className="font-semibold">{providerName}</p>
        {departmentName && <p className="text-xs text-slate-500">{departmentName}</p>}
      </div>
      <div className="mt-3 flex items-center gap-4 text-sm text-slate-600">
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="h-4 w-4" />
          {Math.round((new Date(slot.end) - new Date(slot.start)) / (1000 * 60))} Minuten
        </span>
        {slot.is_virtual ? (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <VideoCameraIcon className="h-4 w-4" />
            Videosprechstunde
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            Präsenztermin
          </span>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onBook}
          disabled={disabled}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Termin buchen
        </button>
      </div>
    </div>
  );
}
