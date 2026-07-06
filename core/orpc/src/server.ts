import dayjs from "dayjs";
import { Result, isTaggedError } from "better-result";
import { z } from "zod";
import { os } from "@orpc/server";
import { createAuth } from "@core/authentication/server";
import { createDb } from "@core/database/client";
import { env } from "@core/environment/web";
import { createS3Client } from "@core/files/client";
import {
   createPostHog,
   createPromptsClient,
   identifyUser,
   setGroup,
} from "@core/posthog/server";
import { createNotificationsClient } from "@core/notifications/client";
import { createRedis } from "@core/redis/connection";
import { createWorkflowClient } from "@core/dbos/client";
import { startPgBossClient } from "@core/pg-boss/client";
import type {
   ORPCContext,
   ORPCContextAuthenticated,
   ORPCContextWithAuth,
   ORPCContextWithOrganization,
} from "./context";
import { getLogger } from "./context";

declare module "@orpc/server" {
   interface Registry {
      throwableError: Error;
   }
}

const db = createDb({ databaseUrl: env.DATABASE_URL });
const redis = createRedis(env.REDIS_URL);
const posthog = createPostHog(env.POSTHOG_KEY, env.POSTHOG_HOST);
const posthogPrompts = createPromptsClient({
   personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
   projectApiKey: env.POSTHOG_KEY,
   host: env.POSTHOG_HOST,
});
const notificationsClient = createNotificationsClient({
   resendApiKey: env.RESEND_API_KEY,
});
const auth = createAuth({
   db,
   redis,
   posthog,
   notificationsClient,
   env,
});
const workflowClient = createWorkflowClient(env.DATABASE_URL);
const pgBoss = startPgBossClient({
   connectionString: env.DATABASE_URL,
   applicationName: "montte-web-pg-boss",
   supervise: false,
});
const s3Client = createS3Client({
   endpointUrl: env.AWS_ENDPOINT_URL,
   accessKeyId: env.AWS_ACCESS_KEY_ID,
   secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
   region: env.AWS_DEFAULT_REGION,
});

export async function buildWebContext(
   request: Request,
   log: ORPCContext["log"],
): Promise<ORPCContextWithOrganization | null> {
   const session = await auth.api.getSession({ headers: request.headers });
   if (!session?.user) return null;
   const organizationId = session.session.activeOrganizationId;
   const teamId = session.session.activeTeamId;
   if (!organizationId || !teamId) return null;
   return {
      headers: request.headers,
      request,
      log,
      auth,
      db,
      session,
      userId: session.user.id,
      organizationId,
      teamId,
      posthog,
      posthogPrompts,
      redis,
      pgBoss,
      workflowClient: await workflowClient,
      s3Client,
   };
}

const errorDataSchema = z
   .object({
      tag: z.string().optional(),
      issues: z.array(z.string()).optional(),
   })
   .optional();

function getZodError(error: unknown): z.ZodError | null {
   if (error instanceof z.ZodError) return error;
   if (
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      error.cause instanceof z.ZodError
   ) {
      return error.cause;
   }
   return null;
}

function formatZodIssue(issue: z.ZodIssue) {
   const path = issue.path.join(".");
   return path ? `${path}: ${issue.message}` : issue.message;
}

const base = os
   .errors({
      BAD_REQUEST: { data: errorDataSchema },
      UNAUTHORIZED: { data: errorDataSchema },
      FORBIDDEN: { data: errorDataSchema },
      NOT_FOUND: { data: errorDataSchema },
      CONFLICT: { data: errorDataSchema },
      TOO_MANY_REQUESTS: { data: errorDataSchema },
      INTERNAL_SERVER_ERROR: { data: errorDataSchema },
   })
   .$context<ORPCContext>();

const apiKeyMetadataSchema = z.object({
   organizationId: z.string().min(1),
   teamId: z.string().min(1).nullish(),
});

