import { redirect } from "next/navigation";

// The account details are at the top of the settings page now; this keeps old links and bookmarks working.
export default function AccountPage() {
  redirect("/account/settings");
}
