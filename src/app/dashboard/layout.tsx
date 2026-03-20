import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="md:ml-64">
        <div className="mx-auto max-w-7xl px-4 py-8 pt-20 md:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