const withDeps = base.use(async ({ context, next, errors }) => {
   const apiKeyValue =
      context.headers.get("x-api-key") ?? context.headers.get("sdk-api-key");

   if (apiKeyValue) {
      const result = await Result.gen(async function* () {
         const verified = yield* Result.await(
            Result.tryPromise({
               try: () => auth.api.verifyApiKey({ body: { key: apiKeyValue } }),
               catch: () =>
                  errors.UNAUTHORIZED({
                     message: "API key inválida.",
                  }),
            }),
         );
         if (!verified?.valid || !verified.key) {
            return Result.err(
               errors.UNAUTHORIZED({
                  message: "API key inválida.",
               }),
            );
         }

         const parsed = apiKeyMetadataSchema.safeParse(verified.key.metadata);
         if (!parsed.success) {
            return Result.err(
               errors.BAD_REQUEST({
                  message: "Metadata da API key inválida.",
               }),
            );
         }

         const apiKeyHeaders = new Headers();
         apiKeyHeaders.set("x-api-key", apiKeyValue);

         const session = yield* Result.await(
            Result.tryPromise({
               try: () => auth.api.getSession({ headers: apiKeyHeaders }),
               catch: () =>
                  errors.UNAUTHORIZED({
                     message: "Falha ao resolver sessão da API key.",
                  }),
            }),
         );
         if (!session?.user) {
            return Result.err(
               errors.UNAUTHORIZED({
                  message: "API key sem sessão associada.",
               }),
            );
         }
         if (session.user.id !== verified.key.referenceId) {
            return Result.err(
               errors.UNAUTHORIZED({
                  message: "API key não pertence à sessão.",
               }),
            );
         }

         return Result.ok({
            ...session,
            session: {
               ...session.session,
               activeOrganizationId: parsed.data.organizationId,
               activeTeamId: parsed.data.teamId ?? session.session.activeTeamId,
            },
         });
      });
      if (Result.isError(result)) throw result.error;

      return next({
         context: {
            ...context,
            auth,
            db,
            session: result.value,
            posthog,
            posthogPrompts,
            redis,
            pgBoss,
            workflowClient: await workflowClient,
            s3Client,
         },
      });
   }

   const cookieSession = await Result.gen(async function* () {
      const session = yield* Result.await(
         Result.tryPromise({
            try: () => auth.api.getSession({ headers: context.headers }),
            catch: () =>
               errors.INTERNAL_SERVER_ERROR({
                  message: "Falha ao resolver sessão.",
               }),
         }),
      );

      return Result.ok(session);
   });
   if (Result.isError(cookieSession)) throw cookieSession.error;

   return next({
      context: {
         ...context,
         auth,
         db,
         session: cookieSession.value,
         posthog,
         posthogPrompts,
         redis,
         pgBoss,
         workflowClient: await workflowClient,
         s3Client,
      },
   });
});

const withAuth = withDeps.use(({ context, next, errors }) => {
   const result = Result.gen(function* () {
      const { session } = context;
      if (!session?.user) {
         return Result.err(
            errors.UNAUTHORIZED({
               message:
                  "Você precisa estar autenticado para acessar este recurso.",
            }),
         );
      }

      const authContext = yield* Result.ok({
         session,
         userId: session.user.id,
      });

      return Result.ok(authContext);
   });
   if (Result.isError(result)) throw result.error;

   return next({
      context: {
         ...context,
         session: result.value.session,
         userId: result.value.userId,
      },
   });
});

const withOrganization = withAuth.use(({ context, next, errors }) => {
   const result = Result.gen(function* () {
      const organizationId = context.session.session.activeOrganizationId;
      const teamId = context.session.session.activeTeamId;

      if (!organizationId) {
         return Result.err(
            errors.FORBIDDEN({
               message: "Nenhuma organização ativa selecionada.",
            }),
         );
      }
      if (!teamId) {
         return Result.err(
            errors.FORBIDDEN({
               message: "Nenhum time ativo selecionado.",
            }),
         );
      }

      const organizationContext = yield* Result.ok({ organizationId, teamId });

      return Result.ok(organizationContext);
   });
   if (Result.isError(result)) throw result.error;

   return next({
      context: {
         ...context,
         organizationId: result.value.organizationId,
         teamId: result.value.teamId,
      },
   });
});

