import { Sidebar } from "@/components/layout/sidebar";
import { MobileTabs } from "@/components/layout/mobile-tabs";
import { PageTransition } from "@/components/layout/page-transition";
import { DemoBanner } from "@/components/demo/demo-banner";
import { isDemoMode } from "@/lib/demo/config";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demo = await isDemoMode();

  return (
    <div className="min-h-screen bg-background">
      {demo && <DemoBanner />}
      <Sidebar />
      <MobileTabs />
      <main className="md:ml-16 pb-20 md:pb-0">
        <div className="px-4 py-6 md:px-6 lg:px-8">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
