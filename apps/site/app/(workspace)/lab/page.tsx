import { permanentRedirect } from "next/navigation";

/** The Lab is the workspace's generate mode now. */
export default function LabPage() {
  permanentRedirect("/workspace?mode=generate");
}
