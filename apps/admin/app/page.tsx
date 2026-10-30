import { Button } from "@auction/ui";

export default function AdminHome() {
  return (
    <div className="max-w-xl border border-line bg-white p-4">
      <h1 className="mb-2 text-base font-bold">Moderation</h1>
      <p className="mb-3 text-muted">Sign-in, the reports queue, and listing and user moderation arrive in slice 6.</p>
      <Button disabled>Reports queue</Button>
    </div>
  );
}
