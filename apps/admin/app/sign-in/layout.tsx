// The signed-out screens: a centred card, no sidebar. There is no sign-up here; admin accounts are made by an existing admin or
// with `yarn workspace @auction/db make-admin <email>`.
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded border border-line bg-panel p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Auctionly</p>
          <h1 className="text-lg font-bold">Admin sign-in</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
