import { redirect } from "next/navigation";
import { CodeForm } from "../../code-form";

export default async function SignInCodePage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  if (!email) redirect("/sign-in");
  return <CodeForm email={email} />;
}
