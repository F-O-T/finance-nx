import { Button } from "@packages/ui/components/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
   createFileRoute,
   Link,
   redirect,
   useRouter,
} from "@tanstack/react-router";
import { useIsomorphicLayoutEffect } from "foxact/use-isomorphic-layout-effect";
import { AlertTriangle } from "lucide-react";
import { z } from "zod";
import { orpc } from "@/integrations/orpc/client";

const callbackSearchSchema = z.object({
   error: z.string().optional().catch(undefined),
});

const authErrorMessages: Record<string, string> = {
   ATTEMPTS_EXCEEDED:
      "Você tentou entrar muitas vezes seguidas. Aguarde alguns minutos e tente novamente.",
   TOO_MANY_REQUESTS:
      "Você tentou entrar muitas vezes seguidas. Aguarde alguns minutos e tente novamente.",
   EXPIRED_TOKEN:
      "Este link de acesso expirou. Solicite um novo para continuar.",
   INVALID_TOKEN:
      "Este link de acesso é inválido ou já foi usado. Solicite um novo.",
};

function authErrorMessage(code: string): string {
   return (
      authErrorMessages[code] ??
      "Não foi possível concluir o acesso. Tente entrar novamente."
   );
}

export const Route = createFileRoute("/auth/callback")({
   validateSearch: callbackSearchSchema,
   loaderDeps: ({ search }) => ({ error: search.error }),
   beforeLoad: async ({ context, search }) => {
      if (search.error) {
         return;
      }

      const session = await context.queryClient
         .fetchQuery(context.orpc.session.getSession.queryOptions())
         .catch(() => null);

      if (!session?.user?.id) {
         throw redirect({
            to: "/auth/sign-in",
            search: { redirect: undefined },
         });
      }
   },
   loader: ({ context, deps }) => {
      if (deps.error) {
         return;
      }

      context.queryClient.prefetchQuery(
         context.orpc.organization.getOrganizations.queryOptions(),
      );
   },
   errorComponent: AuthCallbackErrorPage,
   component: AuthCallbackPage,
});

function AuthCallbackPage() {
   const { error } = Route.useSearch();

   if (error) {
      return (
         <AuthErrorScreen
            title="Não foi possível entrar"
            description={authErrorMessage(error)}
         />
      );
   }

   return <OrganizationResolver />;
}

function OrganizationResolver() {
   const router = useRouter();
   const { data: organizations } = useSuspenseQuery(
      orpc.organization.getOrganizations.queryOptions(),
   );

   useIsomorphicLayoutEffect(() => {
      const firstOrg = organizations[0];
      if (!firstOrg || !firstOrg.onboardingCompleted) {
         router.navigate({ to: "/onboarding" });
         return;
      }
   }, [organizations, router]);

   const firstOrg = organizations[0];
   if (!firstOrg || !firstOrg.onboardingCompleted) {
      return null;
   }

   return <TeamResolver orgSlug={firstOrg.slug} />;
}

function TeamResolver({ orgSlug }: { orgSlug: string }) {
   const router = useRouter();

   const { data: teams } = useSuspenseQuery(
      orpc.organization.getOrganizationTeams.queryOptions({
         input: { orgSlug },
      }),
   );

   useIsomorphicLayoutEffect(() => {
      const fallbackTeam = teams[0];

      if (fallbackTeam) {
         router.navigate({
            to: "/$slug/$teamSlug/inbox",
            params: {
               slug: orgSlug,
               teamSlug: fallbackTeam.slug,
            },
         });
         return;
      }

      router.navigate({ to: "/onboarding" });
   }, [teams, orgSlug, router]);

   return null;
}

function AuthCallbackErrorPage() {
   return (
      <AuthErrorScreen
         title="Não foi possível entrar"
         description="Tivemos um problema ao carregar sua conta. Tente entrar novamente."
      />
   );
}

function AuthErrorScreen({
   title,
   description,
}: {
   title: string;
   description: string;
}) {
   return (
      <div className="flex w-full flex-col gap-6">
         <div className="flex items-center justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
               <AlertTriangle className="size-5 text-foreground" />
            </div>
         </div>
         <div className="flex flex-col items-center gap-2">
            <h1 className="text-center font-medium text-foreground text-xl leading-none">
               {title}
            </h1>
            <p className="max-w-xs text-center text-muted-foreground text-sm">
               {description}
            </p>
         </div>
         <Button asChild className="h-10">
            <Link to="/auth/sign-in" search={{ redirect: undefined }}>
               Voltar para login
            </Link>
         </Button>
      </div>
   );
}