const withORPCErrors = withOrganization.use(
   async ({ context, next, errors }) => {
      const result = await Result.tryPromise({
         try: async () => next(),
         catch: (error) => error,
      });

      if (Result.isOk(result)) return result.value;

      const zodError = getZodError(result.error);
      if (zodError) {
         const issues = zodError.issues.map(formatZodIssue);
         throw errors.BAD_REQUEST({
            message: zodError.issues[0]?.message ?? "Dados inválidos.",
            cause: result.error,
            data: { tag: "ValidationError", issues },
         });
      }

      if (!isTaggedError(result.error)) {
         const error = result.error;
         getLogger(context).error(
            error instanceof Error ? error : String(error),
            {
               module: "orpc",
               message: "Erro não mapeado em procedure oRPC.",
               tags: ["orpc", "unmapped-error"],
            },
         );
         throw errors.INTERNAL_SERVER_ERROR({
            message: "Ocorreu um erro inesperado. Tente novamente.",
            cause: result.error,
            data: { tag: "UnmappedError" },
         });
      }
      const status = Reflect.get(result.error, "error").status;

      const options = {
         message: result.error.message,
         cause: result.error,
         data: { tag: result.error._tag },
      };
      switch (status) {
         case 400:
            throw errors.BAD_REQUEST(options);
         case 401:
            throw errors.UNAUTHORIZED(options);
         case 403:
            throw errors.FORBIDDEN(options);
         case 404:
            throw errors.NOT_FOUND(options);
         case 409:
            throw errors.CONFLICT(options);
         case 429:
            throw errors.TOO_MANY_REQUESTS(options);
         default:
            throw errors.INTERNAL_SERVER_ERROR(options);
      }
   },
);

const withLogger = withORPCErrors.use(
   async ({ context, path, next }, input) => {
      const startMs = Date.now();
      const log = getLogger(context);
      const userId = context.session?.user?.id;
      const sessionId = context.headers.get("x-posthog-session-id");
      const orpcPath = path.join(".");

      const logContext = {
         orpc: {
            path: orpcPath,
            rootPath: path[0],
         },
         userId,
         posthogDistinctId: userId ?? "anonymous",
         organizationId: context.organizationId,
         teamId: context.teamId,
         path: orpcPath,
      };
      if (sessionId) Object.assign(logContext, { sessionId });
      log.set(logContext);

      const result = await Result.tryPromise({
         try: async () => next(),
         catch: (error) => error,
      });

      const orpcLog = {
         path: orpcPath,
         rootPath: path[0],
         durationMs: Date.now() - startMs,
         endAt: dayjs().toISOString(),
         success: Result.isOk(result),
         input,
      };
      if (Result.isError(result)) {
         const error = result.error;
         Object.assign(orpcLog, {
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage:
               error instanceof Error ? error.message : String(error),
            errorTagged: isTaggedError(error),
         });
      }

      log.set({ orpc: orpcLog });
      log.emit();

      if (Result.isError(result)) {
         throw result.error;
      }

      return result.value;
   },
);

const withTelemetry = withLogger.use(async ({ context, next }) => {
   const userId = context.session.user.id;
   const userEmail = context.session.user.email;
   const userName = context.session.user.name;
   const organizationId = context.organizationId;

   const telemetry = Result.gen(function* () {
      yield* Result.try({
         try: () => {
            identifyUser(context.posthog, userId, {
               email: userEmail,
               name: userName,
            });
            setGroup(context.posthog, organizationId, {});

            getLogger(context).set({
               posthog: {
                  distinctId: userId,
                  group: { organization: organizationId },
               },
            });
         },
         catch: (error) => error,
      });

      return Result.ok();
   });

   if (telemetry.isErr()) {
      getLogger(context).warn("PostHog telemetry failed", {
         posthog: {
            errorName: "PostHogTelemetryError",
            errorMessage: "Falha ao registrar telemetria no PostHog.",
         },
      });
   }

   return next();
});

export type {
   ORPCContext,
   ORPCContextWithAuth,
   ORPCContextAuthenticated,
   ORPCContextWithOrganization,
};

export const publicProcedure = withDeps;
export const authenticatedProcedure = withAuth;
export const protectedProcedure = withTelemetry;
