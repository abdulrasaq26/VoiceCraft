export const metadata = {
  title: "AutoEditor — Frameloom Studio",
  description: "Sync timestamp-named images and video clips to a voiceover and export an MP4, on your device.",
  icons: { icon: "/brand/frameloom-icon.svg" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
