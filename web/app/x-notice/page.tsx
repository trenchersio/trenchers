import { redirect } from "next/navigation";

/** The X suspension notice is over: old links go straight to our X account. */
export default function XNotice() {
  redirect("https://x.com/trenchersx");
}
