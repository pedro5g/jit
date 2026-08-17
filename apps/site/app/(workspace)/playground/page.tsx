import { permanentRedirect } from "next/navigation";

/** The playground is the workspace's run mode now. */
export default function PlaygroundPage() {
  permanentRedirect("/workspace?mode=run");
}
