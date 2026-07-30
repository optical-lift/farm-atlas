import { ImageResponse } from "next/og";

export const runtime = "edge";

function iconSize(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("size"));
  return [180, 192, 512].includes(value) ? value : 512;
}

export async function GET(request: Request) {
  const size = iconSize(request);
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  const inset = maskable ? Math.round(size * 0.16) : Math.round(size * 0.08);
  const border = Math.max(5, Math.round(size * 0.025));
  const titleSize = Math.round(size * 0.22);
  const smallSize = Math.round(size * 0.07);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f4e9",
          padding: inset,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            border: `${border}px solid #5f568b`,
            borderRadius: Math.round(size * 0.2),
            background: "#ede9fb",
            color: "#302f4d",
            padding: Math.round(size * 0.11),
            boxShadow: `inset 0 0 0 ${Math.max(2, Math.round(size * 0.008))}px rgba(255,255,255,0.65)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontFamily: "Arial, sans-serif",
              fontSize: smallSize,
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <span>Atlas</span>
            <span style={{ color: "#8f86b5" }}>● ○ ●</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              fontFamily: "Arial, sans-serif",
            }}
          >
            <span style={{ fontSize: titleSize, fontWeight: 900, lineHeight: 0.82 }}>A</span>
            <span
              style={{
                width: Math.round(size * 0.2),
                height: Math.round(size * 0.2),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background: "#e7e94f",
                color: "#373654",
                fontSize: Math.round(size * 0.14),
                fontWeight: 900,
              }}
            >
              +
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
