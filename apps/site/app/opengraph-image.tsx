import { ImageResponse } from "next/og";
import { siteDescription } from "@/lib/site";

export const alt = "jit — the compiled data engine";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        backgroundColor: "#151822",
        backgroundImage: "radial-gradient(ellipse 600px 400px at 80% 10%, rgba(247,210,126,0.22), transparent 70%)",
        color: "#f3efd1",
        fontSize: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <span style={{ fontSize: 96, fontWeight: 700, color: "#f3efd1" }}>jit</span>
        <span style={{ fontSize: 96, fontWeight: 700, color: "#f7d27e" }}>_</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 44, fontWeight: 600, color: "#ffffff" }}>
        Compile intent. Run specialized code.
      </div>
      <div style={{ marginTop: 24, maxWidth: 900, fontSize: 26, lineHeight: 1.5, color: "#aeb2b3" }}>
        {siteDescription}
      </div>
    </div>,
    size
  );
}
