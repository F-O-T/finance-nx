import type { QueryClient } from "@tanstack/react-query";
import {
   createFileRoute,
   Outlet,
   redirect,
   useRouterState,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import posthog from "posthog-js";
import { RouteTransition } from "@/components/route-transition";
import { authClient } from "@/integrations/better-auth/auth-client";
import type { orpc as orpcClient } from "@/integrations/orpc/client";
import { ChatSessionProvider } from "./-montte-ai/chat-runtime";
import { DashboardLayout } from "./-layout/dashboard-layout";

interface OnEnterContext {
   queryClient: QueryClient;
   orpc: typeof orpcClient;
   session?: {
      user: { id: string; email?: string | null; name?: string | null };
      session?: { activeOrganizationId?: string | null } | null;
   };
}

const onDashboardEnter = createIsomorphicFn()
   .server((_context: OnEnterContext) => {})
   .client(async (context: OnEnterContext) => {
      if (!context.session?.user) return;
      const { user, session } = context.session;
      posthog.identify(user.id, {
         email: user.email ?? undefined,
         name: user.name ?? undefined,
      });
      const organizationId = session?.activeOrganizationId;
      if (organizationId) posthog.group("organization", organizationId);

      const sess = await context.queryClient.fetchQuery(
         context.orpc.session.getSession.queryOptions({}),
      );
      if (sess?.session.activeTeamId) return;

      const teams = await context.queryClient.fetchQuery(
         context.orpc.organization.getOrganizationTeams.queryOptions({}),
      );
      const firstTeamId = teams[0]?.id;
      if (!firstTeamId) return;

      await authClient.organization.setActiveTeam({ teamId: firstTeamId });
      await context.queryClient.invalidateQueries({
         queryKey: context.orpc.session.getSession.queryKey({}),
      });
   });

export const Route = createFileRoute(
   "/_authenticated/$slug/$teamSlug/_dashboard",
)({
   ssr: "data-only",
   beforeLoad: async ({ context }) => {
      const status = await context.queryClient.fetchQuery(
         context.orpc.onboarding.getOnboardingStatus.queryOptions(),
      );

      if (
         !status.organization.onboardingCompleted ||
         !status.project.onboardingCompleted
      ) {
         throw redirect({ to: "/onboarding" });
      }
   },
   onEnter: ({ context }) => {
      void onDashboardEnter(context);
   },
   component: DashboardLayoutRoute,
});

function DashboardLayoutRoute() {
   const sectionKey = useRouterState({
      select: (s) => s.location.pathname.split("/").slice(1, 4).join("/"),
   });
   return (
      <ChatSessionProvider>
         <DashboardLayout>
            <RouteTransition transitionKey={sectionKey}>
               <Outlet />
            </RouteTransition>
         </DashboardLayout>
      </ChatSessionProvider>
   );
}
