import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { authedApiFetch } from "@/lib/api";

export default async function AccountPage() {
  if (!(await auth())) redirect("/sign-in");
  const res = await authedApiFetch("/me");
  if (res.status === 401) redirect("/sign-in");
  if (!res.ok) throw new Error(`API /me failed: ${res.status}`);
  const me = await res.json();
  return (
    <div className="border border-line bg-white p-4">
      <h1 className="mb-2 text-lg font-bold">Your account</h1>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Name", me.name],
            ["Email", me.email],
            ["Role", me.role],
            ["Email verified", me.emailVerified ? new Date(me.emailVerified).toUTCString() : "No"],
          ].map(([label, value]) => (
            <tr key={label}>
              <th className="w-40 border border-line bg-[#f0f0f0] p-2 text-left font-normal text-muted">{label}</th>
              <td className="border border-line p-2">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
