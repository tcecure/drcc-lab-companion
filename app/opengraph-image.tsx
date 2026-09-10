import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const alt =
  "DigitalRCC Lab Companion with the Digital Resilience Community Clinic logo";
export const size = {
  height: 630,
  width: 1200,
};
export const contentType = "image/png";
export const runtime = "nodejs";

export default async function OpenGraphImage() {
  const logoData = await readFile(
    join(process.cwd(), "public/brand/drcc-logo.png"),
    "base64",
  );

  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#060b18",
        color: "#eef7ff",
        display: "flex",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        overflow: "hidden",
        padding: "64px 72px",
        position: "relative",
        width: "100%",
      }}
    >
      <div
        style={{
          border: "1px solid rgba(125, 211, 252, 0.14)",
          inset: 28,
          position: "absolute",
        }}
      />
      <div
        style={{
          background: "#22d3ee",
          height: 4,
          left: 72,
          position: "absolute",
          top: 28,
          width: 188,
        }}
      />

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "16px 0 12px",
        }}
      >
        <div
          style={{
            color: "#67e8f9",
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          DIGITALRCC
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 650,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            Lab Companion
          </div>
          <div
            style={{
              color: "#a9bdcf",
              display: "flex",
              fontSize: 27,
              lineHeight: 1.45,
              marginTop: 28,
              maxWidth: 620,
            }}
          >
            CMMC Level 1 lab access, guides, progress, and support in one place.
          </div>
        </div>

        <div
          style={{
            alignItems: "center",
            color: "#8ea4b8",
            display: "flex",
            fontSize: 20,
          }}
        >
          <div
            style={{
              background: "#22d3ee",
              borderRadius: "50%",
              display: "flex",
              height: 10,
              marginRight: 14,
              width: 10,
            }}
          />
          my.digitalrcc.com
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "center",
          position: "relative",
          width: 380,
        }}
      >
        <div
          style={{
            alignItems: "center",
            border: "1px solid rgba(103, 232, 249, 0.42)",
            borderRadius: "50%",
            display: "flex",
            height: 350,
            justifyContent: "center",
            position: "relative",
            width: 350,
          }}
        >
          <div
            style={{
              border: "1px solid rgba(125, 211, 252, 0.12)",
              borderRadius: "50%",
              height: 304,
              position: "absolute",
              width: 304,
            }}
          />
          <div
            style={{
              background: "#22d3ee",
              border: "2px solid #dffbff",
              borderRadius: "50%",
              height: 14,
              position: "absolute",
              right: 32,
              top: 55,
              width: 14,
            }}
          />
          <img
            alt=""
            height={300}
            src={`data:image/png;base64,${logoData}`}
            style={{ objectFit: "contain" }}
            width={300}
          />
        </div>
      </div>
    </div>,
    size,
  );
}
