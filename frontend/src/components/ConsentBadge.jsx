export default function ConsentBadge({ clinicName, granted }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
        granted ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {granted ? "Freigegeben" : "Gesperrt"} · {clinicName}
    </span>
  );
}
