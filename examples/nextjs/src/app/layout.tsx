import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ComputeSDK + Next.js Example',
  description: 'Example of using ComputeSDK with Next.js for server-side code execution',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <style>{`
          body {
            font-family: system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}